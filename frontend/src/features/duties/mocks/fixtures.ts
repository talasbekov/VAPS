// Demo-сид «Плана дежурств» (§8.7: только синтетические данные). Реестр
// видов дежурств — НЕ хардкод в UI (§24.3), но и НЕ отдельный API-справочник:
// живёт в seed вместе со сменами (тот же demo-only статус, что весь runtime).
// Названия объектов — независимый набор от features/objects (ARCH-FE-013 не
// даёт фичам шарить mocks/, тот же принцип, что A26 у personnel/security-events).
import type { SeedContext } from '../../../shared/testing/mock-runtime/seed-context'
import type { DutyShift, DutyTypeDefinition } from '../model/types'

export interface DutiesSlice {
  dutyTypes: DutyTypeDefinition[]
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

export function buildDutiesSeed(ctx: SeedContext): { sliceName: string; data: DutiesSlice } {
  const now = ctx.clock.now()
  const businessDate = ctx.clock.businessDate()

  const shifts: DutyShift[] = [
    {
      id: ctx.ids.next('duty-shift'),
      businessDate,
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      target: { targetType: 'OWN_OBJECT', objectId: 'duty-object-1', safeLabel: 'Штаб управления' },
      employeeName: 'Ахметов Б.',
      stateCode: 'ACTIVE',
      acknowledgedAt: now,
      actualStart: now,
      actualEnd: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('duty-shift'),
      businessDate,
      dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
      target: { targetType: 'PROTECTED_OBJECT', objectId: 'duty-object-2', safeLabel: 'Дворец Независимости' },
      employeeName: 'Ерланов Д.',
      stateCode: 'ACKNOWLEDGED',
      acknowledgedAt: now,
      actualStart: null,
      actualEnd: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('duty-shift'),
      businessDate,
      dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
      target: { targetType: 'PROTECTED_OBJECT', objectId: 'duty-object-3', safeLabel: 'Дом Министерств' },
      employeeName: 'Сагинова А.',
      stateCode: 'PLANNED',
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('duty-shift'),
      businessDate,
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      target: { targetType: 'OWN_OBJECT', objectId: 'duty-object-1', safeLabel: 'Штаб управления' },
      employeeName: 'Оразов К.',
      stateCode: 'COMPLETED',
      acknowledgedAt: now,
      actualStart: now,
      actualEnd: now,
      updatedAt: now,
    },
  ]

  return { sliceName: 'duties', data: { dutyTypes: [...DUTY_TYPES], shifts } }
}
