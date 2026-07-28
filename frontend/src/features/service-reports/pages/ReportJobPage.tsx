// Карточка работы отчёта (§22.27 «Прямые ссылки», §22.28 «получить состояние
// job» / «получить метаданные artifact»).
//
// ⚠️ Два свойства держат этот экран, и оба серверные.
// 1. Доступ перепроверяется на КАЖДЫЙ запрос карточки: маршрут за
//    `RequirePermission`, а repository проверяет право заново и отвечает 404 на
//    работу, которой смотрящий видеть не должен (§22.27 — переход по ссылке с
//    разрешённого экрана доступ не подтверждает).
// 2. Параметры чужого запуска СЮДА НЕ ПРИЕЗЖАЮТ (§22.26): сервер вырезает их из
//    ответа, экран печатает причину. Скрывать их вёрсткой значило бы отдать их
//    браузеру — §22.27 требует, чтобы закрытых данных не было в DOM.
import { Link, useParams } from 'react-router'
import { ROUTES } from '../../../shared/routes'
import { Button } from '../../../shared/ui/Button'
import { useDownloadArtifact, useReportJob, useRerunReportJob } from '../api/queries'
import type { ReportJobAction, ReportJobState } from '../model/types'
import { formatMoment, formatSize } from './ServiceReportsPage'

const JOB_STATE_LABEL: Record<ReportJobState, string> = {
  PENDING: 'В очереди',
  PROCESSING: 'Формируется',
  COMPLETED: 'Готов',
  FAILED: 'Ошибка',
}

const ACTION_LABEL: Record<ReportJobAction['code'], string> = {
  OPEN_PARAMETERS: 'Открыть параметры',
  DOWNLOAD: 'Скачать',
  RETRY: 'Повторить',
  NEW_REVISION: 'Новая редакция',
  VIEW_ERROR: 'Посмотреть ошибку',
}

/** Действия, которые на карточке ничего не открывают: параметры и ошибка уже
 * развёрнуты — карточка и есть развёрнутая строка. Кнопка «Открыть параметры»
 * рядом с открытыми параметрами была бы действием без последствий. */
const INLINE_ACTIONS: readonly ReportJobAction['code'][] = ['OPEN_PARAMETERS', 'VIEW_ERROR']

function saveFile(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export function ReportJobPage() {
  const { reportJobId = '' } = useParams()
  const jobQuery = useReportJob(reportJobId)

  const download = useDownloadArtifact((file) => saveFile(file.fileName, file.content))
  const rerun = useRerunReportJob(() => undefined)

  if (jobQuery.error !== null) {
    // §22.27: отказ — это ВЕСЬ экран, а не бейдж поверх карточки. Ни состояния,
    // ни автора, ни времени запуска здесь нет: их у нас и не запрашивали.
    return (
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Работа недоступна</h1>
        <p className="mt-2 text-sm text-muted-foreground">{jobQuery.error.message}</p>
        <p className="mt-4">
          <Link
            className="text-sm font-semibold text-primary underline"
            to={ROUTES.serviceReportHistory}
          >
            ← История отчётов
          </Link>
        </p>
      </div>
    )
  }

  const data = jobQuery.data
  if (data === undefined) {
    return <p className="text-sm text-muted-foreground">Загрузка работы…</p>
  }

  const { job, artifact } = data
  const rerunResult = rerun.data

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Служба · Отчёты · Работа
        </p>
        <h1 className="text-2xl font-bold tracking-tight">{data.reportTypeTitle}</h1>
        <span className="text-sm text-muted-foreground">
          <span>{job.reportJobId}</span> ·{' '}
          {/* Отдельным узлом, а не соседним текстом в общем span: «чей это
              запуск» — самостоятельное утверждение, и адресоваться к нему
              должно целиком. */}
          <span>{data.isOwn ? 'ваш запуск' : 'запуск другого пользователя'}</span>
        </span>
        <div className="mt-2">
          <Link
            className="text-sm font-semibold text-primary underline"
            to={ROUTES.serviceReportHistory}
          >
            ← История отчётов
          </Link>
        </div>
      </header>

      <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Состояние работы">
        <h2 className="mb-3 text-sm font-semibold">Состояние</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="font-semibold text-slate-600">Состояние</dt>
          <dd>{JOB_STATE_LABEL[job.state]}</dd>
          <dt className="font-semibold text-slate-600">Готовность</dt>
          {/* §22.21: доля выполненного у не начатой работы — выдумка, а не ноль. */}
          <dd>{job.progressPercent === null ? 'не начата' : `${job.progressPercent}%`}</dd>
          <dt className="font-semibold text-slate-600">Сформировал</dt>
          <dd>{job.createdBy.safeLabel}</dd>
          <dt className="font-semibold text-slate-600">Создана</dt>
          <dd>{formatMoment(job.createdAt)}</dd>
          <dt className="font-semibold text-slate-600">Завершена</dt>
          <dd>{job.completedAt === null ? '—' : formatMoment(job.completedAt)}</dd>
          <dt className="font-semibold text-slate-600">Формат</dt>
          <dd>{job.format}</dd>
        </dl>
        {job.state === 'FAILED' && job.safeFailureMessage !== null && (
          <p className="mt-3 text-sm text-destructive">
            {job.failureCode}: {job.safeFailureMessage}
          </p>
        )}
      </section>

      <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Параметры запуска">
        <h2 className="mb-3 text-sm font-semibold">Параметры запуска</h2>
        {job.parameters === null ? (
          <p className="text-sm text-slate-600">{job.parametersRedactedReason}</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="font-semibold text-slate-600">Период</dt>
            <dd>
              {job.parameters.from} — {job.parameters.to} (границы включительно)
            </dd>
            <dt className="font-semibold text-slate-600">Режим выгрузки</dt>
            <dd>{job.sensitive ? 'со скрытыми полями' : 'обычный'}</dd>
            <dt className="font-semibold text-slate-600">Ключ идемпотентности</dt>
            <dd>{job.idempotencyKey}</dd>
          </dl>
        )}
      </section>

      <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Артефакт">
        <h2 className="mb-3 text-sm font-semibold">Артефакт</h2>
        {artifact === null ? (
          <p className="text-sm text-slate-600">
            Артефакта нет: он создаётся ровно при переходе работы в состояние «Готов» и больше не
            меняется (§22.22).
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="font-semibold text-slate-600">Редакция</dt>
            <dd>{artifact.revision}</dd>
            <dt className="font-semibold text-slate-600">Собран</dt>
            <dd>{formatMoment(artifact.generatedAt)}</dd>
            <dt className="font-semibold text-slate-600">Срок доступности</dt>
            <dd>
              {artifact.available ? `до ${formatMoment(artifact.expiresAt)}` : 'срок хранения истёк'}
            </dd>
            <dt className="font-semibold text-slate-600">Размер</dt>
            <dd>{formatSize(artifact.fileSize)}</dd>
            <dt className="font-semibold text-slate-600">Контрольная сумма</dt>
            <dd>{artifact.hash}</dd>
            <dt className="font-semibold text-slate-600">Версия расчёта</dt>
            <dd>{artifact.calculationVersion}</dd>
            <dt className="font-semibold text-slate-600">Версия маскирования</dt>
            <dd>{artifact.maskingPolicyVersion}</dd>
          </dl>
        )}
      </section>

      <section role="group" aria-label="Действия работы" className="mb-4">
        <div className="flex flex-wrap gap-2">
          {data.actions
            .filter((action) => !INLINE_ACTIONS.includes(action.code))
            .map((action) => (
              <Button
                key={action.code}
                size="sm"
                variant="outline"
                disabled={!action.available || download.isPending || rerun.isPending}
                title={action.reason ?? undefined}
                onClick={() => {
                  if (action.code === 'DOWNLOAD' && artifact !== null) {
                    download.mutate({ artifactId: artifact.artifactId })
                  } else if (action.code === 'RETRY' || action.code === 'NEW_REVISION') {
                    rerun.mutate({ reportJobId: job.reportJobId, mode: action.code })
                  }
                }}
              >
                {ACTION_LABEL[action.code]}
              </Button>
            ))}
        </div>
        {/* Причины отказа — не только в `title`: подсказка мыши недоступна с
            клавиатуры и скринридеру у выключенной кнопки. */}
        <ul className="mt-2 flex flex-col gap-1">
          {data.actions
            .filter((action) => !action.available && action.reason !== null)
            .map((action) => (
              <li key={action.code} className="text-xs text-slate-600">
                <span className="font-semibold">{ACTION_LABEL[action.code]}</span> — {action.reason}
              </li>
            ))}
        </ul>
        {rerun.error !== null && (
          <p className="mt-2 text-sm text-destructive">{rerun.error.message}</p>
        )}
        {download.error !== null && (
          <p className="mt-2 text-sm text-destructive">{download.error.message}</p>
        )}
        {rerunResult !== undefined && (
          <p role="status" className="mt-2 text-sm font-semibold text-primary">
            {rerunResult.reused ? (
              'Готовый артефакт с теми же параметрами уже есть — новая работа не запускалась.'
            ) : (
              <>
                Запущена новая работа.{' '}
                <Link
                  className="underline"
                  to={ROUTES.serviceReportJobTo(rerunResult.reportJobId)}
                >
                  Открыть её карточку
                </Link>
              </>
            )}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-dashed bg-muted/30 p-4">
        <h2 className="mb-2 text-sm font-semibold">Чего в этой карточке нет</h2>
        <ul className="flex flex-col gap-2">
          {[...data.unavailableBlocks, ...data.unavailableArtifactFields].map((block) => (
            <li key={block.code} className="text-xs text-slate-600">
              <span className="font-semibold">{block.label}</span> — {block.reason}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
