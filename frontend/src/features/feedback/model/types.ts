// Обратная связь Smart Josparlau (§28): обращение пользователя — тип,
// приоритет, статус, модуль, вложения (МЕТАДАННЫЕ), контакт, признак
// конфиденциальности и техническая информация по согласию автора.
//
// Коды — В ТИПАХ (§28 перечисляет их поимённо, это контракт), подписи и
// порядок — В ДАННЫХ (`FeedbackRegistry` в слайсе): экран не хранит ни одной
// русской подписи справочника и не решает, в каком порядке их показывать.

/** §28 «Типы». */
export type FeedbackTypeCode = 'BUG' | 'WRONG_DATA' | 'UX' | 'IDEA' | 'ACCESS' | 'HELP'

/** §28 «Приоритеты». Это приоритет, ЗАЯВЛЕННЫЙ автором.
 *
 * Рабочий приоритет (§28 detail «working priority») — другое поле и другой
 * владелец: его назначает разбирающий обращение, а не тот, кто его завёл.
 * В этом срезе разбора нет, поэтому нет и рабочего приоритета — он назван в
 * блоке §35, а не показан равным заявленному. */
export type FeedbackPriorityCode = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'

/**
 * §28 «Статусы» — все одиннадцать. Достижимы из этого среза только `DRAFT` и
 * `NEW` (создание и отправка); остальные приходят из demo-данных и участвуют
 * в фильтре, потому что реестр обязан уметь их показать. Переходы разбора —
 * отдельная работа, и это сказано в §35, а не спрятано.
 */
export type FeedbackStatusCode =
  | 'DRAFT'
  | 'NEW'
  | 'IN_REVIEW'
  | 'NEED_INFO'
  | 'ACCEPTED'
  | 'PLANNED'
  | 'FIXED'
  | 'RELEASED'
  | 'REJECTED'
  | 'CLOSED'
  | 'DUPLICATE'

/**
 * §28 create «attachment metadata» — ровно метаданные, и это не сокращение
 * объёма, а единственное, что здесь правда.
 *
 * Blob-хранилища в проекте нет (тот же вывод, что «Рекогносцировка:
 * материалы» и «Инциденты с фото»), поэтому содержимое файла не читается
 * ВООБЩЕ: форма берёт у выбранного файла имя, размер и тип, а сервер
 * отказывается сохранять любое поле с содержимым, даже если оно приехало в
 * теле запроса. Кнопка «скачать вложение» не нарисована — скачивать нечего.
 */
export interface FeedbackAttachmentMeta {
  fileName: string
  sizeBytes: number
  mimeType: string
}

/**
 * §28 create «include technical info» — техническая информация пишется ТОЛЬКО
 * по явному согласию автора.
 *
 * Согласие проверяет СЕРВЕР и сам решает, сохранять ли присланное: без
 * согласия поля нет вовсе (`null`), а не пустой объект. Пустой объект читался
 * бы как «собрали и ничего не нашли», тогда как правда — «не собирали».
 */
export interface FeedbackTechnicalInfo {
  appRevision: string
  viewport: string
  platform: string
  capturedAt: string
}

export interface FeedbackAuthor {
  userId: string
  safeLabel: string
}

/** Обращение, КАК ОНО ЛЕЖИТ В СЛАЙСЕ. Наружу едет проекция
 * (`FeedbackRequestView`) — у неё закрытые поля могут отсутствовать. */
export interface FeedbackRequest {
  feedbackId: string
  subject: string
  description: string
  typeCode: FeedbackTypeCode
  priorityCode: FeedbackPriorityCode
  statusCode: FeedbackStatusCode
  moduleCode: string
  expectedResult: string | null
  reproductionSteps: string | null
  attachments: FeedbackAttachmentMeta[]
  contact: string | null
  /** §28 create «confidential». Закрывает СОДЕРЖАНИЕ обращения, но не тему —
   * см. `RESTRICTED_REASON` в `lib/feedback.ts`. */
  confidential: boolean
  /** §28 create «related route/context» — экран, о котором обращение. Это
   * предмет обращения, а не телеметрия, поэтому хранится независимо от
   * согласия на техническую информацию. */
  relatedRoute: string | null
  technicalInfo: FeedbackTechnicalInfo | null
  author: FeedbackAuthor
  createdAt: string
  /** `null` у черновика: черновик ещё не отправлен, и «дата отправки»
   * у него — не ноль, а отсутствие события. */
  submittedAt: string | null
  updatedAt: string
}

/** Справочник §28: подписи и ПОРЯДОК приходят с сервера. */
export interface FeedbackDictionaryEntry<TCode extends string> {
  code: TCode
  label: string
}

export interface FeedbackModuleEntry {
  moduleCode: string
  label: string
}

export interface FeedbackRegistry {
  types: FeedbackDictionaryEntry<FeedbackTypeCode>[]
  priorities: FeedbackDictionaryEntry<FeedbackPriorityCode>[]
  statuses: FeedbackDictionaryEntry<FeedbackStatusCode>[]
  modules: FeedbackModuleEntry[]
  /** Версия справочника: подписи могли измениться после того, как обращение
   * завели, и клиент должен уметь заметить расхождение. */
  registryVersion: string
}
