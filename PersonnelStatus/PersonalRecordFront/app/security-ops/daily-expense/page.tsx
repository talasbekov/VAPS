"use client";

// «Расход дня» — экран массового обновления статусов: грид слепого ввода →
// bulk-дельты → сдача дня отдельным осознанным действием. Ритуал ДВУХФАЗНЫЙ:
// «Сохранить правки» шлёт дельты статусов, канон-кнопка «Сдать день» живёт в
// панели сдачи — две одинаковые надписи означали бы, что одна из них лжёт.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/dashboard-layout";
import { CalendarCheck } from "lucide-react";
import { opsApiClient } from "@/lib/ops-api";
import { useOpsMutation } from "@/hooks/use-ops-mutation";
import { DailyGrid } from "@/features/ops-daily/daily-grid";
import {
  DaySubmissionPanel,
  type DriftEntry,
} from "@/features/ops-daily/day-submission-panel";
import {
  DAILY_BULK_PATH,
  DAILY_DIVISIONS_PATH,
  DAILY_EMPLOYEES_PATH,
  DAILY_SUBMISSIONS_PATH,
  STATUS_TYPE_OPTIONS,
  addDaysIso,
  buildPrefilledRows,
  currentSubmission,
  describeBulkFailure,
  parseBulkRowErrors,
  parseSubmissionList,
  parseValidationDetails,
  toBulkRequest,
  todayLocalIso,
} from "@/entities/daily-grid";
import type {
  BulkResponse,
  BulkStatusRequest,
  EmployeeSeed,
  RowChange,
  YesterdayPlacement,
} from "@/entities/daily-grid";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

const GRID_SUBMIT_LABEL = "Сохранить правки";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const NO_EMPLOYEES: EmployeeSeed[] = [];

interface DivisionsResponse {
  results: { id: string; name: string }[];
}

interface EmployeesResponse {
  results: { id: string; full_name: string; rank_code: string }[];
}

/** Отложенная смена контрола, ждущая подтверждения. */
type PendingChange =
  | { kind: "date"; value: string }
  | { kind: "division"; value: string | null };

export default function DailyExpensePage() {
  const { hasPermission, isLoading: permissionsLoading } = useOpsPermissions();
  const [divisionId, setDivisionId] = useState<string | null>(null);
  const [businessDate, setBusinessDate] = useState<string>(todayLocalIso);
  // Базовая линия дня: применённые строки вливаются сюда по факту 201.
  const [yesterday, setYesterday] = useState<YesterdayPlacement>({});
  const [dirtyCount, setDirtyCount] = useState(0);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  /** Правки, отправленные уже ПОСЛЕ сдачи дня, — локальное расхождение. */
  const [localDrift, setLocalDrift] = useState<DriftEntry[]>([]);

  const rootRef = useRef<HTMLDivElement>(null);

  const divisionsQuery = useQuery({
    queryKey: ["ops-daily", "divisions"],
    queryFn: () => opsApiClient.get<DivisionsResponse>(DAILY_DIVISIONS_PATH),
  });

  const employeesQuery = useQuery({
    queryKey: ["ops-daily", "employees", divisionId],
    queryFn: async () => {
      const page = await opsApiClient.get<EmployeesResponse>(
        `${DAILY_EMPLOYEES_PATH}?division_id=${encodeURIComponent(divisionId as string)}`
      );
      // snake_case → EmployeeSeed руками: умного конвертера нет и не должно быть.
      return page.results.map((employee) => ({
        id: employee.id,
        fullName: employee.full_name,
        rank: employee.rank_code,
      }));
    },
    enabled: divisionId !== null,
  });

  // Ссылка стабильна между рендерами: новый литерал дал бы RESYNC грида.
  const employees = useMemo(
    () => employeesQuery.data ?? NO_EMPLOYEES,
    [employeesQuery.data]
  );

  const nameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const employee of employees) map[employee.id] = employee.fullName;
    return map;
  }, [employees]);

  const dateInvalid = !ISO_DATE_RE.test(businessDate);

  /** Состояние дня. Владелец запроса — ЭКРАН: оно нужно и панели (рендер), и
   * экрану (писать ли localDrift). */
  const daySubmissionQuery = useQuery({
    queryKey: ["ops-daily", "day-submission", divisionId, businessDate],
    queryFn: () =>
      opsApiClient.get<unknown>(
        `${DAILY_SUBMISSIONS_PATH}?division_id=${encodeURIComponent(
          divisionId as string
        )}&business_date=${encodeURIComponent(businessDate)}`
      ),
    enabled: divisionId !== null && !dateInvalid,
  });

  const daySubmissions = useMemo(
    () => parseSubmissionList(daySubmissionQuery.data),
    [daySubmissionQuery.data]
  );

  // «День сдан» решает ФЛАГ is_current, а не results.length.
  const daySubmission = useMemo(
    () => currentSubmission(daySubmissions),
    [daySubmissions]
  );

  const mutation = useOpsMutation<BulkResponse, BulkStatusRequest>({
    mutationFn: (variables) =>
      opsApiClient.post<BulkResponse>(DAILY_BULK_PATH, variables),
    onSuccess: (data, variables) => {
      // Счётчик — ИЗ ТЕЛА ОТВЕТА, не из локальной длины дельт.
      setAppliedCount(data.created);
      // Маркер расхождения — только если день уже сдан; накапливаем.
      if (daySubmission !== null) {
        setLocalDrift((prev) => {
          const byEmployee = new Map(prev.map((entry) => [entry.employeeId, entry]));
          for (const row of variables.rows) {
            byEmployee.set(row.employee_id, {
              employeeId: row.employee_id,
              fullName: nameById[row.employee_id] ?? row.employee_id,
              statusLabel:
                STATUS_TYPE_OPTIONS.find(
                  (option) => option.code === row.status_type_code
                )?.label ?? row.status_type_code,
            });
          }
          return Array.from(byEmployee.values());
        });
      }
      // База сдвигается по ФАКТУ 201: применённые строки вливаются в baseline,
      // введённые значения остаются, счётчик грида уходит в 0.
      setYesterday((prev) => {
        const next: YesterdayPlacement = { ...prev };
        for (const row of variables.rows) {
          next[row.employee_id] = {
            statusCode: row.status_type_code,
            // Обратный маппинг полуинтервала [start, end) → «по … включительно».
            period:
              row.date_end === addDaysIso(variables.business_date, 1)
                ? undefined
                : addDaysIso(row.date_end, -1),
          };
        }
        return next;
      });
    },
  });

  const { conflict, dismissConflict, error: mutationError, isPending, mutate } =
    mutation;

  // Агрегат bulk не оверрайдаем, но STATUS_OVERLAP_WARNING входит в
  // OVERRIDABLE_CODES хоста и use-ops-mutation поднимает conflict-стейт.
  // Гасим сразу: ConflictDialog экран не рендерит.
  useEffect(() => {
    if (conflict !== null) dismissConflict();
  }, [conflict, dismissConflict]);

  const handleDirtyChange = useCallback((changedCount: number) => {
    setDirtyCount(changedCount);
  }, []);

  // Защита ввода при закрытии вкладки.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount]);

  const handleGridSubmit = useCallback(
    (changes: RowChange[]) => {
      // Ноль отклонений — штатный день: bulk-вызова нет.
      if (changes.length === 0) return;
      // Одна отправка за раз: двойной клик = ровно один POST.
      if (isPending) return;
      if (!ISO_DATE_RE.test(businessDate)) return;
      setAppliedCount(null);
      mutate(toBulkRequest(changes, businessDate));
    },
    [businessDate, isPending, mutate]
  );

  const applyChange = useCallback((change: PendingChange) => {
    if (change.kind === "date") setBusinessDate(change.value);
    else setDivisionId(change.value);
    setAppliedCount(null);
    setPending(null);
    // Подтверждённая смена уничтожает дельты по определению; drift принадлежит
    // конкретному дню и подразделению.
    setDirtyCount(0);
    setLocalDrift([]);
    setYesterday({});
  }, []);

  // Смена даты ремаунтит грид, смена подразделения меняет состав — и то и
  // другое уничтожает несохранённые дельты: явное подтверждение.
  const requestChange = useCallback(
    (change: PendingChange) => {
      if (dirtyCount > 0) {
        setPending(change);
        return;
      }
      applyChange(change);
    },
    [applyChange, dirtyCount]
  );

  /** Ctrl+Enter — сохранить правки с клавиатуры. CAPTURE-фаза: иначе Enter
   * сначала отработал бы грамматикой грида. Сдача шортката не получает:
   * «сдача — осознанное действие». */
  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" || !event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const button = Array.from(
        rootRef.current?.querySelectorAll("button") ?? []
      ).find((candidate) => candidate.textContent?.trim() === GRID_SUBMIT_LABEL);
      button?.click();
    },
    []
  );

  const failure = mutationError === null ? null : describeBulkFailure(mutationError);
  const rowErrors = mutationError === null ? [] : parseBulkRowErrors(mutationError);
  const validationDetails =
    failure?.kind === "validation" ? parseValidationDetails(mutationError) : [];
  // 422 — hard (красный), 409 — soft (жёлтый). Цвет никогда не единственный
  // сигнал: текстовая метка обязательна.
  const hardFailure =
    mutationError !== null &&
    mutationError.kind !== "network" &&
    mutationError.status === 422;

  const divisions = divisionsQuery.data?.results ?? [];

  const rows = useMemo(
    () => buildPrefilledRows(employees, yesterday),
    [employees, yesterday]
  );

  if (!permissionsLoading && !hasPermission("status.view")) {
    return <OpsAccessDenied what="расхода дня" />;
  }

  return (
    <DashboardLayout>
      <div
        ref={rootRef}
        onKeyDownCapture={handleKeyDownCapture}
        className="space-y-4"
      >
        <div className="flex items-center gap-3">
          <CalendarCheck className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Расход дня</h1>
            <p className="text-muted-foreground">
              Правьте отклонения и сохраняйте их одной отправкой, затем сдайте
              день. Ctrl+Enter — сохранить правки с клавиатуры.
            </p>
          </div>
        </div>

        <section className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Подразделение
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm font-normal"
                value={divisionId ?? ""}
                disabled={divisionsQuery.isPending || divisionsQuery.isError}
                onChange={(event) =>
                  requestChange({
                    kind: "division",
                    value: event.target.value === "" ? null : event.target.value,
                  })
                }
              >
                {/* Автовыбор первого НЕ делаем: молчаливый выбор чужого
                    подразделения дал бы отказ на отправке без объяснения. */}
                <option value="">— выберите —</option>
                {divisions.map((division) => (
                  <option key={division.id} value={division.id}>
                    {division.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold">
              Дата
              <input
                type="date"
                className="w-44 rounded-md border bg-background p-2 text-sm font-normal"
                value={businessDate}
                onChange={(event) =>
                  requestChange({ kind: "date", value: event.target.value })
                }
              />
            </label>
          </div>

          {divisionsQuery.isPending && (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              Загрузка подразделений…
            </p>
          )}
          {divisionsQuery.isError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              Не удалось загрузить список подразделений.
            </p>
          )}

          {pending !== null && (
            <div
              role="alert"
              className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-amber-100 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <span>
                Изменено {dirtyCount} из {employees.length}.{" "}
                {pending.kind === "date" ? "Сменить дату?" : "Сменить подразделение?"}{" "}
                Правки будут потеряны.
              </span>
              <button
                type="button"
                onClick={() => applyChange(pending)}
                className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground"
              >
                {pending.kind === "date" ? "Сменить дату" : "Сменить подразделение"}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded border px-3 py-1 text-sm"
              >
                Отмена
              </button>
            </div>
          )}

          {dateInvalid && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              Укажите дату в формате ГГГГ-ММ-ДД — без неё день сдать нельзя.
            </p>
          )}

          {divisionId !== null && (
            // Честная плашка: реального преднабора «вчера» нет — базовая линия
            // сдвигается по факту сохранённых правок этого экрана.
            <p className="mt-2 text-sm text-muted-foreground">
              Преднабор со вчера недоступен: строки заполнены значением «В
              строю»; сохранённые правки сдвигают базовую линию.
            </p>
          )}

          {isPending && (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              Отправка…
            </p>
          )}

          {appliedCount !== null && (
            <p role="status" className="mt-2 text-sm">
              Применено {appliedCount} отклонений
            </p>
          )}
        </section>

        {/* Панель сдачи — над гридом. Ремаунт по key на смене контекста
            снимает ответ прошлой сдачи, подтверждение и ошибку разом. */}
        <DaySubmissionPanel
          key={`${divisionId ?? "none"}-${businessDate}`}
          divisionId={divisionId}
          businessDate={businessDate}
          dateValid={!dateInvalid}
          rowCount={employees.length}
          dirtyCount={dirtyCount}
          localDrift={localDrift}
          submission={daySubmission}
          submissions={daySubmissions}
          isLoading={
            daySubmissionQuery.isPending && divisionId !== null && !dateInvalid
          }
          isError={daySubmissionQuery.isError}
        />

        {failure !== null && failure.kind === "permission" && (
          <p
            role="alert"
            className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200"
          >
            {failure.message}
          </p>
        )}

        {failure !== null && failure.kind === "validation" && (
          <div
            role="alert"
            className="rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200"
          >
            <p className="font-medium">Нельзя: {failure.message}</p>
            <ul className="mt-1 list-disc pl-5">
              {validationDetails.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {failure !== null && failure.kind === "rows" && (
          <div
            role="alert"
            className={
              hardFailure
                ? "rounded-md bg-red-100 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200"
                : "rounded-md bg-amber-100 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
            }
          >
            {/* Сервис атомарен: при любой отклонённой строке в БД 0 записей. */}
            <p className="font-medium">
              {hardFailure ? "Нельзя" : "Конфликт"}: {failure.message} Ничего не
              сохранено, значения на экране можно поправить и отправить снова.
            </p>
            <ul className="mt-1 list-disc pl-5">
              {rowErrors.map((rowError) => (
                <li key={`${rowError.index}-${rowError.employeeId}`}>
                  Строка {rowError.index + 1} ·{" "}
                  {nameById[rowError.employeeId] ?? rowError.employeeId} ·{" "}
                  {rowError.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {divisionId === null ? (
          <section className="rounded-xl border bg-card p-6">
            <p role="status" className="text-sm text-muted-foreground">
              Выберите подразделение
            </p>
          </section>
        ) : employeesQuery.isPending ? (
          <section className="rounded-xl border bg-card p-6">
            <p role="status" className="text-sm text-muted-foreground">
              Загрузка личного состава…
            </p>
          </section>
        ) : employeesQuery.isError ? (
          <section className="rounded-xl border bg-card p-6">
            <p role="alert" className="text-sm text-destructive">
              Не удалось загрузить личный состав.
            </p>
          </section>
        ) : dateInvalid ? (
          // Грид не монтируется при негодной дате: toBulkRequest на пустой
          // дате упал бы RangeError.
          <section className="rounded-xl border bg-card p-6">
            <p role="status" className="text-sm text-muted-foreground">
              Грид появится, когда будет указана дата дня.
            </p>
          </section>
        ) : (
          <DailyGrid
            // Правки принадлежат дню: смена даты ремаунтит грид.
            key={businessDate}
            rows={rows}
            statusOptions={STATUS_TYPE_OPTIONS}
            onSubmit={handleGridSubmit}
            onDirtyChange={handleDirtyChange}
            submitLabel={GRID_SUBMIT_LABEL}
            submitting={isPending}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
