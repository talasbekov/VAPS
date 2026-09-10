"use client";

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiClient } from '@/lib/api'
import { opsApiClient } from '@/lib/ops-api'
import { DAILY_EMPLOYEES_PATH } from '@/entities/daily-grid'
import { formatIsoDate, formatIsoDateTime } from '@/shared/lib/date'
import { useOpsStatusTypes } from '@/hooks/use-ops-status-types'
import { effectiveDailyStatus, useResponsibleDaily, type DirectorateSummary } from '../model/directorate-summary'
import { SummaryVersions } from './SummaryVersions'
import styles from './responsible-daily.module.css'

export function DailyRetry({ label, onRetry, action = 'Повторить' }: { label: string; onRetry: () => unknown; action?: string }) {
  return <div role="alert" className={styles.error}><p>{label}</p><Button variant="outline" onClick={() => void onRetry()}>{action}</Button></div>
}

interface Employee { id: string; full_name: string; rank_code: string }
function People({ row, date, labelOf }: { row: DirectorateSummary; date: string; labelOf: (code: string) => string }) {
  const catalog = useOpsStatusTypes()
  const employees = useQuery({ queryKey: ['daily-expense-board', 'responsible-people', date, row.ids], queryFn: async () => {
    const result: Employee[] = []
    // Daily adapter accepts at most 200 exact division IDs, not a subtree root.
    for (let offset = 0; offset < row.ids.length; offset += 200) {
      const query = new URLSearchParams({ business_date: date })
      row.ids.slice(offset, offset + 200).forEach(id => query.append('division_id', id))
      const response = await opsApiClient.get<{ results: Employee[] }>(`${DAILY_EMPLOYEES_PATH}?${query}`)
      if (!Array.isArray(response.results)) throw new Error('Некорректный ответ состава')
      result.push(...response.results)
    }
    return [...new Map(result.map(person => [person.id, person])).values()]
  } })
  // Operations status endpoint explicitly resolves division_id as a subtree.
  const statuses = useQuery({ queryKey: ['daily-expense-board', 'responsible-statuses', date, row.division.id],
    queryFn: () => apiClient.getOpsStatusesOn({ businessDate: date, divisionId: Number(row.division.id) }) })
  if (employees.isError || statuses.isError || catalog.isError) return <DailyRetry label="Не удалось получить сотрудников и статусы" onRetry={() => Promise.all([employees.refetch(), statuses.refetch(), catalog.refetch()])} />
  if (employees.isPending || statuses.isPending || catalog.isLoading) return <p role="status">Загрузка сотрудников…</p>
  return <div className={styles.people}>
    {employees.data.length === 0 ? <p>Нет сотрудников на выбранную дату.</p> : employees.data.map(person => {
      let status
      try { status = effectiveDailyStatus(statuses.data.filter(item => item.employee_id === Number(person.id)), date, catalog.all) }
      catch { return <div key={person.id} className={styles.person}><strong>{person.full_name}</strong><DailyRetry label="Не удалось определить статус по справочнику" onRetry={() => Promise.all([statuses.refetch(), catalog.refetch()])} /></div> }
      return <div key={person.id} className={styles.person}><strong>{person.full_name}</strong><span>{person.rank_code || '—'}</span><span className={styles.neutral}>{status ? labelOf(status.status_type_code) : 'Без отдельной отметки: в строю'}</span></div>
    })}
  </div>
}

function Directorate({ row, date, labels, labelOf, submissionReady }: { row: DirectorateSummary; date: string; labels: Record<string, string>; labelOf: (code: string) => string; submissionReady: boolean }) {
  const [open, setOpen] = useState(false)
  const submissionText = submissionReady ? row.submission ? 'Сдано' : 'Не сдано' : 'Неизвестно'
  return <article className={styles.unit}>
    <div className={styles.unitRow}>
      <div><button className={styles.expand} aria-expanded={open} onClick={() => setOpen(!open)}><ChevronRight aria-hidden className={open ? styles.chevronOpen : ''} size={18} />{row.division.name}</button><p>{row.division.notify_recipient_name ? `Ответственный: ${row.division.notify_recipient_name}` : 'Получатель напоминаний не назначен'}</p></div>
      <div role="group" aria-label={`Сдача: ${submissionText}`}><span className={styles.mobileLabel}>Сдача</span><span className={row.submission ? styles.submitted : styles.neutral}>{submissionText}</span>{submissionReady && row.submission && <small>{formatIsoDateTime(row.submission.submitted_at)} · v{row.submission.version}</small>}</div>
      <div role="group" aria-label={`По списку: ${row.listTotal}`}><span className={styles.mobileLabel}>По списку</span><b>{row.listTotal}</b></div><div role="group" aria-label={`В строю: ${row.inService ?? 'Неизвестно'}`}><span className={styles.mobileLabel}>В строю</span><b>{row.inService ?? '—'}</b></div><div role="group" aria-label={`Отклонения: ${row.deviations ?? 'Неизвестно'}`}><span className={styles.mobileLabel}>Отклонения</span><b>{row.deviations ?? '—'}</b></div>
    </div>
    {open && <div className={styles.expanded}><dl className={styles.columnStats}>{Object.entries(row.columns).map(([code, count]) => <div key={code}><dt>{labels[code] ?? code}</dt><dd>{count}</dd></div>)}</dl><p className={styles.hint}>Без отдельной отметки — в строю: {row.withoutStatus}. Вне списка: {row.offList}.</p><People row={row} date={date} labelOf={labelOf} /></div>}
  </article>
}

interface ReminderResult { business_date: string; laggard_division_ids: number[]; notified_recipient_count: number; unresolved_division_ids: number[] }
function Reminder({ date, scopeId, disabled, nameOf }: { date: string; scopeId: number; disabled: boolean; nameOf: (id: number) => string }) {
  const mutation = useMutation({ mutationFn: () => opsApiClient.post<ReminderResult>('/api/operations/daily-summaries/remind/', { division_id: scopeId, business_date: date }) })
  return <div><Button variant="outline" disabled={disabled || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Отправка напоминаний…' : 'Напомнить всем несдавшим'}</Button>
    {mutation.isError && <p role="alert" className={styles.error}>Напоминания не отправлены. Повторите попытку кнопкой выше.</p>}
    {mutation.data && <p role="status" className={styles.hint}>Получателей уведомлено: {mutation.data.notified_recipient_count}.{mutation.data.unresolved_division_ids.length > 0 && ` Без получателя: ${mutation.data.unresolved_division_ids.map(nameOf).join(', ')}.`}{mutation.data.laggard_division_ids.length === 0 && ' Все обязательные источники сдали.'}</p>}
  </div>
}

export function ResponsibleDailyExpense({ businessDate: selectedDate, onBusinessDateChange }: { businessDate?: string; onBusinessDateChange: (date: string) => void }) {
  const state = useResponsibleDaily(selectedDate)
  const { businessDate: date, data, report, divisions, submissions, catalog } = state
  const [filter, setFilter] = useState<'all' | 'missing' | 'deviations'>('all')
  const nameOf = (id: number) => divisions.data?.find(row => row.id === String(id))?.name ?? `Подразделение №${id}`
  const submissionReady = submissions.isSuccess && !submissions.isError
  const submitted = data?.sources.filter(row => row.submission).length ?? 0
  const visible = data?.sources.filter(row => filter === 'all' || (filter === 'missing' ? !row.submission : (row.deviations ?? 0) > 0)) ?? []
  return <section aria-label="Расход департамента" className={styles.screen}>
    <div className={styles.title}><div><h2>Расход{date ? ` на ${formatIsoDate(date)}` : ''}</h2><p>Соберите сдачи подразделений и отправьте единый свод дежурному.</p></div><label>Деловая дата<input type="date" value={date ?? ''} onChange={event => { if (event.target.value) onBusinessDateChange(event.target.value) }} /></label></div>
    {!date ? state.clock.isError ? <DailyRetry label="Не удалось получить деловую дату" onRetry={state.clock.refetch} /> : <p role="status">Загрузка даты…</p>
      : state.structureError ? <p role="alert">{state.structureError}</p>
      : report.isError || divisions.isError ? <DailyRetry label="Не удалось получить расход и структуру" onRetry={() => Promise.all([report.refetch(), divisions.refetch()])} />
      : !data ? <p role="status">Загрузка расхода…</p>
      : <>
        <div className={styles.hero}><div>{submissions.isError ? <DailyRetry label="Не удалось получить состояние сдачи" action="Повторить состояние сдачи" onRetry={submissions.refetch} /> : submissions.isPending ? <p role="status">Загрузка состояния сдачи…</p> : <><strong>Сдали {submitted} из {data.sources.length}</strong><progress aria-label="Сдача обязательных источников" max={Math.max(data.sources.length, 1)} value={submitted} /><p>{data.sources.length === 0 ? 'Нет обязательных источников с сотрудниками.' : submitted === data.sources.length ? 'Все обязательные источники сдали расход.' : `Ожидаем: ${data.sources.filter(row => !row.submission).map(row => row.division.name).join(', ')}.`}</p></> }</div>
          {state.access.hasPermission('daily_report.generate') && state.scopeId != null && <Reminder key={`${date}:${state.scopeId}`} date={date} scopeId={state.scopeId} disabled={!submissionReady || submitted === data.sources.length} nameOf={nameOf} />}
        </div>
        {catalog.isError && <DailyRetry label="Не удалось получить справочник статусов" onRetry={catalog.refetch} />}
        <dl className={styles.stats}><div><dt>По списку</dt><dd data-testid="daily-list-total">{data.total.listTotal}</dd></div><div><dt>В строю</dt><dd data-testid="daily-ready-total">{data.total.inService ?? '—'}</dd></div><div><dt>Всего отклонений</dt><dd>{data.total.deviations ?? '—'}</dd></div><div><dt>Без отдельной отметки · в строю</dt><dd>{data.total.withoutStatus}</dd></div></dl>
        <div className={styles.list}><header className={styles.listHead}><div><h3>Управления департамента</h3><p>Сотрудники отделов включены в своё управление.</p></div><div className={styles.filters}><Button variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>Все</Button><Button disabled={!submissionReady} variant={filter === 'missing' ? 'default' : 'outline'} onClick={() => setFilter('missing')}>Не сдали</Button><Button disabled={catalog.isLoading || catalog.isError} variant={filter === 'deviations' ? 'default' : 'outline'} onClick={() => setFilter('deviations')}>Есть отклонения</Button></div></header>
          <div className={styles.tableHead} aria-hidden><span>Подразделение</span><span>Сдача</span><span>По списку</span><span>В строю</span><span>Отклонения</span></div>
          {visible.map(row => <Directorate key={`${date}:${row.division.id}`} row={row} date={date} labels={report.data?.column_labels ?? {}} labelOf={catalog.labelOf} submissionReady={submissionReady} />)}
          {visible.length === 0 && <p className={styles.hint}>Нет подразделений по выбранному фильтру.</p>}
        </div>
        {data.sources.some(row => row.division.division_type !== 'directorate') && <p className={styles.hint}>В список включены также прямые подразделения другого типа: они участвуют в полноте свода.</p>}
        {data.direct.listTotal + data.direct.offList > 0 && <p className={styles.hint}>Непосредственно в департаменте: по списку {data.direct.listTotal}, вне списка {data.direct.offList}. Включены в общие показатели.</p>}
        <SummaryVersions key={`${date}:${state.scopeId}`} businessDate={date} boardDivisionIds={data.sources.map(row => Number(row.division.id))} labelOfDivision={nameOf} scopeDivisionId={state.scopeId ?? undefined} />
      </>}
  </section>
}
