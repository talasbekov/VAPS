// Карточка сотрудника при праве только на агрегат (§19.17, вторая ветка).
//
// Здесь нет и не может быть отдельных оценок, оценщиков и комментариев: §19.17
// перечисляет для этой ветки ровно агрегат, количество учтённых, период,
// версию методики, дату расчёта, состояние «Недостаточно данных» и
// агрегированную динамику. Ответ API ровно из этого и состоит.
//
// Возврат ведёт на СОХРАНЁННЫЙ запрос реестра (§19.15 «после возврата из detail
// восстанавливай фильтры, страницу, выбранную строку»): он приехал параметром
// `back`, а не восстанавливается из памяти экрана, которой после перехода нет.
import { Link, useParams, useSearchParams } from 'react-router'
import { useRatingEmployeeDetail } from '../api/queries'
import { DATA_STATE_LABEL } from '../lib/rating'
import { ROUTES } from '../../../shared/routes'

export function RatingEmployeeDetailPage() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const employeeId = params.employeeId ?? null
  const query = useRatingEmployeeDetail(employeeId)
  const data = query.data
  const back = searchParams.get('back') ?? ''
  const backTo = back === '' ? ROUTES.evaluationRegistry : `${ROUTES.evaluationRegistry}?${back}`

  return (
    <div>
      <header className="mb-6">
        <p className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
          Охранные мероприятия
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Агрегированный рейтинг участника</h1>
        <Link className="text-sm underline" to={backTo}>
          Вернуться к отбору
        </Link>
      </header>

      {query.isLoading && <p className="text-sm text-muted-foreground">Загрузка карточки…</p>}
      {query.error !== null && <p className="text-sm text-destructive">{query.error.message}</p>}

      {data !== undefined && (
        <>
          <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Агрегат участника">
            <h2 className="mb-2 text-sm font-semibold">
              {data.safeLabel} · {data.unitSafeLabel}
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr_auto_1fr]">
              <dt className="font-semibold">Итоговый рейтинг</dt>
              <dd className="tabular-nums">
                {data.summary.aggregateRating === null
                  ? '—'
                  : String(data.summary.aggregateRating).replace('.', ',')}
              </dd>
              <dt className="font-semibold">Состояние</dt>
              <dd>{DATA_STATE_LABEL[data.summary.dataState]}</dd>
              <dt className="font-semibold">Учтено оценок</dt>
              <dd className="tabular-nums">{data.summary.evaluationsCount}</dd>
              <dt className="font-semibold">Период</dt>
              <dd>
                {data.summary.periodStartsAt === null
                  ? '—'
                  : `${data.summary.periodStartsAt} — ${data.summary.periodEndsAt}`}
              </dd>
              <dt className="font-semibold">Методика</dt>
              <dd className="font-mono">{data.summary.calculationPolicyVersion ?? '—'}</dd>
              <dt className="font-semibold">Рассчитано</dt>
              <dd>{data.summary.calculatedAt}</dd>
            </dl>
          </section>

          <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Агрегированная динамика">
            <h2 className="mb-2 text-sm font-semibold">Агрегированная динамика</h2>
            {data.points.length === 0 ? (
              <p className="text-xs text-muted-foreground">Закрытых периодов ещё нет.</p>
            ) : (
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">Агрегаты закрытых периодов</caption>
                <thead>
                  <tr>
                    {['Период', 'Агрегат', 'Учтено оценок', 'Методика'].map((title) => (
                      <th
                        key={title}
                        scope="col"
                        className="p-2 text-[11px] font-semibold text-muted-foreground"
                      >
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.points.map((point) => (
                    <tr key={point.period} className="border-t">
                      <td className="p-2 text-xs tabular-nums">{point.period}</td>
                      <td className="p-2 text-xs tabular-nums">
                        {/* Пропуск печатается прочерком, а не нулём (§19.19). */}
                        {point.aggregateRating === null
                          ? '—'
                          : String(point.aggregateRating).replace('.', ',')}
                      </td>
                      <td className="p-2 text-xs tabular-nums">{point.evaluationsCount}</td>
                      <td className="p-2 text-xs font-mono">{point.policyVersion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
