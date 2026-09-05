// Оперативный рейтинг участников охранных мероприятий (§19 мастер-промпта,
// нативный порт из Smart Josparlau). Здесь ровно два понятия — закрытая оценка
// по итогам мероприятия и серверная агрегированная сводка; остальные (кадровый
// рейтинг, часы службы, взыскания) не заводятся: источника у них нет.
//
// ⚠️ Расчётные функции (buildSummary, buildRatingAnalytics, сборка CSV)
// исполняются ТОЛЬКО на стороне mock-сервера: §19.19 запрещает фронту считать
// среднее, округлять каноническое значение, исключать исправленные оценки и
// задавать период. Страницы печатают присланное.

// ── Шкала и константы ────────────────────────────────────────────────────

/** §19: шкала канонически 1–10 (прототипные «0–10» — ошибка). */
export const RATING_SCALE_MIN = 1;
export const RATING_SCALE_MAX = 10;

/** Каноническая начальная оценка (§19.8). Значение приходит с сервера в
 * задании; константа нужна ПРАВИЛУ комментария («ниже 8 — обязателен»). */
export const RATING_DEFAULT_SCORE = 8;

// ── Модель ───────────────────────────────────────────────────────────────

export type EvaluationDirection =
  | "SENIOR_TO_EMPLOYEE"
  | "SENIOR_TO_GROUP"
  | "EMPLOYEE_TO_SENIOR";

/** Как получена оценка (§19.8): системная восьмёрка — не оценка человека. */
export type EvaluationMethod = "MANUAL" | "SYSTEM_DEFAULT";

export type EvaluationWorkItemStatus = "PENDING" | "SUBMITTED";

/**
 * Задание на оценивание (§19.7). Задания формирует и хранит сервер: фронт не
 * определяет список target и не создаёт задание после refresh. Оценщик лежит в
 * задании и наружу не отдаётся — по нему отбирается очередь.
 */
export interface EvaluationWorkItem {
  id: string;
  securityEventId: string;
  eventRunId: string;
  assignmentId: string | null;
  /** Кто должен оценить. Наружу не едет. */
  evaluatorUserId: string;
  targetEmployeeId: string | null;
  targetGroupId: string | null;
  targetSafeLabel: string;
  targetSafeUnitLabel: string;
  postLabel: string;
  actualStartsAt: string;
  actualEndsAt: string;
  /** Факт участия: `false` — участник заявлен, но не присутствовал. */
  participated: boolean;
  evaluationDirection: EvaluationDirection;
  /** Начальное значение (§19.8) — даёт СЕРВЕР, не `setState` формы. */
  initialScore: number;
  status: EvaluationWorkItemStatus;
  revision: number;
  submittedEvaluationId: string | null;
  submittedAt: string | null;
}

/** Исправление — ОТДЕЛЬНАЯ запись (§19.18): оценку нельзя бесследно править. */
export interface EvaluationCorrection {
  id: string;
  originalEvaluationId: string;
  replacementEvaluationId: string;
  reason: string;
  correctedBy: string;
  correctedAt: string;
  revision: number;
}

/**
 * Событие журнала оценивания (§19.27). Запись НЕ несёт значений: old/new score,
 * комментарии и оценщик доступны только отдельной audit privacy permission,
 * которой в сборке нет, — этих полей нет в типе вовсе.
 */
export interface RatingAuditEntry {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  eventCode: RatingAuditEventCode;
  outcome: "SUCCESS" | "REJECTED";
  reasonCode: string | null;
  securityEventId: string | null;
  eventRunId: string | null;
  assignmentId: string | null;
  evaluationId: string | null;
  correctionId: string | null;
  requestId: string | null;
  revision: number | null;
}

export type RatingAuditEventCode =
  | "EVALUATION_SUBMITTED"
  | "EVALUATION_SCORE_CHANGED_FROM_INITIAL"
  | "EVALUATION_LOW_SCORE_WITHOUT_COMMENT"
  | "EVALUATION_CORRECTED"
  | "EVALUATION_CORRECTION_REJECTED"
  | "EVALUATION_ACCESS_DENIED"
  | "RATING_EXPORT_REQUESTED"
  | "RATING_EXPORT_DOWNLOADED"
  | "RATING_EXPORT_REJECTED";

/** Уведомление раздела (§19.28): только КОД — текст подставляет экран из
 * фиксированного словаря, нести в записи закрытые поля нечем. */
export interface RatingNotification {
  id: string;
  createdAt: string;
  recipientUserId: string;
  code: RatingNotificationCode;
  deepLink: string;
  securityEventId: string | null;
}

export type RatingNotificationCode =
  | "EVALUATION_AVAILABLE"
  | "EVALUATION_SUBMITTED"
  | "EVALUATION_CORRECTED";

/** §19.28: фиксированный словарь формулировок — текст подставляется ПО КОДУ,
 * подстановок в формулировках нет вовсе. Общий для секции уведомлений и
 * колокольчика раздела. */
export const RATING_NOTIFICATION_TEXT: Record<RatingNotificationCode, string> = {
  EVALUATION_AVAILABLE: "Вам доступно итоговое оценивание мероприятия",
  EVALUATION_SUBMITTED: "Оценивание успешно отправлено",
  EVALUATION_CORRECTED: "Оценка была исправлена уполномоченным пользователем",
};

export type RatingExportScope = "AGGREGATE" | "INDIVIDUAL";
/** XLSX/PDF не собираются в сборке — причина едет клиенту, а не молчит. */
export type RatingExportFormat = "CSV";
export type RatingExportJobState =
  | "QUEUED"
  | "GENERATING"
  | "READY"
  | "FAILED"
  | "CANCELLED";

/** Работа экспорта (§19.29). `artifactId` — null до READY; ссылки на файл нет. */
export interface RatingExportJob {
  exportJobId: string;
  scope: RatingExportScope;
  format: RatingExportFormat;
  state: RatingExportJobState;
  createdAt: string;
  createdBy: string;
  finishedAt: string | null;
  failureCode: string | null;
  safeFailureMessage: string | null;
  artifactId: string | null;
  idempotencyKey: string;
}

/** Собранный файл. Содержимое собирается ИЗ СВОДКИ — закрытых полей в нём нет. */
export interface RatingExportArtifact {
  artifactId: string;
  exportJobId: string;
  scope: RatingExportScope;
  format: RatingExportFormat;
  fileName: string;
  generatedAt: string;
  policyVersion: string | null;
  rowCount: number;
  content: string;
}

/** Основание оценки (§19.10) — перечень приходит с сервера. */
export interface EvaluationBasis {
  code: string;
  label: string;
  requiresNote: boolean;
}

/**
 * Закрытая оценка (§19.2). Наружу не едет ни одним полем: ни одна операция
 * контракта не отдаёт отдельную оценку, оценщика или комментарий.
 */
export interface EventEvaluation {
  id: string;
  securityEventId: string;
  employeeId: string;
  /** null у системной оценки: приписать её человеку нельзя (§19.8). */
  evaluatorUserId: string | null;
  score: number;
  comment: string | null;
  evaluationDirection: EvaluationDirection;
  method: EvaluationMethod;
  basisCode: string | null;
  basisNote: string | null;
  evaluatedAt: string;
  /** Вытеснение исправлением: агрегат исключает вытесненные — на сервере. */
  supersededById: string | null;
}

/** Почему агрегата нет — отдельное состояние, а не ноль (§19.2/§19.19). */
export type RatingDataState =
  | "READY"
  | "INSUFFICIENT_DATA"
  | "POLICY_UNDEFINED"
  | "FEATURE_DISABLED";

export interface OperationalRatingSummary {
  /** КОД УЧАСТНИКА рейтинга, а не кадровый id: по нему ходят экраны раздела
   * и ручки `?employee=`. Имя неточное — это существующий контракт. */
  employeeId: string;
  /** Кадровая запись участника; `null` — связи нет (Plane №96).
   *
   * Расстановка ищет рейтинг ПО НЕМУ: до появления поля она искала по
   * `employeeId`, то есть по коду участника, и не находила ничего — весь
   * рейтинговый функционал подбора был фикцией, видимой только на моке. */
  personnelId: string | null;
  safeLabel: string;
  aggregateRating: number | null;
  evaluationsCount: number;
  periodStartsAt: string | null;
  periodEndsAt: string | null;
  calculationPolicyVersion: string | null;
  calculatedAt: string;
  dataState: RatingDataState;
}

/** Точка динамики (§19.20) — ЗАПИСАННЫЙ агрегат закрытого периода со СВОЕЙ
 * policyVersion; пересчитывать прошлое под текущую методику запрещено. */
export interface RatingDynamicsPoint {
  employeeId: string;
  period: string;
  periodStartsAt: string;
  periodEndsAt: string;
  aggregateRating: number | null;
  evaluationsCount: number;
  policyVersion: string;
  dataState: Extract<RatingDataState, "READY" | "INSUFFICIENT_DATA">;
  recordedAt: string;
}

/** Граница смены методики — факт сервера, а не вывод экрана из соседних точек. */
export interface RatingPolicyBoundary {
  period: string;
  fromPolicyVersion: string;
  toPolicyVersion: string;
}

/** Политика расчёта: период, минимум оценок и версия приходят из «Настроек». */
export interface RatingPolicy {
  periodDays: number;
  minEvaluations: number;
  policyVersion: string;
}

// ── Пути API (pending-контракт: бэкенда ОМ нет) ──────────────────────────
// Каждому чтению/мутации — СВОЙ путь: коллизия путей в MSW разрешается молча
// в пользу первого handler'а. Шаблоны с ":" заведены константами — фабрика
// энкодит двоеточие в %3A, и маршрут с ним не сматчится.

export const OPERATIONAL_RATINGS_PATH = "/api/ops/operational-ratings/";
export const OPERATIONAL_RATING_DYNAMICS_PATH =
  "/api/ops/operational-rating-dynamics/";
export const RATING_ANALYTICS_PATH = "/api/ops/rating-analytics/";
export const EVALUATION_WORKSPACE_PATH = "/api/ops/evaluation-workspace/";
export function evaluationSubmitPath(workItemId: string): string {
  return `/api/ops/evaluation-work-items/${encodeURIComponent(workItemId)}/submit/`;
}
export const EVALUATION_SUBMIT_PATH_PATTERN =
  "/api/ops/evaluation-work-items/:workItemId/submit/";
export function evaluationCorrectPath(workItemId: string): string {
  return `/api/ops/evaluation-work-items/${encodeURIComponent(workItemId)}/correct/`;
}
export const EVALUATION_CORRECT_PATH_PATTERN =
  "/api/ops/evaluation-work-items/:workItemId/correct/";
export function evaluationDetailPath(workItemId: string): string {
  return `/api/ops/evaluation-work-items/${encodeURIComponent(workItemId)}/detail/`;
}
export const EVALUATION_DETAIL_PATH_PATTERN =
  "/api/ops/evaluation-work-items/:workItemId/detail/";
export const EVALUATION_REGISTRY_PATH = "/api/ops/evaluation-registry/";
export const RATING_AUDIT_PATH = "/api/ops/rating-audit/";
export const RATING_NOTIFICATIONS_PATH = "/api/ops/rating-notifications/";
export const RATING_EMPLOYEE_DETAIL_PATH =
  "/api/ops/operational-rating-employee/";
export const RATING_EXPORTS_PATH = "/api/ops/rating-exports/";
export function ratingExportCancelPath(exportJobId: string): string {
  return `/api/ops/rating-exports/${encodeURIComponent(exportJobId)}/cancel/`;
}
export const RATING_EXPORT_CANCEL_PATH_PATTERN =
  "/api/ops/rating-exports/:exportJobId/cancel/";
export function ratingExportDownloadPath(artifactId: string): string {
  return `/api/ops/rating-export-artifacts/${encodeURIComponent(artifactId)}/download/`;
}
export const RATING_EXPORT_DOWNLOAD_PATH_PATTERN =
  "/api/ops/rating-export-artifacts/:artifactId/download/";

// ── Контракты ответов ────────────────────────────────────────────────────

/** §35: чего нет и почему — форма всех «недоступных» блоков. */
export interface UnavailableRatingFactor {
  code: string;
  label: string;
  reason: string;
}

export interface ListOperationalRatingsResponse {
  results: OperationalRatingSummary[];
  policy: RatingPolicy | null;
  capabilities: { operationalRatings: boolean; ratingConflicts: boolean };
  unavailableFactors: UnavailableRatingFactor[];
  unavailableViews: UnavailableRatingFactor[];
}

export interface RatingDynamicsResponse {
  employeeId: string;
  safeLabel: string;
  points: RatingDynamicsPoint[];
  boundaries: RatingPolicyBoundary[];
  currentPolicy: RatingPolicy | null;
  currentPolicyHasClosedPeriods: boolean;
  capabilities: { operationalRatings: boolean };
  employees: { employeeId: string; safeLabel: string }[];
}

/** Задание в ответе — без оценщика: очередь и так отобрана по нему. */
export type EvaluationWorkItemView = Omit<EvaluationWorkItem, "evaluatorUserId">;

export interface SubmittedEvaluationView {
  workItemId: string;
  evaluationId: string;
  targetSafeLabel: string;
  postLabel: string;
  evaluationDirection: EvaluationDirection;
  method: EvaluationMethod;
  score: number;
  basisLabel: string | null;
  basisNote: string | null;
  comment: string | null;
  submittedAt: string;
  revision: number;
}

export interface EvaluationWorkspaceEvent {
  securityEventId: string;
  number: string;
  title: string;
  objectLabel: string;
  actualStartsAt: string;
  actualEndsAt: string;
  stateLabel: string;
}

export interface EvaluationWorkspaceResponse {
  events: EvaluationWorkspaceEvent[];
  selectedEvent: EvaluationWorkspaceEvent | null;
  pending: EvaluationWorkItemView[];
  submitted: SubmittedEvaluationView[];
  queue: QueueCounters;
  /** Прогресс мероприятия ЦЕЛИКОМ — null без права на агрегат. */
  eventProgress: EventProgress | null;
  bases: EvaluationBasis[];
  policy: RatingPolicy | null;
  loadedAt: string;
  capabilities: { operationalRatings: boolean };
  unavailableReason: "FEATURE_DISABLED" | null;
  unavailableViews: UnavailableRatingFactor[];
}

/** Звено correction chain (§19.17): история, а не текущее состояние. */
export interface CorrectionChainLink {
  correctionId: string | null;
  evaluationId: string;
  score: number;
  basisLabel: string | null;
  basisNote: string | null;
  comment: string | null;
  supersededReason: string | null;
  supersededAt: string | null;
  current: boolean;
}

export interface SubmittedEvaluationDetailResponse {
  workItem: EvaluationWorkItemView;
  submitted: SubmittedEvaluationView;
  /** null без права на просмотр цепочки исправлений. */
  chain: CorrectionChainLink[] | null;
  bases: EvaluationBasis[];
  /** Решает СЕРВЕР: кнопка, выключенная только на клиенте, — не ограничение. */
  canCorrect: boolean;
  loadedAt: string;
}

export interface SubmitEvaluationRequest {
  score: number;
  basisCode: string | null;
  basisNote: string | null;
  comment: string | null;
  revision: number;
  /** §19.26: повтор с тем же ключом не создаёт вторую оценку. Ключ случайный. */
  idempotencyKey: string;
}

export interface SubmitEvaluationResponse {
  workItem: EvaluationWorkItemView;
  submitted: SubmittedEvaluationView;
  queue: QueueCounters;
}

export interface CorrectEvaluationRequest extends SubmitEvaluationRequest {
  /** §19.18 шаг 6: обязательная причина исправления. */
  reason: string;
}

export interface CorrectEvaluationResponse {
  workItem: EvaluationWorkItemView;
  submitted: SubmittedEvaluationView;
  chain: CorrectionChainLink[] | null;
}

/** Подробности конфликта редакций (§19.25): актуальные значения для diff. */
export interface EvaluationConflictDetails {
  currentRevision: number;
  currentScore: number | null;
  currentBasisLabel: string | null;
  currentComment: string | null;
  currentEvaluationId: string | null;
}

export interface EvaluationRegistryOptions {
  events: { value: string; label: string }[];
  units: { value: string; label: string }[];
  employees: { value: string; label: string }[];
}

export interface EvaluationRegistryResponse {
  results: EvaluationRegistryRow[];
  total: number;
  page: number;
  pageCount: number;
  options: EvaluationRegistryOptions;
  policy: RatingPolicy | null;
  capabilities: { operationalRatings: boolean };
  columns: { sensitiveDetails: boolean };
  unavailableViews: UnavailableRatingFactor[];
}

export interface RatingEmployeeDetailResponse {
  employeeId: string;
  safeLabel: string;
  unitSafeLabel: string;
  summary: OperationalRatingSummary;
  points: RatingDynamicsPoint[];
  unavailableViews: UnavailableRatingFactor[];
}

export interface RatingNotificationsResponse {
  results: RatingNotification[];
  unavailableViews: UnavailableRatingFactor[];
}

export interface RatingAuditResponse {
  results: RatingAuditEntry[];
  total: number;
  page: number;
  pageCount: number;
  unavailableViews: UnavailableRatingFactor[];
}

export interface RatingAnalyticsResponse {
  policy: RatingPolicy | null;
  periodStartsAt: string | null;
  periodEndsAt: string | null;
  calculatedAt: string;
  suppressionMinGroupSize: number | null;
  figures: RatingAnalyticsFigures | null;
  unpublishedReason:
    | "FEATURE_DISABLED"
    | "POLICY_UNDEFINED"
    | "SUPPRESSION_UNDEFINED"
    | null;
  capabilities: { operationalRatings: boolean };
  unavailableViews: UnavailableRatingFactor[];
}

export interface CreateRatingExportRequest {
  scope: RatingExportScope;
  format: RatingExportFormat;
  idempotencyKey: string;
}

export interface CreateRatingExportResponse {
  job: RatingExportJob;
}

export type RatingExportArtifactSummary = Omit<RatingExportArtifact, "content">;

export interface ListRatingExportsResponse {
  results: RatingExportJob[];
  artifacts: RatingExportArtifactSummary[];
  formats: RatingExportFormat[];
  unavailableFormats: UnavailableRatingFactor[];
  unavailableScopes: UnavailableRatingFactor[];
  capabilities: { operationalRatings: boolean };
  serverTime: string;
}

export interface CancelRatingExportResponse {
  job: RatingExportJob;
}

export interface DownloadRatingExportResponse {
  fileName: string;
  content: string;
}

// ── Расчёт агрегата (серверная сторона мока) ─────────────────────────────

export function includedEvaluations(
  evaluations: readonly EventEvaluation[],
  employeeId: string,
  periodStartsAt: string,
  periodEndsAt: string
): EventEvaluation[] {
  return evaluations.filter(
    (item) =>
      item.employeeId === employeeId &&
      item.supersededById === null &&
      item.evaluatedAt >= periodStartsAt &&
      item.evaluatedAt <= periodEndsAt
  );
}

/** Начало периода: `periodDays` суток назад от бизнес-даты включительно. */
export function periodStart(businessDate: string, periodDays: number): string {
  const start =
    Date.UTC(
      Number(businessDate.slice(0, 4)),
      Number(businessDate.slice(5, 7)) - 1,
      Number(businessDate.slice(8, 10))
    ) -
    (periodDays - 1) * 86_400_000;
  return new Date(start).toISOString().slice(0, 10);
}

/** Округляет СЕРВЕР до одного знака — фронту это запрещено (§19.19). */
export function roundAggregate(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Сводка одного сотрудника. Порядок проверок значим: выключенная функция →
 * отсутствующая методика → счёт оценок, иначе человек увидел бы «недостаточно
 * данных» там, где данные ни при чём.
 */
export function buildSummary(input: {
  employeeId: string;
  /** Кадровая ссылка участника; не передали — связи нет (Plane №96). */
  personnelId?: string | null;
  safeLabel: string;
  evaluations: readonly EventEvaluation[];
  policy: RatingPolicy | null;
  featureEnabled: boolean;
  businessDate: string;
  calculatedAt: string;
}): OperationalRatingSummary {
  const base = {
    employeeId: input.employeeId,
    personnelId: input.personnelId ?? null,
    safeLabel: input.safeLabel,
    aggregateRating: null,
    evaluationsCount: 0,
    periodStartsAt: null,
    periodEndsAt: null,
    calculationPolicyVersion: input.policy?.policyVersion ?? null,
    calculatedAt: input.calculatedAt,
  };
  if (!input.featureEnabled) {
    return {
      ...base,
      calculationPolicyVersion: null,
      dataState: "FEATURE_DISABLED",
    };
  }
  if (input.policy === null) {
    return { ...base, dataState: "POLICY_UNDEFINED" };
  }
  const periodStartsAt = periodStart(input.businessDate, input.policy.periodDays);
  const included = includedEvaluations(
    input.evaluations,
    input.employeeId,
    periodStartsAt,
    input.businessDate
  );
  const withPeriod = {
    ...base,
    evaluationsCount: included.length,
    periodStartsAt,
    periodEndsAt: input.businessDate,
  };
  if (included.length < input.policy.minEvaluations) {
    return { ...withPeriod, dataState: "INSUFFICIENT_DATA" };
  }
  const sum = included.reduce((acc, item) => acc + item.score, 0);
  return {
    ...withPeriod,
    aggregateRating: roundAggregate(sum / included.length),
    dataState: "READY",
  };
}

export const DATA_STATE_LABEL: Record<RatingDataState, string> = {
  READY: "Рассчитан",
  INSUFFICIENT_DATA: "Недостаточно данных",
  POLICY_UNDEFINED: "Методика расчёта не определена",
  FEATURE_DISABLED: "Оперативный рейтинг пока недоступен",
};

// ── Правила формы оценивания (§19.9-19.10) — одно правило на клиент и мок ─

export type SubmissionField =
  | "score"
  | "basisCode"
  | "basisNote"
  | "comment"
  | "reason";

export interface SubmissionViolation {
  code:
    | "SCORE_OUT_OF_SCALE"
    | "SCORE_NOT_INTEGER"
    | "BASIS_REQUIRED"
    | "BASIS_UNKNOWN"
    | "BASIS_NOTE_REQUIRED"
    | "COMMENT_REQUIRED"
    | "CORRECTION_REASON_REQUIRED";
  field: SubmissionField;
  message: string;
}

export interface SubmissionInput {
  score: number;
  basisCode: string | null;
  basisNote: string | null;
  comment: string | null;
}

/** Первое нарушение или null — порядок проверок значим. */
export function validateSubmission(
  input: SubmissionInput,
  bases: readonly EvaluationBasis[]
): SubmissionViolation | null {
  if (!Number.isInteger(input.score)) {
    return {
      code: "SCORE_NOT_INTEGER",
      field: "score",
      message: "Оценка выставляется целым значением шкалы.",
    };
  }
  if (input.score < RATING_SCALE_MIN || input.score > RATING_SCALE_MAX) {
    return {
      code: "SCORE_OUT_OF_SCALE",
      field: "score",
      message: `Оценка вне шкалы ${RATING_SCALE_MIN}–${RATING_SCALE_MAX}.`,
    };
  }
  const basisCode = input.basisCode ?? "";
  if (basisCode === "") {
    return {
      code: "BASIS_REQUIRED",
      field: "basisCode",
      message: "Укажите основание оценки.",
    };
  }
  const basis = bases.find((item) => item.code === basisCode);
  if (basis === undefined) {
    return {
      code: "BASIS_UNKNOWN",
      field: "basisCode",
      message: "Неизвестное основание оценки.",
    };
  }
  if (basis.requiresNote && (input.basisNote ?? "").trim() === "") {
    return {
      code: "BASIS_NOTE_REQUIRED",
      field: "basisNote",
      message: `Основание «${basis.label}» требует пояснения.`,
    };
  }
  // §19.10: основание НЕ заменяет обязательный комментарий при значении ниже 8.
  if (
    input.score < RATING_DEFAULT_SCORE &&
    (input.comment ?? "").trim() === ""
  ) {
    return {
      code: "COMMENT_REQUIRED",
      field: "comment",
      message: `Оценка ниже ${RATING_DEFAULT_SCORE} требует комментария с конкретной причиной.`,
    };
  }
  return null;
}

export interface CorrectionInput extends SubmissionInput {
  reason: string | null;
}

/** §19.18 шаг 7: ТО ЖЕ правило формы + ровно одно своё — причина исправления. */
export function validateCorrection(
  input: CorrectionInput,
  bases: readonly EvaluationBasis[]
): SubmissionViolation | null {
  const base = validateSubmission(input, bases);
  if (base !== null) return base;
  if ((input.reason ?? "").trim() === "") {
    return {
      code: "CORRECTION_REASON_REQUIRED",
      field: "reason",
      message: "Укажите причину исправления оценки.",
    };
  }
  return null;
}

/** Строка diff §19.18 шаг 8 — только изменившееся. */
export interface CorrectionDiffRow {
  field: "score" | "basis" | "basisNote" | "comment";
  label: string;
  before: string;
  after: string;
}

function diffText(value: string | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? "—" : trimmed;
}

export function buildCorrectionDiff(
  before: {
    score: number;
    basisLabel: string | null;
    basisNote: string | null;
    comment: string | null;
  },
  after: {
    score: number;
    basisLabel: string | null;
    basisNote: string | null;
    comment: string | null;
  }
): CorrectionDiffRow[] {
  const rows: CorrectionDiffRow[] = [
    {
      field: "score",
      label: "Оценка",
      before: String(before.score),
      after: String(after.score),
    },
    {
      field: "basis",
      label: "Основание",
      before: diffText(before.basisLabel),
      after: diffText(after.basisLabel),
    },
    {
      field: "basisNote",
      label: "Пояснение к основанию",
      before: diffText(before.basisNote),
      after: diffText(after.basisNote),
    },
    {
      field: "comment",
      label: "Комментарий",
      before: diffText(before.comment),
      after: diffText(after.comment),
    },
  ];
  return rows.filter((row) => row.before !== row.after);
}

// ── Очередь и прогресс (§19.14) ──────────────────────────────────────────

export interface QueueCounters {
  total: number;
  submitted: number;
  remaining: number;
}

export function summarizeQueue(
  items: readonly EvaluationWorkItem[]
): QueueCounters {
  const submitted = items.filter((item) => item.status === "SUBMITTED").length;
  return { total: items.length, submitted, remaining: items.length - submitted };
}

export interface EventProgress {
  participants: number;
  counters: QueueCounters;
  byDirection: { direction: EvaluationDirection; counters: QueueCounters }[];
}

export function summarizeEventProgress(
  items: readonly EvaluationWorkItem[]
): EventProgress {
  const directions = [...new Set(items.map((item) => item.evaluationDirection))];
  return {
    participants: new Set(
      items.map((item) => item.targetEmployeeId ?? item.targetGroupId ?? item.id)
    ).size,
    counters: summarizeQueue(items),
    byDirection: directions.map((direction) => ({
      direction,
      counters: summarizeQueue(
        items.filter((item) => item.evaluationDirection === direction)
      ),
    })),
  };
}

export const DIRECTION_LABEL: Record<EvaluationDirection, string> = {
  SENIOR_TO_EMPLOYEE: "Старший → сотрудник",
  SENIOR_TO_GROUP: "Групповая оценка",
  EMPLOYEE_TO_SENIOR: "Сотрудник → старший",
};

export const WORK_ITEM_STATUS_LABEL: Record<EvaluationWorkItemStatus, string> = {
  PENDING: "Не отправлено",
  SUBMITTED: "Отправлено",
};

// ── Реестр итоговых оценок (§19.15-19.16) ────────────────────────────────

export const REGISTRY_PAGE_SIZE = 10;

/** Подпись вместо закрытых величин (§19.16, дословно). */
export const CLOSED_DETAILS_LABEL = "Детали оценки закрыты";

/** Строка реестра: ни score, ни комментария, ни основания, ни оценщика. */
export interface EvaluationRegistryRow {
  rowId: string;
  /** КОД УЧАСТНИКА рейтинга (`employee-<id>`), а не кадровый id. */
  employeeId: string;
  /** Кадровый id того же человека (Plane №655); `null` — участник не связан
   *  с кадрами. Отдан рядом, чтобы читателю с кадровым id на руках (профиль
   *  сотрудника, расстановка) не пришлось знать форму кода участника. */
  personnelId: string | null;
  employeeSafeLabel: string;
  unitSafeLabel: string;
  eventNumber: string;
  eventTitle: string;
  objectLabel: string;
  postLabel: string | null;
  /** null — сведений нет, и это не «не участвовал». */
  participated: boolean | null;
  evaluationDirection: EvaluationDirection;
  method: EvaluationMethod;
  evaluatedAt: string;
  /** Признак исправления — по correction chain, не сравнением значений. */
  corrected: boolean;
  aggregateRating: number | null;
  aggregateState: RatingDataState;
}

export interface RegistryFilters {
  from: string | null;
  to: string | null;
  event: string | null;
  unit: string | null;
  employee: string | null;
  direction: EvaluationDirection | null;
  method: EvaluationMethod | null;
  correctedOnly: boolean;
  search: string;
  page: number;
}

export const EMPTY_FILTERS: RegistryFilters = {
  from: null,
  to: null,
  event: null,
  unit: null,
  employee: null,
  direction: null,
  method: null,
  correctedOnly: false,
  search: "",
  page: 1,
};

export function matchesFilters(
  row: EvaluationRegistryRow,
  filters: RegistryFilters
): boolean {
  if (filters.from !== null && row.evaluatedAt < filters.from) return false;
  // Границы периода включительны с обеих сторон.
  if (filters.to !== null && row.evaluatedAt > filters.to) return false;
  if (filters.event !== null && `${row.eventNumber}` !== filters.event)
    return false;
  if (filters.unit !== null && row.unitSafeLabel !== filters.unit) return false;
  // Отбор по человеку принимает ОБА идентификатора (Plane №655) — зеркало
  // `_matches_filters` сервера: у раздела рейтинга на руках код участника, у
  // профиля сотрудника и расстановки — кадровый id.
  if (
    filters.employee !== null &&
    row.employeeId !== filters.employee &&
    row.personnelId !== filters.employee
  )
    return false;
  if (filters.direction !== null && row.evaluationDirection !== filters.direction)
    return false;
  if (filters.method !== null && row.method !== filters.method) return false;
  if (filters.correctedOnly && !row.corrected) return false;
  const search = filters.search.trim().toLowerCase();
  if (search !== "") {
    // Поиск только по безопасным подписям: искать по комментарию значило бы
    // раскрывать закрытый текст по одной букве за запрос.
    const haystack = [
      row.employeeSafeLabel,
      row.unitSafeLabel,
      row.eventNumber,
      row.eventTitle,
      row.objectLabel,
      row.postLabel ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

export function registryPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / REGISTRY_PAGE_SIZE));
}

export function registryPageOf<T>(rows: readonly T[], page: number): T[] {
  const safePage = Math.min(Math.max(1, page), registryPageCount(rows.length));
  const start = (safePage - 1) * REGISTRY_PAGE_SIZE;
  return rows.slice(start, start + REGISTRY_PAGE_SIZE);
}

/** Безопасный контекст оценщика (§19.16): роль и способ появления записи,
 * а не человек. Системная оценка называется отдельно. */
export function safeEvaluatorContext(
  method: EvaluationMethod,
  direction: EvaluationDirection,
  corrected: boolean
): string {
  if (method === "SYSTEM_DEFAULT") return "Системная оценка по умолчанию";
  if (corrected) return "Исправление уполномоченным пользователем";
  return direction === "EMPLOYEE_TO_SENIOR"
    ? "Сотрудник → старший"
    : direction === "SENIOR_TO_GROUP"
      ? "Групповая оценка"
      : "Старший → сотрудник";
}

// ── Динамика (§19.20) ────────────────────────────────────────────────────

export interface RatingDynamicsSegment {
  policyVersion: string;
  points: RatingDynamicsPoint[];
}

/**
 * Разрез ряда на однородные отрезки: линия рвётся на смене policyVersion и на
 * точке без агрегата — соединить соседей через пропуск значило бы нарисовать
 * значение, которого не было, а положить его на ноль запрещено прямо.
 */
export function segmentDynamics(
  points: readonly RatingDynamicsPoint[]
): RatingDynamicsSegment[] {
  const segments: RatingDynamicsSegment[] = [];
  let current: RatingDynamicsSegment | null = null;
  for (const point of points) {
    if (point.aggregateRating === null) {
      current = null;
      continue;
    }
    if (current === null || current.policyVersion !== point.policyVersion) {
      current = { policyVersion: point.policyVersion, points: [] };
      segments.push(current);
    }
    current.points.push(point);
  }
  return segments;
}

/** Границы смены методики — по ВСЕМУ ряду, включая точки без агрегата. */
export function policyBoundaries(
  points: readonly RatingDynamicsPoint[]
): RatingPolicyBoundary[] {
  const boundaries: RatingPolicyBoundary[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous.policyVersion === point.policyVersion) continue;
    boundaries.push({
      period: point.period,
      fromPolicyVersion: previous.policyVersion,
      toPolicyVersion: point.policyVersion,
    });
  }
  return boundaries;
}

// ── Аналитика (§22.16-22.17) ─────────────────────────────────────────────

/** Полосы распределения: границы полуоткрытые, восьмёрка начинает свою полосу. */
export const DISTRIBUTION_BANDS: readonly {
  code: string;
  label: string;
  from: number;
  toExclusive: number;
}[] = [
  { code: "BAND_BELOW_5", label: "ниже 5", from: 1, toExclusive: 5 },
  { code: "BAND_5_7", label: "5,0–6,9", from: 5, toExclusive: 7 },
  { code: "BAND_7_8", label: "7,0–7,9", from: 7, toExclusive: 8 },
  {
    code: "BAND_8_9",
    label: "8,0–8,9 (стандартное выполнение — 8)",
    from: 8,
    toExclusive: 9,
  },
  // Верхняя полоса замкнута: 10 — конец шкалы.
  { code: "BAND_9_10", label: "9,0–10", from: 9, toExclusive: 10.0001 },
];

export type RatingGroupState = "READY" | "SUPPRESSED" | "NO_AGGREGATE";

export interface RatingGroupAggregate {
  groupCode: string;
  safeLabel: string;
  state: RatingGroupState;
  aggregateRating: number | null;
  ratedCount: number;
  memberCount: number;
}

export interface RatingAnalyticsFigures {
  ratedParticipants: number;
  coveredParticipants: number;
  totalParticipants: number;
  withoutAggregate: number;
  correctedEvaluations: number;
  distribution: { code: string; label: string; count: number }[];
  groups: RatingGroupAggregate[];
}

/**
 * Сборка отчёта. Общего среднего по всем НЕТ: вместе со средними и размерами
 * остальных групп оно восстанавливало бы подавленное значение арифметикой.
 */
export function buildRatingAnalytics(input: {
  summaries: readonly OperationalRatingSummary[];
  groups: readonly {
    groupCode: string;
    safeLabel: string;
    members: readonly string[];
  }[];
  minGroupSize: number;
  correctedEvaluations: number;
}): RatingAnalyticsFigures {
  const ready = input.summaries.filter((item) => item.dataState === "READY");

  const distribution = DISTRIBUTION_BANDS.map((band) => ({
    code: band.code,
    label: band.label,
    count: ready.filter(
      (item) =>
        item.aggregateRating !== null &&
        item.aggregateRating >= band.from &&
        item.aggregateRating < band.toExclusive
    ).length,
  }));

  const groups = input.groups.map<RatingGroupAggregate>((group) => {
    const members = input.summaries.filter((item) =>
      group.members.includes(item.employeeId)
    );
    const rated = members.filter((item) => item.aggregateRating !== null);
    if (rated.length === 0) {
      return {
        groupCode: group.groupCode,
        safeLabel: group.safeLabel,
        state: "NO_AGGREGATE",
        aggregateRating: null,
        ratedCount: 0,
        memberCount: members.length,
      };
    }
    if (rated.length < input.minGroupSize) {
      // §22.17: группа мала для безопасной агрегации — значение не считается
      // вовсе, «посчитать и не показать» оставило бы его в ответе API.
      return {
        groupCode: group.groupCode,
        safeLabel: group.safeLabel,
        state: "SUPPRESSED",
        aggregateRating: null,
        ratedCount: rated.length,
        memberCount: members.length,
      };
    }
    const sum = rated.reduce((acc, item) => acc + (item.aggregateRating ?? 0), 0);
    return {
      groupCode: group.groupCode,
      safeLabel: group.safeLabel,
      state: "READY",
      aggregateRating: roundAggregate(sum / rated.length),
      ratedCount: rated.length,
      memberCount: members.length,
    };
  });

  // Порядок групп — по подписи: сортировка по значению и есть «место»,
  // прямо запрещённое §22.16.
  groups.sort((a, b) => a.safeLabel.localeCompare(b.safeLabel, "ru"));

  return {
    ratedParticipants: ready.length,
    coveredParticipants: input.summaries.filter(
      (item) => item.evaluationsCount > 0
    ).length,
    totalParticipants: input.summaries.length,
    withoutAggregate: input.summaries.filter((item) => item.dataState !== "READY")
      .length,
    correctedEvaluations: input.correctedEvaluations,
    distribution,
    groups,
  };
}

// ── Экспорт (§19.29) ─────────────────────────────────────────────────────

export const RATING_EXPORT_FORMATS: readonly RatingExportFormat[] = ["CSV"];

export interface ExportViolation {
  code: string;
  message: string;
}

/** Проверка заказа: индивидуальная выгрузка не выдаётся вовсе (§19.21). */
export function validateExportRequest(input: {
  scope: RatingExportScope;
  format: RatingExportFormat;
}): ExportViolation | null {
  if (input.scope === "INDIVIDUAL") {
    return {
      code: "SENSITIVE_EXPORT_UNAVAILABLE",
      message:
        "Выгрузка индивидуальных оценок не выдаётся: закрытые данные требуют scope и срока полномочия, которых в этой сборке нет (§19.21).",
    };
  }
  if (!RATING_EXPORT_FORMATS.includes(input.format)) {
    return {
      code: "EXPORT_FORMAT_UNAVAILABLE",
      message: "Формат не собирается в этой сборке: доступен CSV.",
    };
  }
  return null;
}

/** Экранирование поля CSV — кавычки удваиваются, поле с разделителем в кавычках. */
export function csvField(value: string): string {
  return /[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const AGGREGATE_EXPORT_COLUMNS: readonly string[] = [
  "Участник",
  "Агрегат",
  "Учтено оценок",
  "Период с",
  "Период по",
  "Методика",
  "Состояние",
];

const EXPORT_STATE_LABEL: Record<OperationalRatingSummary["dataState"], string> =
  {
    READY: "Рассчитан",
    INSUFFICIENT_DATA: "Недостаточно оценок",
    POLICY_UNDEFINED: "Методика не определена",
    FEATURE_DISABLED: "Функция выключена",
  };

/** Содержимое агрегированной выгрузки: пропуск — пустая клетка, не ноль. */
export function buildAggregateExportContent(
  summaries: readonly OperationalRatingSummary[],
  policy: RatingPolicy | null
): string {
  const lines = [
    `# Оперативный рейтинг: агрегированная сводка${
      policy === null ? "" : `, методика ${policy.policyVersion}`
    }`,
    AGGREGATE_EXPORT_COLUMNS.map(csvField).join(";"),
  ];
  for (const summary of summaries) {
    lines.push(
      [
        summary.safeLabel,
        summary.aggregateRating === null
          ? ""
          : summary.aggregateRating.toFixed(1),
        String(summary.evaluationsCount),
        summary.periodStartsAt ?? "",
        summary.periodEndsAt ?? "",
        summary.calculationPolicyVersion ?? "",
        EXPORT_STATE_LABEL[summary.dataState],
      ]
        .map(csvField)
        .join(";")
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Имя файла собирает СЕРВЕР — вместе с содержимым. */
export function exportFileName(
  scope: RatingExportScope,
  format: RatingExportFormat,
  businessDate: string
): string {
  const prefix =
    scope === "AGGREGATE" ? "operational-rating-aggregate" : "operational-rating";
  return `${prefix}-${businessDate}.${format.toLowerCase()}`;
}

// ── Ключ идемпотентности (§19.26) ────────────────────────────────────────

let fallbackCounter = 0;

/** Ключ живёт одну форму и переживает её повторные отправки. Значений записи
 * в нём нет — он случайный. */
export function newIdempotencyKey(): string {
  const api = globalThis.crypto;
  if (api !== undefined && typeof api.randomUUID === "function") {
    return api.randomUUID();
  }
  fallbackCounter += 1;
  return `idem-${fallbackCounter}-${Date.now()}`;
}
