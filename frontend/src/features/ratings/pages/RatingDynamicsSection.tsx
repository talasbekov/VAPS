// Динамика оперативного рейтинга (§19.20).
//
// Экран НЕ считает ни одного значения: точки, их версии методики и границы
// смены методики приходят готовыми. §19.20 перечисляет запрещённое прямо —
// «не пересчитывай старые точки во frontend», «не соединяй несопоставимые
// периоды как одну однородную линию», «не показывай на графике отдельные
// закрытые оценки». Единственная геометрия здесь — перевод УЖЕ ПРИСЛАННОГО
// числа в координату.
//
// График — не единственное представление ряда: рядом стоит таблица тех же
// точек. Значение, доступное только по наведению мыши, недоступно с
// клавиатуры и в screen reader, а tooltip §19.20 обязателен именно как
// носитель версии методики.
import { useState } from 'react'
import { useRatingDynamics } from '../api/queries'
import { segmentDynamics } from '../lib/dynamics'
import { DATA_STATE_LABEL } from '../lib/rating'
import { RATING_SCALE_MAX, RATING_SCALE_MIN } from '../model/types'
import type { RatingDynamicsPoint } from '../model/types'

const VIEW_WIDTH = 640
const VIEW_HEIGHT = 220
const PAD_LEFT = 40
const PAD_RIGHT = 16
const PAD_TOP = 16
const PAD_BOTTOM = 34

/** Печать канонического значения: округляет сервер (§19.19), здесь — только
 * десятичный разделитель. */
function ratingLabel(value: number | null): string {
  if (value === null) return '—'
  return String(value).replace('.', ',')
}

function xAt(index: number, count: number): number {
  const span = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT
  if (count <= 1) return PAD_LEFT + span / 2
  return PAD_LEFT + (span * index) / (count - 1)
}

function yAt(value: number): number {
  const span = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM
  const ratio = (value - RATING_SCALE_MIN) / (RATING_SCALE_MAX - RATING_SCALE_MIN)
  return VIEW_HEIGHT - PAD_BOTTOM - span * ratio
}

/** Подпись точки — она же содержимое tooltip (§19.20 «Tooltip с версией policy»). */
function pointTitle(point: RatingDynamicsPoint): string {
  const value =
    point.aggregateRating === null
      ? DATA_STATE_LABEL[point.dataState]
      : `Агрегат ${ratingLabel(point.aggregateRating)}`
  return `${point.period}: ${value}. Учтено оценок: ${point.evaluationsCount}. Методика: ${point.policyVersion}`
}

export function RatingDynamicsSection() {
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const query = useRatingDynamics(employeeId)
  const data = query.data

  return (
    <section className="mb-4 rounded-xl border bg-card p-4" aria-labelledby="rating-dynamics-title">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="rating-dynamics-title" className="text-sm font-semibold">
            Динамика агрегата
          </h2>
          <p className="text-xs text-muted-foreground">
            Только закрытые периоды и только серверные агрегаты. Отдельные оценки на графике не
            показываются.
          </p>
        </div>
        {data !== undefined && (
          <div className="flex items-center gap-2">
            <label htmlFor="rating-dynamics-employee" className="text-xs font-semibold">
              Сотрудник
            </label>
            <select
              id="rating-dynamics-employee"
              className="rounded-lg border bg-background px-2 py-1 text-sm"
              value={data.employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            >
              {data.employees.map((employee) => (
                <option key={employee.employeeId} value={employee.employeeId}>
                  {employee.safeLabel}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {query.isLoading && <p className="text-sm text-muted-foreground">Загрузка динамики…</p>}
      {query.error !== null && <p className="text-sm text-destructive">{query.error.message}</p>}

      {data !== undefined && !data.capabilities.operationalRatings && (
        <p className="text-sm">
          Оперативный рейтинг выключен сервером — ряда точек нет. Это не «ноль по всем периодам»:
          агрегаты не рассчитывались.
        </p>
      )}

      {data !== undefined && data.capabilities.operationalRatings && data.points.length === 0 && (
        <p className="text-sm">Закрытых периодов ещё нет — строить график не по чему.</p>
      )}

      {data !== undefined && data.capabilities.operationalRatings && data.points.length > 0 && (
        <>
          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            className="mb-3 h-auto w-full"
            role="img"
            aria-label={`Динамика агрегированного рейтинга: ${data.safeLabel}. Значения перечислены в таблице ниже.`}
          >
            {[RATING_SCALE_MIN, 5, 8, RATING_SCALE_MAX].map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD_LEFT}
                  x2={VIEW_WIDTH - PAD_RIGHT}
                  y1={yAt(tick)}
                  y2={yAt(tick)}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={yAt(tick) + 4}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {tick}
                </text>
              </g>
            ))}

            {/* Границы смены методики — вертикаль и подпись. Приходят от
                сервера: экран их не выводит из соседних точек (§19.20). */}
            {data.boundaries.map((boundary) => {
              const index = data.points.findIndex((point) => point.period === boundary.period)
              if (index <= 0) return null
              const x = (xAt(index - 1, data.points.length) + xAt(index, data.points.length)) / 2
              return (
                <g key={boundary.period}>
                  <line
                    x1={x}
                    x2={x}
                    y1={PAD_TOP}
                    y2={VIEW_HEIGHT - PAD_BOTTOM}
                    className="stroke-destructive"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                  <text
                    x={x + 4}
                    y={PAD_TOP + 10}
                    className="fill-destructive text-[9px] font-semibold"
                  >
                    смена методики
                  </text>
                </g>
              )
            })}

            {/* Каждый отрезок — своя однородная линия. Разрывы намеренные:
                другая методика или отсутствующий агрегат. */}
            {segmentDynamics(data.points).map((segment) => (
              <polyline
                key={`${segment.policyVersion}-${segment.points[0].period}`}
                fill="none"
                className="stroke-primary"
                strokeWidth={2}
                points={segment.points
                  .map((point) => {
                    const index = data.points.indexOf(point)
                    return `${xAt(index, data.points.length)},${yAt(point.aggregateRating as number)}`
                  })
                  .join(' ')}
              />
            ))}

            {data.points.map((point, index) => (
              <g key={point.period}>
                {point.aggregateRating === null ? (
                  <circle
                    cx={xAt(index, data.points.length)}
                    cy={VIEW_HEIGHT - PAD_BOTTOM - 6}
                    r={4}
                    fill="none"
                    className="stroke-muted-foreground"
                    strokeWidth={1.5}
                    strokeDasharray="2 2"
                  >
                    <title>{pointTitle(point)}</title>
                  </circle>
                ) : (
                  <circle
                    cx={xAt(index, data.points.length)}
                    cy={yAt(point.aggregateRating)}
                    r={4}
                    className="fill-primary"
                  >
                    <title>{pointTitle(point)}</title>
                  </circle>
                )}
                <text
                  x={xAt(index, data.points.length)}
                  y={VIEW_HEIGHT - 10}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {point.period}
                </text>
              </g>
            ))}
          </svg>

          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Точки динамики агрегированного рейтинга: {data.safeLabel}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="p-2 text-[11px] font-semibold text-muted-foreground">
                  Период
                </th>
                <th scope="col" className="p-2 text-[11px] font-semibold text-muted-foreground">
                  Агрегат
                </th>
                <th scope="col" className="p-2 text-[11px] font-semibold text-muted-foreground">
                  Учтено оценок
                </th>
                <th scope="col" className="p-2 text-[11px] font-semibold text-muted-foreground">
                  Методика
                </th>
              </tr>
            </thead>
            <tbody>
              {data.points.map((point) => (
                <tr key={point.period} className="border-t">
                  <td className="p-2 text-sm">{point.period}</td>
                  <td className="p-2 text-sm tabular-nums">
                    {point.aggregateRating === null
                      ? DATA_STATE_LABEL[point.dataState]
                      : ratingLabel(point.aggregateRating)}
                  </td>
                  <td className="p-2 text-sm tabular-nums">{point.evaluationsCount}</td>
                  <td className="p-2 font-mono text-xs text-muted-foreground">
                    {point.policyVersion}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-3 text-xs text-muted-foreground">
            {data.boundaries.length > 0
              ? 'Периоды разных методик не соединены одной линией: их значения получены по разным правилам и сравнивать их как однородный ряд нельзя.'
              : 'Все точки ряда посчитаны по одной методике.'}
          </p>
          {data.currentPolicy !== null && !data.currentPolicyHasClosedPeriods && (
            <p className="mt-1 text-xs text-muted-foreground">
              Действующая методика{' '}
              <span className="font-mono">{data.currentPolicy.policyVersion}</span> ещё не закрывала
              ни одного периода — её точек на графике нет. Пересчитать по ней прошлые периоды
              нельзя: они закрыты по методике, действовавшей тогда.
            </p>
          )}
        </>
      )}
    </section>
  )
}
