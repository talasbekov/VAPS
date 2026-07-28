// «Календарь дежурств» — ТРЕТЬЕ представление §21.4 (сотрудники × дни).
// Данные — тот же `useDutyShifts()`, что «По объектам»/«По сотрудникам»
// (§21.4 прямо требует представления ОДНОГО набора, а не три источника
// истины): недельное окно нарезается из уже загруженного списка, второго
// запроса нет.
//
// Сознательно НЕ реализовано из прототипа: «проекция статусов до/на/после
// дежурства» — длительность окна BEFORE_DUTY открытый вопрос §37 (сам
// прототип подписывает её «условно, уточняется у заказчика»); рисовать
// придуманный интервал запрещено (§35).
import { Button } from '../../../shared/ui/Button'
import {
  dayOfMonthLabel,
  weekDaysIso,
  weekRangeLabel,
  weekdayShortLabel,
} from '../model/calendar'
import type { DutyRosterEntry, DutyShift, DutyShiftState } from '../model/types'

const CELL_STATE_CLASS: Record<DutyShiftState, string> = {
  PLANNED: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  ACKNOWLEDGED: 'border-blue-300 bg-blue-100 text-blue-900',
  ACTIVE: 'border-green-300 bg-green-100 text-green-900',
  COMPLETED: 'border-muted-foreground/20 bg-muted/60 text-muted-foreground line-through',
}

export interface DutyCalendarViewProps {
  weekStart: string
  /** Бизнес-дата сервера — подсветка «сегодня» (не `new Date()` браузера). */
  todayIso: string
  shifts: readonly DutyShift[]
  roster: readonly DutyRosterEntry[]
  dutyTypeLabel: (code: string) => string
  onPrevWeek: () => void
  onNextWeek: () => void
  /** null — прав на назначение нет: клетка не кликабельна (§35). */
  onAssign: ((date: string, employeeId: string) => void) | null
}

export function DutyCalendarView({
  weekStart,
  todayIso,
  shifts,
  roster,
  dutyTypeLabel,
  onPrevWeek,
  onNextWeek,
  onAssign,
}: DutyCalendarViewProps) {
  const days = weekDaysIso(weekStart)
  const byEmployeeAndDate = new Map<string, DutyShift>()
  for (const shift of shifts) {
    byEmployeeAndDate.set(`${shift.employeeId}|${shift.businessDate}`, shift)
  }

  // Строки — весь ростер, а не только сотрудники с назначениями: пустая
  // строка это ответ «на этой неделе не назначен», а не отсутствие данных.
  const rows = [...roster].sort((a, b) => a.fullName.localeCompare(b.fullName))

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onPrevWeek} aria-label="Предыдущая неделя">
            ‹
          </Button>
          <span className="text-sm font-semibold tabular-nums">{weekRangeLabel(weekStart)}</span>
          <Button size="sm" variant="outline" onClick={onNextWeek} aria-label="Следующая неделя">
            ›
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          Сотрудники × дни · клик по свободной клетке — назначение смены
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <caption className="sr-only">
            Календарь дежурств: {weekRangeLabel(weekStart)}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="p-3 text-[11px] font-semibold text-muted-foreground">
                Сотрудник
              </th>
              {days.map((day) => (
                <th
                  key={day}
                  scope="col"
                  className={`p-2 text-center text-[11px] font-semibold ${
                    day === todayIso ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  <span className="block uppercase">{weekdayShortLabel(day)}</span>
                  <span className="block text-sm tabular-nums">{dayOfMonthLabel(day)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((employee) => (
              <tr key={employee.employeeId} className="border-t">
                <th scope="row" className="p-3 text-left align-top">
                  <span className="block text-sm font-medium">{employee.fullName}</span>
                  <span className="block text-xs text-muted-foreground">{employee.unitLabel}</span>
                </th>
                {days.map((day) => {
                  const shift = byEmployeeAndDate.get(`${employee.employeeId}|${day}`)
                  return (
                    <td key={day} className="p-1.5 align-top">
                      {shift !== undefined ? (
                        <span
                          className={`block rounded-md border px-2 py-1.5 text-[11px] font-medium ${CELL_STATE_CLASS[shift.stateCode]}`}
                          title={dutyTypeLabel(shift.dutyTypeCode)}
                        >
                          {shift.target.safeLabel}
                        </span>
                      ) : onAssign !== null ? (
                        <button
                          type="button"
                          className="block w-full rounded-md border border-dashed border-muted-foreground/30 px-2 py-1.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                          onClick={() => onAssign(day, employee.employeeId)}
                        >
                          <span aria-hidden="true">+</span>
                          <span className="sr-only">
                            Назначить смену: {employee.fullName}, {day}
                          </span>
                        </button>
                      ) : (
                        <span className="sr-only">Смены нет</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
