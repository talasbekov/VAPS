// @vitest-environment node
// Чистая модель месячного плана (§21.27-21.30, §21.34-21.35) — без DOM.
import { describe, expect, it } from 'vitest'
import {
  addDays,
  buildEmployeeRows,
  buildMonthlyPlan,
  daysBetween,
  daysInMonth,
  detectConflicts,
  isValidMonth,
  overlapMessage,
  restMessage,
} from './monthlyPlan'
import type { ConflictPolicy, DutyShift, DutyTypeDefinition } from '../model/types'

const OWN_TYPE: DutyTypeDefinition = {
  dutyTypeCode: 'OWN_OBJECT_DAILY',
  safeLabel: 'Суточное дежурство на собственном объекте',
  targetType: 'OWN_OBJECT',
  defaultDurationMinutes: 1440,
  requiresSenior: true,
  restAfterMinutes: 1440,
  requiresCurrentPassport: false,
}

const PROTECTED_TYPE: DutyTypeDefinition = {
  dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
  safeLabel: 'Суточное дежурство на охраняемом объекте',
  targetType: 'PROTECTED_OBJECT',
  defaultDurationMinutes: 1440,
  requiresSenior: false,
  restAfterMinutes: 1440,
  requiresCurrentPassport: true,
}

const TYPES = [OWN_TYPE, PROTECTED_TYPE]

// §21.35: режим отдыха — ГЛОБАЛЬНАЯ политика (владелец — «Настройки» §29), а
// не свойство вида дежурства. Версия у проб разная, чтобы её подмена в коде
// была заметна.
const HARD_POLICY: ConflictPolicy = {
  restAfterDutyMode: 'HARD_BLOCK',
  conflictPolicyVersion: 'conflict-rules-test.7',
}
const SOFT_POLICY: ConflictPolicy = {
  restAfterDutyMode: 'SOFT_OVERRIDE',
  conflictPolicyVersion: 'conflict-rules-test.9',
}

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
  employeeId: null,
  unitId: null,
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
      HARD_POLICY,
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].code).toBe('DUTY_OVERLAP')
    expect(conflicts[0].severity).toBe('HARD')
    expect(conflicts[0].message).toBe(overlapMessage('Жумабаев Р.', '2026-07-22', 2))
  })

  it('severity отдыха задаёт ДЕЙСТВУЮЩАЯ политика, а не вид дежурства', () => {
    // Одни и те же две смены ОДНОГО вида: меняется только политика — меняется
    // severity. Это и есть перенос владения §21.35: режим больше не свойство
    // вида, а глобальное значение из «Настроек» (§29).
    const pair = [shift('a', '2026-07-24', 'Сейтказы М.'), shift('b', '2026-07-25', 'Сейтказы М.')]

    const hard = detectConflicts(pair, TYPES, HARD_POLICY)
    expect(hard.map((c) => [c.code, c.severity])).toEqual([['REST_AFTER_DUTY', 'HARD']])
    expect(hard[0].message).toBe(restMessage('Сейтказы М.', '2026-07-24', '2026-07-25', 1440))
    // Версия правил стоит В САМОМ конфликте: он живёт дальше ответа.
    expect(hard[0].policyVersion).toBe('conflict-rules-test.7')

    const soft = detectConflicts(pair, TYPES, SOFT_POLICY)
    expect(soft.map((c) => [c.code, c.severity])).toEqual([['REST_AFTER_DUTY', 'SOFT']])
    expect(soft[0].policyVersion).toBe('conflict-rules-test.9')
  })

  it('вид дежурства на severity отдыха больше не влияет — режим один на все виды', () => {
    // Разные виды при ОДНОЙ политике дают ОДИНАКОВУЮ severity. Проба ловит
    // возврат к прежнему владению: пока режим лежал у вида, охраняемый объект
    // давал SOFT там, где собственный давал HARD.
    const own = detectConflicts(
      [shift('a', '2026-07-24', 'Сейтказы М.'), shift('b', '2026-07-25', 'Сейтказы М.')],
      TYPES,
      SOFT_POLICY,
    )
    const protectedObject = detectConflicts(
      [
        shift('c', '2026-07-15', 'Нурланов Е.', { dutyTypeCode: 'PROTECTED_OBJECT_DAILY' }),
        shift('d', '2026-07-16', 'Нурланов Е.', { dutyTypeCode: 'PROTECTED_OBJECT_DAILY' }),
      ],
      TYPES,
      SOFT_POLICY,
    )
    expect(own.map((c) => c.severity)).toEqual(['SOFT'])
    expect(protectedObject.map((c) => c.severity)).toEqual(['SOFT'])
  })

  it('сутки паузы закрывают требование отдыха в 24 часа', () => {
    const conflicts = detectConflicts(
      [shift('a', '2026-07-24', 'Сейтказы М.'), shift('b', '2026-07-26', 'Сейтказы М.')],
      TYPES,
      HARD_POLICY,
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
      HARD_POLICY,
    )
    expect(conflicts).toEqual([])
  })

  it('разные сотрудники в один день конфликтом не являются', () => {
    const conflicts = detectConflicts(
      [shift('a', '2026-07-22', 'Первый И.'), shift('b', '2026-07-22', 'Второй И.')],
      TYPES,
      HARD_POLICY,
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
    // Мягкий режим — чтобы в KPI были ОБА счётчика: при жёстком нарушение
    // отдыха тоже стало бы hard, и `softConflicts` не отличался бы от нуля ни
    // при какой ошибке подсчёта.
    const plan = buildMonthlyPlan('2026-07', SHIFTS, TYPES, SOFT_POLICY)
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
    const plan = buildMonthlyPlan('2026-07', SHIFTS, TYPES, HARD_POLICY)
    expect(plan.days).toHaveLength(31)
    const total = plan.rows.flatMap((row) => row.cells).reduce((sum, c) => sum + c.shiftCount, 0)
    expect(total).toBe(4)

    const august = buildMonthlyPlan('2026-08', SHIFTS, TYPES, HARD_POLICY)
    expect(august.kpi.shifts).toBe(1)
    expect(august.rows).toHaveLength(1)
  })

  it('конфликт отмечен именно в той ячейке объекта и дня, где он возник', () => {
    const plan = buildMonthlyPlan('2026-07', SHIFTS, TYPES, HARD_POLICY)
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
    const july = buildMonthlyPlan('2026-07', crossMonth, TYPES, HARD_POLICY)
    expect(july.conflicts.map((c) => c.businessDate)).toEqual(['2026-07-01'])
    expect(july.kpi.hardConflicts).toBe(1)

    // В июне конфликт не дублируется: он проявляется в день второго дежурства.
    const june = buildMonthlyPlan('2026-06', crossMonth, TYPES, HARD_POLICY)
    expect(june.conflicts).toEqual([])
  })

  it('пустой месяц — пустая сетка и нулевые KPI, но дни всё равно перечислены', () => {
    const plan = buildMonthlyPlan('2026-09', SHIFTS, TYPES, HARD_POLICY)
    expect(plan.rows).toEqual([])
    expect(plan.days).toHaveLength(30)
    expect(plan.kpi.shifts).toBe(0)
  })

  it('невыводимые показатели названы с причиной, а не показаны нулём', () => {
    const plan = buildMonthlyPlan('2026-07', SHIFTS, TYPES, HARD_POLICY)
    expect(plan.unavailableMetrics.map((m) => m.code)).toEqual([
      'STAFFING_COMPLETENESS',
      'REPLACEMENTS',
    ])
    for (const metric of plan.unavailableMetrics) {
      expect(metric.reason.length).toBeGreaterThan(0)
    }
  })
})

// §21.30 «По сотрудникам — матрица доступности». Из шести слоёв промпта модель
// даёт четыре; проверяется и то, что они посчитаны верно, и то, что остальные
// два названы, а не молчат.
describe('buildEmployeeRows (§21.30)', () => {
  const REST_TYPES: DutyTypeDefinition[] = [
    {
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      safeLabel: 'Собственный объект',
      targetType: 'OWN_OBJECT',
      defaultDurationMinutes: 1440,
      requiresSenior: true,
      restAfterMinutes: 1440,
      requiresCurrentPassport: false,
    },
    {
      dutyTypeCode: 'LONG_REST',
      safeLabel: 'Вид с трёхсуточным отдыхом',
      targetType: 'PROTECTED_OBJECT',
      defaultDurationMinutes: 1440,
      requiresSenior: false,
      // 3 суток: если бы отдых был захардкожен сутками, хвост был бы короче.
      restAfterMinutes: 3 * 24 * 60,
      requiresCurrentPassport: false,
    },
  ]

  function empShift(
    id: string,
    businessDate: string,
    employeeName: string,
    overrides: Partial<DutyShift> = {},
  ): DutyShift {
    return {
      id,
      businessDate,
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      target: { targetType: 'OWN_OBJECT', objectId: 'object-1', safeLabel: 'Штаб управления' },
      employeeName,
      stateCode: 'PLANNED',
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: `${businessDate}T08:00:00+05:00`,
      passportBinding: null,
      note: null,
      cancellation: null,
      overrideReason: null,
      employeeId: null,
      unitId: null,
      ...overrides,
    }
  }

  function cellOf(rows: ReturnType<typeof buildEmployeeRows>, name: string, date: string) {
    return rows.find((row) => row.employeeName === name)?.cells.find((cell) => cell.date === date)
  }

  it('день дежурства — слой DUTY, следующий день — хвост обязательного отдыха', () => {
    const rows = buildEmployeeRows(
      '2026-07',
      [empShift('duty-1', '2026-07-10', 'Ахметов Б.')],
      REST_TYPES,
      [],
    )
    expect(cellOf(rows, 'Ахметов Б.', '2026-07-10')).toMatchObject({ layer: 'DUTY', dutyCount: 1 })
    expect(cellOf(rows, 'Ахметов Б.', '2026-07-11')).toMatchObject({ layer: 'REST' })
    expect(cellOf(rows, 'Ахметов Б.', '2026-07-12')).toMatchObject({ layer: 'FREE' })
  })

  it('длина отдыха читается у ВИДА дежурства, а не равна суткам', () => {
    const rows = buildEmployeeRows(
      '2026-07',
      [empShift('duty-1', '2026-07-10', 'Ахметов Б.', { dutyTypeCode: 'LONG_REST' })],
      REST_TYPES,
      [],
    )
    for (const date of ['2026-07-11', '2026-07-12', '2026-07-13']) {
      expect(cellOf(rows, 'Ахметов Б.', date)).toMatchObject({ layer: 'REST' })
    }
    expect(cellOf(rows, 'Ахметов Б.', '2026-07-14')).toMatchObject({ layer: 'FREE' })
  })

  it('вид дежурства вне реестра отдыха не навязывает', () => {
    const rows = buildEmployeeRows(
      '2026-07',
      [empShift('duty-1', '2026-07-10', 'Ахметов Б.', { dutyTypeCode: 'UNKNOWN' })],
      REST_TYPES,
      [],
    )
    expect(cellOf(rows, 'Ахметов Б.', '2026-07-11')).toMatchObject({ layer: 'FREE' })
  })

  it('хвост отдыха из ПРЕДЫДУЩЕГО месяца попадает в первые дни текущего', () => {
    const rows = buildEmployeeRows(
      '2026-07',
      [empShift('duty-1', '2026-06-30', 'Ахметов Б.')],
      REST_TYPES,
      [],
    )
    expect(cellOf(rows, 'Ахметов Б.', '2026-07-01')).toMatchObject({ layer: 'REST' })
  })

  it('дежурство доминирует над отдыхом: в день второй смены слой DUTY, не REST', () => {
    const rows = buildEmployeeRows(
      '2026-07',
      [
        empShift('duty-1', '2026-07-10', 'Ахметов Б.'),
        empShift('duty-2', '2026-07-11', 'Ахметов Б.'),
      ],
      REST_TYPES,
      [],
    )
    expect(cellOf(rows, 'Ахметов Б.', '2026-07-11')).toMatchObject({ layer: 'DUTY' })
  })

  it('конфликты приходят ГОТОВЫМИ и раскладываются по клеткам, а не выводятся заново', () => {
    const rows = buildEmployeeRows(
      '2026-07',
      [empShift('duty-1', '2026-07-10', 'Ахметов Б.')],
      REST_TYPES,
      // Конфликт, которого сама матрица вывести НЕ могла бы: одна смена в дне.
      [
        {
          conflictId: 'x',
          code: 'DUTY_OVERLAP',
          severity: 'SOFT',
          employeeName: 'Ахметов Б.',
          policyVersion: null,
          businessDate: '2026-07-10',
          message: 'внешний конфликт',
        },
      ],
    )
    expect(cellOf(rows, 'Ахметов Б.', '2026-07-10')).toMatchObject({
      hardConflictCount: 0,
      softConflictCount: 1,
    })
  })

  it('«неполные данные» — смена без привязки к версии паспорта', () => {
    const bound = empShift('duty-2', '2026-07-12', 'Оразов К.', {
      passportBinding: {
        objectId: 'object-1',
        objectName: 'Штаб управления',
        versionId: 'v1',
        versionNumber: 1,
        effectiveFrom: '2026-01-01',
        sectorId: 'sector-a',
        sectorName: 'Сектор A',
        postId: 'post-1',
        postName: 'КПП-1',
        boundAt: '2026-07-12T08:00:00+05:00',
      },
    })
    const rows = buildEmployeeRows(
      '2026-07',
      [empShift('duty-1', '2026-07-10', 'Ахметов Б.'), bound],
      REST_TYPES,
      [],
    )
    expect(cellOf(rows, 'Ахметов Б.', '2026-07-10')?.incompleteData).toBe(true)
    expect(cellOf(rows, 'Оразов К.', '2026-07-12')?.incompleteData).toBe(false)
  })

  it('отменённая смена не занимает сотрудника и не тянет за собой отдых', () => {
    const rows = buildEmployeeRows(
      '2026-07',
      [
        empShift('duty-1', '2026-07-10', 'Ахметов Б.', {
          stateCode: 'CANCELLED',
          cancellation: { reason: 'x', cancelledAt: '2026-07-09T10:00:00+05:00' },
        }),
        empShift('duty-2', '2026-07-20', 'Оразов К.'),
      ],
      REST_TYPES,
      [],
    )
    expect(rows.map((row) => row.employeeName)).toEqual(['Оразов К.'])
  })

  it('сотрудник без занятости в месяце строки не получает', () => {
    const rows = buildEmployeeRows(
      '2026-07',
      [empShift('duty-1', '2026-05-10', 'Ахметов Б.')],
      REST_TYPES,
      [],
    )
    expect(rows).toEqual([])
  })

  it('§35: два невыводимых слоя §21.30 названы с причиной', () => {
    const plan = buildMonthlyPlan('2026-07', [], [], HARD_POLICY)
    expect(plan.unavailableLayers.map((layer) => layer.code)).toEqual([
      'SECURITY_EVENT_LAYER',
      'HR_UNAVAILABILITY_LAYER',
    ])
    expect(plan.unavailableLayers.every((layer) => layer.reason.length > 0)).toBe(true)
  })
})
