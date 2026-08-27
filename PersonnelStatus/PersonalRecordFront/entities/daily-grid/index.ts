// «Расход дня» (Daily Grid) — нативный порт донорского экрана массового
// обновления Smart Josparlau: каталог статус-типов, клавиатурная грамматика
// грида слепого ввода (чистая state machine), prefill и bulk-дельты, контракт
// сдачи дня и исправлений, мапперы отказов.
import type { OpsApiFailure } from "@/lib/ops-errors";
import type { TrafficLightNode } from "@/lib/api";

// ── Каталог статус-типов (зеркало seed-каталога бэка, 18 типов) ──────────
//
// 18, а не 17, с 28.08.2026: участие в ОМ делится на боевую группу и
// физический наряд (сценарий заказчика, Plane №243). Обе строки отчитываются
// в колонку «В строю» — человек на мероприятии из строя не выбывает, — а
// различает их справочный счётчик расхода.

export interface StatusOption {
  code: string;
  label: string;
}

export const STATUS_TYPE_OPTIONS: StatusOption[] = [
  { code: "SICK_LEAVE", label: "На больничном" },
  { code: "LEAVE_BY_REPORT", label: "Отпуск по рапорту" },
  { code: "VACATION", label: "В отпуске" },
  { code: "COMMAND", label: "В командировке" },
  { code: "STUDY", label: "Учёба" },
  { code: "COMPETITION", label: "Соревнования" },
  { code: "CONFERENCE", label: "Конференция" },
  { code: "OTHER_ABSENCE", label: "Иное отсутствие" },
  { code: "DETACHED", label: "Откомандирован" },
  { code: "ATTACHED", label: "Прикомандирован" },
  { code: "REST_AFTER_DUTY", label: "После дежурства" },
  { code: "BEFORE_DUTY", label: "Перед дежурством" },
  { code: "DUTY", label: "На дежурстве" },
  { code: "GEV", label: "Группа экстренного выезда" },
  { code: "EVENT_ASSIGNMENT", label: "Привлечён на мероприятие (наряд)" },
  {
    code: "EVENT_ASSIGNMENT_GROUP",
    label: "Привлечён на мероприятие (боевая группа)",
  },
  { code: "PENDING_CLARIFICATION", label: "Уточняется" },
  { code: "IN_SERVICE", label: "В строю" },
];

// ── Клавиатурная грамматика (чистая state machine, ноль React/DOM) ───────
// Модуль НЕ хранит значения ячеек и не двигает реальный фокус — он вычисляет
// (action, nextState, nextPosition); применение — забота грида.

export type CellState = "NAVIGATE" | "EDIT" | "PERIOD_EDIT" | "CONFLICT";

export type GridKey =
  | { type: "Enter" }
  | { type: "Tab" }
  | { type: "ShiftTab" }
  | { type: "Esc" }
  | { type: "ArrowUp" }
  | { type: "ArrowDown" }
  | { type: "ArrowLeft" }
  | { type: "ArrowRight" }
  | { type: "Char"; char: string };

export type ColumnKind = "readonly" | "status" | "period" | "flag";

export interface Position {
  row: number;
  col: number;
}

export interface Bounds {
  rows: number;
  cols: number;
  columnKinds: readonly ColumnKind[];
}

export type GridAction =
  | "OPEN_EDIT"
  | "OPEN_PERIOD"
  | "TYPE_AHEAD"
  | "LIST_MOVE"
  | "COMMIT"
  | "RESTORE_PRE_EDIT"
  | "MOVE"
  | "OVERRIDE_RETRY"
  | "CLOSE_DIALOG"
  | "NOOP";

export interface TransitionInput {
  state: CellState;
  position: Position;
  bounds: Bounds;
  key: GridKey;
}

export interface TransitionResult {
  action: GridAction;
  nextState: CellState;
  nextPosition: Position;
  /** Символ type-ahead — при action=TYPE_AHEAD. */
  seed?: string;
}

function clamp(value: number, max: number): number {
  if (max < 0) return 0; // вырожденный грид: держимся нуля
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

function move(
  position: Position,
  bounds: Bounds,
  dRow: number,
  dCol: number
): Position {
  return {
    row: clamp(position.row + dRow, bounds.rows - 1),
    col: clamp(position.col + dCol, bounds.cols - 1),
  };
}

function columnKind(bounds: Bounds, col: number): ColumnKind {
  return bounds.columnKinds[col] ?? "readonly";
}

function stay(
  state: CellState,
  position: Position,
  action: GridAction
): TransitionResult {
  return { action, nextState: state, nextPosition: position };
}

/**
 * Единственный публичный вход грамматики: один шаг конечного автомата.
 * Входная позиция вне bounds (грид сжался после refetch) клампится ДО шага.
 */
export function transition(input: TransitionInput): TransitionResult {
  const { state, bounds } = input;
  const position: Position = {
    row: clamp(input.position.row, bounds.rows - 1),
    col: clamp(input.position.col, bounds.cols - 1),
  };
  const healed: TransitionInput = { ...input, position };

  switch (state) {
    case "NAVIGATE":
      return navigate(healed);
    case "EDIT":
      return edit(healed);
    case "PERIOD_EDIT":
      return periodEdit(healed);
    case "CONFLICT":
      return conflict(healed);
    default: {
      const never: never = state;
      void never;
      return { action: "NOOP", nextState: state, nextPosition: position };
    }
  }
}

function navigate({ position, bounds, key }: TransitionInput): TransitionResult {
  const kind = columnKind(bounds, position.col);
  switch (key.type) {
    case "Enter":
      if (kind === "status")
        return { action: "OPEN_EDIT", nextState: "EDIT", nextPosition: position };
      if (kind === "period")
        return {
          action: "OPEN_PERIOD",
          nextState: "PERIOD_EDIT",
          nextPosition: position,
        };
      return stay("NAVIGATE", position, "NOOP");
    case "Char":
      if (kind === "status")
        return {
          action: "TYPE_AHEAD",
          nextState: "EDIT",
          nextPosition: position,
          seed: key.char,
        };
      return stay("NAVIGATE", position, "NOOP");
    case "Tab":
    case "ArrowRight":
      return {
        action: "MOVE",
        nextState: "NAVIGATE",
        nextPosition: move(position, bounds, 0, 1),
      };
    case "ShiftTab":
    case "ArrowLeft":
      return {
        action: "MOVE",
        nextState: "NAVIGATE",
        nextPosition: move(position, bounds, 0, -1),
      };
    case "ArrowUp":
      return {
        action: "MOVE",
        nextState: "NAVIGATE",
        nextPosition: move(position, bounds, -1, 0),
      };
    case "ArrowDown":
      return {
        action: "MOVE",
        nextState: "NAVIGATE",
        nextPosition: move(position, bounds, 1, 0),
      };
    case "Esc":
      return stay("NAVIGATE", position, "NOOP");
    default: {
      const never: never = key;
      void never;
      return stay("NAVIGATE", position, "NOOP");
    }
  }
}

function edit({ position, bounds, key }: TransitionInput): TransitionResult {
  switch (key.type) {
    case "Enter": // подтвердить и уйти вниз
      return {
        action: "COMMIT",
        nextState: "NAVIGATE",
        nextPosition: move(position, bounds, 1, 0),
      };
    case "Tab":
      return {
        action: "COMMIT",
        nextState: "NAVIGATE",
        nextPosition: move(position, bounds, 0, 1),
      };
    case "ShiftTab":
      return {
        action: "COMMIT",
        nextState: "NAVIGATE",
        nextPosition: move(position, bounds, 0, -1),
      };
    case "Esc": // отмена: вернуть pre-edit значение
      return {
        action: "RESTORE_PRE_EDIT",
        nextState: "NAVIGATE",
        nextPosition: position,
      };
    case "Char":
      return {
        action: "TYPE_AHEAD",
        nextState: "EDIT",
        nextPosition: position,
        seed: key.char,
      };
    case "ArrowUp":
    case "ArrowDown":
      return stay("EDIT", position, "LIST_MOVE");
    case "ArrowLeft":
    case "ArrowRight":
      return stay("EDIT", position, "NOOP");
    default: {
      const never: never = key;
      void never;
      return stay("EDIT", position, "NOOP");
    }
  }
}

function periodEdit({ position, bounds, key }: TransitionInput): TransitionResult {
  switch (key.type) {
    case "Enter":
      return {
        action: "COMMIT",
        nextState: "NAVIGATE",
        nextPosition: move(position, bounds, 1, 0),
      };
    case "Tab":
      return {
        action: "COMMIT",
        nextState: "NAVIGATE",
        nextPosition: move(position, bounds, 0, 1),
      };
    case "ShiftTab":
      return {
        action: "COMMIT",
        nextState: "NAVIGATE",
        nextPosition: move(position, bounds, 0, -1),
      };
    case "Esc":
      return {
        action: "RESTORE_PRE_EDIT",
        nextState: "NAVIGATE",
        nextPosition: position,
      };
    case "Char":
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight": // ввод даты обслуживает редактор периода
      return stay("PERIOD_EDIT", position, "NOOP");
    default: {
      const never: never = key;
      void never;
      return stay("PERIOD_EDIT", position, "NOOP");
    }
  }
}

function conflict({ position, key }: TransitionInput): TransitionResult {
  switch (key.type) {
    case "Enter":
      return {
        action: "OVERRIDE_RETRY",
        nextState: "NAVIGATE",
        nextPosition: position,
      };
    case "Esc":
      return {
        action: "CLOSE_DIALOG",
        nextState: "NAVIGATE",
        nextPosition: position,
      };
    default:
      return stay("CONFLICT", position, "NOOP");
  }
}

// ── Строки грида и prefill ───────────────────────────────────────────────

export interface EmployeeRow {
  id: string;
  fullName: string;
  rank?: string;
  statusCode: string;
  /** «по … включительно» — конечная дата срочного статуса. */
  period?: string;
}

export interface RowChange {
  id: string;
  statusCode: string;
  period: string;
}

export interface EmployeeSeed {
  id: string;
  fullName: string;
  rank?: string;
}

/** Вчерашняя расстановка: employee_id → значение статуса/периода. */
export type YesterdayPlacement = Record<
  string,
  { statusCode: string; period?: string }
>;

export interface BulkStatusRow {
  employee_id: string;
  status_type_code: string;
  date_start: string;
  date_end: string;
}

/** `type`, а не `interface`: переменные use-ops-mutation обязаны
 * удовлетворять Record<string, unknown>. */
export type BulkStatusRequest = {
  business_date: string;
  rows: BulkStatusRow[];
};

export interface BulkResponse {
  created: number;
}

/** Дефолт для сотрудника без вчерашней записи: derived «В строю». */
export const DEFAULT_STATUS = "IN_SERVICE";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC-математика, не local: локальный парсер сдвинул бы дату на границе
 * суток в минусовых поясах. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Строки грида, предзаполненные вчерашней расстановкой. */
export function buildPrefilledRows(
  employees: EmployeeSeed[],
  yesterday: YesterdayPlacement,
  defaultStatus: string = DEFAULT_STATUS
): EmployeeRow[] {
  const placement = yesterday ?? {};
  const rows: EmployeeRow[] = [];
  const seen = new Set<string>();
  for (const e of employees ?? []) {
    // Дубль из грязного источника: первый выигрывает — иначе дубль React-key
    // и двойная дельта, а бэк отвергает весь payload.
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const y = placement[e.id];
    // || (не ??): пустая строка — тоже «нет статуса».
    const yStatus = y?.statusCode || "";
    rows.push({
      id: e.id,
      fullName: e.fullName,
      rank: e.rank,
      statusCode: yStatus || defaultStatus,
      // Период живёт только при живом вчерашнем статусе.
      period: yStatus ? y?.period : undefined,
    });
  }
  return rows;
}

/** Дельты грида → bulk-запрос (ТОЛЬКО отклонения). */
export function toBulkRequest(
  changes: RowChange[],
  businessDate: string
): BulkStatusRequest {
  return {
    business_date: businessDate,
    rows: changes.map((c) => {
      const period = c.period.trim();
      return {
        employee_id: c.id,
        status_type_code: c.statusCode,
        date_start: businessDate,
        // Полуинтервал бэка [s, e): UI-«по … включительно» → +1 день;
        // пусто → статус на один день.
        date_end: ISO_DATE_RE.test(period)
          ? addDaysIso(period, 1)
          : period || addDaysIso(businessDate, 1),
      };
    }),
  };
}

// ── Ошибки bulk-роута ────────────────────────────────────────────────────

/** Одна отклонённая строка массового обновления (details.rows[]). */
export interface BulkRowError {
  index: number;
  employeeId: string;
  code: string;
  httpStatus: number;
  message: string;
}

export type BulkFailureKind = "rows" | "permission" | "validation" | "silent";

export interface BulkFailureDescription {
  kind: BulkFailureKind;
  message: string;
}

export const BULK_PERMISSION_MESSAGE =
  "Недостаточно прав на запись статусов. Требуется право status.manage.";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

/** details читаем ЗАЩИТНО: кривые строки отбрасываются без исключений. */
export function parseBulkRowErrors(error: unknown): BulkRowError[] {
  const details = asRecord(asRecord(error)?.details);
  if (details === null) return [];
  const rows = details.rows;
  if (!Array.isArray(rows)) return [];
  const parsed: BulkRowError[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    if (row === null) continue;
    if (typeof row.index !== "number") continue;
    if (typeof row.employee_id !== "string") continue;
    if (typeof row.message !== "string") continue;
    parsed.push({
      index: row.index,
      employeeId: row.employee_id,
      code: typeof row.code === "string" ? row.code : "",
      httpStatus: typeof row.http_status === "number" ? row.http_status : 0,
      message: row.message,
    });
  }
  return parsed;
}

/**
 * Канал отображения БЕЗ дублирования уже обслуженных: 5xx/сеть — тост
 * use-ops-mutation, 401 — цепь logout. Функция тотальна: неучтённый статус
 * попадает в rows (инлайн с текстом конверта), а не в тишину.
 */
export function describeBulkFailure(error: OpsApiFailure): BulkFailureDescription {
  if (error.kind === "network") return { kind: "silent", message: "" };
  if (error.status >= 500) return { kind: "silent", message: "" };
  if (error.status === 401) return { kind: "silent", message: "" };
  if (error.status === 403)
    return { kind: "permission", message: BULK_PERMISSION_MESSAGE };
  if (error.status === 400) return { kind: "validation", message: error.message };
  return { kind: "rows", message: error.message };
}

/** 400 VALIDATION_ERROR: DRF-details по полям → плоские строки. */
export function parseValidationDetails(error: unknown): string[] {
  const details = asRecord(asRecord(error)?.details);
  if (details === null) return [];
  const lines: string[] = [];
  for (const [field, value] of Object.entries(details)) {
    if (typeof value === "string") {
      lines.push(`${field}: ${value}`);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") lines.push(`${field}: ${item}`);
      }
    }
  }
  return lines;
}

// ── Сдача дня ────────────────────────────────────────────────────────────

/** Три значения события сдачи — других бэк не эмитит. */
export type DaySubmissionEvent = "CONFIRMED_NO_CHANGES" | "CHANGED" | "AMENDED";

/** 9-полевая проекция сдачи (без snapshot). id — числовой pk. */
export interface DaySubmission {
  id: number;
  division_id: string;
  business_date: string;
  version: number;
  is_current: boolean;
  event: DaySubmissionEvent;
  submitted_by: string;
  submitted_at: string;
  late: boolean;
}

/** Тело создания — РОВНО два поля: актора определяет сервер. */
export type DaySubmissionCreateBody = {
  division_id: string;
  business_date: string;
};

/** Тело исправления — РОВНО два поля. */
export type DayAmendBody = {
  reason: string;
  sanction: string;
};

export const EVENT_LABELS: Record<DaySubmissionEvent, string> = {
  CONFIRMED_NO_CHANGES: "Подтверждено без изменений",
  CHANGED: "Изменено",
  AMENDED: "Исправлено",
};

export const SUBMIT_PERMISSION_MESSAGE =
  "Недостаточно прав на сдачу дня. Требуется право daily_report.mark_update.";

export const AMEND_PERMISSION_MESSAGE =
  "Недостаточно прав на исправление сдачи. Требуется право daily_report.correct.";

export const AMEND_NOT_FOUND_MESSAGE = "Сдача не найдена.";

export const AMEND_CONFLICT_MESSAGE =
  "День успел измениться: появилась новая версия. Состояние перечитано — откройте исправление заново.";

/** Зеркало CharField(max_length=255). */
export const SANCTION_MAX = 255;

/** Длина меряется ПОСЛЕ trim: DRF режет пробелы до MaxLengthValidator, и
 * наивная проверка сырой длины запрещала бы то, что сервер разрешает.
 * Нижнего предела у причины нет: проверяется только непустота. */
export function isAmendmentComplete(reason: string, sanction: string): boolean {
  const trimmedSanction = sanction.trim();
  return (
    reason.trim().length > 0 &&
    trimmedSanction.length > 0 &&
    trimmedSanction.length <= SANCTION_MAX
  );
}

const EVENTS: ReadonlySet<string> = new Set<DaySubmissionEvent>([
  "CONFIRMED_NO_CHANGES",
  "CHANGED",
  "AMENDED",
]);

function parseSubmission(raw: unknown): DaySubmission | null {
  const row = asRecord(raw);
  if (row === null) return null;
  // Все девять полей — несущие: частичная строка дала бы «День сдан:
  // vundefined» вместо честного «день не сдан».
  if (typeof row.id !== "number") return null;
  if (typeof row.division_id !== "string") return null;
  if (typeof row.business_date !== "string") return null;
  if (typeof row.version !== "number") return null;
  if (typeof row.is_current !== "boolean") return null;
  if (typeof row.event !== "string" || !EVENTS.has(row.event)) return null;
  if (typeof row.submitted_by !== "string") return null;
  if (typeof row.submitted_at !== "string") return null;
  if (typeof row.late !== "boolean") return null;
  return {
    id: row.id,
    division_id: row.division_id,
    business_date: row.business_date,
    version: row.version,
    is_current: row.is_current,
    event: row.event as DaySubmissionEvent,
    submitted_by: row.submitted_by,
    submitted_at: row.submitted_at,
    late: row.late,
  };
}

/** Конверт LimitOffsetPagination — читаем защитно; пустой результат = «сдач
 * нет», а не «ошибка». */
export function parseSubmissionList(payload: unknown): DaySubmission[] {
  const envelope = asRecord(payload);
  if (envelope === null) return [];
  if (!Array.isArray(envelope.results)) return [];
  const parsed: DaySubmission[] = [];
  for (const raw of envelope.results) {
    const submission = parseSubmission(raw);
    if (submission !== null) parsed.push(submission);
  }
  return parsed;
}

/** «День сдан» решается по ФЛАГУ is_current, а не по results.length: список
 * из одних исторических версий — это «день не сдан» в терминах текущей. */
export function currentSubmission(list: DaySubmission[]): DaySubmission | null {
  return list.find((submission) => submission.is_current) ?? null;
}

/** Последняя ТЕКУЩАЯ сдача СТРОГО раньше businessDate. Это НЕ «календарное
 * вчера»: после выходных предыдущая сдача — пятничная. */
export function previousSubmission(
  list: DaySubmission[],
  businessDate: string
): DaySubmission | null {
  return (
    list.find(
      (submission) =>
        submission.is_current && submission.business_date < businessDate
    ) ?? null
  );
}

/** Сегодня в ЛОКАЛЬНОЙ зоне браузера: UTC-срез уехал бы на сутки вечером. */
export function todayLocalIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Окно первичной сдачи — {сегодня, сегодня+1}. Считает браузер, а РЕШАЕТ
 * сервер: истина при 422 — details.allowed из ответа. */
export function submitWindow(today: string): [string, string] {
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return [today, tomorrow.toISOString().slice(0, 10)];
}

export function isWithinSubmitWindow(businessDate: string, today: string): boolean {
  return submitWindow(today).includes(businessDate);
}

export type SubmitFailureKind =
  | "already-submitted"
  | "out-of-window"
  | "permission"
  | "not-found"
  | "validation"
  | "other"
  | "silent";

export interface SubmitFailureDescription {
  kind: SubmitFailureKind;
  message: string;
  /** Только для out-of-window: даты ИЗ ОТВЕТА, не своё предположение. */
  allowed?: string[];
}

function parseAllowed(details: Record<string, unknown>): string[] | undefined {
  const allowed = details.allowed;
  if (!Array.isArray(allowed)) return undefined;
  if (!allowed.every((item) => typeof item === "string")) return undefined;
  if (allowed.length === 0) return undefined;
  return allowed as string[];
}

/**
 * Порядок ветвления: сначала kind === 'network' (единственная ветка, где
 * status не существует), дальше по status, внутри 409/422 — по errorCode.
 * Функция тотальна: неучтённый статус попадает в other с текстом конверта.
 */
export function describeSubmitFailure(
  error: OpsApiFailure
): SubmitFailureDescription {
  if (error.kind === "network") return { kind: "silent", message: "" };
  if (error.status >= 500) return { kind: "silent", message: "" };
  if (error.status === 401) return { kind: "silent", message: "" };
  if (error.status === 403)
    return { kind: "permission", message: SUBMIT_PERMISSION_MESSAGE };
  if (error.status === 404) {
    return { kind: "not-found", message: "Подразделение не найдено." };
  }
  if (error.status === 400) return { kind: "validation", message: error.message };
  if (error.status === 409 && error.errorCode === "DAY_ALREADY_SUBMITTED") {
    return {
      kind: "already-submitted",
      message: "День уже сдан. Исправить его можно кнопкой «Исправить сдачу».",
    };
  }
  if (error.status === 422 && error.errorCode === "BUSINESS_DATE_OUT_OF_WINDOW") {
    return {
      kind: "out-of-window",
      message: "Сдать можно только за сегодня или завтра.",
      allowed: parseAllowed(error.details),
    };
  }
  return { kind: "other", message: error.message };
}

export type AmendFailureKind =
  | "permission"
  | "not-found"
  | "validation"
  | "conflict"
  | "other"
  | "silent";

export interface AmendFailureDescription {
  kind: AmendFailureKind;
  message: string;
}

export function describeAmendFailure(error: OpsApiFailure): AmendFailureDescription {
  if (error.kind === "network") return { kind: "silent", message: "" };
  if (error.status >= 500) return { kind: "silent", message: "" };
  if (error.status === 401) return { kind: "silent", message: "" };
  if (error.status === 403) {
    return { kind: "permission", message: AMEND_PERMISSION_MESSAGE };
  }
  if (error.status === 404) {
    return { kind: "not-found", message: AMEND_NOT_FOUND_MESSAGE };
  }
  if (error.status === 400) return { kind: "validation", message: error.message };
  if (error.status === 409 && error.errorCode === "DAY_ALREADY_SUBMITTED") {
    return { kind: "conflict", message: AMEND_CONFLICT_MESSAGE };
  }
  return { kind: "other", message: error.message };
}

// ── Пути API (pending-контракт мок-слоя раздела ОМ) ──────────────────────

export const DAILY_DIVISIONS_PATH = "/api/ops/daily/divisions/";
export const DAILY_EMPLOYEES_PATH = "/api/ops/daily/employees/";
export const DAILY_BULK_PATH = "/api/ops/daily/statuses-bulk/";
export const DAILY_SUBMISSIONS_PATH = "/api/ops/daily/daily-submissions/";
export function dailyAmendPath(id: number): string {
  return `${DAILY_SUBMISSIONS_PATH}${id}/amend/`;
}
export const DAILY_AMEND_PATH_PATTERN =
  "/api/ops/daily/daily-submissions/:submissionId/amend/";

// ── Светофор сдачи дня: ОДИН классификатор на все экраны ─────────────────
//
// Ревью ветки 22.08 нашло, что слово «Сдано» значило ТРИ РАЗНЫХ ЧИСЛА на трёх
// экранах: карточка командного центра (`ExpenseTrafficCard`), аналитика
// (`/security-ops/analytics`) и борд «Ежедневного расхода» читали ОДИН И ТОТ
// ЖЕ ответ светофора (`GET /api/operations/traffic-light/tree/`) и раскладывали
// его по корзинам каждый по-своему — опоздавший GREEN попадал у одного экрана
// в «Сдано», у другого сразу в две доли («сдали» И «с опозданием»), у третьего
// в «Просрочено». Разбор корзин теперь ЖИВЁТ ЗДЕСЬ, в одном месте, и экраны
// его не повторяют: разойтись им больше нечем.
//
// Почему в `entities/daily-grid`, а не в отдельном модуле: этот модуль УЖЕ
// владеет контрактом сдачи дня (`DaySubmission`, `currentSubmission`,
// `EVENT_LABELS`, пути ручек), а вердикт светофора — это ровно проекция той же
// сдачи на подразделение (`submission.late` — поле сдачи, не свойство цвета).
// Цикла импортов не возникает: `lib/api.ts` (владелец `TrafficLightNode`) не
// импортирует `entities/*` вовсе, а здесь тип берётся `import type` (сам
// импорт стоит в шапке файла, рядом с остальными).

/** Подписи цветов светофора — ЕДИНСТВЕННЫЙ словарь на все экраны. Второй
 * набор слов для тех же пяти статусов разошёлся бы при первом же новом
 * состоянии. */
export const SUBMISSION_LABEL: Record<TrafficLightNode["status"], string> = {
  GREEN: "сдан",
  YELLOW: "сдан, данные разошлись",
  RED: "не сдан",
  NEUTRAL: "нечего сдавать",
  UNKNOWN: "состояние неизвестно",
};

/** Три корзины сдачи. NEUTRAL сюда не входит вовсе — см. `classifyLeaf`. */
export type SubmissionBucket = "submitted" | "late" | "missing";

/** Проверка полноты switch НА ЭТАПЕ КОМПИЛЯЦИИ: если статусов светофора
 * станет шесть, `default` перестанет сужаться до `never` и `tsc` откажется
 * собирать файл — вместо того чтобы шестой статус молча выпал из всех
 * счётчиков сразу на трёх экранах. */
function assertNeverStatus(value: never): never {
  throw new Error(`Неизвестный статус светофора: ${String(value)}`);
}

/**
 * Корзина сдачи ОДНОГО узла светофора. Маппинг снят по бэку
 * (`organization_management/apps/operations/traffic_light.py`,
 * `DivisionTrafficLight.late`, `_own_states`, `_PRECEDENCE`), а не придуман:
 *
 *   * `late` — отметка опоздания САМОЙ СДАЧИ (`submission.late`), а не
 *     свойство цвета: у узла БЕЗ сдачи (RED — «есть кого сдавать, не сдали»,
 *     NEUTRAL — «сдавать некого») сдачи нет вовсе, и бэк жёстко возвращает
 *     `late=False`. Поэтому «просрочено» — это НЕ «красный, у которого истёк
 *     час», а «сдали, но после контрольного часа»;
 *   * `submitted` = GREEN|YELLOW и НЕ late. YELLOW («сдан, данные
 *     разошлись») — это тоже СДАЧА: расхождение с живыми данными не значит,
 *     что дня не было;
 *   * `late`      = GREEN|YELLOW и late;
 *   * `missing`   = RED (сдачи нет) ИЛИ UNKNOWN (справочник узла сломан —
 *     свод считает «не знаю» СТАРШЕ красного: класть сломанный узел в
 *     «сдано» значило бы обвинить отчёт зелёным цветом);
 *   * `null`      = NEUTRAL — сдавать некого. Это не факт сдачи и не её
 *     отсутствие, а отсутствие ОБЯЗАННОСТИ сдавать, поэтому узел стоит вне
 *     всех трёх счётчиков.
 */
export function classifyLeaf(node: TrafficLightNode): SubmissionBucket | null {
  switch (node.status) {
    case "RED":
    case "UNKNOWN":
      return "missing";
    case "GREEN":
    case "YELLOW":
      return node.late ? "late" : "submitted";
    case "NEUTRAL":
      return null;
    default:
      return assertNeverStatus(node.status);
  }
}

export interface DivisionForest {
  roots: TrafficLightNode[];
  childrenOf: Map<number, TrafficLightNode[]>;
  cyclic: Set<number>;
}

/**
 * Лес подразделений по `parent_id`. Корень — узел БЕЗ РАЗРЕШИМОГО родителя:
 * `parent_id === null`, ИЛИ `parent_id` указывает на id, которого среди узлов
 * ответа нет (битая ссылка), ИЛИ цепочка родителей ЗАЦИКЛЕНА (A→B, B→A
 * разрешают друг друга ПОПАРНО — обход леса идёт только от `roots` вниз, и без
 * этой защиты оба узла не отрисовались бы НИКОГДА, без единого технического
 * зависания). Все три случая становятся ОТДЕЛЬНЫМ корнем леса, а не пропадают
 * молча — узел, до которого пользователь не доберётся, хуже некрасивого узла.
 *
 * Цикл ищется ХОДОМ ВВЕРХ по родителям от КАЖДОГО узла с множеством `visited`:
 * если цепочка возвращается к уже посещённому В ЭТОМ ХОДЕ id — позиция узла в
 * иерархии структурно неопределима (сам узел в цикле, ИЛИ его цепочка
 * родителей ЧЕРЕЗ цикл проходит) — узел уходит в `cyclic` и становится корнем.
 */
export function buildDivisionForest(nodes: TrafficLightNode[]): DivisionForest {
  const byId = new Map(nodes.map((node) => [node.division_id, node]));

  const cyclic = new Set<number>();
  for (const node of nodes) {
    const visited = new Set<number>();
    let current: TrafficLightNode | undefined = node;
    while (current !== undefined) {
      if (visited.has(current.division_id)) {
        cyclic.add(node.division_id);
        break;
      }
      visited.add(current.division_id);
      const parentId: number | null = current.parent_id;
      current = parentId === null ? undefined : byId.get(parentId);
    }
  }

  const roots: TrafficLightNode[] = [];
  const childrenOf = new Map<number, TrafficLightNode[]>();
  for (const node of nodes) {
    const parentId = node.parent_id;
    const hasResolvableParent =
      parentId !== null && byId.has(parentId) && !cyclic.has(node.division_id);
    if (!hasResolvableParent) {
      roots.push(node);
      continue;
    }
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(node);
    else childrenOf.set(parentId, [node]);
  }
  return { roots, childrenOf, cyclic };
}

/**
 * Листья дерева — узлы БЕЗ ПОТОМКОВ. Считать надо именно по ним: цвет узла С
 * ПОТОМКАМИ — худший в поддереве (каскад светофора), и сложение родителя с
 * детьми посчитало бы одно подразделение дважды.
 *
 * Лист определяется по `childrenOf` ЛЕСА, а не наивным `!parents.has(id)`
 * (находка ревью ветки 22.08): при цикле A→B, B→A оба узла попадают в
 * множество «кто чей-то родитель», и наивная проверка выбрасывала бы из счёта
 * ОБА — подразделения молча исчезали бы из всех трёх счётчиков. В лесу
 * зациклённый узел становится корнем без потомков, то есть честным листом.
 */
export function trafficLeaves(nodes: TrafficLightNode[]): TrafficLightNode[] {
  const { childrenOf } = buildDivisionForest(nodes);
  return nodes.filter(
    (node) => (childrenOf.get(node.division_id) ?? []).length === 0
  );
}

export interface SubmissionCounts {
  /** Узлы, по которым посчитаны корзины (листья дерева). */
  leaves: TrafficLightNode[];
  submitted: number;
  late: number;
  missing: number;
  /** NEUTRAL — вне трёх корзин, но названо числом: «сдавать некого» это факт,
   * а не пустота. */
  neutral: number;
}

/** Счёт корзин по ЛИСТЬЯМ дерева — единственный на все экраны. Экран, которому
 * нужна более дробная разбивка (RED против UNKNOWN, YELLOW внутри сдавших),
 * берёт её из `leaves` тем же `classifyLeaf`, а не своим маппингом. */
export function countSubmissions(nodes: TrafficLightNode[]): SubmissionCounts {
  const leaves = trafficLeaves(nodes);
  const counts: SubmissionCounts = {
    leaves,
    submitted: 0,
    late: 0,
    missing: 0,
    neutral: 0,
  };
  for (const node of leaves) {
    const bucket = classifyLeaf(node);
    if (bucket === null) counts.neutral += 1;
    else counts[bucket] += 1;
  }
  return counts;
}

// ── Подписи статусов раздела ─────────────────────────────────────────────

/** Код статуса → подпись, ИЗ ЕДИНСТВЕННОГО каталога раздела. До ревью ветки
 * 22.08 эта карта была скопирована дословно в трёх местах
 * (`DailyExpenseBoard`, `LeadershipStrip`, экран профиля) — три копии одного
 * словаря разъехались бы при первом же новом статусе в каталоге. */
export const STATUS_LABEL_BY_CODE: ReadonlyMap<string, string> = new Map(
  STATUS_TYPE_OPTIONS.map((option) => [option.code, option.label])
);
