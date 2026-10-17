'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LoadFailure } from '@/components/load-failure';
import { useDutyRegisterAccess, useDutyRoster } from '@/hooks/use-duty-register';
import { dutyDateTime } from '@/entities/duty-register';
import { statusPeriod } from '@/features/daily-expense/ui/StatusDetails';
import { formatIsoDate } from '@/shared/lib/date';
import { moduleOpenFor } from '@/entities/portal-access';
import { dutyWorkspaceHref, validDutyDate, dutyRosterFilters, dutyRosterFilterValues, shiftDutyDate, serverDutyDate, type DutyRosterFilters } from '../model/workspace';
import type { CombatRosterGroup } from '../model/roster';

const field = 'min-w-0 max-w-full rounded-md border bg-background px-3 py-2 text-sm';
const PAGE_SIZE = 25;
const normalize = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е');
function NameList({ names }: { names: string[] }) {
  return names.length ? <ul className="space-y-1">{names.map((name, i) => <li key={i}>{name}</li>)}</ul> : <span>—</span>;
}
function CombatGroup({ group, zone }: { group: CombatRosterGroup; zone: string }) {
  return <details className="min-w-0 rounded-lg border p-4">
    <summary className="cursor-pointer break-words font-medium"><span>{group.group_name || 'Боевая группа'}</span> <span className="text-sm font-normal text-muted-foreground">· {group.stage_label}</span></summary>
    <div className="mt-3 space-y-3 break-words text-sm">
      <p>{[group.department_name, group.division_name, group.route_label].filter(Boolean).join(' · ') || 'Маршрут не указан'}</p>
      <dl className="grid gap-3 sm:grid-cols-3"><div><dt className="text-muted-foreground">Старший</dt><dd>{group.leader_name || '—'}</dd></div><div><dt className="text-muted-foreground">Основной состав</dt><dd><NameList names={group.member_names} /></dd></div><div><dt className="text-muted-foreground">Резерв</dt><dd><NameList names={group.reserve_names} /></dd></div></dl>
      {(group.actual_start || group.actual_end) && <p className="text-muted-foreground">{group.actual_start && <>Начало: {dutyDateTime(group.actual_start, zone)}</>}{group.actual_end && <> · Завершение: {dutyDateTime(group.actual_end, zone)}</>}</p>}
      {group.actual_member_names !== null && <div><p className="text-muted-foreground">Фактический состав</p><NameList names={group.actual_member_names} /></div>}
    </div>
  </details>;
}

export function DutyRoster() {
  const access = useDutyRegisterAccess();
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get('date');
  const validDate = selected === null || validDutyDate(selected);
  const query = useDutyRoster(selected ?? '', access.allowed && validDate, access.scope);
  const data = query.visibleData;
  const day = selected ?? data?.business_date ?? '';
  const [filters, setFilters] = useState(() => dutyRosterFilters(new URLSearchParams(params)));
  const filtersRef = useRef(filters);
  const { search, division, placement, page } = filters;
  const results = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Next also updates search params for native history changes. Ignore an
    // older transition so rapid typing cannot restore the previous letter.
    if (params.toString() !== new URLSearchParams(window.location.search).toString()) return;
    const next = dutyRosterFilters(new URLSearchParams(params));
    filtersRef.current = next; setFilters(next);
  }, [params]);
  function updateFilters(change: Partial<DutyRosterFilters>) {
    const next = { ...filtersRef.current, page: 1, ...change };
    filtersRef.current = next; setFilters(next);
    window.history.replaceState(null, '', dutyWorkspaceHref('roster', new URLSearchParams(window.location.search), dutyRosterFilterValues(next)));
  }
  function changeDate(date: string) {
    const next = { ...filtersRef.current, page: 1 };
    filtersRef.current = next; setFilters(next);
    window.history.replaceState(null, '', dutyWorkspaceHref('roster', new URLSearchParams(window.location.search), { date, ...dutyRosterFilterValues(next) }));
  }
  // Resolve today on the server once, then keep it stable across shared links.
  useEffect(() => {
    if (selected === null && data && validDutyDate(data.business_date)) {
      router.replace(dutyWorkspaceHref('roster', new URLSearchParams(params), { date: data.business_date }), { scroll: false });
    }
  }, [selected, data, params, router]);
  const departments = data?.departments ?? [];
  const people = departments.flatMap(department => department.employees.map(person => ({ ...person, department_id: String(department.id), department_name: department.name })));
  const groups = data?.combat_groups ?? [];
  const options = new Map(departments.map(department => [String(department.id), department.name]));
  for (const group of groups) if (group.department_id !== null) options.set(String(group.department_id), group.department_name || group.division_name);
  const needle = normalize(search.trim());
  const shown = people.filter(person => (!division || person.department_id === division)
    && (placement === 'all' || (placement === 'assigned' ? person.placements.length > 0 : person.placements.length === 0))
    && normalize([person.full_name, person.position_name, person.department_name, person.status_label, person.destination, ...person.placements.map(item => item.label)].join(' ')).includes(needle));
  const shownGroups = placement === 'unassigned' ? [] : groups.filter(group => (!division || String(group.department_id) === division)
    && normalize([group.group_name, group.route_label, group.division_name, group.department_name, group.leader_name, ...group.member_names, ...group.reserve_names, ...(group.actual_member_names ?? [])].join(' ')).includes(needle));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const assigned = people.filter(person => person.placements.length > 0).length;
  const filtered = Boolean(needle || division || placement !== 'all');
  const previousDay = shiftDutyDate(day, -1);
  const nextDay = shiftDutyDate(day, 1);
  const today = data ? serverDutyDate(data.generated_at, data.time_zone) : null;
  function changePage(next: number) {
    updateFilters({ page: next });
    requestAnimationFrame(() => { results.current?.focus({ preventScroll: true }); results.current?.scrollIntoView({ block: 'start' }); });
  }
  return <section className="min-w-0 space-y-4" aria-label="Состав на дату">
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid min-w-0 gap-1 text-sm">Дата состава<input type="date" min="0001-01-01" max="9999-12-31" className={field} value={validDutyDate(day) ? day : ''} onChange={event => changeDate(event.target.value)} /></label>
      <div className="flex gap-1" role="group" aria-label="Переход по датам"><Button variant="outline" aria-label="Предыдущий день" disabled={!previousDay} onClick={() => previousDay && changeDate(previousDay)}>←</Button><Button variant="outline" disabled={Boolean(today && today === day)} onClick={() => changeDate(today ?? '')}>Сегодня</Button><Button variant="outline" aria-label="Следующий день" disabled={!nextDay} onClick={() => nextDay && changeDate(nextDay)}>→</Button></div>
      <Button variant="outline" disabled={!validDate || query.isFetching} onClick={() => void query.refetch()}>Обновить состав</Button>
      {access.hasPermission('status.manage') && moduleOpenFor('/statuses', access.hasPermission) && validDutyDate(day) && <Button asChild><Link href={'/statuses/?' + new URLSearchParams({ businessDate: day })}>Изменить статусы</Link></Button>}
    </div>
    <p className="text-sm text-muted-foreground">Назначайте пост или группу при изменении статуса сотрудника. Сохранённый наряд появляется здесь автоматически. Почасовые смены оформляются отдельно, когда нужно указать время.</p>
    {!validDate && <p role="alert" className="text-sm text-destructive">Укажите существующую дату в формате ГГГГ-ММ-ДД.</p>}
    {(query.isLoading || (query.isFetching && !data)) && validDate && <p role="status">Загрузка состава дежурств…</p>}
    {query.isError && <LoadFailure what="состав дежурств" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />}
    {query.isError && data && <p role="status" className="rounded-lg border border-amber-300 p-3 text-sm">Показан ранее загруженный состав. Обновите его, прежде чем принимать решение.</p>}
    {data && <>
      <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Сводка состава">{([
        { value: 'all', label: 'Сотрудников на дежурстве', count: people.length, action: 'Показать весь состав' },
        { value: 'assigned', label: 'Место указано', count: assigned, action: 'Показать с указанным местом' },
        { value: 'unassigned', label: 'Без поста или группы', count: people.length - assigned, action: 'Показать без поста или группы' },
      ] as const).map(item => <button key={item.value} type="button" aria-label={item.action} aria-pressed={!search && !division && placement === item.value} className="rounded-lg border p-4 text-left hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary aria-pressed:border-primary" onClick={() => updateFilters({ search: '', division: '', placement: item.value })}><span className="block text-sm text-muted-foreground">{item.label}</span><span className="mt-1 block text-2xl font-semibold">{item.count}</span></button>)}</div>
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="grid min-w-0 flex-1 basis-60 gap-1 text-sm">Поиск в составе<input className={field} maxLength={200} placeholder="ФИО, подразделение, объект или пост" value={search} onChange={event => updateFilters({ search: event.target.value })} /></label>
        <label className="grid min-w-0 max-w-full gap-1 text-sm">Подразделение<select className={field} value={division} onChange={event => updateFilters({ division: event.target.value })}><option value="">Все подразделения</option>{division && !options.has(division) && <option value={division}>Выбранное подразделение</option>}{[...options].sort((a, b) => a[1].localeCompare(b[1], 'ru')).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="grid min-w-0 gap-1 text-sm">Размещение наряда<select className={field} value={placement} onChange={event => updateFilters({ placement: event.target.value as DutyRosterFilters['placement'] })}><option value="all">Все сотрудники</option><option value="assigned">Место указано</option><option value="unassigned">Без поста или группы</option></select></label>
        {filtered && <Button variant="ghost" onClick={() => updateFilters({ search: '', division: '', placement: 'all' })}>Сбросить фильтры</Button>}
      </div>
      <div ref={results} tabIndex={-1} role="region" aria-label="Состав наряда" className="min-w-0 scroll-mt-24 space-y-3 outline-none">
        {shown.length ? <>
          <p className="text-sm text-muted-foreground" role="status">Показано {offset + 1}–{Math.min(offset + PAGE_SIZE, shown.length)} из {shown.length}</p>
          <div className="divide-y rounded-lg border">{shown.slice(offset, offset + PAGE_SIZE).map(person => <article key={person.employee_id} className="grid min-w-0 gap-3 p-4 lg:grid-cols-2">
            <div className="min-w-0 space-y-1 break-words"><h3 className="font-semibold">{person.full_name}</h3><p className="text-sm text-muted-foreground">{[person.department_name, person.position_name].filter(Boolean).join(' · ')}</p><p className="text-sm">{person.status_label} · {person.date_end ? statusPeriod({ date_start: person.date_start, date_end: person.date_end }) : `с ${formatIsoDate(person.date_start)} · без окончания`}</p></div>
            <div className="min-w-0 space-y-3 break-words">{person.placements.length ? person.placements.map(item => <div key={item.source + ':' + item.source_id} className="space-y-1"><p className="font-medium">{item.label || 'Место не указано'}</p><p className="text-xs text-muted-foreground">{item.source === 'STATUS' ? 'Из статуса сотрудника' : 'Почасовая смена'}{item.start_at && <> · {dutyDateTime(item.start_at, data.time_zone)}</>}{item.end_at && <> — {dutyDateTime(item.end_at, data.time_zone)}</>}</p>{item.record_id && <Button asChild variant="outline" size="sm"><Link href={dutyWorkspaceHref('records', new URLSearchParams(params), { from: day, to: day, record: item.record_id })}>Учёт смены</Link></Button>}</div>) : <><p className="text-sm text-muted-foreground">Пост или группа не назначены</p>{person.destination && <p className="text-sm">Место в описании: {person.destination}</p>}</>}</div>
          </article>)}</div>
          {pages > 1 && <nav className="flex flex-wrap items-center justify-between gap-2 print:hidden" aria-label="Страницы состава"><Button size="sm" variant="outline" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>Назад</Button><span className="text-sm">{currentPage} / {pages}</span><Button size="sm" variant="outline" disabled={currentPage === pages} onClick={() => changePage(currentPage + 1)}>Далее</Button></nav>}
        </> : <p className="rounded-lg border p-5 text-sm text-muted-foreground">{filtered ? 'Сотрудников по выбранным условиям нет.' : 'На эту дату нет сотрудников со статусом дежурства в доступных подразделениях.'}</p>}
      </div>
      {shownGroups.length > 0 && <section aria-label="Боевые группы" className="space-y-3"><h2 className="text-lg font-semibold">Боевые группы · {shownGroups.length}</h2><p className="text-sm text-muted-foreground">Принятый состав групп показан отдельно. Сотрудники могут также входить в общий состав выше.</p>{shownGroups.map(group => <CombatGroup key={group.shift_id} group={group} zone={data.time_zone} />)}</section>}
      <p className="text-xs text-muted-foreground">Состав определяется действующими статусами и назначениями. Статус дежурства и указанное место не подтверждают фактическое заступление. Отметки и историю смотрите в «Журнале и контроле».</p>
      {data.generated_at && <p className="text-xs text-muted-foreground">Обновлено: {dutyDateTime(data.generated_at, data.time_zone)}</p>}
    </>}
  </section>;
}
