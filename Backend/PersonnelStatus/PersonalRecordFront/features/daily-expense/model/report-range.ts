/** Keep the displayed daily report inside the period the user is reviewing. */
export function reportRangeQuery(query: URLSearchParams, activeDate: string | null, from: string | null, to: string | null): URLSearchParams {
  const next = new URLSearchParams(query)
  if (!from || !to) {
    next.delete('dateFrom')
    next.delete('dateTo')
    return next
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return next
  next.set('dateFrom', from)
  next.set('dateTo', to)
  if (activeDate === null || activeDate < from) next.set('businessDate', from)
  else if (activeDate > to) next.set('businessDate', to)
  return next
}
