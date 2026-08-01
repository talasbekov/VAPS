// Сборка отчёта аналитики рейтинга (§22.16-22.17): полосы распределения,
// подавление малых групп и то, чего в отчёте быть не должно.
import { describe, expect, it } from 'vitest'
import { buildRatingAnalytics } from './analytics'
import type { OperationalRatingSummary } from '../model/types'

function summary(
  employeeId: string,
  aggregateRating: number | null,
  evaluationsCount = aggregateRating === null ? 0 : 5,
): OperationalRatingSummary {
  return {
    employeeId,
    safeLabel: employeeId,
    aggregateRating,
    evaluationsCount,
    periodStartsAt: '2026-04-07',
    periodEndsAt: '2026-07-20',
    calculationPolicyVersion: 'OPERATIONAL-RATING-test.1',
    calculatedAt: '2026-07-20T08:00:00+05:00',
    dataState: aggregateRating === null ? 'INSUFFICIENT_DATA' : 'READY',
  }
}

const GROUPS = [
  { groupCode: 'g-1', safeLabel: 'Первое управление', members: ['e-1', 'e-2', 'e-3'] },
  { groupCode: 'g-2', safeLabel: 'Второе управление', members: ['e-4', 'e-5'] },
  { groupCode: 'g-3', safeLabel: 'Третье управление', members: ['e-6'] },
]

const SUMMARIES = [
  summary('e-1', 8.6),
  summary('e-2', 6.8),
  summary('e-3', 9.3),
  summary('e-4', 8.0),
  summary('e-5', 7.4),
  summary('e-6', null, 2),
]

function build(minGroupSize = 3) {
  return buildRatingAnalytics({
    summaries: SUMMARIES,
    groups: GROUPS,
    minGroupSize,
    correctedEvaluations: 1,
  })
}

describe('подавление малых групп (§22.17)', () => {
  it('группа меньше порога приходит БЕЗ значения, а не со скрытым', () => {
    const small = build().groups.find((group) => group.groupCode === 'g-2')
    expect(small).toMatchObject({ state: 'SUPPRESSED', aggregateRating: null, ratedCount: 2 })
    // Среднее по этой группе не должно оказаться в ответе НИ ОДНИМ полем:
    // 7,7 — то, что вернул бы расчёт, если бы его сделали и «просто не
    // показали».
    expect(JSON.stringify(build())).not.toContain('7.7')
  })

  it('порог приходит от policy: его снижение раскрывает ту же группу', () => {
    // Проверка не вакуумна: при пороге 2 группа обязана СТАТЬ рассчитанной —
    // иначе «подавление» было бы просто отсутствием данных.
    const small = build(2).groups.find((group) => group.groupCode === 'g-2')
    expect(small).toMatchObject({ state: 'READY', aggregateRating: 7.7 })
  })

  it('пустая группа — это НЕ подавление: состояние другое и причина другая', () => {
    const empty = build().groups.find((group) => group.groupCode === 'g-3')
    expect(empty).toMatchObject({ state: 'NO_AGGREGATE', aggregateRating: null, ratedCount: 0 })
  })

  it('общего среднего в отчёте нет: по нему подавленное значение восстанавливается', () => {
    const figures = build()
    // Среднее по всем шести (8.6+6.8+9.3+8.0+7.4)/5 = 8.02 — и любая его
    // огрублённая форма. Ищем по ВСЕМУ JSON, а не по знакомым именам полей.
    const json = JSON.stringify(figures)
    expect(json).not.toContain('8.02')
    expect(json).not.toContain('overall')
    expect(Object.keys(figures)).not.toContain('aggregateRating')
  })
})

describe('показатели отчёта (§22.16)', () => {
  it('распределение раскладывает агрегаты по полосам, восьмёрка — своя полоса', () => {
    const bands = build().distribution
    const byCode = Object.fromEntries(bands.map((band) => [band.code, band.count]))
    // 6,8 → 5,0–6,9; 7,4 → 7,0–7,9; 8,0 и 8,6 → 8,0–8,9; 9,3 → 9,0–10.
    expect(byCode).toEqual({
      BAND_BELOW_5: 0,
      BAND_5_7: 1,
      BAND_7_8: 1,
      BAND_8_9: 2,
      BAND_9_10: 1,
    })
    // Сумма полос равна числу участников с агрегатом — участник без полосы
    // означал бы дыру в границах, а участник в двух полосах — их перекрытие.
    expect(bands.reduce((acc, band) => acc + band.count, 0)).toBe(build().ratedParticipants)
  })

  it('покрытие оцениванием и «без агрегата» — РАЗНЫЕ величины', () => {
    const figures = build()
    expect(figures.ratedParticipants).toBe(5)
    // У шестого есть оценки, но агрегата нет: он покрыт оцениванием И
    // одновременно без агрегата. Одно число вместо двух скрыло бы этот случай.
    expect(figures.coveredParticipants).toBe(6)
    expect(figures.totalParticipants).toBe(6)
    expect(figures.withoutAggregate).toBe(1)
  })

  it('порядок групп задаёт подпись, а не значение — иначе это место подразделения', () => {
    const labels = build().groups.map((group) => group.safeLabel)
    expect(labels).toEqual(['Второе управление', 'Первое управление', 'Третье управление'])
    // И этот порядок НЕ совпадает с порядком по агрегату — иначе проверка была
    // бы вакуумной.
    const byRating = [...build().groups].sort(
      (a, b) => (b.aggregateRating ?? -1) - (a.aggregateRating ?? -1),
    )
    expect(byRating.map((group) => group.safeLabel)).not.toEqual(labels)
  })
})
