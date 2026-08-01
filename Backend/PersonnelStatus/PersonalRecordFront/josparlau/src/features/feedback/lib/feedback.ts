// Чистая логика реестра обращений (§28): видимость, вырезание закрытого
// содержания, область поиска, порядок, страницы и сводка.
//
// Здесь нет ни доступа к персистентности, ни прав — только правила, которые
// repository применяет, а тесты проверяют по одному.
import type {
  FeedbackCommentKind,
  FeedbackEventKind,
  FeedbackRequest,
  FeedbackStatusCode,
  FeedbackTypeCode,
} from '../model/types'

/** Пункт §35: чего этот срез не даёт и почему. Объявлен СВОИМ, а не взят из
 * `service-reports`: импорт чужой feature красный по ARCH-FE-013, а поднимать
 * три строки в `shared/` значило бы вынести туда доменное понятие. */
export interface FeedbackNotice {
  code: string
  label: string
  reason: string
}

/** Причина, по которой содержание конфиденциального обращения вырезано. */
export const RESTRICTED_REASON =
  'Обращение помечено автором как конфиденциальное: содержание доступно автору и обладателю права ops.feedback.view_confidential.'

/**
 * §35 — чего в этом срезе нет.
 *
 * Каждый пункт назван причиной, а не пустым местом: молчание читалось бы как
 * «учтено», а ноль — как «измерено и оказалось нулём».
 */
export const UNAVAILABLE_CAPABILITIES: readonly FeedbackNotice[] = [
  {
    code: 'ATTACHMENT_CONTENT',
    label: 'Содержимое вложений',
    reason:
      'Blob-хранилища в проекте нет (тот же вывод, что «Рекогносцировка: материалы» и «Инциденты с фото»). §28 требует «attachment metadata» — сохраняются имя, размер и тип файла; содержимое не читается и не передаётся, поэтому и скачать вложение нельзя.',
  },
  {
    code: 'WORKING_PRIORITY',
    label: 'Рабочий приоритет',
    reason:
      '§28 отличает заявленный приоритет от рабочего: рабочий назначает разбирающий обращение. Разбора в этом срезе нет, а показывать рабочий приоритет равным заявленному значило бы утверждать, что обращение уже оценили.',
  },
  {
    code: 'TRIAGE_LIFECYCLE',
    label: 'Переходы статусов после «Новое»',
    reason:
      'Из одиннадцати статусов §28 этот срез делает достижимыми «Черновик» и «Новое» (создание и отправка). Остальные приходят из demo-данных, участвуют в фильтре и не выдаются за результат работы с обращением.',
  },
  {
    code: 'ASSIGNEE',
    label: 'Ответственный',
    reason:
      'Назначение ответственного — часть карточки обращения (§28 detail) и требует справочника разбирающих, которого в demo-срезе нет. Пустая колонка «Ответственный» читалась бы как «никому не назначено», а это утверждение, а не факт.',
  },
]

/**
 * §28 list «search». Область поиска — ТОЛЬКО те поля, которые смотрящему
 * видны, и это не перестраховка.
 *
 * Поиск по вырезанному описанию выдаёт его содержимое, ничего не показав:
 * человек набирает слово и по факту совпадения узнаёт, что оно там есть.
 * Поэтому описание участвует в поиске ровно тогда, когда оно же приедет в
 * ответе.
 */
export function matchesSearch(
  request: FeedbackRequest,
  query: string,
  contentVisible: boolean,
): boolean {
  const needle = query.trim().toLocaleLowerCase('ru')
  if (needle === '') return true
  if (request.subject.toLocaleLowerCase('ru').includes(needle)) return true
  if (!contentVisible) return false
  return request.description.toLocaleLowerCase('ru').includes(needle)
}

/** Длина превью описания в реестре. */
export const PREVIEW_LENGTH = 120

/**
 * Превью описания — ПРОИЗВОДНОЕ от описания, и вырезается вместе с ним.
 * Оставить превью у вырезанного описания значило бы вернуть его первые сто
 * двадцать символов соседним полем ответа.
 */
export function previewOf(description: string): string {
  const single = description.replace(/\s+/gu, ' ').trim()
  if (single.length <= PREVIEW_LENGTH) return single
  return `${single.slice(0, PREVIEW_LENGTH).trimEnd()}…`
}

/**
 * Порядок реестра задаёт СЕРВЕР: сначала недавние, при равном времени —
 * по идентификатору. Tie-breaker нужен не для красоты: без него две записи,
 * созданные в одну миллисекунду сценарного времени, меняли бы места между
 * запросами и «съезжали» бы со страницы на страницу при пагинации.
 */
export function sortRequests(requests: readonly FeedbackRequest[]): FeedbackRequest[] {
  return [...requests].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1
    return left.feedbackId < right.feedbackId ? -1 : 1
  })
}

/**
 * §28 list «pagination». Размер страницы НАМЕРЕННО мал: при странице в
 * полсотни строк вторая страница на demo-данных не наступила бы никогда, и
 * пагинация жила бы непроверенной (урок drill-down §22.12).
 */
export const FEEDBACK_PAGE_SIZE = 4

export function pageOf<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export function pageCount(total: number, pageSize: number): number {
  // Ноль строк — всё равно одна (пустая) страница: «страница 1 из 0» не
  // существует, а человек на неё смотрит.
  return Math.max(1, Math.ceil(total / pageSize))
}

export interface FeedbackStatusCount {
  statusCode: FeedbackStatusCode
  count: number
}

export interface FeedbackStats {
  byStatus: FeedbackStatusCount[]
  total: number
}

/**
 * §28 list «stats». Считается по ВСЕМУ видимому смотрящему набору — до
 * фильтров и до нарезки на страницы.
 *
 * Сводка по отрисованной странице была бы итогом по видимой части таблицы —
 * ровно тем приёмом, который §22.3 запрещает и который уже пришлось
 * выкорчёвывать из аналитики службы.
 */
export function buildStats(
  requests: readonly FeedbackRequest[],
  order: readonly FeedbackStatusCode[],
): FeedbackStats {
  const counts = new Map<FeedbackStatusCode, number>()
  for (const request of requests) {
    counts.set(request.statusCode, (counts.get(request.statusCode) ?? 0) + 1)
  }
  return {
    // Порядок статусов — из справочника, а не из порядка встречаемости:
    // иначе сводка перестраивалась бы при каждом новом обращении.
    byStatus: order.map((statusCode) => ({ statusCode, count: counts.get(statusCode) ?? 0 })),
    total: requests.length,
  }
}

export interface FeedbackFilterValues {
  search: string
  typeCode?: FeedbackTypeCode
  statusCode?: FeedbackStatusCode
  moduleCode?: string
}

export function matchesFilters(
  request: FeedbackRequest,
  filters: FeedbackFilterValues,
  contentVisible: boolean,
): boolean {
  if (filters.typeCode !== undefined && request.typeCode !== filters.typeCode) return false
  if (filters.statusCode !== undefined && request.statusCode !== filters.statusCode) return false
  if (filters.moduleCode !== undefined && request.moduleCode !== filters.moduleCode) return false
  return matchesSearch(request, filters.search, contentVisible)
}

// ─── Карточка обращения (§28 detail, Этап 48) ────────────────────────────────

/** Причина, по которой закрытое обращение больше не принимает изменений. */
export const CLOSED_LOCK_REASON =
  'Обращение закрыто: изменения и комментарии в закрытое обращение не добавляются.'

/** Причина отказа во внутренней заметке. */
export const INTERNAL_NOTE_REASON =
  'Внутренняя заметка требует отдельного права ops.feedback.internal_note: право отвечать автору его не включает.'

/** Причина отказа в разборе. */
export const TRIAGE_REASON =
  'Разбор обращения требует права ops.feedback.triage: право читать обращения его не включает.'

/** Причина, по которой публичный ответ недоступен. */
export const REPLY_REASON =
  'Публичный ответ пишет разбирающий обращение (ops.feedback.triage) или его автор.'

/**
 * §28 detail: чего карточка НЕ показывает и почему. Отдельно от
 * `UNAVAILABLE_CAPABILITIES` реестра — у карточки свой список.
 */
export const UNAVAILABLE_CARD_BLOCKS: readonly FeedbackNotice[] = [
  {
    code: 'ATTACHMENT_CONTENT',
    label: 'Содержимое вложений',
    reason:
      'Blob-хранилища в проекте нет: §28 требует «attachment metadata», и карточка показывает имя, размер и тип файла. Кнопки скачивания нет — скачивать нечего.',
  },
  {
    code: 'SLA',
    label: 'Срок реакции',
    reason:
      'Политики сроков (SLA) в модели нет, а срок, посчитанный по умолчанию, был бы обещанием, которого никто не давал.',
  },
  {
    code: 'LINKED_ENTITY',
    label: 'Связанная сущность',
    reason:
      '§28 «related screen» карточка показывает маршрутом, с которого обращение завели. Связь с конкретной записью (мероприятием, сменой, объектом) в модели обращения не хранится: восстанавливать её по тексту значило бы угадывать.',
  },
]

/**
 * Кто может читать внутренние заметки. Отдельное право, и оно НЕ следует из
 * права разбирать: заметка пишется о человеке, обратившемся за помощью.
 */
export function commentVisibleTo(
  kind: FeedbackCommentKind,
  canSeeInternal: boolean,
): boolean {
  return kind === 'PUBLIC_REPLY' || canSeeInternal
}

/**
 * Событие внутренней заметки не показывается тем, кому сама заметка не видна —
 * и целиком, а не «без текста».
 *
 * Строка «добавлена внутренняя заметка» без текста всё равно сообщает автору,
 * что о нём что-то написали и когда: лента превратилась бы в счётчик работы
 * разбора. Автор видит СВОЙ разговор, а не чужую работу над ним.
 */
export function eventVisibleTo(kind: FeedbackEventKind, canSeeInternal: boolean): boolean {
  return kind !== 'INTERNAL_NOTE_ADDED' || canSeeInternal
}

/** Изменение, которое ищет `diffEvents`. */
export interface FeedbackFieldChange {
  fieldCode: string
  oldValue: string | null
  newValue: string | null
  kind: FeedbackEventKind
}

function valueOf(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value
}

/**
 * Лента пишется ДИФФОМ в единственной точке.
 *
 * Ручная запись события на каждой операции означала бы столько мест, где её
 * можно забыть, сколько операций, — а забытое событие не сломало бы ни одного
 * теста разбора и молча оставило бы аудит неполным. Приём тот же, что журнал
 * переходов ОМ (§22.14): операция меняет поля, ничего не зная о ленте.
 */
export function diffEvents(
  before: {
    statusCode: FeedbackStatusCode
    workingPriorityCode: string | null
    assigneeUserId: string | null
    duplicateOfId: string | null
  },
  after: typeof before,
  terminalStatuses: readonly FeedbackStatusCode[],
): FeedbackFieldChange[] {
  const changes: FeedbackFieldChange[] = []
  if (before.statusCode !== after.statusCode) {
    changes.push({
      fieldCode: 'statusCode',
      oldValue: before.statusCode,
      newValue: after.statusCode,
      // Закрытие — отдельный вид события, а не «ещё одна смена статуса»:
      // §28 называет «close» отдельным действием карточки.
      kind: terminalStatuses.includes(after.statusCode) ? 'CLOSED' : 'STATUS_CHANGED',
    })
  }
  if (valueOf(before.workingPriorityCode) !== valueOf(after.workingPriorityCode)) {
    changes.push({
      fieldCode: 'workingPriorityCode',
      oldValue: valueOf(before.workingPriorityCode),
      newValue: valueOf(after.workingPriorityCode),
      kind: 'WORKING_PRIORITY_SET',
    })
  }
  if (valueOf(before.assigneeUserId) !== valueOf(after.assigneeUserId)) {
    changes.push({
      fieldCode: 'assignee',
      oldValue: valueOf(before.assigneeUserId),
      newValue: valueOf(after.assigneeUserId),
      kind: 'ASSIGNED',
    })
  }
  if (valueOf(before.duplicateOfId) !== valueOf(after.duplicateOfId)) {
    changes.push({
      fieldCode: 'duplicateOfId',
      oldValue: valueOf(before.duplicateOfId),
      newValue: valueOf(after.duplicateOfId),
      kind: 'MARKED_DUPLICATE',
    })
  }
  return changes
}

/** Допустимые следующие статусы — из справочника, а не из кода. */
export function allowedTransitions(
  registry: { statusTransitions: { from: FeedbackStatusCode; to: FeedbackStatusCode[] }[] },
  from: FeedbackStatusCode,
): FeedbackStatusCode[] {
  return registry.statusTransitions.find((entry) => entry.from === from)?.to ?? []
}
