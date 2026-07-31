// Repository оперативного рейтинга: право §19.22, закрытость данных §19.21,
// методика из «Настроек» §19.19, состояния вместо нуля §19.2.
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import {
  createRatingsRepository,
  RepositoryBusinessRuleError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'
import { DYNAMICS_POINTS, EVALUATIONS, WORK_ITEMS } from './fixtures'

const VIEWER = 'rating-viewer'
const ANALYST = 'rating-analyst'
const NOBODY = 'nobody-user'
/** Оценщики сида (§19.7): задания привязаны к учётным записям, а не к экрану. */
const EVALUATOR = 'demo-event-planner'
const EVALUATOR_WITH_AGGREGATE = 'demo-recon-officer'
const BUSINESS_DATE = '2026-07-20'

/** §19.19: методика лежит в ЧУЖОМ слайсе «Настроек» — тест сеет его рукописной
 * формой (ARCH-FE-013), согласованность с реальным сидом проверяет контракт в
 * `app/`. */
const PERIOD_DAYS = 105
const MIN_EVALUATIONS = 4
const RATING_POLICY_VERSION = 'OPERATIONAL-RATING-test.1'
/** §22.17: порог безопасной агрегации — тоже policy, не константа кода. */
const MIN_GROUP = 3

function settingsSlice(
  overrides: {
    periodDays?: number | null
    minEvaluations?: number | null
    suppressionMinGroup?: number | null
  } = {},
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
  if (overrides.suppressionMinGroup !== null) {
    settings.push({
      settingCode: 'RATING.SUPPRESSION_MIN_GROUP.PARAMETER',
      sectionCode: 'RATING_POLICY',
      groupCode: 'PRIVACY',
      field: 'PARAMETER',
      value: overrides.suppressionMinGroup ?? MIN_GROUP,
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
    schema_version: 33,
    seed_version: 'test-v33',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: {
      ratings: {
        evaluations: EVALUATIONS.map((item) => ({ ...item })),
        workItems: WORK_ITEMS.map((item) => ({ ...item })),
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
    // §22.26: отчёт аналитики охраняет СВОЁ право. Аналитик здесь намеренно
    // БЕЗ `ops.rating.view_aggregate`, а держатель сводки — без аналитики:
    // иначе разделение прав было бы недемонстрируемо (обе роли у одного лица).
    { userId: ANALYST, permissions: ['ops.analytics.view'] },
    { userId: NOBODY, permissions: [] },
    // Оценщик БЕЗ права на агрегат: §19.14 «Сводка мероприятия показывается
    // только при наличии permission» иначе была бы недемонстрируема — у второго
    // оценщика право есть, у этого нет, и оба держат задания в одном событии.
    { userId: EVALUATOR, permissions: ['ops.rating.evaluate'] },
    {
      userId: EVALUATOR_WITH_AGGREGATE,
      permissions: ['ops.rating.evaluate', 'ops.rating.view_aggregate'],
    },
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

describe('аналитика рейтинга (§22.16-22.17)', () => {
  it('отчёт охраняет право АНАЛИТИКИ: держателя одной лишь сводки не пускают', async () => {
    const { repository } = await setup()
    await expect(repository.getRatingAnalytics(VIEWER)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
    await expect(repository.getRatingAnalytics(NOBODY)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
    // И наоборот: аналитик получает отчёт, не имея права на сводку.
    await expect(repository.listOperationalRatings(ANALYST)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
    expect((await repository.getRatingAnalytics(ANALYST)).figures).not.toBeNull()
  })

  it('в отчёте нет ни одной закрытой величины и ни одного участника поимённо', async () => {
    const { repository } = await setup()
    const json = JSON.stringify(await repository.getRatingAnalytics(ANALYST))
    expect(json).not.toContain('demo-event-planner')
    expect(json).not.toContain('Задержка на инструктаже')
    expect(json).not.toContain('evaluation-1')
    // §22.16 запрещает отдельного участника в общем отчёте — ни подписи, ни id.
    expect(json).not.toContain('Ерланов')
    expect(json).not.toContain('employee-1')
  })

  it('малая группа подавлена, большая рассчитана, порог берётся из «Настроек»', async () => {
    const { repository } = await setup()
    const { figures, suppressionMinGroupSize } = await repository.getRatingAnalytics(ANALYST)
    expect(suppressionMinGroupSize).toBe(MIN_GROUP)
    const groups = Object.fromEntries((figures?.groups ?? []).map((g) => [g.groupCode, g]))
    // Первое управление — четверо с агрегатом, отчёт его показывает.
    expect(groups['division-1']).toMatchObject({ state: 'READY', ratedCount: 4 })
    // Третье — двое: меньше порога, значение не считается вовсе.
    expect(groups['division-3']).toMatchObject({ state: 'SUPPRESSED', aggregateRating: null })
    // Второе — оценок в периоде ни у кого: это другое состояние, не приватность.
    expect(groups['division-2']).toMatchObject({ state: 'NO_AGGREGATE', ratedCount: 0 })
  })

  it('снижение порога в «Настройках» РАСКРЫВАЕТ подавленную группу', async () => {
    const { repository } = await setup({ settings: settingsSlice({ suppressionMinGroup: 2 }) })
    const { figures } = await repository.getRatingAnalytics(ANALYST)
    const group = figures?.groups.find((item) => item.groupCode === 'division-3')
    expect(group?.state).toBe('READY')
    expect(group?.aggregateRating).not.toBeNull()
  })

  it('без правила приватности отчёт не публикуется вовсе', async () => {
    const { repository } = await setup({ settings: settingsSlice({ suppressionMinGroup: null }) })
    const response = await repository.getRatingAnalytics(ANALYST)
    expect(response.unpublishedReason).toBe('SUPPRESSION_UNDEFINED')
    expect(response.figures).toBeNull()
  })

  it('порядок причин непубликации: функция → методика → приватность', async () => {
    const disabled = await (await setup({ operationalRatings: false })).repository.getRatingAnalytics(
      ANALYST,
    )
    expect(disabled.unpublishedReason).toBe('FEATURE_DISABLED')
    const noPolicy = await (
      await setup({ settings: settingsSlice({ minEvaluations: null }) })
    ).repository.getRatingAnalytics(ANALYST)
    expect(noPolicy.unpublishedReason).toBe('POLICY_UNDEFINED')
  })

  it('исправленные оценки приходят количеством, а не записями', async () => {
    const { repository } = await setup()
    const { figures } = await repository.getRatingAnalytics(ANALYST)
    // В сиде ровно одна вытесненная исправлением оценка.
    expect(figures?.correctedEvaluations).toBe(1)
  })
})

describe('рабочее пространство оценивания (§19.7, §19.14)', () => {
  it('без права оценивания задания не отдаются', async () => {
    const { repository } = await setup()
    await expect(repository.getEvaluationWorkspace(VIEWER, null)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })

  it('очередь отбирается по ОЦЕНЩИКУ: чужие задания в ответ не попадают', async () => {
    const { repository } = await setup()
    const mine = await repository.getEvaluationWorkspace(EVALUATOR, 'event-1')
    const ids = mine.pending.map((item) => item.id)
    // work-item-6 — задание другого оценщика в том же мероприятии.
    expect(ids).not.toContain('work-item-6')
    expect(ids).toEqual(['work-item-2', 'work-item-1', 'work-item-3'])
    // Порядок задаёт сервер и задаёт его по подписи участника: он НЕ совпадает
    // ни с порядком заданий в сиде, ни с порядком начальных оценок.
    expect(mine.pending.map((item) => item.targetSafeLabel)).toEqual([
      'Абишев Н.',
      'Ерланов Д.',
      'Тлеуов А.',
    ])
  })

  it('оценщик не едет наружу ни одним полем задания (§19.7)', async () => {
    const { repository } = await setup()
    const response = await repository.getEvaluationWorkspace(EVALUATOR, 'event-1')
    const json = JSON.stringify(response)
    expect(json).not.toContain('demo-event-planner')
    expect(json).not.toContain('demo-recon-officer')
    expect(json).not.toContain('evaluatorUserId')
  })

  it('«Отправленные мной» показывает СВОЮ оценку и не показывает чужую', async () => {
    const { repository } = await setup()
    const mine = await repository.getEvaluationWorkspace(EVALUATOR, 'event-1')
    expect(mine.submitted.map((item) => item.workItemId)).toEqual(['work-item-4'])
    expect(mine.submitted[0]).toMatchObject({ evaluationId: 'evaluation-21', score: 7 })
    // Чужая отправленная оценка (work-item-7 офицера рекогносцировки) не
    // попадает ни строкой, ни комментарием.
    const other = await repository.getEvaluationWorkspace(EVALUATOR_WITH_AGGREGATE, 'event-1')
    expect(other.submitted.map((item) => item.workItemId)).toEqual(['work-item-7'])
  })

  it('мероприятия — только те, где у смотрящего есть задания; отбор по event работает', async () => {
    const { repository } = await setup()
    const first = await repository.getEvaluationWorkspace(EVALUATOR, 'event-1')
    expect(first.events.map((event) => event.securityEventId)).toEqual(['event-1', 'event-2'])
    const second = await repository.getEvaluationWorkspace(EVALUATOR, 'event-2')
    expect(second.pending.map((item) => item.id)).toEqual(['work-item-5'])
    expect(second.queue).toEqual({ total: 1, submitted: 0, remaining: 1 })
    // У офицера рекогносцировки заданий во втором мероприятии нет — и самого
    // мероприятия в списке тоже нет.
    const other = await repository.getEvaluationWorkspace(EVALUATOR_WITH_AGGREGATE, null)
    expect(other.events.map((event) => event.securityEventId)).toEqual(['event-1'])
  })

  it('сводка мероприятия приходит только с правом на агрегат (§19.14)', async () => {
    const { repository } = await setup()
    const without = await repository.getEvaluationWorkspace(EVALUATOR, 'event-1')
    expect(without.eventProgress).toBeNull()
    const withPermission = await repository.getEvaluationWorkspace(
      EVALUATOR_WITH_AGGREGATE,
      'event-1',
    )
    // Сводка считает работу ВСЕХ оценщиков — оттого и охраняется отдельно.
    expect(withPermission.eventProgress).toMatchObject({
      participants: 7,
      counters: { total: 7, submitted: 2, remaining: 5 },
    })
  })

  it('выключенная функция не отдаёт заданий и называет причину (§19.3)', async () => {
    const { repository } = await setup({ operationalRatings: false })
    const response = await repository.getEvaluationWorkspace(EVALUATOR, 'event-1')
    expect(response.unavailableReason).toBe('FEATURE_DISABLED')
    expect(response.pending).toEqual([])
    expect(response.submitted).toEqual([])
    expect(response.events).toEqual([])
  })

  it('без методики оценивать МОЖНО: она управляет расчётом, а не правом оценки', async () => {
    const { repository } = await setup({ settings: null })
    const response = await repository.getEvaluationWorkspace(EVALUATOR, 'event-1')
    expect(response.policy).toBeNull()
    expect(response.unavailableReason).toBeNull()
    expect(response.pending.length).toBeGreaterThan(0)
  })
})

describe('отправка оценки (§19.7-19.10)', () => {
  const VALID = {
    score: 9,
    basisCode: 'EXECUTION_OF_DUTIES',
    basisNote: null,
    comment: null,
    revision: 1,
  }

  it('без права оценивания отправка отвергается', async () => {
    const { repository } = await setup()
    await expect(repository.submitEvaluation(VIEWER, 'work-item-1', VALID)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })

  it('чужое задание — 404, а не отказ по праву', async () => {
    const { repository } = await setup()
    // work-item-6 принадлежит другому оценщику: отказ по праву подтвердил бы,
    // что задание существует и кем-то оценивается.
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-6', VALID),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError)
  })

  it('оценка записывается, задание закрывается, и всё это переживает перечитывание', async () => {
    const { repository, adapter } = await setup()
    const result = await repository.submitEvaluation(EVALUATOR, 'work-item-1', {
      ...VALID,
      score: 6,
      comment: '  опоздание на пост  ',
    })
    expect(result.workItem).toMatchObject({ status: 'SUBMITTED', revision: 2 })
    expect(result.queue).toEqual({ total: 4, submitted: 2, remaining: 2 })

    const envelope = await adapter.load()
    const slice = envelope?.slices.ratings as {
      evaluations: { id: string; comment: string | null; evaluatorUserId: string | null }[]
      workItems: { id: string; status: string; submittedEvaluationId: string | null }[]
    }
    const created = slice.evaluations.find((item) => item.id === result.submitted.evaluationId)
    // Идентификатор сгенерировал СЕРВЕР (§19.7), комментарий сохранён обрезанным.
    expect(created).toMatchObject({ comment: 'опоздание на пост', evaluatorUserId: EVALUATOR })
    // Задание не пересоздано и не задвоено: их по-прежнему столько же.
    expect(slice.workItems).toHaveLength(WORK_ITEMS.length)
    expect(
      slice.workItems.find((item) => item.id === 'work-item-1'),
    ).toMatchObject({ status: 'SUBMITTED', submittedEvaluationId: created?.id })

    // Повторное чтение видит ту же отправленную оценку — состояние
    // repository-backed, а не жившее в ответе одной мутации.
    const reread = await repository.getEvaluationWorkspace(EVALUATOR, 'event-1')
    expect(reread.pending.map((item) => item.id)).not.toContain('work-item-1')
    expect(reread.submitted.map((item) => item.workItemId)).toContain('work-item-1')
  })

  it('новая оценка входит в агрегат — считает его СЕРВЕР, а не экран', async () => {
    const { repository } = await setup()
    const before = await repository.listOperationalRatings(VIEWER)
    const countBefore =
      before.results.find((item) => item.employeeId === 'employee-1')?.evaluationsCount ?? 0
    await repository.submitEvaluation(EVALUATOR, 'work-item-1', VALID)
    const after = await repository.listOperationalRatings(VIEWER)
    expect(after.results.find((item) => item.employeeId === 'employee-1')?.evaluationsCount).toBe(
      countBefore + 1,
    )
  })

  it('повторная отправка по тому же заданию отвергается своим кодом', async () => {
    const { repository } = await setup()
    await repository.submitEvaluation(EVALUATOR, 'work-item-1', VALID)
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, revision: 2 }),
    ).rejects.toMatchObject({ errorCode: 'EVALUATION_ALREADY_SUBMITTED' })
  })

  it('устаревшая редакция задания отвергается ДО правил формы', async () => {
    const { repository } = await setup()
    // Тело негодно сразу двумя способами: редакция старая И комментарий к
    // низкой оценке отсутствует. Ответ обязан быть про редакцию.
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', {
        ...VALID,
        score: 5,
        revision: 99,
      }),
    ).rejects.toMatchObject({ errorCode: 'EVALUATION_REVISION_MISMATCH' })
  })

  it('сервер повторяет проверку формы на СВОИХ данных (§19.9)', async () => {
    const { repository } = await setup()
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, score: 5 }),
    ).rejects.toMatchObject({ errorCode: 'COMMENT_REQUIRED' })
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, score: 0 }),
    ).rejects.toMatchObject({ errorCode: 'SCORE_OUT_OF_SCALE' })
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, basisCode: 'INVENTED' }),
    ).rejects.toMatchObject({ errorCode: 'BASIS_UNKNOWN' })
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, basisCode: 'OTHER' }),
    ).rejects.toMatchObject({ errorCode: 'BASIS_NOTE_REQUIRED' })
    // Ни одна отвергнутая попытка не оставила следа: задание всё ещё в очереди.
    const response = await repository.getEvaluationWorkspace(EVALUATOR, 'event-1')
    expect(response.pending.map((item) => item.id)).toContain('work-item-1')
  })

  it('выключенная функция не принимает оценок', async () => {
    const { repository } = await setup({ operationalRatings: false })
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', VALID),
    ).rejects.toMatchObject({ errorCode: 'RATING_DISABLED' })
  })

  it('направление и target берутся из ЗАДАНИЯ, а не из тела запроса', async () => {
    const { repository, adapter } = await setup()
    // Поля, которых в контракте тела нет: попытка подменить target и
    // направление не должна ни на что повлиять. Тело собирается как `unknown`
    // и приводится на границе — так же, как его приносит HTTP.
    const tampered = {
      ...VALID,
      targetEmployeeId: 'employee-8',
      evaluationDirection: 'SENIOR_TO_GROUP',
    } as unknown as typeof VALID
    const result = await repository.submitEvaluation(EVALUATOR, 'work-item-3', tampered)
    expect(result.submitted.evaluationDirection).toBe('EMPLOYEE_TO_SENIOR')
    const envelope = await adapter.load()
    const slice = envelope?.slices.ratings as {
      evaluations: { id: string; employeeId: string }[]
    }
    expect(
      slice.evaluations.find((item) => item.id === result.submitted.evaluationId)?.employeeId,
    ).toBe('employee-5')
  })

  it('ошибка бизнес-правила — экземпляр своего класса, а не строка', async () => {
    const { repository } = await setup()
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, score: 5 }),
    ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
  })
})
