'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LoadFailure } from '@/components/load-failure';
import { dutyDateTime, type DutyRegisterSnapshot } from '@/entities/duty-register';
import { useDutyControlSnapshot, useDutyRegisterAccess } from '@/hooks/use-duty-register';
import { formatIsoDate } from '@/shared/lib/date';
import { dutyWorkspaceHref } from '../model/workspace';
import { DutyExecutionBadge } from './DutyExecutionTimeline';

function controlHref(data: DutyRegisterSnapshot, values: Record<string, string> = {}) {
  return dutyWorkspaceHref('records', new URLSearchParams(), { from: data.period.from, to: data.period.to, ...values });
}

/** Today's duty records accompany the officer's existing service workspace. */
export function DutyExecutionOverview() {
  const access = useDutyRegisterAccess();
  const query = useDutyControlSnapshot(access.allowed, access.scope);
  const data = query.visibleData?.overview;
  const current = query.visibleData?.active;
  if (!access.allowed) return null;
  return <section aria-labelledby="duty-control-today" className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="duty-control-today" className="text-lg font-semibold">Контроль дежурств на сегодня</h2>
      <p className="text-sm text-muted-foreground">{data ? formatIsoDate(data.period.from) : 'Дата определяется сервером'} · Назначение, ознакомление и заступление учитываются отдельно.</p>
    </div><Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Обновить дежурства</Button></div>
    {query.isLoading && <p role="status">Загрузка контроля дежурств…</p>}
    {query.isError && <LoadFailure what="контроль дежурств" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />}
    {data && !query.isError && <>
      {data.control ? <>
        <dl className="grid min-w-0 grid-cols-3 gap-2">{[
          ['Назначено выходов', data.control.assigned], ['Отмечено ознакомление', data.control.acknowledged], ['Отмечено заступление', data.control.started],
        ].map(([label, count]) => <div key={label} className="min-w-0 rounded-lg bg-muted/40 p-3"><dt className="break-words text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count}</dd></div>)}</dl>
        <div className="grid min-w-0 gap-2 sm:grid-cols-3">{[
          { label: 'Не отмечено заступление', count: data.control.missing_start, attention: 'MISSING_START' },
          { label: 'Заступили позже плана', count: data.control.late_start, attention: 'LATE_START' },
          { label: 'Не отмечено завершение', count: data.control.missing_end, attention: 'MISSING_END' },
        ].map(item => <Link key={item.attention} href={controlHref(data, { attention: item.attention })} className={`flex min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-3 text-sm hover:bg-accent ${item.count ? 'border-amber-300 ' : ''}`}><span className="break-words">{item.label}</span><strong className="tabular-nums">{item.count}</strong></Link>)}</div>
      </> : <p role="status" className="text-sm text-muted-foreground">Источник не вернул отдельные показатели ознакомления и заступления. Проверьте отметки в журнале.</p>}
      <p className="text-xs text-muted-foreground">Показатели считают выходы, включая завершённые за день. Один сотрудник может иметь несколько выходов. Если заступление не отмечено, проверьте выход сотрудника и необходимость замены; отсутствие отметки не доказывает неявку.</p>
      <Link className="inline-flex min-h-9 items-center text-sm font-medium text-primary underline underline-offset-2" href={controlHref(data)}>Открыть журнал за сегодня</Link>
    </>}
    <div className="space-y-2 border-t pt-3"><h3 className="font-medium">Текущие смены</h3>
      {query.isLoading && <p role="status" className="text-sm text-muted-foreground">Загрузка текущих смен…</p>}
      {current && !query.isError && (current.rows.length ? <>
        <ul className="divide-y rounded-lg border">{current.rows.map(row => <li key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-3"><div className="min-w-0 flex-1 break-words"><p className="text-sm font-medium">{row.employee_name}</p><p className="text-xs text-muted-foreground">{row.location_label || 'Место не указано'} · Заступление: {dutyDateTime(row.actual_start, current.time_zone)}</p></div><DutyExecutionBadge row={row} now={current.generated_at} /><Link href={controlHref(current, { state: 'ACTIVE', record: row.id })} className="inline-flex min-h-9 items-center text-sm font-medium text-primary underline underline-offset-2">Проверить смену</Link></li>)}</ul>
        {current.pagination.count > current.rows.length && <Link href={controlHref(current, { state: 'ACTIVE' })} className="inline-flex min-h-9 items-center text-sm text-primary underline underline-offset-2">Все текущие смены · {current.pagination.count}</Link>}
      </> : <p className="text-sm text-muted-foreground">Смен с отметкой заступления без завершения в доступной области нет.</p>)}
    </div>
  </section>;
}
