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
  /**
   * §28 detail «working priority» — приоритет РАБОЧИЙ, отличный от заявленного
   * автором. `null` до разбора: приравнять его к заявленному значило бы
   * утверждать, что обращение уже оценили.
   */
  workingPriorityCode: FeedbackPriorityCode | null
  /** §28 detail «assignee». `null` — «никому не назначено», и это факт, а не
   * пустое место: назначение — отдельное событие ленты. */
  assignee: FeedbackAuthor | null
  /** §28 detail «duplicate»: идентификатор обращения, дубликатом которого
   * признано это. Заполняется только вместе со статусом `DUPLICATE`. */
  duplicateOfId: string | null
  author: FeedbackAuthor
  createdAt: string
  /** `null` у черновика: черновик ещё не отправлен, и «дата отправки»
   * у него — не ноль, а отсутствие события. */
  submittedAt: string | null
  updatedAt: string
}

/**
 * §28 detail «public reply» / «internal note только по праву».
 *
 * Два ВИДА комментария, а не флаг «приватный» у одного: у них разные читатели,
 * разные права на запись и разная судьба в ленте событий. Флагом их различать
 * значило бы держать оба текста в одной коллекции и полагаться на то, что
 * фильтр не забудут.
 */
export type FeedbackCommentKind = 'PUBLIC_REPLY' | 'INTERNAL_NOTE'

export interface FeedbackComment {
  commentId: string
  feedbackId: string
  kind: FeedbackCommentKind
  body: string
  author: FeedbackAuthor
  createdAt: string
}

/**
 * §28 detail «timeline» и «audit» — ОДНА лента, а не две.
 *
 * Разделять их значило бы держать два журнала об одних и тех же событиях и
 * рано или поздно разойтись. Событие несёт и то, что видит человек
 * (`kind`), и то, что требует аудит: кто, когда, что было и что стало.
 */
export type FeedbackEventKind =
  | 'CREATED'
  | 'SUBMITTED'
  | 'STATUS_CHANGED'
  | 'ASSIGNED'
  | 'WORKING_PRIORITY_SET'
  | 'PUBLIC_REPLY_ADDED'
  | 'INTERNAL_NOTE_ADDED'
  | 'MARKED_DUPLICATE'
  | 'CLOSED'

export interface FeedbackEvent {
  eventId: string
  feedbackId: string
  kind: FeedbackEventKind
  actor: FeedbackAuthor
  at: string
  /** Аудит §28: «old/new» по изменённому полю. `null` у событий, которые
   * ничего не меняли (добавление комментария). */
  fieldCode: string | null
  oldValue: string | null
  newValue: string | null
}

/**
 * §28 detail: действия карточки. Их считает СЕРВЕР — по статусу, правам
 * смотрящего и замку закрытого обращения. В компоненте нет ни одной ветки
 * «если закрыто — выключить кнопку» (тот же приём, что action policy
 * месячного плана §21.28 и история отчётов §22.25).
 */
export type FeedbackActionCode =
  | 'ADD_PUBLIC_REPLY'
  | 'ADD_INTERNAL_NOTE'
  | 'TRIAGE'
  | 'CLOSE'

export interface FeedbackAction {
  code: FeedbackActionCode
  available: boolean
  /** `null`, пока действие доступно: причина нужна ровно там, где отказ. */
  reason: string | null
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
  /**
   * §28 lifecycle: допустимые переходы статусов — В ДАННЫХ.
   *
   * Зашитый в код переход означал бы, что порядок разбора принадлежит экрану;
   * здесь он принадлежит серверу, и экран показывает ровно то, что пришло.
   */
  statusTransitions: { from: FeedbackStatusCode; to: FeedbackStatusCode[] }[]
  /** Статусы, после которых обращение закрыто для изменений. Тоже в данных. */
  terminalStatuses: FeedbackStatusCode[]
  /** Версия справочника: подписи могли измениться после того, как обращение
   * завели, и клиент должен уметь заметить расхождение. */
  registryVersion: string
}
