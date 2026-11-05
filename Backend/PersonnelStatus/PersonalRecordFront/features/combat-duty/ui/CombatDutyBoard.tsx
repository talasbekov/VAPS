'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { moduleOpenFor } from '@/entities/portal-access';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COMBAT_PATH, type CombatBoard, type CombatChoices, type CombatShift, type CombatSummary } from '@/entities/combat-duty';
import { useCombatRead } from '@/hooks/use-combat-duty';
import type { StrengthReport } from '@/lib/api';
import { validDutyDate, shiftDutyDate, dutyWorkspaceHref } from '@/features/duty-register/model/workspace';
import { CombatGroupForm } from './CombatGroupForm';
import { CombatCatalogs } from './CombatCatalogs';
import { CombatDutyTable } from './CombatDutyTable';
import { CombatDutyMap } from './CombatDutyMap';

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
  // A choices refresh can temporarily unmount the wizard. Keep acknowledged
  // creations here, scoped to this date/division, so retry never creates twice.
  const [createdSelection, setCreatedSelection] = useState<{ context: string; groupId?: string; dutyTypeId?: string }>();
  const formContext = `${date}:${division}`;
  useEffect(() => {
    if (catalogs) document.getElementById('combat-catalogs')?.scrollIntoView({ block: 'start' });
  }, [catalogs, division]);
  const focusShift = params.get('combat_shift');
  useEffect(() => {
    if (focusShift && /^\d+$/.test(focusShift)) {
      const row = document.getElementById(`combat-shift-${focusShift}`);
      row?.scrollIntoView({ block: 'center' }); row?.focus({ preventScroll: true });
    }
  }, [focusShift, board.data?.businessDate, board.data?.shifts.length]);
  const selected = choices.data?.divisions.find(d => d.id === division);
  function divisionLabel(id: string) {
    const divisions = new Map(choices.data?.divisions.map(d => [d.id, d]));
    const names: string[] = [], seen = new Set<string>();
    let row = divisions.get(id);
    while (row && !seen.has(row.id)) { names.unshift(row.name); seen.add(row.id); row = row.parentId ? divisions.get(row.parentId) : undefined; }
    return names.join(' / ');
  }
  const canFor = (kind: 'roster' | 'review' | 'manageCatalogs', owner: string) => {
    const scope = choices.data?.permissions[`${kind}DivisionIds`];
    return Boolean(choices.data?.permissions[kind]) && (scope === null || Boolean(scope?.includes(owner)));
  };
  const navigate = (values: Record<string, string>) => router.replace(dutyWorkspaceHref('combat', new URLSearchParams(params), values), { scroll: false });
  const activeError = initial.isError && !date || board.isError || choices.isError;
  return <section className="space-y-4 rounded-xl bg-background p-4" aria-label="Расчёт боевого дежурства на день">
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Дата расчёта<Input aria-label="Дата расчёта боевого дежурства" type="date" min="0001-01-02" max="9999-12-29" value={date} onChange={e => { if (validDutyDate(e.target.value)) { navigate({ date: e.target.value }); setForming(false); setEditing(undefined); } }} /></label><Button variant="outline" disabled={!date} onClick={() => navigate({ date: shiftDutyDate(date, 1) ?? date })}>На следующий день</Button><label className="min-w-56 text-sm">Подразделение<select aria-label="Подразделение расчёта" className="block min-h-10 w-full rounded-md border border-input bg-background px-3 py-2" value={division} onChange={e => { navigate({ combat_division: e.target.value }); setForming(false); setEditing(undefined); setCatalogs(false); }}><option value="">Все доступные подразделения</option>{choices.data?.divisions.map(d => <option key={d.id} value={d.id}>{divisionLabel(d.id)}</option>)}</select></label>
      {choices.data?.permissions.roster && <Button disabled={!selected || !date || !canFor('roster', division)} onClick={() => { setEditing(undefined); setCreatedSelection(undefined); setForming(true); }}>Назначить людей</Button>}{choices.data?.permissions.manageCatalogs && <Button variant="outline" disabled={!selected || !canFor('manageCatalogs', division)} onClick={() => setCatalogs(v => !v)}>Справочники подразделения</Button>}
    </div>
    {!selected && canFor('roster', division) && choices.data?.permissions.roster && <p className="text-sm text-muted-foreground">Выберите подразделение, чтобы назначить людей.</p>}
    {activeError ? <div role="alert" className="rounded-lg border border-destructive p-4">Не удалось загрузить расчёт или подтвердить доступ. <Button variant="outline" onClick={() => { void initial.refetch(); void choices.refetch(); void board.refetch(); }}>Повторить</Button></div> : !board.data ? <p role="status">Загружаем расчёт…</p> : <>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">{[['Группы', `${board.data.summary.formedGroups} / ${board.data.summary.totalGroups}`], ['Люди в группах', board.data.summary.people], ['Техника', board.data.summary.vehicles], ['Ожидают приёма', board.data.summary.awaitingReview], ['Заступили групп', board.data.summary.activeGroups], ['В резерве групп', board.data.summary.reserveGroups]].map(([label, value]) => <div key={label} className="flex gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl>
      <CombatDutyMap shifts={board.data.shifts} onSelect={id => {
        navigate({ combat_shift: id });
        const row = document.getElementById(`combat-shift-${id}`);
        row?.scrollIntoView({ block: 'center' }); row?.focus({ preventScroll: true });
      }} />
      {board.access.hasPermission('status.view') && <section aria-label="Расход на выбранную дату" className="space-y-2 rounded-lg border bg-card p-3"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Расход · {date.split('-').reverse().join('.')}</h2>{moduleOpenFor('/employees', board.access.hasPermission) && <Link className="text-sm text-primary-ink underline underline-offset-2" href={`/employees/?view=daily&businessDate=${date}`}>Открыть ежедневный расход</Link>}</div>{expense.data ? <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[['По списку', expense.data.totals.list_total], ['В строю', expense.data.totals.columns.IN_SERVICE ?? 0], ['На дежурстве', expense.data.totals.columns.ON_DUTY ?? 0], ['После дежурства', expense.data.totals.columns.AFTER_DUTY ?? 0]].map(([label, count]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold tabular-nums">{count}</dd></div>)}</dl> : expense.isError ? <p role="alert" className="text-sm">Расход недоступен для выбранного подразделения или не удалось его обновить. <button className="underline" onClick={() => void expense.refetch()}>Повторить</button></p> : <p role="status" className="text-sm">Обновляем расход…</p>}<p className="text-xs text-muted-foreground">После отправки состав учитывается в расходе; возврат или отмена снимает назначение.</p></section>}
      {board.data.shifts.length === 0 ? <div className="space-y-3 rounded-lg border border-dashed bg-card p-8 text-center"><p className="text-muted-foreground">Групп на эту дату нет.</p>{selected && canFor('roster', division) && choices.data?.permissions.roster && <Button onClick={() => { setEditing(undefined); setForming(true); }}>Назначить людей</Button>}</div> : <CombatDutyTable shifts={board.data.shifts} canFor={canFor} onResubmit={shift => { navigate({ combat_division: shift.divisionId }); setEditing(shift); setForming(true); }} />}
      <details className="rounded-lg border bg-card p-3"><summary className="cursor-pointer text-sm font-medium">Обзор на неделю</summary><nav aria-label="Расчёт на неделю" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-7">{week.data?.results.map(day => <button key={day.businessDate} className={`rounded-lg border p-3 text-left text-sm ${day.businessDate === date ? 'border-primary bg-primary/5' : 'bg-card'}`} onClick={() => navigate({ date: day.businessDate })}><span className="block font-medium">{day.businessDate.split('-').reverse().slice(0, 2).join('.')}</span><span className="text-xs text-muted-foreground">{day.formedGroups} групп · {day.people} чел.</span></button>)}</nav>{week.isError && <p role="alert" className="mt-2 text-sm">Недельный обзор недоступен. <button className="underline" onClick={() => void week.refetch()}>Повторить</button></p>}</details>
    </>}
    {catalogs && selected && canFor('manageCatalogs', division) && choices.data?.permissions.manageCatalogs && <div id="combat-catalogs" className="scroll-mt-36"><CombatCatalogs key={division} choices={choices.data} divisionId={division} /></div>}
    {forming && selected && canFor('roster', division) && choices.data?.permissions.roster && <CombatGroupForm key={`${date}:${division}:${editing?.id ?? 'new'}`} date={date} divisionId={division} choices={choices.data} existing={editing} createdSelection={!editing && createdSelection?.context === formContext ? createdSelection : undefined} onCatalogCreated={(key, id) => setCreatedSelection(previous => ({ ...(previous?.context === formContext ? previous : {}), context: formContext, [key]: id }))} onClose={() => { setForming(false); setEditing(undefined); setCreatedSelection(undefined); }} onConfigure={canFor('manageCatalogs', division) ? () => { setForming(false); setEditing(undefined); setCatalogs(true); } : undefined} />}
  </section>;
}
