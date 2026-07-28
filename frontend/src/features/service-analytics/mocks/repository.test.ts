// Repository аналитики службы: снимок §22.4, серверный расчёт §22.3/§22.7,
// drill-down по стабильным ID §22.12, персональная детализация §22.26.
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import { METRIC_CODES } from '../lib/analytics'
import type { MetricValue } from '../model/types'
import {
  createServiceAnalyticsRepository,
  RepositoryBusinessRuleError,
  RepositoryPermissionError,
} from './repository'
import {
  ATTENTION_DETECTORS,
  METRIC_DEFINITIONS,
  OPS_LIFECYCLE_REGISTRY,
  PERIOD_PRESETS,
} from './fixtures'
import { ATTENTION_POLICY_VERSION, FORBIDDEN_ATTENTION_PHRASES } from '../lib/attention'
import { POLICY_VERSION } from '../lib/analytics'

const VIEWER = 'viewer-user'
const DRILLER = 'driller-user'
const FULL = 'full-user'
const NOBODY = 'nobody-user'
const OPS_VIEWER = 'ops-viewer-user'

const BUSINESS_DATE = '2026-07-20'

function shift(
  id: string,
  businessDate: string,
  employeeName: string,
  stateCode: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    businessDate,
    employeeName,
    stateCode,
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    actualStart: null,
    actualEnd: null,
    updatedAt: `${businessDate}T08:00:00+05:00`,
    target: { safeLabel: 'Штаб управления' },
    ...extra,
  }
}

interface SeedOverrides {
  duties?: unknown
  /** §22.13-22.15: слайс ОМ. По умолчанию его НЕТ — источник недоступен. */
  securityEvents?: unknown
  /** §22.11: политику наблюдений подменяют точечно — часть тестов проверяет
   * именно её отсутствие. */
  attentionDetectors?: unknown
}

function seedEnvelope(overrides: SeedOverrides = {}): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 22,
    seed_version: 'test-v22',
    scenario: 'normal',
    revision: 3,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: {
      serviceAnalytics: {
        metricDefinitions: METRIC_DEFINITIONS.map((d) => ({ ...d })),
        periodPresets: PERIOD_PRESETS.map((p) => ({ ...p })),
        drilldownPageSize: 2,
        attentionDetectors:
          overrides.attentionDetectors === undefined
            ? ATTENTION_DETECTORS.map((d) => ({ ...d }))
            : overrides.attentionDetectors,
        opsLifecycleRegistry: OPS_LIFECYCLE_REGISTRY.map((state) => ({ ...state })),
      },
      ...(overrides.securityEvents === undefined
        ? {}
        : { 'security-events': overrides.securityEvents }),
      ...(overrides.duties === undefined
        ? {
            duties: {
              dutyTypes: [
                {
                  dutyTypeCode: 'OWN_OBJECT_DAILY',
                  restAfterMinutes: 24 * 60,
                  restPolicy: 'HARD_BLOCK',
                },
              ],
              shifts: [
                // Пять запланированных смен одного дня у РАЗНЫХ сотрудников —
                // страница курсора при размере 2 наступает дважды.
                shift('s1', BUSINESS_DATE, 'Ерланов Д.', 'PLANNED'),
                shift('s2', BUSINESS_DATE, 'Абишев Н.', 'PLANNED'),
                shift('s3', BUSINESS_DATE, 'Сейтказы М.', 'PLANNED'),
                shift('s4', BUSINESS_DATE, 'Нурланов Е.', 'PLANNED'),
                shift('s5', BUSINESS_DATE, 'Жумабаев Р.', 'PLANNED'),
                // Просроченная (вчера, не закрыта).
                shift('s6', '2026-07-19', 'Ерланов Д.', 'PLANNED'),
              ],
            },
          }
        : { duties: overrides.duties }),
    },
  }
}

async function setup(overrides: SeedOverrides = {}) {
  const adapter = createMemoryPersistence()
  await adapter.reset(seedEnvelope(overrides))
  const clock = new DemoClock(`${BUSINESS_DATE}T08:00:00+05:00`)
  return { repository: createServiceAnalyticsRepository(adapter, clock), adapter, clock }
}

function metric(response: { data: { metrics: MetricValue[] } }, code: string) {
  return response.data.metrics.find((m) => m.metricCode === code)
}

beforeEach(() => {
  registerRbacDirectory([
    { userId: VIEWER, permissions: ['ops.analytics.view'] },
    { userId: DRILLER, permissions: ['ops.analytics.view', 'ops.analytics.drilldown'] },
    {
      userId: FULL,
      permissions: [
        'ops.analytics.view',
        'ops.analytics.drilldown',
        'ops.analytics.personal_detail',
      ],
    },
    // §22.26: аналитика службы и аналитика ОМ — разные права. `OPS_VIEWER`
    // держит только второе, `VIEWER` — только первое.
    { userId: OPS_VIEWER, permissions: ['ops.analytics.operations'] },
    { userId: NOBODY, permissions: [] },
  ])
})

const TODAY = { presetCode: 'TODAY' as string | null }

describe('права (§22.26)', () => {
  it('без права просмотра закрыты и пресеты, и снимок, и выборка', async () => {
    const { repository } = await setup()
    await expect(repository.listPresets(NOBODY)).rejects.toThrow(RepositoryPermissionError)
    await expect(repository.getServiceAnalytics(NOBODY, TODAY)).rejects.toThrow(
      RepositoryPermissionError,
    )
    await expect(
      repository.getDrilldown(NOBODY, {
        snapshotId: 'x',
        metricCode: METRIC_CODES.planned,
        presetCode: 'TODAY',
        from: '',
        to: '',
        cursor: null,
      }),
    ).rejects.toThrow(RepositoryPermissionError)
  })

  it('право на дашборд НЕ даёт права на раскрытие показателя', async () => {
    const { repository } = await setup()
    const snapshot = await repository.getServiceAnalytics(VIEWER, TODAY)
    expect(snapshot.drilldownAllowed).toBe(false)
    expect(snapshot.drilldownDeniedReason).toMatch(/отдельное право/)

    // Отказ стоит на СЕРВЕРЕ, а не только в подсказке кнопки.
    await expect(
      repository.getDrilldown(VIEWER, {
        snapshotId: snapshot.snapshotId,
        metricCode: METRIC_CODES.planned,
        presetCode: 'TODAY',
        from: '',
        to: '',
        cursor: null,
      }),
    ).rejects.toThrow(RepositoryPermissionError)
  })
})

describe('снимок (§22.4)', () => {
  it('несёт период, business date, scope, версии и состояние источников', async () => {
    const { repository } = await setup()
    const snapshot = await repository.getServiceAnalytics(VIEWER, TODAY)

    expect(snapshot.businessDate).toBe(BUSINESS_DATE)
    expect(snapshot.period).toEqual({ from: BUSINESS_DATE, to: BUSINESS_DATE, presetCode: 'TODAY' })
    expect(snapshot.scope.scopeId).toBe('demo')
    expect(snapshot.freshnessState).toBe('CURRENT')
    expect(snapshot.completenessState).toBe('COMPLETE')
    expect(snapshot.calculationVersion).not.toBe('')
    expect(snapshot.policyVersion).not.toBe('')
    // §22.4: водяного знака в demo-срезе нет, и врать в поле нечем.
    expect(snapshot.sourceWatermark).toBeNull()
  })

  it('§22.12: строки НЕ едут вместе с показателями', async () => {
    const { repository } = await setup()
    const snapshot = await repository.getServiceAnalytics(DRILLER, TODAY)
    const body = JSON.stringify(snapshot)
    // Ни одного ФИО и ни одного идентификатора смены в ответе KPI.
    expect(body).not.toContain('Ерланов')
    expect(body).not.toContain('"s1"')
  })

  it('отсутствие источника даёт UNKNOWN и null, а НЕ ноль', async () => {
    const { repository } = await setup({ duties: null })
    const snapshot = await repository.getServiceAnalytics(VIEWER, TODAY)

    expect(snapshot.freshnessState).toBe('UNKNOWN')
    expect(snapshot.completenessState).toBe('INCOMPLETE')
    for (const item of snapshot.data.metrics) {
      expect(item.value).toBeNull()
      expect(item.state).toBe('UNKNOWN')
      // Ноль читался бы как «конфликтов нет» — утверждение, которого мы
      // сделать не можем.
      expect(item.value).not.toBe(0)
      expect(item.drilldownAvailable).toBe(false)
    }
  })

  it('раскрыть непосчитанный показатель нельзя даже с правом', async () => {
    const { repository } = await setup({ duties: null })
    const snapshot = await repository.getServiceAnalytics(DRILLER, TODAY)
    await expect(
      repository.getDrilldown(DRILLER, {
        snapshotId: snapshot.snapshotId,
        metricCode: METRIC_CODES.planned,
        presetCode: 'TODAY',
        from: '',
        to: '',
        cursor: null,
      }),
    ).rejects.toThrow(RepositoryBusinessRuleError)
  })
})

describe('показатели считает сервер (§22.3/§22.7)', () => {
  it('период РЕЖЕТ выборку: вчерашняя смена не попадает в «сегодня»', async () => {
    const { repository } = await setup()
    const today = await repository.getServiceAnalytics(VIEWER, TODAY)
    expect(metric(today, METRIC_CODES.planned)?.value).toBe(5)

    const week = await repository.getServiceAnalytics(VIEWER, { presetCode: 'CURRENT_WEEK' })
    // Неделя начинается с бизнес-даты вперёд — вчерашняя смена не в ней тоже.
    expect(metric(week, METRIC_CODES.planned)?.value).toBe(5)

    const custom = await repository.getServiceAnalytics(VIEWER, {
      presetCode: null,
      from: '2026-07-19',
      to: '2026-07-20',
    })
    expect(metric(custom, METRIC_CODES.planned)?.value).toBe(6)
  })

  it('состояние показателя приходит по СЕРВЕРНЫМ порогам', async () => {
    const { repository } = await setup()
    const custom = await repository.getServiceAnalytics(VIEWER, {
      presetCode: null,
      from: '2026-07-19',
      to: '2026-07-20',
    })
    // Одна просроченная смена — порог WARNING у этого показателя равен 1.
    const unfinished = metric(custom, METRIC_CODES.unfinished)
    expect(unfinished?.value).toBe(1)
    expect(unfinished?.state).toBe('WARNING')
    // А у справочного показателя порога нет — пять смен остаются нормой.
    expect(metric(custom, METRIC_CODES.planned)?.state).toBe('NORMAL')
  })

  it('произвольный период проверяет СЕРВЕР: формат, порядок дат и глубина', async () => {
    const { repository } = await setup()
    await expect(
      repository.getServiceAnalytics(VIEWER, { presetCode: null, from: '20.07.2026', to: '2026-07-21' }),
    ).rejects.toThrow(RepositoryBusinessRuleError)
    await expect(
      repository.getServiceAnalytics(VIEWER, { presetCode: null, from: '2026-07-21', to: '2026-07-20' }),
    ).rejects.toThrow(RepositoryBusinessRuleError)
    await expect(
      repository.getServiceAnalytics(VIEWER, { presetCode: null, from: '2026-01-01', to: '2026-12-31' }),
    ).rejects.toThrow(RepositoryBusinessRuleError)
  })

  it('неизвестный пресет — отказ, а не молчаливый дефолт', async () => {
    const { repository } = await setup()
    await expect(
      repository.getServiceAnalytics(VIEWER, { presetCode: 'ПОЗАВЧЕРА' }),
    ).rejects.toThrow(RepositoryBusinessRuleError)
  })
})

describe('drill-down (§22.12)', () => {
  async function openDrilldown(actor: string, cursor: string | null = null) {
    const { repository } = await setup()
    const snapshot = await repository.getServiceAnalytics(actor, TODAY)
    const page = await repository.getDrilldown(actor, {
      snapshotId: snapshot.snapshotId,
      metricCode: METRIC_CODES.planned,
      presetCode: 'TODAY',
      from: '',
      to: '',
      cursor,
    })
    return { repository, snapshot, page }
  }

  it('строки приходят страницей по курсору, а число показателя равно ВСЕЙ выборке', async () => {
    const { repository, snapshot, page } = await openDrilldown(FULL)
    expect(metric(snapshot, METRIC_CODES.planned)?.value).toBe(5)
    expect(page.data.totalCount).toBe(5)
    // Страница — 2 строки из сида этого файла: курсор обязан наступить.
    expect(page.data.rows).toHaveLength(2)
    expect(page.data.nextCursor).not.toBeNull()

    const second = await repository.getDrilldown(FULL, {
      snapshotId: snapshot.snapshotId,
      metricCode: METRIC_CODES.planned,
      presetCode: 'TODAY',
      from: '',
      to: '',
      cursor: page.data.nextCursor,
    })
    expect(second.data.rows).toHaveLength(2)
    // Страницы НЕ пересекаются: повтор строки означал бы сбитое смещение.
    const firstIds = page.data.rows.map((row) => row.rowId)
    const secondIds = second.data.rows.map((row) => row.rowId)
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([])

    const third = await repository.getDrilldown(FULL, {
      snapshotId: snapshot.snapshotId,
      metricCode: METRIC_CODES.planned,
      presetCode: 'TODAY',
      from: '',
      to: '',
      cursor: second.data.nextCursor,
    })
    expect(third.data.rows).toHaveLength(1)
    expect(third.data.nextCursor).toBeNull()
  })

  it('строки несут стабильные ID сущностей, а не номера строк', async () => {
    const { page } = await openDrilldown(FULL)
    for (const row of page.data.rows) expect(row.rowId).toMatch(/^s\d$/)
  })

  it('без права на персональную детализацию ФИО НЕТ В ОТВЕТЕ, и причина названа', async () => {
    const { page } = await openDrilldown(DRILLER)
    expect(page.data.personalDetailSuppressed).toBe(true)
    expect(page.data.personalDetailReason).toMatch(/персональн/)
    for (const row of page.data.rows) expect(row.employeeLabel).toBeNull()
    // Проверка по ВСЕМУ ответу: запрет не должен переезжать в соседнее поле.
    expect(JSON.stringify(page)).not.toContain('Ерланов')
    // Остальные поля строки при этом на месте — вырезан сотрудник, а не строка.
    expect(page.data.rows[0].objectLabel).toBe('Штаб управления')
  })

  it('с правом ФИО приходит — иначе предыдущая проверка была бы пустой', async () => {
    const { page } = await openDrilldown(FULL)
    expect(page.data.personalDetailSuppressed).toBe(false)
    expect(page.data.rows.some((row) => row.employeeLabel !== null)).toBe(true)
  })

  it('чужой snapshotId отвергается: строки обязаны принадлежать своему снимку', async () => {
    const { repository, snapshot } = await openDrilldown(FULL)
    await expect(
      repository.getDrilldown(FULL, {
        snapshotId: `${snapshot.snapshotId}-подделка`,
        metricCode: METRIC_CODES.planned,
        presetCode: 'TODAY',
        from: '',
        to: '',
        cursor: null,
      }),
    ).rejects.toThrow(RepositoryBusinessRuleError)
  })

  it('снимок ДРУГОГО периода к показателю не подходит', async () => {
    const { repository } = await setup()
    const today = await repository.getServiceAnalytics(FULL, TODAY)
    // Тот же показатель, но период запроса другой — id снимка не совпадёт.
    await expect(
      repository.getDrilldown(FULL, {
        snapshotId: today.snapshotId,
        metricCode: METRIC_CODES.planned,
        presetCode: null,
        from: '2026-07-19',
        to: '2026-07-20',
        cursor: null,
      }),
    ).rejects.toThrow(RepositoryBusinessRuleError)
  })

  it('неизвестный показатель — отказ, а не пустая выборка', async () => {
    const { repository, snapshot } = await openDrilldown(FULL)
    await expect(
      repository.getDrilldown(FULL, {
        snapshotId: snapshot.snapshotId,
        metricCode: 'ВЫДУМАННЫЙ',
        presetCode: 'TODAY',
        from: '',
        to: '',
        cursor: null,
      }),
    ).rejects.toThrow(RepositoryBusinessRuleError)
  })

  it('аналитика ничего не меняет в чужом слайсе дежурств', async () => {
    const { repository, adapter } = await setup()
    const before = JSON.stringify((await adapter.load())?.slices.duties)
    const snapshot = await repository.getServiceAnalytics(FULL, TODAY)
    await repository.getDrilldown(FULL, {
      snapshotId: snapshot.snapshotId,
      metricCode: METRIC_CODES.planned,
      presetCode: 'TODAY',
      from: '',
      to: '',
      cursor: null,
    })
    expect(JSON.stringify((await adapter.load())?.slices.duties)).toBe(before)
  })
})

describe('блок «Требует внимания» (§22.11)', () => {
  const DUTY_TYPES = [
    { dutyTypeCode: 'OWN_OBJECT_DAILY', restAfterMinutes: 24 * 60, restPolicy: 'HARD_BLOCK' },
  ]

  /** Две смены одного сотрудника в один день — жёсткий конфликт; остальные
   * заполняют знаменатель доли. */
  function conflictSeed(filler: number, conflictingState = 'ACKNOWLEDGED') {
    return {
      dutyTypes: DUTY_TYPES,
      shifts: [
        shift('c1', BUSINESS_DATE, 'Оразов К.', conflictingState),
        shift('c2', BUSINESS_DATE, 'Оразов К.', conflictingState),
        ...Array.from({ length: filler }, (_, index) =>
          shift(`f${index}`, BUSINESS_DATE, `Сотрудник ${index}`, 'ACKNOWLEDGED'),
        ),
      ],
    }
  }

  it('без права просмотра аналитики блок закрыт целиком', async () => {
    const { repository } = await setup()
    await expect(repository.getAttention(NOBODY, TODAY)).rejects.toThrow(RepositoryPermissionError)
  })

  it('наблюдение несёт СВОЮ версию политики, а не версию порогов показателей', async () => {
    const { repository } = await setup()
    const response = await repository.getAttention(VIEWER, TODAY)

    expect(response.policyVersion).toBe(ATTENTION_POLICY_VERSION)
    // Ровно то, что отличает наблюдение от перекрашенного KPI: методики
    // независимы, и версия у них разная.
    expect(response.policyVersion).not.toBe(POLICY_VERSION)
    expect(response.data.items.length).toBeGreaterThan(0)
    for (const item of response.data.items) {
      expect(item.policyVersion).toBe(ATTENTION_POLICY_VERSION)
      expect(item.detectedAt).toBe(response.generatedAt)
    }
  })

  it('превышение считает ДОЛЮ: то же количество конфликтов при большем объёме наблюдением не является', async () => {
    const few = await setup({ duties: conflictSeed(1) })
    const many = await setup({ duties: conflictSeed(10) })

    const dense = (await few.repository.getAttention(VIEWER, TODAY)).data.items.find(
      (item) => item.categoryCode === 'CONFLICT_SHARE',
    )
    const sparse = (await many.repository.getAttention(VIEWER, TODAY)).data.items.find(
      (item) => item.categoryCode === 'CONFLICT_SHARE',
    )

    // Конфликтных смен в обоих случаях РОВНО ДВЕ — KPI показал бы одинаковое
    // «2». Наблюдение появляется только там, где доля перешла порог.
    expect(dense?.count).toBe(2)
    expect(dense?.severity).toBe('CRITICAL')
    expect(sparse).toBeUndefined()
  })

  it('порядок задаёт severity, а не код категории', async () => {
    const { repository } = await setup({
      duties: {
        dutyTypes: DUTY_TYPES,
        shifts: [
          shift('c1', BUSINESS_DATE, 'Оразов К.', 'ACKNOWLEDGED'),
          shift('c2', BUSINESS_DATE, 'Оразов К.', 'ACKNOWLEDGED'),
          shift('p1', BUSINESS_DATE, 'Ерланов Д.', 'PLANNED'),
        ],
      },
    })
    const items = (await repository.getAttention(VIEWER, TODAY)).data.items

    // По алфавиту ACKNOWLEDGEMENT_MISSING шёл бы ПЕРВЫМ — проверка не пуста.
    expect(items.map((item) => item.categoryCode)).toEqual([
      'CONFLICT_SHARE',
      'ACKNOWLEDGEMENT_MISSING',
    ])
    expect(items.map((item) => item.severity)).toEqual(['CRITICAL', 'WARNING'])
  })

  it('наблюдение об источнике не считает случаев и никуда не ведёт', async () => {
    const { repository } = await setup({
      duties: {
        dutyTypes: DUTY_TYPES,
        // Источник не менялся третьи сутки — допуск 53 часа перейден.
        shifts: [
          {
            ...shift('old', BUSINESS_DATE, 'Ерланов Д.', 'ACKNOWLEDGED'),
            updatedAt: '2026-07-17T08:00:00+05:00',
          },
        ],
      },
    })
    const source = (await repository.getAttention(VIEWER, TODAY)).data.items.find(
      (item) => item.categoryCode === 'SOURCE_AGE',
    )

    expect(source?.safeTitle).toBe('Источник не обновлён')
    // Ноль здесь читался бы как «ноль случаев», то есть как отсутствие
    // наблюдения — а наблюдение как раз есть.
    expect(source?.count).toBeNull()
    expect(source?.targetRoute).toBeNull()
    expect(source?.targetPermission).toBeNull()
  })

  it('отсутствие источника — НЕ «замечаний нет»', async () => {
    const { repository } = await setup({ duties: null })
    const response = await repository.getAttention(VIEWER, TODAY)

    expect(response.data.items).toEqual([])
    expect(response.data.detectionState).toBe('UNAVAILABLE')
    expect(response.data.detectionUnavailableReason).not.toBeNull()
    expect(response.completenessState).toBe('INCOMPLETE')
  })

  it('пустая политика наблюдений тоже не даёт «замечаний нет»', async () => {
    const { repository } = await setup({ attentionDetectors: [] })
    const response = await repository.getAttention(VIEWER, TODAY)

    expect(response.data.detectionState).toBe('UNAVAILABLE')
    expect(response.data.items).toEqual([])
  })

  it('ни один произведённый текст не содержит запрещённых §22.11 формулировок', async () => {
    const { repository } = await setup({ duties: conflictSeed(1, 'PLANNED') })
    const response = await repository.getAttention(VIEWER, TODAY)

    expect(response.data.items.length).toBeGreaterThan(0)
    for (const item of response.data.items) {
      const text = `${item.safeTitle} ${item.safeDescription}`.toLowerCase()
      for (const phrase of FORBIDDEN_ATTENTION_PHRASES) {
        expect(text).not.toContain(phrase)
      }
    }
  })

  it('наблюдения ничего не меняют в чужом слайсе дежурств', async () => {
    const { repository, adapter } = await setup()
    const before = JSON.stringify((await adapter.load())?.slices.duties)
    await repository.getAttention(VIEWER, TODAY)
    expect(JSON.stringify((await adapter.load())?.slices.duties)).toBe(before)
  })
})

describe('аналитика ОМ (§22.13, §22.15)', () => {
  const EVENTS = [
    {
      id: 'event-1',
      code: 'ОМ-001',
      title: 'Форум',
      objectId: 'object-1',
      objectName: 'Дворец Независимости',
      businessDate: '2026-07-22',
      stage: 'PLACEMENT',
      readinessPercent: 82,
      conflictsCount: 2,
      demandApproved: true,
      demandRows: [{ need: 6 }, { need: 4 }],
      forceRequests: [{ requestedCount: 8, allocatedCount: 6 }],
      journalEntries: [{ type: 'INCIDENT' }, { type: 'ORDER' }],
      placementAssignments: [
        { postId: 'post-1', acknowledgedAt: '2026-07-20T08:00:00+05:00' },
        { postId: 'post-1', acknowledgedAt: null },
      ],
      reconSectorPosts: [
        { id: 'post-1', sector: 'A', post: 'Главный вход', need: 4, sourceSectorId: 'sector-77' },
        { id: 'post-2', sector: 'A', post: 'Пресс-зона', need: 2, sourceSectorId: null },
      ],
      closedAt: null,
    },
    {
      id: 'event-2',
      code: 'ОМ-002',
      title: 'Визит',
      objectId: null,
      objectName: 'Резиденция',
      businessDate: '2026-07-25',
      stage: 'DEMAND',
      readinessPercent: 40,
      conflictsCount: 0,
      demandApproved: false,
      demandRows: [{ need: 99 }],
      forceRequests: [],
      journalEntries: [],
      placementAssignments: [],
      reconSectorPosts: [],
      closedAt: null,
    },
  ]

  async function opsSetup() {
    return setup({ securityEvents: { events: EVENTS } })
  }

  it('§22.26: право на аналитику службы НЕ открывает аналитику ОМ, и наоборот', async () => {
    const { repository } = await opsSetup()

    await expect(repository.getOperationsAnalytics(VIEWER, { level: 'ALL' })).rejects.toThrow(
      RepositoryPermissionError,
    )
    await expect(repository.getServiceAnalytics(OPS_VIEWER, TODAY)).rejects.toThrow(
      RepositoryPermissionError,
    )
    // А со своим правом — открывается.
    await expect(
      repository.getOperationsAnalytics(OPS_VIEWER, { level: 'ALL' }),
    ).resolves.toBeDefined()
  })

  it('корень иерархии группирует по объекту; ОМ без объекта — своя корзина', async () => {
    const { repository } = await opsSetup()
    const response = await repository.getOperationsAnalytics(OPS_VIEWER, { level: 'ALL' })

    expect(response.data.level).toBe('ALL')
    expect(response.data.breadcrumb.map((item) => item.safeLabel)).toEqual(['Все ОМ'])
    expect(response.data.rows.map((row) => row.rowId).sort()).toEqual([
      'object-1',
      'object:unbound',
    ])
    expect(response.data.lifecycleDistribution.find((b) => b.stateCode === 'PLACEMENT')?.count).toBe(1)
  })

  it('спуск по уровням идёт по стабильным ID и накапливает breadcrumb', async () => {
    const { repository } = await opsSetup()

    const object = await repository.getOperationsAnalytics(OPS_VIEWER, {
      level: 'OBJECT',
      objectId: 'object-1',
    })
    expect(object.data.rows.map((row) => row.rowId)).toEqual(['event-1'])

    const event = await repository.getOperationsAnalytics(OPS_VIEWER, {
      level: 'EVENT',
      eventId: 'event-1',
    })
    expect(event.data.eventCard?.code).toBe('ОМ-001')
    // Два поста одного сектора «A», но один из паспорта, другой ручной —
    // ДВА направления (§22.15 связывает по ID, не по названию).
    expect(event.data.rows).toHaveLength(2)

    const direction = await repository.getOperationsAnalytics(OPS_VIEWER, {
      level: 'DIRECTION',
      eventId: 'event-1',
      directionId: 'event-1::sector-77',
    })
    expect(direction.data.rows.map((row) => row.rowId)).toEqual(['post-1'])
    expect(direction.data.breadcrumb.map((item) => item.level)).toEqual([
      'ALL',
      'OBJECT',
      'EVENT',
      'DIRECTION',
    ])

    const post = await repository.getOperationsAnalytics(OPS_VIEWER, {
      level: 'POST',
      eventId: 'event-1',
      directionId: 'event-1::sector-77',
      postId: 'post-1',
    })
    // Последний уровень — АГРЕГАТ участия, а не список людей: ни одного ФИО.
    expect(post.data.rows).toHaveLength(1)
    expect(post.data.rows[0].childLevel).toBeNull()
    expect(post.data.rows[0].cells.find((cell) => cell.code === 'ASSIGNED')?.value).toBe(2)
    expect(post.data.rows[0].cells.find((cell) => cell.code === 'ACKNOWLEDGED')?.value).toBe(1)
  })

  it('несуществующая цель уровня — отказ, а не пустая таблица', async () => {
    const { repository } = await opsSetup()
    await expect(
      repository.getOperationsAnalytics(OPS_VIEWER, { level: 'EVENT', eventId: 'нет-такого' }),
    ).rejects.toThrow(RepositoryBusinessRuleError)
    await expect(
      repository.getOperationsAnalytics(OPS_VIEWER, {
        level: 'DIRECTION',
        eventId: 'event-1',
        directionId: 'event-1::нет-такого',
      }),
    ).rejects.toThrow(RepositoryBusinessRuleError)
  })

  it('§22.14 воронка строится ПО ЖУРНАЛУ, а не по текущим стадиям', async () => {
    const { repository, adapter } = await opsSetup()
    // Журнал кладём рядом с карточками: он живёт в том же слайсе, но читается
    // отдельно (и до Этапа 46 его не было вовсе).
    const envelope = await adapter.load()
    await adapter.reset({
      ...envelope!,
      slices: {
        ...envelope!.slices,
        'security-events': {
          events: EVENTS,
          transitions: [
            { eventId: 'event-1', fromStage: null, toStage: 'BULLETIN', kind: 'FORWARD', occurredAt: '2026-07-18T00:00:00.000Z' },
            { eventId: 'event-1', fromStage: 'BULLETIN', toStage: 'PLACEMENT', kind: 'FORWARD', occurredAt: '2026-07-18T06:00:00.000Z' },
          ],
        },
      },
    })

    const response = await repository.getOperationsAnalytics(OPS_VIEWER, { level: 'ALL' })
    expect(response.data.funnel?.transitionCount).toBe(2)
    const bulletin = response.data.funnel?.stages.find((stage) => stage.stateCode === 'BULLETIN')
    // Через «Бюллетень» мероприятие прошло, хотя СЕЙЧАС стоит на «Расстановке»:
    // воронка знает историю, а распределение по стадиям — нет.
    expect(bulletin?.values.REACHED).toBe(1)
    expect(bulletin?.values.CURRENT).toBe(0)
  })

  it('без журнала переходов воронка не подменяется текущими стадиями', async () => {
    // Слайс ОМ есть, журнала нет (снапшот старой схемы).
    const { repository } = await opsSetup()
    const response = await repository.getOperationsAnalytics(OPS_VIEWER, { level: 'ALL' })

    expect(response.data.funnel).toBeNull()
    expect(response.data.funnelUnavailableReason).toContain('событий перехода')
  })

  it('§35: отменённые ОМ и просрочка по-прежнему названы с причиной', async () => {
    const { repository } = await opsSetup()
    const response = await repository.getOperationsAnalytics(OPS_VIEWER, { level: 'ALL' })
    const codes = response.data.unavailableMeasures.map((measure) => measure.code)

    expect(codes).toContain('CANCELLED_COUNT')
    expect(codes).toContain('OVERDUE_ACTIONS')
    // Воронка из этого списка УШЛА: она реализована.
    expect(codes).not.toContain('FUNNEL')
  })

  it('отсутствие слайса ОМ — не «мероприятий нет»', async () => {
    const { repository } = await setup()
    const response = await repository.getOperationsAnalytics(OPS_VIEWER, { level: 'ALL' })

    expect(response.data.rows).toEqual([])
    expect(response.completenessState).toBe('INCOMPLETE')
    expect(response.freshnessState).toBe('UNKNOWN')
    expect(
      response.data.unavailableMeasures.some((measure) => measure.code === 'SOURCE'),
    ).toBe(true)
  })

  it('аналитика ОМ ничего не меняет в чужом слайсе мероприятий', async () => {
    const { repository, adapter } = await opsSetup()
    const before = JSON.stringify((await adapter.load())?.slices['security-events'])
    await repository.getOperationsAnalytics(OPS_VIEWER, { level: 'ALL' })
    await repository.getOperationsAnalytics(OPS_VIEWER, { level: 'EVENT', eventId: 'event-1' })
    expect(JSON.stringify((await adapter.load())?.slices['security-events'])).toBe(before)
  })
})
