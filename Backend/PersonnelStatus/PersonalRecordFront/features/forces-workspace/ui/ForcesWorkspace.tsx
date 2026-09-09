"use client";

import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { DashboardLayout } from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { DepartmentRequestsTable } from '@/features/department-requests'
import { ForceCollectionsTable } from '@/features/force-collections'
import { DailyExpenseBoard } from '@/features/daily-expense'
import { useDepartmentRequests } from '@/hooks/use-department-requests'
import { useOpsPermissions } from '@/hooks/use-ops-permissions'
import { useStrengthReport, useTrafficLightTree } from '@/hooks/use-strength-report'
import { useBusinessDate } from '@/features/daily-expense/model/business-date'
import { apiClient } from '@/lib/api'
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
  const { businessDate } = useBusinessDate(query.get('businessDate') ?? undefined)
  // Observe the same query to expose its failure: useBusinessDate only returns date/loading.
  const clock = useQuery({ queryKey: ['daily-expense-board', 'default-business-date'],
    queryFn: () => apiClient.getTomorrowBlockState({}), staleTime: 5 * 60_000 })
  const report = useStrengthReport(businessDate !== null, businessDate ?? undefined)
  const traffic = useTrafficLightTree(businessDate !== null, businessDate ?? undefined)
  const data = report.data
  const nodes = traffic.data?.nodes
  // Parent colors already include descendants. Count only visible leaves to avoid duplication.
  const parentIds = new Set(nodes?.map(node => node.parent_id))
  const leaves = nodes?.filter(node => !parentIds.has(node.division_id))
  return <article className={`${styles.process} ${styles.blue}`} aria-label="Ежедневный расход департамента">
    <div className={styles.processHead}><p className={styles.tag}>Ежедневный расход</p><h2>Свод департамента</h2><p>Сдача расхода подразделениями{businessDate ? ` на ${formatIsoDate(businessDate)}` : ''}.</p></div>
    {!businessDate && clock.isError ? <Retry label="Не удалось получить деловую дату" retry={clock.refetch} />
      : !businessDate || report.isPending ? <p role="status" className={styles.pending}>Загрузка расхода…</p>
      : report.isError ? <Retry label="Не удалось получить расход" retry={report.refetch} />
      : data ? <dl className={styles.metrics}>
        <Metric label="По списку" value={data.totals.list_total} />
        <Metric label="Штат" value={data.totals.staff_total} />
        <Metric label="Вакансии" value={data.totals.vacancies} />
        <Metric label="Вне списка" value={data.totals.off_list} />
      </dl> : null}
    {businessDate && (traffic.isError ? <Retry label="Не удалось получить состояние сдачи" retry={traffic.refetch} />
      : traffic.isPending ? <p role="status" className={styles.pending}>Загрузка состояния сдачи…</p>
      : <p className={styles.pending}>Состояние подразделений: {leaves?.filter(node => node.status === 'GREEN').length} зелёных из {leaves?.length}. Контрольное время: {traffic.data?.control_hour}.</p>)}
    <div className={styles.processNext}><p>Состояние сдачи и состав по подразделениям</p><Link className={styles.action} href={workspaceHref(query, 'daily')}>Открыть свод</Link></div>
  </article>
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
    <section className={styles.queue} aria-labelledby="workspace-actions"><div className={styles.queueHead}><h2 id="workspace-actions">Требует моего действия</h2><p>Запросы сил с ближайшим сроком и недобором.</p></div>
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
    <nav className={styles.nav} aria-label="Рабочее место">
      {role === 'responsible' && <Link aria-current={view === 'desk' ? 'page' : undefined} href={workspaceHref(query, 'desk')}>Рабочий стол</Link>}
      {access.hasPermission('status.view') && <Link aria-current={view === 'daily' ? 'page' : undefined} href={workspaceHref(query, 'daily')}>Ежедневный расход</Link>}
      <Link aria-current={view === 'forces' ? 'page' : undefined} href={workspaceHref(query, 'forces')}>{role === 'headquarters' ? 'Распределения' : 'Сбор сил на ОМ'}</Link>
    </nav>
    <div className={styles.titleRow}><div><p className={styles.eyebrow}>{role === 'responsible' ? 'Мои задачи' : 'Штаб · сбор и распределение сил'}</p><h1>{title}</h1><p>{scopedRole?.name}</p></div><span className={styles.scope}>{scopedRole?.scope_division_name ?? (role === 'headquarters' ? 'Штаб' : 'Мой департамент')}</span></div>
    {view === 'desk' ? <ResponsibleDesk query={query} />
      : view === 'daily' ? access.hasPermission('status.view') ? <DailyExpenseBoard businessDate={query.get('businessDate') ?? undefined} onBusinessDateChange={date => {
        const next = new URLSearchParams(query); next.set('businessDate', date)
        router.replace(workspaceHref(next, 'daily'), { scroll: false })
      }} /> : <p role="alert">Недостаточно прав для просмотра расхода.</p>
      : <div className={styles.detail}>{role === 'headquarters' ? <ForceCollectionsTable /> : <DepartmentRequestsTable />}</div>}
  </div></DashboardLayout>
}
