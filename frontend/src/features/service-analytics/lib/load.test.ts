// Чистый расчёт нагрузки §22.9 — env node, ни DOM, ни сети.
import { describe, expect, it } from 'vitest'
import type { AnalyticsSource, AnalyticsSourceShift } from './analytics'
import type { LoadPolicyView } from './load'
import { buildLoadAnalytics } from './load'

const BUSINESS_DATE = '2026-07-24'

const POLICY: LoadPolicyView = {
  periodDays: 28,
  warningMinutes: 2800,
  overloadMinutes: 4200,
  policyVersion: 'LOAD-POLICY-test.1',
}

function shift(overrides: Partial<AnalyticsSourceShift> = {}): AnalyticsSourceShift {
  return {
    id: 'shift-1',
    businessDate: BUSINESS_DATE,
    employeeName: 'Ерланов Д.',
    employeeId: 'employee-1',
    unitId: 'unit-guard-1',
    objectLabel: 'Штаб управления',
    stateCode: 'PLANNED',
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    actualStart: null,
    actualEnd: null,
    updatedAt: '2026-07-20T08:00:00+05:00',
    ...overrides,
  }
}

function source(shifts: AnalyticsSourceShift[]): AnalyticsSource {
  return {
    shifts,
    dutyTypes: [
      { dutyTypeCode: 'OWN_OBJECT_DAILY', restAfterMinutes: 1440, defaultDurationMinutes: 1440 },
    ],
    restMode: 'HARD_BLOCK',
    unitLabels: { 'unit-guard-1': '1-й отдел охраны' },
  }
}

describe('buildLoadAnalytics (§22.9)', () => {
  it('план и факт считаются РАЗДЕЛЬНО: план у PLANNED есть, факт — только у COMPLETED с интервалом', () => {
    const view = buildLoadAnalytics(
      source([
        shift({ id: 'a', stateCode: 'PLANNED' }),
        shift({
          id: 'b',
          businessDate: '2026-07-20',
          stateCode: 'COMPLETED',
          actualStart: '2026-07-20T08:00:00+05:00',
          actualEnd: '2026-07-20T20:30:00+05:00',
        }),
      ]),
      POLICY,
      BUSINESS_DATE,
    )
    const row = view.employees[0]
    // План: обе смены по виду (2 × 1440). Факт: только 12,5 часа второй —
    // план НЕ подставлен вместо факта ни в одну сторону.
    expect(row?.plannedMinutes).toBe(2880)
    expect(row?.actualMinutes).toBe(750)
  })

  it('состояние красится по ПЛАНОВОЙ сумме порогами политики; причины — кодами', () => {
    const normal = buildLoadAnalytics(source([shift()]), POLICY, BUSINESS_DATE)
    expect(normal.employees[0]?.loadState).toBe('NORMAL')
    expect(normal.employees[0]?.safeReasonCodes).toEqual([])

    const warning = buildLoadAnalytics(
      source([shift({ id: 'a' }), shift({ id: 'b', businessDate: '2026-07-23' })]),
      POLICY,
      BUSINESS_DATE,
    )
    expect(warning.employees[0]?.loadState).toBe('WARNING')
    expect(warning.employees[0]?.safeReasonCodes).toEqual(['PLANNED_WARNING'])

    const overloaded = buildLoadAnalytics(
      source([
        shift({ id: 'a' }),
        shift({ id: 'b', businessDate: '2026-07-23' }),
        shift({ id: 'c', businessDate: '2026-07-22' }),
      ]),
      POLICY,
      BUSINESS_DATE,
    )
    expect(overloaded.employees[0]?.loadState).toBe('OVERLOADED')
    expect(overloaded.employees[0]?.safeReasonCodes).toEqual(['PLANNED_OVERLOAD'])
  })

  it('отменённая смена не входит ни в план, ни в факт', () => {
    const view = buildLoadAnalytics(
      source([
        shift({ id: 'a' }),
        shift({
          id: 'b',
          businessDate: '2026-07-23',
          stateCode: 'CANCELLED',
          actualStart: '2026-07-23T08:00:00+05:00',
          actualEnd: '2026-07-23T20:00:00+05:00',
        }),
      ]),
      POLICY,
      BUSINESS_DATE,
    )
    expect(view.employees[0]?.plannedMinutes).toBe(1440)
    expect(view.employees[0]?.actualMinutes).toBe(0)
  })

  it('смена за пределами окна политики в сумму не входит', () => {
    const view = buildLoadAnalytics(
      source([
        shift({ id: 'a' }),
        // 28-суточное окно от 2026-07-24 начинается 2026-06-27.
        shift({ id: 'b', businessDate: '2026-06-26' }),
      ]),
      POLICY,
      BUSINESS_DATE,
    )
    expect(view.employees[0]?.plannedMinutes).toBe(1440)
  })

  it('без политики — UNKNOWN и null, а не нули и не «нормально»', () => {
    const view = buildLoadAnalytics(source([shift()]), null, BUSINESS_DATE)
    const row = view.employees[0]
    expect(row?.loadState).toBe('UNKNOWN')
    expect(row?.plannedMinutes).toBeNull()
    expect(row?.actualMinutes).toBeNull()
    expect(row?.safeReasonCodes).toEqual(['POLICY_UNDEFINED'])
    expect(row?.policyVersion).toBeNull()
  })

  it('смена без установленной связи §22.9 не приписывается никому и видна счётчиком', () => {
    const view = buildLoadAnalytics(
      source([shift({ id: 'a' }), shift({ id: 'b', businessDate: '2026-07-23', employeeId: null, unitId: null })]),
      POLICY,
      BUSINESS_DATE,
    )
    // Сумма связанного человека НЕ вобрала чужую смену.
    expect(view.employees[0]?.plannedMinutes).toBe(1440)
    expect(view.unlinkedShiftsCount).toBe(1)
  })

  it('строки подразделений агрегируют людей и подписываются справочником, порядок — по подписи', () => {
    const view = buildLoadAnalytics(
      source([
        shift({ id: 'a' }),
        shift({
          id: 'b',
          employeeId: 'employee-2',
          employeeName: 'Абишев Н.',
          unitId: 'unit-guard-3',
        }),
      ]),
      POLICY,
      BUSINESS_DATE,
    )
    expect(view.units.map((unit) => unit.safeLabel)).toEqual(['1-й отдел охраны', 'unit-guard-3'])
    // Порядок сотрудников — по подписи, и он НЕ совпадает с порядком по
    // нагрузке (нагрузки равны — сортировка по величине неотличима; подписи
    // разные): Абишев раньше Ерланова.
    expect(view.employees.map((employee) => employee.safeLabel)).toEqual([
      'Абишев Н.',
      'Ерланов Д.',
    ])
  })

  it('ночные минуты всегда null — окна NIGHT-WINDOW-001 не существует', () => {
    const view = buildLoadAnalytics(source([shift()]), POLICY, BUSINESS_DATE)
    expect(view.employees[0]?.nightMinutes).toBeNull()
    expect(view.units[0]?.nightMinutes).toBeNull()
  })
})
