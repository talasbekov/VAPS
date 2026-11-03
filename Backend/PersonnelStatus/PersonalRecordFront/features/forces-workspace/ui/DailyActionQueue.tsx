"use client";

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { formatIsoDate } from '@/shared/lib/date'
import { SUMMARY_ACTION_ANCHOR } from '@/features/daily-expense/ui/SummaryActionBar'
import { useDailyActionQueue } from '../model/daily-action-queue'
import { workspaceHref } from '../model/workspace'
import styles from './workspace.module.css'

export function DailyActionQueue({ query, standalone = false }: { query: URLSearchParams; standalone?: boolean }) {
  const { access, businessDate, scopeId, data, query: snapshot, dateError, retryDate } = useDailyActionQueue(query.get('businessDate') ?? undefined)
  const retry = () => dateError ? retryDate() : snapshot.refetch()
  const denied = (snapshot.error as { status?: number } | null)?.status === 403 ||
    (snapshot.error as { status?: number } | null)?.status === 401
  let content
  if (!access.error && (access.isLoading || access.permissions === undefined)) {
    content = <p role="status" className={styles.pending}>Загрузка очереди расхода…</p>
  } else if (access.error || !access.hasPermission('status.view') || !access.hasPermission('forces.allocate')) {
    content = <p role="alert" className={styles.pending}>Недостаточно прав для просмотра очереди расхода.</p>
  } else if (scopeId === null || access.globalPermissions?.has('*')) {
    content = <p className={styles.pending}>Для очереди нужен единственный департамент роли. Выберите департамент в своде.</p>
  } else if (dateError || snapshot.isError) {
    content = <div role="alert" className={styles.error}><p>{denied ? 'Доступ к очереди расхода закрыт.' : 'Очередь ежедневного расхода недоступна.'}</p><Button variant="outline" onClick={() => void retry()}>Повторить загрузку очереди</Button></div>
  } else if (!businessDate || snapshot.isPending || snapshot.isFetching || !data || data.scope.id !== String(scopeId)) {
    content = <p role="status" className={styles.pending}>Загрузка очереди расхода…</p>
  } else if (data.sources.length === 0) {
    content = <p className={styles.pending}>Нет обязательных источников с личным составом на выбранную дату.</p>
  } else {
    const missing = data.sources.filter(row => !row.submission)
    const next = new URLSearchParams(query)
    next.set('businessDate', businessDate)
    const summaryHref = `${workspaceHref(next, 'daily')}#${SUMMARY_ACTION_ANCHOR}`
    content = <>
      {missing.length > 0 ? <>
        <p className={styles.queueSummary}><strong>Не сдали: {missing.length}</strong> · сдали {data.sources.length - missing.length} из {data.sources.length}</p>
        <ul aria-label="Несдавшие подразделения">{missing.map(row => <li key={row.division.id} className={styles.sourceRow}>
          <span className={styles.overdue}>Не сдано</span>
          <div><strong>{row.division.name}</strong><p>Получатель: {row.division.notify_recipient_name || 'не назначен'}</p><p>Без статуса: {row.withoutStatus}{row.withoutStatus > 0 ? ' · требуется уточнить у подразделения' : ''}</p></div>
        </li>)}</ul>
      </> : <p className={styles.queueSummary}>Все обязательные источники сдали: {data.sources.length} из {data.sources.length}.</p>}
      {missing.length === 0 && data.total.submission?.sent_at
        ? <p className={styles.pending}>Свод отправлен. Нет ожидающих сдач.</p>
        : <div className={styles.processNext}><p>{missing.length ? 'Проверьте источники и напомните несдавшим в своде.' : data.total.submission ? 'Свод собран, ожидает отправки.' : 'Источники готовы. Соберите свод департамента.'}</p><Link className={styles.action} href={summaryHref}>Открыть свод</Link></div>}
    </>
  }
  return <section className={standalone ? `${styles.queue} ${styles.dailyQueue}` : styles.dailyQueueInner} aria-label="Очередь ежедневного расхода">
    <div className={styles.queueHead}>{standalone && <h2>Требует моего действия</h2>}<p>Ежедневный расход{businessDate ? ` · ${formatIsoDate(businessDate)}` : ' · дата уточняется'} · {access.roles.find(role => role.scope_division_id === scopeId)?.scope_division_name ?? 'Департамент роли'}</p></div>
    {content}
  </section>
}
