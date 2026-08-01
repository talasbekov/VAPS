// Pending-контракты обратной связи (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
//
// ⚠️ Путь грепнут по всему `src` до заведения: коллизия путей в MSW
// разрешается МОЛЧА в пользу первого handler'а (инцидент Этапа 39), ни ошибки,
// ни предупреждения не будет.
import type { FeedbackNotice, FeedbackStats } from '../lib/feedback'
import type {
  FeedbackAction,
  FeedbackAttachmentMeta,
  FeedbackCommentKind,
  FeedbackEventKind,
  FeedbackPriorityCode,
  FeedbackRegistry,
  FeedbackRequest,
  FeedbackStatusCode,
  FeedbackTechnicalInfo,
  FeedbackTypeCode,
} from '../model/types'

export const FEEDBACK_REQUESTS_PATH = '/api/ops/feedback-requests/'

export function feedbackSubmitPath(id: string): string {
  return `${FEEDBACK_REQUESTS_PATH}${id}/submit/`
}

/**
 * Обращение В ОТВЕТЕ СЕРВЕРА. Отличается от `FeedbackRequest` тем, что
 * содержание конфиденциального обращения может ОТСУТСТВОВАТЬ.
 *
 * Вырезано именно на сервере: спрятать описание в вёрстке значит всё равно
 * отдать его браузеру и положить в кэш запросов — тот же вывод, что
 * sensitive identity (§20.27) и параметры чужого отчёта (§22.26).
 */
export interface FeedbackRequestView {
  feedbackId: string
  subject: string
  typeCode: FeedbackTypeCode
  priorityCode: FeedbackPriorityCode
  statusCode: FeedbackStatusCode
  moduleCode: string
  authorLabel: string
  createdAt: string
  submittedAt: string | null
  confidential: boolean
  /** §28 detail «working priority» — `null`, пока разбора не было. Поле
   * ОТКРЫТОЕ: это решение службы об обращении, а не содержание обращения,
   * и признак конфиденциальности его не закрывает. */
  workingPriorityCode: FeedbackPriorityCode | null
  /** §28 detail «assignee». Подпись — для человека, идентификатор — для
   * формы разбора (её `select` работает по нему). */
  assigneeLabel: string | null
  assigneeUserId: string | null
  /** `true`, если обращение завёл смотрящий. Решает сервер: сравнение
   * пользователей на клиенте означало бы, что закрытые поля уже приехали. */
  isOwn: boolean
  /** Всё ниже — содержание. У закрытого обращения приходит `null` целиком. */
  description: string | null
  /** Производное описания (`previewOf`) и вырезается ВМЕСТЕ с ним. */
  descriptionPreview: string | null
  expectedResult: string | null
  reproductionSteps: string | null
  contact: string | null
  relatedRoute: string | null
  attachments: FeedbackAttachmentMeta[] | null
  technicalInfo: FeedbackTechnicalInfo | null
  /** `null`, пока содержание видно: причина нужна ровно там, где отказ. */
  restrictedReason: string | null
}

export interface ListFeedbackResponse {
  results: FeedbackRequestView[]
  /** §28 list «stats» — по всему видимому набору, не по странице. */
  stats: FeedbackStats
  registry: FeedbackRegistry
  page: number
  pageSize: number
  pageCount: number
  /** Сколько обращений подошло под фильтры. */
  totalMatched: number
  /** Сколько смотрящий видит ВСЕГО, до фильтров: «ничего не нашлось» и
   * «обращений ещё нет» — разные сообщения. */
  totalVisible: number
  /** §35: чего этот срез не даёт, с причиной по каждому пункту. */
  unavailableCapabilities: FeedbackNotice[]
  serverTime: string
}

/** Фильтры §28 list. Применяет СЕРВЕР: экран не режет уже полученный массив —
 * закрытые строки не должны доезжать до браузера вовсе. */
export interface ListFeedbackFilters {
  search?: string
  typeCode?: FeedbackTypeCode
  statusCode?: FeedbackStatusCode
  moduleCode?: string
  page?: number
  /** Только обращения смотрящего. Чьи именно — решает сервер по актору. */
  mine?: boolean
}

/** `type`, а не `interface`: переменные `useApiMutation` обязаны
 * удовлетворять `Record<string, unknown>`. */
export type CreateFeedbackRequest = {
  subject: string
  description: string
  typeCode: FeedbackTypeCode
  priorityCode: FeedbackPriorityCode
  moduleCode: string
  expectedResult: string | null
  reproductionSteps: string | null
  contact: string | null
  confidential: boolean
  relatedRoute: string | null
  /** §28 create «attachment metadata»: ровно метаданные. Поля с содержимым в
   * контракте нет — а если оно всё-таки приедет в теле, сервер его не
   * сохранит (см. repository). */
  attachments: FeedbackAttachmentMeta[]
  /** §28 create «include technical info» — ЯВНОЕ согласие автора. */
  includeTechnicalInfo: boolean
  /** Техническая информация, собранная экраном. Сервер сохранит её ТОЛЬКО
   * при согласии: тело запроса согласия не заменяет. */
  technicalInfo: FeedbackTechnicalInfo | null
  /** §28 «Черновик» — отдельный статус, а не несохранённая форма. */
  saveAsDraft: boolean
}

export type CreateFeedbackResponse = FeedbackRequest
export type SubmitFeedbackResponse = FeedbackRequest

// ─── Карточка обращения (§28 detail, Этап 48) ────────────────────────────────

export function feedbackDetailPath(id: string): string {
  return `${FEEDBACK_REQUESTS_PATH}${id}/`
}
export function feedbackCommentsPath(id: string): string {
  return `${FEEDBACK_REQUESTS_PATH}${id}/comments/`
}
/** Разбор — ОДНА операция: ответственный, рабочий приоритет и статус меняются
 * вместе, потому что вместе и решаются. Тремя ресурсами карточка получила бы
 * три записи в ленте на один поступок разбирающего. */
export function feedbackTriagePath(id: string): string {
  return `${FEEDBACK_REQUESTS_PATH}${id}/triage/`
}
export function feedbackClosePath(id: string): string {
  return `${FEEDBACK_REQUESTS_PATH}${id}/close/`
}

/** Комментарий В ОТВЕТЕ. Внутренние заметки в ответ тому, кому они не видны,
 * не попадают ВООБЩЕ — не приходят с вырезанным текстом. */
export interface FeedbackCommentView {
  commentId: string
  kind: FeedbackCommentKind
  body: string
  authorLabel: string
  createdAt: string
}

export interface FeedbackEventView {
  eventId: string
  kind: FeedbackEventKind
  actorLabel: string
  at: string
  fieldCode: string | null
  oldValue: string | null
  newValue: string | null
}

/** §28 detail «duplicate»: на что указывает признанный дубликат. */
export interface FeedbackDuplicateLink {
  feedbackId: string
  /** Тема обращения-оригинала или `null`, если смотрящему оно не видно. */
  subject: string | null
  /** `null`, пока тема видна. */
  hiddenReason: string | null
}

export interface FeedbackDetailResponse {
  request: FeedbackRequestView
  comments: FeedbackCommentView[]
  timeline: FeedbackEventView[]
  /** §28 detail: доступность каждого действия считает сервер. */
  actions: FeedbackAction[]
  /** Статусы, в которые обращение может уйти ИЗ ТЕКУЩЕГО. Считает сервер по
   * карте переходов справочника — экран не выводит их сам. */
  allowedStatuses: FeedbackStatusCode[]
  assigneeCandidates: { userId: string; safeLabel: string }[]
  duplicateOf: FeedbackDuplicateLink | null
  registry: FeedbackRegistry
  /** §35: блоки §28 detail, которых demo-срез не даёт. */
  unavailableBlocks: FeedbackNotice[]
  serverTime: string
}

export type AddFeedbackCommentRequest = {
  feedbackId: string
  kind: FeedbackCommentKind
  body: string
}

export type TriageFeedbackRequest = {
  feedbackId: string
  /** `undefined` — «не трогать»; `null` — «снять». Различие существенно:
   * снятие ответственного — такое же событие ленты, как назначение. */
  assigneeUserId?: string | null
  workingPriorityCode?: FeedbackPriorityCode | null
  statusCode?: FeedbackStatusCode
}

export type CloseFeedbackRequest = {
  feedbackId: string
  /** Только терминальный статус справочника. */
  statusCode: FeedbackStatusCode
  /** Обязателен для `DUPLICATE`: признание дубликатом без адресата —
   * утверждение ни о чём. */
  duplicateOfId?: string | null
  /** §28: закрытие сопровождается публичным ответом — человек, написавший
   * обращение, узнаёт причину, а не только новый статус. */
  publicReply: string
}

export type FeedbackMutationResponse = { feedbackId: string }
