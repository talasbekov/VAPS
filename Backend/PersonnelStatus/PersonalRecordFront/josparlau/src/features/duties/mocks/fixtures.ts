// Demo-сид «Плана дежурств» (§8.7: только синтетические данные). Реестр
// видов дежурств — НЕ хардкод в UI (§24.3), но и НЕ отдельный API-справочник:
// живёт в seed вместе со сменами (тот же demo-only статус, что весь runtime).
// Названия объектов задаются здесь (ARCH-FE-013 не даёт фичам шарить mocks/,
// тот же принцип, что A26 у personnel/security-events), но с §9.6 сид
// ДОСВЯЗЫВАЕТ их с реальными объектами реестра по имени через
// `ctx.builtSlices` — иначе дежурство ссылалось бы на выдуманный objectId и
// привязка к версии паспорта была бы недостижима в демо.
import type { SeedContext } from '../../../shared/testing/mock-runtime/seed-context'
import type {
  CombatDutyShift,
  CombatDutyTypeDefinition,
  CombatRosterCandidate,
  DutyCandidate,
  DutyPassportBinding,
  DutyRoute,
  DutyShift,
  DutyTypeDefinition,
  MonthlyPlanRecord,
} from '../model/types'
import { addDays } from '../lib/monthlyPlan'
import type { DutyObjectProjection } from '../lib/passportBinding'
import {
  bindDutyPost,
  firstPostOfVersion,
  resolveApplicableVersion,
} from '../lib/passportBinding'
import { findObjectByName, readObjectsProjection } from './objectsSlice'

export interface DutiesSlice {
  dutyTypes: DutyTypeDefinition[]
  shifts: DutyShift[]
  combatDutyTypes: CombatDutyTypeDefinition[]
  routes: DutyRoute[]
  rosterCandidates: CombatRosterCandidate[]
  combatShifts: CombatDutyShift[]
  /** §21.33 — кандидаты на ИНДИВИДУАЛЬНОЕ дежурство (см. `DUTY_CANDIDATES`). */
  dutyCandidates: DutyCandidate[]
  /** §21.27 — планы по месяцам, ключ `month`. Пусто в сиде: план появляется
   * только после того, как человек сформировал черновик. */
  monthlyPlans: MonthlyPlanRecord[]
}

export const DUTY_TYPES: readonly DutyTypeDefinition[] = [
  {
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    safeLabel: 'Суточное дежурство на собственном объекте',
    targetType: 'OWN_OBJECT',
    defaultDurationMinutes: 24 * 60,
    requiresSenior: true,
    // §21.35: СРОК обязательного отдыха — атрибут вида дежурства, а не
    // константа в коде. РЕЖИМ (`REST_AFTER_DUTY_POLICY`) здесь больше не
    // задаётся: он глобальный и живёт в правилах конфликтов «Настроек» (§29).
    restAfterMinutes: 24 * 60,
    // §21.31: собственный объект — свой периметр, красный паспорт заступление
    // не блокирует…
    requiresCurrentPassport: false,
  },
  {
    dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
    safeLabel: 'Суточное дежурство на охраняемом объекте',
    targetType: 'PROTECTED_OBJECT',
    defaultDurationMinutes: 24 * 60,
    requiresSenior: false,
    // Срок тот же; насколько строгим будет нарушение отдыха, решает
    // действующая политика, а не вид дежурства (§21.34: frontend severity не
    // выводит сам).
    restAfterMinutes: 24 * 60,
    // …а охраняемый объект без актуального паспорта под охрану не берут.
    requiresCurrentPassport: true,
  },
]

/**
 * §21.33 — кандидаты на индивидуальное дежурство. Список НАМЕРЕННО включает
 * всех сотрудников уже засеянных смен: иначе «ближайшая занятость» у каждого
 * кандидата была бы пустой и признак выглядел бы нерабочим. Два последних
 * никуда не назначены — ровно на них проверяется исход «занятости нет».
 *
 * ⚠️ Не пересекается с `ROSTER_CANDIDATES` (боевые группы): §24.11 требует
 * различать боевые группы и суточные дежурства, и общий список склеил бы два
 * разных процесса по ФИО (та же ловушка, что A44-A46/A50).
 */
export const DUTY_CANDIDATES: readonly DutyCandidate[] = [
  // §22.9: у кандидата устойчивый employeeId. Общие с оцениваемым набором
  // рейтинга люди носят ЕГО id (A146: id общий, пока это один человек);
  // остальные — своё пространство duty-emp-*. unitId — доменный ключ
  // подразделения, подпись остаётся подписью.
  { employeeId: 'duty-emp-1', employeeName: 'Ахметов Б.', unitId: 'unit-guard-1', unitName: '1-й отдел охраны', positionName: 'Старший инспектор' },
  { employeeId: 'employee-1', employeeName: 'Ерланов Д.', unitId: 'unit-guard-1', unitName: '1-й отдел охраны', positionName: 'Инспектор' },
  { employeeId: 'duty-emp-2', employeeName: 'Сагинова А.', unitId: 'unit-guard-2', unitName: '2-й отдел охраны', positionName: 'Инспектор' },
  { employeeId: 'duty-emp-3', employeeName: 'Оразов К.', unitId: 'unit-guard-2', unitName: '2-й отдел охраны', positionName: 'Старший инспектор' },
  { employeeId: 'employee-4', employeeName: 'Нурланов Е.', unitId: 'unit-guard-2', unitName: '2-й отдел охраны', positionName: 'Инспектор' },
  { employeeId: 'duty-emp-4', employeeName: 'Жумабаев Р.', unitId: 'unit-guard-3', unitName: '3-й отдел охраны', positionName: 'Инспектор' },
  { employeeId: 'employee-3', employeeName: 'Сейтказы М.', unitId: 'unit-guard-3', unitName: '3-й отдел охраны', positionName: 'Инспектор' },
  { employeeId: 'employee-2', employeeName: 'Абишев Н.', unitId: 'unit-guard-3', unitName: '3-й отдел охраны', positionName: 'Инспектор' },
  { employeeId: 'duty-emp-5', employeeName: 'Мукашева Л.', unitId: 'unit-guard-1', unitName: '1-й отдел охраны', positionName: 'Инспектор' },
]

/** Связь сеяной смены с кандидатом — по СВОЕМУ справочнику на этапе сида.
 * Падает громко: смена с именем вне справочника в сиде — ошибка фикстуры,
 * а не «историческая запись» (те появляются только через живые данные). */
function candidateLink(employeeName: string): { employeeId: string; unitId: string } {
  const found = DUTY_CANDIDATES.find((c) => c.employeeName === employeeName)
  if (found === undefined) {
    throw new Error(`duties seed: "${employeeName}" нет в справочнике кандидатов`)
  }
  return { employeeId: found.employeeId, unitId: found.unitId }
}

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

interface SeedTarget {
  objectId: string
  passportBinding: DutyPassportBinding | null
}

/**
 * §9.6 для demo-сида: объект ищется в реестре по имени, дальше — действующая
 * на дату версия и её первый пост. Все три исхода остаются достижимыми и ни
 * один не роняет сид: объекта нет в реестре (остаётся демонстрационный
 * `fallbackObjectId`), объект есть без опубликованной версии, объект с
 * действующей версией. Гвард на присутствие всех трёх — compose-seed.test.ts.
 */
function resolveSeedTarget(
  objects: readonly DutyObjectProjection[],
  objectName: string,
  fallbackObjectId: string,
  businessDate: string,
  boundAt: string,
): SeedTarget {
  const object = findObjectByName(objects, objectName)
  if (object === null) {
    return { objectId: fallbackObjectId, passportBinding: null }
  }
  const version = resolveApplicableVersion(object, businessDate)
  const first = version === null ? null : firstPostOfVersion(version)
  return {
    objectId: object.id,
    passportBinding:
      version === null || first === null
        ? null
        : bindDutyPost(object, version, first.sector.id, first.post.id, boundAt),
  }
}

export function buildDutiesSeed(ctx: SeedContext): { sliceName: string; data: DutiesSlice } {
  const now = ctx.clock.now()
  const businessDate = ctx.clock.businessDate()

  // ⚠️ Читает ЧУЖОЙ слайс — работает только пока `objects` построен РАНЬШЕ
  // duties в реестре compose-seed.ts (порядок держит тест, не комментарий).
  const objects = readObjectsProjection(ctx.builtSlices)
  // «Штаб управления» — собственный объект, в реестре объектов его нет:
  // демонстрирует исход «объект вне реестра».
  const hq = resolveSeedTarget(objects, 'Штаб управления', 'duty-object-1', businessDate, now)
  // Паспорт опубликован → дежурство привязано к версии, сектору и посту.
  const palace = resolveSeedTarget(
    objects,
    'Дворец Независимости',
    'duty-object-2',
    businessDate,
    now,
  )
  // Объект в реестре есть, опубликованных версий нет → привязки нет.
  const ministries = resolveSeedTarget(
    objects,
    'Дом Министерств',
    'duty-object-3',
    businessDate,
    now,
  )

  const shifts: DutyShift[] = [
    {
      id: ctx.ids.next('duty-shift'),
      businessDate,
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      target: { targetType: 'OWN_OBJECT', objectId: hq.objectId, safeLabel: 'Штаб управления' },
      employeeName: 'Ахметов Б.',
      ...candidateLink('Ахметов Б.'),
      stateCode: 'ACTIVE',
      acknowledgedAt: now,
      actualStart: now,
      actualEnd: null,
      updatedAt: now,
      passportBinding: hq.passportBinding,
      note: null,
      cancellation: null,
      overrideReason: null,
    },
    {
      id: ctx.ids.next('duty-shift'),
      businessDate,
      dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
      target: {
        targetType: 'PROTECTED_OBJECT',
        objectId: palace.objectId,
        safeLabel: 'Дворец Независимости',
      },
      employeeName: 'Ерланов Д.',
      ...candidateLink('Ерланов Д.'),
      stateCode: 'ACKNOWLEDGED',
      acknowledgedAt: now,
      actualStart: null,
      actualEnd: null,
      updatedAt: now,
      passportBinding: palace.passportBinding,
      note: null,
      cancellation: null,
      overrideReason: null,
    },
    {
      id: ctx.ids.next('duty-shift'),
      businessDate,
      dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
      target: {
        targetType: 'PROTECTED_OBJECT',
        objectId: ministries.objectId,
        safeLabel: 'Дом Министерств',
      },
      employeeName: 'Сагинова А.',
      ...candidateLink('Сагинова А.'),
      stateCode: 'PLANNED',
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: now,
      passportBinding: ministries.passportBinding,
      note: null,
      cancellation: null,
      overrideReason: null,
    },
    {
      id: ctx.ids.next('duty-shift'),
      businessDate,
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      target: { targetType: 'OWN_OBJECT', objectId: hq.objectId, safeLabel: 'Штаб управления' },
      employeeName: 'Оразов К.',
      ...candidateLink('Оразов К.'),
      stateCode: 'COMPLETED',
      acknowledgedAt: now,
      actualStart: now,
      actualEnd: now,
      updatedAt: now,
      passportBinding: hq.passportBinding,
      note: null,
      cancellation: null,
      overrideReason: null,
    },
  ]

  // §21.27-21.30: месячный план обязан показывать МЕСЯЦ, а не единственный
  // день, а §21.29 требует непустых KPI по конфликтам — поэтому кроме четырёх
  // смен на бизнес-дату сид раскладывает ещё шесть по соседним дням, давая
  // оба класса конфликтов §21.34: пересечение (всегда hard) и нарушение
  // обязательного отдыха (hard на собственном объекте, soft на охраняемом —
  // политика читается у вида дежурства, см. DUTY_TYPES выше).
  //
  // ⚠️ Сотрудники этих смен НЕ пересекаются с четвёркой выше и объект «Дом
  // Министерств» здесь не используется: e2e-локаторы вида
  // `locator('tr', { hasText: 'Дом Министерств' })` обязаны остаться
  // однозначными.
  const monthShift = (
    dayOffset: number,
    dutyTypeCode: 'OWN_OBJECT_DAILY' | 'PROTECTED_OBJECT_DAILY',
    objectName: string,
    fallbackObjectId: string,
    employeeName: string,
    stateCode: DutyShift['stateCode'],
  ): DutyShift => {
    const date = addDays(businessDate, dayOffset)
    const target = resolveSeedTarget(objects, objectName, fallbackObjectId, date, now)
    const completed = stateCode === 'COMPLETED'
    return {
      id: ctx.ids.next('duty-shift'),
      businessDate: date,
      dutyTypeCode,
      target: {
        targetType: dutyTypeCode === 'OWN_OBJECT_DAILY' ? 'OWN_OBJECT' : 'PROTECTED_OBJECT',
        objectId: target.objectId,
        safeLabel: objectName,
      },
      employeeName,
      ...candidateLink(employeeName),
      stateCode,
      acknowledgedAt: stateCode === 'PLANNED' ? null : now,
      actualStart: completed ? now : null,
      actualEnd: completed ? now : null,
      updatedAt: now,
      passportBinding: target.passportBinding,
      note: null,
      cancellation: null,
      overrideReason: null,
    }
  }

  const monthPlanShifts: DutyShift[] = [
    // Два дня подряд на охраняемом объекте → soft-конфликт отдыха.
    //
    // ⚠️ Все смены месячного плана лежат ПОСЛЕ бизнес-даты намеренно: дефолтный
    // день «Календаря смен» и дефолтный месяц этой вкладки берутся из первой по
    // дате загруженной смены (реального «сегодня» у фронта нет — demo-runtime
    // живёт по DemoClock). Смена раньше бизнес-даты увела бы дефолт календаря в
    // прошлое. Настоящий backend прислал бы бизнес-дату явно.
    monthShift(7, 'PROTECTED_OBJECT_DAILY', 'Дворец Независимости', 'duty-object-2', 'Нурланов Е.', 'COMPLETED'),
    monthShift(8, 'PROTECTED_OBJECT_DAILY', 'Дворец Независимости', 'duty-object-2', 'Нурланов Е.', 'COMPLETED'),
    // Два дежурства в ОДИН день на разных объектах → hard-конфликт.
    monthShift(2, 'OWN_OBJECT_DAILY', 'Штаб управления', 'duty-object-1', 'Жумабаев Р.', 'PLANNED'),
    monthShift(2, 'PROTECTED_OBJECT_DAILY', 'Дворец Независимости', 'duty-object-2', 'Жумабаев Р.', 'PLANNED'),
    // Два дня подряд на собственном объекте → hard-конфликт отдыха.
    monthShift(4, 'OWN_OBJECT_DAILY', 'Штаб управления', 'duty-object-1', 'Сейтказы М.', 'PLANNED'),
    monthShift(5, 'OWN_OBJECT_DAILY', 'Штаб управления', 'duty-object-1', 'Сейтказы М.', 'PLANNED'),
  ]
  shifts.push(...monthPlanShifts)

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
      requiredEmployees: 2,
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
        execution: null,
        replacements: [],
      },
      updatedAt: now,
      requiredEmployees: 2,
    },
    {
      id: ctx.ids.next('combat-duty-shift'),
      businessDate,
      dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
      routeSet: {
        routeSetId: ctx.ids.next('duty-route-set'),
        safeLabel: 'Трасса №2 (принятый состав)',
        coverageMode: 'RESERVE',
        routeIds: ['route-2'],
      },
      // §24.19-24.23: принятая группа с открытым execution — демонстрирует
      // ознакомление/заступление/факт без необходимости сначала подавать и
      // рассматривать состав вручную в каждом ручном/e2e прогоне. Состав
      // НЕ пересекается ни с «Трасса №1» (e2e подаёт Байжанов С./Дюсенов М.),
      // ни с «Трассы №2-3» (Рахимов Т./Сарсенов Б.) — иначе DOUBLE_ASSIGNMENT
      // (§24.17) заблокировал бы e2e-подачу на ту же businessDate.
      submission: {
        submittedByUnitName: '1-е боевое управление',
        groupLeaderEmployeeName: 'Кенжебаев А.',
        memberEmployeeNames: ['Тастанова Г.'],
        reserveEmployeeNames: [],
        stateCode: 'ACCEPTED',
        returnReason: null,
        submittedAt: now,
        updatedAt: now,
        execution: {
          stateCode: 'PENDING_ACKNOWLEDGEMENT',
          acknowledgedMemberNames: [],
          actualStart: null,
          actualEnd: null,
          actualMemberNames: null,
          handover: null,
        },
        replacements: [],
      },
      updatedAt: now,
      requiredEmployees: 2,
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
      dutyCandidates: [...DUTY_CANDIDATES],
      // §21.27 «автоматически созданный черновик не считается утверждённым»:
      // сид не заводит планов вовсе. Месяц с готовым черновиком выглядел бы
      // как результат чьей-то работы, которой не было, а утверждённый — ещё и
      // закрыл бы демо-месяц для планирования (см. `assertPlanOpen`).
      monthlyPlans: [],
    },
  }
}
