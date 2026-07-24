// Служба → План дежурств (мастер-промпт §24 «Суточные дежурства на
// собственных и охраняемых объектах, боевые группы на Трассах»). Первый
// столбец таблицы §24 («Собственные объекты»/«Охраняемые объекты»,
// assignmentMode=INDIVIDUAL) — см. `DutyShift` ниже.
//
// «Боевые группы на Трассе» (assignmentMode=COMBAT_GROUP, targetType=
// ROUTE_SET, §24.5-24.10, по запросу «боевые группы на Трассе») — реализован
// процесс §24.1 от потребности до факта: формирование потребности на период
// (`createCombatDutyShift`, упрощено до requiredEmployees — см. A54) →
// подача составом (leader+members+reserve) начальником управления →
// рассмотрение (принять/вернуть с причиной) → ПОСЛЕ принятия (§24.19-24.23,
// FRONTEND_DECISIONS A52): индивидуальное ознакомление каждого (leader+
// members, БЕЗ резерва) → заступление → факт несения (фактический состав
// может отличаться от планового) → замена участника ДО заступления/во время
// READY (§24.21, упрощено — см. DutyReplacementRecord). НЕ реализовано (см.
// A51/A52/A54): публикация графика комплектования отдельным шагом,
// requiredGroups/requiredPosts (§24.4, только requiredEmployees), передача
// смены (§24.22), Conflict Repository (§24.17 — пересечение с ОМ/другим
// дежурством, только внутрифичевый DOUBLE_ASSIGNMENT), revision/
// expectedRevision (оптимистичная конкурентность), представление подачи от
// имени другого лица (§24.5), режимы покрытия SEQUENTIAL/PARALLEL
// пересчитываются НЕ на frontend (только хранятся).
export type DutyTargetType = 'OWN_OBJECT' | 'PROTECTED_OBJECT'

/** §24.9-24.10 — Трасса и набор Трасс, СОБСТВЕННЫЙ реестр `features/duties`
 * (НЕ шарится с направлением «Трасса» внутри ОМ — §24.11 явно требует их
 * различать, разные бизнес-процессы, разные ID-пространства). */
export interface DutyRoute {
  routeId: string
  safeLabel: string
}

export type DutyRouteCoverageMode = 'SEQUENTIAL' | 'PARALLEL' | 'RESERVE'

export interface DutyRouteSet {
  routeSetId: string
  safeLabel: string
  coverageMode: DutyRouteCoverageMode
  routeIds: string[]
}

/** Кандидат в состав боевой группы — СОБСТВЕННЫЙ снапшот `features/duties`
 * (ARCH-FE-013 не даёт переиспользовать personnelRoster security-events или
 * личный состав personnel — тот же принцип, что A26/A35). */
export interface CombatRosterCandidate {
  employeeName: string
  unitName: string
}

export type CombatSubmissionState = 'SUBMITTED' | 'RETURNED' | 'ACCEPTED'

/** §24.13 sub-lifecycle ПОСЛЕ принятия состава (§24.19 ознакомление → §24.20
 * заступление → §24.23 факт). `null`, пока `submission.stateCode !== 'ACCEPTED'`.
 * Упрощено относительно §24.13 полного workflow смены: нет HANDOVER/BLOCKED/
 * EXPIRED — только линейный READY-путь, см. FRONTEND_DECISIONS A52. */
export type CombatDutyExecutionState = 'PENDING_ACKNOWLEDGEMENT' | 'READY' | 'ACTIVE' | 'COMPLETED'

export interface CombatDutyExecution {
  stateCode: CombatDutyExecutionState
  /** §24.19 — каждый сотрудник (старший+состав, БЕЗ резерва) подтверждает
   * ознакомление отдельно. `stateCode` переходит в READY, когда список
   * покрывает leader+members целиком. */
  acknowledgedMemberNames: string[]
  actualStart: string | null
  actualEnd: string | null
  /** §24.23 «Плановое назначение нельзя автоматически считать фактическим
   * участием» — фактический состав задаётся отдельно при завершении, может
   * отличаться от `memberEmployeeNames`. `null`, пока не COMPLETED. */
  actualMemberNames: string[] | null
}

/** §24.21 «после утверждения нельзя просто поменять сотрудника в массиве» —
 * запись истории замены (упрощено: без approval-статуса/revision-конфликтов,
 * см. FRONTEND_DECISIONS A5x — заменяющий состоит в том же управлении и
 * применяется атомарно, авторизация — только permission `ops.combat_group.replace`). */
export interface DutyReplacementRecord {
  replacementId: string
  outgoingEmployeeName: string
  incomingEmployeeName: string
  reasonCode: string
  safeComment: string | null
  appliedAt: string
}

/** Упрощённая проекция `CombatDutyRosterSubmission` (§24.6) — без revision/
 * представительства/оснований, только состав+состояние+причина возврата. */
export interface CombatDutyRosterSubmission {
  submittedByUnitName: string
  groupLeaderEmployeeName: string
  memberEmployeeNames: string[]
  reserveEmployeeNames: string[]
  stateCode: CombatSubmissionState
  returnReason: string | null
  submittedAt: string
  updatedAt: string
  execution: CombatDutyExecution | null
  /** §24.21 — история замен, самая свежая последней; см. `DutyReplacementRecord`. */
  replacements: DutyReplacementRecord[]
}

/** Смена боевой группы на Трассе/наборе Трасс. `submission === null` —
 * «Требует подачи» (§24.6 первое состояние очереди начальника управления). */
export interface CombatDutyShift {
  id: string
  businessDate: string
  dutyTypeCode: string
  routeSet: DutyRouteSet
  submission: CombatDutyRosterSubmission | null
  updatedAt: string
  /** §24.1 «формирование потребности на период» — минимальное числовое
   * требование, заданное при создании смены (см. `createCombatDutyShift`).
   * `null` для демо-фикстур, заведённых ДО этого среза (не пересчитано
   * задним числом). Полный `requirement` (§24.4: requiredGroups/
   * requiredPosts) НЕ реализован — только requiredEmployees. */
  requiredEmployees: number | null
}

/** §24.3 «Виды дежурств не должны быть захардкожены во frontend» — Duty Type Registry. */
export interface DutyTypeDefinition {
  dutyTypeCode: string
  safeLabel: string
  targetType: DutyTargetType
  defaultDurationMinutes: number
  requiresSenior: boolean
}

/** Duty Type Registry для боевых групп (§24.3, отдельный список — targetType
 * ROUTE_SET несовместим с `DutyTypeDefinition.targetType` INDIVIDUAL-набора). */
export interface CombatDutyTypeDefinition {
  dutyTypeCode: string
  safeLabel: string
  supportsMultipleRoutes: boolean
}

/** Упрощённый процесс §24.1 (INDIVIDUAL-подмножество): без «формирование
 * потребности → подача состава → рассмотрение → утверждение смены» —
 * PLANNED сразу назначен, дальше ознакомление→заступление→завершение. */
export type DutyShiftState = 'PLANNED' | 'ACKNOWLEDGED' | 'ACTIVE' | 'COMPLETED'

export interface DutyShift {
  id: string
  businessDate: string
  dutyTypeCode: string
  target: {
    targetType: DutyTargetType
    objectId: string
    safeLabel: string
  }
  employeeName: string
  stateCode: DutyShiftState
  acknowledgedAt: string | null
  actualStart: string | null
  actualEnd: string | null
  updatedAt: string
}
