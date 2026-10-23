"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import { hasCurrentOpsReadAuthority, useOpsProtectedRead, type OpsReadAccess } from "@/hooks/use-ops-protected-read";
import { MY_ASSIGNMENTS_PATH, type MyAssignmentsResponse } from "@/hooks/use-my-assignments";
import { opsApiClient } from "@/lib/ops-api";
import { OpsApiError } from "@/lib/ops-errors";
import { currentOpsAuthorityStamp } from "@/lib/ops-write-authority";
import { blockReadAccess, isReadAccessBlocked } from "@/lib/query-read-access";
import { profileServerNow, selectNextProfileShift, type PersonalDutyResponse, type PersonalDutyRow, type ProfileNextShift } from "@/widgets/my-profile/model/profile-next-shift";

export const PERSONAL_DUTY_PATH = "/api/ops/personal-duty/";
const GROUP = "ops-profile-next";
const denialEpochs = new WeakMap<QueryClient, Map<string, number>>();
interface PersonalReadMetadata { profileReadEpoch: number; receivedMonotonicMs: number }

function epochOf(client: QueryClient, scope: string): number {
  return denialEpochs.get(client)?.get(scope) ?? 0;
}

function denyProfileScope(client: QueryClient, scope: string): void {
  const epochs = denialEpochs.get(client) ?? new Map<string, number>();
  epochs.set(scope, epochOf(client, scope) + 1);
  denialEpochs.set(client, epochs);
  for (const query of client.getQueryCache().findAll({ predicate: item => item.queryKey[0] === GROUP && item.queryKey[2] === scope })) {
    blockReadAccess(client, query.queryKey, true);
  }
}

function staleRead(): never {
  throw new OpsApiError({ status: 503, errorCode: "PERSONAL_PROFILE_READ_SUPERSEDED",
    message: "Ответ получен до изменения доступа. Повторите загрузку личных назначений.", details: {}, requestId: null });
}

/** Personal sources are self-service; neither status.view nor duty.view is required. */
export function useProfileNextShiftSources(employeeId: string, enabled = true) {
  const client = useQueryClient();
  const permissions = useOpsPermissions();
  const { data: session, status } = useSession();
  const actor = (session?.user as { id?: string } | undefined)?.id ?? session?.user?.email ?? "";
  const scope = currentOpsAuthorityStamp(client, actor);
  const access: OpsReadAccess = {
    actor, scope: scope ?? JSON.stringify([actor, "unavailable"]),
    allowed: enabled && employeeId !== "" && status === "authenticated" && scope !== null &&
      permissions.permissions !== undefined && !permissions.isLoading && !permissions.error,
  };

  useEffect(() => {
    // A changed employee, actor or grant set must not revive an earlier self payload.
    client.removeQueries({ predicate: query => query.queryKey[0] === GROUP &&
      (!access.allowed || query.queryKey[2] !== access.scope || query.queryKey[3] !== employeeId) });
  }, [client, access.allowed, access.scope, employeeId]);

  function assertAuthority(): void {
    if (!hasCurrentOpsReadAuthority(client, access)) throw new OpsApiError({
      status: 403, errorCode: "PERSONAL_PROFILE_AUTHORITY_CHANGED",
      message: "Доступ к личным назначениям изменился. Обновите профиль.", details: {}, requestId: null,
    });
  }

  async function readSelf<T extends { employeeId: string | null; unlinkedReason: string | null; results: unknown[] }>(path: string): Promise<T & PersonalReadMetadata> {
    const epoch = epochOf(client, access.scope);
    const check = () => {
      assertAuthority();
      if (epochOf(client, access.scope) !== epoch) staleRead();
    };
    try {
      // Check after token lookup and after transport; a sibling denial supersedes this request.
      const response = await opsApiClient.get<T>(path, check);
      check();
      const unlinked = response.employeeId === null && response.unlinkedReason !== null && response.results.length === 0;
      if (!unlinked && String(response.employeeId) !== employeeId) throw new OpsApiError({
        status: 403, errorCode: "PERSONAL_PROFILE_EMPLOYEE_CHANGED",
        message: "Кадровая привязка изменилась. Обновите профиль.", details: {}, requestId: null,
      });
      // Enumerable metadata survives Query's structural sharing, including identical fresh data.
      return { ...response, profileReadEpoch: epoch, receivedMonotonicMs: performance.now() };
    } catch (error) {
      if (epochOf(client, access.scope) !== epoch) staleRead();
      const status = (error as { status?: number } | null)?.status;
      if (status === 401 || status === 403 || status === 404) {
        denyProfileScope(client, access.scope);
      }
      throw error;
    }
  }

  const duties = useOpsProtectedRead([GROUP, "duties"], [employeeId], access,
    () => readSelf<PersonalDutyResponse>(PERSONAL_DUTY_PATH), { poll: () => 60_000 });
  const assignments = useOpsProtectedRead([GROUP, "assignments"], [employeeId], access,
    () => readSelf<MyAssignmentsResponse>(MY_ASSIGNMENTS_PATH), { poll: () => 60_000 });
  const epoch = epochOf(client, access.scope);
  const staleDuties = duties.data !== undefined && duties.data.profileReadEpoch !== epoch;
  const staleAssignments = assignments.data !== undefined && assignments.data.profileReadEpoch !== epoch;
  useEffect(() => {
    // The final epoch gate also covers completion between nested asynchronous read wrappers.
    for (const query of [duties, assignments]) {
      if (query.data !== undefined && query.data.profileReadEpoch !== epochOf(client, access.scope)) {
        blockReadAccess(client, query.readKey, true);
      }
    }
  }, [client, access.scope, duties.data, assignments.data]);
  return {
    duties: { ...duties, data: staleDuties ? undefined : duties.data, readAccessBlocked: duties.readAccessBlocked || staleDuties },
    assignments: { ...assignments, data: staleAssignments ? undefined : assignments.data, readAccessBlocked: assignments.readAccessBlocked || staleAssignments },
    authorityAvailable: access.allowed,
    access,
  };
}

type AcknowledgementResponse = { record: PersonalDutyRow; generated_at: string; time_zone: string };
type AcknowledgementTarget = { employeeId: string; key: string; token: string; identity: string; epoch: number; access: OpsReadAccess; readKey: QueryKey };

/** Acknowledge only the currently displayed, authorized self assignment. No attendance writes. */
export function useAcknowledgePersonalDuty(employeeId: string, shift: ProfileNextShift | null, sources: ReturnType<typeof useProfileNextShiftSources>) {
  const client = useQueryClient();
  const identity = JSON.stringify([employeeId, shift?.key, shift?.acknowledgementToken, sources.access.scope]);
  const live = useRef({ employeeId, shift, sources, identity });
  live.current = { employeeId, shift, sources, identity };
  const mounted = useRef(true);
  const inFlight = useRef<Promise<AcknowledgementResponse> | null>(null);
  const submittedIdentity = useRef<string | null>(null);
  const submittedRead = useRef<{ query: object | undefined; count: number } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const target = (): AcknowledgementTarget => ({ employeeId, key: shift?.key ?? "", token: shift?.acknowledgementToken ?? "",
    identity, epoch: epochOf(client, sources.access.scope), access: sources.access, readKey: sources.duties.readKey });
  function changed(): never {
    throw new OpsApiError({ status: 409, errorCode: "PERSONAL_ACKNOWLEDGEMENT_CHANGED",
      message: "Назначение или доступ изменились. Обновите ближайшую смену и подтвердите заново.", details: {}, requestId: null });
  }
  function check(captured: AcknowledgementTarget, allowRefreshing = false): void {
    const current = live.current;
    if (!mounted.current || captured.identity !== current.identity || captured.employeeId !== current.employeeId ||
      !hasCurrentOpsReadAuthority(client, captured.access) || epochOf(client, captured.access.scope) !== captured.epoch) changed();
    const state = client.getQueryState<PersonalDutyResponse & PersonalReadMetadata>(captured.readKey);
    const data = state?.data;
    if (state?.status !== "success" || (!allowRefreshing && state.fetchStatus !== "idle") || !data ||
      String(data.employeeId) !== captured.employeeId || data.profileReadEpoch !== captured.epoch || isReadAccessBlocked(client, captured.readKey)) changed();
    const now = profileServerNow(data.generated_at, data.receivedMonotonicMs, performance.now());
    const assignments = current.sources.assignments;
    const currentShift = now === null ? null : selectNextProfileShift(data.results,
      assignments.readAccessBlocked ? [] : assignments.data?.results ?? [], now, data.time_zone);
    if (!currentShift || currentShift.source === "OM" || !currentShift.canAcknowledge ||
      currentShift.key !== captured.key || currentShift.acknowledgementToken !== captured.token) changed();
  }
  const mutation = useOpsMutation<AcknowledgementResponse, AcknowledgementTarget>({
    mutationFn: async captured => {
      check(captured);
      try {
        const response = await opsApiClient.post<AcknowledgementResponse>(
          `${PERSONAL_DUTY_PATH}${encodeURIComponent(captured.key)}/acknowledge/`, { token: captured.token }, () => check(captured));
        check(captured, true);
        if (response.record.id !== captured.key || response.record.acknowledgementToken !== captured.token) changed();
        return response;
      } catch (error) {
        const status = (error as { status?: number } | null)?.status;
        if ((status === 401 || status === 403 || status === 404) && epochOf(client, captured.access.scope) === captured.epoch) {
          denyProfileScope(client, captured.access.scope);
        }
        throw error;
      }
    },
    onSuccess: (_response, captured) => {
      try { check(captured, true); } catch { return; }
      void client.invalidateQueries({ queryKey: captured.readKey, exact: true });
    },
  });
  const belongsHere = submittedIdentity.current === identity;
  const sourceQuery = client.getQueryCache().find({ queryKey: sources.duties.readKey, exact: true });
  const freshRead = submittedRead.current !== null && sourceQuery?.state.status === "success" &&
    sourceQuery.state.data !== undefined && !isReadAccessBlocked(client, sources.duties.readKey) &&
    (sourceQuery.state.data as PersonalReadMetadata).profileReadEpoch === epochOf(client, sources.access.scope) &&
    (sourceQuery !== submittedRead.current.query || sourceQuery.state.dataUpdateCount > submittedRead.current.count);
  const conflict = belongsHere && (mutation.error as { status?: number } | null)?.status === 409;
  // A successful new read can authorize the unchanged token again; failures cannot clear this gate.
  const needsRefresh = conflict && !freshRead;
  let available = false;
  try { check(target()); available = true; } catch { /* A disabled action never supplies authority. */ }
  return {
    canSubmit: available && !mutation.isPending && inFlight.current === null && !needsRefresh,
    pending: mutation.isPending && belongsHere,
    busy: mutation.isPending || inFlight.current !== null,
    succeeded: belongsHere && mutation.data !== undefined && shift !== null && mutation.data.record.id === shift.key &&
      shift.acknowledgedAt !== null && shift.acknowledgedAt === mutation.data.record.acknowledged_at,
    errorMessage: !belongsHere || !mutation.error || (conflict && freshRead) ? null : needsRefresh
      ? "Назначение изменилось. Обновите ближайшую смену и подтвердите заново."
      : "Не удалось подтвердить ознакомление. Обновите данные и повторите попытку.",
    submit(): Promise<AcknowledgementResponse> {
      if (inFlight.current) return inFlight.current;
      const captured = target(); submittedIdentity.current = captured.identity;
      const query = client.getQueryCache().find({ queryKey: captured.readKey, exact: true });
      submittedRead.current = { query, count: query?.state.dataUpdateCount ?? 0 };
      const operation = mutation.mutateAsync(captured).finally(() => { inFlight.current = null; });
      inFlight.current = operation;
      return operation;
    },
  };
}
