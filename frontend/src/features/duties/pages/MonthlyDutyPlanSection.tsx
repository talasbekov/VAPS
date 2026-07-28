// Месячный план дежурств (§21.28 шапка, §21.29 KPI, §21.30 «По объектам»,
// §21.34 конфликты). Экран НИЧЕГО не агрегирует сам: и KPI, и severity
// приходят из ответа — §21.29 прямо запрещает считать итог по отрисованной
// части календаря, §21.34 — определять severity на frontend.
//
// Lifecycle плана (§21.27) и шапка с action policy (§21.28) живут в
// `MonthlyPlanHeaderSection` — у плана появилась собственная сущность
// (`MonthlyPlanRecord`), см. FRONTEND_DECISIONS A70. Прежнее решение A63
// («у плана нет своей сущности, рисовать кнопки не за чем») этим отменено.
import { useMemo, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { useMonthlyDutyPlan } from '../api/queries'
import { addDays, monthOf } from '../lib/monthlyPlan'
import type {
  MonthlyDutyEmployeeCell,
  MonthlyDutyPlanCell,
  MonthlyDutyPlanConflict,
} from '../lib/monthlyPlan'
import { MonthlyPlanHeaderSection } from './MonthlyPlanHeaderSection'

const MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
]

export function monthTitle(month: string): string {
  const index = Number(month.slice(5, 7)) - 1
  return `${MONTH_NAMES[index] ?? month.slice(5, 7)} ${month.slice(0, 4)}`
}

/** Соседние месяцы считаются от 1-го числа: «то же число в следующем месяце»
 * не существует в половине пар месяцев (31 января → 31 февраля). */
export function nextMonth(month: string): string {
  return monthOf(addDays(`${month}-01`, 32))
}

export function previousMonth(month: string): string {
  return monthOf(addDays(`${month}-01`, -1))
}

const SEVERITY_LABEL: Record<MonthlyDutyPlanConflict['severity'], string> = {
  HARD: 'Hard-конфликт',
  SOFT: 'Soft-конфликт',
}

const SEVERITY_CLASS: Record<MonthlyDutyPlanConflict['severity'], string> = {
  HARD: 'inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800',
  SOFT: 'inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800',
}

/** §21.30: подпись ячейки. Пустой день остаётся пустым — «не сформировано»
 * писать нечего: у месяца нет утверждённого плана, с которым можно сравнить
 * (см. шапку файла). */
export function cellTitle(cell: MonthlyDutyPlanCell): string {
  if (cell.shiftCount === 0) return `${cell.date}: дежурств нет`
  const parts = [`${cell.date}: дежурств ${cell.shiftCount}`]
  if (cell.notAcknowledgedCount > 0) parts.push(`без ознакомления ${cell.notAcknowledgedCount}`)
  if (cell.completedCount > 0) parts.push(`завершено ${cell.completedCount}`)
  if (cell.hardConflictCount > 0) parts.push(`hard-конфликтов ${cell.hardConflictCount}`)
  if (cell.softConflictCount > 0) parts.push(`soft-конфликтов ${cell.softConflictCount}`)
  return parts.join(', ')
}

function cellClass(cell: MonthlyDutyPlanCell): string {
  const base =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded border text-[11px] font-semibold tabular-nums'
  if (cell.shiftCount === 0) return `${base} border-dashed border-slate-200 text-slate-400`
  if (cell.hardConflictCount > 0) return `${base} border-red-300 bg-red-100 text-red-800`
  if (cell.softConflictCount > 0) return `${base} border-amber-300 bg-amber-100 text-amber-900`
  if (cell.notAcknowledgedCount > 0) return `${base} border-blue-300 bg-blue-100 text-blue-800`
  return `${base} border-green-300 bg-green-100 text-green-900`
}

/**
 * §21.30, слои клетки «сотрудник × день». Порядок ветвлений — приоритет
 * показа: конфликт важнее вида занятости, неполные данные важнее «всё хорошо».
 * СЕВЕРИТИ НЕ ВЫВОДИТСЯ ЗДЕСЬ — счётчики приходят с сервера (§21.34), клетка
 * лишь выбирает по ним цвет.
 */
function employeeCellClass(cell: MonthlyDutyEmployeeCell): string {
  const base =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded border text-[11px] font-semibold tabular-nums'
  if (cell.hardConflictCount > 0) return `${base} border-red-300 bg-red-100 text-red-800`
  if (cell.softConflictCount > 0) return `${base} border-amber-300 bg-amber-100 text-amber-900`
  if (cell.incompleteData) return `${base} border-slate-400 bg-slate-200 text-slate-700`
  if (cell.layer === 'DUTY') return `${base} border-green-300 bg-green-100 text-green-900`
  if (cell.layer === 'REST') return `${base} border-blue-200 bg-blue-50 text-blue-800`
  return `${base} border-dashed border-slate-200 text-slate-400`
}

function employeeCellGlyph(cell: MonthlyDutyEmployeeCell): string {
  if (cell.layer === 'DUTY') return String(cell.dutyCount)
  if (cell.layer === 'REST') return 'о'
  return '·'
}

/** Текст для скринридера и подсказки: клетка обязана читаться словами, а не
 * только цветом (одного цвета недостаточно — WCAG 1.4.1). */
function employeeCellTitle(cell: MonthlyDutyEmployeeCell): string {
  const parts: string[] = [cell.date]
  if (cell.layer === 'DUTY') {
    parts.push(cell.dutyCount === 1 ? 'дежурство' : `дежурств: ${cell.dutyCount}`)
  } else if (cell.layer === 'REST') {
    parts.push('обязательный отдых после дежурства')
  } else {
    parts.push('дежурств нет')
  }
  if (cell.incompleteData) parts.push('неполные данные: нет привязки к версии паспорта')
  if (cell.hardConflictCount > 0) parts.push(`жёстких конфликтов: ${cell.hardConflictCount}`)
  if (cell.softConflictCount > 0) parts.push(`мягких конфликтов: ${cell.softConflictCount}`)
  return parts.join(', ')
}

export function MonthlyDutyPlanSection({
  initialMonth,
  onAddShift,
}: {
  initialMonth: string
  onAddShift: () => void
}) {
  const [month, setMonth] = useState(initialMonth)
  const planQuery = useMonthlyDutyPlan(month)
  const plan = planQuery.data ?? null
  // §19.х: при смене месяца экран НЕ гасится — показываем прежние данные с
  // явным индикатором обновления.
  const [matrix, setMatrix] = useState<'BY_OBJECT' | 'BY_EMPLOYEE'>('BY_OBJECT')
  const isRefreshing = planQuery.isPlaceholderData && planQuery.isFetching

  const kpiItems = useMemo(() => {
    if (plan === null) return []
    return [
      { label: 'Объектов в плане', value: plan.kpi.objectsInPlan },
      { label: 'Дежурств', value: plan.kpi.shifts },
      // Отменённые — ОТДЕЛЬНЫЙ показатель, а не вычет из «Дежурств»: без него
      // отмена выглядела бы как исчезновение смены из плана.
      { label: 'Отменено', value: plan.kpi.cancelled },
      { label: 'Без ознакомления', value: plan.kpi.notAcknowledged },
      { label: 'Завершено', value: plan.kpi.completed },
      { label: 'Hard-конфликтов', value: plan.kpi.hardConflicts },
      { label: 'Soft-конфликтов', value: plan.kpi.softConflicts },
    ]
  }, [plan])

  return (
    <section aria-label="Месячный план дежурств">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label="Предыдущий месяц"
            onClick={() => setMonth(previousMonth)}
          >
            ←
          </Button>
          <span className="min-w-[9.5rem] text-center text-sm font-semibold">
            {monthTitle(month)}
          </span>
          <Button
            size="sm"
            variant="outline"
            aria-label="Следующий месяц"
            onClick={() => setMonth(nextMonth)}
          >
            →
          </Button>
        </div>
        <div className="flex items-center gap-3">
          {/* §21.30: два ПРЕДСТАВЛЕНИЯ одного ответа — второй запрос не
              делается, обе матрицы посчитаны по одному снимку.
              ⚠️ Подписи — в нотации матриц самого §21.30 («Объект ×
              календарный день»), а НЕ «По объектам»/«По сотрудникам»: ровно
              так называются вкладки страницы выше, и одинаковые имена дали бы
              на одном экране две пары неразличимых кнопок (в том числе для
              скринридера — поймано e2e). */}
          <div className="flex gap-2 rounded-md border bg-muted/40 p-1">
            <Button
              size="sm"
              variant={matrix === 'BY_OBJECT' ? 'default' : 'ghost'}
              onClick={() => setMatrix('BY_OBJECT')}
            >
              Объекты × дни
            </Button>
            <Button
              size="sm"
              variant={matrix === 'BY_EMPLOYEE' ? 'default' : 'ghost'}
              onClick={() => setMatrix('BY_EMPLOYEE')}
            >
              Сотрудники × дни
            </Button>
          </div>
          {isRefreshing && <span className="text-xs text-slate-600">Обновление месяца…</span>}
        </div>
      </div>

      {planQuery.isLoading && <p className="text-sm text-muted-foreground">Загрузка плана…</p>}
      {planQuery.isError && (
        <p className="text-sm text-destructive">Не удалось загрузить месячный план.</p>
      )}

      {/* §21.27-21.28: шапка выше KPI — состояние плана определяет, что вообще
          можно делать с месяцем, и читается раньше цифр. */}
      {plan !== null && (
        <MonthlyPlanHeaderSection
          header={plan.header}
          monthLabel={monthTitle(month)}
          onAddShift={onAddShift}
        />
      )}

      {plan !== null && (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
            {kpiItems.map((item) => (
              // Именованная группа: даёт показателю доступное имя и адресуемость
              // (иначе значение KPI отличимо от чисел сетки только по позиции).
              <div
                key={item.label}
                role="group"
                aria-label={item.label}
                className="rounded-xl border bg-card p-3"
              >
                <p className="text-[11px] font-semibold text-slate-600">{item.label}</p>
                <p className="text-xl font-bold tabular-nums">{item.value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-600">
            Значения посчитаны сервером по всему месяцу, а не по отрисованной части календаря
            (§21.29).
          </p>

          {/* Прокручиваемая по горизонтали область обязана быть достижима с
              клавиатуры: внутри таблицы нет ни одного фокусируемого элемента,
              поэтому без tabIndex сетку нельзя пролистать без мыши
              (WCAG 2.1.1, axe scrollable-region-focusable — поймано axe-спекой
              на матрице по сотрудникам, исправлено в обеих). */}
          {matrix === 'BY_OBJECT' && (
          <div
            tabIndex={0}
            role="region"
            aria-label={`Дежурства по объектам и дням месяца: ${monthTitle(month)}`}
            className="overflow-x-auto rounded-xl border bg-card"
          >
            <table className="border-collapse text-left">
              <caption className="sr-only">
                Дежурства по объектам и дням месяца: {monthTitle(month)}
              </caption>
              <thead>
                <tr>
                  <th className="sticky left-0 bg-card p-3 text-[11px] font-semibold text-slate-600">
                    Объект
                  </th>
                  {plan.days.map((date) => (
                    <th
                      key={date}
                      scope="col"
                      className="p-1 text-center text-[10px] font-semibold text-slate-600 tabular-nums"
                    >
                      {date.slice(8, 10)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.rows.length === 0 && (
                  <tr className="border-t">
                    <td
                      className="p-6 text-center text-sm text-muted-foreground"
                      colSpan={plan.days.length + 1}
                    >
                      В этом месяце дежурств не запланировано
                    </td>
                  </tr>
                )}
                {plan.rows.map((row) => (
                  <tr key={row.objectId} className="border-t">
                    <th
                      scope="row"
                      className="sticky left-0 whitespace-nowrap bg-card p-3 text-left text-sm font-semibold"
                    >
                      {row.objectLabel}
                    </th>
                    {row.cells.map((cell) => (
                      <td key={cell.date} className="p-1">
                        <span className={cellClass(cell)} title={cellTitle(cell)}>
                          <span className="sr-only">{cellTitle(cell)}</span>
                          <span aria-hidden="true">
                            {cell.shiftCount === 0 ? '·' : cell.shiftCount}
                          </span>
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {matrix === 'BY_EMPLOYEE' && (
            <>
              <div
                tabIndex={0}
                role="region"
                aria-label={`Доступность сотрудников по дням месяца: ${monthTitle(month)}`}
                className="overflow-x-auto rounded-xl border bg-card"
              >
                <table className="border-collapse text-left">
                  <caption className="sr-only">
                    Доступность сотрудников по дням месяца: {monthTitle(month)}
                  </caption>
                  <thead>
                    <tr>
                      <th className="sticky left-0 bg-card p-3 text-[11px] font-semibold text-slate-600">
                        Сотрудник
                      </th>
                      {plan.days.map((date) => (
                        <th
                          key={date}
                          scope="col"
                          className="p-1 text-center text-[10px] font-semibold text-slate-600 tabular-nums"
                        >
                          {date.slice(8, 10)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.employeeRows.length === 0 && (
                      <tr className="border-t">
                        <td
                          className="p-6 text-center text-sm text-muted-foreground"
                          colSpan={plan.days.length + 1}
                        >
                          В этом месяце дежурств не запланировано
                        </td>
                      </tr>
                    )}
                    {plan.employeeRows.map((row) => (
                      <tr key={row.employeeName} className="border-t">
                        <th
                          scope="row"
                          className="sticky left-0 whitespace-nowrap bg-card p-3 text-left text-sm font-semibold"
                        >
                          {row.employeeName}
                        </th>
                        {row.cells.map((cell) => (
                          <td key={cell.date} className="p-1">
                            <span
                              className={employeeCellClass(cell)}
                              title={employeeCellTitle(cell)}
                            >
                              <span className="sr-only">{employeeCellTitle(cell)}</span>
                              <span aria-hidden="true">{employeeCellGlyph(cell)}</span>
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <section className="rounded-xl border border-dashed bg-muted/30 p-4">
                <h2 className="mb-2 text-sm font-semibold">Слои, которых нет в модели</h2>
                <p className="mb-2 text-xs text-slate-600">
                  §21.30 называет шесть слоёв доступности. Показаны четыре — дежурство,
                  обязательный отдых, конфликт и неполные данные. Остальные два не выводимы:
                </p>
                <ul className="flex flex-col gap-2">
                  {plan.unavailableLayers.map((layer) => (
                    <li key={layer.code} className="text-xs text-slate-600">
                      <span className="font-semibold">{layer.label}</span> — {layer.reason}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Конфликты месяца</h2>
            {plan.conflicts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Конфликтов не найдено: ни пересечений дежурств, ни нарушений обязательного отдыха.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {plan.conflicts.map((conflict) => (
                  <li key={conflict.conflictId} className="flex flex-wrap items-center gap-2">
                    <span className={SEVERITY_CLASS[conflict.severity]}>
                      {SEVERITY_LABEL[conflict.severity]}
                    </span>
                    <span className="text-sm">{conflict.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-dashed bg-muted/30 p-4">
            <h2 className="mb-2 text-sm font-semibold">Показатели, которых нет в модели</h2>
            <ul className="flex flex-col gap-2">
              {plan.unavailableMetrics.map((metric) => (
                <li key={metric.code} className="text-xs text-slate-600">
                  <span className="font-semibold">{metric.label}</span> — {metric.reason}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </section>
  )
}
