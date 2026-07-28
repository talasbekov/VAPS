// Детекторы блока «Требует внимания» (§22.11): словарь формулировок, пороги
// собственной политики, выдержка допусков.
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_ATTENTION_TITLES,
  ATTENTION_POLICY_VERSION,
  ATTENTION_TITLES,
  buildAttentionItems,
} from './attention'
import type { AttentionDetectorDefinition } from './attention'
import type { AnalyticsSourceShift } from './analytics'
import { ATTENTION_DETECTORS } from '../mocks/fixtures'

const BUSINESS_DATE = '2026-07-20'
const GENERATED_AT = '2026-07-20T08:00:00+05:00'

const CONTEXT = {
  from: '2026-07-01',
  to: '2026-07-31',
  businessDate: BUSINESS_DATE,
  generatedAt: GENERATED_AT,
  snapshotId: 'snap-1-2026-07-01-2026-07-31-demo',
  scopeLabel: 'Область demo',
}

function shift(overrides: Partial<AnalyticsSourceShift> = {}): AnalyticsSourceShift {
  return {
    id: 'shift-1',
    businessDate: BUSINESS_DATE,
    employeeName: 'Ерланов Д.',
    objectLabel: 'Штаб управления',
    stateCode: 'PLANNED',
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    actualStart: null,
    actualEnd: null,
    updatedAt: GENERATED_AT,
    ...overrides,
  }
}

const DUTY_TYPES = [
  { dutyTypeCode: 'OWN_OBJECT_DAILY', restAfterMinutes: 24 * 60, restPolicy: 'HARD_BLOCK' as const },
]

function detector(
  overrides: Partial<AttentionDetectorDefinition> = {},
): AttentionDetectorDefinition {
  return {
    categoryCode: 'TEST',
    measure: 'ACKNOWLEDGEMENT_MISSING',
    titleCode: 'VERIFICATION_REQUIRED',
    safeDescriptionTemplate: 'Записей: {count}. Допуск: {parameter}.',
    parameter: 3,
    warningFrom: 2,
    criticalFrom: 5,
    baseSeverity: 'INFO',
    targetRoute: null,
    targetPermission: null,
    ...overrides,
  }
}

function build(
  definitions: AttentionDetectorDefinition[],
  shifts: AnalyticsSourceShift[],
  context: Partial<typeof CONTEXT> = {},
) {
  return buildAttentionItems(
    definitions,
    { shifts, dutyTypes: DUTY_TYPES },
    { ...CONTEXT, ...context },
  )
}

describe('словарь формулировок (§22.11)', () => {
  it('разрешённые заголовки — РОВНО пять из промпта, дословно', () => {
    // Пин литералами: §22.11 перечисляет формулировки поимённо, и «почти та
    // же» формулировка — уже своя, то есть запрещённая фронту.
    expect(ALLOWED_ATTENTION_TITLES).toEqual([
      'Требуется проверка',
      'Данные не подтверждены',
      'Обнаружено превышение серверного порога',
      'Есть незавершённые процессы',
      'Источник не обновлён',
    ])
  })

  it('каждый детектор политики берёт заголовок из разрешённых', () => {
    expect(ATTENTION_DETECTORS.length).toBeGreaterThan(0)
    for (const definition of ATTENTION_DETECTORS) {
      expect(ALLOWED_ATTENTION_TITLES).toContain(ATTENTION_TITLES[definition.titleCode])
    }
  })
})

describe('пороги собственной политики', () => {
  it('ниже нижнего порога наблюдения НЕТ вовсе — не INFO-элемент', () => {
    // Один PLANNED при warningFrom 2: элемент не должен появиться даже
    // «спокойным». Появившись, он назвал бы наблюдением обычную работу.
    const items = build([detector()], [shift()])
    expect(items).toEqual([])
  })

  it('на самом пороге — WARNING, на критическом — CRITICAL', () => {
    const two = build(
      [detector()],
      [shift({ id: 'a' }), shift({ id: 'b', employeeName: 'Абишев Н.' })],
    )
    expect(two.map((item) => item.severity)).toEqual(['WARNING'])
    expect(two[0].count).toBe(2)

    const five = build(
      [detector()],
      Array.from({ length: 5 }, (_, index) =>
        shift({ id: `s${index}`, employeeName: `Сотрудник ${index}` }),
      ),
    )
    expect(five.map((item) => item.severity)).toEqual(['CRITICAL'])
  })

  it('без порогов мера бинарная и severity берётся из политики', () => {
    const items = build(
      [detector({ warningFrom: null, criticalFrom: null, baseSeverity: 'INFO' })],
      [shift()],
    )
    expect(items.map((item) => item.severity)).toEqual(['INFO'])
  })
})

describe('допуски мер', () => {
  it('смена за горизонтом упреждения не наблюдается', () => {
    const inside = build([detector({ warningFrom: 1 })], [shift({ businessDate: '2026-07-23' })])
    const outside = build([detector({ warningFrom: 1 })], [shift({ businessDate: '2026-07-24' })])

    // Допуск 3 дня: 23-е включительно — наблюдение, 24-е — ещё нет.
    expect(inside).toHaveLength(1)
    expect(outside).toEqual([])
  })

  it('незавершённая и неподтверждённая записи наблюдаются только после выдержки', () => {
    const definitions = [
      detector({
        categoryCode: 'UNFINISHED',
        measure: 'UNFINISHED_OVERDUE',
        titleCode: 'UNFINISHED_PROCESSES',
        parameter: 2,
        warningFrom: 1,
        criticalFrom: null,
      }),
      detector({
        categoryCode: 'UNCONFIRMED',
        measure: 'UNCONFIRMED_OVERDUE',
        titleCode: 'DATA_UNCONFIRMED',
        parameter: 2,
        warningFrom: 1,
        criticalFrom: null,
      }),
    ]

    // Вчерашняя незакрытая смена — обычный ход работы, допуск не истёк.
    expect(build(definitions, [shift({ businessDate: '2026-07-19' })])).toEqual([])

    const overdue = build(definitions, [
      shift({ businessDate: '2026-07-17' }),
      shift({ id: 'no-fact', businessDate: '2026-07-17', stateCode: 'COMPLETED' }),
    ])
    expect(overdue.map((item) => item.categoryCode).sort()).toEqual(['UNCONFIRMED', 'UNFINISHED'])
  })

  it('пустой период не даёт доли: 0/0 — не «ноль процентов»', () => {
    const share = detector({
      categoryCode: 'SHARE',
      measure: 'CONFLICT_SHARE',
      titleCode: 'THRESHOLD_EXCEEDED',
      warningFrom: 18,
      criticalFrom: 34,
    })
    expect(build([share], [], { from: '2026-01-01', to: '2026-01-02' })).toEqual([])
  })

  it('возраст источника считается от момента снимка, а не от часов машины', () => {
    const age = detector({
      categoryCode: 'AGE',
      measure: 'SOURCE_AGE',
      titleCode: 'SOURCE_NOT_UPDATED',
      parameter: 53,
      warningFrom: 53,
      criticalFrom: null,
      safeDescriptionTemplate: 'Последнее изменение — {value} ч назад.',
    })
    const stale = build([age], [shift({ updatedAt: '2026-07-17T08:00:00+05:00' })])

    expect(stale).toHaveLength(1)
    expect(stale[0].count).toBeNull()
    expect(stale[0].safeDescription).toBe('Последнее изменение — 72 ч назад.')
    // Свежий источник наблюдения не даёт — иначе «не обновлён» стояло бы всегда.
    expect(build([age], [shift()])).toEqual([])
  })
})

describe('идентичность наблюдения', () => {
  it('id детерминирован снимком и категорией, версия политики — своя', () => {
    const items = build([detector({ warningFrom: 1 })], [shift()])
    expect(items[0].attentionId).toBe(`att-${CONTEXT.snapshotId}-TEST`)
    expect(items[0].policyVersion).toBe(ATTENTION_POLICY_VERSION)
    expect(items[0].detectedAt).toBe(GENERATED_AT)
    expect(items[0].scopeLabel).toBe('Область demo')

    // Тот же вход — тот же id: наблюдение можно сверить и на него можно
    // сослаться (случайный id различал бы одинаковые наблюдения).
    expect(build([detector({ warningFrom: 1 })], [shift()])[0].attentionId).toBe(
      items[0].attentionId,
    )
  })
})
