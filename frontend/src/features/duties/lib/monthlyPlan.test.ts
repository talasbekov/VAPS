// @vitest-environment node
// Чистая модель месячного плана (§21.27-21.30, §21.34-21.35) — без DOM.
import { describe, expect, it } from 'vitest'
import {
  addDays,
  buildMonthlyPlan,
  daysBetween,
  daysInMonth,
  detectConflicts,
  isValidMonth,
  overlapMessage,
  restMessage,
} from './monthlyPlan'
import type { DutyShift, DutyTypeDefinition } from '../model/types'

const OWN_TYPE: DutyTypeDefinition = {
  dutyTypeCode: 'OWN_OBJECT_DAILY',
  safeLabel: 'Суточное дежурство на собственном объекте',
  targetType: 'OWN_OBJECT',
  defaultDurationMinutes: 1440,
  requiresSenior: true,
  restAfterMinutes: 1440,
  restPolicy: 'HARD_BLOCK',
    requiresCurrentPassport: false,
}

const PROTECTED_TYPE: DutyTypeDefinition = {
  dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
  safeLabel: 'Суточное дежурство на охраняемом объекте',
  targetType: 'PROTECTED_OBJECT',
  defaultDurationMinutes: 1440,
  requiresSenior: false,
  restAfterMinutes: 1440,
  restPolicy: 'SOFT_OVERRIDE',
    requiresCurrentPassport: true,
}

const TYPES = [OWN_TYPE, PROTECTED_TYPE]

function shift(
  id: string,
  businessDate: string,
  employeeName: string,
  options: {
    objectId?: string
    objectLabel?: string
    dutyTypeCode?: string
    stateCode?: DutyShift['stateCode']
  } = {},
): DutyShift {
  return {
    id,
    businessDate,
    dutyTypeCode: options.dutyTypeCode ?? 'OWN_OBJECT_DAILY',
    target: {
      targetType: 'OWN_OBJECT',
      objectId: options.objectId ?? 'object-1',
      safeLabel: options.objectLabel ?? 'Штаб управления',
    },
    employeeName,
    stateCode: options.stateCode ?? 'PLANNED',
    acknowledgedAt: null,
    actualStart: null,
    actualEnd: null,
    updatedAt: `${businessDate}T08:00:00+05:00`,
    passportBinding: null,
  note: null,
  cancellation: null,
  overrideReason: null,
  }
}

describe('арифметика календарных дней', () => {
  it('месяц раскладывается на все свои дни, включая високосный февраль', () => {
    expect(daysInMonth('2026-07')).toHaveLength(31)
    expect(daysInMonth('2026-02')).toHaveLength(28)
    expect(daysInMonth('2024-02')).toHaveLength(29)
    expect(daysInMonth('2026-07')[0]).toBe('2026-07-01')
    expect(daysInMonth('2026-07')[30]).toBe('2026-07-31')
  })

  it('сдвиг дня переходит через границы месяца и года', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(daysBetween('2026-07-31', '2026-08-02')).toBe(2)
  })

  it('месяц валидируется по формату', () => {
    expect(isValidMonth('2026-07')).toBe(true)
    expect(isValidMonth('2026-13')).toBe(false)
    expect(isValidMonth('2026-7')).toBe(false)
    expect(isValidMonth('')).toBe(false)
  })
})

describe('конфликты плана (§21.34)', () => {
  it('два дежурства в один день — hard, независимо от вида дежурства', () => {
    const conflicts = detectConflicts(
      [
        shift('a', '2026-07-22', 'Жумабаев Р.'),
        shift('b', '2026-07-22', 'Жумабаев Р.', {
          objectId: 'object-2',
          dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
        }),
      ],
      TYPES,
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].code).toBe('DUTY_OVERLAP')
    expect(conflicts[0].severity).toBe('HARD')
    expect(conflicts[0].message).toBe(overlapMessage('Жумабаев Р.', '2026-07-22', 2))
  })

  it('severity отдыха берётся из политики вида дежурства, а не из кода фронта', () => {
    const hard = detectConflicts(
      [
        shift('a', '2026-07-24', 'Сейтказы М.'),
        shift('b', '2026-07-25', 'Сейтказы М.'),
      ],
      TYPES,
    )
    expect(hard.map((c) => [c.code, c.severity])).toEqual([['REST_AFTER_DUTY', 'HARD']])
    expect(hard[0].message).toBe(restMessage('Сейтказы М.', '2026-07-24', '2026-07-25', 1440))

    const soft = detectConflicts(
      [
        shift('a', '2026-07-15', 'Нурланов Е.', { dutyTypeCode: 'PROTECTED_OBJECT_DAILY' }),
        shift('b', '2026-07-16', 'Нурланов Е.', { dutyTypeCode: 'PROTECTED_OBJECT_DAILY' }),
      ],
      TYPES,
    )
    expect(soft.map((c) => [c.code, c.severity])).toEqual([['REST_AFTER_DUTY', 'SOFT']])
  })

  it('сутки паузы закрывают требование отдыха в 24 часа', () => {
    const conflicts = detectConflicts(
      [shift('a', '2026-07-24', 'Сейтказы М.'), shift('b', '2026-07-26', 'Сейтказы М.')],
      TYPES,
    )
    expect(conflicts).toEqual([])
  })

  it('вид дежурства вне реестра отдыха не навязывает — 24 часа не выдумываются', () => {
    const conflicts = detectConflicts(
      [
        shift('a', '2026-07-24', 'Сейтказы М.', { dutyTypeCode: 'UNKNOWN_TYPE' }),
        shift('b', '2026-07-25', 'Сейтказы М.', { dutyTypeCode: 'UNKNOWN_TYPE' }),
      ],
      TYPES,
    )
    expect(conflicts).toEqual([])
  })

  it('разные сотрудники в один день конфликтом не являются', () => {
    const conflicts = detectConflicts(
      [shift('a', '2026-07-22', 'Первый И.'), shift('b', '2026-07-22', 'Второй И.')],
      TYPES,
    )
    expect(conflicts).toEqual([])
  })
})

describe('месячный план (§21.29-21.30)', () => {
  const SHIFTS = [
    shift('a', '2026-07-15', 'Нурланов Е.', {
      objectId: 'object-2',
      objectLabel: 'Дворец Независимости',
      dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
      stateCode: 'COMPLETED',
    }),
    shift('b', '2026-07-16', 'Нурланов Е.', {
      objectId: 'object-2',
      objectLabel: 'Дворец Независимости',
      dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
      stateCode: 'COMPLETED',
    }),
    shift('c', '2026-07-22', 'Жумабаев Р.'),
    shift('d', '2026-07-22', 'Жумабаев Р.', {
      objectId: 'object-2',
      objectLabel: 'Дворец Независимости',
      dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
    }),
    shift('e', '2026-08-03', 'Оразов К.', { stateCode: 'ACTIVE' }),
  ]

  it('KPI считаются по ВСЕМУ месяцу, а не по видимым ячейкам', () => {
    const plan = buildMonthlyPlan('2026-07', SHIFTS, TYPES)
    expect(plan.kpi).toEqual({
      objectsInPlan: 2,
      shifts: 4,
      cancelled: 0,
      notAcknowledged: 2,
      completed: 2,
      hardConflicts: 1,
      softConflicts: 1,
    })
  })

  it('смены соседних месяцев в сетку не попадают', () => {
    const plan = buildMonthlyPlan('2026-07', SHIFTS, TYPES)
    expect(plan.days).toHaveLength(31)
    const total = plan.rows.flatMap((row) => row.cells).reduce((sum, c) => sum + c.shiftCount, 0)
    expect(total).toBe(4)

    const august = buildMonthlyPlan('2026-08', SHIFTS, TYPES)
    expect(august.kpi.shifts).toBe(1)
    expect(august.rows).toHaveLength(1)
  })

  it('конфликт отмечен именно в той ячейке объекта и дня, где он возник', () => {
    const plan = buildMonthlyPlan('2026-07', SHIFTS, TYPES)
    const hq = plan.rows.find((row) => row.objectLabel === 'Штаб управления')
    const cell = hq?.cells.find((c) => c.date === '2026-07-22')
    expect(cell).toMatchObject({ shiftCount: 1, hardConflictCount: 1, softConflictCount: 0 })
    const quiet = hq?.cells.find((c) => c.date === '2026-07-21')
    expect(quiet).toMatchObject({ shiftCount: 0, hardConflictCount: 0 })
  })

  it('конфликт на стыке месяцев виден в месяце ВТОРОГО дежурства и не теряется', () => {
    const crossMonth = [
      shift('x', '2026-06-30', 'Сейтказы М.'),
      shift('y', '2026-07-01', 'Сейтказы М.'),
    ]
    const july = buildMonthlyPlan('2026-07', crossMonth, TYPES)
    expect(july.conflicts.map((c) => c.businessDate)).toEqual(['2026-07-01'])
    expect(july.kpi.hardConflicts).toBe(1)

    // В июне конфликт не дублируется: он проявляется в день второго дежурства.
    const june = buildMonthlyPlan('2026-06', crossMonth, TYPES)
    expect(june.conflicts).toEqual([])
  })

  it('пустой месяц — пустая сетка и нулевые KPI, но дни всё равно перечислены', () => {
    const plan = buildMonthlyPlan('2026-09', SHIFTS, TYPES)
    expect(plan.rows).toEqual([])
    expect(plan.days).toHaveLength(30)
    expect(plan.kpi.shifts).toBe(0)
  })

  it('невыводимые показатели названы с причиной, а не показаны нулём', () => {
    const plan = buildMonthlyPlan('2026-07', SHIFTS, TYPES)
    expect(plan.unavailableMetrics.map((m) => m.code)).toEqual([
      'STAFFING_COMPLETENESS',
      'REPLACEMENTS',
    ])
    for (const metric of plan.unavailableMetrics) {
      expect(metric.reason.length).toBeGreaterThan(0)
    }
  })
})
