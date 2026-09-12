"use client";

// Экран ответственного за сбор сил: расход департамента ПО БЛАНКУ
// (Plane №1197, решение заказчика 12.09.2026, макет одобрен).
//
// Заказчик: «просто будет таблица расхода личного состава департамента с
// цифрами [как в expense_report_2026-01-16.xlsx], и рядом названия
// управлений с цифрами по статусу плюс индикатор (зелёный либо красный),
// что эти управления сдали ежедневный расход, и расход по датам».
//
// Что здесь и почему:
//   • ОДНА плоская таблица: «Руководство департамента» → управления → «ИТОГО»,
//     колонки в порядке бланка (Штат · Список · В строю · Вакансии · остальные
//     колонки справочника). До этого бланк был спрятан в раскрытие строки, а
//     на экране стояли четыре колонки.
//   • Индикатор — точка слева от названия: зелёная «сдано», красная «не
//     сдано». Источник — СДАЧА САМОГО УПРАВЛЕНИЯ (`currentSubmission`), а не
//     серверный светофор `traffic-light/tree`: его цвет каскадный — худший по
//     поддереву, а отделы день не сдают (сдаёт управление, [РАСХ-РШ-02]), и
//     светофор красит управление красным даже после сдачи (замерено на стенде
//     12.09.2026: управление №3 сдало v1, узел — RED). Цвет никогда не
//     единственный сигнал: рядом подпись словами.
//   • Раскрытие управления — отделы вторым уровнем со своими числами, под
//     отделом — люди по статусам (решение заказчика: имена по раскрытию).
//   • Режим «Диапазон» — каждая дата отдельной плиткой, ничего не суммируется
//     между днями; щелчок по плитке открывает таблицу за этот день.
//   • Свод (`SummaryVersions`) — под таблицей, на том же экране.
//
// Числа берутся из уже приходящего расхода (`report.rows[].columns`), новых
// расчётов и ручек нет. Адрес прежний: `/employees?view=daily`.
import { useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiClient, type OpsEmployeeStatusRow } from '@/lib/api'
import { opsApiClient } from '@/lib/ops-api'
import { DAILY_EMPLOYEES_PATH, DAILY_SUBMISSIONS_PATH, currentSubmission, parseSubmissionList, type DaySubmission } from '@/entities/daily-grid'
import { formatIsoDate, formatIsoDateTime } from '@/shared/lib/date'
import { useOpsStatusTypes } from '@/hooks/use-ops-status-types'
import { useStrengthReportPeriod } from '@/hooks/use-strength-report'
import { childrenOf, descendantsOf, effectiveDailyStatus, summarizeDivision, useResponsibleDaily, type DirectorateSummary, type ResponsibleDivision } from '../model/directorate-summary'
import { SummaryVersions } from './SummaryVersions'
import styles from './responsible-daily.module.css'

export function DailyRetry({ label, onRetry, action = 'Повторить' }: { label: string; onRetry: () => unknown; action?: string }) {
  return <div role="alert" className={styles.error}><p>{label}</p><Button variant="outline" onClick={() => void onRetry()}>{action}</Button></div>
}

// ── Колонки бланка ──────────────────────────────────────────────────────────
// Порядок — по заполненному бланку заказчика (лист «Общий» `расход.xlsx`):
// Сапта · Еңбек демалысында · Іс-сапар · Ауырып · Жасаққа дейін · Жасақта ·
// Жасақтан кейін · Оқу-жиын-жарыс · Прикомандирован · Откомандирован.
// Незнакомые коды справочника идут следом в порядке сервера — колонка,
// заведённая администратором, не должна потеряться.
const BLANK_ORDER = ['VACATION', 'COMMAND', 'SICK', 'BEFORE_DUTY', 'ON_DUTY', 'AFTER_DUTY', 'TRAINING', 'ATTACHED', 'DETACHED']
const SHORT_LABELS: Record<string, string> = {
  VACATION: 'Отпуск', COMMAND: 'Команд.', SICK: 'Больн.', BEFORE_DUTY: 'Перед', ON_DUTY: 'В наряде', AFTER_DUTY: 'После',
  TRAINING: 'Сборы', ATTACHED: 'Прибыло', DETACHED: 'Убыло', OTHER: 'Иное', PENDING: 'Уточн.',
}
const GROUPS: { title: string; codes: string[] }[] = [
  { title: 'Отсутствуют', codes: ['VACATION', 'COMMAND', 'SICK'] },
  { title: 'Наряд', codes: ['BEFORE_DUTY', 'ON_DUTY', 'AFTER_DUTY'] },
  { title: 'Учёба', codes: ['TRAINING'] },
  { title: 'Командирование', codes: ['ATTACHED', 'DETACHED'] },
]

function orderColumns(serverColumns: string[], inServiceColumn: string | undefined): string[] {
  const rest = serverColumns.filter(code => code !== inServiceColumn)
  const known = BLANK_ORDER.filter(code => rest.includes(code))
  return [...known, ...rest.filter(code => !BLANK_ORDER.includes(code))]
}

function columnGroups(columns: string[]): { title: string; span: number }[] {
  const groups: { title: string; span: number }[] = []
  for (const code of columns) {
    const title = GROUPS.find(group => group.codes.includes(code))?.title ?? 'Прочее'
    const last = groups[groups.length - 1]
    if (last && last.title === title) last.span += 1
    else groups.push({ title, span: 1 })
  }
  return groups
}

function Num({ value, className }: { value: number | null; className?: string }) {
  if (value === null) return <td className={className}>—</td>
  return <td className={`${className ?? ''} ${value === 0 ? styles.zero : ''}`}>{value}</td>
}

function NumberCells({ row, columns, inServiceColumn }: { row: DirectorateSummary; columns: string[]; inServiceColumn: string | undefined }) {
  return <>
    <Num value={row.staffTotal} className={styles.gl} />
    <Num value={row.listTotal} />
    <Num value={inServiceColumn ? row.columns[inServiceColumn] ?? 0 : null} />
    <Num value={row.vacancies} />
    {columns.map((code, index) => <Num key={code} value={row.columns[code] ?? 0} className={index === 0 ? styles.gl : undefined} />)}
  </>
}

// ── Люди под отделом ────────────────────────────────────────────────────────
interface Employee { id: string; full_name: string; rank_code: string }
function People({ ids, divisionId, date, labelOf }: { ids: string[]; divisionId: string; date: string; labelOf: (code: string) => string }) {
  const catalog = useOpsStatusTypes()
  const employees = useQuery({ queryKey: ['daily-expense-board', 'responsible-people', date, ids], queryFn: async () => {
    const result: Employee[] = []
    // Daily adapter accepts at most 200 exact division IDs, not a subtree root.
    for (let offset = 0; offset < ids.length; offset += 200) {
      const query = new URLSearchParams({ business_date: date })
      ids.slice(offset, offset + 200).forEach(id => query.append('division_id', id))
      const response = await opsApiClient.get<{ results: Employee[] }>(`${DAILY_EMPLOYEES_PATH}?${query}`)
      if (!Array.isArray(response.results)) throw new Error('Некорректный ответ состава')
      result.push(...response.results)
    }
    return [...new Map(result.map(person => [person.id, person])).values()]
  } })
  // Operations status endpoint explicitly resolves division_id as a subtree.
  const statuses = useQuery({ queryKey: ['daily-expense-board', 'responsible-statuses', date, divisionId],
    queryFn: () => apiClient.getOpsStatusesOn({ businessDate: date, divisionId: Number(divisionId) }) })
  if (employees.isError || statuses.isError || catalog.isError) return <DailyRetry label="Не удалось получить сотрудников и статусы" onRetry={() => Promise.all([employees.refetch(), statuses.refetch(), catalog.refetch()])} />
  if (employees.isPending || statuses.isPending || catalog.isLoading) return <p role="status">Загрузка сотрудников…</p>
  if (employees.data.length === 0) return <p className={styles.hint}>Нет сотрудников на выбранную дату.</p>
  // Формат бланка: «статус: звание ФИО — период». В строю без отдельной
  // отметки — тоже строкой, чтобы список был полным, а не только отклонениями.
  const lines = employees.data.map(person => {
    let status: OpsEmployeeStatusRow | null | undefined
    try { status = effectiveDailyStatus(statuses.data.filter(item => item.employee_id === Number(person.id)), date, catalog.all) }
    catch { status = undefined }
    return { person, status }
  })
  const period = (status: OpsEmployeeStatusRow) => {
    const start = formatIsoDate(status.date_start), end = formatIsoDate(status.date_end)
    return start === end ? start : `${start} – ${end}`
  }
  return <div className={styles.people}>
    {lines.map(({ person, status }) => <div key={person.id} className={styles.person}>
      {status === undefined ? <span className={styles.bad}>Статус не найден в справочнике</span>
        : <span className={status ? styles.statusLabel : styles.neutral}>{status ? labelOf(status.status_type_code) : 'Без отдельной отметки: в строю'}</span>}
      <span>{person.rank_code || '—'}</span>
      <strong>{person.full_name}</strong>
      {status && <span className={styles.period}>{period(status)}</span>}
    </div>)}
  </div>
}

// ── Отдел — второй уровень ─────────────────────────────────────────────────
function SectionRow({ row, date, columns, inServiceColumn, labelOf, colSpan }: { row: DirectorateSummary; date: string; columns: string[]; inServiceColumn: string | undefined; labelOf: (code: string) => string; colSpan: number }) {
  const [open, setOpen] = useState(false)
  return <>
    <tr className={styles.dept}>
      <td className={styles.name}><button type="button" className={styles.rowbtn} aria-expanded={open} onClick={() => setOpen(!open)}><ChevronRight aria-hidden size={14} className={open ? styles.chevronOpen : ''} />{row.division.name}</button></td>
      <NumberCells row={row} columns={columns} inServiceColumn={inServiceColumn} />
    </tr>
    {open && <tr className={styles.peopleRow}><td colSpan={colSpan}><People ids={row.ids} divisionId={row.division.id} date={date} labelOf={labelOf} /></td></tr>}
  </>
}

// ── Управление — первый уровень ────────────────────────────────────────────
function Indicator({ submission, ready }: { submission: DaySubmission | null; ready: boolean }) {
  if (!ready) return <span role="img" aria-label="Сдача: неизвестно" className={`${styles.dot} ${styles.dotOff}`} title="Состояние сдачи неизвестно" />
  if (submission) return <span role="img" aria-label="Сдача: Сдано" className={`${styles.dot} ${styles.dotOk}`} title={`Сдано ${formatIsoDateTime(submission.submitted_at)} · v${submission.version}`} />
  return <span role="img" aria-label="Сдача: Не сдано" className={`${styles.dot} ${styles.dotBad}`} title="Не сдано" />
}

function DirectorateRow({ row, date, divisions, rows, submissions, columns, inServiceColumn, labelOf, submissionReady, colSpan }: {
  row: DirectorateSummary; date: string; divisions: ResponsibleDivision[]; rows: Parameters<typeof summarizeDivision>[2]; submissions: DaySubmission[]
  columns: string[]; inServiceColumn: string | undefined; labelOf: (code: string) => string; submissionReady: boolean; colSpan: number
}) {
  const [open, setOpen] = useState(false)
  const sections = useMemo(() => {
    const own = summarizeDivision(row.division, [row.division.id], rows, submissions, inServiceColumn)
    const children = childrenOf(divisions, row.division.id).map(child => summarizeDivision(child, descendantsOf(divisions, child.id), rows, submissions, inServiceColumn)).filter(child => child.listTotal + child.offList > 0)
    // Люди, числящиеся в самом управлении (не в отделе), — отдельной строкой,
    // иначе их числа есть в итоге управления, а найти их негде.
    return own.listTotal + own.offList > 0 && children.length > 0 ? [{ ...own, division: { ...own.division, name: 'Непосредственно в управлении' } }, ...children] : children.length > 0 ? children : [own]
  }, [row, divisions, rows, submissions, inServiceColumn])
  const submissionText = submissionReady ? row.submission ? `сдано ${formatIsoDateTime(row.submission.submitted_at)} · v${row.submission.version}${row.submission.late ? ' · с опозданием' : ''}` : 'не сдано' : 'сдача: неизвестно'
  return <>
    <tr className={styles.dir} aria-expanded={open}>
      <td className={styles.name}>
        <Indicator submission={row.submission} ready={submissionReady} />
        <button type="button" className={styles.rowbtn} aria-expanded={open} onClick={() => setOpen(!open)}><ChevronRight aria-hidden size={14} className={open ? styles.chevronOpen : ''} />{row.division.name}</button>
        <span className={`${styles.tag} ${submissionReady && !row.submission ? styles.tagBad : ''}`}>{submissionText}</span>
      </td>
      <NumberCells row={row} columns={columns} inServiceColumn={inServiceColumn} />
    </tr>
    {open && sections.map(section => <SectionRow key={section.division.id} row={section} date={date} columns={columns} inServiceColumn={inServiceColumn} labelOf={labelOf} colSpan={colSpan} />)}
  </>
}

// ── Напоминание несдавшим ──────────────────────────────────────────────────
interface ReminderResult { business_date: string; laggard_division_ids: number[]; notified_recipient_count: number; unresolved_division_ids: number[] }
function Reminder({ date, scopeId, disabled, nameOf }: { date: string; scopeId: number; disabled: boolean; nameOf: (id: number) => string }) {
  const mutation = useMutation({ mutationFn: () => opsApiClient.post<ReminderResult>('/api/operations/daily-summaries/remind/', { division_id: scopeId, business_date: date }) })
  return <div><Button variant="outline" disabled={disabled || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? 'Отправка напоминаний…' : 'Напомнить всем несдавшим'}</Button>
    {mutation.isError && <p role="alert" className={styles.error}>Напоминания не отправлены. Повторите попытку кнопкой выше.</p>}
    {mutation.data && <p role="status" className={styles.hint}>Получателей уведомлено: {mutation.data.notified_recipient_count}.{mutation.data.unresolved_division_ids.length > 0 && ` Без получателя: ${mutation.data.unresolved_division_ids.map(nameOf).join(', ')}.`}{mutation.data.laggard_division_ids.length === 0 && ' Все обязательные источники сдали.'}</p>}
  </div>
}

// ── Режим «Диапазон» ───────────────────────────────────────────────────────
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10)
}
function weekday(value: string): string { return WEEKDAYS[new Date(`${value}T00:00:00Z`).getUTCDay()] }

function RangeTiles({ from, to, activeDate, sources, divisions, scopeId, inServiceColumn, onPick }: {
  from: string; to: string; activeDate: string; sources: DirectorateSummary[]; divisions: ResponsibleDivision[]; scopeId: number; inServiceColumn: string | undefined; onPick: (date: string) => void
}) {
  // `PLAN`: диапазон ответственного смотрит вперёд (завтра и дальше), а
  // умолчание сервера `FACT` отвечает 400 на любую дату после сегодня.
  const period = useStrengthReportPeriod({ from, to }, true, 'PLAN')
  // Все сдачи области одним запросом; по датам раскладываются здесь — ручка
  // фильтрует один день, а плиток несколько.
  const submissions = useQuery({ queryKey: ['daily-expense-board', 'responsible-submissions-range', from, to], queryFn: async () => {
    const response = await opsApiClient.get<{ results: unknown[] }>(`${DAILY_SUBMISSIONS_PATH}?limit=500`)
    return parseSubmissionList(response).filter(row => row.business_date >= from && row.business_date <= to)
  } })
  if (period.isError || submissions.isError) return <DailyRetry label="Не удалось получить расход за период" onRetry={() => Promise.all([period.refetch(), submissions.refetch()])} />
  if (period.isPending || submissions.isPending) return <p role="status">Загрузка расхода за период…</p>
  const days: string[] = []
  for (let day = from; day <= to && days.length < 62; day = addDays(day, 1)) days.push(day)
  const scope = divisions.find(row => row.id === String(scopeId))
  return <div className={styles.tiles} role="list" aria-label="Расход по датам">
    {days.map(day => {
      const page = period.data.pages.find(item => item.business_date === day)
      const daySubs = submissions.data.filter(row => row.business_date === day)
      const submitted = sources.filter(row => currentSubmission(daySubs.filter(sub => sub.division_id === row.division.id)) !== null).length
      const inService = page && scope && inServiceColumn ? summarizeDivision(scope, descendantsOf(divisions, scope.id), page.rows, daySubs, inServiceColumn).columns[inServiceColumn] ?? 0 : null
      // Зелёный либо красный — как просил заказчик: день зелёный, только когда
      // сдали ВСЕ обязательные источники; серый — сдавать некому.
      const tone = sources.length === 0 ? styles.dotOff : submitted === sources.length ? styles.dotOk : styles.dotBad
      const label = sources.length === 0 ? 'сдавать некому' : submitted === sources.length ? 'все сдали' : 'сдали не все'
      return <button type="button" role="listitem" key={day} aria-pressed={day === activeDate} className={`${styles.tile} ${day === activeDate ? styles.tileActive : ''}`} onClick={() => onPick(day)}>
        <span className={styles.tileDate}><span role="img" aria-label={label} className={`${styles.dot} ${tone}`} />{weekday(day)} {formatIsoDate(day)}</span>
        <span className={styles.tileNums}>сдали <b>{submitted} из {sources.length}</b>{inService !== null && <> · в строю <b>{inService}</b></>}</span>
      </button>
    })}
  </div>
}

// ── Экран ──────────────────────────────────────────────────────────────────
export function ResponsibleDailyExpense({ businessDate: selectedDate, onBusinessDateChange }: { businessDate?: string; onBusinessDateChange: (date: string) => void }) {
  const state = useResponsibleDaily(selectedDate)
  const { businessDate: date, data, report, divisions, submissions, catalog } = state
  const router = useRouter(); const pathname = usePathname(); const searchParams = useSearchParams()
  const rangeFrom = searchParams.get('dateFrom') ?? ''; const rangeTo = searchParams.get('dateTo') ?? ''
  const rangeMode = ISO_DATE.test(rangeFrom) && ISO_DATE.test(rangeTo) && rangeFrom <= rangeTo
  const setRange = (from: string | null, to: string | null) => {
    const next = new URLSearchParams(searchParams)
    if (from && to) { next.set('dateFrom', from); next.set('dateTo', to) } else { next.delete('dateFrom'); next.delete('dateTo') }
    const query = next.toString()
    router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false })
  }
  const nameOf = (id: number) => divisions.data?.find(row => row.id === String(id))?.name ?? `Подразделение №${id}`
  const submissionReady = submissions.isSuccess && !submissions.isError
  const submitted = data?.sources.filter(row => row.submission).length ?? 0
  const inServiceColumn = catalog.all.find(row => row.code === 'IN_SERVICE')?.report_column_code
  const columns = useMemo(() => orderColumns(report.data?.columns ?? [], inServiceColumn), [report.data, inServiceColumn])
  const labels = report.data?.column_labels ?? {}
  const colSpan = 1 + 4 + columns.length
  const groups = columnGroups(columns)
  return <section aria-label="Расход департамента" className={styles.screen}>
    <div className={styles.title}>
      <div><h2>Расход{date ? ` на ${formatIsoDate(date)}` : ''}</h2><p>Соберите сдачи управлений и отправьте единый свод дежурному.</p></div>
      <div className={styles.controls}>
        <div className={styles.seg} role="group" aria-label="Режим">
          <button type="button" aria-pressed={!rangeMode} onClick={() => setRange(null, null)}>День</button>
          <button type="button" aria-pressed={rangeMode} onClick={() => date && setRange(date, addDays(date, 4))}>Диапазон</button>
        </div>
        {rangeMode
          ? <><label>С<input type="date" value={rangeFrom} onChange={event => { if (event.target.value) setRange(event.target.value, rangeTo < event.target.value ? event.target.value : rangeTo) }} /></label>
            <label>по<input type="date" value={rangeTo} onChange={event => { if (event.target.value) setRange(rangeFrom > event.target.value ? event.target.value : rangeFrom, event.target.value) }} /></label></>
          : <label>Деловая дата<input type="date" value={date ?? ''} onChange={event => { if (event.target.value) onBusinessDateChange(event.target.value) }} /></label>}
      </div>
    </div>
    {!date ? state.clock.isError ? <DailyRetry label="Не удалось получить деловую дату" onRetry={state.clock.refetch} /> : <p role="status">Загрузка даты…</p>
      : state.structureError ? <p role="alert">{state.structureError}</p>
      : report.isError || divisions.isError ? <DailyRetry label="Не удалось получить расход и структуру" onRetry={() => Promise.all([report.refetch(), divisions.refetch()])} />
      : !data ? <p role="status">Загрузка расхода…</p>
      : <>
        {rangeMode && state.scopeId != null && <div className={styles.rangeBox}>
          <RangeTiles from={rangeFrom} to={rangeTo} activeDate={date} sources={data.sources} divisions={divisions.data ?? []} scopeId={state.scopeId} inServiceColumn={inServiceColumn} onPick={onBusinessDateChange} />
          <p className={styles.hint}>Каждая дата — самостоятельный дневной срез, между днями ничего не суммируется. Щелчок по плитке открывает таблицу за этот день.</p>
        </div>}
        <div className={styles.hero}><div>{submissions.isError ? <DailyRetry label="Не удалось получить состояние сдачи" action="Повторить состояние сдачи" onRetry={submissions.refetch} /> : submissions.isPending ? <p role="status">Загрузка состояния сдачи…</p> : <><strong>Сдали {submitted} из {data.sources.length}</strong><progress aria-label="Сдача обязательных источников" max={Math.max(data.sources.length, 1)} value={submitted} /><p>{data.sources.length === 0 ? 'Нет обязательных источников с сотрудниками.' : submitted === data.sources.length ? 'Все обязательные источники сдали расход.' : `Ожидаем: ${data.sources.filter(row => !row.submission).map(row => row.division.name).join(', ')}.`}</p></> }</div>
          {state.access.hasPermission('daily_report.generate') && state.scopeId != null && <Reminder key={`${date}:${state.scopeId}`} date={date} scopeId={state.scopeId} disabled={!submissionReady || submitted === data.sources.length} nameOf={nameOf} />}
        </div>
        {catalog.isError && <DailyRetry label="Не удалось получить справочник статусов" onRetry={catalog.refetch} />}
        <dl className={styles.stats}><div><dt>По списку</dt><dd data-testid="daily-list-total">{data.total.listTotal}</dd></div><div><dt>В строю</dt><dd data-testid="daily-ready-total">{data.total.inService ?? '—'}</dd></div><div><dt>Всего отклонений</dt><dd>{data.total.deviations ?? '—'}</dd></div><div><dt>Без отдельной отметки · в строю</dt><dd>{data.total.withoutStatus}</dd></div></dl>

        <div className={styles.list}>
          <header className={styles.listHead}>
            <div><h3>Расход департамента по бланку</h3><p>Управления раскрываются до отделов и людей. Сотрудники отделов включены в своё управление.</p></div>
            <div className={styles.legend} aria-label="Обозначения">
              <span><span className={`${styles.dot} ${styles.dotOk}`} aria-hidden />сдано</span>
              <span><span className={`${styles.dot} ${styles.dotBad}`} aria-hidden />не сдано</span>
              <span><span className={`${styles.dot} ${styles.dotOff}`} aria-hidden />сдача не требуется</span>
            </div>
          </header>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.groups}>
                  <th className={`${styles.name} ${styles.gap}`} scope="colgroup" />
                  <th colSpan={4} className={styles.gl} scope="colgroup">Численность</th>
                  {groups.map((group, index) => <th key={`${group.title}-${index}`} colSpan={group.span} className={styles.gl} scope="colgroup">{group.title}</th>)}
                </tr>
                <tr className={styles.cols}>
                  <th className={styles.name} scope="col">Управление</th>
                  <th className={styles.gl} scope="col">Штат</th><th scope="col">Список</th><th scope="col">В строю</th><th scope="col">Вакансии</th>
                  {columns.map((code, index) => <th key={code} scope="col" className={index === 0 ? styles.gl : undefined} title={labels[code] ?? code}>{SHORT_LABELS[code] ?? labels[code] ?? code}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className={styles.lead}>
                  <td className={styles.name}><span role="img" aria-label="Сдача не требуется" className={`${styles.dot} ${styles.dotOff}`} /><span className={styles.leadName}>Руководство департамента</span><span className={styles.tag}>в знаменатель не входит</span></td>
                  <NumberCells row={data.direct} columns={columns} inServiceColumn={inServiceColumn} />
                </tr>
                {data.sources.map(row => <DirectorateRow key={`${date}:${row.division.id}`} row={row} date={date} divisions={divisions.data ?? []} rows={report.data?.rows ?? []} submissions={submissions.data ?? []} columns={columns} inServiceColumn={inServiceColumn} labelOf={catalog.labelOf} submissionReady={submissionReady} colSpan={colSpan} />)}
                {data.sources.length === 0 && <tr><td colSpan={colSpan} className={styles.hint}>Нет управлений с сотрудниками на выбранную дату.</td></tr>}
                <tr className={styles.total}>
                  <td className={styles.name}>ИТОГО по департаменту</td>
                  <NumberCells row={data.total} columns={columns} inServiceColumn={inServiceColumn} />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        {data.sources.some(row => row.division.division_type !== 'directorate') && <p className={styles.hint}>В список включены также прямые подразделения другого типа: они участвуют в полноте свода.</p>}
        {data.total.attached > 0 && <p className={styles.hint}>Придано сверх списка: {data.total.attached}.</p>}
        <SummaryVersions key={`${date}:${state.scopeId}`} businessDate={date} boardDivisionIds={data.sources.map(row => Number(row.division.id))} labelOfDivision={nameOf} scopeDivisionId={state.scopeId ?? undefined} />
      </>}
  </section>
}
