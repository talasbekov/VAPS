'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageHeader } from '@/components/page-header';
import { OpsAccessDenied } from '@/components/ops-access-denied';
import { LoadFailure } from '@/components/load-failure';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DUTY_REGISTER_KEY, useDutyRegisterAccess } from '@/hooks/use-duty-register';
import { DUTY_ASSIGNMENTS_QUERY_KEY } from '@/hooks/use-duty-assignments';
import { opsApiClient } from '@/lib/ops-api';
import { friendlyOpsErrorMessage } from '@/lib/ops-errors';
import { statusPeriod } from '@/features/daily-expense/ui/StatusDetails';
import type { DispatchAssignment, DispatchQueue, DutyPerson } from '../model/types';
import { AssignDutyDialog, CancelDutyDialog } from './AssignDutyDialog';
import { moduleOpenFor } from '@/entities/portal-access';
import { DUTY_STATE_LABELS } from '@/entities/duty-register';
import { dutyWorkspaceHref, validDutyDate } from '@/features/duty-register/model/workspace';
import { isReadAccessBlocked, readWithAccessCheck } from '@/lib/query-read-access';
import { dispatchEmptyState, showDispatchFilters } from '../model/empty-state';

const KEY = ['duty-dispatch'] as const;
const PAGE_SIZE = 25;
const inputStyle = 'rounded-md border bg-background px-3 py-2 text-sm';

function ReceiverSetting({ queue, enabled, onSaved }: { queue: DispatchQueue; enabled: boolean; onSaved(): Promise<void> }) {
  const [receiver, setReceiver] = useState(String(queue.receiver?.id ?? ''));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function save() {
    if (lock.current || !enabled || !receiver) return;
    lock.current = true; setPending(true); setError('');
    try { await opsApiClient.post('/api/ops/duty-dispatch/configure/', { department_id: Number(receiver) }); await onSaved(); }
    catch (failure) { setError(friendlyOpsErrorMessage(failure, 'Настройка доступна администратору прав.')); }
    finally { lock.current = false; setPending(false); }
  }
  return <details className="rounded-lg border p-4" open={!queue.receiver}>
    <summary className="cursor-pointer text-sm font-medium">Принимающий департамент</summary>
    <p className="my-3 text-sm text-muted-foreground">Его дежурные получают сотрудников со всей Службы. Область права расстановки должна включать этот департамент.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm">Департамент-получатель<select className={inputStyle} disabled={pending || !enabled} value={receiver} onChange={event => setReceiver(event.target.value)}><option value="">Выберите департамент</option>{queue.receiver_options?.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
      <Button disabled={pending || !enabled || !receiver || receiver === String(queue.receiver?.id)} onClick={() => void save()}>{pending ? 'Сохранение…' : 'Сохранить получателя'}</Button>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
  </details>;
}

function shiftLabel(row: DispatchAssignment, zone?: string) {
  const format = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', ...(zone ? { timeZone: zone } : {}) });
  return `${format.format(new Date(row.start_at))} — ${format.format(new Date(row.end_at))}`;
}

export function DutyDispatchWorkspace({ embedded = false }: { embedded?: boolean }) {
  const access = useDutyRegisterAccess();
  const client = useQueryClient();
  const params = useSearchParams();
  const router = useRouter();
  const selectedDate = params.get('date') ?? '';
  const validDate = !selectedDate || validDutyDate(selectedDate);
  const allowed = !access.isLoading && !access.error && (access.hasPermission('duty.dispatch') || access.hasGlobalPermission('admin.roles'));
  const key = [...KEY, access.scope, selectedDate];
  const query = useQuery({ queryKey: key,
    queryFn: ({ signal }) => readWithAccessCheck(client, key, signal, () => opsApiClient.get<DispatchQueue>(`/api/ops/duty-dispatch/${selectedDate ? `?business_date=${selectedDate}` : ''}`)),
    enabled: allowed && validDate, retry: false, staleTime: 0,
  });
  const queue = allowed && validDate && !query.isError && !isReadAccessBlocked(client, key) ? query.data : undefined;
  const date = selectedDate || queue?.business_date || '';
  const [tab, setTab] = useState('waiting');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [page, setPage] = useState(1);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [person, setPerson] = useState<(DutyPerson & { business_date: string }) | null>(null);
  const [cancel, setCancel] = useState<DispatchAssignment | null>(null);
  const [notice, setNotice] = useState('');
  const canAssign = Boolean(queue?.can_assign && !query.isFetching && access.hasPermission('duty.dispatch'));
  const canCancel = Boolean(queue?.can_cancel && !query.isFetching && access.hasPermission("duty.dispatch"));
  const currentTab = !queue?.can_assign && queue?.can_cancel && tab === "waiting" ? "assigned" : tab;
  const canPlace = canAssign && access.hasPermission('object.view');
  const assignments = queue?.assignments ?? [];
  const currentCancellation = cancel ? assignments.find(row => row.id === cancel.id) : undefined;
  const people = queue?.people ?? [];
  const active = assignments.filter(row => !row.cancelled_at);
  const history = assignments.filter(row => row.cancelled_at);
  const assignedIds = new Set(active.filter(row => row.valid).map(row => row.employee_id));
  const waiting = people.filter(row => !row.legacy_assignment && !assignedIds.has(row.employee_id));
  const placedInStatuses = people.filter(row => Boolean(row.legacy_assignment)).length;
  const departments = [...new Set([...people, ...assignments].map(row => row.department_name).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b, 'ru'));
  const needle = search.trim().toLocaleLowerCase('ru');
  const hasFilters = Boolean(needle || department);
  const unfilteredCount = currentTab === 'waiting' ? waiting.length : currentTab === 'history' ? history.length : active.length;
  const empty = dispatchEmptyState({tab: currentTab, people: people.length, waiting: waiting.length, active: active.length, invalid: active.filter(row => !row.valid).length, history: history.length, hasFilters});
  const match = (row: DutyPerson | DispatchAssignment) => {
    const placement = 'placement' in row ? row.placement : undefined;
    const words = [row.full_name, row.department_name, row.directorate_name, row.position_name, placement?.object_name, placement?.post_name, placement?.sector_name, placement?.group_name];
    return (!department || row.department_name === department) && words.filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(needle);
  };
  const visibleWaiting = waiting.filter(match);
  const visibleActive = active.filter(match);
  const visibleHistory = history.filter(match);
  const matchingCount = currentTab === 'waiting' ? visibleWaiting.length : currentTab === 'history' ? visibleHistory.length : visibleActive.length;
  const pageCount = Math.max(1, Math.ceil(matchingCount / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * PAGE_SIZE;
  useEffect(() => { setPage(1); }, [date, currentTab, search, department]);
  useEffect(() => {
    if (!selectedDate && queue?.business_date) router.replace(dutyWorkspaceHref('shifts', new URLSearchParams(params), { date: queue.business_date }), { scroll: false });
  }, [selectedDate, queue?.business_date, params, router]);
  useEffect(() => { setPage(previous => Math.min(previous, pageCount)); }, [pageCount]);
  function changePage(next: number) {
    setPage(next);
    requestAnimationFrame(() => {
      resultsRef.current?.focus({ preventScroll: true });
      resultsRef.current?.scrollIntoView({ block: 'start' });
    });
  }
  async function refresh() {
    await client.invalidateQueries({ queryKey: KEY });
  }
  async function saved(message: string) {
    setNotice(message);
    await Promise.all([refresh(), client.invalidateQueries({ queryKey: DUTY_REGISTER_KEY }), client.invalidateQueries({ queryKey: DUTY_ASSIGNMENTS_QUERY_KEY }), client.invalidateQueries({ queryKey: ['service-combat-duty'] })]);
  }
  const currentPerson = person && people.find(row => row.employee_id === person.employee_id && row.status_id === person.status_id);
  const personAllowed = Boolean(currentPerson && person?.business_date === date && !currentPerson.unavailable_reason && canPlace);
  if (!access.isLoading && !allowed) return <OpsAccessDenied what="расстановки дежурств" />;

  function emptyState() {
    return <div className="space-y-2 rounded-lg border p-5" role="status">
      <p className="font-medium">{empty.title}</p><p className="text-sm text-muted-foreground">{empty.detail}</p>
      {empty.action === 'clear' && <Button variant="outline" onClick={() => { setSearch(''); setDepartment(''); }}>Сбросить фильтры</Button>}
      {empty.action === 'assigned' && <Button variant="outline" onClick={() => setTab('assigned')}>Посмотреть назначения</Button>}
      {empty.action === 'waiting' && queue?.can_assign && <Button variant="outline" onClick={() => setTab('waiting')}>Расставить сотрудников</Button>}
      {empty.action === 'roster' && access.allowed && <Button asChild variant="outline"><Link href={dutyWorkspaceHref('roster', new URLSearchParams({date}))}>Посмотреть состав на дату</Link></Button>}
    </div>;
  }

  function assignmentRows(rows: DispatchAssignment[]) {
    return rows.length ? <div className="grid gap-3">{rows.map(row => <article key={row.id} className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1 break-words"><h3 className="font-semibold">{row.full_name}</h3>{(row.department_name || row.directorate_name) && <p className="text-sm text-muted-foreground">{[row.department_name, row.directorate_name].filter(Boolean).join(' · ')}</p>}{row.service_duty_label && <p className="text-sm font-medium">{row.service_duty_label}</p>}<p className="text-sm">{row.placement.object_name} · {row.placement.kind === 'POST' ? [row.placement.sector_name, row.placement.post_name].filter(Boolean).join(' · ') : row.placement.group_name}</p><p className="text-sm text-muted-foreground">{shiftLabel(row, queue?.time_zone)}</p></div>
        <div className="flex flex-wrap gap-2">{!row.cancelled_at && row.valid && people.some(item => item.employee_id === row.employee_id && !item.unavailable_reason) && <Button size="sm" disabled={!canPlace} onClick={() => { setNotice(""); const next = people.find(item => item.employee_id === row.employee_id); setPerson(next ? { ...next, business_date: date } : null); }}>Добавить смену</Button>}{access.hasPermission('object.view') && <Button asChild variant="outline" size="sm"><Link href={`/security-ops/objects/${row.placement.object_id}/?dutyDate=${date}`}>Открыть объект</Link></Button>}{!row.cancelled_at && row.can_cancel !== false && <Button size="sm" variant="outline" disabled={!canCancel} onClick={() => { setNotice(''); setCancel(row); }}>Снять назначение</Button>}</div>
      </div>
      {row.execution_state && <p className="mt-2 text-sm">Исполнение: {DUTY_STATE_LABELS[row.execution_state].toLocaleLowerCase('ru')}</p>}
      {row.cancelled_at ? <p className="mt-2 text-sm text-muted-foreground">Назначение снято{row.cancelled_reason ? `: ${row.cancelled_reason}` : ''}</p> : !row.valid && <p role="alert" className="mt-2 text-sm text-amber-700">Требует внимания: {row.invalid_reason || 'Выделение больше не действует'}. В действующем составе объекта не учитывается.</p>}
      {moduleOpenFor('/security-ops/duty-register', access.hasPermission) && <Button asChild variant="outline" size="sm" className="mt-3"><Link href={'/security-ops/duty-register/?' + new URLSearchParams({ from: date, to: date, source: 'DISPATCH', record: row.duty_record_id ?? `DISPATCH:${row.id}` })}>Учёт смены</Link></Button>}
    </article>)}</div> : emptyState();
  }

  const Container = embedded ? Fragment : DashboardLayout;
  return <Container><div className="min-w-0 space-y-5 pb-20">
    {embedded ? <div><h2 className="text-lg font-semibold">Почасовые смены</h2><p className="text-sm text-muted-foreground">{queue?.receiver ? `Дежурный · ${queue.receiver.name}` : 'Назначение места и времени смены'}</p></div> : <PageHeader title="Почасовые смены" description={queue?.receiver ? `Дежурный · ${queue.receiver.name}` : 'Назначение места и времени смены'} />}
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid min-w-0 gap-1 text-sm">Дата дежурства<input type="date" className={inputStyle} value={date} disabled={Boolean(person || cancel)} onChange={event => { setNotice(''); router.replace(dutyWorkspaceHref('shifts', new URLSearchParams(params), { date: event.target.value }), { scroll: false }); }} /></label>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void refresh()}>Обновить</Button>
      {!embedded && access.allowed && <Button asChild variant="outline"><Link href={dutyWorkspaceHref('records', new URLSearchParams(date ? { from: date, to: date, source: 'DISPATCH' } : {}))}>Журнал и контроль</Link></Button>}
      {!embedded && access.allowed && <Button asChild variant="ghost"><Link href={dutyWorkspaceHref('roster', new URLSearchParams({ date }))}>Общий состав дежурства</Link></Button>}
    </div>
    {!validDate && <p role="alert">Укажите дату в формате ГГГГ-ММ-ДД.</p>}
    {(access.isLoading || query.isLoading) && <p role="status">Загрузка выделенных сотрудников…</p>}
    {query.isError && <LoadFailure what="список дежурства" onRetry={() => void refresh()} isRetrying={query.isFetching} />}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {queue && <>
      {queue.can_configure && access.hasGlobalPermission('admin.roles') && <ReceiverSetting key={queue.receiver?.id ?? 'unset'} queue={queue} enabled={!query.isFetching} onSaved={() => saved('Принимающий департамент сохранён')} />}
      {!queue.can_assign && <p className="rounded-lg border p-4 text-sm">{queue.access_reason || 'Расстановка доступна дежурному принимающего департамента.'}</p>}
      {(queue.can_assign || queue.can_cancel) && <>
        <p className="text-sm text-muted-foreground">Используйте этот раздел, если нужны точные часы смены. Если пост или группа уже выбраны в статусе сотрудника, повторное назначение не требуется.</p>
        {placedInStatuses > 0 && <p className="rounded-lg border p-3 text-sm">Уже назначены через статусы: {placedInStatuses}. Их места доступны в «Составе на дату».</p>}
        {!access.hasPermission('object.view') && <p role="alert" className="text-sm">Для выбора места дежурства требуется доступ к объектам.</p>}
        <Tabs value={currentTab} onValueChange={setTab}>
          <TabsList className="h-auto flex-wrap">{queue.can_assign && <TabsTrigger value="waiting">Ожидают расстановки · {waiting.length}</TabsTrigger>}<TabsTrigger value="assigned">Расставлены · {active.filter(row => row.valid).length}{active.some(row => !row.valid) ? ' · Есть изменения' : ''}</TabsTrigger><TabsTrigger value="history">История · {history.length}</TabsTrigger></TabsList>
          {showDispatchFilters(unfilteredCount, hasFilters) && <div className="my-4 flex flex-wrap gap-3">
            <input aria-label="Поиск сотрудника" className={`${inputStyle} min-w-0 flex-1 basis-64`} placeholder="ФИО, управление, объект или пост" value={search} onChange={event => setSearch(event.target.value)} />
            <select aria-label="Департамент отправителя" className={`${inputStyle} max-w-full`} value={department} onChange={event => setDepartment(event.target.value)}><option value="">Все департаменты</option>{department && !departments.includes(department) && <option value={department}>{department}</option>}{departments.map(name => <option key={name}>{name}</option>)}</select>
            {hasFilters && <Button variant="ghost" onClick={() => { setSearch(''); setDepartment(''); }}>Сбросить фильтры</Button>}
          </div>}
          <div ref={resultsRef} tabIndex={-1} role="region" aria-label="Список дежурств" className="scroll-mt-24 outline-none">
          <TabsContent value="waiting" className="space-y-4">
            {visibleWaiting.length ? <div className="divide-y rounded-lg border">{visibleWaiting.slice(offset, offset + PAGE_SIZE).map(row => <article key={row.employee_id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0 space-y-1 break-words"><h3 className="font-semibold">{row.full_name}</h3><p className="text-sm text-muted-foreground">{[row.department_name, row.directorate_name, row.position_name].filter(Boolean).join(' · ')}</p><p className="text-sm">{row.status_label} · {statusPeriod({ date_start: row.date_start, date_end: row.date_end ?? "" })}</p>{row.unavailable_reason && <p className="text-sm text-amber-700">{row.unavailable_reason}</p>}</div><Button disabled={!canPlace || Boolean(row.unavailable_reason)} onClick={() => { setNotice(''); setPerson({ ...row, business_date: date }); }}>Назначить</Button></article>)}</div> : emptyState()}
          </TabsContent>
          <TabsContent value="assigned">{assignmentRows(visibleActive.slice(offset, offset + PAGE_SIZE))}</TabsContent>
          <TabsContent value="history">{assignmentRows(visibleHistory.slice(offset, offset + PAGE_SIZE))}</TabsContent>
          </div>
          {matchingCount > 0 && <nav aria-label="Страницы списка дежурства" className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" role="status">Показано {offset + 1}–{Math.min(offset + PAGE_SIZE, matchingCount)} из {matchingCount}</p>
            {pageCount > 1 && <div className="flex items-center gap-2"><Button aria-label="Предыдущая страница" variant="outline" size="sm" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>Назад</Button><span className="text-sm">{currentPage} / {pageCount}</span><Button aria-label="Следующая страница" variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>Далее</Button></div>}
          </nav>}
        </Tabs>
      </>}
    </>}
    {person && <AssignDutyDialog checking={query.isFetching} person={person} date={person.business_date} allowed={personAllowed} onClose={() => setPerson(null)} onSaved={() => saved('Назначение сохранено')} onRefresh={refresh} />}
    {cancel && <CancelDutyDialog checking={query.isFetching} assignment={currentCancellation ?? cancel} allowed={canCancel && Boolean(currentCancellation && !currentCancellation.cancelled_at && currentCancellation.can_cancel !== false)} onClose={() => setCancel(null)} onSaved={() => saved('Назначение снято')} onRefresh={refresh} />}
  </div></Container>;
}
