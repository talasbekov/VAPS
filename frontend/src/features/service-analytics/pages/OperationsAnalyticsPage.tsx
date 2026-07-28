// Аналитика ОМ (§22.13, §22.15).
//
// ⚠️ Экран не считает и не решает, что с чем сопоставимо: колонки уровня,
// строки, распределение по lifecycle, breadcrumb и карточку ОМ присылает
// сервер. §22.15 прямо запрещает смешивать «запрошено», «выделено»,
// «назначено» и «фактически участвовало» — набор колонок поэтому принадлежит
// ОТВЕТУ, а не вёрстке.
import { useSearchParams } from 'react-router'
import { Button } from '../../../shared/ui/Button'
import { useOperationsAnalytics } from '../api/queries'
import type { OpsBreadcrumbItem, OpsLevel, OpsRow } from '../model/types'

const LEVELS: readonly OpsLevel[] = ['ALL', 'OBJECT', 'EVENT', 'DIRECTION', 'POST']

/** Параметр URL, которым адресуется цель уровня. §22.15 требует стабильных ID
 * — в URL едут именно они, а не подписи. */
const LEVEL_PARAM: Record<OpsLevel, string | null> = {
  ALL: null,
  OBJECT: 'object',
  EVENT: 'event',
  DIRECTION: 'direction',
  POST: 'post',
}

export function OperationsAnalyticsPage() {
  // §22.6 «Фильтры синхронизируй с URL»: уровень детализации переживает
  // перезагрузку и делится ссылкой — §22.27 всё равно перепроверит право.
  const [searchParams, setSearchParams] = useSearchParams()
  const objectId = searchParams.get('object') ?? undefined
  const eventId = searchParams.get('event') ?? undefined
  const directionId = searchParams.get('direction') ?? undefined
  const postId = searchParams.get('post') ?? undefined

  const level: OpsLevel =
    postId !== undefined
      ? 'POST'
      : directionId !== undefined
        ? 'DIRECTION'
        : eventId !== undefined
          ? 'EVENT'
          : objectId !== undefined
            ? 'OBJECT'
            : 'ALL'

  const query = useOperationsAnalytics({ level, objectId, eventId, directionId, postId })
  const data = query.data?.data

  function goTo(target: OpsLevel, id: string | null): void {
    const next = new URLSearchParams(searchParams)
    // Уровни ниже целевого сбрасываются: путь иначе остался бы указывать на
    // пост чужого направления, и сервер отдал бы отказ вместо перехода.
    for (const item of LEVELS.slice(LEVELS.indexOf(target))) {
      const param = LEVEL_PARAM[item]
      if (param !== null) next.delete(param)
    }
    const param = LEVEL_PARAM[target]
    if (param !== null && id !== null) next.set(param, id)
    setSearchParams(next, { replace: true })
  }

  return (
    <div>
      <header className="mb-4">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Контроль
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Аналитика мероприятий</h1>
        <span className="text-sm text-muted-foreground">
          Уровень детализации, колонки и распределение по состояниям считает сервер
        </span>
      </header>

      {data !== undefined && (
        <nav aria-label="Путь детализации" className="mb-3 flex flex-wrap items-center gap-1">
          {data.breadcrumb.map((item: OpsBreadcrumbItem, index) => (
            <span key={`${item.level}:${item.id ?? 'root'}`} className="flex items-center gap-1">
              {index > 0 && <span className="text-xs text-slate-600">/</span>}
              <Button
                size="sm"
                variant={index === data.breadcrumb.length - 1 ? 'default' : 'outline'}
                onClick={() => goTo(item.level, item.id)}
              >
                {item.safeLabel}
              </Button>
            </span>
          ))}
        </nav>
      )}

      {query.error !== null && <p className="mb-4 text-sm text-destructive">{query.error.message}</p>}
      {query.isLoading && <p className="text-sm text-muted-foreground">Загрузка аналитики…</p>}

      {data !== undefined && (
        <>
          {data.lifecycleDistribution.length > 0 && (
            <section
              role="group"
              aria-label="Распределение по состояниям"
              className="mb-4 rounded-xl border bg-card p-4"
            >
              <h2 className="mb-2 text-sm font-semibold">Распределение по состояниям</h2>
              <ul className="flex flex-wrap gap-3">
                {data.lifecycleDistribution.map((bucket) => (
                  <li
                    key={bucket.stateCode}
                    className="rounded-lg border px-3 py-2 text-xs text-slate-600"
                  >
                    <span className="font-semibold">{bucket.safeLabel}</span>{' '}
                    <span className="tabular-nums">{bucket.count}</span>
                  </li>
                ))}
              </ul>
              {data.unknownLifecycleCodes.length > 0 && (
                // §22.13 «Используй только состояния из Lifecycle Registry»:
                // код вне реестра назван, а не разложен по чужим корзинам.
                <p className="mt-2 text-xs text-destructive">
                  Состояния вне Lifecycle Registry (не разложены по корзинам):{' '}
                  {data.unknownLifecycleCodes.join(', ')}
                </p>
              )}
            </section>
          )}

          {data.eventCard !== null && (
            <section
              role="group"
              aria-label="Карточка мероприятия"
              className="mb-4 rounded-xl border bg-card p-4"
            >
              <h2 className="mb-2 text-sm font-semibold">{data.eventCard.safeLabel}</h2>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr_auto_1fr]">
                {data.eventCard.facts.map((fact) => (
                  <div key={fact.code} className="contents">
                    <dt className="font-semibold text-slate-600">{fact.safeLabel}</dt>
                    <dd className={fact.unavailableReason === null ? '' : 'text-slate-600'}>
                      {fact.displayValue}
                      {fact.unavailableReason !== null && (
                        <span className="block text-[11px] text-slate-600">
                          {fact.unavailableReason}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="mb-4 rounded-xl border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Детализация</h2>
            <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="Детализация">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-slate-600">
                    <th className="py-2 pr-3 font-semibold">Строка</th>
                    {data.columns.map((column) => (
                      <th key={column.code} className="py-2 pr-3 font-semibold">
                        {column.safeLabel}
                      </th>
                    ))}
                    <th className="py-2 font-semibold">
                      <span className="sr-only">Переход</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row: OpsRow) => (
                    <tr key={row.rowId} className="border-b last:border-0">
                      <td className="py-2 pr-3">{row.safeLabel}</td>
                      {data.columns.map((column) => {
                        const cell = row.cells.find((item) => item.code === column.code)
                        return (
                          <td key={column.code} className="py-2 pr-3 tabular-nums">
                            {cell === undefined || cell.value === null ? (
                              <span
                                className="text-xs text-slate-600"
                                title={cell?.unavailableReason ?? undefined}
                              >
                                нет данных
                              </span>
                            ) : (
                              cell.value
                            )}
                          </td>
                        )
                      })}
                      <td className="py-2">
                        {row.childLevel !== null && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => goTo(row.childLevel as OpsLevel, row.rowId)}
                          >
                            Детализировать
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.rows.length === 0 && (
              <p className="mt-2 text-sm text-slate-600">
                На этом уровне строк нет — источник мероприятий недоступен либо уровень пуст.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-dashed bg-muted/30 p-4">
            <h2 className="mb-2 text-sm font-semibold">Чего в этой аналитике нет</h2>
            <ul className="flex flex-col gap-2">
              {data.unavailableMeasures.map((measure) => (
                <li key={measure.code} className="text-xs text-slate-600">
                  <span className="font-semibold">{measure.label}</span> — {measure.reason}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
