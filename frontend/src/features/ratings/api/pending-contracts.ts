// Pending-контракты оперативного рейтинга (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
//
// ⚠️ Путь грепнут по всему `src` до заведения: коллизия путей в MSW
// разрешается молча в пользу первого handler'а (инцидент Этапа 39).
//
// В ответе НЕТ и не может появиться ни одного поля закрытых данных: ни score
// отдельной оценки, ни оценщика, ни комментария (§19.21 «закрытость должна
// обеспечиваться API, а не только скрытием колонок»). Это свойство ответа
// закреплено тестом по ВСЕМУ JSON, а не по знакомым именам полей.
import type {
  EvaluationBasis,
  EvaluationDirection,
  EvaluationMethod,
  EvaluationWorkItem,
  OperationalRatingSummary,
  RatingDynamicsPoint,
  RatingPolicy,
  RatingPolicyBoundary,
} from '../model/types'
import type { RatingAnalyticsFigures } from '../lib/analytics'
import type { EventProgress, QueueCounters } from '../lib/workspace'
import type { EvaluationRegistryRow } from '../lib/registry'

export const OPERATIONAL_RATINGS_PATH = '/api/ops/operational-ratings/'
/**
 * Динамика (§19.20) живёт на СВОЁМ пути, а не хвостом под путём сводки:
 * коллизия путей в MSW разрешается молча в пользу первого handler'а, поэтому
 * путь до заведения грепнут по всему `src` (инцидент Этапа 39).
 */
export const OPERATIONAL_RATING_DYNAMICS_PATH = '/api/ops/operational-rating-dynamics/'
/** Отчёт аналитики рейтинга §22.16 — свой путь и СВОЁ право (`ops.analytics.view`). */
export const RATING_ANALYTICS_PATH = '/api/ops/rating-analytics/'
/**
 * Рабочее пространство оценивания (§19.14). Своё право (`ops.rating.evaluate`)
 * и свой путь; мероприятие приезжает параметром `event`, а не сегментом —
 * очередь принадлежит человеку, мероприятие лишь сужает её.
 */
export const EVALUATION_WORKSPACE_PATH = '/api/ops/evaluation-workspace/'
/**
 * Отправка оценки по заданию. Путь СТРОКИ задания — отдельная коллекция
 * (`evaluation-work-items`), а не хвост под путём рабочего пространства:
 * коллизия путей в MSW разрешается молча в пользу первого handler'а
 * (инцидент Этапа 39), и оба пути грепнуты по `src` до заведения.
 */
export function evaluationSubmitPath(workItemId: string): string {
  return `/api/ops/evaluation-work-items/${encodeURIComponent(workItemId)}/submit/`
}
/**
 * Шаблон того же пути для MSW. Отдельная константа, а не
 * `evaluationSubmitPath(':workItemId')`: фабрика прогоняет сегмент через
 * `encodeURIComponent`, и двоеточие уехало бы в шаблон как `%3AworkItemId` —
 * ровно дефект Этапа 49, когда PATCH не совпадал ни с одним handler'ом.
 * Handler-тест ловит это на живом клиенте.
 */
export const EVALUATION_SUBMIT_PATH_PATTERN =
  '/api/ops/evaluation-work-items/:workItemId/submit/'

/**
 * Исправление оценки (§19.18) и карточка отправленной записи (§19.17). Оба —
 * СВОИ пути под той же коллекцией; шаблоны заведены константами по той же
 * причине, что и у отправки, и грепнуты по `src` до заведения.
 */
export function evaluationCorrectPath(workItemId: string): string {
  return `/api/ops/evaluation-work-items/${encodeURIComponent(workItemId)}/correct/`
}
export const EVALUATION_CORRECT_PATH_PATTERN =
  '/api/ops/evaluation-work-items/:workItemId/correct/'
export function evaluationDetailPath(workItemId: string): string {
  return `/api/ops/evaluation-work-items/${encodeURIComponent(workItemId)}/detail/`
}
/**
 * `detail` — ЯВНЫЙ сегмент, а не «просто строка коллекции». Путь строки
 * (`/evaluation-work-items/:id/`) перехватил бы и `/submit/`, и `/correct/`:
 * MSW разрешает коллизию молча в пользу первого совпавшего handler'а.
 */
export const EVALUATION_DETAIL_PATH_PATTERN =
  '/api/ops/evaluation-work-items/:workItemId/detail/'

/**
 * Реестр итоговых оценок §19.15 и карточка агрегата сотрудника §19.17
 * (aggregate-only ветка). Свои пути: путь сводки перехватил бы обоих, а
 * коллизия в MSW разрешается молча в пользу первого handler'а.
 */
export const EVALUATION_REGISTRY_PATH = '/api/ops/evaluation-registry/'
export const RATING_EMPLOYEE_DETAIL_PATH = '/api/ops/operational-rating-employee/'

/** Значения, которыми можно фильтровать реестр. Их перечень даёт СЕРВЕР —
 * автодополнение не должно раскрывать сотрудников вне разрешённого scope
 * (§19.15), поэтому клиент не собирает список из полученных строк. */
export interface EvaluationRegistryOptions {
  events: { value: string; label: string }[]
  units: { value: string; label: string }[]
  employees: { value: string; label: string }[]
}

export interface EvaluationRegistryResponse {
  results: EvaluationRegistryRow[]
  total: number
  page: number
  pageCount: number
  options: EvaluationRegistryOptions
  /** Методика — ею подписан агрегат в строках (§19.19). */
  policy: RatingPolicy | null
  capabilities: { operationalRatings: boolean }
  /**
   * Какие колонки разрешены смотрящему (§19.16 «колонки адаптируются под
   * permissions»). Решает СЕРВЕР: у него же и данные, которых в ответе нет.
   */
  columns: { sensitiveDetails: boolean }
  unavailableViews: UnavailableRatingFactor[]
}

/**
 * Карточка сотрудника при праве только на агрегат (§19.17, вторая ветка):
 * итоговый рейтинг, количество учтённых, период, версия методики, дата расчёта
 * и агрегированная динамика — БЕЗ отдельных оценок и оценщиков.
 */
export interface RatingEmployeeDetailResponse {
  employeeId: string
  safeLabel: string
  unitSafeLabel: string
  summary: OperationalRatingSummary
  points: RatingDynamicsPoint[]
  unavailableViews: UnavailableRatingFactor[]
}

/**
 * Задание в ответе. Оценщика в нём НЕТ ни одним полем: §19.7 «не передавай
 * evaluator через редактируемое поле» — здесь он не передаётся вовсе, а
 * берётся сервером из учётной записи запрашивающего. Очередь и так отобрана
 * по нему, поэтому поле было бы лишь поводом его подменить.
 */
export type EvaluationWorkItemView = Omit<EvaluationWorkItem, 'evaluatorUserId'>

/**
 * СВОЯ отправленная оценка (§19.14 «Открыть отправленную оценку»).
 *
 * Это не нарушение §19.21: закрыты оценки, ПОЛУЧЕННЫЕ человеком, и чужие
 * оценки; собственный отправленный акт человек видит, потому что он его и
 * совершил. Отбор идёт по оценщику на сервере — в ответ не попадает ни одна
 * запись, автором которой запрашивающий не является.
 */
export interface SubmittedEvaluationView {
  workItemId: string
  evaluationId: string
  targetSafeLabel: string
  postLabel: string
  evaluationDirection: EvaluationDirection
  method: EvaluationMethod
  score: number
  basisLabel: string | null
  basisNote: string | null
  comment: string | null
  submittedAt: string
  revision: number
}

/** Шапка мероприятия (§19.14). Фактические времена — факт, а не план. */
export interface EvaluationWorkspaceEvent {
  securityEventId: string
  number: string
  title: string
  objectLabel: string
  actualStartsAt: string
  actualEndsAt: string
  stateLabel: string
}

export interface EvaluationWorkspaceResponse {
  /** Мероприятия, по которым у запрашивающего ЕСТЬ задания. Чужие не видны. */
  events: EvaluationWorkspaceEvent[]
  selectedEvent: EvaluationWorkspaceEvent | null
  pending: EvaluationWorkItemView[]
  submitted: SubmittedEvaluationView[]
  /** Счётчики шапки — по заданиям СМОТРЯЩЕГО (§19.14). */
  queue: QueueCounters
  /**
   * Прогресс оценивания по мероприятию ЦЕЛИКОМ — работа других людей, поэтому
   * `null` без права `ops.rating.view_aggregate` (§19.14 «Сводка мероприятия
   * показывается только при наличии permission»). Значений оценок в нём нет.
   */
  eventProgress: EventProgress | null
  /** Основания приходят с сервера (§19.10), а не из справочника в коде экрана. */
  bases: EvaluationBasis[]
  /**
   * Методика — для подписи (§19.14 «policy version»). `null` не мешает
   * оценивать: методика управляет РАСЧЁТОМ агрегата (§19.19), а не правом
   * поставить оценку. Гасить форму из-за неё значило бы остановить работу
   * из-за настройки, которой она не пользуется.
   */
  policy: RatingPolicy | null
  /** Момент ответа — им подписано состояние синхронизации в шапке. */
  loadedAt: string
  capabilities: { operationalRatings: boolean }
  /** `FEATURE_DISABLED` — оценивание выключено целиком (§19.3). */
  unavailableReason: 'FEATURE_DISABLED' | null
  unavailableViews: UnavailableRatingFactor[]
}

/**
 * Звено correction chain (§19.17). Это ИСТОРИЯ, а не текущее состояние:
 * вытесненная запись остаётся видимой автору со своим значением, потому что
 * §19.18 запрещает скрывать старое значение.
 */
export interface CorrectionChainLink {
  correctionId: string | null
  evaluationId: string
  score: number
  basisLabel: string | null
  basisNote: string | null
  comment: string | null
  /** Причина, по которой запись была ЗАМЕЩЕНА. `null` у действующей записи. */
  supersededReason: string | null
  supersededAt: string | null
  /** Действующая запись цепочки — та, что участвует в агрегате. */
  current: boolean
}

/**
 * Карточка отправленной оценки (§19.17) — только СВОЕЙ. Ответ несёт актуальную
 * `revision` задания: §19.18 шаг 3 требует перезагрузить её перед исправлением,
 * а не брать ту, что лежала на экране с прошлого чтения.
 */
export interface SubmittedEvaluationDetailResponse {
  workItem: EvaluationWorkItemView
  submitted: SubmittedEvaluationView
  /** `null` без права `ops.rating.view_correction_chain` — §19.22 отдельный пункт. */
  chain: CorrectionChainLink[] | null
  bases: EvaluationBasis[]
  /** Решает СЕРВЕР: кнопка, выключенная только на клиенте, ограничением не является. */
  canCorrect: boolean
  loadedAt: string
}

/**
 * Тело исправления (§19.18). Оценщик, target, мероприятие и назначение
 * отсутствуют по той же причине, что и в отправке, — их запрещено менять.
 */
export interface CorrectEvaluationRequest {
  score: number
  basisCode: string | null
  basisNote: string | null
  comment: string | null
  /** §19.18 шаг 6: обязательная причина исправления. */
  reason: string
  revision: number
  /** §19.26 — та же защита, что у отправки: повтор не создаёт второй записи. */
  idempotencyKey: string
}

export interface CorrectEvaluationResponse {
  workItem: EvaluationWorkItemView
  submitted: SubmittedEvaluationView
  chain: CorrectionChainLink[] | null
}

/**
 * Тело отправки. Ни оценщика, ни target, ни мероприятия: всё это — свойства
 * ЗАДАНИЯ, и переслать их значило бы позволить их подменить (§19.7, §19.18
 * «нельзя изменить оценщика/target/event»). `revision` — та редакция задания,
 * которую видел человек.
 */
export interface SubmitEvaluationRequest {
  score: number
  basisCode: string | null
  basisNote: string | null
  comment: string | null
  revision: number
  /**
   * §19.26: ключ идемпотентности. Повторный запрос с тем же ключом НЕ создаёт
   * вторую оценку и не пересчитывает агрегат заново — возвращается прежний
   * результат. Ключ генерирует клиент один раз на открытую форму: сгенерируй
   * его при отправке — и повтор после таймаута приедет с НОВЫМ ключом, то есть
   * ровно тогда, когда защита и нужна.
   *
   * ⚠️ В ключе нет ни одного закрытого значения: он случайный. Ключ, собранный
   * из полей записи, нёс бы комментарий и оценку целиком.
   */
  idempotencyKey: string
}

/**
 * Подробности конфликта редакций (§19.25). Ответ несёт АКТУАЛЬНУЮ редакцию и
 * текущие значения — иначе экран не может показать diff и человеку негде
 * увидеть, что именно изменилось, пока он заполнял форму.
 */
export interface EvaluationConflictDetails {
  currentRevision: number
  currentScore: number | null
  currentBasisLabel: string | null
  currentComment: string | null
  /** Действующая запись задания на момент отказа. */
  currentEvaluationId: string | null
}

export interface SubmitEvaluationResponse {
  workItem: EvaluationWorkItemView
  submitted: SubmittedEvaluationView
  queue: QueueCounters
}

/** §35: чего в расчёте нет и почему. Форма та же, что у блоков аналитики. */
export interface UnavailableRatingFactor {
  code: string
  label: string
  reason: string
}

export interface ListOperationalRatingsResponse {
  results: OperationalRatingSummary[]
  /** `null` — методика не определена (§19.19). Тогда у всех сводок
   * `dataState: POLICY_UNDEFINED`, а не нулевой рейтинг. */
  policy: RatingPolicy | null
  /** §19.3: состояние feature flags решает СЕРВЕР и называет их прямо. */
  capabilities: { operationalRatings: boolean; ratingConflicts: boolean }
  /** §35-блоки: факторы, не участвующие в расчёте, и нереализованные части §19. */
  unavailableFactors: UnavailableRatingFactor[]
  unavailableViews: UnavailableRatingFactor[]
}

/**
 * Отчёт аналитики рейтинга (§22.16-22.17).
 *
 * ⚠️ ОБЩЕГО СРЕДНЕГО В ОТВЕТЕ НЕТ И НЕ ДОЛЖНО ПОЯВИТЬСЯ: вместе с
 * опубликованными средними и размерами остальных групп оно восстанавливало бы
 * подавленное значение арифметикой в одну строку (§22.17 «Не пытайся
 * восстановить скрытое значение из других показателей»).
 */
export interface RatingAnalyticsResponse {
  /** `null` — методика не определена: считать отчёт не по чему (§19.19). */
  policy: RatingPolicy | null
  periodStartsAt: string | null
  periodEndsAt: string | null
  calculatedAt: string
  /** Порог безопасной агрегации из policy. `null` — правило не задано. */
  suppressionMinGroupSize: number | null
  /** `null`, когда отчёт не публикуется (выключена функция / нет методики /
   * не задан порог приватности). Причина приходит отдельным полем. */
  figures: RatingAnalyticsFigures | null
  unpublishedReason: 'FEATURE_DISABLED' | 'POLICY_UNDEFINED' | 'SUPPRESSION_UNDEFINED' | null
  capabilities: { operationalRatings: boolean }
  /** §35: чего в отчёте нет и почему. */
  unavailableViews: UnavailableRatingFactor[]
}

/**
 * Динамика одного сотрудника (§19.20). Точки — записанные агрегаты; отдельных
 * закрытых оценок в ответе нет ни одним полем, как и в сводке.
 */
export interface RatingDynamicsResponse {
  employeeId: string
  safeLabel: string
  /** По возрастанию периода. Порядок задаёт СЕРВЕР: ось времени — не сортировка вкуса. */
  points: RatingDynamicsPoint[]
  /** Границы смены методики — факт сервера, а не вывод экрана (§19.20). */
  boundaries: RatingPolicyBoundary[]
  /** Текущая редакция методики. `null` — методика не определена (§19.19). */
  currentPolicy: RatingPolicy | null
  /**
   * Закрывала ли ТЕКУЩАЯ редакция хоть один период. `false` — на графике её
   * точек нет и быть не может: пересчитывать прошлое под неё запрещено
   * (§19.20), и экран обязан сказать это словами, а не оставить читателя
   * думать, что линия построена по действующей методике.
   */
  currentPolicyHasClosedPeriods: boolean
  capabilities: { operationalRatings: boolean }
  /** Кого можно выбрать — тот же безопасный список, что в сводке. */
  employees: { employeeId: string; safeLabel: string }[]
}
