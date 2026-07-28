// Pending-контракты обратной связи (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
//
// ⚠️ Путь грепнут по всему `src` до заведения: коллизия путей в MSW
// разрешается МОЛЧА в пользу первого handler'а (инцидент Этапа 39), ни ошибки,
// ни предупреждения не будет.
import type { FeedbackNotice, FeedbackStats } from '../lib/feedback'
import type {
  FeedbackAttachmentMeta,
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
