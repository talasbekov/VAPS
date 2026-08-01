// Динамика оперативного рейтинга (§19.20). Чистая модель: ни React, ни
// apiClient — тестируется в env node.
//
// ⚠️ ЗДЕСЬ НЕТ НИ ОДНОГО РАСЧЁТА АГРЕГАТА. §19.20: «не пересчитывай старые
// точки во frontend» — значения точек приходят готовыми и переносятся в
// сегменты как есть. Единственное, что делает этот модуль, — РАЗРЕЗАЕТ ряд:
// какие точки допустимо соединить одной линией, а какие нет.
//
// Границы (`policyBoundaries`) считает СЕРВЕР и присылает в ответе; та же
// функция вызывается здесь на стороне mock-сервера, а не на экране.
import type { RatingDynamicsPoint, RatingPolicyBoundary } from '../model/types'

/**
 * Отрезок однородной линии: подряд идущие точки ОДНОЙ методики, у каждой из
 * которых есть значение.
 */
export interface RatingDynamicsSegment {
  policyVersion: string
  points: RatingDynamicsPoint[]
}

/**
 * Разрез ряда на однородные отрезки. Линия рвётся в двух случаях, и оба —
 * требования §19.20, а не украшение:
 *
 * 1. сменилась `policyVersion` — «не соединяй несопоставимые периоды как одну
 *    однородную линию»;
 * 2. у точки нет агрегата (`aggregateRating === null`) — соединить соседей
 *    через неё значило бы нарисовать значение, которого не было, а положить её
 *    на ноль запрещено прямо (§19.19 «Не показывай 0,0»).
 *
 * Точки-пропуски в отрезки не попадают вовсе: их место на графике — отметка
 * «нет агрегата», а не вершина линии.
 */
export function segmentDynamics(
  points: readonly RatingDynamicsPoint[],
): RatingDynamicsSegment[] {
  const segments: RatingDynamicsSegment[] = []
  let current: RatingDynamicsSegment | null = null

  for (const point of points) {
    if (point.aggregateRating === null) {
      current = null
      continue
    }
    if (current === null || current.policyVersion !== point.policyVersion) {
      current = { policyVersion: point.policyVersion, points: [] }
      segments.push(current)
    }
    current.points.push(point)
  }

  return segments
}

/**
 * Границы смены методики. Считаются по ВСЕМУ ряду, включая точки без агрегата:
 * методика могла смениться на периоде, за который данных не хватило, — и
 * граница от этого не перестаёт существовать.
 */
export function policyBoundaries(
  points: readonly RatingDynamicsPoint[],
): RatingPolicyBoundary[] {
  const boundaries: RatingPolicyBoundary[] = []
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const point = points[index]
    if (previous.policyVersion === point.policyVersion) continue
    boundaries.push({
      period: point.period,
      fromPolicyVersion: previous.policyVersion,
      toPolicyVersion: point.policyVersion,
    })
  }
  return boundaries
}
