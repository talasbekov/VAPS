"use client";

import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { DepartmentRequestsTable } from '@/features/department-requests'
import { ForceCollectionsTable } from '@/features/force-collections'
import { DailyExpenseBoard } from '@/features/daily-expense'
import { ResponsibleDailyExpense, DailyRetry } from '@/features/daily-expense/ui/ResponsibleDailyExpense'
import { useResponsibleDaily } from '@/features/daily-expense/model/directorate-summary'
import { useDepartmentRequests } from '@/hooks/use-department-requests'
import { useOpsPermissions } from '@/hooks/use-ops-permissions'
import { formatIsoDate, formatIsoDateTime } from '@/shared/lib/date'
import { activeRequests, requestTotals, resolveWorkspaceView, workspaceHref, type WorkspaceRole } from '../model/workspace'
import styles from './workspace.module.css'

function Retry({ label, retry }: { label: string; retry: () => unknown }) {
  return <div role="alert" className={styles.error}><p>{label}</p><Button variant="outline" onClick={() => void retry()}>Повторить</Button></div>
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div className={styles.metric}><dt>{label}</dt><dd>{value}</dd></div>
}

function DailySnapshot({ query }: { query: URLSearchParams }) {
  const { businessDate, clock, report, divisions, submissions, catalog, structureError, data } = useResponsibleDaily(query.get('businessDate') ?? undefined)
  return <article className={`${styles.process} ${styles.blue}`} aria-label="Ежедневный расход департамента">
    <div className={styles.processHead}><p className={styles.tag}>Ежедневный расход</p><h2>Свод департамента</h2><p>Сдача расхода подразделениями{businessDate ? ` на ${formatIsoDate(businessDate)}` : ''}.</p></div>
    {!businessDate && clock.isError ? <Retry label="Не удалось получить деловую дату" retry={clock.refetch} />
      : structureError ? <p role="alert" className={styles.pending}>{structureError}</p>
      : report.isError || divisions.isError ? <Retry label="Не удалось получить расход" retry={() => Promise.all([report.refetch(), divisions.refetch()])} />
      : !businessDate || !data ? <p role="status" className={styles.pending}>Загрузка расхода…</p>
      : data ? <dl className={styles.metrics}>
        <Metric label="По списку" value={data.total.listTotal} />
        <Metric label="В строю" value={data.total.inService ?? 'Недоступно'} />
        <Metric label="Отклонения" value={data.total.deviations ?? 'Недоступно'} />
        <Metric label="Вне списка" value={data.total.offList} />
      </dl> : null}
    {catalog.isError && <Retry label="Не удалось получить справочник статусов" retry={catalog.refetch} />}
    {businessDate && (submissions.isError ? <Retry label="Не удалось получить состояние сдачи" retry={submissions.refetch} />
      : submissions.isPending ? <p role="status" className={styles.pending}>Загрузка состояния сдачи…</p>
      : data && <p className={styles.pending}>Сдали {data.sources.filter(row => row.submission).length} из {data.sources.length} обязательных источников. {data.total.submission?.sent_at ? `Свод отправлен ${formatIsoDateTime(data.total.submission.sent_at)}.` : data.total.submission ? 'Свод собран, ожидает отправки.' : 'Свод ещё не собран.'}</p>)}
    <div className={styles.processNext}><p>Состояние сдачи и состав по подразделениям</p><Link className={styles.action} href={workspaceHref(query, 'daily')}>Открыть свод</Link></div>
  </article>
}

function DailyActionQueue({ query }: { query: URLSearchParams }) {
  const { data, businessDate, submissions, report, divisions, structureError, clock } = useResponsibleDaily(query.get('businessDate') ?? undefined)
  if (structureError) return <p role="alert" className={styles.pending}>{structureError}</p>
  if (submissions.isError || report.isError || divisions.isError || (!businessDate && clock.isError)) return <DailyRetry label="Очередь ежедневного расхода недоступна" onRetry={() => Promise.all([clock.refetch(), submissions.refetch(), report.refetch(), divisions.refetch()])} />
  if (!data || submissions.isPending) return <p role="status" className={styles.pending}>Загрузка очереди расхода…</p>
  const missing = data.sources.filter(row => !row.submission)
  if (missing.length === 0 && data.total.submission?.sent_at) return <p className={styles.pending}>Ежедневный свод отправлен. Нет ожидающих сдач.</p>
  return <div className={styles.queueRow}><span className={styles.badge}>Расход</span><div><strong>{missing.length ? `Ожидаем сдачу: ${missing.map(row => row.division.name).join(', ')}` : data.total.submission ? 'Отправить собранный свод' : 'Собрать свод департамента'}</strong><p>{businessDate ? formatIsoDate(businessDate) : ''} · сдали {data.sources.length - missing.length} из {data.sources.length}</p></div><div /><Link className={styles.action} href={workspaceHref(query, 'daily')}>Открыть свод</Link></div>
}

function ResponsibleDesk({ query }: { query: URLSearchParams }) {
  const access = useOpsPermissions()
  const requests = useDepartmentRequests()
  const rows = activeRequests(requests.data?.results ?? [])
  const totals = requestTotals(rows)
  return <>
    <div className={styles.processGrid}>
      {access.hasPermission('status.view') ? <DailySnapshot query={query} /> : <article className={styles.process}><h2>Ежедневный расход</h2><p>Недостаточно прав для просмотра расхода.</p></article>}
      <article className={`${styles.process} ${styles.orange}`} aria-label="Входящие запросы Штаба">
        <div className={styles.processHead}><p className={styles.tag}>Сбор сил на ОМ</p><h2>Входящие запросы Штаба</h2><p>Ответить цифрой, разложить по управлениям, собрать список.</p></div>
        {requests.isError ? <Retry label="Не удалось получить запросы Штаба" retry={requests.refetch} />
          : requests.isPending ? <p role="status" className={styles.pending}>Загрузка запросов…</p>
          : <><dl className={styles.metrics}>
            <Metric label="Активных" value={rows.length} /><Metric label="Запрошено" value={totals.requested} />
            <Metric label="Выделяем" value={totals.allocating ?? 'Ответ не дан'} /><Metric label="Собрано" value={totals.assigned} />
          </dl><p className={styles.pending}>{totals.unanswered > 0 ? `Без ответа: ${totals.unanswered}.` : 'Все активные запросы получили ответ.'} Просрочено: {rows.filter(row => row.overdue).length}.</p></>}
        <div className={styles.processNext}><p>Физический наряд; специальные группы — в карточке запроса</p><Link className={styles.action} href={workspaceHref(query, 'forces')}>Открыть заявки</Link></div>
      </article>
    </div>
    <section className={styles.queue} aria-labelledby="workspace-actions"><div className={styles.queueHead}><h2 id="workspace-actions">Требует моего действия</h2><p>Ежедневный расход и активные запросы сил.</p></div>
      {access.hasPermission('status.view') && <DailyActionQueue query={query} />}
      {requests.isError ? <Retry label="Очередь запросов недоступна" retry={requests.refetch} />
        : requests.isPending ? <p role="status" className={styles.pending}>Загрузка очереди…</p>
        : rows.length === 0 ? <p className={styles.pending}>Нет активных запросов сил.</p>
        : <ul>{rows.map(row => <li key={row.allocationId} className={styles.queueRow}>
          <span className={row.overdue ? styles.overdue : styles.badge}>{row.overdue ? 'Просрочен' : 'Сбор сил'}</span>
          <div><strong>{row.code} · {row.title}</strong><p>{row.departmentName} · запрошено {row.need} · выделяем {row.allocating ?? 'ответ не дан'} · собрано {row.assigned}</p></div>
          <div><span className={styles.label}>Срок</span><p>{row.dueAt ? formatIsoDateTime(row.dueAt) : 'Не указан'}</p></div>
          <Link className={styles.action} href={workspaceHref(query, 'forces', row.allocationId)}>{row.allocating === null ? 'Ответить' : 'Открыть'}</Link>
        </li>)}</ul>}
    </section>
  </>
}

export function ForcesWorkspace({ role }: { role: WorkspaceRole }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const access = useOpsPermissions()
  const query = new URLSearchParams(searchParams)
  const view = resolveWorkspaceView(role, query)
  const scopedRole = access.roles.find(item => item.code === (role === 'responsible' ? 'FORCES_GATHERING_OFFICER' : 'OPS_STAFF'))
  const title = view === 'desk' ? 'Рабочий стол' : view === 'daily' ? 'Ежедневный расход' : role === 'headquarters' ? 'Распределения' : 'Сбор сил на ОМ'
  return <DashboardLayout><div className={styles.workspace}>
    <div className={styles.titleRow}><div><p className={styles.eyebrow}>{role === 'responsible' ? 'Мои задачи' : 'Штаб · сбор и распределение сил'}</p><h1>{title}</h1><p>{scopedRole?.name}</p></div><span className={styles.scope}>{scopedRole?.scope_division_name ?? (role === 'headquarters' ? 'Штаб' : 'Мой департамент')}</span></div>
    {view === 'desk' ? <ResponsibleDesk query={query} />
      : view === 'daily' ? access.hasPermission('status.view') ? role === 'responsible' ? <ResponsibleDailyExpense businessDate={query.get('businessDate') ?? undefined} onBusinessDateChange={date => {
        const next = new URLSearchParams(query); next.set('businessDate', date)
        router.replace(workspaceHref(next, 'daily'), { scroll: false })
      }} /> : <DailyExpenseBoard businessDate={query.get('businessDate') ?? undefined} onBusinessDateChange={date => {
        const next = new URLSearchParams(query); next.set('businessDate', date)
        router.replace(workspaceHref(next, 'daily'), { scroll: false })
      }} /> : <p role="alert">Недостаточно прав для просмотра расхода.</p>
      : <div className={styles.detail}>{role === 'headquarters' ? <ForceCollectionsTable /> : <DepartmentRequestsTable />}</div>}
  </div></DashboardLayout>
}
