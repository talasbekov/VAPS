// Сводный экран «Итоговые оценки участников» (§19.15-19.16): отбор строк,
// страницы и безопасный контекст оценщика.
//
// ГЛАВНОЕ СВОЙСТВО РЕЕСТРА: строка НЕ несёт закрытых величин. §19.16 для
// держателя одного лишь права на агрегат требует скрыть score, комментарий,
// основание и оценщика — здесь их нет в САМОЙ СТРОКЕ, а не в вёрстке: сервер
// собирает проекцию без них (§19.21 «закрытость обеспечивается API»).
//
// Отбор живёт здесь, но выполняется НА СЕРВЕРЕ: отфильтровать в браузере
// значило бы сначала привезти туда всё, включая строки вне разрешённого
// периода и подразделения.
import type { EvaluationDirection, EvaluationMethod, RatingDataState } from '../model/types'

/** Сколько строк на странице. §19.15 требует хранить страницу в URL — значит,
 * страницы вообще должны существовать, а не «показать всё». */
export const REGISTRY_PAGE_SIZE = 10

/** Подпись вместо закрытых величин (§19.16, дословно). */
export const CLOSED_DETAILS_LABEL = 'Детали оценки закрыты'

/**
 * Строка реестра. Ни `score`, ни `comment`, ни `basisCode`, ни оценщика:
 * перечисление собирается сервером полем за полем, и новое закрытое поле в
 * него не попадёт само.
 */
export interface EvaluationRegistryRow {
  /** Идентификатор СТРОКИ, а не оценки: идентификатор закрытой записи —
   * тоже сведение о ней (по нему её можно спрашивать поимённо). */
  rowId: string
  employeeId: string
  employeeSafeLabel: string
  /** Подразделение НА МОМЕНТ мероприятия — снимок, а не текущее (§19.12). */
  unitSafeLabel: string
  eventNumber: string
  eventTitle: string
  objectLabel: string
  /** Пост или роль; `null` — задание к этой записи не привязано. */
  postLabel: string | null
  /** Факт участия; `null` — сведений нет, и это не «не участвовал». */
  participated: boolean | null
  evaluationDirection: EvaluationDirection
  method: EvaluationMethod
  /** Дата, к которой отнесена запись. */
  evaluatedAt: string
  /** Признак исправления (§19.16) — по correction chain, а не сравнением значений. */
  corrected: boolean
  /** Разрешённый агрегат сотрудника и его состояние — то единственное число,
   * которое §19.16 позволяет показать держателю права на агрегат. */
  aggregateRating: number | null
  aggregateState: RatingDataState
}

export interface RegistryFilters {
  from: string | null
  to: string | null
  event: string | null
  unit: string | null
  employee: string | null
  direction: EvaluationDirection | null
  method: EvaluationMethod | null
  /** §19.16 «признак исправления» — фильтр по нему, а не по значению оценки. */
  correctedOnly: boolean
  search: string
  page: number
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
  search: '',
  page: 1,
}

export function matchesFilters(row: EvaluationRegistryRow, filters: RegistryFilters): boolean {
  if (filters.from !== null && row.evaluatedAt < filters.from) return false
  // Границы периода ВКЛЮЧИТЕЛЬНЫ с обеих сторон: «с 1 по 31» без последнего дня
  // — самая тихая ошибка отчётного периода.
  if (filters.to !== null && row.evaluatedAt > filters.to) return false
  if (filters.event !== null && `${row.eventNumber}` !== filters.event) return false
  if (filters.unit !== null && row.unitSafeLabel !== filters.unit) return false
  if (filters.employee !== null && row.employeeId !== filters.employee) return false
  if (filters.direction !== null && row.evaluationDirection !== filters.direction) return false
  if (filters.method !== null && row.method !== filters.method) return false
  if (filters.correctedOnly && !row.corrected) return false
  const search = filters.search.trim().toLowerCase()
  if (search !== '') {
    // Поиск идёт ТОЛЬКО по безопасным подписям: искать по комментарию значило бы
    // подтверждать наличие в нём слова, то есть раскрывать закрытый текст по
    // одной букве за запрос.
    const haystack = [
      row.employeeSafeLabel,
      row.unitSafeLabel,
      row.eventNumber,
      row.eventTitle,
      row.objectLabel,
      row.postLabel ?? '',
    ]
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(search)) return false
  }
  return true
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / REGISTRY_PAGE_SIZE))
}

export function pageOf<T>(rows: readonly T[], page: number): T[] {
  const safePage = Math.min(Math.max(1, page), pageCount(rows.length))
  const start = (safePage - 1) * REGISTRY_PAGE_SIZE
  return rows.slice(start, start + REGISTRY_PAGE_SIZE)
}

/**
 * Безопасный контекст оценщика (§19.16). Это РОЛЬ и способ появления записи, а
 * не человек: §19.16 прямо запрещает показывать «кто оценил» и требует, чтобы
 * контекст не позволял вычислить личность оценщика.
 *
 * Системная оценка называется отдельно (§19.8): у неё оценщика нет вовсе, и
 * приписать ей роль «старший» значило бы выдумать человека.
 */
export function safeEvaluatorContext(
  method: EvaluationMethod,
  direction: EvaluationDirection,
  corrected: boolean,
): string {
  if (method === 'SYSTEM_DEFAULT') return 'Системная оценка по умолчанию'
  if (corrected) return 'Исправление уполномоченным пользователем'
  return direction === 'EMPLOYEE_TO_SENIOR'
    ? 'Сотрудник → старший'
    : direction === 'SENIOR_TO_GROUP'
      ? 'Групповая оценка'
      : 'Старший → сотрудник'
}

/** §35: фильтры и колонки §19.15-19.16, которых нет, и почему. */
export const UNAVAILABLE_REGISTRY_VIEWS: readonly {
  code: string
  label: string
  reason: string
}[] = [
  {
    code: 'SENSITIVE_COLUMNS',
    label: 'Score, комментарий, основание и оценщик отдельной записи',
    reason:
      '§19.16: держателю права на агрегат они закрыты, а sensitive-просмотр по §19.21 требует organization scope, event scope и срока полномочия одновременно — ни того, ни другого в сборке нет. Поэтому колонок не «нет на экране»: этих полей нет в ответе API, и подпись «Детали оценки закрыты» стоит на их месте честно.',
  },
  {
    code: 'RECOGNITION_FILTERS',
    label: 'Фильтры «С благодарностью» и «С замечанием»',
    reason:
      '§19.11 запрещает выводить тип из значения оценки, а подтверждённых сущностей поощрения и замечания в контракте нет. Фильтр по несуществующему признаку молча возвращал бы пустой список и читался бы как «таких нет».',
  },
  {
    code: 'DOCUMENT_FILTER',
    label: 'Фильтр «Только с документами» и колонка документа',
    reason:
      'Документ считается прикреплённым только после ответа repository (§19.11), а хранилища вложений в сборке нет вовсе (§35). Пустая колонка утверждала бы, что документов нет ни у одной записи.',
  },
  {
    code: 'SERVICE_RESULT',
    label: 'Колонка «Результат службы»',
    reason:
      '§19 разделяет оценку и фактическое время службы (`ServiceHoursEntry`) — это разные сущности из разных источников. Показать их в одной строке значило бы объявить связь, которой никто не подтверждал.',
  },
]
