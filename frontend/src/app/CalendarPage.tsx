// Единый календарь смен (§25 мастер-промпта). Живёт в app/, НЕ в
// features/calendar — по тому же принципу, что ServiceAnalyticsPage (A33):
// экран композирует данные ТРЁХ независимых фич (duties, security-events),
// а ARCH-FE-013 запрещает features→features.
//
// §25 целиком описывает Calendar Repository, объединяющий 9 контуров
// (Employee Status/Duty/Security Event/Route/Facility/Secondment/Conflict/
// Workload/Acknowledgement) в ЕДИНУЮ проекцию по стабильному employeeId,
// с конфликтами, нагрузкой, отдыхом и режимами «Мой календарь»/«Сотрудник»/
// «Подразделение». Ничего из ЭТОГО честно не реализуемо в текущем demo-срезе
// — см. FRONTEND_DECISIONS A44-A46 для полного разбора причин (сотрудники в
// duties/security-events НЕ имеют общего стабильного идентификатора —
// объединение по имени дало бы ложные совпадения, см. A44).
//
// Реализован «Календарь по дням» (§25.12) в честном урезанном виде: список
// назначений (дежурства + расстановки ОМ + боевые группы на Трассах, §24.5-
// §24.10, добавлено по запросу «продолжай разрабатывать») за один
// календарный день, каждая запись подписана СВОИМ источником (не объединена
// в одну карточку сотрудника). Боевые группы НЕ требуют A44-A46 обхода — в
// отличие от «по сотруднику», список «по дням» уже сегодня не объединяет
// записи, только перечисляет их (тот же принцип, что дежурства/ОМ выше), так
// что добавление третьего источника ничего не ломает. Без конфликтов/
// нагрузки/отдыха/остальных режимов (Not started, см. A44-A46).
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useCombatDutyShifts, useDutyShifts } from '../features/duties/api/queries'
import { STAGE_LABEL } from '../features/security-events/lib/stageMeta'
import { useSecurityEventsList } from '../features/security-events/api/queries'
import { usePermissions } from '../shared/auth/usePermissions'
import { ROUTES } from '../shared/routes'

type CalendarRow = {
  key: string
  sourceType: 'DUTY_SHIFT' | 'SECURITY_EVENT' | 'COMBAT_DUTY'
  employeeName: string
  what: string
  stateLabel: string
  href: string | null
}

// §24.5-24.10/§24.19-24.23 — состояние подачи + пост-акцептного incidence,
// сплющено в одну строку для календаря (та же честность, что DUTY_STATE_LABEL
// ниже: НЕ объединение по сотруднику — А44, каждая запись от СВОЕГО источника).
const COMBAT_SUBMISSION_STATE_LABEL: Record<string, string> = {
  SUBMITTED: 'Подано',
  RETURNED: 'Возвращено на доработку',
  ACCEPTED: 'Принято',
}
const COMBAT_EXECUTION_STATE_LABEL: Record<string, string> = {
  PENDING_ACKNOWLEDGEMENT: 'Ожидает ознакомления',
  READY: 'Готовы к заступлению',
  ACTIVE: 'На посту',
  COMPLETED: 'Завершено',
}

function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + deltaDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

const DUTY_STATE_LABEL: Record<string, string> = {
  PLANNED: 'Запланировано',
  ACKNOWLEDGED: 'Ознакомлен',
  ACTIVE: 'На посту',
  COMPLETED: 'Завершено',
}

export function CalendarPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { hasPermission } = usePermissions()

  // `ops.calendar.view` (route gate) НЕ подменяет права владельцев источников
  // — `ops.duty.view`/`ops.security_event.view` по-прежнему проверяются в
  // соответствующих mock-repository (403 при отсутствии). Без `enabled`-гейта
  // здесь persona без одного из двух прав получила бы бесконечный retry на
  // 403 и вечную «Загрузка…» — найдено вручную в браузере (persona
  // «Ведение объектов»: есть ops.duty.view, нет ops.security_event.view).
  const canSeeDuties = hasPermission('ops.duty.view')
  const canSeeEvents = hasPermission('ops.security_event.view')
  const shiftsQuery = useDutyShifts({ enabled: canSeeDuties })
  const combatShiftsQuery = useCombatDutyShifts({ enabled: canSeeDuties })
  const eventsQuery = useSecurityEventsList(
    { search: '', stage: 'ALL', page: 1, pageSize: 100 },
    { enabled: canSeeEvents },
  )

  const isLoading =
    (canSeeDuties && (shiftsQuery.isLoading || combatShiftsQuery.isLoading)) ||
    (canSeeEvents && eventsQuery.isLoading)
  const isError =
    (canSeeDuties && (shiftsQuery.isError || combatShiftsQuery.isError)) ||
    (canSeeEvents && eventsQuery.isError)

  // §25.19: фильтры (здесь — выбранный день) хранятся в URL. Дефолт берётся
  // из уже загруженных данных (businessDate дежурств), а не из `new Date()`
  // — репозитории demo-runtime сами живут по DemoClock (§8.8), и локальные
  // wall-clock часы могли бы разойтись с датой сидированных данных.
  const defaultDate =
    shiftsQuery.data?.results[0]?.businessDate ??
    eventsQuery.data?.results[0]?.businessDate ??
    combatShiftsQuery.data?.results[0]?.businessDate ??
    ''
  const selectedDate = searchParams.get('date') || defaultDate

  function goToDate(next: string) {
    const params = new URLSearchParams(searchParams)
    params.set('date', next)
    setSearchParams(params)
  }

  const rows = useMemo<CalendarRow[]>(() => {
    if (!selectedDate) return []
    const dutyRows: CalendarRow[] = (shiftsQuery.data?.results ?? [])
      .filter((s) => s.businessDate === selectedDate)
      .map((s) => ({
        key: `duty-${s.id}`,
        sourceType: 'DUTY_SHIFT',
        employeeName: s.employeeName,
        what: `Дежурство · ${s.target.safeLabel}`,
        stateLabel: DUTY_STATE_LABEL[s.stateCode] ?? s.stateCode,
        href: ROUTES.duties,
      }))
    const eventRows: CalendarRow[] = (eventsQuery.data?.results ?? [])
      .filter((e) => e.businessDate === selectedDate)
      .flatMap((e) =>
        e.placementAssignments.map((a) => ({
          key: `event-${e.id}-${a.id}`,
          sourceType: 'SECURITY_EVENT' as const,
          employeeName: a.employeeName,
          what: `ОМ ${e.code} · ${e.title}`,
          stateLabel: `${STAGE_LABEL[e.stage]}${a.acknowledgedAt ? ', ознакомлен' : ''}`,
          href: ROUTES.securityEventDetailTo(e.id),
        })),
      )
    // §24.5-24.10: боевые группы на Трассах — ТОЛЬКО поданные составы
    // (submission !== null), leader+members (без резерва, тот же принцип,
    // что acknowledgeCombatDuty). Каждая запись — от СВОЕГО источника, без
    // объединения по сотруднику (см. заголовок файла, A44).
    const combatRows: CalendarRow[] = (combatShiftsQuery.data?.results ?? [])
      .filter((s) => s.businessDate === selectedDate && s.submission !== null)
      .flatMap((s) => {
        const submission = s.submission!
        const stateLabel =
          submission.execution !== null
            ? COMBAT_EXECUTION_STATE_LABEL[submission.execution.stateCode] ?? submission.execution.stateCode
            : COMBAT_SUBMISSION_STATE_LABEL[submission.stateCode] ?? submission.stateCode
        const names = [submission.groupLeaderEmployeeName, ...submission.memberEmployeeNames]
        return names.map((employeeName) => ({
          key: `combat-${s.id}-${employeeName}`,
          sourceType: 'COMBAT_DUTY' as const,
          employeeName,
          what: `Боевая группа · ${s.routeSet.safeLabel}`,
          stateLabel,
          href: ROUTES.duties,
        }))
      })
    return [...dutyRows, ...eventRows, ...combatRows].sort((a, b) =>
      a.employeeName.localeCompare(b.employeeName),
    )
  }, [shiftsQuery.data, eventsQuery.data, combatShiftsQuery.data, selectedDate])

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
            Служба
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Календарь смен</h1>
          <span className="text-sm text-muted-foreground">
            Дежурства и расстановки ОМ на выбранный день — по видимым записям
          </span>
        </div>
        {selectedDate && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              onClick={() => goToDate(shiftDate(selectedDate, -1))}
            >
              ← Пред. день
            </button>
            <input
              type="date"
              aria-label="Выбранная дата календаря"
              className="rounded-md border px-3 py-1.5 text-sm tabular-nums"
              value={selectedDate}
              onChange={(e) => goToDate(e.target.value)}
            />
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              onClick={() => goToDate(shiftDate(selectedDate, 1))}
            >
              След. день →
            </button>
          </div>
        )}
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Загрузка календаря…</p>}
      {isError && <p className="text-sm text-destructive">Не удалось загрузить календарь.</p>}

      {!isLoading && !isError && (
        <div className="flex flex-col gap-3.5">
          {(!canSeeDuties || !canSeeEvents) && (
            <p className="text-xs text-muted-foreground">
              {!canSeeDuties && !canSeeEvents
                ? 'Нет прав на просмотр дежурств или ОМ — список пуст.'
                : !canSeeDuties
                  ? 'Дежурства скрыты — нет права ops.duty.view. Показаны только расстановки ОМ.'
                  : 'Расстановки ОМ скрыты — нет права ops.security_event.view. Показаны только дежурства.'}
            </p>
          )}
          <section className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b bg-muted/40 px-4 py-2.5 text-sm font-semibold">
              {selectedDate || 'Нет данных для отображения'} ({rows.length})
            </div>
            {rows.length === 0 ? (
              <div className="p-9 text-center text-sm text-muted-foreground">
                На этот день назначений не найдено
              </div>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th className="p-3 text-[11px] font-semibold text-muted-foreground">Сотрудник</th>
                    <th className="p-3 text-[11px] font-semibold text-muted-foreground">Назначение</th>
                    <th className="p-3 text-[11px] font-semibold text-muted-foreground">Состояние</th>
                    <th className="p-3 text-[11px] font-semibold text-muted-foreground" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t">
                      <td className="p-3 text-sm">{row.employeeName}</td>
                      <td className="p-3 text-sm">{row.what}</td>
                      <td className="p-3 text-sm text-muted-foreground">{row.stateLabel}</td>
                      <td className="p-3 text-right">
                        {row.href && (
                          <Link to={row.href} className="text-sm font-medium text-primary hover:underline">
                            Открыть источник
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-xl border bg-card p-4">
            <div className="mb-1 text-sm font-semibold">Не реализовано в этом срезе</div>
            <p className="text-xs text-muted-foreground">
              Объединение записей по сотруднику, «Мой календарь», представление по
              подразделению, статусы (отпуск/больничный/командировка), конфликты,
              отдых после дежурства и нагрузка (план/факт часов) — §25 требует
              отдельные Employee Status/Conflict/Workload repositories, которых в
              этом срезе нет. Сотрудники в дежурствах и ОМ не имеют общего
              стабильного идентификатора в demo-данных — объединение по
              совпадению ФИО дало бы ложные совпадения (см. FRONTEND_DECISIONS A44),
              поэтому каждая запись показана как есть, от своего источника.
            </p>
          </section>
        </div>
      )}
    </div>
  )
}
