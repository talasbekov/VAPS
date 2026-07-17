// Канон-слот shared/lib (architecture L554-555). Хойст трёх дословных копий
// (daily-grid/prefill.ts, readiness-tree/ReadinessTreePage.tsx,
// expense-report/expenseReport.ts + ExpenseReportPage.tsx,
// print-forms/expensePrint.ts) — deferred-work.md «Дата-хелперы ×3 копии»,
// триггер «третья копия случилась». Barrel-index запрещён — импортировать
// напрямую.

/** ISO-дата YYYY-MM-DD (без календарной валидации — только формат строки). */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Сегодняшняя ЛОКАЛЬНАЯ дата (дефолт date-input экрана — Решение №6 10.2).
 * ТОЛЬКО дефолт берёт локальные геттеры (осознанно, НЕ UTC-срез: оператор
 * живёт в местных сутках); вся АРИФМЕТИКА дат — addDaysIso (UTC, урок
 * tz-флейка test_vacancies_endpoint). */
export function todayLocalIso(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

// UTC-математика, не local (урок tz-флейка test_vacancies_endpoint): локальный
// парсер сдвинул бы дату на границе суток в минусовых поясах.
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
