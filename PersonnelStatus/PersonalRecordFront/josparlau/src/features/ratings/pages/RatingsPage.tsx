// Сводный экран оперативного рейтинга (§19.4 второй маршрут, §19.19).
//
// Экран НИЧЕГО не считает: агрегат, период, методика и состояние приходят
// готовыми. §19.19 перечисляет запрещённое фронту прямым списком — среднее
// арифметическое, веса оценщиков, округление канонического значения,
// исключение исправленных оценок, период «90 дней», минимальное количество
// оценок. Здесь нет ни одной из этих операций.
//
// Чего на экране нет СОЗНАТЕЛЬНО (§22.16 «Запрещено показывать в общем
// отчёте»): отдельной оценки, оценщика, персонального комментария, количества
// низких оценок, истории изменения individual score, ТАБЛИЦЫ ЛИДЕРОВ, места
// сотрудника и места подразделения. Поэтому строки отсортированы сервером по
// подписи, а не по значению: сортировка по рейтингу и есть таблица лидеров,
// как её ни озаглавь.
import { useOperationalRatings } from '../api/queries'
import { RatingDynamicsSection } from './RatingDynamicsSection'
import { DATA_STATE_LABEL } from '../lib/rating'
import type { OperationalRatingSummary } from '../model/types'

/**
 * Печать канонического значения. Округляет СЕРВЕР (§19.19), поэтому здесь
 * только замена десятичного разделителя: `toFixed` тут был бы округлением на
 * клиенте — ровно тем, что запрещено.
 */
function aggregateLabel(summary: OperationalRatingSummary): string {
  if (summary.aggregateRating === null) return '—'
  return String(summary.aggregateRating).replace('.', ',')
}

function periodLabel(summary: OperationalRatingSummary): string {
  if (summary.periodStartsAt === null || summary.periodEndsAt === null) return '—'
  return `${summary.periodStartsAt} — ${summary.periodEndsAt}`
}

export function RatingsPage() {
  const query = useOperationalRatings()
  const data = query.data

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Охранные мероприятия
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Оперативный рейтинг</h1>
        <span className="text-sm text-muted-foreground">
          Агрегированные итоги оценивания участников мероприятий. Отдельные оценки, оценщики и
          комментарии закрыты и на сервере не запрашиваются.
        </span>
      </header>

      {query.isLoading && <p className="text-sm text-muted-foreground">Загрузка рейтинга…</p>}
      {query.error !== null && (
        <p className="text-sm text-destructive">{query.error.message}</p>
      )}

      {data !== undefined && (
        <>
          {!data.capabilities.operationalRatings && (
            <p className="mb-4 rounded-xl border bg-card p-4 text-sm">
              Оперативный рейтинг пока недоступен: функция выключена сервером
              (ENABLE_OPERATIONAL_RATINGS). Это не рейтинг «0» — оценок нет ни у кого, потому что
              их никто не выставлял.
            </p>
          )}

          <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Методика расчёта">
            {data.policy === null ? (
              <p className="text-sm">Методика расчёта не определена</p>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[auto_1fr_auto_1fr]">
                <dt className="font-semibold">Методика</dt>
                <dd className="font-mono">{data.policy.policyVersion}</dd>
                <dt className="font-semibold">Период расчёта</dt>
                <dd>{data.policy.periodDays} сут.</dd>
                <dt className="font-semibold">Минимум оценок</dt>
                <dd>{data.policy.minEvaluations}</dd>
                <dt className="font-semibold">Шкала</dt>
                <dd>1–10</dd>
              </dl>
            )}
          </section>

          <section className="mb-4 overflow-hidden rounded-xl border bg-card">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">
                Агрегированный оперативный рейтинг участников мероприятий
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="p-3 text-[11px] font-semibold text-muted-foreground">
                    Сотрудник
                  </th>
                  <th scope="col" className="p-3 text-[11px] font-semibold text-muted-foreground">
                    Агрегат
                  </th>
                  <th scope="col" className="p-3 text-[11px] font-semibold text-muted-foreground">
                    Учтено оценок
                  </th>
                  <th scope="col" className="p-3 text-[11px] font-semibold text-muted-foreground">
                    Период
                  </th>
                  <th scope="col" className="p-3 text-[11px] font-semibold text-muted-foreground">
                    Состояние
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((summary) => (
                  <tr key={summary.employeeId} className="border-t align-top">
                    <td className="p-3 text-sm font-medium">{summary.safeLabel}</td>
                    <td className="p-3 text-sm tabular-nums">{aggregateLabel(summary)}</td>
                    <td className="p-3 text-sm tabular-nums">{summary.evaluationsCount}</td>
                    <td className="p-3 text-xs text-muted-foreground">{periodLabel(summary)}</td>
                    <td className="p-3 text-xs">{DATA_STATE_LABEL[summary.dataState]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <RatingDynamicsSection />

          <section className="mb-4 rounded-xl border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Что в расчёт не входит</h2>
            <ul className="flex flex-col gap-2">
              {data.unavailableFactors.map((factor) => (
                <li key={factor.code} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{factor.label}. </span>
                  {factor.reason}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">Что не показывается</h2>
            <ul className="flex flex-col gap-2">
              {data.unavailableViews.map((view) => (
                <li key={view.code} className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{view.label}. </span>
                  {view.reason}
                </li>
              ))}
              {!data.capabilities.ratingConflicts && (
                <li className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Рейтинг при подборе на пост.{' '}
                  </span>
                  ENABLE_RATING_CONFLICTS выключен: требование `post.min_rating` в модели постов
                  отсутствует, поэтому рейтинг не участвует в проверке назначения и не создаёт
                  конфликтов (§19.3).
                </li>
              )}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
