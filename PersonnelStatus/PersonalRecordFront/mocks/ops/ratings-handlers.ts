// Мок-слой оперативного рейтинга (§19): агрегат считает СЕРВЕР, закрытые
// оценки наружу не едут ни одним полем, отсутствие агрегата — состояние, а не
// ноль. Методика читается из общего стора «Настроек» (readRatingPolicy):
// правка порогов на /security-ops/settings меняет исход расчёта здесь.
//
// Демо-персона хоста — demo-admin с wildcard-правом (см. identity.ts), поэтому
// серверные проверки прав здесь всегда проходят; закрытость данных при этом
// обеспечивается ФОРМОЙ ответов (проекции собираются полем за полем), а отбор
// «только своё» — сравнением с актором. Чужие задания (demo-recon-officer)
// в очередь и в отправленные не попадают, а их карточка отвечает 404.
import { http, HttpResponse } from "msw";
import {
  EVALUATION_CORRECT_PATH_PATTERN,
  EVALUATION_DETAIL_PATH_PATTERN,
  EVALUATION_REGISTRY_PATH,
  EVALUATION_SUBMIT_PATH_PATTERN,
  EVALUATION_WORKSPACE_PATH,
  OPERATIONAL_RATINGS_PATH,
  OPERATIONAL_RATING_DYNAMICS_PATH,
  RATING_ANALYTICS_PATH,
  RATING_AUDIT_PATH,
  RATING_EMPLOYEE_DETAIL_PATH,
  RATING_EXPORTS_PATH,
  RATING_EXPORT_CANCEL_PATH_PATTERN,
  RATING_EXPORT_DOWNLOAD_PATH_PATTERN,
  RATING_NOTIFICATIONS_PATH,
  RATING_EXPORT_FORMATS,
  buildAggregateExportContent,
  buildRatingAnalytics,
  buildSummary,
  exportFileName,
  matchesFilters,
  policyBoundaries,
  registryPageCount,
  registryPageOf,
  summarizeEventProgress,
  summarizeQueue,
  validateCorrection,
  validateExportRequest,
  validateSubmission,
} from "@/entities/operational-rating";
import type {
  CorrectEvaluationRequest,
  CorrectEvaluationResponse,
  CorrectionChainLink,
  CreateRatingExportRequest,
  EvaluationBasis,
  EvaluationCorrection,
  EvaluationRegistryRow,
  EvaluationWorkItem,
  EvaluationWorkItemView,
  EventEvaluation,
  ListOperationalRatingsResponse,
  ListRatingExportsResponse,
  OperationalRatingSummary,
  RatingAuditEntry,
  RatingAuditEventCode,
  RatingDynamicsPoint,
  RatingExportArtifact,
  RatingExportJob,
  RatingNotification,
  RatingPolicy,
  RegistryFilters,
  SubmitEvaluationRequest,
  SubmitEvaluationResponse,
  SubmittedEvaluationView,
} from "@/entities/operational-rating";
import { readRatingPolicy, readRatingSuppressionMinGroup } from "./settings-store";
import { readSecurityEventsStore } from "./security-events-handlers";

const STORE_KEY = "ops-mock-ratings";

/** Актор мок-стенда — та же учётка, что в настройках и аудите. */
const ACTOR = "demo-admin";
/** Чужой оценщик: без его заданий отбор «только своё» был бы вакуумным. */
const FOREIGN_EVALUATOR = "demo-recon-officer";

// ── Состояние ────────────────────────────────────────────────────────────

interface RatingsState {
  evaluations: EventEvaluation[];
  workItems: EvaluationWorkItem[];
  corrections: EvaluationCorrection[];
  /** §19.26: выполненные операции по ключу — хранится результат-ссылка. */
  idempotency: {
    key: string;
    operation: string;
    workItemId: string;
    evaluationId: string;
  }[];
  /** §19.27: журнал оценивания — СВОЙ, не общий /audit: тот читают люди без
   * права на рейтинг. */
  auditEntries: RatingAuditEntry[];
  notifications: RatingNotification[];
  exportJobs: RatingExportJob[];
  exportArtifacts: RatingExportArtifact[];
  /** §19.20: записанные агрегаты закрытых периодов — НЕ производное от
   * evaluations: пересчитывать прошлое текущей методикой запрещено. */
  dynamicsPoints: RatingDynamicsPoint[];
  /** §19.3: флаги лежат в данных — выключенная функция обязана давать честное
   * состояние недоступности на живом экране. */
  capabilities: { operationalRatings: boolean; ratingConflicts: boolean };
  seq: number;
}

// ── Сид (§8.7: только синтетические данные) ──────────────────────────────

export const RATING_GROUPS: readonly {
  groupCode: string;
  safeLabel: string;
}[] = [
  { groupCode: "division-1", safeLabel: "Первое управление" },
  { groupCode: "division-2", safeLabel: "Второе управление" },
  { groupCode: "division-3", safeLabel: "Третье управление" },
];

/** Участники рейтинга мока.
 *
 * `personnelId` — кадровая ссылка, порт правила сервера (Plane №96): сводка
 * отдаёт её рядом с кодом участника, и расстановка сверяет рейтинг ПО НЕЙ.
 * Здесь она указывает на кадры мока (`emp-N` из `fixtures/personnel`), иначе
 * бейдж рейтинга погас бы на моке ровно так же, как гас на живом стенде, —
 * только теперь ещё и незаметно, потому что мок считался зелёным.
 *
 * Участники третьего управления связи НЕ имеют СОЗНАТЕЛЬНО: на них держится
 * демонстрация подавленной агрегации, и в подборе им делать нечего — заодно
 * мок показывает случай «участник без кадровой записи», который на живом
 * стенде есть у исторических записей сида.
 */
export const RATED_EMPLOYEES: readonly {
  employeeId: string;
  personnelId: string | null;
  safeLabel: string;
  groupCode: string;
}[] = [
  { employeeId: "employee-1", personnelId: "emp-1", safeLabel: "Ерланов Д.", groupCode: "division-1" },
  { employeeId: "employee-2", personnelId: "emp-2", safeLabel: "Абишев Н.", groupCode: "division-1" },
  { employeeId: "employee-3", personnelId: "emp-3", safeLabel: "Сейтказы М.", groupCode: "division-2" },
  { employeeId: "employee-4", personnelId: "emp-4", safeLabel: "Нурланов Е.", groupCode: "division-2" },
  { employeeId: "employee-5", personnelId: "emp-5", safeLabel: "Тлеуов А.", groupCode: "division-1" },
  { employeeId: "employee-6", personnelId: "emp-6", safeLabel: "Жумабек С.", groupCode: "division-1" },
  // Третье управление — два участника с агрегатом: меньше порога безопасной
  // агрегации, на нём держится демонстрация SUPPRESSED (§22.17).
  { employeeId: "employee-7", personnelId: null, safeLabel: "Оспанов Р.", groupCode: "division-3" },
  { employeeId: "employee-8", personnelId: null, safeLabel: "Кайрат Б.", groupCode: "division-3" },
];

/** Мероприятия оценивания — свой перечень (исторические, вне реестра ОМ:
 * карточки ОМ у них нет, поэтому замок закрытого мероприятия к ним неприменим). */
const EVALUATION_EVENTS: readonly {
  securityEventId: string;
  eventRunId: string;
  number: string;
  title: string;
  objectLabel: string;
  actualStartsAt: string;
  actualEndsAt: string;
  stateLabel: string;
}[] = [
  {
    securityEventId: "rating-event-1",
    eventRunId: "run-1",
    number: "ОМ-2026-014",
    title: "Международный форум",
    objectLabel: "Конгресс-холл",
    actualStartsAt: "2026-07-18T07:40:00+05:00",
    actualEndsAt: "2026-07-18T19:20:00+05:00",
    stateLabel: "Завершено",
  },
  {
    securityEventId: "rating-event-2",
    eventRunId: "run-2",
    number: "ОМ-2026-015",
    title: "Рабочая поездка",
    objectLabel: "Аэропорт",
    actualStartsAt: "2026-07-20T05:10:00+05:00",
    actualEndsAt: "2026-07-20T12:05:00+05:00",
    stateLabel: "Завершено",
  },
];

/** Основания оценки (§19.10) — отдаёт сервер, коды свои (бэкенда нет). */
const EVALUATION_BASES: readonly EvaluationBasis[] = [
  { code: "EXECUTION_OF_DUTIES", label: "Исполнение обязанностей", requiresNote: false },
  { code: "TIMELY_ARRIVAL", label: "Своевременное прибытие", requiresNote: false },
  { code: "DISCIPLINE", label: "Дисциплина", requiresNote: false },
  { code: "POST_KNOWLEDGE", label: "Знание задач поста", requiresNote: false },
  { code: "ORDERS_EXECUTION", label: "Исполнение указаний", requiresNote: false },
  { code: "INTERACTION", label: "Взаимодействие", requiresNote: false },
  {
    code: "NON_STANDARD_SITUATION",
    label: "Действия в нестандартной ситуации",
    requiresNote: false,
  },
  // §19.10: «Другое» требует пояснения по policy.
  { code: "OTHER", label: "Другое", requiresNote: true },
];

function seedEvaluation(
  id: string,
  employeeId: string,
  score: number,
  evaluatedAt: string,
  extra: Partial<EventEvaluation> = {}
): EventEvaluation {
  return {
    id,
    securityEventId: "rating-event-1",
    employeeId,
    evaluatorUserId: ACTOR,
    score,
    // Комментарий обязателен при оценке НИЖЕ 8 — в сиде он есть ровно там.
    comment: score < 8 ? "Задержка на инструктаже, разобрано со старшим" : null,
    evaluationDirection: "SENIOR_TO_EMPLOYEE",
    method: "MANUAL",
    basisCode: score < 8 ? "TIMELY_ARRIVAL" : "EXECUTION_OF_DUTIES",
    basisNote: null,
    evaluatedAt,
    supersededById: null,
    ...extra,
  };
}

/**
 * Оценки: числа намеренно не круглые (среднее 8,0 скрыло бы подмену расчёта
 * константой). employee-1 несёт ВЫТЕСНЕННУЮ запись (evaluation-4→5),
 * employee-3 — меньше минимума, employee-4 — только системная восьмёрка вне
 * периода: рейтинг отсутствует, а не равен нулю.
 */
const SEED_EVALUATIONS: readonly EventEvaluation[] = [
  seedEvaluation("evaluation-1", "employee-1", 9, "2026-07-02"),
  seedEvaluation("evaluation-2", "employee-1", 8, "2026-07-08"),
  seedEvaluation("evaluation-3", "employee-1", 7, "2026-07-11"),
  seedEvaluation("evaluation-4", "employee-1", 3, "2026-07-14", {
    supersededById: "evaluation-5",
    comment: "Оценка выставлена по ошибке не тому участнику",
  }),
  seedEvaluation("evaluation-5", "employee-1", 9, "2026-07-15"),
  seedEvaluation("evaluation-6", "employee-1", 10, "2026-07-17"),

  seedEvaluation("evaluation-7", "employee-2", 6, "2026-07-05"),
  seedEvaluation("evaluation-8", "employee-2", 8, "2026-07-09"),
  seedEvaluation("evaluation-9", "employee-2", 7, "2026-07-13"),
  seedEvaluation("evaluation-10", "employee-2", 9, "2026-07-18"),

  // Оценка ЧУЖОГО оценщика: без неё «в отправленных только свои» было бы
  // вакуумным утверждением.
  seedEvaluation("evaluation-11", "employee-3", 8, "2026-07-06", {
    evaluatorUserId: FOREIGN_EVALUATOR,
  }),
  seedEvaluation("evaluation-12", "employee-3", 9, "2026-07-16"),

  // Системная восьмёрка вне периода (§19.8): оценщика нет — приписать её
  // человеку значило бы сказать, что он этого участника смотрел.
  seedEvaluation("evaluation-13", "employee-4", 8, "2025-11-04", {
    evaluatorUserId: null,
    method: "SYSTEM_DEFAULT",
    basisCode: null,
  }),

  seedEvaluation("evaluation-14", "employee-5", 9, "2026-07-03"),
  seedEvaluation("evaluation-15", "employee-5", 10, "2026-07-07"),
  seedEvaluation("evaluation-16", "employee-5", 9, "2026-07-12"),
  seedEvaluation("evaluation-17", "employee-5", 9, "2026-07-16"),

  seedEvaluation("evaluation-18", "employee-6", 7, "2026-07-04"),
  seedEvaluation("evaluation-19", "employee-6", 6, "2026-07-08"),
  seedEvaluation("evaluation-20", "employee-6", 7, "2026-07-12"),
  seedEvaluation("evaluation-21", "employee-6", 7, "2026-07-17"),

  seedEvaluation("evaluation-22", "employee-7", 8, "2026-07-02"),
  seedEvaluation("evaluation-23", "employee-7", 8, "2026-07-09"),
  seedEvaluation("evaluation-24", "employee-7", 8, "2026-07-14"),
  seedEvaluation("evaluation-25", "employee-7", 8, "2026-07-18"),

  seedEvaluation("evaluation-26", "employee-8", 9, "2026-07-05"),
  seedEvaluation("evaluation-27", "employee-8", 10, "2026-07-10"),
  seedEvaluation("evaluation-28", "employee-8", 9, "2026-07-15"),
  seedEvaluation("evaluation-29", "employee-8", 8, "2026-07-19"),
];

/** Редакции методики, под которыми ЗАКРЫВАЛИСЬ периоды. Обе — прошлые:
 * текущая редакция «Настроек» ни одного периода ещё не закрывала. */
const POLICY_V1 = "OPERATIONAL-RATING-2026.01.1";
const POLICY_V2 = "OPERATIONAL-RATING-2026.05.1";

const CLOSED_PERIODS: readonly {
  period: string;
  periodStartsAt: string;
  periodEndsAt: string;
  policyVersion: string;
}[] = [
  { period: "2026-03", periodStartsAt: "2026-03-01", periodEndsAt: "2026-03-31", policyVersion: POLICY_V1 },
  { period: "2026-04", periodStartsAt: "2026-04-01", periodEndsAt: "2026-04-30", policyVersion: POLICY_V1 },
  { period: "2026-05", periodStartsAt: "2026-05-01", periodEndsAt: "2026-05-31", policyVersion: POLICY_V2 },
  { period: "2026-06", periodStartsAt: "2026-06-01", periodEndsAt: "2026-06-30", policyVersion: POLICY_V2 },
];

/** Значения точек: у employee-1 пропуск на смене методики, у employee-3 по
 * краям, у employee-4 агрегата не было никогда. */
const DYNAMICS_VALUES: readonly {
  employeeId: string;
  values: readonly (readonly [number | null, number])[];
}[] = [
  { employeeId: "employee-1", values: [[8.1, 6], [7.9, 5], [null, 2], [8.6, 7]] },
  { employeeId: "employee-2", values: [[7.2, 4], [7.6, 5], [7.4, 4], [7.9, 6]] },
  { employeeId: "employee-3", values: [[null, 1], [8.3, 4], [8.0, 5], [null, 3]] },
  { employeeId: "employee-4", values: [[null, 0], [null, 0], [null, 0], [null, 0]] },
];

const DYNAMICS_POINTS: readonly RatingDynamicsPoint[] = DYNAMICS_VALUES.flatMap(
  (row) =>
    CLOSED_PERIODS.map((closed, index) => {
      const [aggregateRating, evaluationsCount] = row.values[index];
      return {
        employeeId: row.employeeId,
        period: closed.period,
        periodStartsAt: closed.periodStartsAt,
        periodEndsAt: closed.periodEndsAt,
        aggregateRating,
        evaluationsCount,
        policyVersion: closed.policyVersion,
        dataState:
          aggregateRating === null
            ? ("INSUFFICIENT_DATA" as const)
            : ("READY" as const),
        recordedAt: `${closed.periodEndsAt}T23:59:00+05:00`,
      };
    })
);

function seedWorkItem(
  id: string,
  overrides: Partial<EvaluationWorkItem> & {
    securityEventId: string;
    evaluatorUserId: string;
    targetEmployeeId: string;
    postLabel: string;
  }
): EvaluationWorkItem {
  const event = EVALUATION_EVENTS.find(
    (item) => item.securityEventId === overrides.securityEventId
  );
  const target = RATED_EMPLOYEES.find(
    (item) => item.employeeId === overrides.targetEmployeeId
  );
  const group = RATING_GROUPS.find(
    (item) => item.groupCode === target?.groupCode
  );
  return {
    id,
    eventRunId: event?.eventRunId ?? "run-0",
    assignmentId: `assignment-${id}`,
    targetGroupId: null,
    targetSafeLabel: target?.safeLabel ?? "—",
    targetSafeUnitLabel: group?.safeLabel ?? "—",
    actualStartsAt: event?.actualStartsAt ?? "",
    actualEndsAt: event?.actualEndsAt ?? "",
    participated: true,
    evaluationDirection: "SENIOR_TO_EMPLOYEE",
    // Начальное значение даёт СЕРВЕР (§19.8).
    initialScore: 8,
    status: "PENDING",
    revision: 1,
    submittedEvaluationId: null,
    submittedAt: null,
    ...overrides,
  };
}

/**
 * Задания (§19.7): у актора задания в двух мероприятиях (отбор по мероприятию
 * проверяем), одно уже отправлено, одно «снизу вверх», у одного участника
 * НЕучастие (оценку не принимает), и есть задания чужого оценщика — они видны
 * только в сводке мероприятия.
 */
const SEED_WORK_ITEMS: readonly EvaluationWorkItem[] = [
  seedWorkItem("work-item-1", {
    securityEventId: "rating-event-1",
    evaluatorUserId: ACTOR,
    targetEmployeeId: "employee-1",
    postLabel: "Пост 1 — главный вход",
  }),
  seedWorkItem("work-item-2", {
    securityEventId: "rating-event-1",
    evaluatorUserId: ACTOR,
    targetEmployeeId: "employee-2",
    postLabel: "Пост 2 — зона делегаций",
    // Заявлен, но не присутствовал: факт участия — не наличие задания.
    participated: false,
  }),
  seedWorkItem("work-item-3", {
    securityEventId: "rating-event-1",
    evaluatorUserId: ACTOR,
    targetEmployeeId: "employee-5",
    postLabel: "Старший смены",
    evaluationDirection: "EMPLOYEE_TO_SENIOR",
  }),
  seedWorkItem("work-item-4", {
    securityEventId: "rating-event-1",
    evaluatorUserId: ACTOR,
    targetEmployeeId: "employee-6",
    postLabel: "Пост 3 — периметр",
    status: "SUBMITTED",
    revision: 2,
    submittedEvaluationId: "evaluation-21",
    submittedAt: "2026-07-18T20:05:00+05:00",
  }),
  // Задание с УЖЕ исправленной оценкой: его запись — evaluation-5, замещающая
  // evaluation-4 (см. SEED_CORRECTIONS). Отсюда открывается correction chain.
  seedWorkItem("work-item-9", {
    securityEventId: "rating-event-1",
    evaluatorUserId: ACTOR,
    targetEmployeeId: "employee-1",
    postLabel: "Пост 1 — главный вход (повторная смена)",
    status: "SUBMITTED",
    revision: 3,
    submittedEvaluationId: "evaluation-5",
    submittedAt: "2026-07-15T09:20:00+05:00",
  }),
  seedWorkItem("work-item-5", {
    securityEventId: "rating-event-2",
    evaluatorUserId: ACTOR,
    targetEmployeeId: "employee-7",
    postLabel: "Пост 1 — накопитель",
  }),
  // Чужие задания: не в очереди и не в отправленных актора, но в сводке
  // мероприятия — она считает работу ВСЕХ оценщиков.
  seedWorkItem("work-item-6", {
    securityEventId: "rating-event-1",
    evaluatorUserId: FOREIGN_EVALUATOR,
    targetEmployeeId: "employee-8",
    postLabel: "Пост 4 — стоянка",
  }),
  seedWorkItem("work-item-7", {
    securityEventId: "rating-event-1",
    evaluatorUserId: FOREIGN_EVALUATOR,
    targetEmployeeId: "employee-3",
    postLabel: "Пост 5 — служебный вход",
    status: "SUBMITTED",
    revision: 2,
    submittedEvaluationId: "evaluation-11",
    submittedAt: "2026-07-18T20:40:00+05:00",
  }),
  seedWorkItem("work-item-8", {
    securityEventId: "rating-event-1",
    evaluatorUserId: ACTOR,
    targetEmployeeId: "employee-4",
    postLabel: "Пост 6 — пресс-центр",
  }),
];

const SEED_CORRECTIONS: readonly EvaluationCorrection[] = [
  {
    id: "correction-1",
    originalEvaluationId: "evaluation-4",
    replacementEvaluationId: "evaluation-5",
    reason: "Оценка выставлена по ошибке не тому участнику",
    correctedBy: ACTOR,
    correctedAt: "2026-07-15T09:20:00+05:00",
    revision: 1,
  },
];

const SEED_AUDIT: readonly RatingAuditEntry[] = [
  {
    id: "rating-audit-1",
    occurredAt: "2026-07-18T20:05:00+05:00",
    actorUserId: ACTOR,
    eventCode: "EVALUATION_SUBMITTED",
    outcome: "SUCCESS",
    reasonCode: null,
    securityEventId: "rating-event-1",
    eventRunId: "run-1",
    assignmentId: "assignment-work-item-4",
    evaluationId: "evaluation-21",
    correctionId: null,
    requestId: "seed-request-1",
    revision: 2,
  },
  {
    id: "rating-audit-2",
    occurredAt: "2026-07-15T09:20:00+05:00",
    actorUserId: ACTOR,
    eventCode: "EVALUATION_CORRECTED",
    outcome: "SUCCESS",
    reasonCode: null,
    securityEventId: "rating-event-1",
    eventRunId: "run-1",
    assignmentId: "assignment-work-item-9",
    evaluationId: "evaluation-5",
    correctionId: "correction-1",
    requestId: "seed-request-2",
    revision: 3,
  },
];

const SEED_NOTIFICATIONS: readonly RatingNotification[] = [
  {
    id: "rating-notification-1",
    createdAt: "2026-07-18T19:30:00+05:00",
    recipientUserId: ACTOR,
    code: "EVALUATION_AVAILABLE",
    deepLink: "/security-ops/ratings/workspace?event=rating-event-1",
    securityEventId: "rating-event-1",
  },
  // Чужое уведомление: в ответ актора попасть не должно.
  {
    id: "rating-notification-2",
    createdAt: "2026-07-18T19:30:00+05:00",
    recipientUserId: FOREIGN_EVALUATOR,
    code: "EVALUATION_AVAILABLE",
    deepLink: "/security-ops/ratings/workspace?event=rating-event-1",
    securityEventId: "rating-event-1",
  },
];

function buildSeed(): RatingsState {
  return {
    evaluations: SEED_EVALUATIONS.map((item) => ({ ...item })),
    workItems: SEED_WORK_ITEMS.map((item) => ({ ...item })),
    corrections: SEED_CORRECTIONS.map((item) => ({ ...item })),
    idempotency: [],
    auditEntries: SEED_AUDIT.map((item) => ({ ...item })),
    notifications: SEED_NOTIFICATIONS.map((item) => ({ ...item })),
    // Сеяных выгрузок нет: работа экспорта — след действия человека.
    exportJobs: [],
    exportArtifacts: [],
    dynamicsPoints: DYNAMICS_POINTS.map((item) => ({ ...item })),
    capabilities: { operationalRatings: true, ratingConflicts: true },
    seq: 0,
  };
}

let state: RatingsState | null = null;

function getState(): RatingsState {
  if (state === null) {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      state = raw === null ? buildSeed() : (JSON.parse(raw) as RatingsState);
    } catch {
      state = buildSeed();
    }
  }
  return state;
}

function persist(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // квота/приватный режим
  }
}

// ── Помощники ────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

/** Бизнес-дата — ЛОКАЛЬНАЯ: UTC-полночь на машинах в +05 сдвигала бы период. */
function businessDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function nextId(prefix: string): string {
  const s = getState();
  s.seq += 1;
  return `${prefix}-${s.seq}-${Date.now()}`;
}

function errorEnvelope(
  errorCode: string,
  message: string,
  details: Record<string, unknown>,
  status: number
) {
  return HttpResponse.json(
    {
      error_code: errorCode,
      message,
      details,
      request_id: null,
      timestamp: nowIso(),
    },
    { status }
  );
}

function notFound(entityId: string) {
  return errorEnvelope("ENTITY_NOT_FOUND", "Запись не найдена.", { entityId }, 404);
}

function basisLabel(code: string | null): string | null {
  if (code === null) return null;
  return EVALUATION_BASES.find((item) => item.code === code)?.label ?? code;
}

/** Проекция задания наружу — полем за полем, без оценщика. */
function toWorkItemView(item: EvaluationWorkItem): EvaluationWorkItemView {
  return {
    id: item.id,
    securityEventId: item.securityEventId,
    eventRunId: item.eventRunId,
    assignmentId: item.assignmentId,
    targetEmployeeId: item.targetEmployeeId,
    targetGroupId: item.targetGroupId,
    targetSafeLabel: item.targetSafeLabel,
    targetSafeUnitLabel: item.targetSafeUnitLabel,
    postLabel: item.postLabel,
    actualStartsAt: item.actualStartsAt,
    actualEndsAt: item.actualEndsAt,
    participated: item.participated,
    evaluationDirection: item.evaluationDirection,
    initialScore: item.initialScore,
    status: item.status,
    revision: item.revision,
    submittedEvaluationId: item.submittedEvaluationId,
    submittedAt: item.submittedAt,
  };
}

/** Своя отправленная оценка: собирается ТОЛЬКО для записи, автором которой
 * является актор — чужой комментарий не должен доехать до браузера вовсе. */
function toSubmittedView(
  item: EvaluationWorkItem,
  evaluations: readonly EventEvaluation[]
): SubmittedEvaluationView | null {
  if (item.submittedEvaluationId === null || item.submittedAt === null)
    return null;
  const evaluation = evaluations.find(
    (entry) => entry.id === item.submittedEvaluationId
  );
  if (evaluation === undefined) return null;
  if (evaluation.evaluatorUserId !== ACTOR) return null;
  return {
    workItemId: item.id,
    evaluationId: evaluation.id,
    targetSafeLabel: item.targetSafeLabel,
    postLabel: item.postLabel,
    evaluationDirection: evaluation.evaluationDirection,
    method: evaluation.method,
    score: evaluation.score,
    basisLabel: basisLabel(evaluation.basisCode),
    basisNote: evaluation.basisNote,
    comment: evaluation.comment,
    submittedAt: item.submittedAt,
    revision: item.revision,
  };
}

/** Запись журнала — полем за полем: значений оценки среди параметров нет. */
function auditEntry(input: {
  eventCode: RatingAuditEventCode;
  outcome: "SUCCESS" | "REJECTED";
  reasonCode?: string | null;
  item?: EvaluationWorkItem;
  evaluationId?: string | null;
  correctionId?: string | null;
  requestId?: string | null;
  revision?: number | null;
}): RatingAuditEntry {
  return {
    id: nextId("rating-audit"),
    occurredAt: nowIso(),
    actorUserId: ACTOR,
    eventCode: input.eventCode,
    outcome: input.outcome,
    reasonCode: input.reasonCode ?? null,
    securityEventId: input.item?.securityEventId ?? null,
    eventRunId: input.item?.eventRunId ?? null,
    assignmentId: input.item?.assignmentId ?? null,
    evaluationId: input.evaluationId ?? null,
    correctionId: input.correctionId ?? null,
    requestId: input.requestId ?? null,
    revision: input.revision ?? input.item?.revision ?? null,
  };
}

/** Отказ пишется ОТДЕЛЬНО от отклонённой мутации: журнал обязан его помнить. */
function recordRejection(input: {
  eventCode: RatingAuditEventCode;
  reasonCode: string;
  workItemId?: string;
  requestId?: string | null;
}): void {
  const s = getState();
  const item = s.workItems.find((entry) => entry.id === input.workItemId);
  s.auditEntries.push(
    auditEntry({
      eventCode: input.eventCode,
      outcome: "REJECTED",
      reasonCode: input.reasonCode,
      item,
      requestId: input.requestId ?? null,
    })
  );
  persist();
}

function notification(input: {
  recipientUserId: string;
  code: RatingNotification["code"];
  deepLink: string;
  securityEventId: string | null;
}): RatingNotification {
  return {
    id: nextId("rating-notification"),
    createdAt: nowIso(),
    recipientUserId: input.recipientUserId,
    code: input.code,
    deepLink: input.deepLink,
    securityEventId: input.securityEventId,
  };
}

/** Подробности конфликта редакций (§19.25): актуальные значения для diff. */
function conflictDetails(
  item: EvaluationWorkItem,
  evaluations: readonly EventEvaluation[]
): Record<string, unknown> {
  const current =
    item.submittedEvaluationId === null
      ? undefined
      : evaluations.find((entry) => entry.id === item.submittedEvaluationId);
  return {
    currentRevision: item.revision,
    currentScore: current?.score ?? null,
    currentBasisLabel: basisLabel(current?.basisCode ?? null),
    currentComment: current?.comment ?? null,
    currentEvaluationId: current?.id ?? null,
  };
}

/** §19.23: закрытое мероприятие РЕЕСТРА ОМ оценку не принимает. Мероприятия
 * сида в реестре отсутствуют — замок к ним неприменим. */
function eventClosed(securityEventId: string): boolean {
  try {
    const events = readSecurityEventsStore();
    const found = events.find((entry) => entry.id === securityEventId);
    if (found === undefined) return false;
    return found.closedAt !== null || found.stage === "CLOSED";
  } catch {
    return false;
  }
}

/** Цепочка исправлений — от корня вперёд по ссылкам supersededById. */
function buildChain(
  evaluations: readonly EventEvaluation[],
  corrections: readonly EvaluationCorrection[],
  currentId: string
): CorrectionChainLink[] {
  let root = evaluations.find((item) => item.id === currentId);
  if (root === undefined) return [];
  let guard = 0;
  for (;;) {
    const previous = evaluations.find((item) => item.supersededById === root?.id);
    if (previous === undefined || guard > 50) break;
    root = previous;
    guard += 1;
  }
  const links: CorrectionChainLink[] = [];
  let node: EventEvaluation | undefined = root;
  while (node !== undefined && links.length <= 50) {
    const correction = corrections.find(
      (item) => item.originalEvaluationId === node?.id
    );
    links.push({
      correctionId: correction?.id ?? null,
      evaluationId: node.id,
      score: node.score,
      basisLabel: basisLabel(node.basisCode),
      basisNote: node.basisNote,
      comment: node.comment,
      supersededReason: correction?.reason ?? null,
      supersededAt: correction?.correctedAt ?? null,
      current: node.supersededById === null,
    });
    const nextEvaluationId: string | null = node.supersededById;
    node =
      nextEvaluationId === null
        ? undefined
        : evaluations.find((item) => item.id === nextEvaluationId);
  }
  return links;
}

/** Сводки всех участников — тем же расчётом, что и экран. Порядок по подписи:
 * сортировка по значению — таблица лидеров, запрещённая §22.16. */
function buildAllSummaries(
  s: RatingsState,
  policy: RatingPolicy | null
): OperationalRatingSummary[] {
  const featureEnabled = s.capabilities.operationalRatings;
  const date = businessDate();
  const calculatedAt = nowIso();
  const results = RATED_EMPLOYEES.map((employee) =>
    buildSummary({
      employeeId: employee.employeeId,
      // Кадровая ссылка едет в сводку — порт правила сервера (Plane №96).
      personnelId: employee.personnelId,
      safeLabel: employee.safeLabel,
      evaluations: s.evaluations,
      policy,
      featureEnabled,
      businessDate: date,
      calculatedAt,
    })
  );
  results.sort((a, b) => a.safeLabel.localeCompare(b.safeLabel, "ru"));
  return results;
}

// ── §35-блоки ────────────────────────────────────────────────────────────

const UNAVAILABLE_RATING_FACTORS = [
  {
    code: "EVALUATOR_WEIGHTS",
    label: "Веса оценщиков",
    reason:
      "Модель весов оценщиков не заведена: §19.19 запрещает определять их на клиенте, а серверной методики весов в этой сборке нет. Все учтённые оценки равнозначны.",
  },
  {
    code: "GROUP_EVALUATION",
    label: "Распределение групповой оценки",
    reason:
      "Групповое оценивание (§19.13) не реализовано — распределять нечего.",
  },
  {
    code: "DUTY_SHIFTS",
    label: "Суточные дежурства",
    reason:
      "В оперативный рейтинг мероприятий суточные дежурства не включаются без отдельного подтверждённого contract (§19.1).",
  },
  {
    code: "SERVICE_HOURS",
    label: "Фактические часы службы",
    reason:
      "Часы — не оценка (§19.2). Повышать рейтинг за количество часов прямо запрещено.",
  },
];

const UNAVAILABLE_VIEWS = [
  {
    code: "OWN_RATING",
    label: "Собственный рейтинг смотрящего",
    reason:
      "Связь учётки и карточки сотрудника в demo-режиме не определена, поэтому «мой рейтинг» показать не на ком. Подставить любого сотрудника значило бы приписать смотрящему чужую оценку.",
  },
  {
    code: "SENSITIVE_EVALUATIONS",
    label: "Отдельные оценки и оценщики",
    reason:
      "Просмотр отдельной оценки требует sensitive permission, organization scope, event scope и срока полномочия одновременно (§19.21). Закрытые данные не покидают сервер, а не прячутся в вёрстке.",
  },
  {
    code: "RATING_DYNAMICS_FORECAST",
    label: "Прогноз и сглаживание динамики",
    reason:
      "График §19.20 строится только по записанным серверным точкам. Тренд и достроенные промежуточные значения были бы вычислением на клиенте поверх агрегатов.",
  },
];

const UNAVAILABLE_WORKSPACE_VIEWS = [
  {
    code: "GROUP_EVALUATION",
    label: "Групповая оценка",
    reason:
      "§19.13 требует показать состав группы на момент мероприятия и фактический состав. Таких снимков нигде не записано — направление объявлено, но заданий этого вида нет.",
  },
  {
    code: "CORRECT_FOREIGN_EVALUATION",
    label: "Исправление ЧУЖОЙ оценки",
    reason:
      "§19.21 «контролёр рейтинга» требует sensitive permission, organization scope, event scope и срок полномочия ОДНОВРЕМЕННО — их в сборке нет, исправление ограничено собственной записью.",
  },
  {
    code: "BULK_DEFAULT",
    label: "Кнопка «Применить 8 всем»",
    reason:
      "§19.8 называет её поимённо среди запрещённых: восьмёрка списком объявила бы стандартное выполнение про людей, которых оценщик не смотрел.",
  },
  {
    code: "RECEIVED_EVALUATIONS",
    label: "Оценки, полученные смотрящим от других",
    reason:
      "§19.14: их нет в ответе — очередь и отправленные отбираются по оценщику на сервере, а не фильтруются на экране.",
  },
];

const UNAVAILABLE_REGISTRY_VIEWS = [
  {
    code: "SENSITIVE_COLUMNS",
    label: "Score, комментарий, основание и оценщик отдельной записи",
    reason:
      "§19.16: держателю права на агрегат они закрыты. Этих полей нет в ответе API, и подпись «Детали оценки закрыты» стоит на их месте честно.",
  },
  {
    code: "RECOGNITION_FILTERS",
    label: "Фильтры «С благодарностью» и «С замечанием»",
    reason:
      "§19.11 запрещает выводить тип из значения оценки, а подтверждённых сущностей поощрения и замечания в контракте нет.",
  },
  {
    code: "SERVICE_RESULT",
    label: "Колонка «Результат службы»",
    reason:
      "§19 разделяет оценку и фактическое время службы — это разные сущности из разных источников.",
  },
];

const UNAVAILABLE_AUDIT_VIEWS = [
  {
    code: "AUDIT_SENSITIVE_VALUES",
    label: "Старое и новое значение оценки, комментарии, оценщик",
    reason:
      "§19.27 отдаёт их отдельной audit privacy permission с тем же scope, что и sensitive-просмотр. Значений нет в записи журнала вовсе — иначе общий экран аудита раскрывал бы закрытые оценки.",
  },
  {
    code: "AUDIT_EXPORT",
    label: "Экспорт журнала",
    reason:
      "Выгрузка §19.29 сделана для агрегированной сводки; у журнала своего генератора нет — кнопка обещала бы файл, которого никто не собирает.",
  },
];

const UNAVAILABLE_NOTIFICATION_VIEWS = [
  {
    code: "AGGREGATE_UPDATED_NOTICE",
    label: "Уведомление «Итоговая сводка оперативного рейтинга обновлена»",
    reason:
      "§19.28 называет его допустимым, но перечня адресатов с правом на агрегат в сборке не существует. Разослать «всем» значило бы придумать список получателей.",
  },
  {
    code: "EMPLOYEE_NOTICE",
    label: "Уведомления оцениваемому сотруднику",
    reason:
      "Связь учётки и сотрудника в demo-режиме не определена — доставить «вашу оценку исправили» некому. Отправить его оценщику значило бы адресовать чужое сообщение.",
  },
];

const UNAVAILABLE_ANALYTICS_VIEWS = [
  {
    code: "FORBIDDEN_BY_2216",
    label:
      "Отдельная оценка, оценщик, комментарий, доля ручных оценок, таблица лидеров, место",
    reason:
      "§22.16 перечисляет это списком запрещённого в общем отчёте. Их нет не в вёрстке, а в ответе API.",
  },
  {
    code: "PROTOTYPE_METRICS_REMOVED",
    label: "Показатели прототипа: «Авто-оценок», «Стандартных оценок», «Оценок ниже 6»",
    reason:
      "§22.17 требует удалить эту логику целиком: первые две — выдуманные константы, третья запрещена как количество низких оценок. Заменены распределением по полосам.",
  },
  {
    code: "NO_OVERALL_MEAN",
    label: "Общее среднее по всем участникам",
    reason:
      "Вместе со средними и размерами остальных групп общее среднее восстанавливает подавленное значение арифметикой (§22.17).",
  },
];

const UNAVAILABLE_EXPORT_FORMATS = [
  {
    code: "XLSX",
    label: "XLSX",
    reason:
      "§19.29 называет формат, но генератора книги XLSX в сборке нет: файл собирал бы браузер из уже полученных строк. Доступен CSV.",
  },
  {
    code: "PDF",
    label: "PDF",
    reason:
      "§19.29 называет формат, но генератора PDF в сборке нет. Печатная форма — отдельный механизм со своим макетом и владельцем.",
  },
];

const UNAVAILABLE_EXPORT_SCOPES = [
  {
    code: "INDIVIDUAL",
    label: "Экспорт индивидуальных оценок (sensitive export)",
    reason:
      "§19.29 требует под него отдельного permission и audit-записи, а §19.21 — ещё organization scope, event scope и срок полномочия. Ни того, ни другого в сборке нет; отказ фиксируется в журнале оценивания.",
  },
];

const AUDIT_PAGE_SIZE = 20;

// ── Экспорт: продвижение работы ──────────────────────────────────────────

/**
 * §19.29: фонового исполнителя в demo нет — ступень продвигает СЕРВЕР при
 * чтении списка. Файл собирается РОВНО на переходе в READY и больше не
 * пересобирается.
 */
function advanceExport(
  s: RatingsState,
  job: RatingExportJob
): { job: RatingExportJob; artifact: RatingExportArtifact | null } {
  if (job.state === "READY" || job.state === "FAILED" || job.state === "CANCELLED") {
    return { job, artifact: null };
  }
  if (job.state === "QUEUED") {
    return { job: { ...job, state: "GENERATING" }, artifact: null };
  }
  if (!s.capabilities.operationalRatings) {
    return {
      job: {
        ...job,
        state: "FAILED",
        finishedAt: nowIso(),
        failureCode: "RATING_DISABLED",
        safeFailureMessage:
          "Оперативный рейтинг выключен: сводки, по которой собирается файл, не существует.",
      },
      artifact: null,
    };
  }
  const policy = readRatingPolicy();
  const summaries = buildAllSummaries(s, policy);
  const generatedAt = nowIso();
  const artifact: RatingExportArtifact = {
    artifactId: `rating-export-artifact-${job.exportJobId}`,
    exportJobId: job.exportJobId,
    scope: job.scope,
    format: job.format,
    fileName: exportFileName(job.scope, job.format, businessDate()),
    generatedAt,
    // Методика замораживается В ФАЙЛЕ: её могли сменить после выгрузки.
    policyVersion: policy?.policyVersion ?? null,
    rowCount: summaries.length,
    content: buildAggregateExportContent(summaries, policy),
  };
  return {
    job: {
      ...job,
      state: "READY",
      finishedAt: generatedAt,
      artifactId: artifact.artifactId,
    },
    artifact,
  };
}

// ── Handlers ─────────────────────────────────────────────────────────────

export const ratingsHandlers = [
  // Сводка (§19.19).
  http.get(`*${OPERATIONAL_RATINGS_PATH}`, () => {
    const s = getState();
    const policy = readRatingPolicy();
    const featureEnabled = s.capabilities.operationalRatings;
    const response: ListOperationalRatingsResponse = {
      results: buildAllSummaries(s, policy),
      // Методика не едет клиенту при выключенной функции: она утверждала бы,
      // что расчёт по ней идёт.
      policy: featureEnabled ? policy : null,
      capabilities: { ...s.capabilities },
      unavailableFactors: UNAVAILABLE_RATING_FACTORS.map((item) => ({ ...item })),
      unavailableViews: UNAVAILABLE_VIEWS.map((item) => ({ ...item })),
    };
    return HttpResponse.json(response);
  }),

  // Динамика (§19.20): точки из стора КАК ЕСТЬ — ничего не пересчитывается.
  http.get(`*${OPERATIONAL_RATING_DYNAMICS_PATH}`, ({ request }) => {
    const s = getState();
    const url = new URL(request.url);
    const requested = url.searchParams.get("employee");
    const employee =
      RATED_EMPLOYEES.find((item) => item.employeeId === requested) ??
      RATED_EMPLOYEES[0];
    const policy = readRatingPolicy();
    const featureEnabled = s.capabilities.operationalRatings;
    const points = featureEnabled
      ? s.dynamicsPoints
          .filter((point) => point.employeeId === employee.employeeId)
          .map((point) => ({ ...point }))
          .sort((a, b) => a.periodStartsAt.localeCompare(b.periodStartsAt))
      : [];
    return HttpResponse.json({
      employeeId: employee.employeeId,
      safeLabel: employee.safeLabel,
      points,
      boundaries: policyBoundaries(points),
      currentPolicy: featureEnabled && policy !== null ? { ...policy } : null,
      currentPolicyHasClosedPeriods:
        policy !== null &&
        points.some((point) => point.policyVersion === policy.policyVersion),
      capabilities: { operationalRatings: featureEnabled },
      employees: RATED_EMPLOYEES.map((item) => ({
        employeeId: item.employeeId,
        safeLabel: item.safeLabel,
      })),
    });
  }),

  // Аналитика (§22.16-22.17).
  http.get(`*${RATING_ANALYTICS_PATH}`, () => {
    const s = getState();
    const policy = readRatingPolicy();
    const suppressionMinGroupSize = readRatingSuppressionMinGroup();
    const featureEnabled = s.capabilities.operationalRatings;
    const base = {
      policy: featureEnabled ? policy : null,
      periodStartsAt: null as string | null,
      periodEndsAt: null as string | null,
      calculatedAt: nowIso(),
      suppressionMinGroupSize,
      figures: null,
      capabilities: { operationalRatings: featureEnabled },
      unavailableViews: UNAVAILABLE_ANALYTICS_VIEWS.map((item) => ({ ...item })),
    };
    // Порядок причин значим: выключенная функция → нет методики → нет порога.
    if (!featureEnabled) {
      return HttpResponse.json({ ...base, unpublishedReason: "FEATURE_DISABLED" });
    }
    if (policy === null) {
      return HttpResponse.json({ ...base, unpublishedReason: "POLICY_UNDEFINED" });
    }
    if (suppressionMinGroupSize === null) {
      return HttpResponse.json({
        ...base,
        unpublishedReason: "SUPPRESSION_UNDEFINED",
      });
    }
    const summaries = buildAllSummaries(s, policy);
    return HttpResponse.json({
      ...base,
      periodStartsAt: summaries[0]?.periodStartsAt ?? null,
      periodEndsAt: summaries[0]?.periodEndsAt ?? null,
      unpublishedReason: null,
      figures: buildRatingAnalytics({
        summaries,
        groups: RATING_GROUPS.map((group) => ({
          groupCode: group.groupCode,
          safeLabel: group.safeLabel,
          members: RATED_EMPLOYEES.filter(
            (item) => item.groupCode === group.groupCode
          ).map((item) => item.employeeId),
        })),
        minGroupSize: suppressionMinGroupSize,
        // §22.16 «количество исправленных в агрегированном виде» — именно
        // количество: какая оценка кем исправлена, закрыто.
        correctedEvaluations: s.evaluations.filter(
          (item) => item.supersededById !== null
        ).length,
      }),
    });
  }),

  // Рабочее пространство (§19.14): очередь отбирается ПО ОЦЕНЩИКУ на сервере.
  http.get(`*${EVALUATION_WORKSPACE_PATH}`, ({ request }) => {
    const s = getState();
    const url = new URL(request.url);
    const eventId = url.searchParams.get("event");
    const policy = readRatingPolicy();
    const featureEnabled = s.capabilities.operationalRatings;
    const base = {
      bases: EVALUATION_BASES.map((item) => ({ ...item })),
      policy,
      loadedAt: nowIso(),
      capabilities: { operationalRatings: featureEnabled },
      unavailableViews: UNAVAILABLE_WORKSPACE_VIEWS.map((item) => ({ ...item })),
    };
    if (!featureEnabled) {
      return HttpResponse.json({
        ...base,
        events: [],
        selectedEvent: null,
        pending: [],
        submitted: [],
        queue: { total: 0, submitted: 0, remaining: 0 },
        eventProgress: null,
        unavailableReason: "FEATURE_DISABLED",
      });
    }
    const mine = s.workItems.filter((item) => item.evaluatorUserId === ACTOR);
    const events = EVALUATION_EVENTS.filter((event) =>
      mine.some((item) => item.securityEventId === event.securityEventId)
    ).map((event) => ({ ...event }));
    const selectedEvent =
      events.find((event) => event.securityEventId === eventId) ??
      events[0] ??
      null;
    const scoped =
      selectedEvent === null
        ? []
        : mine.filter(
            (item) => item.securityEventId === selectedEvent.securityEventId
          );
    // Порядок задаёт сервер по подписи участника: очередь, отсортированная по
    // начальной оценке, была бы подсказкой «кого снижать».
    const ordered = [...scoped].sort((a, b) =>
      a.targetSafeLabel.localeCompare(b.targetSafeLabel, "ru")
    );
    return HttpResponse.json({
      ...base,
      events,
      selectedEvent,
      pending: ordered
        .filter((item) => item.status === "PENDING")
        .map(toWorkItemView),
      submitted: ordered
        .filter((item) => item.status === "SUBMITTED")
        .map((item) => toSubmittedView(item, s.evaluations))
        .filter((item): item is SubmittedEvaluationView => item !== null),
      queue: summarizeQueue(scoped),
      // Сводка мероприятия — работа ВСЕХ оценщиков (право агрегата; у
      // демо-персоны wildcard — сводка присылается).
      eventProgress:
        selectedEvent === null
          ? null
          : summarizeEventProgress(
              s.workItems.filter(
                (item) => item.securityEventId === selectedEvent.securityEventId
              )
            ),
      unavailableReason: null,
    });
  }),

  // Отправка оценки (§19.7-19.10). Оценщик — из учётки, target/мероприятие —
  // из ЗАДАНИЯ: тело их не несёт и подменить не может.
  http.post(`*${EVALUATION_SUBMIT_PATH_PATTERN}`, async ({ params, request }) => {
    const workItemId = decodeURIComponent(params.workItemId as string);
    const body = (await request.json()) as SubmitEvaluationRequest;
    const s = getState();

    // §19.26: повтор с тем же ключом возвращает ПРЕЖНИЙ результат — проверка
    // стоит до всех прочих.
    const done = s.idempotency.find(
      (entry) => entry.key === body.idempotencyKey && entry.operation === "submit"
    );
    if (done !== undefined) {
      const repeated = s.workItems.find((entry) => entry.id === done.workItemId);
      const view =
        repeated === undefined ? null : toSubmittedView(repeated, s.evaluations);
      if (repeated !== undefined && view !== null) {
        const response: SubmitEvaluationResponse = {
          workItem: toWorkItemView(repeated),
          submitted: view,
          queue: summarizeQueue(
            s.workItems.filter(
              (entry) =>
                entry.evaluatorUserId === ACTOR &&
                entry.securityEventId === repeated.securityEventId
            )
          ),
        };
        return HttpResponse.json(response);
      }
    }

    const item = s.workItems.find((entry) => entry.id === workItemId);
    // Чужое задание — 404, а не 403: отказ по праву подтвердил бы, что задание
    // существует и кем-то оценивается.
    if (item === undefined || item.evaluatorUserId !== ACTOR) {
      recordRejection({
        eventCode: "EVALUATION_ACCESS_DENIED",
        reasonCode: "FOREIGN_WORK_ITEM",
        workItemId,
        requestId: body.idempotencyKey,
      });
      return notFound(workItemId);
    }

    function reject(errorCode: string, message: string, status: number) {
      recordRejection({
        eventCode:
          errorCode === "COMMENT_REQUIRED"
            ? "EVALUATION_LOW_SCORE_WITHOUT_COMMENT"
            : "EVALUATION_ACCESS_DENIED",
        reasonCode: errorCode,
        workItemId,
        requestId: body.idempotencyKey,
      });
      return errorEnvelope(errorCode, message, {}, status);
    }

    if (!s.capabilities.operationalRatings) {
      return reject(
        "RATING_DISABLED",
        "Оперативный рейтинг выключен: оценки не принимаются.",
        422
      );
    }
    // §19.23: закрытое мероприятие реестра ОМ оценку не принимает. Замок стоит
    // ДО состояния задания и правил формы.
    if (eventClosed(item.securityEventId)) {
      return reject(
        "EVALUATION_ARCHIVE_LOCKED",
        "Мероприятие закрыто, архив сформирован: оценка оформляется только разрешённым дополнением, которого в контракте нет.",
        422
      );
    }
    if (item.status !== "PENDING") {
      return reject(
        "EVALUATION_ALREADY_SUBMITTED",
        "Оценка по этому заданию уже отправлена. Исправление — отдельная операция (§19.18).",
        422
      );
    }
    // §19.33: задание с неподтверждённым участием показывается, но оценку
    // не принимает.
    if (!item.participated) {
      return reject(
        "PARTICIPATION_NOT_CONFIRMED",
        "Фактическое участие сотрудника не подтверждено.",
        422
      );
    }
    if (item.targetEmployeeId === null) {
      return reject(
        "GROUP_EVALUATION_UNSUPPORTED",
        "Групповая оценка не поддерживается: состав группы на момент мероприятия не записан.",
        422
      );
    }
    // Редакция: человек отправляет ту версию, которую видел. Проверяется ДО
    // правил формы.
    if (item.revision !== body.revision) {
      recordRejection({
        eventCode: "EVALUATION_ACCESS_DENIED",
        reasonCode: "EVALUATION_REVISION_MISMATCH",
        workItemId,
        requestId: body.idempotencyKey,
      });
      return errorEnvelope(
        "EVALUATION_REVISION_MISMATCH",
        "Задание изменилось: сравните значения и решите, что отправлять.",
        conflictDetails(item, s.evaluations),
        409
      );
    }
    // §19.9: сервер повторно выполняет ТУ ЖЕ проверку формы.
    const violation = validateSubmission(body, EVALUATION_BASES);
    if (violation !== null) {
      return reject(violation.code, violation.message, 422);
    }

    const now = nowIso();
    const evaluation: EventEvaluation = {
      // Идентификатор генерирует СЕРВЕР (§19.7).
      id: nextId("evaluation"),
      securityEventId: item.securityEventId,
      employeeId: item.targetEmployeeId,
      evaluatorUserId: ACTOR,
      score: body.score,
      comment:
        (body.comment ?? "").trim() === "" ? null : (body.comment ?? "").trim(),
      evaluationDirection: item.evaluationDirection,
      method: "MANUAL",
      basisCode: body.basisCode,
      basisNote:
        (body.basisNote ?? "").trim() === ""
          ? null
          : (body.basisNote ?? "").trim(),
      evaluatedAt: businessDate(),
      supersededById: null,
    };
    const nextItem: EvaluationWorkItem = {
      ...item,
      status: "SUBMITTED",
      revision: item.revision + 1,
      submittedEvaluationId: evaluation.id,
      submittedAt: now,
    };
    s.workItems = s.workItems.map((entry) =>
      entry.id === item.id ? nextItem : entry
    );
    s.evaluations = [...s.evaluations, evaluation];
    // §19.28: уведомление создаётся только после commit — тут он и есть.
    s.notifications = [
      ...s.notifications,
      notification({
        recipientUserId: ACTOR,
        code: "EVALUATION_SUBMITTED",
        deepLink: `/security-ops/ratings/workspace?event=${item.securityEventId}`,
        securityEventId: item.securityEventId,
      }),
    ];
    s.auditEntries = [
      ...s.auditEntries,
      auditEntry({
        eventCode: "EVALUATION_SUBMITTED",
        outcome: "SUCCESS",
        item: nextItem,
        evaluationId: evaluation.id,
        requestId: body.idempotencyKey,
      }),
      // §19.27: отдельное событие «изменение относительно начального».
      ...(evaluation.score === item.initialScore
        ? []
        : [
            auditEntry({
              eventCode: "EVALUATION_SCORE_CHANGED_FROM_INITIAL",
              outcome: "SUCCESS",
              item: nextItem,
              evaluationId: evaluation.id,
              requestId: body.idempotencyKey,
            }),
          ]),
    ];
    s.idempotency = [
      ...s.idempotency,
      {
        key: body.idempotencyKey,
        operation: "submit",
        workItemId: item.id,
        // Только идентификаторы: снимок ответа нёс бы закрытый комментарий.
        evaluationId: evaluation.id,
      },
    ];
    persist();

    const submitted = toSubmittedView(nextItem, s.evaluations);
    if (submitted === null) {
      return errorEnvelope("INTERNAL_ERROR", "Проекция не собралась.", {}, 500);
    }
    const response: SubmitEvaluationResponse = {
      workItem: toWorkItemView(nextItem),
      submitted,
      queue: summarizeQueue(
        s.workItems.filter(
          (entry) =>
            entry.evaluatorUserId === ACTOR &&
            entry.securityEventId === item.securityEventId
        )
      ),
    };
    return HttpResponse.json(response);
  }),

  // Карточка отправленной оценки (§19.17) — только СВОЕЙ, свежей редакцией.
  http.get(`*${EVALUATION_DETAIL_PATH_PATTERN}`, ({ params }) => {
    const workItemId = decodeURIComponent(params.workItemId as string);
    const s = getState();
    const item = s.workItems.find((entry) => entry.id === workItemId);
    if (item === undefined || item.evaluatorUserId !== ACTOR) {
      // §19.27: наружу 404 (существование не подтверждаем), в журнале
      // попытка остаётся.
      recordRejection({
        eventCode: "EVALUATION_ACCESS_DENIED",
        reasonCode: "FOREIGN_EVALUATION",
        workItemId,
      });
      return notFound(workItemId);
    }
    const submitted = toSubmittedView(item, s.evaluations);
    if (submitted === null) return notFound(workItemId);
    return HttpResponse.json({
      workItem: toWorkItemView(item),
      submitted,
      chain: buildChain(s.evaluations, s.corrections, submitted.evaluationId),
      bases: EVALUATION_BASES.map((basis) => ({ ...basis })),
      // Решает СЕРВЕР: у демо-персоны право есть, гасит только выключенная
      // функция.
      canCorrect: s.capabilities.operationalRatings,
      loadedAt: nowIso(),
    });
  }),

  // Исправление (§19.18): исходная запись не переписывается — создаётся
  // замещающая, исходная помечается ссылкой, связь и причина — отдельной
  // записью.
  http.post(`*${EVALUATION_CORRECT_PATH_PATTERN}`, async ({ params, request }) => {
    const workItemId = decodeURIComponent(params.workItemId as string);
    const body = (await request.json()) as CorrectEvaluationRequest;
    const s = getState();

    const done = s.idempotency.find(
      (entry) => entry.key === body.idempotencyKey && entry.operation === "correct"
    );
    if (done !== undefined) {
      const repeated = s.workItems.find((entry) => entry.id === done.workItemId);
      const view =
        repeated === undefined ? null : toSubmittedView(repeated, s.evaluations);
      if (repeated !== undefined && view !== null) {
        const response: CorrectEvaluationResponse = {
          workItem: toWorkItemView(repeated),
          submitted: view,
          chain: buildChain(s.evaluations, s.corrections, done.evaluationId),
        };
        return HttpResponse.json(response);
      }
    }

    const item = s.workItems.find((entry) => entry.id === workItemId);
    if (item === undefined || item.evaluatorUserId !== ACTOR) {
      recordRejection({
        eventCode: "EVALUATION_CORRECTION_REJECTED",
        reasonCode: "FOREIGN_EVALUATION",
        workItemId,
        requestId: body.idempotencyKey,
      });
      return notFound(workItemId);
    }

    function reject(errorCode: string, message: string, status: number) {
      recordRejection({
        eventCode: "EVALUATION_CORRECTION_REJECTED",
        reasonCode: errorCode,
        workItemId,
        requestId: body.idempotencyKey,
      });
      return errorEnvelope(errorCode, message, {}, status);
    }

    if (!s.capabilities.operationalRatings) {
      return reject(
        "RATING_DISABLED",
        "Оперативный рейтинг выключен: исправления не принимаются.",
        422
      );
    }
    const originalId = item.submittedEvaluationId;
    if (item.status !== "SUBMITTED" || originalId === null) {
      return reject(
        "EVALUATION_NOT_SUBMITTED",
        "Исправлять нечего: оценка по заданию ещё не отправлена.",
        422
      );
    }
    if (item.revision !== body.revision) {
      recordRejection({
        eventCode: "EVALUATION_CORRECTION_REJECTED",
        reasonCode: "EVALUATION_REVISION_MISMATCH",
        workItemId,
        requestId: body.idempotencyKey,
      });
      return errorEnvelope(
        "EVALUATION_REVISION_MISMATCH",
        "Запись изменилась: сравните значения и решите, что отправлять.",
        conflictDetails(item, s.evaluations),
        409
      );
    }
    const original = s.evaluations.find((entry) => entry.id === originalId);
    if (original === undefined) return notFound(originalId);
    // §19.25: «уже исправлена» — отдельный конфликт: редакция могла совпасть,
    // а запись уже быть вытесненной.
    if (original.supersededById !== null) {
      recordRejection({
        eventCode: "EVALUATION_CORRECTION_REJECTED",
        reasonCode: "EVALUATION_ALREADY_CORRECTED",
        workItemId,
        requestId: body.idempotencyKey,
      });
      return errorEnvelope(
        "EVALUATION_ALREADY_CORRECTED",
        "Эта запись уже исправлена: откройте действующую и повторите.",
        conflictDetails(item, s.evaluations),
        409
      );
    }
    const violation = validateCorrection(body, EVALUATION_BASES);
    if (violation !== null) {
      return reject(violation.code, violation.message, 422);
    }

    const now = nowIso();
    const replacement: EventEvaluation = {
      // Оценщик, target, мероприятие и направление наследуются от исходной
      // записи — §19.18 запрещает их менять, и spread гарантирует это
      // структурно.
      ...original,
      id: nextId("evaluation"),
      score: body.score,
      basisCode: body.basisCode,
      basisNote:
        (body.basisNote ?? "").trim() === ""
          ? null
          : (body.basisNote ?? "").trim(),
      comment:
        (body.comment ?? "").trim() === "" ? null : (body.comment ?? "").trim(),
      evaluatedAt: original.evaluatedAt,
      supersededById: null,
    };
    const correction: EvaluationCorrection = {
      id: nextId("correction"),
      originalEvaluationId: original.id,
      replacementEvaluationId: replacement.id,
      reason: body.reason.trim(),
      correctedBy: ACTOR,
      correctedAt: now,
      revision: item.revision,
    };
    s.evaluations = s.evaluations
      .map((entry) =>
        // Исходная остаётся в истории — меняется ровно одна ссылка.
        entry.id === original.id
          ? { ...entry, supersededById: replacement.id }
          : entry
      )
      .concat(replacement);
    const nextItem: EvaluationWorkItem = {
      ...item,
      revision: item.revision + 1,
      submittedEvaluationId: replacement.id,
      submittedAt: now,
    };
    s.workItems = s.workItems.map((entry) =>
      entry.id === item.id ? nextItem : entry
    );
    s.corrections = [...s.corrections, correction];
    s.notifications = [
      ...s.notifications,
      // Адресат — АВТОР исходной записи (§19.28): в сборке исправление
      // ограничено своей записью, поэтому автор и актор совпадают, — но
      // адресность взята из записи, а не из того, кто нажал кнопку.
      notification({
        recipientUserId: original.evaluatorUserId ?? ACTOR,
        code: "EVALUATION_CORRECTED",
        deepLink: `/security-ops/ratings/workspace?event=${item.securityEventId}`,
        securityEventId: item.securityEventId,
      }),
    ];
    s.auditEntries = [
      ...s.auditEntries,
      auditEntry({
        eventCode: "EVALUATION_CORRECTED",
        outcome: "SUCCESS",
        item: nextItem,
        evaluationId: replacement.id,
        correctionId: correction.id,
        requestId: body.idempotencyKey,
      }),
    ];
    s.idempotency = [
      ...s.idempotency,
      {
        key: body.idempotencyKey,
        operation: "correct",
        workItemId: item.id,
        evaluationId: replacement.id,
      },
    ];
    persist();

    const submitted = toSubmittedView(nextItem, s.evaluations);
    if (submitted === null) {
      return errorEnvelope("INTERNAL_ERROR", "Проекция не собралась.", {}, 500);
    }
    const response: CorrectEvaluationResponse = {
      workItem: toWorkItemView(nextItem),
      submitted,
      chain: buildChain(s.evaluations, s.corrections, replacement.id),
    };
    return HttpResponse.json(response);
  }),

  // Реестр итоговых оценок (§19.15-19.16): строка без закрытых величин, отбор
  // и страница считаются на сервере.
  http.get(`*${EVALUATION_REGISTRY_PATH}`, ({ request }) => {
    const s = getState();
    const url = new URL(request.url);
    const pageParam = Number(url.searchParams.get("page") ?? "1");
    const filters: RegistryFilters = {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      event: url.searchParams.get("event"),
      unit: url.searchParams.get("unit"),
      employee: url.searchParams.get("employee"),
      direction: (url.searchParams.get("direction") ??
        null) as RegistryFilters["direction"],
      method: (url.searchParams.get("method") ??
        null) as RegistryFilters["method"],
      correctedOnly: url.searchParams.get("corrected") === "true",
      search: url.searchParams.get("search") ?? "",
      page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
    };
    const policy = readRatingPolicy();
    const featureEnabled = s.capabilities.operationalRatings;
    const date = businessDate();
    const calculatedAt = nowIso();

    const summaries = new Map(
      RATED_EMPLOYEES.map((employee) => [
        employee.employeeId,
        buildSummary({
          employeeId: employee.employeeId,
          personnelId: employee.personnelId,
          safeLabel: employee.safeLabel,
          evaluations: s.evaluations,
          policy,
          featureEnabled,
          businessDate: date,
          calculatedAt,
        }),
      ])
    );

    const rows: EvaluationRegistryRow[] = featureEnabled
      ? s.evaluations.map((evaluation) => {
          const employee = RATED_EMPLOYEES.find(
            (item) => item.employeeId === evaluation.employeeId
          );
          const group = RATING_GROUPS.find(
            (item) => item.groupCode === employee?.groupCode
          );
          const event = EVALUATION_EVENTS.find(
            (item) => item.securityEventId === evaluation.securityEventId
          );
          const workItem = s.workItems.find(
            (item) => item.submittedEvaluationId === evaluation.id
          );
          const summary = summaries.get(evaluation.employeeId);
          return {
            // Идентификатор СТРОКИ, а не оценки.
            rowId: `row-${evaluation.id}`,
            employeeId: evaluation.employeeId,
            employeeSafeLabel: employee?.safeLabel ?? "—",
            unitSafeLabel: group?.safeLabel ?? "—",
            eventNumber: event?.number ?? "—",
            eventTitle: event?.title ?? "—",
            objectLabel: event?.objectLabel ?? "—",
            postLabel: workItem?.postLabel ?? null,
            participated: workItem?.participated ?? null,
            evaluationDirection: evaluation.evaluationDirection,
            method: evaluation.method,
            evaluatedAt: evaluation.evaluatedAt,
            // Признак исправления — по цепочке, не сравнением значений.
            corrected:
              evaluation.supersededById !== null ||
              s.corrections.some(
                (item) => item.replacementEvaluationId === evaluation.id
              ),
            aggregateRating: summary?.aggregateRating ?? null,
            aggregateState: summary?.dataState ?? "INSUFFICIENT_DATA",
          };
        })
      : [];

    const filtered = rows.filter((row) => matchesFilters(row, filters));
    filtered.sort(
      (a, b) =>
        b.evaluatedAt.localeCompare(a.evaluatedAt) ||
        a.employeeSafeLabel.localeCompare(b.employeeSafeLabel, "ru")
    );

    return HttpResponse.json({
      results: registryPageOf(filtered, filters.page),
      total: filtered.length,
      page: Math.min(Math.max(1, filters.page), registryPageCount(filtered.length)),
      pageCount: registryPageCount(filtered.length),
      // Значения фильтров даёт СЕРВЕР, а не собранные из строк страницы.
      options: {
        events: EVALUATION_EVENTS.map((event) => ({
          value: event.number,
          label: `${event.number} — ${event.title}`,
        })),
        units: RATING_GROUPS.map((group) => ({
          value: group.safeLabel,
          label: group.safeLabel,
        })),
        employees: RATED_EMPLOYEES.map((employee) => ({
          value: employee.employeeId,
          label: employee.safeLabel,
        })),
      },
      policy: featureEnabled ? policy : null,
      capabilities: { operationalRatings: featureEnabled },
      // Sensitive-колонок нет ни у кого: право под них не заведено (§19.21).
      columns: { sensitiveDetails: false },
      unavailableViews: UNAVAILABLE_REGISTRY_VIEWS.map((item) => ({ ...item })),
    });
  }),

  // Карточка сотрудника — только агрегат, период, методика и точки динамики.
  http.get(`*${RATING_EMPLOYEE_DETAIL_PATH}`, ({ request }) => {
    const s = getState();
    const url = new URL(request.url);
    const employeeId = url.searchParams.get("employee");
    const employee = RATED_EMPLOYEES.find(
      (item) => item.employeeId === employeeId
    );
    if (employee === undefined) return notFound(employeeId ?? "");
    const policy = readRatingPolicy();
    const featureEnabled = s.capabilities.operationalRatings;
    const group = RATING_GROUPS.find(
      (item) => item.groupCode === employee.groupCode
    );
    return HttpResponse.json({
      employeeId: employee.employeeId,
      safeLabel: employee.safeLabel,
      unitSafeLabel: group?.safeLabel ?? "—",
      summary: buildSummary({
        employeeId: employee.employeeId,
        personnelId: employee.personnelId,
        safeLabel: employee.safeLabel,
        evaluations: s.evaluations,
        policy,
        featureEnabled,
        businessDate: businessDate(),
        calculatedAt: nowIso(),
      }),
      points: featureEnabled
        ? s.dynamicsPoints
            .filter((point) => point.employeeId === employee.employeeId)
            .map((point) => ({ ...point }))
            .sort((a, b) => a.periodStartsAt.localeCompare(b.periodStartsAt))
        : [],
      unavailableViews: UNAVAILABLE_REGISTRY_VIEWS.map((item) => ({ ...item })),
    });
  }),

  // Журнал оценивания (§19.27): от свежего к старому, значений в записях нет.
  http.get(`*${RATING_AUDIT_PATH}`, ({ request }) => {
    const s = getState();
    const url = new URL(request.url);
    const pageParam = Number(url.searchParams.get("page") ?? "1");
    const ordered = [...s.auditEntries].sort((a, b) =>
      b.occurredAt.localeCompare(a.occurredAt)
    );
    const pageCount = Math.max(1, Math.ceil(ordered.length / AUDIT_PAGE_SIZE));
    const safePage = Math.min(
      Math.max(1, Number.isFinite(pageParam) ? pageParam : 1),
      pageCount
    );
    return HttpResponse.json({
      results: ordered
        .slice((safePage - 1) * AUDIT_PAGE_SIZE, safePage * AUDIT_PAGE_SIZE)
        .map((item) => ({ ...item })),
      total: ordered.length,
      page: safePage,
      pageCount,
      unavailableViews: UNAVAILABLE_AUDIT_VIEWS.map((item) => ({ ...item })),
    });
  }),

  // Свои уведомления (§19.28): отбор по адресату делает сервер.
  http.get(`*${RATING_NOTIFICATIONS_PATH}`, () => {
    const s = getState();
    return HttpResponse.json({
      results: s.notifications
        .filter((item) => item.recipientUserId === ACTOR)
        .map((item) => ({ ...item }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      unavailableViews: UNAVAILABLE_NOTIFICATION_VIEWS.map((item) => ({
        ...item,
      })),
    });
  }),

  // Список выгрузок (§19.29): ступень работ продвигается на чтении.
  http.get(`*${RATING_EXPORTS_PATH}`, () => {
    const s = getState();
    const artifacts = [...s.exportArtifacts];
    const jobs = s.exportJobs.map((job) => {
      const stepped = advanceExport(s, job);
      if (stepped.artifact !== null) artifacts.push(stepped.artifact);
      return stepped.job;
    });
    s.exportJobs = jobs;
    s.exportArtifacts = artifacts;
    persist();
    const mine = jobs.filter((job) => job.createdBy === ACTOR);
    const mineIds = new Set(mine.map((job) => job.exportJobId));
    const response: ListRatingExportsResponse = {
      results: [...mine]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((job) => ({ ...job })),
      // Содержимое в список НЕ едет: файл выдаётся отдельной операцией.
      artifacts: artifacts
        .filter((artifact) => mineIds.has(artifact.exportJobId))
        .map((artifact) => {
          // Содержимое вырезается копией: идиома `_content` красит гейт.
          const summary = { ...artifact };
          delete (summary as Partial<RatingExportArtifact>).content;
          return summary as Omit<RatingExportArtifact, "content">;
        }),
      formats: [...RATING_EXPORT_FORMATS],
      unavailableFormats: UNAVAILABLE_EXPORT_FORMATS.map((item) => ({ ...item })),
      unavailableScopes: UNAVAILABLE_EXPORT_SCOPES.map((item) => ({ ...item })),
      capabilities: { operationalRatings: s.capabilities.operationalRatings },
      serverTime: nowIso(),
    };
    return HttpResponse.json(response);
  }),

  // Заказ выгрузки (§19.29): работа создаётся в QUEUED, ссылки на файл нет.
  http.post(`*${RATING_EXPORTS_PATH}`, async ({ request }) => {
    const body = (await request.json()) as CreateRatingExportRequest;
    const s = getState();
    // Режим и формат — независимо от прав: индивидуальная выгрузка не
    // выдаётся никому, включая администратора с wildcard.
    const violation = validateExportRequest({
      scope: body.scope,
      format: body.format,
    });
    if (violation !== null) {
      recordRejection({
        eventCode: "RATING_EXPORT_REJECTED",
        reasonCode: violation.code,
        requestId: body.idempotencyKey,
      });
      return errorEnvelope(violation.code, violation.message, {}, 422);
    }
    // §19.26: повтор с тем же ключом возвращает ПРЕЖНЮЮ работу.
    const repeated = s.exportJobs.find(
      (job) => job.idempotencyKey === body.idempotencyKey
    );
    if (repeated !== undefined) {
      return HttpResponse.json({ job: { ...repeated } });
    }
    const job: RatingExportJob = {
      exportJobId: nextId("rating-export"),
      scope: body.scope,
      format: body.format,
      state: "QUEUED",
      createdAt: nowIso(),
      createdBy: ACTOR,
      finishedAt: null,
      failureCode: null,
      safeFailureMessage: null,
      artifactId: null,
      idempotencyKey: body.idempotencyKey,
    };
    s.exportJobs = [...s.exportJobs, job];
    s.auditEntries = [
      ...s.auditEntries,
      auditEntry({
        eventCode: "RATING_EXPORT_REQUESTED",
        outcome: "SUCCESS",
        requestId: body.idempotencyKey,
      }),
    ];
    persist();
    return HttpResponse.json({ job: { ...job } });
  }),

  // Отмена (§19.29 CANCELLED): только незавершённую работу.
  http.post(`*${RATING_EXPORT_CANCEL_PATH_PATTERN}`, ({ params }) => {
    const exportJobId = decodeURIComponent(params.exportJobId as string);
    const s = getState();
    const job = s.exportJobs.find((entry) => entry.exportJobId === exportJobId);
    if (job === undefined || job.createdBy !== ACTOR) {
      return notFound(exportJobId);
    }
    if (job.state !== "QUEUED" && job.state !== "GENERATING") {
      return errorEnvelope(
        "EXPORT_NOT_CANCELLABLE",
        "Работа уже завершена: отменять нечего.",
        {},
        422
      );
    }
    const cancelled: RatingExportJob = {
      ...job,
      state: "CANCELLED",
      finishedAt: nowIso(),
    };
    s.exportJobs = s.exportJobs.map((entry) =>
      entry.exportJobId === job.exportJobId ? cancelled : entry
    );
    persist();
    return HttpResponse.json({ job: { ...cancelled } });
  }),

  // Выдача файла (§19.29): отдельная операция, перепроверяющая владельца и
  // состояние. Запись в журнал — о ВЫДАЧЕ: что покинуло систему.
  http.post(`*${RATING_EXPORT_DOWNLOAD_PATH_PATTERN}`, ({ params }) => {
    const artifactId = decodeURIComponent(params.artifactId as string);
    const s = getState();
    const artifact = s.exportArtifacts.find(
      (entry) => entry.artifactId === artifactId
    );
    const job =
      artifact === undefined
        ? undefined
        : s.exportJobs.find(
            (entry) => entry.exportJobId === artifact.exportJobId
          );
    if (artifact === undefined || job === undefined || job.createdBy !== ACTOR) {
      return notFound(artifactId);
    }
    if (job.state !== "READY") {
      return errorEnvelope(
        "EXPORT_NOT_READY",
        "Файл не выдан: работа не в состоянии «Готов».",
        {},
        422
      );
    }
    s.auditEntries = [
      ...s.auditEntries,
      auditEntry({
        eventCode: "RATING_EXPORT_DOWNLOADED",
        outcome: "SUCCESS",
        requestId: job.idempotencyKey,
      }),
    ];
    persist();
    return HttpResponse.json({
      fileName: artifact.fileName,
      content: artifact.content,
    });
  }),
];
