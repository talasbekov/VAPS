// Разрез ряда динамики (§19.20). Проверяется ровно то, что промпт запрещает:
// соединение несопоставимых периодов одной линией и подстановка точки без
// агрегата вместо разрыва.
import { describe, expect, it } from 'vitest'
import { policyBoundaries, segmentDynamics } from './dynamics'
import type { RatingDynamicsPoint } from '../model/types'

const V1 = 'OPERATIONAL-RATING-2026.01.1'
const V2 = 'OPERATIONAL-RATING-2026.05.1'

function point(
  period: string,
  aggregateRating: number | null,
  policyVersion: string,
): RatingDynamicsPoint {
  return {
    employeeId: 'employee-1',
    period,
    periodStartsAt: `${period}-01`,
    periodEndsAt: `${period}-28`,
    aggregateRating,
    evaluationsCount: aggregateRating === null ? 1 : 5,
    policyVersion,
    dataState: aggregateRating === null ? 'INSUFFICIENT_DATA' : 'READY',
    recordedAt: `${period}-28T23:59:00+05:00`,
  }
}

describe('segmentDynamics — где линия рвётся (§19.20)', () => {
  it('точки одной методики подряд — один отрезок', () => {
    const segments = segmentDynamics([
      point('2026-03', 8.1, V1),
      point('2026-04', 7.9, V1),
      point('2026-05', 8.4, V1),
    ])
    expect(segments).toHaveLength(1)
    expect(segments[0].points.map((item) => item.period)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
    ])
  })

  it('смена методики разрывает линию — несопоставимые периоды не соединяются', () => {
    const segments = segmentDynamics([
      point('2026-03', 8.1, V1),
      point('2026-04', 7.9, V1),
      point('2026-05', 8.4, V2),
      point('2026-06', 8.6, V2),
    ])
    expect(segments.map((segment) => segment.policyVersion)).toEqual([V1, V2])
    expect(segments.map((segment) => segment.points.length)).toEqual([2, 2])
  })

  it('точка без агрегата не становится вершиной и не соединяет соседей', () => {
    const segments = segmentDynamics([
      point('2026-03', 8.1, V1),
      point('2026-04', null, V1),
      point('2026-05', 8.4, V1),
    ])
    // Один отрезок из трёх точек означал бы линию, проходящую ЧЕРЕЗ период,
    // за который агрегата не было; ноль вместо него запрещён (§19.19).
    expect(segments).toHaveLength(2)
    expect(segments.flatMap((segment) => segment.points.map((item) => item.period))).toEqual([
      '2026-03',
      '2026-05',
    ])
  })

  it('ряд без единого агрегата не даёт ни одного отрезка', () => {
    expect(segmentDynamics([point('2026-03', null, V1), point('2026-04', null, V1)])).toEqual([])
  })
})

describe('policyBoundaries — граница смены методики (§19.20)', () => {
  it('граница называет первый период НОВОЙ методики и обе редакции', () => {
    const boundaries = policyBoundaries([
      point('2026-03', 8.1, V1),
      point('2026-04', 7.9, V1),
      point('2026-05', 8.4, V2),
    ])
    expect(boundaries).toEqual([{ period: '2026-05', fromPolicyVersion: V1, toPolicyVersion: V2 }])
  })

  it('граница на периоде без агрегата всё равно существует', () => {
    // Методика могла смениться на периоде, за который данных не хватило:
    // отсутствие точки на графике не отменяет смены правил расчёта.
    const boundaries = policyBoundaries([
      point('2026-03', 8.1, V1),
      point('2026-04', null, V2),
      point('2026-05', 8.4, V2),
    ])
    expect(boundaries).toEqual([{ period: '2026-04', fromPolicyVersion: V1, toPolicyVersion: V2 }])
  })

  it('однородный ряд границ не имеет', () => {
    expect(policyBoundaries([point('2026-03', 8.1, V1), point('2026-04', 7.9, V1)])).toEqual([])
  })
})
