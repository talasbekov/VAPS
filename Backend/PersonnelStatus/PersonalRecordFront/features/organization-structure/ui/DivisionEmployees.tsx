'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmployeePortrait } from '@/components/employee-portrait';
import { LoadFailure } from '@/components/load-failure';
import { SERVICE_EMPLOYEES_PATH, serviceEmployeeHref, type ServiceEmployeePage } from '@/entities/service-employee';
import { opsApiClient } from '@/lib/ops-api';

/** Mounted only after successful personnel.view access; keyed by division by the scene. */
export function DivisionEmployees({ divisionId, divisionName }: { divisionId: number; divisionName: string }) {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const filters = new URLSearchParams({ division_id: String(divisionId), page_size: '8', page: String(page) });
  if (search) filters.set('search', search);
  const query = filters.toString();
  const employees = useQuery({
    queryKey: ['org-division-employees', divisionId, query],
    queryFn: () => opsApiClient.get<ServiceEmployeePage>(`${SERVICE_EMPLOYEES_PATH}?${query}`),
    // Never keep previous-division/search/page rows while the next request loads.
    placeholderData: () => undefined,
    retry: false,
  });
  return <section id="org-division-employees" aria-labelledby="org-division-employees-title" className="mt-4 scroll-mt-20 rounded-xl border bg-card p-4 sm:p-6" data-testid="org-division-employees">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="org-division-employees-title" className="text-lg font-semibold">Сотрудники · {divisionName}</h2><p className="mt-1 text-sm text-muted-foreground">Выбранное подразделение и подчинённые · в вашей области доступа</p></div>
      <Link className="inline-flex min-h-11 items-center text-sm font-medium text-primary-ink hover:underline" href={`/service-employees?${query}`}>Открыть список сотрудников →</Link>
    </div>
    <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); setPage(1); setSearch(draft.trim()); }}>
      <label className="min-w-0 flex-1 space-y-1 text-sm font-medium" htmlFor="org-employee-search">Поиск сотрудников<Input id="org-employee-search" value={draft} onChange={event => setDraft(event.target.value)} placeholder="ФИО, табельный номер или позывной" className="min-h-11" /></label>
      <Button type="submit" className="min-h-11">Найти</Button>
      {search && <Button variant="outline" type="button" className="min-h-11" onClick={() => { setDraft(''); setSearch(''); setPage(1); }}>Сбросить поиск</Button>}
    </form>
    {employees.isPending && <p role="status" className="py-6 text-sm text-muted-foreground">Загружаем сотрудников подразделения…</p>}
    {employees.isError && <LoadFailure what="сотрудников подразделения" onRetry={() => void employees.refetch()} isRetrying={employees.isFetching} />}
    {employees.isSuccess && <>
      <p className="my-3 text-sm text-muted-foreground" role="status">Найдено: {employees.data.count}</p>
      {employees.data.results.length === 0 ? <p className="rounded-lg bg-muted/40 p-5 text-sm">{search ? 'По этому запросу сотрудники не найдены. Измените или сбросьте поиск.' : 'В этом подразделении и подчинённых нет сотрудников в вашей области доступа.'}</p> : <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {employees.data.results.map(employee => <li key={employee.id} className="min-w-0 rounded-lg border p-3" data-testid="org-employee-card">
          <div className="flex items-start gap-3">
            <EmployeePortrait name={employee.full_name} photoUrl={employee.photo_url} className="h-14 w-14" />
            <div className="min-w-0"><Link href={serviceEmployeeHref(employee.id, query)} className="inline-flex min-h-11 items-center break-words font-medium text-primary-ink hover:underline">{employee.full_name}</Link><p className="text-sm text-muted-foreground">{[employee.rank, employee.position].filter(Boolean).join(' · ') || 'Должность не указана'}</p></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{employee.division?.name ?? 'Без подразделения'}</p>
          <p className="mt-2 text-sm"><span className="rounded-md bg-secondary px-2 py-1 text-secondary-foreground">{employee.current_status.name}</span></p>
        </li>)}
      </ul>}
      <nav aria-label="Страницы сотрудников подразделения" className="mt-4 flex items-center justify-between gap-2">
        <Button variant="outline" className="min-h-11" disabled={!employees.data.previous || employees.isFetching} onClick={() => setPage(current => Math.max(1, current - 1))}>Назад</Button>
        <span className="text-sm">Страница {page}</span>
        <Button variant="outline" className="min-h-11" disabled={!employees.data.next || employees.isFetching} onClick={() => setPage(current => current + 1)}>Далее</Button>
      </nav>
    </>}
  </section>;
}
