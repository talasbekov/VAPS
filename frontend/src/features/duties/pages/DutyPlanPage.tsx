// План дежурств (§21.4/§24 мастер-промпта). §21.4: «По объектам»/«По
// сотрудникам» — представления ОДНОГО набора данных (useDutyShifts), НЕ
// отдельные источники истины — переключатель вида группирует один и тот же
// список, второй запрос не делается. Третья вкладка «Боевые группы и Трассы»
// (§24.15) — ОТДЕЛЬНЫЙ набор данных (CombatDutyShift, не DutyShift, см.
// model/types.ts) — своя подача/рассмотрение, не переключатель вида. История/
// revisions, месячное планирование — Not started (см. FRONTEND_DECISIONS).
import { useMemo, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import {
  useAcknowledgeDutyShift,
  useClockInDutyShift,
  useClockOutDutyShift,
  useDutyShifts,
  useDutyTypes,
} from '../api/queries'
import type { DutyShift, DutyShiftState } from '../model/types'
import { CombatDutyGroupsSection } from './CombatDutyGroupsSection'

type ViewMode = 'BY_OBJECT' | 'BY_EMPLOYEE' | 'COMBAT_GROUPS'

const STATE_LABEL: Record<DutyShiftState, string> = {
  PLANNED: 'Запланировано',
  ACKNOWLEDGED: 'Ознакомлен',
  ACTIVE: 'На посту',
  COMPLETED: 'Завершено',
}

const STATE_CLASS: Record<DutyShiftState, string> = {
  PLANNED: 'inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground',
  ACKNOWLEDGED: 'inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800',
  ACTIVE: 'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-800',
  COMPLETED: 'inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground',
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
            variant={view === 'COMBAT_GROUPS' ? 'default' : 'ghost'}
            onClick={() => setView('COMBAT_GROUPS')}
          >
            Боевые группы и Трассы
          </Button>
        </div>
      </header>

      {view === 'COMBAT_GROUPS' && <CombatDutyGroupsSection />}

      {view !== 'COMBAT_GROUPS' && isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка плана дежурств…</p>
      )}
      {view !== 'COMBAT_GROUPS' && isError && (
        <p className="text-sm text-destructive">Не удалось загрузить план дежурств.</p>
      )}

      {view !== 'COMBAT_GROUPS' && !isLoading && !isError && (
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
                    <th className="p-3 text-[11px] font-semibold text-muted-foreground">Статус</th>
                    <th className="p-3 text-[11px] font-semibold text-muted-foreground" />
                  </tr>
                </thead>
                <tbody>
                  {shifts.map((shift) => (
                    <ShiftRow
                      key={shift.id}
                      shift={shift}
                      view={view}
                      dutyTypeLabel={dutyTypeLabel.get(shift.dutyTypeCode) ?? shift.dutyTypeCode}
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
}: {
  shift: DutyShift
  view: ViewMode
  dutyTypeLabel: string
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
