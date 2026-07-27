// План дежурств (§21.4/§24 мастер-промпта). §21.4: «По объектам»/«По
// сотрудникам» — представления ОДНОГО набора данных (useDutyShifts), НЕ
// отдельные источники истины — переключатель вида группирует один и тот же
// список, второй запрос не делается. Третья вкладка «Боевые группы и Трассы»
// (§24.15) — ОТДЕЛЬНЫЙ набор данных (CombatDutyShift, не DutyShift, см.
// model/types.ts) — своя подача/рассмотрение, не переключатель вида.
// Вкладка «Месяц» (§21.27-21.30) — тот же DutyShift, но СЕРВЕРНАЯ проекция:
// сетка/KPI/конфликты приходят готовыми из `useMonthlyDutyPlan`, страница их
// не пересчитывает (§21.29/§21.34, см. MonthlyDutyPlanSection). История/
// revisions и lifecycle плана — Not started (см. FRONTEND_DECISIONS A63).
import { useMemo, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import {
  useAcknowledgeDutyShift,
  useClockInDutyShift,
  useClockOutDutyShift,
  useDutyShifts,
  useDutyTypes,
} from '../api/queries'
import {
  NO_BINDABLE_POST_TEXT,
  NO_PUBLISHED_VERSION_TEXT,
  NO_REGISTRY_OBJECT_TEXT,
  stalePostBindingText,
} from '../lib/passportBinding'
import type { DutyPassportStatus } from '../api/pending-contracts'
import type { DutyShift, DutyShiftState } from '../model/types'
import { CombatDutyGroupsSection } from './CombatDutyGroupsSection'
import { MonthlyDutyPlanSection } from './MonthlyDutyPlanSection'

type ViewMode = 'BY_OBJECT' | 'BY_EMPLOYEE' | 'MONTH' | 'COMBAT_GROUPS'

const STATE_LABEL: Record<DutyShiftState, string> = {
  PLANNED: 'Запланировано',
  ACKNOWLEDGED: 'Ознакомлен',
  ACTIVE: 'На посту',
  COMPLETED: 'Завершено',
}

const STATE_CLASS: Record<DutyShiftState, string> = {
  PLANNED: 'inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-slate-600',
  ACKNOWLEDGED: 'inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800',
  ACTIVE: 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800',
  COMPLETED: 'inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-slate-600',
}

export function DutyPlanPage() {
  const [view, setView] = useState<ViewMode>('BY_OBJECT')
  const dutyTypesQuery = useDutyTypes()
  const shiftsQuery = useDutyShifts()

  const dutyTypeLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of dutyTypesQuery.data?.results ?? []) map.set(t.dutyTypeCode, t.safeLabel)
    return map
  }, [dutyTypesQuery.data])

  // §9.6: производный статус привязки приходит отдельным блоком ответа —
  // раскладываем по shiftId, чтобы строка таблицы не искала его линейно.
  const passportStatus = useMemo(() => {
    const map = new Map<string, DutyPassportStatus>()
    for (const status of shiftsQuery.data?.passportStatuses ?? []) map.set(status.shiftId, status)
    return map
  }, [shiftsQuery.data])

  const groups = useMemo(() => {
    const shifts = shiftsQuery.data?.results ?? []
    const keyOf = (s: DutyShift) => (view === 'BY_OBJECT' ? s.target.safeLabel : s.employeeName)
    const map = new Map<string, DutyShift[]>()
    for (const shift of shifts) {
      const key = keyOf(shift)
      const bucket = map.get(key) ?? []
      bucket.push(shift)
      map.set(key, bucket)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [shiftsQuery.data, view])

  const isLoading = dutyTypesQuery.isLoading || shiftsQuery.isLoading
  const isError = dutyTypesQuery.isError || shiftsQuery.isError
  const isTableView = view === 'BY_OBJECT' || view === 'BY_EMPLOYEE'

  // §21.28: месяц по умолчанию берётся из УЖЕ ЗАГРУЖЕННЫХ данных, а не из
  // `new Date()` — demo-runtime живёт по DemoClock (§8.8), и wall-clock часы
  // машины показали бы пустой месяц (тот же приём, что дефолтный день
  // CalendarPage). `results` отсортирован по дате, поэтому это месяц самой
  // ранней смены.
  const defaultMonth = shiftsQuery.data?.results[0]?.businessDate.slice(0, 7) ?? null

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
            Служба
          </p>
          <h1 className="text-2xl font-bold tracking-tight">План дежурств</h1>
          <span className="text-sm text-muted-foreground">
            Суточные дежурства на собственных и охраняемых объектах
          </span>
        </div>
        <div className="flex gap-2 rounded-md border bg-muted/40 p-1">
          <Button
            size="sm"
            variant={view === 'BY_OBJECT' ? 'default' : 'ghost'}
            onClick={() => setView('BY_OBJECT')}
          >
            По объектам
          </Button>
          <Button
            size="sm"
            variant={view === 'BY_EMPLOYEE' ? 'default' : 'ghost'}
            onClick={() => setView('BY_EMPLOYEE')}
          >
            По сотрудникам
          </Button>
          <Button
            size="sm"
            variant={view === 'MONTH' ? 'default' : 'ghost'}
            onClick={() => setView('MONTH')}
          >
            Месяц
          </Button>
          <Button
            size="sm"
            variant={view === 'COMBAT_GROUPS' ? 'default' : 'ghost'}
            onClick={() => setView('COMBAT_GROUPS')}
          >
            Боевые группы и Трассы
          </Button>
        </div>
      </header>

      {view === 'COMBAT_GROUPS' && <CombatDutyGroupsSection />}

      {view === 'MONTH' &&
        (defaultMonth === null ? (
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Загрузка плана дежурств…' : 'Дежурств не найдено — месяц не выбран.'}
          </p>
        ) : (
          <MonthlyDutyPlanSection key={defaultMonth} initialMonth={defaultMonth} />
        ))}

      {isTableView && isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка плана дежурств…</p>
      )}
      {isTableView && isError && (
        <p className="text-sm text-destructive">Не удалось загрузить план дежурств.</p>
      )}

      {isTableView && !isLoading && !isError && (
        <div className="flex flex-col gap-3.5">
          {groups.length === 0 && (
            <section className="rounded-xl border bg-card p-9 text-center text-sm text-muted-foreground">
              Дежурств не найдено
            </section>
          )}
          {groups.map(([groupKey, shifts]) => (
            <section key={groupKey} className="overflow-hidden rounded-xl border bg-card">
              <div className="border-b bg-muted/40 px-4 py-2.5 text-sm font-semibold">
                {groupKey}
              </div>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th className="p-3 text-[11px] font-semibold text-muted-foreground">Дата</th>
                    <th className="p-3 text-[11px] font-semibold text-muted-foreground">Вид дежурства</th>
                    {view === 'BY_OBJECT' && (
                      <th className="p-3 text-[11px] font-semibold text-muted-foreground">Сотрудник</th>
                    )}
                    {view === 'BY_EMPLOYEE' && (
                      <th className="p-3 text-[11px] font-semibold text-muted-foreground">Объект</th>
                    )}
                    <th className="p-3 text-[11px] font-semibold text-muted-foreground">
                      Пост по паспорту
                    </th>
                    <th className="p-3 text-[11px] font-semibold text-muted-foreground">Статус</th>
                    <th className="p-3 text-[11px] font-semibold text-muted-foreground">
                      <span className="sr-only">Действия</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((shift) => (
                    <ShiftRow
                      key={shift.id}
                      shift={shift}
                      view={view}
                      dutyTypeLabel={dutyTypeLabel.get(shift.dutyTypeCode) ?? shift.dutyTypeCode}
                      passportStatus={passportStatus.get(shift.id) ?? null}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function ShiftRow({
  shift,
  view,
  dutyTypeLabel,
  passportStatus,
}: {
  shift: DutyShift
  view: ViewMode
  dutyTypeLabel: string
  passportStatus: DutyPassportStatus | null
}) {
  const acknowledgeMutation = useAcknowledgeDutyShift()
  const clockInMutation = useClockInDutyShift()
  const clockOutMutation = useClockOutDutyShift()
  const pending =
    acknowledgeMutation.isPending || clockInMutation.isPending || clockOutMutation.isPending

  return (
    <tr className="border-t">
      <td className="p-3 text-sm tabular-nums">{shift.businessDate}</td>
      <td className="p-3 text-sm">{dutyTypeLabel}</td>
      {view === 'BY_OBJECT' && <td className="p-3 text-sm">{shift.employeeName}</td>}
      {view === 'BY_EMPLOYEE' && <td className="p-3 text-sm">{shift.target.safeLabel}</td>}
      <td className="p-3">
        <PassportBindingCell shift={shift} status={passportStatus} />
      </td>
      <td className="p-3">
        <span className={STATE_CLASS[shift.stateCode]}>{STATE_LABEL[shift.stateCode]}</span>
      </td>
      <td className="p-3 text-right">
        {shift.stateCode === 'PLANNED' && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => acknowledgeMutation.mutate({ id: shift.id })}
          >
            Ознакомиться
          </Button>
        )}
        {shift.stateCode === 'ACKNOWLEDGED' && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => clockInMutation.mutate({ id: shift.id })}
          >
            Заступить
          </Button>
        )}
        {shift.stateCode === 'ACTIVE' && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => clockOutMutation.mutate({ id: shift.id })}
          >
            Завершить
          </Button>
        )}
      </td>
    </tr>
  )
}

/**
 * §9.6 в одной ячейке: либо «сектор · пост (ред. N)», либо ЯВНАЯ причина,
 * почему привязки нет. Молчаливого прочерка тут быть не должно — отсутствие
 * привязки к паспорту это факт планирования, а не пустое поле.
 *
 * `status === null` — статус не пришёл (старый кэш ответа): показываем
 * снимок без вывода об актуальности, а не выдумываем «актуально».
 */
function PassportBindingCell({
  shift,
  status,
}: {
  shift: DutyShift
  status: DutyPassportStatus | null
}) {
  const binding = shift.passportBinding
  if (binding === null) {
    const reason =
      status === null || !status.objectKnown
        ? NO_REGISTRY_OBJECT_TEXT
        : status.applicableVersionNumber === null
          ? NO_PUBLISHED_VERSION_TEXT
          : NO_BINDABLE_POST_TEXT
    return <span className="text-xs text-muted-foreground">{reason}</span>
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm">
        {binding.sectorName} · {binding.postName}
      </span>
      <span className="text-[11px] text-muted-foreground tabular-nums">
        Паспорт: ред. {binding.versionNumber} от {binding.effectiveFrom}
      </span>
      {status?.stale === true && status.applicableVersionNumber !== null && (
        <span className="text-[11px] font-semibold text-amber-700">
          {stalePostBindingText(binding.versionNumber, status.applicableVersionNumber)}
        </span>
      )}
    </div>
  )
}
