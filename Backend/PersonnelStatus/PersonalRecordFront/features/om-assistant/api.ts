"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { useOpsReadAccess, useOpsProtectedRead, hasCurrentOpsReadAuthority, assertOpsReadAuthority, type OpsReadAccess } from "@/hooks/use-ops-protected-read";
import { currentOpsAuthorityStamp } from "@/lib/ops-write-authority";
import { blockReadAccess } from "@/lib/query-read-access";
import { opsApiClient } from "@/lib/ops-api";
import { OpsApiError, friendlyOpsErrorMessage } from "@/lib/ops-errors";
import { ASSISTANT_GROUP, ASSISTANT_PERMISSIONS, assistantListPage, isTaskId, type AssistantFields, type AssistantTask,
  type AssistantCatalogs, type AssistantConfiguration, type AssistantTaskList } from "@/features/om-assistant/model";

const ENDPOINT = "/api/ops/assistant/tasks/";
function refreshBusinessViews(client: QueryClient) {
  // Match existing hooks without importing their mutation graphs into this feature.
  return Promise.all([
    ["ops-security-events"], ["ops-force-collections"], ["ops-force-collection"],
    ["ops-department-requests"], ["ops-department-request"], ["notifications"],
    ["ops-ratings", "notifications"], ["ops-notifications", "feed"],
  ].map(queryKey => client.invalidateQueries({ queryKey })));
}
export function useAssistantAccess(): OpsReadAccess {
  const base = useOpsReadAccess("event.create");
  const permissions = useOpsPermissions();
  const client = useQueryClient();
  return { ...base, allowed: !permissions.isLoading && !permissions.error &&
    currentOpsAuthorityStamp(client, base.actor) === base.scope && ASSISTANT_PERMISSIONS.some(code => permissions.hasPermission(code)) };
}
export function useAssistantTasks(page = 1) {
  const access = useAssistantAccess();
  const current = assistantListPage(String(page));
  return useOpsProtectedRead<AssistantTaskList>([ASSISTANT_GROUP, "tasks"], [current], access,
    () => opsApiClient.get(`${ENDPOINT}?page=${current}`), { poll: () => 30000 });
}
export function useAssistantTask(id: string | null) {
  const access = useAssistantAccess();
  return useOpsProtectedRead<AssistantTask>([ASSISTANT_GROUP, "task"], [id], access,
    () => opsApiClient.get(`${ENDPOINT}${id}/`), { enabled: isTaskId(id), poll: () => 30000 });
}
export function useAssistantConfiguration() {
  return useOpsProtectedRead<AssistantConfiguration>([ASSISTANT_GROUP, "configuration"], [], useAssistantAccess(),
    () => opsApiClient.get(`${ENDPOINT}configuration/`), { staleTime: 60000 });
}
export function useAssistantCatalogs() {
  return useOpsProtectedRead<AssistantCatalogs>([ASSISTANT_GROUP, "catalogs"], [], useAssistantAccess(),
    () => opsApiClient.get(`${ENDPOINT}catalogs/`), { staleTime: 60000 });
}
export interface AssistantWriteContext { access: OpsReadAccess; taskId: string | null; readKey?: QueryKey }
interface WriteSnapshot { pending: boolean; retryable: boolean; error: string | null }
interface Attempt { context: string; generation: number; endpoint: string; body: unknown; source?: QueryKey }
function contextKey(context: AssistantWriteContext) { return JSON.stringify([context.access.actor, context.access.scope, context.access.allowed, context.taskId]); }
function denied(): never { throw new OpsApiError({ status: 403, errorCode: "READ_AUTHORITY_UNAVAILABLE", message: "Обновите данные и права доступа перед продолжением.", details: {}, requestId: null }); }

// One attempt owns one immutable payload. A response lost in transit can be
// replayed safely; changing task/account/authority invalidates its UI result.
export function createAssistantWriter(options: {
  client: QueryClient; getContext: () => AssistantWriteContext; onSaved: (task: AssistantTask) => void;
  onChange: () => void; makeKey?: () => string;
}) {
  const { client, getContext, onSaved, onChange } = options;
  let generation = 0;
  let attempt: Attempt | null = null;
  let visibleContext = contextKey(getContext());
  let state: WriteSnapshot = { pending: false, retryable: false, error: null };
  const sync = () => {
    const key = contextKey(getContext());
    if (visibleContext !== key) { visibleContext = key; generation++; attempt = null; state = { pending: false, retryable: false, error: null }; }
    return key;
  };
  const publish = (next: WriteSnapshot) => { state = next; onChange(); };
  const authorize = (current: Attempt) => {
    const context = getContext();
    if (contextKey(context) !== current.context || current.generation !== generation || !hasCurrentOpsReadAuthority(client, context.access)) denied();
    if (current.source) assertOpsReadAuthority(client, context.access, ASSISTANT_GROUP, current.source);
  };
  async function execute(current: Attempt): Promise<AssistantTask | undefined> {
    publish({ pending: true, retryable: false, error: null });
    try {
      authorize(current);
      const result = await opsApiClient.post<AssistantTask>(current.endpoint, current.body, () => authorize(current));
      // Post-fetch verification is essential: a role can change while HTTP is in flight.
      authorize(current);
      client.setQueryData([ASSISTANT_GROUP, "task", getContext().access.scope, result.id], result);
      void client.invalidateQueries({ predicate: item => item.queryKey[0] === ASSISTANT_GROUP && item.queryKey[1] === "tasks" });
      void refreshBusinessViews(client);
      attempt = null;
      publish({ pending: false, retryable: false, error: null });
      onSaved(result);
      return result;
    } catch (error) {
      if (contextKey(getContext()) !== current.context || generation !== current.generation || !hasCurrentOpsReadAuthority(client, getContext().access)) return;
      const status = (error as { status?: number })?.status;
      if (status === 401 || status === 403 || status === 404) {
        for (const cached of client.getQueryCache().findAll({ predicate: item => item.queryKey[0] === ASSISTANT_GROUP && item.queryKey[2] === getContext().access.scope })) blockReadAccess(client, cached.queryKey, true);
      }
      // Network/5xx may have happened after saving. Never generate a new key on retry.
      const retryable = status === undefined || status >= 500;
      if (!retryable) attempt = null;
      publish({ pending: false, retryable, error: friendlyOpsErrorMessage(error, "Доступ к поручению закрыт. Обновите данные и права доступа.") });
    }
  }
  function fail(error: unknown) { publish({ pending: false, retryable: false, error: friendlyOpsErrorMessage(error, "Действие недоступно. Обновите данные и права доступа.") }); }
  return {
    snapshot(): WriteSnapshot { sync(); return state; },
    dispose() { generation++; attempt = null; },
    reset() { generation++; attempt = null; visibleContext = contextKey(getContext()); publish({ pending: false, retryable: false, error: null }); },
    async create(message: string, fields: AssistantFields = {}, interpret = true, reviewBeforeExecute = false) {
      const key = sync();
      if (state.pending) return;
      if (attempt) return execute(attempt);
      const current: Attempt = { context: key, generation, endpoint: ENDPOINT,
        body: { requestKey: (options.makeKey ?? (() => crypto.randomUUID()))(), message, fields: structuredClone(fields), interpret,
          ...(reviewBeforeExecute ? { reviewBeforeExecute: true } : {}) } };
      attempt = current;
      return execute(current);
    },
    async continueTask(fields?: AssistantFields, revision?: number) {
      const key = sync();
      if (state.pending) return;
      if (attempt) return execute(attempt);
      try {
        const context = getContext();
        if (!isTaskId(context.taskId) || !context.readKey) denied();
        assertOpsReadAuthority(client, context.access, ASSISTANT_GROUP, context.readKey);
        const task = client.getQueryData<AssistantTask>(context.readKey);
        if (!task || task.id !== context.taskId ||
          (fields === undefined ? task.canContinue !== true : !task.canEdit)) denied();
        if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) denied();
        const current: Attempt = { context: key, generation, endpoint: `${ENDPOINT}${context.taskId}/continue/`, source: context.readKey,
          body: fields === undefined ? {} : { fields: structuredClone(fields), revision: revision ?? task.revision } };
        attempt = current;
        return execute(current);
      } catch (error) { fail(error); }
    },
    async confirmTask(token: string, revision: number) {
      const key = sync();
      if (state.pending) return;
      if (attempt) return execute(attempt);
      try {
        const context = getContext();
        if (!isTaskId(context.taskId) || !context.readKey) denied();
        assertOpsReadAuthority(client, context.access, ASSISTANT_GROUP, context.readKey);
        const task = client.getQueryData<AssistantTask>(context.readKey);
        if (!task || task.id !== context.taskId || !task.reviewBeforeExecute || !task.confirmation?.canConfirm ||
          typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) || task.confirmation.token !== token ||
          !Number.isSafeInteger(revision) || revision < 1 || task.revision !== revision) denied();
        const current: Attempt = { context: key, generation, endpoint: `${ENDPOINT}${context.taskId}/continue/`, source: context.readKey,
          body: { confirmationToken: token, revision } };
        attempt = current;
        return execute(current);
      } catch (error) { fail(error); }
    },
    async retry() { sync(); if (!state.pending && attempt) return execute(attempt); },
  };
}

export function useAssistantWriter(context: AssistantWriteContext, onSaved: (task: AssistantTask) => void) {
  const client = useQueryClient();
  const latest = useRef({ context, onSaved }); latest.current = { context, onSaved };
  const [, rerender] = useState(0);
  const writer = useRef<ReturnType<typeof createAssistantWriter> | null>(null);
  if (!writer.current) writer.current = createAssistantWriter({ client, getContext: () => latest.current.context,
    onSaved: task => latest.current.onSaved(task), onChange: () => rerender(value => value + 1) });
  useEffect(() => () => writer.current?.dispose(), []);
  return { ...writer.current.snapshot(), create: writer.current.create, continueTask: writer.current.continueTask, confirmTask: writer.current.confirmTask,
    retry: writer.current.retry, reset: writer.current.reset };
}
