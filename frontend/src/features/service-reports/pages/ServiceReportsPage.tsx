// Отчётный реестр службы (§22.18-22.25, §20.32): запуск отчёта, состояния
// работы, метаданные артефакта и скачивание.
//
// ⚠️ Экран НИЧЕГО не формирует сам. §22.24 прямо запрещает «формировать
// чувствительный XLSX из уже загруженного в браузер полного массива»: и
// выборка строк, и маскирование, и сборка файла живут на сервере, а сюда
// приходят метаданные. Содержимое появляется в памяти вкладки ровно на время
// сохранения файла и не кэшируется (см. `useDownloadArtifact`).
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import {
  useCreateReportJob,
  useDownloadArtifact,
  useReportJobs,
  useReportTypes,
} from '../api/queries'
import type { ReportArtifactSummary } from '../api/pending-contracts'
import type { ReportJobState } from '../model/types'

const JOB_STATE_LABEL: Record<ReportJobState, string> = {
  PENDING: 'В очереди',
  PROCESSING: 'Формируется',
  COMPLETED: 'Готов',
  FAILED: 'Ошибка',
}

const JOB_STATE_CLASS: Record<ReportJobState, string> = {
  PENDING: 'inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-slate-600',
  PROCESSING:
    'inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800',
  COMPLETED:
    'inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-900',
  FAILED: 'inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800',
}

export function formatMoment(iso: string): string {
  const at = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  return `${(bytes / 1024).toFixed(1)} КБ`
}

/** Сохранение полученного потока файлом. Object URL живёт ровно до вызова
 * `revokeObjectURL`: §22.23 запрещает постоянную ссылку на файл где бы то ни
 * было, и временная не должна её собой заменить. */
function saveFile(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function ServiceReportsPage() {
  const typesQuery = useReportTypes()
  const jobsQuery = useReportJobs()
  const createJob = useCreateReportJob()
  const download = useDownloadArtifact((file) => saveFile(file.fileName, file.content))

  const reportType = typesQuery.data?.results[0] ?? null
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sensitive, setSensitive] = useState(false)
  const [attempt, setAttempt] = useState(1)

  const artifactsByJob = useMemo(() => {
    const map = new Map<string, ReportArtifactSummary>()
    for (const artifact of jobsQuery.data?.artifacts ?? []) map.set(artifact.reportJobId, artifact)
    return map
  }, [jobsQuery.data])

  function submit(): void {
    if (reportType === null) return
    createJob.mutate({
        reportTypeCode: reportType.reportTypeCode,
        format: 'CSV',
        from,
        to,
        sensitive,
        // §22.21 idempotencyKey: ключ определяется ПАРАМЕТРАМИ запроса, поэтому
        // повторный клик по той же форме не создаёт вторую работу. `attempt`
        // растёт только после успеха — осознанный повторный запуск тех же
        // параметров возможен, случайный дубль нет.
      idempotencyKey: `${reportType.reportTypeCode}:${from}:${to}:${sensitive ? 'S' : 'N'}:${attempt}`,
    })
    setAttempt((value) => value + 1)
  }

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Служба
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Отчёты службы</h1>
        <span className="text-sm text-muted-foreground">
          Асинхронное формирование отчётов, метаданные артефактов и выгрузка
        </span>
        <div className="mt-2">
          <Link
            className="text-sm font-semibold text-primary underline"
            to={ROUTES.serviceReportHistory}
          >
            История отчётов →
          </Link>
        </div>
      </header>

      {typesQuery.isLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
      {typesQuery.isError && (
        <p className="text-sm text-destructive">Не удалось загрузить типы отчётов.</p>
      )}

      {reportType !== null && typesQuery.data !== undefined && (
        <section
          role="group"
          aria-label="Форма запуска отчёта"
          className="mb-4 rounded-xl border bg-card p-4"
        >
          <div className="mb-1 text-sm font-semibold">{reportType.safeTitle}</div>
          <p className="mb-3 text-xs text-slate-600">{reportType.description}</p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
              Начало периода
              <Input
                type="date"
                aria-label="Начало периода"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
              Конец периода
              <Input
                type="date"
                aria-label="Конец периода"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input
                type="checkbox"
                checked={sensitive}
                disabled={!typesQuery.data.canExportSensitive}
                onChange={(event) => setSensitive(event.target.checked)}
              />
              Включить скрытые поля (sensitive export)
            </label>
            <Button
              size="sm"
              onClick={submit}
              disabled={
                createJob.isPending ||
                from === '' ||
                to === '' ||
                // Недоступность типа решил СЕРВЕР (§22.5: предел периода либо
                // срок хранения не заданы политикой) — экран её не выводит сам.
                reportType.unavailableReason !== null
              }
            >
              Сформировать отчёт
            </Button>
          </div>

          {!typesQuery.data.canExportSensitive && (
            // Причина — видимым текстом: выключенный флажок не объясняет себя.
            <p className="mt-2 text-xs text-slate-600">
              Sensitive export недоступен: нужно отдельное право выгрузки скрытых полей
              (ops.report.export_sensitive) — право формировать отчёт его не включает (§20.32).
            </p>
          )}
          {reportType.unavailableReason !== null ? (
            <p className="mt-2 text-xs text-slate-600">{reportType.unavailableReason}</p>
          ) : (
            <p className="mt-2 text-xs text-slate-600">
              Период — не длиннее {reportType.maxPeriodDays} дней (значение приходит из политики
              «Настроек», а не задано в форме). Артефакт хранится{' '}
              {typesQuery.data.retentionPolicy.retentionDays} дней (редакция политики{' '}
              {typesQuery.data.retentionPolicy.policyVersion}).
            </p>
          )}
          {createJob.error !== null && (
            <p className="mt-2 text-xs text-destructive">{createJob.error.message}</p>
          )}
        </section>
      )}

      <section className="mb-4 rounded-xl border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Работы и артефакты</h2>
        {jobsQuery.data === undefined ? (
          <p className="text-sm text-muted-foreground">Загрузка реестра…</p>
        ) : jobsQuery.data.results.length === 0 ? (
          <p className="text-sm text-muted-foreground">Отчёты ещё не запускались.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {jobsQuery.data.results.map((job) => {
              const artifact = artifactsByJob.get(job.reportJobId) ?? null
              return (
                <li key={job.reportJobId} className="rounded-lg border p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className={JOB_STATE_CLASS[job.state]}>{JOB_STATE_LABEL[job.state]}</span>
                    {/* §22.26: у чужого запуска периода в ответе нет вовсе. */}
                    <span className="text-sm font-semibold">
                      {job.parameters === null
                        ? 'период скрыт (чужой запуск)'
                        : `${job.parameters.from} — ${job.parameters.to}`}
                    </span>
                    {job.sensitive && (
                      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                        Со скрытыми полями
                      </span>
                    )}
                    {job.progressPercent !== null && job.state === 'PROCESSING' && (
                      <span className="text-[11px] text-slate-600">{job.progressPercent}%</span>
                    )}
                  </div>

                  {/* §22.21 «Success показывай только после COMPLETED и
                      получения artifactId»: до этого — ни метаданных, ни
                      кнопки скачивания, потому что скачивать нечего. */}
                  {artifact === null ? (
                    <p className="text-xs text-slate-600">
                      Артефакт ещё не сформирован — отчёт готовится на сервере.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1 text-xs text-slate-600">
                      <span>
                        Сформирован {formatMoment(artifact.generatedAt)} · редакция{' '}
                        {artifact.revision} · {formatSize(artifact.fileSize)} · контрольная сумма{' '}
                        {artifact.hash}
                      </span>
                      <span>
                        Расчёт {artifact.calculationVersion} · маскирование{' '}
                        {artifact.maskingPolicyVersion}
                      </span>
                      <span>
                        {artifact.available
                          ? `Доступен до ${formatMoment(artifact.expiresAt)}`
                          : 'Срок хранения истёк'}
                      </span>
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!artifact.available || download.isPending}
                          title={artifact.available ? undefined : 'Срок хранения истёк'}
                          onClick={() => download.mutate({ artifactId: artifact.artifactId })}
                        >
                          Скачать CSV
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {download.error !== null && (
          <p className="mt-2 text-xs text-destructive">{download.error.message}</p>
        )}
      </section>

      {typesQuery.data !== undefined && (
        <section className="rounded-xl border border-dashed bg-muted/30 p-4">
          <h2 className="mb-2 text-sm font-semibold">Что отчёт не содержит и почему</h2>
          <ul className="flex flex-col gap-2">
            {[
              ...typesQuery.data.maskedFields,
              ...typesQuery.data.unavailableFormats,
              ...typesQuery.data.unavailableArtifactFields,
            ].map((item) => (
              <li key={item.code} className="text-xs text-slate-600">
                <span className="font-semibold">{item.label}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
