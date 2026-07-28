// Demo-сид «Плана дежурств» (§8.7: только синтетические данные). Реестр
// видов дежурств — НЕ хардкод в UI (§24.3), но и НЕ отдельный API-справочник:
// живёт в seed вместе со сменами (тот же demo-only статус, что весь runtime).
// Названия объектов — независимый набор от features/objects (ARCH-FE-013 не
// даёт фичам шарить mocks/, тот же принцип, что A26 у personnel/security-events).
import type { SeedContext } from '../../../shared/testing/mock-runtime/seed-context'
import { addDaysIso } from '../model/calendar'
import type {
  DutyRosterEntry,
  DutyShift,
  DutyTarget,
  DutyTypeDefinition,
} from '../model/types'

export interface DutiesSlice {
  dutyTypes: DutyTypeDefinition[]
  targets: DutyTarget[]
  roster: DutyRosterEntry[]
  shifts: DutyShift[]
}

export const DUTY_TYPES: readonly DutyTypeDefinition[] = [
  {
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    safeLabel: 'Суточное дежурство на собственном объекте',
    targetType: 'OWN_OBJECT',
    defaultDurationMinutes: 24 * 60,
    requiresSenior: true,
  },
  {
    dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
    safeLabel: 'Суточное дежурство на охраняемом объекте',
    targetType: 'PROTECTED_OBJECT',
    defaultDurationMinutes: 24 * 60,
    requiresSenior: false,
  },
]

export const DUTY_TARGETS: readonly DutyTarget[] = [
  { objectId: 'duty-object-1', targetType: 'OWN_OBJECT', safeLabel: 'Штаб управления' },
  { objectId: 'duty-object-2', targetType: 'PROTECTED_OBJECT', safeLabel: 'Дворец Независимости' },
  { objectId: 'duty-object-3', targetType: 'PROTECTED_OBJECT', safeLabel: 'Дом Министерств' },
]

/**
 * Кадровый снимок duties (свой, не общий с personnel — ARCH-FE-013). Смена
 * ссылается на ростер по `employeeId`, а не по строке имени: правила
 * конфликтов не должны зависеть от совпадения ФИО.
 */
export const DUTY_ROSTER: readonly DutyRosterEntry[] = [
  { employeeId: 'duty-emp-1', fullName: 'Ахметов Б.', unitLabel: 'Штабная группа' },
  { employeeId: 'duty-emp-2', fullName: 'Ерланов Д.', unitLabel: 'Физическая охрана' },
  { employeeId: 'duty-emp-3', fullName: 'Сагинова А.', unitLabel: 'Физическая охрана' },
  { employeeId: 'duty-emp-4', fullName: 'Оразов К.', unitLabel: 'Штабная группа' },
  { employeeId: 'duty-emp-5', fullName: 'Мукашева Л.', unitLabel: 'Резерв' },
]

interface SeedShiftSpec {
  dayOffset: number
  dutyTypeCode: string
  objectId: string
  employeeId: string
  stateCode: DutyShift['stateCode']
}

// Смены разнесены по неделе (не только на «сегодня»): иначе календарь
// «Сотрудники × дни» показывал бы один заполненный столбец из семи, и
// недельная навигация ‹/› не имела бы что показать.
const SEED_SHIFTS: readonly SeedShiftSpec[] = [
  { dayOffset: -2, dutyTypeCode: 'OWN_OBJECT_DAILY', objectId: 'duty-object-1', employeeId: 'duty-emp-4', stateCode: 'COMPLETED' },
  { dayOffset: -1, dutyTypeCode: 'PROTECTED_OBJECT_DAILY', objectId: 'duty-object-2', employeeId: 'duty-emp-3', stateCode: 'COMPLETED' },
  { dayOffset: 0, dutyTypeCode: 'OWN_OBJECT_DAILY', objectId: 'duty-object-1', employeeId: 'duty-emp-1', stateCode: 'ACTIVE' },
  { dayOffset: 0, dutyTypeCode: 'PROTECTED_OBJECT_DAILY', objectId: 'duty-object-2', employeeId: 'duty-emp-2', stateCode: 'ACKNOWLEDGED' },
  { dayOffset: 1, dutyTypeCode: 'PROTECTED_OBJECT_DAILY', objectId: 'duty-object-3', employeeId: 'duty-emp-3', stateCode: 'PLANNED' },
  { dayOffset: 2, dutyTypeCode: 'OWN_OBJECT_DAILY', objectId: 'duty-object-1', employeeId: 'duty-emp-5', stateCode: 'PLANNED' },
  { dayOffset: 3, dutyTypeCode: 'PROTECTED_OBJECT_DAILY', objectId: 'duty-object-2', employeeId: 'duty-emp-1', stateCode: 'PLANNED' },
]

export function buildDutiesSeed(ctx: SeedContext): { sliceName: string; data: DutiesSlice } {
  const now = ctx.clock.now()
  const businessDate = ctx.clock.businessDate()

  const shifts: DutyShift[] = SEED_SHIFTS.map((spec) => {
    const target = DUTY_TARGETS.find((t) => t.objectId === spec.objectId)
    const employee = DUTY_ROSTER.find((e) => e.employeeId === spec.employeeId)
    if (target === undefined || employee === undefined) {
      throw new Error(
        `duties seed: неизвестная цель/сотрудник в SEED_SHIFTS (${spec.objectId}/${spec.employeeId})`,
      )
    }
    const started = spec.stateCode === 'ACTIVE' || spec.stateCode === 'COMPLETED'
    return {
      id: ctx.ids.next('duty-shift'),
      businessDate: addDaysIso(businessDate, spec.dayOffset),
      dutyTypeCode: spec.dutyTypeCode,
      target: { ...target },
      employeeId: employee.employeeId,
      employeeName: employee.fullName,
      stateCode: spec.stateCode,
      acknowledgedAt: spec.stateCode === 'PLANNED' ? null : now,
      actualStart: started ? now : null,
      actualEnd: spec.stateCode === 'COMPLETED' ? now : null,
      updatedAt: now,
    }
  })

  return {
    sliceName: 'duties',
    data: {
      dutyTypes: [...DUTY_TYPES],
      targets: [...DUTY_TARGETS],
      roster: [...DUTY_ROSTER],
      shifts,
    },
  }
}
