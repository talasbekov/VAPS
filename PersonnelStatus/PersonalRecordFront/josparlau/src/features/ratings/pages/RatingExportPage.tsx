// Экспорт оперативного рейтинга (§19.29).
//
// ЧТО ЭКРАН НЕ ДЕЛАЕТ. Он не собирает файл (содержимое приходит с сервера
// целиком), не придумывает ему имя, не строит ссылку на него и не добавляет
// собственных состояний: §19.29 «Не добавляй фиктивную ссылку на файл» и «Файл
// считается готовым только после ответа repository». Кнопка «Скачать»
// появляется, когда работа в состоянии READY и у неё ЕСТЬ артефакт, — а сам
// файл выдаёт отдельная серверная операция, повторно проверяющая право.
//
// Недоступные форматы и режимы приходят с сервера С ПРИЧИНОЙ и печатаются
// вслух: XLSX/PDF §19.29 в сборке никто не собирает, индивидуальная выгрузка
// не выдаётся вовсе (§19.21). Молча убрать их из списка значило бы оставить
// читателя думать, что экспорт сделан целиком.
import { useState } from 'react'
import {
  useCancelRatingExport,
  useCreateRatingExport,
  useDownloadRatingExport,
  useRatingExports,
} from '../api/queries'
import { newIdempotencyKey } from '../lib/idempotency'
import type { RatingExportJob, RatingExportScope } from '../model/types'

const STATE_LABEL: Record<RatingExportJob['state'], string> = {
  QUEUED: 'В очереди',
  GENERATING: 'Формируется',
  READY: 'Готов',
  FAILED: 'Ошибка',
  CANCELLED: 'Отменён',
}

const SCOPE_LABEL: Record<RatingExportScope, string> = {
  AGGREGATE: 'Агрегированная сводка',
  INDIVIDUAL: 'Индивидуальные оценки',
}

function saveFile(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function dateTime(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ru-RU')
}

export function RatingExportPage() {
  const query = useRatingExports()
  const data = query.data
  // Ключ живёт ОДИН заказ и переживает его повторные отправки (§19.26): новый
  // ключ на каждое нажатие сделал бы защиту бессмысленной ровно тогда, когда
  // она нужна, — при повторе после незамеченного ответа.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey)
  const create = useCreateRatingExport()
  const cancel = useCancelRatingExport()
  const download = useDownloadRatingExport((file) => saveFile(file.fileName, file.content))

  const artifactsByJob = new Map(
    (data?.artifacts ?? []).map((artifact) => [artifact.exportJobId, artifact]),
  )

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Охранные мероприятия
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Выгрузка рейтинга</h1>
        <span className="text-sm text-muted-foreground">
          Агрегированная сводка оперативного рейтинга. Отдельных оценок, оценщиков, комментариев и
          оснований в файле нет — он собирается из той же сводки, что и экран.
        </span>
      </header>

      {query.isLoading && <p className="text-sm text-muted-foreground">Загрузка выгрузок…</p>}
      {query.error !== null && <p className="text-sm text-destructive">{query.error.message}</p>}

      {data !== undefined && (
        <>
          <section className="mb-4 rounded-xl border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Заказать выгрузку</h2>
            {!data.capabilities.operationalRatings && (
              <p className="mb-2 text-xs text-destructive">
                Оперативный рейтинг выключен: сводки, из которой собирается файл, не существует.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {SCOPE_LABEL.AGGREGATE} · {data.formats.join(', ')}
              </span>
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={create.isPending || !data.capabilities.operationalRatings}
                onClick={() => {
                  create.mutate({ scope: 'AGGREGATE', format: 'CSV', idempotencyKey })
                  // Следующий заказ — СВОЙ ключ: иначе повтор через минуту
                  // вернул бы прежнюю работу вместо новой выгрузки.
                  setIdempotencyKey(newIdempotencyKey())
                }}
              >
                Заказать CSV
              </button>
            </div>
            {create.error !== null && (
              <p className="mt-2 text-sm text-destructive">{create.error.message}</p>
            )}
          </section>

          <section className="mb-4 overflow-hidden rounded-xl border bg-card">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Мои выгрузки рейтинга</caption>
              <thead>
                <tr>
                  {['Заказана', 'Что выгружается', 'Формат', 'Состояние', 'Файл', 'Действия'].map(
                    (title) => (
                      <th
                        key={title}
                        scope="col"
                        className="p-3 text-[11px] font-semibold text-muted-foreground"
                      >
                        {title}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.results.map((job) => {
                  const artifact = artifactsByJob.get(job.exportJobId)
                  return (
                    <tr key={job.exportJobId} className="border-t align-top">
                      <td className="p-3 text-xs tabular-nums">{dateTime(job.createdAt)}</td>
                      <td className="p-3 text-sm">{SCOPE_LABEL[job.scope]}</td>
                      <td className="p-3 text-xs">{job.format}</td>
                      <td className="p-3 text-xs">
                        {STATE_LABEL[job.state]}
                        {job.safeFailureMessage !== null && (
                          <span className="ml-1 text-muted-foreground">
                            {job.safeFailureMessage}
                          </span>
                        )}
                      </td>
                      {/* Ссылки на файл в строке нет: пока сервер не отдал
                          артефакт, показывать нечего (§19.29). */}
                      <td className="p-3 text-xs text-muted-foreground">
                        {artifact === undefined
                          ? '—'
                          : `${artifact.fileName} · строк ${artifact.rowCount}`}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {job.state === 'READY' && artifact !== undefined && (
                            <button
                              type="button"
                              className="rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
                              disabled={download.isPending}
                              onClick={() => download.mutate({ artifactId: artifact.artifactId })}
                            >
                              Скачать
                            </button>
                          )}
                          {(job.state === 'QUEUED' || job.state === 'GENERATING') && (
                            <button
                              type="button"
                              className="rounded-md border px-2.5 py-1 text-xs disabled:opacity-50"
                              disabled={cancel.isPending}
                              onClick={() => cancel.mutate({ exportJobId: job.exportJobId })}
                            >
                              Отменить
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {data.results.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">Выгрузок пока нет.</p>
            )}
          </section>

          {download.error !== null && (
            <p className="mb-4 text-sm text-destructive">{download.error.message}</p>
          )}
          {cancel.error !== null && (
            <p className="mb-4 text-sm text-destructive">{cancel.error.message}</p>
          )}

          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Что не выгружается</h2>
            <ul className="flex flex-col gap-2">
              {[...data.unavailableScopes, ...data.unavailableFormats].map((view) => (
                <li key={view.code} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{view.label}. </span>
                  {view.reason}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
