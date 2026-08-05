// Story 19.4d: месячный календарь статусов сотрудника — панель, встроенная
// в EmployeeDetailPage (FR-37). БЕЗ цветовой палитры (StatusType.color) —
// 19.4b's Scope Decision откладывает это до отдельной стори над
// /statuses/types/, которого пока не существует фронтенд-хука.
import { useState } from 'react'
import { useEmployeeStatusCalendar } from '../api/queries'
import { ApiError } from '../../../shared/api/errors'

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTH_LABELS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// JS Date.getDay(): 0=Вс..6=Сб. Матрица недели начинается с Пн — сдвиг на
// количество ПУСТЫХ ячеек перед 1-м числом.
function leadingBlankCells(year: number, month: number): number {
  const jsDay = new Date(year, month - 1, 1).getDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

export function StatusCalendarPanel({
  divisionId,
  employeeId,
  initialYear,
  initialMonth,
}: {
  divisionId: string
  employeeId: string
  // Test-only seam: avoids faking Date/timers (which fights TanStack
  // Query's internal timers) to exercise year-boundary/leap-year cases.
  initialYear?: number
  initialMonth?: number
}) {
  const now = new Date()
  const [year, setYear] = useState(initialYear ?? now.getFullYear())
  const [month, setMonth] = useState(initialMonth ?? now.getMonth() + 1)

  const query = useEmployeeStatusCalendar(divisionId, employeeId, year, month)

  function goPrevMonth() {
    if (month === 1) {
      setYear((y) => y - 1)
      setMonth(12)
    } else {
      setMonth((m) => m - 1)
    }
  }

  function goNextMonth() {
    if (month === 12) {
      setYear((y) => y + 1)
      setMonth(1)
    } else {
      setMonth((m) => m + 1)
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Календарь статусов</div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={goPrevMonth}
            aria-label="Предыдущий месяц"
            className="rounded border px-2 py-1 font-semibold hover:bg-muted"
          >
            ‹
          </button>
          <span className="min-w-[9rem] text-center font-medium">
            {MONTH_LABELS[month - 1]} {year}
          </span>
          <button
            type="button"
            onClick={goNextMonth}
            aria-label="Следующий месяц"
            className="rounded border px-2 py-1 font-semibold hover:bg-muted"
          >
            ›
          </button>
        </div>
      </div>

      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка календаря…</p>
      )}

      {query.isError && (
        <p className="text-sm text-destructive">
          Не удалось загрузить календарь
          {query.error instanceof ApiError ? `: ${query.error.message}` : ''}.
        </p>
      )}

      {query.isSuccess && (
        <div className="grid grid-cols-7 gap-1 text-[11px]">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="text-center font-semibold text-muted-foreground">
              {label}
            </div>
          ))}
          {Array.from({ length: leadingBlankCells(year, month) }, (_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {Array.from({ length: daysInMonth(year, month) }, (_, i) => {
            const day = i + 1
            const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const code = query.data[iso]
            return (
              <div
                key={iso}
                className="flex flex-col items-center gap-0.5 rounded border p-1 text-center"
              >
                <span className="font-semibold">{day}</span>
                <span className="truncate text-muted-foreground" title={code}>
                  {code ?? '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
