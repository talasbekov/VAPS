'use client';

import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Pencil, UserPlus } from 'lucide-react';
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
import { SERVICE_EMPLOYEES_PATH, missingRatingLabel, serviceEmployeeHref, type ServiceEmployeeDetail, type ServiceEmployeePage, type ServiceEmployeeOptions } from '@/entities/service-employee';
import type { ServiceEmployee } from '@/entities/service-employee';
import { useServiceEmployeeAuthority } from '../use-service-employee-authority';
import { EmployeeAdminDialog } from './EmployeeAdminDialog';
import { EmployeePortrait } from '@/components/employee-portrait';
import './employee-visual.css';

const selectClass = 'h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ServiceEmployeesScreen() {
  const queryClient = useQueryClient();
  const checkingAccess = useIsFetching({ queryKey: ['ops-me'] }) > 0;
  const { key: authority, ready: authorityReady, hasPermission, isLoading: permissionsLoading } = useServiceEmployeeAuthority();
  const canManageEmployees = hasPermission('orgstructure.manage') && hasPermission('admin.roles');
  const [editor, setEditor] = useState<{ authority: string; employee: ServiceEmployee | 'new' } | null>(null);
  useEffect(() => {
    setEditor(current => current && (!authorityReady || current.authority !== authority) ? null : current);
  }, [authority, authorityReady]);
  const router = useRouter();
  const params = useSearchParams();
  const query = params.toString();
  const requestedEditorId = params.get('edit');
  useEffect(() => {
    if (requestedEditorId !== null) setEditor(null);
  }, [requestedEditorId]);
  const validEditorId = requestedEditorId !== null && /^[1-9]\d*$/.test(requestedEditorId) && Number.isSafeInteger(Number(requestedEditorId));
  const page = Math.max(1, Number(params.get('page')) || 1);
  const employees = useQuery({
    queryKey: ['service-employees', authority, query],
    queryFn: () => opsApiClient.get<ServiceEmployeePage>(`${SERVICE_EMPLOYEES_PATH}?${query}`),
    retry: false,
    enabled: authorityReady,
  });
  const options = useQuery({
    queryKey: ['service-employees-options', authority],
    queryFn: () => opsApiClient.get<ServiceEmployeeOptions>(`${SERVICE_EMPLOYEES_PATH}options/`),
    enabled: authorityReady,
  });
  const requestedEditor = useQuery({
    queryKey: ['service-employee-editor', authority, requestedEditorId],
    queryFn: () => opsApiClient.get<ServiceEmployeeDetail>(`${SERVICE_EMPLOYEES_PATH}${encodeURIComponent(requestedEditorId!)}/`),
    enabled: authorityReady && canManageEmployees && validEditorId,
    retry: false,
  });
  const selectedDivision = params.get('division_id') ?? '';
  const selectedDivisionAvailable = options.data?.divisions.some(division => String(division.id) === selectedDivision);
  const divisionUnavailable = authorityReady && options.data !== undefined && selectedDivision !== '' && !selectedDivisionAvailable;
  const directoryReadDenied = authorityReady && employees.error instanceof OpsApiError && [401, 403].includes(employees.error.status);
  const editorReadDenied = requestedEditor.error instanceof OpsApiError && [401, 403, 404].includes(requestedEditor.error.status);
  const editorResponseMismatch = validEditorId && requestedEditor.data !== undefined && requestedEditor.data?.id !== Number(requestedEditorId);
  const requestedEmployee = validEditorId && !editorReadDenied && !editorResponseMismatch ? requestedEditor.data : undefined;
  const showEditor = authorityReady && !directoryReadDenied && canManageEmployees && options.data !== undefined && (requestedEditorId !== null ? requestedEmployee !== undefined : editor?.authority === authority);
  const editorFailure = authorityReady && canManageEmployees && validEditorId && (requestedEditor.isError || editorResponseMismatch)
    ? <LoadFailure what="кадровую форму сотрудника" description={editorResponseMismatch ? 'Ответ сервера не соответствует выбранному сотруднику. Повторите загрузку.' : editorReadDenied ? 'Сотрудник не найден или недоступен в вашей области доступа.' : undefined} onRetry={() => void requestedEditor.refetch()} isRetrying={requestedEditor.isFetching} />
    : undefined;
  const editorContext = useMemo(() => ({ authority, query, editor, showEditor }), [authority, query, editor, showEditor]);
  const currentEditorContext = useRef(editorContext);
  currentEditorContext.current = editorContext;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const leaveEditorLink = () => {
    if (requestedEditorId === null) return;
    const next = new URLSearchParams(query);
    next.delete('edit'); next.delete('action');
    const nextQuery = next.toString();
    router.replace(`/service-employees${nextQuery ? `?${nextQuery}` : ''}`, { scroll: false });
  };
  const openLocalEditor = (employee: ServiceEmployee | 'new') => {
    setEditor({ authority, employee });
    leaveEditorLink();
  };
  const closeEditor = () => {
    // A mutation may finish after its scope/form has gone away.
    if (!mounted.current || currentEditorContext.current !== editorContext) return;
    setEditor(null);
    leaveEditorLink();
  };
  const changePage = (value: number) => {
    const next = new URLSearchParams(query);
    next.set('page', String(value));
    router.push(`/service-employees?${next}`, { scroll: false });
  };
  if (directoryReadDenied) {
    return <OpsAccessDenied what="сотрудников Службы" />;
  }
  if (authorityReady && requestedEditorId !== null && !canManageEmployees) {
    return <OpsAccessDenied what="кадровое редактирование" />;
  }
  return <DashboardLayout><div className="sj-employee-view sj-employee-directory space-y-6">
    <PageHeader className="sj-employee-heading" eyebrow="Личный состав" title="Сотрудники подразделения" description="Поиск, текущий статус и назначения сотрудников в вашей области доступа" actions={authorityReady && canManageEmployees ? <Button className="min-h-11" onClick={() => openLocalEditor('new')}><UserPlus className="mr-2 h-4 w-4" />Добавить сотрудника</Button> : undefined} />
    {!authorityReady && !permissionsLoading && <LoadFailure what="доступ к кадровому разделу" description="Проверьте доступ перед просмотром кадровых данных." onRetry={() => void queryClient.refetchQueries({ queryKey: ['ops-me'], exact: true })} isRetrying={checkingAccess} />}
    {authorityReady && canManageEmployees && requestedEditorId !== null && !validEditorId && <div role="alert" className="space-y-2"><p>Некорректная ссылка на кадровую форму. Вернитесь к списку и выберите сотрудника.</p><Button type="button" variant="outline" className="min-h-11" onClick={closeEditor}>Закрыть кадровую форму</Button></div>}
    {authorityReady && canManageEmployees && validEditorId && (requestedEditor.isPending || options.isPending) && <p role="status">Загрузка кадровой формы…</p>}
    {!showEditor && editorFailure}
    <Card className="sj-directory-filters"><CardContent className="sj-directory-filter-content">
      <form key={query} className="sj-directory-filter-form" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const next = new URLSearchParams();
        data.forEach((value, key) => { if (String(value).trim()) next.set(key, String(value).trim()); });
        router.push(`/service-employees?${next}`, { scroll: false });
      }}>
        <div className="sj-directory-search space-y-1"><Label htmlFor="employee-search">Поиск по ФИО, табельному номеру или позывному</Label><Input id="employee-search" name="search" type="search" maxLength={200} aria-describedby="employee-search-hint" defaultValue={params.get('search') ?? ''} className="h-11" /></div>
        <div className="space-y-1"><Label htmlFor="employee-division">Подразделение и подчинённые</Label><select key={`division:${authority}:${authorityReady}:${options.data !== undefined}`} id="employee-division" name="division_id" className={selectClass} defaultValue={params.get('division_id') ?? ''}>
          <option value="">Все доступные</option>{selectedDivision && (!authorityReady || !selectedDivisionAvailable) && <option value={selectedDivision}>{divisionUnavailable ? `Недоступное подразделение (№${selectedDivision})` : `Подразделение №${selectedDivision} (проверяем доступ)`}</option>}{authorityReady && options.data?.divisions.map(d => <option key={d.id} value={d.id}>{'— '.repeat(d.level)}{d.name}</option>)}
        </select><ChevronDown size={16} className="sj-filter-chevron" aria-hidden="true" /></div>
        <div className="space-y-1"><Label htmlFor="employee-status">Текущий статус</Label><select key={`status:${options.data !== undefined}`} id="employee-status" name="status" className={selectClass} defaultValue={params.get('status') ?? ''}>
          <option value="">Все статусы</option>{authorityReady && options.data?.statuses.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select><ChevronDown size={16} className="sj-filter-chevron" aria-hidden="true" /></div>
        <div className="space-y-1"><Label htmlFor="employee-participation">Назначения на ОМ</Label><select id="employee-participation" name="participation" className={selectClass} defaultValue={params.get('participation') ?? ''}>
          <option value="">Все сотрудники</option><option value="active">Есть действующие или предстоящие</option><option value="none">Нет действующих и предстоящих</option>
        </select><ChevronDown size={16} className="sj-filter-chevron" aria-hidden="true" /></div>
        <div className="grid grid-cols-2 gap-2"><div className="space-y-1"><Label htmlFor="rating-min">Рейтинг от</Label><Input className="h-11" type="number" id="rating-min" name="rating_min" min="0" max="10" step="0.1" defaultValue={params.get('rating_min') ?? ''} /></div><div className="space-y-1"><Label htmlFor="rating-max">Рейтинг до</Label><Input className="h-11" type="number" id="rating-max" name="rating_max" min="0" max="10" step="0.1" defaultValue={params.get('rating_max') ?? ''} /></div></div>
        <div className="sj-directory-filter-actions flex flex-wrap items-end gap-2"><Button className="min-h-11" type="submit">Применить фильтры</Button><Button className="min-h-11" type="button" variant="outline" onClick={() => router.push('/service-employees')}>Сбросить</Button></div>
      </form>
      <p id="employee-search-hint" className="text-xs text-muted-foreground">Введите ФИО, табельный номер или позывной и нажмите Enter.</p>
      {divisionUnavailable && <p role="status" className="mt-3 text-sm text-muted-foreground">Выбранное подразделение недоступно. Выберите другое или сбросьте фильтры.</p>}
      {options.isError && <p role="alert" className="mt-3 text-sm text-destructive-ink">Не удалось загрузить варианты фильтров. <button className="underline" onClick={() => void options.refetch()}>Повторить</button></p>}
    </CardContent></Card>
    {(permissionsLoading || (authorityReady && employees.isPending)) && <p role="status" className="p-4">Загрузка сотрудников…</p>}
    {authorityReady && employees.isError && <LoadFailure what="список сотрудников" onRetry={() => void employees.refetch()} isRetrying={employees.isFetching} />}
    {authorityReady && employees.data && <Card className="sj-directory-results"><CardContent className="p-0">
      <p className="sj-directory-results-count" aria-live="polite">Найдено сотрудников: {employees.data.count}</p>
      {employees.data.results.length === 0 ? <div className="p-8 text-center"><p className="font-medium">Сотрудники не найдены</p><p className="mt-1 text-sm text-muted-foreground">Измените условия поиска или сбросьте фильтры.</p></div> : <div className="sj-directory-table-wrap"><table className="sj-directory-table w-full text-left text-sm">
        <caption className="sr-only">Сотрудники в доступной организационной области</caption>
        <thead className="hidden border-b bg-muted/50 lg:table-header-group"><tr>{['Сотрудник', 'Подразделение', 'Текущий статус', 'Рейтинг ОМ', 'Назначения'].map(title => <th key={title} scope="col" className="p-4 font-medium">{title}</th>)}</tr></thead>
        <tbody className="divide-y">{employees.data.results.map(employee => <tr key={employee.id} className="sj-directory-row" data-testid="service-employee-row">
          <td className="sj-directory-identity"><div className="flex items-start gap-3"><EmployeePortrait name={employee.full_name} photoUrl={employee.photo_url} /><div className="sj-directory-identity-copy"><Link className="inline-flex min-h-11 items-center font-semibold text-primary-ink hover:underline" href={serviceEmployeeHref(employee.id, query)}>{employee.full_name}</Link><div className="text-muted-foreground">{[employee.rank, employee.position].filter(Boolean).join(' · ') || 'Должность не указана'}</div><div className="text-xs text-muted-foreground">Таб. №{employee.personnel_number}{employee.callsign && ` · ${employee.callsign}`}</div>{canManageEmployees && <div className="sj-employee-row-actions"><Button type="button" variant="outline" size="sm" onClick={() => openLocalEditor(employee)}><Pencil className="mr-2 h-4 w-4" />Изменить</Button></div>}</div></div></td>
          <td data-label="Подразделение">{employee.division?.name ?? 'Без подразделения'}</td>
          <td data-label="Текущий статус"><span data-status={employee.current_status.code} className="sj-employee-status rounded-md bg-secondary px-2 py-1 text-secondary-foreground">{employee.current_status.name}</span></td>
          <td data-label="Рейтинг ОМ">{employee.rating === null ? <span className="text-muted-foreground">{missingRatingLabel(employee.rating_state)}</span> : <span className="font-semibold tabular-nums">{employee.rating.toFixed(1).replace('.', ',')} / 10</span>}<div className="text-xs text-muted-foreground">Оценок: {employee.evaluations_count}</div><div className="text-xs text-muted-foreground">Оценённых ОМ: {employee.rated_events_count}</div></td>
          <td data-label="Назначения"><div>Активных назначений: {employee.active_assignments_count}</div>{employee.next_assignment && <div className="mt-1 text-xs text-muted-foreground">{formatIsoDate(employee.next_assignment.date_start)} · {employee.next_assignment.event_code}<br />{employee.next_assignment.object_name} · {employee.next_assignment.post || 'Пост не указан'}</div>}</td>
        </tr>)}</tbody>
      </table></div>}
      <div className="sj-directory-pagination flex items-center justify-between gap-2 border-t p-4"><Button variant="outline" className="min-h-11" disabled={!employees.data.previous || employees.isFetching} onClick={() => changePage(page - 1)}>Назад</Button><span className="text-sm">Страница {page}</span><Button variant="outline" className="min-h-11" disabled={!employees.data.next || employees.isFetching} onClick={() => changePage(page + 1)}>Далее</Button></div>
    </CardContent></Card>}
    {showEditor && options.data && <EmployeeAdminDialog key={`${authority}:${requestedEditorId ?? (editor?.employee === 'new' ? 'new' : editor?.employee.id)}`} employee={requestedEmployee ?? (editor?.employee === 'new' ? null : editor?.employee ?? null)} options={options.data} onClose={closeEditor} loadFailure={editorFailure} />}
  </div></DashboardLayout>;
}
