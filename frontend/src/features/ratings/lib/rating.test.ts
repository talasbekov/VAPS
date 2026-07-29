// Расчёт агрегата §19.19: период, минимум оценок, вытесненные исправлением,
// округление и состояния вместо нуля.
import { describe, expect, it } from 'vitest'
import { buildSummary, includedEvaluations, periodStart, roundAggregate } from './rating'
import type { EventEvaluation, RatingPolicy } from '../model/types'

const POLICY: RatingPolicy = {
  periodDays: 30,
  minEvaluations: 3,
  policyVersion: 'OPERATIONAL-RATING-test.1',
}

function evaluation(overrides: Partial<EventEvaluation> = {}): EventEvaluation {
  return {
    id: 'evaluation-1',
    securityEventId: 'event-1',
    employeeId: 'employee-1',
    evaluatorUserId: 'evaluator-1',
    score: 8,
    comment: null,
    evaluatedAt: '2026-07-10',
    supersededById: null,
    ...overrides,
  }
}

const BASE = {
  employeeId: 'employee-1',
  safeLabel: 'Ерланов Д.',
  policy: POLICY,
  featureEnabled: true,
  businessDate: '2026-07-20',
  calculatedAt: '2026-07-20T08:00:00+05:00',
}

describe('период и состав учтённых оценок', () => {
  it('начало периода включает саму бизнес-дату', () => {
    // 30 суток, считая 2026-07-20: с 2026-06-21 по 2026-07-20 включительно.
    expect(periodStart('2026-07-20', 30)).toBe('2026-06-21')
    expect(periodStart('2026-07-20', 1)).toBe('2026-07-20')
  })

  it('оценка старше периода и вытесненная исправлением не учитываются', () => {
    const included = includedEvaluations(
      [
        evaluation({ id: 'a', evaluatedAt: '2026-07-19' }),
        evaluation({ id: 'b', evaluatedAt: '2026-06-20' }),
        evaluation({ id: 'c', supersededById: 'd' }),
        evaluation({ id: 'e', employeeId: 'employee-2' }),
      ],
      'employee-1',
      '2026-06-21',
      '2026-07-20',
    )
    expect(included.map((item) => item.id)).toEqual(['a'])
  })
})

describe('агрегат §19.19', () => {
  it('считается по учтённым оценкам и округляется СЕРВЕРОМ до одного знака', () => {
    const summary = buildSummary({
      ...BASE,
      evaluations: [
        evaluation({ id: 'a', score: 9 }),
        evaluation({ id: 'b', score: 8 }),
        evaluation({ id: 'c', score: 7 }),
        evaluation({ id: 'd', score: 9 }),
      ],
    })
    // 33 / 4 = 8.25 → 8.3. Значение неровное намеренно: 8.0 совпало бы со
    // «стандартной оценкой 8» и скрыло бы подмену расчёта константой.
    expect(summary.aggregateRating).toBe(8.3)
    expect(summary.evaluationsCount).toBe(4)
    expect(summary.dataState).toBe('READY')
    expect(summary.calculationPolicyVersion).toBe(POLICY.policyVersion)
  })

  it('вытесненная исправлением оценка не тянет агрегат вниз', () => {
    const evaluations = [
      evaluation({ id: 'a', score: 9 }),
      evaluation({ id: 'b', score: 9 }),
      evaluation({ id: 'c', score: 9 }),
      evaluation({ id: 'wrong', score: 1, supersededById: 'fix' }),
    ]
    const summary = buildSummary({ ...BASE, evaluations })
    expect(summary.aggregateRating).toBe(9)
    expect(summary.evaluationsCount).toBe(3)
  })

  it('оценок меньше минимума — состояние, а НЕ ноль', () => {
    const summary = buildSummary({
      ...BASE,
      evaluations: [evaluation({ id: 'a', score: 10 }), evaluation({ id: 'b', score: 10 })],
    })
    expect(summary.dataState).toBe('INSUFFICIENT_DATA')
    expect(summary.aggregateRating).toBeNull()
    // Количество остаётся видимым: «недостаточно» без числа не отвечает,
    // сколько ещё нужно.
    expect(summary.evaluationsCount).toBe(2)
  })

  it('оценок нет вовсе — тоже состояние, а не нулевой рейтинг (§19.2)', () => {
    const summary = buildSummary({ ...BASE, evaluations: [] })
    expect(summary.aggregateRating).toBeNull()
    expect(summary.dataState).toBe('INSUFFICIENT_DATA')
  })

  it('без политики агрегат не считается, а методика не приписывается', () => {
    const summary = buildSummary({
      ...BASE,
      policy: null,
      evaluations: [
        evaluation({ id: 'a', score: 9 }),
        evaluation({ id: 'b', score: 9 }),
        evaluation({ id: 'c', score: 9 }),
      ],
    })
    expect(summary.dataState).toBe('POLICY_UNDEFINED')
    expect(summary.aggregateRating).toBeNull()
    expect(summary.calculationPolicyVersion).toBeNull()
    // Периода тоже нет: он ЧАСТЬ методики, а не самостоятельное свойство.
    expect(summary.periodStartsAt).toBeNull()
  })

  it('выключенная функция отвечает РАНЬШЕ отсутствия данных', () => {
    // Оценок хватает и политика есть: состояние обязано говорить про флаг,
    // иначе человек пошёл бы искать недостающие оценки (§19.3).
    const summary = buildSummary({
      ...BASE,
      featureEnabled: false,
      evaluations: [
        evaluation({ id: 'a', score: 9 }),
        evaluation({ id: 'b', score: 9 }),
        evaluation({ id: 'c', score: 9 }),
      ],
    })
    expect(summary.dataState).toBe('FEATURE_DISABLED')
    expect(summary.aggregateRating).toBeNull()
    expect(summary.evaluationsCount).toBe(0)
    expect(summary.calculationPolicyVersion).toBeNull()
  })

  it('округление — половина вверх, и оно единственное место округления', () => {
    expect(roundAggregate(8.25)).toBe(8.3)
    expect(roundAggregate(8.24)).toBe(8.2)
    expect(roundAggregate(9)).toBe(9)
  })
})
