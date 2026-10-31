'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COMBAT_PATH, combatState, type CombatBoard, type CombatChoices, type CombatShift, type CombatSummary } from '@/entities/combat-duty';
import { useCombatRead } from '@/hooks/use-combat-duty';
import type { StrengthReport } from '@/lib/api';
import { validDutyDate, shiftDutyDate, dutyWorkspaceHref } from '@/features/duty-register/model/workspace';
import { CombatGroupForm } from './CombatGroupForm';
import { CombatCatalogs } from './CombatCatalogs';
import { CombatShiftActions } from './CombatShiftActions';

export function CombatDutyBoard() {
  const params = useSearchParams(); const router = useRouter();
  const initial = useCombatRead<CombatBoard>(COMBAT_PATH, !validDutyDate(params.get('date') ?? ''));
  const date = validDutyDate(params.get('date') ?? '') ? params.get('date')! : initial.data?.businessDate ?? '';
  const division = params.get('combat_division') ?? '';
  const query = new URLSearchParams({ ...(date ? { date } : {}), ...(division ? { division_id: division } : {}) });
  const choices = useCombatRead<CombatChoices>(COMBAT_PATH + 'choices/?' + query, Boolean(date));
  const board = useCombatRead<CombatBoard>(COMBAT_PATH + '?' + query, Boolean(date));
  const expense = useCombatRead<StrengthReport>('/api/operations/strength-report/?' + new URLSearchParams({ business_date: date, ...(division ? { division_id: division } : {}) }), Boolean(date) && board.access.hasPermission('status.view'));
  const week = useCombatRead<{ results: (CombatSummary & { businessDate: string })[] }>(COMBAT_PATH + 'week/?' + new URLSearchParams({ ...(date ? { from: date, to: shiftDutyDate(date, 6) ?? date } : {}), ...(division ? { division_id: division } : {}) }), Boolean(date));
  const [forming, setForming] = useState(false); const [editing, setEditing] = useState<CombatShift>(); const [catalogs, setCatalogs] = useState(false);
  const focusShift = params.get('combat_shift');
  useEffect(() => {
    if (focusShift && /^\d+$/.test(focusShift)) document.getElementById(`combat-shift-${focusShift}`)?.scrollIntoView({ block: 'center' });
  }, [focusShift, board.data?.businessDate, board.data?.shifts.length]);
  const selected = choices.data?.divisions.find(d => d.id === division);
  const canFor = (kind: 'roster' | 'review', owner: string) => {
    const scope = choices.data?.permissions[`${kind}DivisionIds`];
    return scope === null || Boolean(scope?.includes(owner));
  };
  const navigate = (values: Record<string, string>) => router.replace(dutyWorkspaceHref('combat', new URLSearchParams(params), values), { scroll: false });
  const activeError = initial.isError && !date || board.isError || choices.isError;
  return <section className="space-y-5" aria-label="Расчёт боевого дежурства на день">
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Дата расчёта<Input aria-label="Дата расчёта боевого дежурства" type="date" min="0001-01-02" max="9999-12-29" value={date} onChange={e => { if (validDutyDate(e.target.value)) { navigate({ date: e.target.value }); setForming(false); setEditing(undefined); } }} /></label><Button variant="outline" disabled={!date} onClick={() => navigate({ date: shiftDutyDate(date, 1) ?? date })}>На следующий день</Button><label className="min-w-56 text-sm">Подразделение<select aria-label="Подразделение расчёта" className="block min-h-10 w-full rounded-md border border-input bg-background px-3 py-2" value={division} onChange={e => { navigate({ combat_division: e.target.value }); setForming(false); setEditing(undefined); setCatalogs(false); }}><option value="">Все доступные подразделения</option>{choices.data?.divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      {choices.data?.permissions.roster && <Button disabled={!selected || !date} onClick={() => { setEditing(undefined); setForming(true); }}>Сформировать группу</Button>}{choices.data?.permissions.manageCatalogs && <Button variant="outline" disabled={!selected} onClick={() => setCatalogs(v => !v)}>Справочники подразделения</Button>}
    </div>
    <p className="text-sm text-muted-foreground">Расчёт на обычный день боевого дежурства. Для формирования и справочников выберите подразделение. Привязка группы к охранному мероприятию необязательна.</p>
    {activeError ? <div role="alert" className="rounded-lg border border-destructive p-4">Не удалось загрузить расчёт или подтвердить доступ. <Button variant="outline" onClick={() => { void initial.refetch(); void choices.refetch(); void board.refetch(); }}>Повторить</Button></div> : !board.data ? <p role="status">Загружаем расчёт…</p> : <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{[['Групп сформировано', `${board.data.summary.formedGroups} / ${board.data.summary.totalGroups}`], ['Личный состав', board.data.summary.people], ['Техника', board.data.summary.vehicles], ['Ожидают штаб', board.data.summary.awaitingReview], ['На дежурстве', board.data.summary.activeGroups], ['Групп в резерве', board.data.summary.reserveGroups]].map(([label, value]) => <div key={label} className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div>)}</div>
      {board.access.hasPermission('status.view') && <section aria-label="Расход на выбранную дату" className="space-y-3 rounded-lg border bg-card p-4"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Расход на {date}</h2><Link className="text-sm text-primary-ink underline underline-offset-2" href={`/employees/?view=daily&businessDate=${date}`}>Открыть ежедневный расход</Link></div>{expense.data ? <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[['По списку', expense.data.totals.list_total], ['В строю', expense.data.totals.columns.IN_SERVICE ?? 0], ['На дежурстве', expense.data.totals.columns.ON_DUTY ?? 0], ['После дежурства', expense.data.totals.columns.AFTER_DUTY ?? 0]].map(([label, count]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{count}</dd></div>)}</dl> : expense.isError ? <p role="alert" className="text-sm">Расход недоступен для выбранного подразделения или не удалось его обновить. <button className="underline" onClick={() => void expense.refetch()}>Повторить</button></p> : <p role="status" className="text-sm">Обновляем расход…</p>}<p className="text-xs text-muted-foreground">Единый учёт на выбранную дату. Состав группы учитывается после подачи; возврат и отмена снимают её назначение.</p></section>}
      <nav aria-label="Расчёт на неделю" className="grid grid-cols-2 gap-2 sm:grid-cols-7">{week.data?.results.map(day => <button key={day.businessDate} className={`rounded-lg border p-3 text-left text-sm ${day.businessDate === date ? 'border-primary bg-primary/5' : 'bg-card'}`} onClick={() => navigate({ date: day.businessDate })}><span className="block font-medium">{day.businessDate.slice(5)}</span><span className="text-xs text-muted-foreground">{day.formedGroups} групп · {day.people} чел.</span></button>)}</nav>
      {week.isError && <p role="alert" className="text-sm">Недельный обзор недоступен. <button className="underline" onClick={() => void week.refetch()}>Повторить</button></p>}
      <div className="space-y-3">{board.data.shifts.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">На выбранную дату группы ещё не сформированы.</div>}{board.data.shifts.map(shift => <article key={shift.id} id={`combat-shift-${shift.id}`} className="rounded-lg border bg-card p-4" data-testid="combat-group-card"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{shift.groupName} <span className="text-sm font-normal text-muted-foreground">· {shift.divisionName}</span></h2><span className="rounded-full bg-muted px-3 py-1 text-xs font-medium">{combatState(shift)}</span></div><p className="mt-2 text-sm">{shift.dutyTypeName} · {shift.isReserve ? 'Резерв' : shift.location.label}{shift.callsign ? ` · ${shift.callsign}` : ''}</p>{shift.event && <p className="mt-1 text-sm text-primary-ink">ОМ · {shift.event.title}</p>}<ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">{shift.members.map(m => <li key={m.employeeId}>{m.employeeName}{m.isLeader ? ' · старший' : ''}{m.isDriver ? ' · водитель' : ''}{m.isReserve ? ' · резерв' : ''}{m.acknowledged ? ' · ознакомлен' : ''}</li>)}</ul><p className="mt-2 text-xs text-muted-foreground">Состав: {shift.members.length} / {shift.maxMembers} · Техника: {shift.equipment.map(v => `${v.label} × ${v.quantity}`).join(', ') || 'не назначена'}{shift.restDayAfter ? ' · На следующий день — отдых' : ''}</p>{shift.returnReason && <p className="mt-2 text-sm text-destructive">Причина возврата: {shift.returnReason}</p>}{shift.cancellationReason && <p className="mt-2 text-sm">Причина отмены: {shift.cancellationReason}</p>}
        {Boolean(shift.warnings?.length) && <div role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-medium">Состав требует проверки</p>{shift.warnings?.map(w => <p key={w.employeeId}>{w.employeeName} · {w.reason}</p>)}</div>}
        <CombatShiftActions shift={shift} canRoster={canFor('roster', shift.divisionId)} canReview={canFor('review', shift.divisionId)} onResubmit={() => { navigate({ combat_division: shift.divisionId }); setEditing(shift); setForming(true); }} />
      </article>)}</div>
    </>}
    {catalogs && selected && choices.data?.permissions.manageCatalogs && <CombatCatalogs key={division} choices={choices.data} divisionId={division} />}
    {forming && selected && choices.data?.permissions.roster && <CombatGroupForm key={`${date}:${division}:${editing?.id ?? 'new'}`} date={date} divisionId={division} choices={choices.data} existing={editing} onClose={() => { setForming(false); setEditing(undefined); }} />}
  </section>;
}
