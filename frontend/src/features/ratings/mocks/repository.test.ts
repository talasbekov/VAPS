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
import {
  CORRECTIONS,
  DYNAMICS_POINTS,
  EVALUATIONS,
  SEED_AUDIT_ENTRIES,
  SEED_NOTIFICATIONS,
  WORK_ITEMS,
} from './fixtures'

const VIEWER = 'rating-viewer'
const ANALYST = 'rating-analyst'
const NOBODY = 'nobody-user'
/** §19.27: контролёр журнала. Право видеть журнал — не право выгружать. */
const EXPORT_AUDITOR = 'rating-export-auditor'
/** §19.29: право на выгрузку — СВОЁ. Держатель сводки (`VIEWER`) его не имеет,
 * иначе «отдельный permission» промпта был бы формальностью. */
const EXPORTER = 'rating-exporter'
/** Эталонный администратор с wildcard: на нём проверяется, что индивидуальная
 * выгрузка не выдаётся ВООБЩЕ, а не «пока не выдали право». */
const WILDCARD = 'rating-wildcard'
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
        corrections: CORRECTIONS.map((item) => ({ ...item })),
        idempotency: [],
        auditEntries: SEED_AUDIT_ENTRIES.map((item) => ({ ...item })),
        notifications: SEED_NOTIFICATIONS.map((item) => ({ ...item })),
        dynamicsPoints: DYNAMICS_POINTS.map((item) => ({ ...item })),
        exportJobs: [],
        exportArtifacts: [],
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
    { userId: EXPORTER, permissions: ['ops.rating.export'] },
    { userId: EXPORT_AUDITOR, permissions: ['ops.rating.view_audit'] },
    { userId: WILDCARD, permissions: ['*'] },
    // Оценщик БЕЗ права на агрегат: §19.14 «Сводка мероприятия показывается
    // только при наличии permission» иначе была бы недемонстрируема — у второго
    // оценщика право есть, у этого нет, и оба держат задания в одном событии.
    // §19.22 перечисляет исправление и просмотр цепочки отдельными пунктами:
    // у этого оценщика они есть, у второго — нет, и только на этой паре
    // достижимы оба отказа.
    {
      userId: EVALUATOR,
      permissions: [
        'ops.rating.evaluate',
        'ops.rating.correct',
        'ops.rating.view_correction_chain',
      ],
    },
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
    // work-item-9 несёт УЖЕ исправленную запись (`evaluation-5`), work-item-4 —
    // обычную; порядок задаёт сервер по подписи участника.
    expect(mine.submitted.map((item) => item.workItemId)).toEqual(['work-item-9', 'work-item-4'])
    expect(mine.submitted[1]).toMatchObject({ evaluationId: 'evaluation-21', score: 7 })
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
      counters: { total: 8, submitted: 3, remaining: 5 },
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

/** §19.26: у каждой ЛОГИЧЕСКОЙ операции свой ключ. Повтор с тем же ключом —
 * отдельный случай, и в тестах он задаётся явно, а не получается случайно. */
let keyCounter = 0
function nextKey(): string {
  keyCounter += 1
  return `idem-test-${keyCounter}`
}

describe('отправка оценки (§19.7-19.10)', () => {
  const VALID = {
    score: 9,
    basisCode: 'EXECUTION_OF_DUTIES',
    basisNote: null,
    comment: null,
    revision: 1,
    idempotencyKey: 'idem-submit-base',
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
    expect(result.queue).toEqual({ total: 5, submitted: 3, remaining: 2 })

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
    await repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, idempotencyKey: nextKey() })
    const after = await repository.listOperationalRatings(VIEWER)
    expect(after.results.find((item) => item.employeeId === 'employee-1')?.evaluationsCount).toBe(
      countBefore + 1,
    )
  })

  it('повторная отправка по тому же заданию отвергается своим кодом', async () => {
    const { repository } = await setup()
    await repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, idempotencyKey: nextKey() })
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, revision: 2 , idempotencyKey: nextKey() }),
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
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, score: 5 , idempotencyKey: nextKey() }),
    ).rejects.toMatchObject({ errorCode: 'COMMENT_REQUIRED' })
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, score: 0 , idempotencyKey: nextKey() }),
    ).rejects.toMatchObject({ errorCode: 'SCORE_OUT_OF_SCALE' })
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, basisCode: 'INVENTED' , idempotencyKey: nextKey() }),
    ).rejects.toMatchObject({ errorCode: 'BASIS_UNKNOWN' })
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, basisCode: 'OTHER' , idempotencyKey: nextKey() }),
    ).rejects.toMatchObject({ errorCode: 'BASIS_NOTE_REQUIRED' })
    // Ни одна отвергнутая попытка не оставила следа: задание всё ещё в очереди.
    const response = await repository.getEvaluationWorkspace(EVALUATOR, 'event-1')
    expect(response.pending.map((item) => item.id)).toContain('work-item-1')
  })

  it('выключенная функция не принимает оценок', async () => {
    const { repository } = await setup({ operationalRatings: false })
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, idempotencyKey: nextKey() }),
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
      repository.submitEvaluation(EVALUATOR, 'work-item-1', { ...VALID, score: 5 , idempotencyKey: nextKey() }),
    ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
  })
})

describe('карточка отправленной оценки (§19.17)', () => {
  it('карточка отдаётся только автору записи', async () => {
    const { repository } = await setup()
    // work-item-9 — задание организатора; офицер рекогносцировки получает 404,
    // а не отказ по праву: отказ подтвердил бы существование записи.
    await expect(
      repository.getSubmittedEvaluationDetail(EVALUATOR_WITH_AGGREGATE, 'work-item-9'),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError)
    const detail = await repository.getSubmittedEvaluationDetail(EVALUATOR, 'work-item-9')
    expect(detail.submitted.evaluationId).toBe('evaluation-5')
  })

  it('карточка несёт АКТУАЛЬНУЮ редакцию задания (§19.18 шаг 3)', async () => {
    const { repository } = await setup()
    const before = await repository.getSubmittedEvaluationDetail(EVALUATOR, 'work-item-9')
    await repository.correctEvaluation(EVALUATOR, 'work-item-9', {
      score: 10,
      basisCode: 'DISCIPLINE',
      basisNote: null,
      comment: null,
      reason: 'Учтён рапорт старшего смены',
      revision: before.workItem.revision,
      idempotencyKey: nextKey(),
    })
    const after = await repository.getSubmittedEvaluationDetail(EVALUATOR, 'work-item-9')
    expect(after.workItem.revision).toBe(before.workItem.revision + 1)
  })

  it('цепочка исправлений идёт от корня и хранит старое значение с причиной', async () => {
    const { repository } = await setup()
    const detail = await repository.getSubmittedEvaluationDetail(EVALUATOR, 'work-item-9')
    expect(detail.chain).not.toBeNull()
    expect(detail.chain?.map((link) => link.evaluationId)).toEqual([
      'evaluation-4',
      'evaluation-5',
    ])
    // Старое значение НЕ скрыто (§19.18), и рядом с ним лежит причина замещения.
    expect(detail.chain?.[0]).toMatchObject({
      score: 3,
      supersededReason: 'Оценка выставлена по ошибке не тому участнику',
      current: false,
    })
    expect(detail.chain?.[1]).toMatchObject({ score: 9, supersededReason: null, current: true })
  })

  it('без права на цепочку она НЕ приходит, а сама карточка приходит', async () => {
    const { repository } = await setup()
    const detail = await repository.getSubmittedEvaluationDetail(
      EVALUATOR_WITH_AGGREGATE,
      'work-item-7',
    )
    expect(detail.chain).toBeNull()
    expect(detail.submitted.evaluationId).toBe('evaluation-11')
    // И право исправления у него тоже отсутствует — сервер говорит это прямо,
    // а не оставляет кнопку выключенной на клиенте.
    expect(detail.canCorrect).toBe(false)
  })

  it('право исправления решает СЕРВЕР и гасится выключенной функцией', async () => {
    const { repository } = await setup()
    expect((await repository.getSubmittedEvaluationDetail(EVALUATOR, 'work-item-9')).canCorrect).toBe(
      true,
    )
    const disabled = await setup({ operationalRatings: false })
    expect(
      (await disabled.repository.getSubmittedEvaluationDetail(EVALUATOR, 'work-item-9')).canCorrect,
    ).toBe(false)
  })
})

describe('исправление оценки (§19.18)', () => {
  const VALID = {
    score: 10,
    basisCode: 'DISCIPLINE',
    basisNote: null,
    comment: null,
    reason: 'Учтён рапорт старшего смены',
    revision: 3,
    idempotencyKey: 'idem-correct-base',
  }

  it('без права исправления отвергается, даже у автора записи', async () => {
    const { repository } = await setup()
    await expect(
      repository.correctEvaluation(EVALUATOR_WITH_AGGREGATE, 'work-item-7', {
        ...VALID,
        revision: 2,
      }),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('исходная запись остаётся и лишь помечается ссылкой; создаётся НОВАЯ', async () => {
    const { repository, adapter } = await setup()
    const before = (await adapter.load())?.slices.ratings as { evaluations: unknown[] }
    const result = await repository.correctEvaluation(EVALUATOR, 'work-item-9', { ...VALID, idempotencyKey: nextKey() })
    const slice = (await adapter.load())?.slices.ratings as {
      evaluations: {
        id: string
        score: number
        supersededById: string | null
        evaluatorUserId: string | null
        employeeId: string
      }[]
      corrections: { originalEvaluationId: string; replacementEvaluationId: string; reason: string }[]
    }
    // Записей стало БОЛЬШЕ, а не столько же: правка на месте была бы стиранием.
    expect(slice.evaluations).toHaveLength(before.evaluations.length + 1)
    const original = slice.evaluations.find((item) => item.id === 'evaluation-5')
    expect(original).toMatchObject({ score: 9, supersededById: result.submitted.evaluationId })
    const replacement = slice.evaluations.find(
      (item) => item.id === result.submitted.evaluationId,
    )
    // Оценщик и target унаследованы от исходной записи — §19.18 запрещает их менять.
    expect(replacement).toMatchObject({
      score: 10,
      evaluatorUserId: EVALUATOR,
      employeeId: 'employee-1',
      supersededById: null,
    })
    expect(slice.corrections.at(-1)).toMatchObject({
      originalEvaluationId: 'evaluation-5',
      replacementEvaluationId: result.submitted.evaluationId,
      reason: 'Учтён рапорт старшего смены',
    })
  })

  it('агрегат после исправления считает СЕРВЕР и вытесненную запись не учитывает', async () => {
    const { repository } = await setup()
    const before = (await repository.listOperationalRatings(VIEWER)).results.find(
      (item) => item.employeeId === 'employee-1',
    )
    await repository.correctEvaluation(EVALUATOR, 'work-item-9', { ...VALID, idempotencyKey: nextKey() })
    const after = (await repository.listOperationalRatings(VIEWER)).results.find(
      (item) => item.employeeId === 'employee-1',
    )
    // Число учтённых НЕ выросло: замещающая запись встала на место вытесненной,
    // а не добавилась к ней.
    expect(after?.evaluationsCount).toBe(before?.evaluationsCount)
    expect(after?.aggregateRating).not.toBe(before?.aggregateRating)
  })

  it('устаревшая редакция и незаполненная причина отвергаются своими кодами', async () => {
    const { repository } = await setup()
    await expect(
      repository.correctEvaluation(EVALUATOR, 'work-item-9', { ...VALID, revision: 99 , idempotencyKey: nextKey() }),
    ).rejects.toMatchObject({ errorCode: 'EVALUATION_REVISION_MISMATCH' })
    await expect(
      repository.correctEvaluation(EVALUATOR, 'work-item-9', { ...VALID, reason: '  ' , idempotencyKey: nextKey() }),
    ).rejects.toMatchObject({ errorCode: 'CORRECTION_REASON_REQUIRED' })
    // Правило комментария повторяется и на исправлении (§19.18 шаг 7).
    await expect(
      repository.correctEvaluation(EVALUATOR, 'work-item-9', { ...VALID, score: 5 , idempotencyKey: nextKey() }),
    ).rejects.toMatchObject({ errorCode: 'COMMENT_REQUIRED' })
  })

  it('неотправленное задание исправить нельзя', async () => {
    const { repository } = await setup()
    await expect(
      repository.correctEvaluation(EVALUATOR, 'work-item-1', { ...VALID, revision: 1 , idempotencyKey: nextKey() }),
    ).rejects.toMatchObject({ errorCode: 'EVALUATION_NOT_SUBMITTED' })
  })

  it('выключенная функция не принимает исправлений', async () => {
    const { repository } = await setup({ operationalRatings: false })
    await expect(
      repository.correctEvaluation(EVALUATOR, 'work-item-9', { ...VALID, idempotencyKey: nextKey() }),
    ).rejects.toMatchObject({ errorCode: 'RATING_DISABLED' })
  })

  it('исправление исправления удлиняет цепочку, а не переписывает её', async () => {
    const { repository } = await setup()
    const first = await repository.correctEvaluation(EVALUATOR, 'work-item-9', { ...VALID, idempotencyKey: nextKey() })
    const second = await repository.correctEvaluation(EVALUATOR, 'work-item-9', {
      ...VALID,
      score: 6,
      comment: 'Подтверждено рапортом: уход с поста',
      reason: 'Повторный разбор',
      revision: 4,
    })
    expect(second.chain?.map((link) => link.score)).toEqual([3, 9, 10, 6])
    expect(second.chain?.filter((link) => link.current)).toHaveLength(1)
    expect(second.chain?.at(-1)).toMatchObject({
      evaluationId: second.submitted.evaluationId,
      current: true,
    })
    expect(first.submitted.evaluationId).not.toBe(second.submitted.evaluationId)
  })
})

describe('реестр итоговых оценок (§19.15-19.16)', () => {
  const FILTERS = {
    from: null,
    to: null,
    event: null,
    unit: null,
    employee: null,
    direction: null,
    method: null,
    correctedOnly: false,
    search: '',
    page: 1,
  } as const

  it('без права на агрегат реестр не отдаётся', async () => {
    const { repository } = await setup()
    await expect(repository.listEvaluationRegistry(NOBODY, { ...FILTERS })).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })

  it('в ответе нет ни одной закрытой величины — проверяется ВЕСЬ JSON', async () => {
    const { repository } = await setup()
    const response = await repository.listEvaluationRegistry(VIEWER, { ...FILTERS })
    const json = JSON.stringify(response)
    expect(json).not.toContain('demo-event-planner')
    expect(json).not.toContain('Задержка на инструктаже')
    // Ни значения отдельной оценки: у сеяного `employee-5` есть десятка, и
    // именно её отсутствие в JSON отличает «скрыли колонку» от «не прислали».
    expect(json).not.toContain('"score"')
    expect(json).not.toContain('basisCode')
    expect(response.columns.sensitiveDetails).toBe(false)
  })

  it('фильтры выполняет СЕРВЕР: отобранное меньше полного и содержит только своё', async () => {
    const { repository } = await setup()
    const all = await repository.listEvaluationRegistry(VIEWER, { ...FILTERS })
    const filtered = await repository.listEvaluationRegistry(VIEWER, {
      ...FILTERS,
      employee: 'employee-2',
    })
    expect(filtered.total).toBeLessThan(all.total)
    expect(filtered.results.every((row) => row.employeeId === 'employee-2')).toBe(true)
    // Период отсекает: у `employee-4` единственная запись лежит в 2025 году.
    const inPeriod = await repository.listEvaluationRegistry(VIEWER, {
      ...FILTERS,
      from: '2026-01-01',
      employee: 'employee-4',
    })
    expect(inPeriod.total).toBe(0)
  })

  it('признак исправления берётся из цепочки: видны ОБЕ записи пары', async () => {
    const { repository } = await setup()
    const corrected = await repository.listEvaluationRegistry(VIEWER, {
      ...FILTERS,
      correctedOnly: true,
    })
    // `evaluation-4` вытеснена, `evaluation-5` — её замена: обе относятся к
    // исправлению, и ни одна не определяется сравнением значений.
    expect(corrected.results.map((row) => row.rowId).sort()).toEqual([
      'row-evaluation-4',
      'row-evaluation-5',
    ])
  })

  it('страница и её счётчики считаются сервером, а порядок не совпадает с порядком по агрегату', async () => {
    const { repository } = await setup()
    const first = await repository.listEvaluationRegistry(VIEWER, { ...FILTERS })
    expect(first.results).toHaveLength(10)
    expect(first.pageCount).toBeGreaterThan(1)
    const second = await repository.listEvaluationRegistry(VIEWER, { ...FILTERS, page: 2 })
    expect(second.page).toBe(2)
    // Пересечения между страницами нет — иначе часть записей была бы недоступна.
    const ids = new Set(first.results.map((row) => row.rowId))
    expect(second.results.some((row) => ids.has(row.rowId))).toBe(false)

    // Порядок — по дате, а не по агрегату: сортировка по значению была бы
    // таблицей лидеров (§22.16).
    const byAggregate = [...first.results]
      .sort((a, b) => (b.aggregateRating ?? 0) - (a.aggregateRating ?? 0))
      .map((row) => row.rowId)
    expect(first.results.map((row) => row.rowId)).not.toEqual(byAggregate)
  })

  it('значения фильтров даёт сервер и не собирает их из текущей страницы', async () => {
    const { repository } = await setup()
    const page = await repository.listEvaluationRegistry(VIEWER, { ...FILTERS, employee: 'employee-2' })
    // Отобрана одна запись, а список сотрудников — полный: иначе автодополнение
    // показывало бы только тех, кто уже виден (§19.15).
    expect(page.results.length).toBeLessThan(page.options.employees.length)
    expect(page.options.employees).toHaveLength(8)
    expect(page.options.events.map((option) => option.value)).toEqual([
      'ОМ-2026-014',
      'ОМ-2026-015',
    ])
  })

  it('выключенная функция отдаёт пустой реестр и говорит об этом', async () => {
    const { repository } = await setup({ operationalRatings: false })
    const response = await repository.listEvaluationRegistry(VIEWER, { ...FILTERS })
    expect(response.results).toEqual([])
    expect(response.capabilities.operationalRatings).toBe(false)
    expect(response.policy).toBeNull()
  })
})

describe('карточка агрегата участника (§19.17)', () => {
  it('несёт агрегат, период, методику и точки — и ни одной отдельной оценки', async () => {
    const { repository } = await setup()
    const detail = await repository.getRatingEmployeeDetail(VIEWER, 'employee-1')
    expect(detail.summary).toMatchObject({ dataState: 'READY', evaluationsCount: 5 })
    expect(detail.points.length).toBeGreaterThan(0)
    const json = JSON.stringify(detail)
    expect(json).not.toContain('demo-event-planner')
    expect(json).not.toContain('Задержка на инструктаже')
    expect(json).not.toContain('evaluation-1')
  })

  it('неизвестный сотрудник — 404, а не первая попавшаяся карточка', async () => {
    const { repository } = await setup()
    await expect(repository.getRatingEmployeeDetail(VIEWER, 'employee-404')).rejects.toBeInstanceOf(
      RepositoryNotFoundError,
    )
  })

  it('без права на агрегат карточка не отдаётся', async () => {
    const { repository } = await setup()
    await expect(repository.getRatingEmployeeDetail(NOBODY, 'employee-1')).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })
})

describe('идемпотентность и конфликты (§19.25-19.26)', () => {
  const SUBMIT = {
    score: 9,
    basisCode: 'EXECUTION_OF_DUTIES',
    basisNote: null,
    comment: null,
    revision: 1,
    idempotencyKey: 'idem-repeat-1',
  }

  it('повтор с тем же ключом возвращает ПРЕЖНИЙ результат и не создаёт второй оценки', async () => {
    const { repository, adapter } = await setup()
    const first = await repository.submitEvaluation(EVALUATOR, 'work-item-1', SUBMIT)
    const before = (await adapter.load())?.slices.ratings as { evaluations: unknown[] }
    const second = await repository.submitEvaluation(EVALUATOR, 'work-item-1', SUBMIT)
    const after = (await adapter.load())?.slices.ratings as { evaluations: unknown[] }

    expect(second.submitted.evaluationId).toBe(first.submitted.evaluationId)
    // Записей не прибавилось — это и есть §19.26, а не «повтор не сломался».
    expect(after.evaluations).toHaveLength(before.evaluations.length)
    // И агрегат не пересчитан как новая операция: счёт учтённых тот же.
    const summary = (await repository.listOperationalRatings(VIEWER)).results.find(
      (item) => item.employeeId === 'employee-1',
    )
    expect(summary?.evaluationsCount).toBe(6)
  })

  it('повтор БЕЗ ключа (новый ключ) получает честный отказ «уже отправлено»', async () => {
    const { repository } = await setup()
    await repository.submitEvaluation(EVALUATOR, 'work-item-1', SUBMIT)
    // Разница между «тот же запрос» и «вторая отправка» — только в ключе, и
    // ответы обязаны быть разными: иначе ключ ничего не различает.
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', {
        ...SUBMIT,
        revision: 2,
        idempotencyKey: 'idem-repeat-2',
      }),
    ).rejects.toMatchObject({ errorCode: 'EVALUATION_ALREADY_SUBMITTED' })
  })

  it('ключ не хранит закрытых значений — проверяется ВЕСЬ слайс ключей', async () => {
    const { repository, adapter } = await setup()
    await repository.submitEvaluation(EVALUATOR, 'work-item-1', {
      ...SUBMIT,
      score: 5,
      comment: 'Уход с поста до смены',
      idempotencyKey: 'idem-secret-check',
    })
    const slice = (await adapter.load())?.slices.ratings as { idempotency: unknown[] }
    expect(JSON.stringify(slice.idempotency)).not.toContain('Уход с поста')
  })

  it('конфликт редакции несёт актуальную редакцию и текущие значения (§19.25)', async () => {
    const { repository } = await setup()
    await expect(
      repository.correctEvaluation(EVALUATOR, 'work-item-9', {
        score: 10,
        basisCode: 'DISCIPLINE',
        basisNote: null,
        comment: null,
        reason: 'Учтён рапорт',
        revision: 99,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toMatchObject({
      errorCode: 'EVALUATION_REVISION_MISMATCH',
      details: {
        currentRevision: 3,
        currentScore: 9,
        currentEvaluationId: 'evaluation-5',
      },
    })
  })

  it('«уже исправлена» — отдельный конфликт, а не повтор конфликта редакции', async () => {
    const { repository, adapter } = await setup()
    // Ставим редакцию задания на устаревшую запись: редакция совпадёт, а
    // запись окажется вытесненной — §19.25 требует различать эти случаи.
    await repository.correctEvaluation(EVALUATOR, 'work-item-9', {
      score: 10,
      basisCode: 'DISCIPLINE',
      basisNote: null,
      comment: null,
      reason: 'Первое исправление',
      revision: 3,
      idempotencyKey: nextKey(),
    })
    await adapter.transaction((current) => {
      const slice = current.slices.ratings as {
        workItems: { id: string; submittedEvaluationId: string | null }[]
      }
      return {
        ...current.slices,
        ratings: {
          ...slice,
          workItems: slice.workItems.map((item) =>
            item.id === 'work-item-9'
              ? { ...item, submittedEvaluationId: 'evaluation-5' }
              : item,
          ),
        },
      }
    }, '2026-07-20T09:00:00+05:00')

    await expect(
      repository.correctEvaluation(EVALUATOR, 'work-item-9', {
        score: 7,
        basisCode: 'DISCIPLINE',
        basisNote: null,
        comment: 'Разбор повторный',
        reason: 'Повторное исправление',
        revision: 4,
        idempotencyKey: nextKey(),
      }),
    ).rejects.toMatchObject({ errorCode: 'EVALUATION_ALREADY_CORRECTED' })
  })

  it('исправление тоже идемпотентно: повтор не удлиняет цепочку', async () => {
    const { repository } = await setup()
    const body = {
      score: 10,
      basisCode: 'DISCIPLINE',
      basisNote: null,
      comment: null,
      reason: 'Учтён рапорт',
      revision: 3,
      idempotencyKey: 'idem-correct-repeat',
    }
    const first = await repository.correctEvaluation(EVALUATOR, 'work-item-9', body)
    const second = await repository.correctEvaluation(EVALUATOR, 'work-item-9', body)
    expect(second.submitted.evaluationId).toBe(first.submitted.evaluationId)
    expect(second.chain).toHaveLength(first.chain?.length ?? 0)
  })
})

describe('журнал оценивания (§19.27)', () => {
  const AUDITOR = 'rating-auditor'
  const SUBMIT = {
    score: 9,
    basisCode: 'EXECUTION_OF_DUTIES',
    basisNote: null,
    comment: null,
    revision: 1,
    idempotencyKey: 'idem-audit-1',
  }

  beforeEach(() => {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.rating.view_aggregate'] },
      { userId: NOBODY, permissions: [] },
      { userId: AUDITOR, permissions: ['ops.rating.view_audit'] },
      {
        userId: EVALUATOR,
        permissions: [
          'ops.rating.evaluate',
          'ops.rating.correct',
          'ops.rating.view_correction_chain',
        ],
      },
      {
        userId: EVALUATOR_WITH_AGGREGATE,
        permissions: ['ops.rating.evaluate', 'ops.rating.view_aggregate'],
      },
    ])
  })

  it('журнал охраняет СВОЁ право: ни оценщику, ни держателю агрегата он не открыт', async () => {
    const { repository } = await setup()
    await expect(repository.listRatingAudit(EVALUATOR, 1)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
    await expect(repository.listRatingAudit(VIEWER, 1)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
    const audit = await repository.listRatingAudit(AUDITOR, 1)
    expect(audit.results.length).toBeGreaterThan(0)
  })

  it('в записях журнала нет значений оценок и комментариев — ВЕСЬ JSON', async () => {
    const { repository } = await setup()
    await repository.submitEvaluation(EVALUATOR, 'work-item-1', {
      ...SUBMIT,
      score: 4,
      comment: 'Уход с поста до смены',
    })
    const audit = await repository.listRatingAudit(AUDITOR, 1)
    const json = JSON.stringify(audit.results)
    expect(json).not.toContain('Уход с поста')
    // Ни значения оценки: «4» встречалось бы как число, поэтому ищем поле.
    expect(json).not.toContain('"score"')
    expect(json).not.toContain('comment')
  })

  it('успех пишется после commit и несёт ссылки §19.27', async () => {
    const { repository } = await setup()
    const result = await repository.submitEvaluation(EVALUATOR, 'work-item-1', SUBMIT)
    const audit = await repository.listRatingAudit(AUDITOR, 1)
    const entry = audit.results.find((item) => item.eventCode === 'EVALUATION_SUBMITTED')
    expect(entry).toMatchObject({
      outcome: 'SUCCESS',
      actorUserId: EVALUATOR,
      securityEventId: 'event-1',
      eventRunId: 'run-1',
      assignmentId: 'assignment-work-item-1',
      evaluationId: result.submitted.evaluationId,
      requestId: SUBMIT.idempotencyKey,
      revision: 2,
    })
  })

  it('изменение относительно начального — ОТДЕЛЬНОЕ событие, а не подразумеваемое', async () => {
    const { repository } = await setup()
    // Начальная оценка задания — 8; отправка девятки обязана дать два события.
    await repository.submitEvaluation(EVALUATOR, 'work-item-1', SUBMIT)
    const changed = (await repository.listRatingAudit(AUDITOR, 1)).results.filter(
      (item) => item.eventCode === 'EVALUATION_SCORE_CHANGED_FROM_INITIAL',
    )
    expect(changed).toHaveLength(1)

    // А отправка ровно начального значения второго события не создаёт.
    await repository.submitEvaluation(EVALUATOR, 'work-item-2', {
      ...SUBMIT,
      score: 8,
      idempotencyKey: 'idem-audit-initial',
    })
    const after = (await repository.listRatingAudit(AUDITOR, 1)).results.filter(
      (item) => item.eventCode === 'EVALUATION_SCORE_CHANGED_FROM_INITIAL',
    )
    expect(after).toHaveLength(1)
  })

  it('ОТКАЗ остаётся в журнале, хотя состояние откатилось', async () => {
    const { repository } = await setup()
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', {
        ...SUBMIT,
        score: 5,
        idempotencyKey: 'idem-audit-low',
      }),
    ).rejects.toMatchObject({ errorCode: 'COMMENT_REQUIRED' })

    const audit = await repository.listRatingAudit(AUDITOR, 1)
    const rejected = audit.results.find(
      (item) => item.eventCode === 'EVALUATION_LOW_SCORE_WITHOUT_COMMENT',
    )
    // §19.27 перечисляет «попытку снижения без комментария» отдельным событием:
    // если бы запись шла внутри отклонённой мутации, её стёр бы откат.
    expect(rejected).toMatchObject({ outcome: 'REJECTED', reasonCode: 'COMMENT_REQUIRED' })
    // И самой оценки при этом не появилось — журнал помнит попытку, не факт.
    const workspace = await repository.getEvaluationWorkspace(EVALUATOR, 'event-1')
    expect(workspace.pending.map((item) => item.id)).toContain('work-item-1')
  })

  it('отклонённое исправление и запрещённая попытка просмотра тоже попадают в журнал', async () => {
    const { repository } = await setup()
    await expect(
      repository.correctEvaluation(EVALUATOR, 'work-item-9', {
        score: 10,
        basisCode: 'DISCIPLINE',
        basisNote: null,
        comment: null,
        reason: 'Учтён рапорт',
        revision: 99,
        idempotencyKey: 'idem-audit-conflict',
      }),
    ).rejects.toMatchObject({ errorCode: 'EVALUATION_REVISION_MISMATCH' })
    await expect(
      repository.getSubmittedEvaluationDetail(EVALUATOR_WITH_AGGREGATE, 'work-item-9'),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError)

    const codes = (await repository.listRatingAudit(AUDITOR, 1)).results.map(
      (item) => `${item.eventCode}:${item.reasonCode ?? ''}`,
    )
    expect(codes).toContain('EVALUATION_CORRECTION_REJECTED:EVALUATION_REVISION_MISMATCH')
    expect(codes).toContain('EVALUATION_ACCESS_DENIED:FOREIGN_EVALUATION')
  })

  it('порядок — от свежего к старому, страница считается сервером', async () => {
    const { repository } = await setup()
    await repository.submitEvaluation(EVALUATOR, 'work-item-1', SUBMIT)
    const audit = await repository.listRatingAudit(AUDITOR, 1)
    const times = audit.results.map((item) => item.occurredAt)
    expect([...times].sort((a, b) => b.localeCompare(a))).toEqual(times)
    expect(audit.page).toBe(1)
    expect(audit.total).toBeGreaterThanOrEqual(3)
  })
})

describe('уведомления оценивания (§19.28)', () => {
  const SUBMIT = {
    score: 9,
    basisCode: 'EXECUTION_OF_DUTIES',
    basisNote: null,
    comment: null,
    revision: 1,
    idempotencyKey: 'idem-notify-1',
  }

  it('приходят ТОЛЬКО свои: чужое уведомление в ответ не попадает', async () => {
    const { repository } = await setup()
    const mine = await repository.listRatingNotifications(EVALUATOR)
    expect(mine.results.map((item) => item.id)).toEqual(['rating-notification-1'])
    const other = await repository.listRatingNotifications(EVALUATOR_WITH_AGGREGATE)
    expect(other.results.map((item) => item.id)).toEqual(['rating-notification-2'])
    // Посторонний не получает ничего — и это не пустая лента «пока нет», а
    // отсутствие адресованных ему записей.
    expect((await repository.listRatingNotifications(NOBODY)).results).toEqual([])
  })

  it('уведомление создаётся ПОСЛЕ commit и в той же транзакции', async () => {
    const { repository } = await setup()
    const before = (await repository.listRatingNotifications(EVALUATOR)).results.length
    // Отклонённая отправка уведомления НЕ создаёт: §19.28 «только после commit».
    await expect(
      repository.submitEvaluation(EVALUATOR, 'work-item-1', {
        ...SUBMIT,
        score: 5,
        idempotencyKey: 'idem-notify-rejected',
      }),
    ).rejects.toMatchObject({ errorCode: 'COMMENT_REQUIRED' })
    expect((await repository.listRatingNotifications(EVALUATOR)).results).toHaveLength(before)

    await repository.submitEvaluation(EVALUATOR, 'work-item-1', SUBMIT)
    const after = await repository.listRatingNotifications(EVALUATOR)
    expect(after.results).toHaveLength(before + 1)
    expect(after.results[0]).toMatchObject({
      code: 'EVALUATION_SUBMITTED',
      recipientUserId: EVALUATOR,
      deepLink: '/ratings/workspace?event=event-1',
    })
  })

  it('в уведомлении нет ни текста, ни значений — ВЕСЬ JSON', async () => {
    const { repository } = await setup()
    await repository.submitEvaluation(EVALUATOR, 'work-item-1', {
      ...SUBMIT,
      score: 4,
      comment: 'Уход с поста до смены',
      idempotencyKey: 'idem-notify-secret',
    })
    const json = JSON.stringify((await repository.listRatingNotifications(EVALUATOR)).results)
    expect(json).not.toContain('Уход с поста')
    expect(json).not.toContain('"score"')
    // И готового текста тоже нет: подставлять в фиксированную формулировку
    // экрана нечего, потому что подстановок в ней не предусмотрено.
    expect(json).not.toContain('Оценивание успешно отправлено')
  })

  it('уведомление об исправлении адресовано АВТОРУ записи, а не тому, кто нажал', async () => {
    const { repository } = await setup()
    await repository.correctEvaluation(EVALUATOR, 'work-item-9', {
      score: 10,
      basisCode: 'DISCIPLINE',
      basisNote: null,
      comment: null,
      reason: 'Учтён рапорт',
      revision: 3,
      idempotencyKey: 'idem-notify-correct',
    })
    const mine = await repository.listRatingNotifications(EVALUATOR)
    expect(mine.results[0]).toMatchObject({
      code: 'EVALUATION_CORRECTED',
      recipientUserId: EVALUATOR,
    })
  })

  // ⚠️ НЕ ПОКРЫТО, и это отказ с причиной. «Адресат берётся из записи, а не из
  // того, кто нажал» на сеяных данных ВАКУУМНО (красная проба с подменой на
  // актора остаётся зелёной): исправление ограничено СОБСТВЕННОЙ записью, и
  // автор с актором всегда совпадают. Состояние «автор ≠ исправляющий»
  // построить принудительно нельзя — оно противоречиво: проекция ответа
  // (`toSubmittedView`) законно отказывается собирать чужую запись. Свойство
  // станет проверяемым вместе с sensitive-исправлением §19.21, когда появятся
  // scope и срок полномочия.
})

describe('экспорт рейтинга (§19.29)', () => {
  async function orderExport(
    repository: ReturnType<typeof createRatingsRepository>,
    actor = EXPORTER,
    key = 'idem-export-1',
  ) {
    return repository.createRatingExport(actor, {
      scope: 'AGGREGATE',
      format: 'CSV',
      idempotencyKey: key,
    })
  }

  /** Довести работу до терминального состояния: ступень идёт на ЧТЕНИИ. */
  async function drain(
    repository: ReturnType<typeof createRatingsRepository>,
    actor = EXPORTER,
  ) {
    let list = await repository.listRatingExports(actor)
    for (let guard = 0; guard < 5; guard += 1) {
      if (!list.results.some((job) => job.state === 'QUEUED' || job.state === 'GENERATING')) break
      list = await repository.listRatingExports(actor)
    }
    return list
  }

  it('право на выгрузку — своё: держателю сводки файл не заказывается', async () => {
    const { repository } = await setup()
    await expect(orderExport(repository, VIEWER)).rejects.toBeInstanceOf(RepositoryPermissionError)
    await expect(repository.listRatingExports(VIEWER)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })

  it('заказ создаёт работу в QUEUED без артефакта и без ссылки на файл', async () => {
    const { repository } = await setup()
    const created = await orderExport(repository)
    expect(created.job).toMatchObject({ state: 'QUEUED', artifactId: null, scope: 'AGGREGATE' })
    // §19.29 «Не добавляй фиктивную ссылку на файл»: ни одного поля со ссылкой
    // в работе нет вовсе — проверяется по ВСЕМУ JSON, а не по знакомым именам.
    const json = JSON.stringify(created.job)
    expect(json).not.toContain('http')
    expect(json).not.toContain('/download')
    expect(json).not.toContain('.csv')
  })

  it('состояния проходят QUEUED → GENERATING → READY, файл появляется только на READY', async () => {
    const { repository } = await setup()
    await orderExport(repository)
    const first = await repository.listRatingExports(EXPORTER)
    expect(first.results[0].state).toBe('GENERATING')
    expect(first.artifacts).toEqual([])
    const second = await repository.listRatingExports(EXPORTER)
    expect(second.results[0].state).toBe('READY')
    expect(second.results[0].artifactId).toBe(second.artifacts[0].artifactId)
    expect(second.artifacts[0].fileName).toBe('operational-rating-aggregate-2026-07-20.csv')
  })

  it('готовый файл не пересобирается повторным чтением (§19.29: файл один)', async () => {
    const { repository } = await setup()
    await orderExport(repository)
    const ready = await drain(repository)
    const generatedAt = ready.artifacts[0].generatedAt
    const again = await repository.listRatingExports(EXPORTER)
    expect(again.artifacts).toHaveLength(1)
    expect(again.artifacts[0].generatedAt).toBe(generatedAt)
  })

  it('содержимое собирается из СВОДКИ: закрытых величин в файле нет ни одной', async () => {
    const { repository } = await setup()
    await orderExport(repository)
    await drain(repository)
    const artifactId = (await repository.listRatingExports(EXPORTER)).artifacts[0].artifactId
    const file = await repository.downloadRatingExport(EXPORTER, artifactId)
    // Ассерт по ВСЕМУ ответу, включая содержимое: производное поле несёт
    // закрытое значение так же, как своё (§19.29 перечисляет запрещённое
    // списком — оценщик, комментарий, отдельная оценка, основание).
    const json = JSON.stringify(file)
    expect(json).not.toContain('demo-event-planner')
    expect(json).not.toContain('Задержка на инструктаже')
    expect(json).not.toContain('evaluation-1')
    expect(json).not.toContain('TIMELY_ARRIVAL')
    expect(file.content).toContain('Ерланов Д.')
    expect(file.content).toContain(RATING_POLICY_VERSION)
  })

  it('повтор с тем же ключом не создаёт вторую работу (§19.26)', async () => {
    const { repository } = await setup()
    const first = await orderExport(repository)
    const repeated = await orderExport(repository)
    expect(repeated.job.exportJobId).toBe(first.job.exportJobId)
    expect((await repository.listRatingExports(EXPORTER)).results).toHaveLength(1)
  })

  it('индивидуальная выгрузка не выдаётся НИКОМУ — включая wildcard-администратора', async () => {
    const { repository } = await setup()
    await expect(
      repository.createRatingExport(WILDCARD, {
        scope: 'INDIVIDUAL',
        format: 'CSV',
        idempotencyKey: 'idem-sensitive',
      }),
    ).rejects.toMatchObject({ errorCode: 'SENSITIVE_EXPORT_UNAVAILABLE' })
    expect((await repository.listRatingExports(WILDCARD)).results).toEqual([])
  })

  it('формат, которого никто не собирает, отклоняется до создания работы', async () => {
    const { repository } = await setup()
    await expect(
      repository.createRatingExport(EXPORTER, {
        scope: 'AGGREGATE',
        format: 'PDF' as never,
        idempotencyKey: 'idem-pdf',
      }),
    ).rejects.toMatchObject({ errorCode: 'EXPORT_FORMAT_UNAVAILABLE' })
    expect((await repository.listRatingExports(EXPORTER)).results).toEqual([])
  })

  it('отмена работает на незавершённой работе и отвергается на готовой', async () => {
    const { repository } = await setup()
    const created = await orderExport(repository)
    const cancelled = await repository.cancelRatingExport(EXPORTER, created.job.exportJobId)
    expect(cancelled.job).toMatchObject({ state: 'CANCELLED' })
    expect(cancelled.job.finishedAt).not.toBeNull()
    // Отменённая работа не продвигается дальше чтением: файла у неё не будет.
    const list = await repository.listRatingExports(EXPORTER)
    expect(list.results[0].state).toBe('CANCELLED')
    expect(list.artifacts).toEqual([])

    const second = await orderExport(repository, EXPORTER, 'idem-export-2')
    await drain(repository)
    await expect(
      repository.cancelRatingExport(EXPORTER, second.job.exportJobId),
    ).rejects.toMatchObject({ errorCode: 'EXPORT_NOT_CANCELLABLE' })
  })

  it('чужая работа отвечает «не найдено», а не «нет прав»', async () => {
    const { repository } = await setup()
    const created = await orderExport(repository)
    await drain(repository)
    const artifactId = (await repository.listRatingExports(EXPORTER)).artifacts[0].artifactId
    // У WILDCARD право есть — и всё равно чужая работа для него не существует:
    // отказ по праву подтвердил бы, что выгрузка с таким идентификатором есть.
    await expect(
      repository.cancelRatingExport(WILDCARD, created.job.exportJobId),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError)
    await expect(repository.downloadRatingExport(WILDCARD, artifactId)).rejects.toBeInstanceOf(
      RepositoryNotFoundError,
    )
    expect((await repository.listRatingExports(WILDCARD)).results).toEqual([])
  })

  it('выключенный рейтинг роняет работу в FAILED с кодом, а не молча собирает файл', async () => {
    const { repository, adapter } = await setup()
    await orderExport(repository)
    // Работа уже в очереди — функцию выключают между заказом и сборкой.
    await repository.listRatingExports(EXPORTER)
    const envelope = await adapter.load()
    if (envelope === null) throw new Error('нет состояния')
    const slice = envelope.slices.ratings as { capabilities: { operationalRatings: boolean } }
    await adapter.reset({
      ...envelope,
      slices: {
        ...envelope.slices,
        ratings: { ...slice, capabilities: { ...slice.capabilities, operationalRatings: false } },
      },
    })
    const list = await repository.listRatingExports(EXPORTER)
    expect(list.results[0]).toMatchObject({ state: 'FAILED', failureCode: 'RATING_DISABLED' })
    expect(list.artifacts).toEqual([])
  })

  it('файл упавшей работы не выдаётся, даже если артефакт был собран', async () => {
    const { repository, adapter } = await setup()
    await orderExport(repository)
    await drain(repository)
    const artifactId = (await repository.listRatingExports(EXPORTER)).artifacts[0].artifactId
    // Состояние работы перепроверяется ЗАНОВО на выдаче: артефакт остаётся, а
    // право на него исчезает вместе с состоянием READY.
    const envelope = await adapter.load()
    if (envelope === null) throw new Error('нет состояния')
    const slice = envelope.slices.ratings as { exportJobs: { state: string }[] }
    await adapter.reset({
      ...envelope,
      slices: {
        ...envelope.slices,
        ratings: {
          ...slice,
          exportJobs: slice.exportJobs.map((job) => ({ ...job, state: 'CANCELLED' })),
        },
      },
    })
    await expect(repository.downloadRatingExport(EXPORTER, artifactId)).rejects.toMatchObject({
      errorCode: 'EXPORT_NOT_READY',
    })
  })

  it('журнал помнит заказ, выдачу и отказ — и не несёт значений (§19.27/§19.29)', async () => {
    const { repository } = await setup()
    await orderExport(repository)
    await drain(repository)
    const artifactId = (await repository.listRatingExports(EXPORTER)).artifacts[0].artifactId
    await repository.downloadRatingExport(EXPORTER, artifactId)
    await expect(
      repository.createRatingExport(EXPORTER, {
        scope: 'INDIVIDUAL',
        format: 'CSV',
        idempotencyKey: 'idem-sensitive-2',
      }),
    ).rejects.toMatchObject({ errorCode: 'SENSITIVE_EXPORT_UNAVAILABLE' })

    const audit = await repository.listRatingAudit(EXPORT_AUDITOR, 1)
    const codes = audit.results.map((entry) => entry.eventCode)
    expect(codes).toContain('RATING_EXPORT_REQUESTED')
    expect(codes).toContain('RATING_EXPORT_DOWNLOADED')
    // Отказ пишется СВОЕЙ транзакцией: внутри отклонённой мутации он
    // откатился бы вместе с ней, и журнал помнил бы только удачные выгрузки.
    const rejected = audit.results.find((entry) => entry.outcome === 'REJECTED')
    expect(rejected).toMatchObject({
      eventCode: 'RATING_EXPORT_REJECTED',
      reasonCode: 'SENSITIVE_EXPORT_UNAVAILABLE',
    })
    const json = JSON.stringify(audit.results)
    expect(json).not.toContain('Ерланов')
    expect(json).not.toContain('Задержка на инструктаже')
  })

  it('§35-блоки называют недоступные форматы и режим с причиной', async () => {
    const { repository } = await setup()
    const list = await repository.listRatingExports(EXPORTER)
    expect(list.formats).toEqual(['CSV'])
    expect(list.unavailableFormats.map((item) => item.code)).toEqual(['XLSX', 'PDF'])
    expect(list.unavailableScopes.map((item) => item.code)).toEqual(['INDIVIDUAL'])
  })
})
