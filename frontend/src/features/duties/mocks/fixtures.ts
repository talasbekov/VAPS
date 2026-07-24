// Demo-сид «Плана дежурств» (§8.7: только синтетические данные). Реестр
// видов дежурств — НЕ хардкод в UI (§24.3), но и НЕ отдельный API-справочник:
// живёт в seed вместе со сменами (тот же demo-only статус, что весь runtime).
// Названия объектов — независимый набор от features/objects (ARCH-FE-013 не
// даёт фичам шарить mocks/, тот же принцип, что A26 у personnel/security-events).
import type { SeedContext } from '../../../shared/testing/mock-runtime/seed-context'
import type {
  CombatDutyShift,
  CombatDutyTypeDefinition,
  CombatRosterCandidate,
  DutyRoute,
  DutyShift,
  DutyTypeDefinition,
} from '../model/types'

export interface DutiesSlice {
  dutyTypes: DutyTypeDefinition[]
  shifts: DutyShift[]
  combatDutyTypes: CombatDutyTypeDefinition[]
  routes: DutyRoute[]
  rosterCandidates: CombatRosterCandidate[]
  combatShifts: CombatDutyShift[]
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

// §24.3: два минимальных вида дежурства боевой группы.
export const COMBAT_DUTY_TYPES: readonly CombatDutyTypeDefinition[] = [
  {
    dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
    safeLabel: 'Дежурство боевой группы на одной Трассе',
    supportsMultipleRoutes: false,
  },
  {
    dutyTypeCode: 'COMBAT_GROUP_MULTI_ROUTE',
    safeLabel: 'Дежурство боевой группы на нескольких Трассах',
    supportsMultipleRoutes: true,
  },
]

// §24.9-24.10: реестр Трасс, СВОЙ для features/duties (не «Аэропорт —
// Резиденция» текстом внутри routeSet — только стабильный routeId, см. §24.10).
export const ROUTES: readonly DutyRoute[] = [
  { routeId: 'route-1', safeLabel: 'Трасса №1 (Аэропорт — Резиденция)' },
  { routeId: 'route-2', safeLabel: 'Трасса №2 (Резиденция — Дворец Независимости)' },
  { routeId: 'route-3', safeLabel: 'Трасса №3 (Вокзал — Гостиница)' },
]

// Кандидаты в состав боевой группы — независимый снапшот (см. model/types.ts).
export const ROSTER_CANDIDATES: readonly CombatRosterCandidate[] = [
  { employeeName: 'Байжанов С.', unitName: '1-е боевое управление' },
  { employeeName: 'Дюсенов М.', unitName: '1-е боевое управление' },
  { employeeName: 'Кенжебаев А.', unitName: '1-е боевое управление' },
  { employeeName: 'Рахимов Т.', unitName: '2-е боевое управление' },
  { employeeName: 'Сарсенов Б.', unitName: '2-е боевое управление' },
  { employeeName: 'Тастанова Г.', unitName: '2-е боевое управление' },
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

  const combatShifts: CombatDutyShift[] = [
    {
      id: ctx.ids.next('combat-duty-shift'),
      businessDate,
      dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
      routeSet: {
        routeSetId: ctx.ids.next('duty-route-set'),
        safeLabel: 'Трасса №1',
        coverageMode: 'RESERVE',
        routeIds: ['route-1'],
      },
      submission: null,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('combat-duty-shift'),
      businessDate,
      dutyTypeCode: 'COMBAT_GROUP_MULTI_ROUTE',
      routeSet: {
        routeSetId: ctx.ids.next('duty-route-set'),
        safeLabel: 'Трассы №2-3',
        coverageMode: 'PARALLEL',
        routeIds: ['route-2', 'route-3'],
      },
      submission: {
        submittedByUnitName: '2-е боевое управление',
        groupLeaderEmployeeName: 'Рахимов Т.',
        memberEmployeeNames: ['Сарсенов Б.'],
        reserveEmployeeNames: ['Тастанова Г.'],
        stateCode: 'SUBMITTED',
        returnReason: null,
        submittedAt: now,
        updatedAt: now,
      },
      updatedAt: now,
    },
  ]

  return {
    sliceName: 'duties',
    data: {
      dutyTypes: [...DUTY_TYPES],
      shifts,
      combatDutyTypes: [...COMBAT_DUTY_TYPES],
      routes: [...ROUTES],
      rosterCandidates: [...ROSTER_CANDIDATES],
      combatShifts,
    },
  }
}
