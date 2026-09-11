'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { DashboardLayout } from '@/components/dashboard-layout';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadFailure } from '@/components/load-failure';
import { opsApiClient } from '@/lib/ops-api';
import { OpsApiError } from '@/lib/ops-errors';
import { useOpsPermissions } from '@/hooks/use-ops-permissions';
import { formatIsoDate, formatIsoDateTime } from '@/shared/lib/date';
import { addDaysIso } from '@/entities/daily-grid';
import { SERVICE_EMPLOYEES_PATH, type ServiceEmployeeDetail, type ServiceAssignment } from '@/entities/service-employee';

export function ServiceEmployeeProfile({ id, filters }: { id: string; filters: string }) {
  const { hasPermission } = useOpsPermissions();
  const employee = useQuery({
    queryKey: ['service-employee', id],
    queryFn: () => opsApiClient.get<ServiceEmployeeDetail>(`${SERVICE_EMPLOYEES_PATH}${encodeURIComponent(id)}/`),
    retry: false,
  });
  const data = employee.data;
  const notFound = employee.error instanceof OpsApiError && [401, 403, 404].includes(employee.error.status);
  const eventTitle = (assignment: ServiceAssignment) => hasPermission('event.view')
    ? <Link className="font-semibold text-primary-ink hover:underline" href={`/security-ops/events/${assignment.event_id}`}>{assignment.event_code} · {assignment.event_title}</Link>
    : <span className="font-semibold">{assignment.event_code} · {assignment.event_title}</span>;
  return <DashboardLayout><div className="space-y-4">
    <Link href={`/service-employees${filters ? `?${new URLSearchParams(filters)}` : ''}`} className="inline-flex min-h-11 items-center text-sm font-medium text-primary-ink hover:underline">← Сотрудники Службы</Link>
    <PageHeader eyebrow="Личный состав" title={data?.full_name ?? 'Карточка сотрудника'} description="Основные сведения, назначения и история ОМ · только чтение" />
    {employee.isPending && <p role="status">Загрузка карточки…</p>}
    {notFound ? <p role="alert">Сотрудник не найден в вашей области доступа.</p> : employee.isError && <LoadFailure what="карточку сотрудника" onRetry={() => void employee.refetch()} isRetrying={employee.isFetching} />}
    {data && <>
      <Card><CardContent className="grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <p className="font-medium">{[data.rank, data.position].filter(Boolean).join(' · ')}</p>
          <p className="text-sm text-muted-foreground">{data.division?.name ?? 'Без подразделения'}</p>
          <p className="mt-2 text-sm">Таб. №{data.personnel_number}{data.callsign && ` · Позывной: ${data.callsign}`}</p>
          <p className="text-sm">В Службе с {formatIsoDate(data.hire_date ?? '')}</p>
          {data.work_phone && <p className="text-sm">Служебный телефон: {data.work_phone}</p>}
          {data.work_email && <p className="break-all text-sm">Служебная почта: {data.work_email}</p>}
        </div>
        <div>
          <p className="font-medium">{data.current_status.name}{data.current_status.date_end && ` до ${formatIsoDate(addDaysIso(data.current_status.date_end, -1))}`}</p>
          {data.rating !== null && <div data-testid="service-profile-rating">
            <p className="mt-2 text-sm">Рейтинг ОМ: <strong>{data.rating.toFixed(1).replace('.', ',')} / 10</strong></p>
            <p className="text-sm text-muted-foreground">Оценённых ОМ: {data.rated_events_count} · Оценок: {data.evaluations_count}</p>
          </div>}
          <p className="mt-2 text-sm">Активных назначений: {data.active_assignments_count}</p>
        </div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Назначения на ОМ</CardTitle></CardHeader><CardContent className="space-y-3">{data.assignments.length === 0 && <p className="text-sm text-muted-foreground">Предстоящих назначений нет.</p>}{data.assignments.map(a => <div key={`${a.event_id}-${a.id}`} className={`rounded-lg border p-4 ${a.acknowledged_at ? 'border-emerald-600/40 bg-emerald-500/5' : ['ACKNOWLEDGEMENT', 'CONDUCT'].includes(a.stage) ? 'border-amber-600/40 bg-amber-500/5' : 'bg-muted/20'}`}>
        {eventTitle(a)}<p className="mt-1 text-sm">{formatIsoDate(a.date_start)} — {formatIsoDate(a.date_end)}{a.event_time && ` · ${a.event_time.slice(0, 5)}`} · {a.object_name}</p>{a.address && <p className="text-sm">{a.address}</p>}<p className="text-sm">{[a.sector, a.post].filter(Boolean).join(' · ') || 'Пост не указан'}</p>{a.task && <p className="mt-2 text-sm">Задача: {a.task}</p>}{a.requirements && <p className="text-sm">Требования: {a.requirements}</p>}{a.uniform && <p className="text-sm">Форма: {a.uniform}</p>}{a.weapon && <p className="text-sm">Вооружение: {a.weapon}</p>}{a.chief_name && <p className="text-sm">Старший объекта: {a.chief_name}{a.chief_callsign && ` · ${a.chief_callsign}`}{a.chief_work_phone && ` · Тел.: ${a.chief_work_phone}`}</p>}<p className="mt-2 text-sm text-muted-foreground">{a.declined_at ? 'Отказ от заступления' : a.acknowledged_at ? `Ознакомлен ${formatIsoDateTime(a.acknowledged_at)}` : ['ACKNOWLEDGEMENT', 'CONDUCT'].includes(a.stage) ? 'Ожидает ознакомления' : 'Назначение готовится'}</p>
      </div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>История закрытых ОМ</CardTitle><p className="text-sm text-muted-foreground">Участие в ОМ: {new Set(data.history.map(a => a.event_id)).size} мероприятий{data.rating !== null && ` · средний балл ${data.rating.toFixed(1).replace('.', ',')}`}</p></CardHeader><CardContent className="space-y-3">
        {data.history.length === 0 && <p className="text-sm text-muted-foreground">Истории закрытых мероприятий пока нет.</p>}
        {data.history.length > 0 && <div className="overflow-x-auto rounded-lg border" tabIndex={0} role="region" aria-label="Таблица истории, горизонтальная прокрутка">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <caption className="sr-only">История закрытых ОМ</caption>
            <thead className="border-b bg-muted/40"><tr>{['Дата', 'Мероприятие', 'Объект', 'Пост', 'Ознакомление', 'Балл'].map(title => <th key={title} scope="col" className="p-3 font-medium">{title}</th>)}</tr></thead>
            <tbody className="divide-y">{data.history.map(a => {
              const evaluations = data.evaluations.filter(e => e.event_id === a.event_id && (!e.assignment_id || e.assignment_id === a.id));
              return <tr key={`${a.event_id}-${a.id}`}>
                <td className="p-3 align-top whitespace-nowrap">{formatIsoDate(a.date_start)}</td>
                <td className="p-3 align-top">{eventTitle(a)}</td>
                <td className="p-3 align-top">{a.object_name}</td>
                <td className="p-3 align-top">{a.post || '—'}</td>
                <td className="p-3 align-top">{a.acknowledged_at ? formatIsoDateTime(a.acknowledged_at) : '—'}</td>
                <td className="p-3 align-top">{evaluations.length === 0 ? '—' : evaluations.map((e, index) => <details key={`${e.event_code}-${index}`} className="rounded-md bg-muted/40 p-2">
                  <summary className="cursor-pointer whitespace-nowrap font-medium">Оценка: {e.score} / 10</summary>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{e.comment || 'Без комментария'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{e.author} · {formatIsoDate(e.date)}</p>
                </details>)}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
      </CardContent></Card>
    </>}
  </div></DashboardLayout>;
}
