// Чистая логика реестра обращений (§28): видимость, вырезание закрытого
// содержания, область поиска, порядок, страницы и сводка.
//
// Здесь нет ни доступа к персистентности, ни прав — только правила, которые
// repository применяет, а тесты проверяют по одному.
import type {
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
