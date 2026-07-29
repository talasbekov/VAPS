// Repository оперативного рейтинга: право §19.22, закрытость данных §19.21,
// методика из «Настроек» §19.19, состояния вместо нуля §19.2.
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import { createRatingsRepository, RepositoryPermissionError } from './repository'
import { DYNAMICS_POINTS, EVALUATIONS } from './fixtures'

const VIEWER = 'rating-viewer'
const NOBODY = 'nobody-user'
const BUSINESS_DATE = '2026-07-20'

/** §19.19: методика лежит в ЧУЖОМ слайсе «Настроек» — тест сеет его рукописной
 * формой (ARCH-FE-013), согласованность с реальным сидом проверяет контракт в
 * `app/`. */
const PERIOD_DAYS = 105
const MIN_EVALUATIONS = 4
const RATING_POLICY_VERSION = 'OPERATIONAL-RATING-test.1'

function settingsSlice(
  overrides: { periodDays?: number | null; minEvaluations?: number | null } = {},
) {
  const periodDays = overrides.periodDays === undefined ? PERIOD_DAYS : overrides.periodDays
  const minEvaluations =
    overrides.minEvaluations === undefined ? MIN_EVALUATIONS : overrides.minEvaluations
  const settings: Record<string, unknown>[] = []
  if (periodDays !== null) {
    settings.push({
      settingCode: 'RATING.PERIOD.PARAMETER',
      sectionCode: 'RATING_POLICY',
      groupCode: 'AGGREGATION',
      field: 'PARAMETER',
      value: periodDays,
    })
  }
  if (minEvaluations !== null) {
    settings.push({
      settingCode: 'RATING.MIN_EVALUATIONS.PARAMETER',
      sectionCode: 'RATING_POLICY',
      groupCode: 'AGGREGATION',
      field: 'WARNING_FROM',
      value: minEvaluations,
    })
  }
  return { sectionVersions: { RATING_POLICY: RATING_POLICY_VERSION }, settings, changeLog: [] }
}

interface SeedOverrides {
  operationalRatings?: boolean
  settings?: unknown
}

function seedEnvelope(overrides: SeedOverrides = {}): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 32,
    seed_version: 'test-v32',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: {
      ratings: {
        evaluations: EVALUATIONS.map((item) => ({ ...item })),
        dynamicsPoints: DYNAMICS_POINTS.map((item) => ({ ...item })),
        capabilities: {
          operationalRatings: overrides.operationalRatings ?? true,
          ratingConflicts: false,
        },
      },
      ...(overrides.settings === null ? {} : { settings: overrides.settings ?? settingsSlice() }),
    },
  }
}

async function setup(overrides: SeedOverrides = {}) {
  const adapter = createMemoryPersistence()
  await adapter.reset(seedEnvelope(overrides))
  const clock = new DemoClock(`${BUSINESS_DATE}T08:00:00+05:00`)
  return { repository: createRatingsRepository(adapter, clock), adapter, clock }
}

beforeEach(() => {
  registerRbacDirectory([
    { userId: VIEWER, permissions: ['ops.rating.view_aggregate'] },
    { userId: NOBODY, permissions: [] },
  ])
})

describe('право на агрегированный рейтинг (§19.22)', () => {
  it('без своего права сводка не отдаётся', async () => {
    const { repository } = await setup()
    await expect(repository.listOperationalRatings(NOBODY)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })
})

describe('закрытость данных (§19.21)', () => {
  it('в ответе нет ни одной закрытой величины — проверяется ВЕСЬ JSON', async () => {
    const { repository } = await setup()
    const response = await repository.listOperationalRatings(VIEWER)
    const json = JSON.stringify(response)
    // Оценщик, текст комментария и идентификатор отдельной оценки — то, что
    // §19.21 закрывает. Ищем их значения ЦЕЛИКОМ по ответу, а не по знакомым
    // именам полей: производное поле несёт закрытое значение так же, как своё.
    expect(json).not.toContain('demo-event-planner')
    expect(json).not.toContain('Задержка на инструктаже')
    expect(json).not.toContain('evaluation-1')
    expect(json).not.toContain('event-1')
  })
})

describe('агрегаты и состояния (§19.19/§19.2)', () => {
  it('сводка считается сервером и подписана методикой из «Настроек»', async () => {
    const { repository } = await setup()
    const response = await repository.listOperationalRatings(VIEWER)
    const first = response.results.find((item) => item.employeeId === 'employee-1')
    // 9 + 8 + 7 + 9 + 10 = 43 при пяти учтённых (шестая вытеснена исправлением).
    expect(first).toMatchObject({
      evaluationsCount: 5,
      aggregateRating: 8.6,
      dataState: 'READY',
      calculationPolicyVersion: RATING_POLICY_VERSION,
    })
    expect(response.policy).toMatchObject({
      periodDays: PERIOD_DAYS,
      minEvaluations: MIN_EVALUATIONS,
    })
  })

  it('меньше минимума и отсутствие оценок дают состояния, а не нули', async () => {
    const { repository } = await setup()
    const { results } = await repository.listOperationalRatings(VIEWER)
    const few = results.find((item) => item.employeeId === 'employee-3')
    const none = results.find((item) => item.employeeId === 'employee-4')
    expect(few).toMatchObject({ dataState: 'INSUFFICIENT_DATA', aggregateRating: null })
    // У четвёртого оценка есть, но ВНЕ периода: счётчик обязан быть нулём, а
    // рейтинг — отсутствовать, и это разные утверждения.
    expect(none).toMatchObject({
      dataState: 'INSUFFICIENT_DATA',
      aggregateRating: null,
      evaluationsCount: 0,
    })
  })

  it('период читается из политики: его сокращение меняет состав учтённого', async () => {
    const { repository } = await setup({ settings: settingsSlice({ periodDays: 7 }) })
    const { results } = await repository.listOperationalRatings(VIEWER)
    const first = results.find((item) => item.employeeId === 'employee-1')
    // За последние 7 суток (2026-07-14…20) остаются только две оценки.
    expect(first).toMatchObject({ evaluationsCount: 2, dataState: 'INSUFFICIENT_DATA' })
    expect(first?.periodStartsAt).toBe('2026-07-14')
  })

  it('минимум читается из политики: его повышение переводит готовую сводку в «недостаточно»', async () => {
    const { repository } = await setup({ settings: settingsSlice({ minEvaluations: 6 }) })
    const { results } = await repository.listOperationalRatings(VIEWER)
    expect(results.every((item) => item.dataState === 'INSUFFICIENT_DATA')).toBe(true)
  })

  it('неполная политика — это отсутствие методики, а не половина методики', async () => {
    const { repository } = await setup({ settings: settingsSlice({ minEvaluations: null }) })
    const response = await repository.listOperationalRatings(VIEWER)
    expect(response.policy).toBeNull()
    expect(response.results.every((item) => item.dataState === 'POLICY_UNDEFINED')).toBe(true)
    expect(response.results.every((item) => item.aggregateRating === null)).toBe(true)
  })

  it('выключенная функция даёт FEATURE_DISABLED и не приписывает методику', async () => {
    const { repository } = await setup({ operationalRatings: false })
    const response = await repository.listOperationalRatings(VIEWER)
    expect(response.capabilities.operationalRatings).toBe(false)
    expect(response.policy).toBeNull()
    expect(response.results.every((item) => item.dataState === 'FEATURE_DISABLED')).toBe(true)
    expect(response.results.every((item) => item.aggregateRating === null)).toBe(true)
  })
})

describe('порядок строк (§22.16 «таблица лидеров» запрещена)', () => {
  it('строки идут по подписи, а не по значению агрегата', async () => {
    const { repository } = await setup()
    const { results } = await repository.listOperationalRatings(VIEWER)
    const labels = results.map((item) => item.safeLabel)
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'ru')))
    // И этот порядок НЕ совпадает с сортировкой по рейтингу — иначе проверка
    // была бы вакуумной: два порядка совпали бы случайно.
    const byRating = [...results].sort(
      (a, b) => (b.aggregateRating ?? -1) - (a.aggregateRating ?? -1),
    )
    expect(byRating.map((item) => item.safeLabel)).not.toEqual(labels)
  })
})

describe('динамика агрегата (§19.20)', () => {
  it('без права агрегата ряд не отдаётся — то же право, что у сводки', async () => {
    const { repository } = await setup()
    await expect(repository.getRatingDynamics(NOBODY, 'employee-1')).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })

  it('в ряду нет ни одной закрытой величины — проверяется ВЕСЬ JSON', async () => {
    const { repository } = await setup()
    const response = await repository.getRatingDynamics(VIEWER, 'employee-1')
    const json = JSON.stringify(response)
    // §19.20 «Не показывай на графике отдельные закрытые оценки»: ни оценщика,
    // ни комментария, ни идентификатора оценки в ответе быть не может.
    expect(json).not.toContain('demo-event-planner')
    expect(json).not.toContain('Задержка на инструктаже')
    expect(json).not.toContain('evaluation-1')
    expect(json).not.toContain('event-1')
  })

  it('точки отдаются как записаны и по возрастанию периода', async () => {
    const { repository } = await setup()
    const { points } = await repository.getRatingDynamics(VIEWER, 'employee-1')
    expect(points.map((item) => item.period)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06'])
    // Значения совпадают с ЗАПИСАННЫМИ, а не с пересчитанными по текущей
    // методике: оценки сида дают агрегат 8,6 за текущий период, и совпадение
    // ряда с ним означало бы пересчёт (§19.20).
    expect(points.map((item) => item.aggregateRating)).toEqual([8.1, 7.9, null, 8.6])
  })

  it('период без агрегата остаётся в ряду состоянием, а не нулём', async () => {
    const { repository } = await setup()
    const { points } = await repository.getRatingDynamics(VIEWER, 'employee-1')
    const gap = points.find((item) => item.period === '2026-05')
    expect(gap).toMatchObject({ aggregateRating: null, dataState: 'INSUFFICIENT_DATA' })
    expect(points.some((item) => item.aggregateRating === 0)).toBe(false)
  })

  it('граница смены методики приходит от сервера', async () => {
    const { repository } = await setup()
    const { boundaries } = await repository.getRatingDynamics(VIEWER, 'employee-2')
    expect(boundaries).toEqual([
      {
        period: '2026-05',
        fromPolicyVersion: 'OPERATIONAL-RATING-2026.01.1',
        toPolicyVersion: 'OPERATIONAL-RATING-2026.05.1',
      },
    ])
  })

  it('текущая методика ни одного периода не закрывала — и сервер говорит это прямо', async () => {
    const { repository } = await setup()
    const response = await repository.getRatingDynamics(VIEWER, 'employee-1')
    expect(response.currentPolicy?.policyVersion).toBe(RATING_POLICY_VERSION)
    expect(response.currentPolicyHasClosedPeriods).toBe(false)
    expect(response.points.every((item) => item.policyVersion !== RATING_POLICY_VERSION)).toBe(true)
  })

  it('ряд принадлежит выбранному сотруднику, неизвестный — первому из списка', async () => {
    const { repository } = await setup()
    const chosen = await repository.getRatingDynamics(VIEWER, 'employee-3')
    expect(chosen.employeeId).toBe('employee-3')
    expect(chosen.points.every((item) => item.employeeId === 'employee-3')).toBe(true)
    const fallback = await repository.getRatingDynamics(VIEWER, null)
    expect(fallback.employeeId).toBe('employee-1')
  })

  it('выключенная функция не отдаёт ряд вовсе', async () => {
    const { repository } = await setup({ operationalRatings: false })
    const response = await repository.getRatingDynamics(VIEWER, 'employee-1')
    expect(response.capabilities.operationalRatings).toBe(false)
    expect(response.points).toEqual([])
    expect(response.boundaries).toEqual([])
  })
})
