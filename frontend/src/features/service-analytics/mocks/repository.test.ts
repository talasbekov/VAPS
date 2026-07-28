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
import { METRIC_DEFINITIONS, PERIOD_PRESETS } from './fixtures'

const VIEWER = 'viewer-user'
const DRILLER = 'driller-user'
const FULL = 'full-user'
const NOBODY = 'nobody-user'

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

function seedEnvelope(overrides: { duties?: unknown } = {}): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 21,
    seed_version: 'test-v21',
    scenario: 'normal',
    revision: 3,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: {
      serviceAnalytics: {
        metricDefinitions: METRIC_DEFINITIONS.map((d) => ({ ...d })),
        periodPresets: PERIOD_PRESETS.map((p) => ({ ...p })),
        drilldownPageSize: 2,
      },
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

async function setup(overrides: { duties?: unknown } = {}) {
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
