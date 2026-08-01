// Пустая LimitOffset-страница — ЕДИНСТВЕННЫЙ владелец формы конверта
// (ревью Этапа 73: пять литералов по коду дрейфовали бы порознь при смене
// контракта пагинации).
export const EMPTY_LIMIT_OFFSET_PAGE = {
  count: 0,
  next: null,
  previous: null,
  results: [],
} as const

export function emptyLimitOffsetPage(): {
  count: number
  next: null
  previous: null
  results: never[]
} {
  return { ...EMPTY_LIMIT_OFFSET_PAGE, results: [] }
}
