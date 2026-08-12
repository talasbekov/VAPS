"use client";

// «Боевые группы на Трассе» (§24) — нативный порт секции SPA: карточки смен с
// полным процессом §24.1 (потребность → подача → рассмотрение → ознакомление →
// заступление → сдача смены → факт) + замена до заступления (§24.21) +
// формирование новой потребности. Данные и ВСЕ решения — у мок-сервера:
// клиент не вычисляет ни READY, ни допустимость переходов, только рендерит и
// показывает 422-отказы как есть.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { opsApiClient } from "@/lib/ops-api";
import type { OpsApiFailure } from "@/lib/ops-errors";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import {
  COMBAT_DUTY_SHIFTS_PATH,
  COMBAT_DUTY_TYPES_PATH,
  COMBAT_ROSTER_CANDIDATES_PATH,
  COMBAT_ROUTES_PATH,
  COVERAGE_MODE_LABEL,
  EXECUTION_STATE_LABEL,
  SUBMISSION_STATE_LABEL,
  combatAcknowledgePath,
  combatCheckInPath,
  combatCompletePath,
  combatHandoverPath,
  combatReplacePath,
  combatReviewPath,
  combatSubmitPath,
} from "@/entities/combat-duty";
import type {
  AcknowledgeCombatDutyRequest,
  CombatDutyShift,
  CombatDutyTypeDefinition,
  CombatRosterCandidate,
  CompleteCombatDutyRequest,
  CreateCombatDutyShiftRequest,
  DutyRoute,
  DutyRouteCoverageMode,
  ListCombatDutyShiftsResponse,
  ListCombatDutyTypesResponse,
  ListCombatRosterCandidatesResponse,
  ListDutyRoutesResponse,
  RequestCombatDutyReplacementRequest,
  ReviewCombatGroupRequest,
  SubmitCombatDutyHandoverRequest,
  SubmitCombatGroupRequest,
} from "@/entities/combat-duty";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

const QUERY_ROOT = "ops-combat";

function failureText(error: OpsApiFailure): string {
  return error.message;
}

function dateTime(value: string | null): string {
  if (value === null) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

/** Одна точка инвалидации: любая мутация обновляет всё дерево смен. */
function useInvalidateCombat() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [QUERY_ROOT] });
  };
}

// ── Кнопки/поля в стиле host-порта ───────────────────────────────────────

function ActionButton({
  children,
  onClick,
  disabled = false,
  tone = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "outline" | "danger";
}) {
  const toneClass =
    tone === "primary"
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : tone === "danger"
        ? "border border-destructive/40 text-destructive hover:bg-destructive/10"
        : "border hover:bg-muted";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}

function ErrorLine({ error }: { error: OpsApiFailure | null }) {
  if (error === null) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {failureText(error)}
    </p>
  );
}

// ── Подача состава ───────────────────────────────────────────────────────

function SubmitForm({
  shift,
  candidates,
}: {
  shift: CombatDutyShift;
  candidates: CombatRosterCandidate[];
}) {
  const invalidate = useInvalidateCombat();
  const [leader, setLeader] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [reserve, setReserve] = useState<string[]>([]);
  const submitMutation = useOpsMutation<CombatDutyShift, SubmitCombatGroupRequest>({
    mutationFn: (body) =>
      opsApiClient.post<CombatDutyShift>(combatSubmitPath(shift.id), body),
    onSuccess: invalidate,
  });

  const toggle = (
    list: string[],
    setList: (next: string[]) => void,
    name: string
  ) => {
    setList(
      list.includes(name) ? list.filter((n) => n !== name) : [...list, name]
    );
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <h4 className="text-sm font-semibold">Подать состав группы</h4>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Старший группы</span>
        <select
          value={leader}
          onChange={(event) => setLeader(event.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">— не выбран —</option>
          {candidates.map((candidate) => (
            <option key={candidate.employeeName} value={candidate.employeeName}>
              {candidate.employeeName} ({candidate.unitName})
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="text-sm">
          <legend className="mb-1 text-muted-foreground">Основной состав</legend>
          {candidates.map((candidate) => (
            <label
              key={candidate.employeeName}
              className="flex items-center gap-2 py-0.5"
            >
              <input
                type="checkbox"
                checked={members.includes(candidate.employeeName)}
                onChange={() => toggle(members, setMembers, candidate.employeeName)}
              />
              {candidate.employeeName}
            </label>
          ))}
        </fieldset>
        <fieldset className="text-sm">
          <legend className="mb-1 text-muted-foreground">Резерв</legend>
          {candidates.map((candidate) => (
            <label
              key={candidate.employeeName}
              className="flex items-center gap-2 py-0.5"
            >
              <input
                type="checkbox"
                checked={reserve.includes(candidate.employeeName)}
                onChange={() => toggle(reserve, setReserve, candidate.employeeName)}
              />
              {candidate.employeeName}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="flex items-center gap-3">
        <ActionButton
          onClick={() =>
            submitMutation.mutate({
              groupLeaderEmployeeName: leader,
              memberEmployeeNames: members,
              reserveEmployeeNames: reserve,
            })
          }
          disabled={submitMutation.isPending}
        >
          Подать состав
        </ActionButton>
        <ErrorLine error={submitMutation.error} />
      </div>
    </div>
  );
}

// ── Рассмотрение ─────────────────────────────────────────────────────────

function ReviewControls({ shift }: { shift: CombatDutyShift }) {
  const invalidate = useInvalidateCombat();
  const [returnReason, setReturnReason] = useState("");
  const reviewMutation = useOpsMutation<CombatDutyShift, ReviewCombatGroupRequest>({
    mutationFn: (body) =>
      opsApiClient.post<CombatDutyShift>(combatReviewPath(shift.id), body),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <h4 className="text-sm font-semibold">Рассмотрение состава</h4>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton
          onClick={() =>
            reviewMutation.mutate({ decision: "ACCEPT", returnReason: null })
          }
          disabled={reviewMutation.isPending}
        >
          Принять
        </ActionButton>
        <input
          value={returnReason}
          onChange={(event) => setReturnReason(event.target.value)}
          placeholder="Причина возврата"
          className="min-w-48 flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
        />
        <ActionButton
          tone="danger"
          onClick={() =>
            reviewMutation.mutate({ decision: "RETURN", returnReason })
          }
          disabled={reviewMutation.isPending}
        >
          Вернуть
        </ActionButton>
      </div>
      <ErrorLine error={reviewMutation.error} />
    </div>
  );
}

// ── Замена до заступления (§24.21) ───────────────────────────────────────

function ReplaceControls({
  shift,
  candidates,
}: {
  shift: CombatDutyShift;
  candidates: CombatRosterCandidate[];
}) {
  const invalidate = useInvalidateCombat();
  const submission = shift.submission;
  const roster = useMemo(
    () =>
      submission === null
        ? []
        : [submission.groupLeaderEmployeeName, ...submission.memberEmployeeNames],
    [submission]
  );
  const [outgoing, setOutgoing] = useState("");
  const [incoming, setIncoming] = useState("");
  const [reason, setReason] = useState("");
  const replaceMutation = useOpsMutation<
    CombatDutyShift,
    RequestCombatDutyReplacementRequest
  >({
    mutationFn: (body) =>
      opsApiClient.post<CombatDutyShift>(combatReplacePath(shift.id), body),
    onSuccess: invalidate,
  });

  const outside = candidates.filter(
    (candidate) => !roster.includes(candidate.employeeName)
  );

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <h4 className="text-sm font-semibold">Замена участника (до заступления)</h4>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select
          value={outgoing}
          onChange={(event) => setOutgoing(event.target.value)}
          className="rounded-md border bg-background px-2 py-1.5"
          aria-label="Кого заменить"
        >
          <option value="">— кого —</option>
          {roster.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span aria-hidden>→</span>
        <select
          value={incoming}
          onChange={(event) => setIncoming(event.target.value)}
          className="rounded-md border bg-background px-2 py-1.5"
          aria-label="На кого заменить"
        >
          <option value="">— на кого —</option>
          {outside.map((candidate) => (
            <option key={candidate.employeeName} value={candidate.employeeName}>
              {candidate.employeeName}
            </option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Причина замены"
          className="min-w-40 flex-1 rounded-md border bg-background px-2 py-1.5"
        />
        <ActionButton
          tone="outline"
          onClick={() =>
            replaceMutation.mutate({
              outgoingEmployeeName: outgoing,
              incomingEmployeeName: incoming,
              reasonCode: reason,
              safeComment: null,
            })
          }
          disabled={replaceMutation.isPending}
        >
          Заменить
        </ActionButton>
      </div>
      <ErrorLine error={replaceMutation.error} />
    </div>
  );
}

// ── Сдача смены (§24.22, checkpoint) ─────────────────────────────────────

function HandoverForm({ shift }: { shift: CombatDutyShift }) {
  const invalidate = useInvalidateCombat();
  const submission = shift.submission;
  const roster =
    submission === null
      ? []
      : [submission.groupLeaderEmployeeName, ...submission.memberEmployeeNames];
  const [unresolvedIncidents, setUnresolvedIncidents] = useState("");
  const [remarks, setRemarks] = useState("");
  const [confirmedBy, setConfirmedBy] = useState("");
  const handoverMutation = useOpsMutation<
    CombatDutyShift,
    SubmitCombatDutyHandoverRequest
  >({
    mutationFn: (body) =>
      opsApiClient.post<CombatDutyShift>(combatHandoverPath(shift.id), body),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <h4 className="text-sm font-semibold">Сдача смены</h4>
      <p className="text-xs text-muted-foreground">
        Обязательна перед завершением дежурства. Пустое поле происшествий —
        явное «незакрытых происшествий нет».
      </p>
      <input
        value={unresolvedIncidents}
        onChange={(event) => setUnresolvedIncidents(event.target.value)}
        placeholder="Незакрытые происшествия (пусто = нет)"
        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
      <input
        value={remarks}
        onChange={(event) => setRemarks(event.target.value)}
        placeholder="Замечания по смене"
        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={confirmedBy}
          onChange={(event) => setConfirmedBy(event.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          aria-label="Кто сдаёт смену"
        >
          <option value="">— кто сдаёт —</option>
          {roster.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <ActionButton
          onClick={() =>
            handoverMutation.mutate({
              unresolvedIncidents,
              remarks,
              confirmedByEmployeeName: confirmedBy,
            })
          }
          disabled={handoverMutation.isPending}
        >
          Оформить сдачу
        </ActionButton>
      </div>
      <ErrorLine error={handoverMutation.error} />
    </div>
  );
}

// ── Исполнение после принятия ────────────────────────────────────────────

function ExecutionControls({
  shift,
  candidates,
}: {
  shift: CombatDutyShift;
  candidates: CombatRosterCandidate[];
}) {
  const invalidate = useInvalidateCombat();
  const submission = shift.submission;
  const execution = submission?.execution ?? null;
  const [actualMembers, setActualMembers] = useState<string[]>([]);

  const acknowledgeMutation = useOpsMutation<
    CombatDutyShift,
    AcknowledgeCombatDutyRequest
  >({
    mutationFn: (body) =>
      opsApiClient.post<CombatDutyShift>(combatAcknowledgePath(shift.id), body),
    onSuccess: invalidate,
  });
  const checkInMutation = useOpsMutation<CombatDutyShift, Record<string, never>>({
    mutationFn: () =>
      opsApiClient.post<CombatDutyShift>(combatCheckInPath(shift.id), {}),
    onSuccess: invalidate,
  });
  const completeMutation = useOpsMutation<
    CombatDutyShift,
    CompleteCombatDutyRequest
  >({
    mutationFn: (body) =>
      opsApiClient.post<CombatDutyShift>(combatCompletePath(shift.id), body),
    onSuccess: invalidate,
  });

  if (submission === null || execution === null) return null;
  const requiredNames = [
    submission.groupLeaderEmployeeName,
    ...submission.memberEmployeeNames,
  ];

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Состояние несения:{" "}
        <span className="font-semibold">
          {EXECUTION_STATE_LABEL[execution.stateCode]}
        </span>
      </p>

      {execution.stateCode === "PENDING_ACKNOWLEDGEMENT" ||
      execution.stateCode === "READY" ? (
        <>
          <ul className="space-y-1 text-sm">
            {requiredNames.map((name) => {
              const acknowledged =
                execution.acknowledgedMemberNames.includes(name);
              return (
                <li key={name} className="flex items-center gap-2">
                  <span className="min-w-32">{name}</span>
                  {acknowledged ? (
                    <span className="text-xs text-muted-foreground">
                      Ознакомлен
                    </span>
                  ) : (
                    <ActionButton
                      tone="outline"
                      onClick={() =>
                        acknowledgeMutation.mutate({ employeeName: name })
                      }
                      disabled={acknowledgeMutation.isPending}
                    >
                      Отметить ознакомление
                    </ActionButton>
                  )}
                </li>
              );
            })}
          </ul>
          <ErrorLine error={acknowledgeMutation.error} />
          <ReplaceControls shift={shift} candidates={candidates} />
          {execution.stateCode === "READY" ? (
            <div className="flex items-center gap-3">
              <ActionButton
                onClick={() => checkInMutation.mutate({})}
                disabled={checkInMutation.isPending}
              >
                Заступить
              </ActionButton>
              <ErrorLine error={checkInMutation.error} />
            </div>
          ) : null}
        </>
      ) : null}

      {execution.stateCode === "ACTIVE" ? (
        <>
          <p className="text-sm text-muted-foreground">
            Заступили: {dateTime(execution.actualStart)}
          </p>
          {execution.handover === null ? (
            <HandoverForm shift={shift} />
          ) : (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-semibold">Смена сдана</p>
              <p>
                Сдал: {execution.handover.confirmedByEmployeeName} (
                {dateTime(execution.handover.confirmedAt)})
              </p>
              <p>
                Происшествия:{" "}
                {execution.handover.unresolvedIncidents.trim() === ""
                  ? "нет незакрытых"
                  : execution.handover.unresolvedIncidents}
              </p>
              {execution.handover.remarks.trim() !== "" ? (
                <p>Замечания: {execution.handover.remarks}</p>
              ) : null}
            </div>
          )}
          <fieldset className="text-sm">
            <legend className="mb-1 text-muted-foreground">
              Фактический состав (§24.23 — задаётся при завершении)
            </legend>
            {requiredNames.map((name) => (
              <label key={name} className="flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={actualMembers.includes(name)}
                  onChange={() =>
                    setActualMembers(
                      actualMembers.includes(name)
                        ? actualMembers.filter((n) => n !== name)
                        : [...actualMembers, name]
                    )
                  }
                />
                {name}
              </label>
            ))}
          </fieldset>
          <div className="flex items-center gap-3">
            <ActionButton
              onClick={() =>
                completeMutation.mutate({ actualMemberNames: actualMembers })
              }
              disabled={
                completeMutation.isPending || execution.handover === null
              }
            >
              Завершить дежурство
            </ActionButton>
            <ErrorLine error={completeMutation.error} />
          </div>
        </>
      ) : null}

      {execution.stateCode === "COMPLETED" ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-semibold">Дежурство завершено</p>
          <p>
            {dateTime(execution.actualStart)} — {dateTime(execution.actualEnd)}
          </p>
          <p>
            Фактически несли службу:{" "}
            {(execution.actualMemberNames ?? []).join(", ") || "—"}
          </p>
        </div>
      ) : null}

      {submission.replacements.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">История замен</p>
          <ul>
            {submission.replacements.map((record) => (
              <li key={record.replacementId}>
                {record.outgoingEmployeeName} → {record.incomingEmployeeName} (
                {record.reasonCode}, {dateTime(record.appliedAt)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ── Карточка смены ───────────────────────────────────────────────────────

function CombatShiftCard({
  shift,
  dutyTypes,
  routes,
  candidates,
}: {
  shift: CombatDutyShift;
  dutyTypes: CombatDutyTypeDefinition[];
  routes: DutyRoute[];
  candidates: CombatRosterCandidate[];
}) {
  const dutyTypeLabel =
    dutyTypes.find((t) => t.dutyTypeCode === shift.dutyTypeCode)?.safeLabel ??
    shift.dutyTypeCode;
  const routeLabels = shift.routeSet.routeIds.map(
    (routeId) => routes.find((r) => r.routeId === routeId)?.safeLabel ?? routeId
  );
  const submission = shift.submission;

  return (
    <article className="space-y-3 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">{shift.routeSet.safeLabel}</h3>
          <p className="text-sm text-muted-foreground">
            {dutyTypeLabel} · {shift.businessDate} · покрытие:{" "}
            {COVERAGE_MODE_LABEL[shift.routeSet.coverageMode]}
          </p>
          <p className="text-xs text-muted-foreground">
            Трассы: {routeLabels.join("; ")}
            {shift.requiredEmployees !== null
              ? ` · требуется сотрудников: ${shift.requiredEmployees}`
              : ""}
          </p>
        </div>
        <span className="rounded-full border px-3 py-1 text-xs font-medium">
          {submission === null
            ? "Требует подачи"
            : SUBMISSION_STATE_LABEL[submission.stateCode]}
        </span>
      </header>

      {submission !== null ? (
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Подано подразделением</dt>
            <dd>{submission.submittedByUnitName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Старший группы</dt>
            <dd>{submission.groupLeaderEmployeeName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Основной состав</dt>
            <dd>{submission.memberEmployeeNames.join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Резерв</dt>
            <dd>{submission.reserveEmployeeNames.join(", ") || "—"}</dd>
          </div>
          {submission.stateCode === "RETURNED" &&
          submission.returnReason !== null ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Причина возврата</dt>
              <dd className="text-destructive">{submission.returnReason}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {submission !== null && submission.stateCode === "SUBMITTED" ? (
        <ReviewControls shift={shift} />
      ) : null}

      {submission !== null && submission.stateCode === "ACCEPTED" ? (
        <ExecutionControls shift={shift} candidates={candidates} />
      ) : null}

      {submission === null || submission.stateCode === "RETURNED" ? (
        <SubmitForm shift={shift} candidates={candidates} />
      ) : null}
    </article>
  );
}

// ── Формирование потребности (§24.1) ─────────────────────────────────────

function CreateRequirementSection({
  dutyTypes,
  routes,
}: {
  dutyTypes: CombatDutyTypeDefinition[];
  routes: DutyRoute[];
}) {
  const invalidate = useInvalidateCombat();
  const [businessDate, setBusinessDate] = useState("");
  const [dutyTypeCode, setDutyTypeCode] = useState(
    dutyTypes[0]?.dutyTypeCode ?? ""
  );
  const [coverageMode, setCoverageMode] =
    useState<DutyRouteCoverageMode>("RESERVE");
  const [requiredEmployees, setRequiredEmployees] = useState(2);
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const createMutation = useOpsMutation<
    CombatDutyShift,
    CreateCombatDutyShiftRequest
  >({
    mutationFn: (body) =>
      opsApiClient.post<CombatDutyShift>(COMBAT_DUTY_SHIFTS_PATH, body),
    onSuccess: invalidate,
  });

  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4"
      aria-label="Новая потребность"
    >
      <h2 className="text-base font-semibold">
        Сформировать потребность в боевой группе
      </h2>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-muted-foreground">Дата</span>
          <input
            type="date"
            value={businessDate}
            onChange={(event) => setBusinessDate(event.target.value)}
            className="rounded-md border bg-background px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-muted-foreground">Вид дежурства</span>
          <select
            value={dutyTypeCode}
            onChange={(event) => setDutyTypeCode(event.target.value)}
            className="rounded-md border bg-background px-2 py-1.5"
          >
            {dutyTypes.map((dutyType) => (
              <option key={dutyType.dutyTypeCode} value={dutyType.dutyTypeCode}>
                {dutyType.safeLabel}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-muted-foreground">Покрытие</span>
          <select
            value={coverageMode}
            onChange={(event) =>
              setCoverageMode(event.target.value as DutyRouteCoverageMode)
            }
            className="rounded-md border bg-background px-2 py-1.5"
          >
            {(
              Object.keys(COVERAGE_MODE_LABEL) as DutyRouteCoverageMode[]
            ).map((mode) => (
              <option key={mode} value={mode}>
                {COVERAGE_MODE_LABEL[mode]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-muted-foreground">
            Требуется сотрудников
          </span>
          <input
            type="number"
            min={1}
            value={requiredEmployees}
            onChange={(event) =>
              setRequiredEmployees(Number(event.target.value))
            }
            className="w-24 rounded-md border bg-background px-2 py-1.5"
          />
        </label>
      </div>
      <fieldset className="text-sm">
        <legend className="mb-1 text-muted-foreground">Трассы</legend>
        <div className="flex flex-wrap gap-4">
          {routes.map((route) => (
            <label key={route.routeId} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={routeIds.includes(route.routeId)}
                onChange={() =>
                  setRouteIds(
                    routeIds.includes(route.routeId)
                      ? routeIds.filter((id) => id !== route.routeId)
                      : [...routeIds, route.routeId]
                  )
                }
              />
              {route.safeLabel}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <ActionButton
          onClick={() =>
            createMutation.mutate({
              businessDate,
              dutyTypeCode,
              routeIds,
              coverageMode,
              requiredEmployees,
            })
          }
          disabled={createMutation.isPending}
        >
          Создать потребность
        </ActionButton>
        <ErrorLine error={createMutation.error} />
      </div>
    </section>
  );
}

// ── Секция целиком ───────────────────────────────────────────────────────

export function CombatDutyGroupsSection() {
  const { hasPermission } = useOpsPermissions();
  const dutyTypesQuery = useQuery<ListCombatDutyTypesResponse, OpsApiFailure>({
    queryKey: [QUERY_ROOT, "duty-types"],
    queryFn: () =>
      opsApiClient.get<ListCombatDutyTypesResponse>(COMBAT_DUTY_TYPES_PATH),
  });
  const routesQuery = useQuery<ListDutyRoutesResponse, OpsApiFailure>({
    queryKey: [QUERY_ROOT, "routes"],
    queryFn: () => opsApiClient.get<ListDutyRoutesResponse>(COMBAT_ROUTES_PATH),
  });
  // Кандидаты в состав — единственная ручка секции под `duty.manage`, а не
  // `duty.view` (бэк: «просмотр — часть подачи §24.6, потому право управления»).
  // Без этого условия читатель с `duty.view` получал 403 на кандидатах,
  // `firstError` съедал ВСЮ секцию, и вместо смен, которые он смотреть вправе,
  // показывалась общая ошибка загрузки. Не запрашиваем то, на что нет права:
  // отказ не наступает, остальная секция работает, а органы управления
  // остаются без кандидатов — действовать он всё равно не может.
  const canManageRoster = hasPermission("duty.manage");
  const candidatesQuery = useQuery<
    ListCombatRosterCandidatesResponse,
    OpsApiFailure
  >({
    queryKey: [QUERY_ROOT, "candidates"],
    queryFn: () =>
      opsApiClient.get<ListCombatRosterCandidatesResponse>(
        COMBAT_ROSTER_CANDIDATES_PATH
      ),
    enabled: canManageRoster,
  });
  const shiftsQuery = useQuery<ListCombatDutyShiftsResponse, OpsApiFailure>({
    queryKey: [QUERY_ROOT, "shifts"],
    queryFn: () =>
      opsApiClient.get<ListCombatDutyShiftsResponse>(COMBAT_DUTY_SHIFTS_PATH),
  });

  if (
    dutyTypesQuery.isLoading ||
    routesQuery.isLoading ||
    candidatesQuery.isLoading ||
    shiftsQuery.isLoading
  ) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Загрузка боевых групп…
      </p>
    );
  }
  const firstError =
    dutyTypesQuery.error ??
    routesQuery.error ??
    candidatesQuery.error ??
    shiftsQuery.error;
  if (firstError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Не удалось загрузить боевые группы: {failureText(firstError)}
      </p>
    );
  }

  const dutyTypes = dutyTypesQuery.data?.results ?? [];
  const routes = routesQuery.data?.results ?? [];
  const candidates = candidatesQuery.data?.results ?? [];
  const shifts = shiftsQuery.data?.results ?? [];

  return (
    <div className="space-y-4">
      <CreateRequirementSection dutyTypes={dutyTypes} routes={routes} />
      {shifts.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Смен боевых групп нет.
        </p>
      ) : (
        shifts.map((shift) => (
          <CombatShiftCard
            key={shift.id}
            shift={shift}
            dutyTypes={dutyTypes}
            routes={routes}
            candidates={candidates}
          />
        ))
      )}
    </div>
  );
}
