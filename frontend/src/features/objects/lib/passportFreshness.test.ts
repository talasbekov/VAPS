// @vitest-environment node
// §21.7 — актуальность паспорта и KPI реестра. Главное, что проверяется:
// период НЕ захардкожен, а приходит политикой, и её смена меняет ответ.
import { describe, expect, it } from 'vitest'
import { buildObjectsKpi, resolveFreshness } from './passportFreshness'
import type { PassportFreshnessPolicy, SecurityObject } from '../model/types'

const POLICY: PassportFreshnessPolicy = {
  version: 'policy-v1',
  verificationIntervalDays: 120,
}

function objectWith(
  id: string,
  effectiveFrom: string | null,
  passportState: SecurityObject['passportState'] = 'GREEN',
): SecurityObject {
  return {
    id,
    name: `Объект ${id}`,
    code: id,
    type: 'Тип',
    region: 'г. Астана',
    address: 'адрес',
    objectState: 'ACTIVE',
    passportState,
    sectors: [],
    passportVersions:
      effectiveFrom === null
        ? []
        : [
            {
              id: `${id}-v1`,
              versionNumber: 1,
              effectiveFrom,
              publishedAt: `${effectiveFrom}T08:00:00+05:00`,
              publishedBy: 'seed',
              note: '',
              sectors: [],
            },
          ],
    createdAt: '2026-01-01T00:00:00+05:00',
    updatedAt: '2026-01-01T00:00:00+05:00',
  }
}

describe('resolveFreshness (§21.7)', () => {
  it('срок = дата публикации + интервал ПОЛИТИКИ, ответ несёт её версию', () => {
    const result = resolveFreshness(objectWith('a', '2026-01-01'), POLICY, '2026-02-01')
    expect(result.verificationDueAt).toBe('2026-05-01')
    expect(result.freshnessPolicyVersion).toBe('policy-v1')
    expect(result.state).toBe('FRESH')
  })

  it('смена ПОЛИТИКИ меняет и срок, и состояние — период не захардкожен', () => {
    const object = objectWith('a', '2026-01-01')
    const short = resolveFreshness(
      object,
      { version: 'policy-v2', verificationIntervalDays: 10 },
      '2026-02-01',
    )
    expect(short.verificationDueAt).toBe('2026-01-11')
    expect(short.state).toBe('OVERDUE')
    expect(short.freshnessPolicyVersion).toBe('policy-v2')
    // Тот же объект и та же дата при интервале 120 — ещё актуален.
    expect(resolveFreshness(object, POLICY, '2026-02-01').state).toBe('FRESH')
  })

  it('90 дней НЕ являются порогом: при интервале 120 паспорт 100-дневной давности актуален', () => {
    // Прямая проба на запрет §21.7 «Паспорт старше 90 дней».
    const result = resolveFreshness(objectWith('a', '2026-01-01'), POLICY, '2026-04-11')
    expect(result.state).not.toBe('OVERDUE')
  })

  it('DUE_SOON — доля интервала, а не своё число дней', () => {
    // Публикация 2026-01-01, интервал 120 → срок 2026-05-01, порог DUE_SOON —
    // 24 дня (0.2 × 120). За 61 день до срока ещё FRESH, за 20 — уже DUE_SOON.
    expect(resolveFreshness(objectWith('a', '2026-01-01'), POLICY, '2026-03-01').state).toBe('FRESH')
    expect(resolveFreshness(objectWith('a', '2026-01-01'), POLICY, '2026-04-11').state).toBe(
      'DUE_SOON',
    )
  })

  it('день срока ещё не просрочка, следующий — уже', () => {
    expect(resolveFreshness(objectWith('a', '2026-01-01'), POLICY, '2026-05-01').state).toBe(
      'DUE_SOON',
    )
    expect(resolveFreshness(objectWith('a', '2026-01-01'), POLICY, '2026-05-02').state).toBe(
      'OVERDUE',
    )
  })

  it('без публикаций — отдельное состояние, а не «просрочен»', () => {
    const result = resolveFreshness(objectWith('a', null), POLICY, '2026-05-02')
    expect(result.state).toBe('NO_PUBLISHED_VERSION')
    expect(result.verificationDueAt).toBeNull()
  })

  it('срок отсчитывается от ПОСЛЕДНЕЙ публикации, а не от первой', () => {
    const object = objectWith('a', '2026-01-01')
    object.passportVersions.push({
      id: 'a-v2',
      versionNumber: 2,
      effectiveFrom: '2026-04-01',
      publishedAt: '2026-04-01T08:00:00+05:00',
      publishedBy: 'seed',
      note: '',
      sectors: [],
    })
    expect(resolveFreshness(object, POLICY, '2026-05-02').verificationDueAt).toBe('2026-07-30')
  })
})

describe('buildObjectsKpi (§21.7)', () => {
  it('считает по ВСЕМУ переданному реестру и различает просрочку и отсутствие публикаций', () => {
    const objects = [
      // Срок 2026-05-01 — на дату среза ещё не истёк.
      objectWith('a', '2026-04-01', 'GREEN'),
      // Срок 2025-05-01 — истёк.
      objectWith('b', '2025-01-01', 'YELLOW'),
      objectWith('c', null, 'RED'),
      objectWith('d', null, 'GREEN'),
    ]
    const freshness = objects.map((object) => resolveFreshness(object, POLICY, '2026-05-02'))
    expect(buildObjectsKpi(objects, freshness)).toEqual({
      total: 4,
      passportGreen: 2,
      passportYellow: 1,
      passportRed: 1,
      verificationOverdue: 1,
      neverPublished: 2,
    })
  })
})
