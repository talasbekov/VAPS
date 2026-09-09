'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadFailure } from '@/components/load-failure';
import { OpsAccessDenied } from '@/components/ops-access-denied';
import { opsApiClient } from '@/lib/ops-api';
import { OpsApiError } from '@/lib/ops-errors';
import { formatIsoDate } from '@/shared/lib/date';
import { SERVICE_EMPLOYEES_PATH, missingRatingLabel, serviceEmployeeHref, type ServiceEmployeePage, type ServiceEmployeeOptions } from '@/entities/service-employee';

const selectClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ServiceEmployeesScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.toString();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const employees = useQuery({
    queryKey: ['service-employees', query],
    queryFn: () => opsApiClient.get<ServiceEmployeePage>(`${SERVICE_EMPLOYEES_PATH}?${query}`),
    retry: false,
  });
  const options = useQuery({
    queryKey: ['service-employees-options'],
    queryFn: () => opsApiClient.get<ServiceEmployeeOptions>(`${SERVICE_EMPLOYEES_PATH}options/`),
  });
  const changePage = (value: number) => {
    const next = new URLSearchParams(query);
    next.set('page', String(value));
    router.push(`/service-employees?${next}`, { scroll: false });
  };
  if (employees.error instanceof OpsApiError && [401, 403].includes(employees.error.status)) {
    return <OpsAccessDenied what="сотрудников Службы" />;
  }
  return <DashboardLayout><div className="space-y-4">
    <PageHeader eyebrow="Личный состав" title="Сотрудники Службы" description="Сотрудники в вашей области доступа: текущий статус, рейтинг и назначения на ОМ" />
    <Card><CardContent className="p-4">
      <form key={`${query}:${options.isSuccess}`} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const next = new URLSearchParams();
        data.forEach((value, key) => { if (String(value).trim()) next.set(key, String(value).trim()); });
        router.push(`/service-employees?${next}`, { scroll: false });
      }}>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="employee-search">Поиск по ФИО, табельному номеру или позывному</Label><Input id="employee-search" name="search" defaultValue={params.get('search') ?? ''} className="h-11" /></div>
        <div className="space-y-1"><Label htmlFor="employee-division">Подразделение и подчинённые</Label><select id="employee-division" name="division_id" className={selectClass} defaultValue={params.get('division_id') ?? ''}>
          <option value="">Все доступные</option>{options.data?.divisions.map(d => <option key={d.id} value={d.id}>{'— '.repeat(d.level)}{d.name}</option>)}
        </select></div>
        <div className="space-y-1"><Label htmlFor="employee-status">Текущий статус</Label><select id="employee-status" name="status" className={selectClass} defaultValue={params.get('status') ?? ''}>
          <option value="">Все статусы</option>{options.data?.statuses.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select></div>
        <div className="space-y-1"><Label htmlFor="employee-participation">Назначения на ОМ</Label><select id="employee-participation" name="participation" className={selectClass} defaultValue={params.get('participation') ?? ''}>
          <option value="">Все сотрудники</option><option value="active">Есть действующие или предстоящие</option><option value="none">Нет действующих и предстоящих</option>
        </select></div>
        <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label htmlFor="rating-min">Рейтинг от</Label><Input className="h-11" type="number" id="rating-min" name="rating_min" min="0" max="10" step="0.1" defaultValue={params.get('rating_min') ?? ''} /></div><div className="space-y-1"><Label htmlFor="rating-max">Рейтинг до</Label><Input className="h-11" type="number" id="rating-max" name="rating_max" min="0" max="10" step="0.1" defaultValue={params.get('rating_max') ?? ''} /></div></div>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2"><Button className="min-h-11" type="submit">Применить фильтры</Button><Button className="min-h-11" type="button" variant="outline" onClick={() => router.push('/service-employees')}>Сбросить</Button></div>
      </form>
      {options.isError && <p role="alert" className="mt-3 text-sm text-destructive-ink">Не удалось загрузить варианты фильтров. <button className="underline" onClick={() => void options.refetch()}>Повторить</button></p>}
    </CardContent></Card>
    {employees.isPending && <p role="status" className="p-4">Загрузка сотрудников…</p>}
    {employees.isError && <LoadFailure what="список сотрудников" onRetry={() => void employees.refetch()} isRetrying={employees.isFetching} />}
    {employees.data && <Card><CardContent className="p-0">
      <p className="border-b p-4 text-sm text-muted-foreground" aria-live="polite">Найдено сотрудников: {employees.data.count}</p>
      {employees.data.results.length === 0 ? <div className="p-8 text-center"><p className="font-medium">Сотрудники не найдены</p><p className="mt-1 text-sm text-muted-foreground">Измените условия поиска или сбросьте фильтры.</p></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">Сотрудники в доступной организационной области</caption>
        <thead className="hidden border-b bg-muted/50 lg:table-header-group"><tr>{['Сотрудник', 'Подразделение', 'Текущий статус', 'Рейтинг ОМ', 'Назначения'].map(title => <th key={title} scope="col" className="p-4 font-medium">{title}</th>)}</tr></thead>
        <tbody className="divide-y">{employees.data.results.map(employee => <tr key={employee.id} className="grid gap-2 p-4 hover:bg-muted/30 lg:table-row lg:p-0" data-testid="service-employee-row">
          <td className="lg:p-4"><Link className="inline-flex min-h-11 items-center font-semibold text-primary-ink hover:underline" href={serviceEmployeeHref(employee.id, query)}>{employee.full_name}</Link><div className="text-muted-foreground">{[employee.rank, employee.position].filter(Boolean).join(' · ') || 'Должность не указана'}</div><div className="text-xs text-muted-foreground">Таб. №{employee.personnel_number}{employee.callsign && ` · ${employee.callsign}`}</div></td>
          <td className="lg:p-4">{employee.division?.name ?? 'Без подразделения'}</td>
          <td className="lg:p-4"><span className="rounded-md bg-secondary px-2 py-1 text-secondary-foreground">{employee.current_status.name}</span></td>
          <td className="lg:p-4">{employee.rating === null ? <span className="text-muted-foreground">{missingRatingLabel(employee.rating_state)}</span> : <span className="font-semibold tabular-nums">{employee.rating.toFixed(1).replace('.', ',')} / 10</span>}<div className="text-xs text-muted-foreground">Оценок: {employee.evaluations_count}</div><div className="text-xs text-muted-foreground">Оценённых ОМ: {employee.rated_events_count}</div></td>
          <td className="lg:p-4"><div>Активных назначений: {employee.active_assignments_count}</div>{employee.next_assignment && <div className="mt-1 text-xs text-muted-foreground">{formatIsoDate(employee.next_assignment.date_start)} · {employee.next_assignment.event_code}<br />{employee.next_assignment.object_name} · {employee.next_assignment.post || 'Пост не указан'}</div>}</td>
        </tr>)}</tbody>
      </table></div>}
      <div className="flex items-center justify-between gap-2 border-t p-4"><Button variant="outline" className="min-h-11" disabled={!employees.data.previous || employees.isFetching} onClick={() => changePage(page - 1)}>Назад</Button><span className="text-sm">Страница {page}</span><Button variant="outline" className="min-h-11" disabled={!employees.data.next || employees.isFetching} onClick={() => changePage(page + 1)}>Далее</Button></div>
    </CardContent></Card>}
  </div></DashboardLayout>;
}
