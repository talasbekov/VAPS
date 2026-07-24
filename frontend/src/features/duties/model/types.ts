// Служба → План дежурств (мастер-промпт §24 «Суточные дежурства на
// собственных и охраняемых объектах, боевые группы на Трассах»). Первый
// столбец таблицы §24 («Собственные объекты»/«Охраняемые объекты»,
// assignmentMode=INDIVIDUAL) — см. `DutyShift` ниже.
//
// «Боевые группы на Трассе» (assignmentMode=COMBAT_GROUP, targetType=
// ROUTE_SET, §24.5-24.10, по запросу «боевые группы на Трассе») — реализована
// СОКРАЩЁННАЯ подмножество процесса §24.1: подача составом (leader+members+
// reserve) начальником управления → рассмотрение (принять/вернуть с
// причиной). НЕ реализовано (см. FRONTEND_DECISIONS A51): формирование
// потребности на период (§24.1 первый шаг — Трассы/составы в этом срезе
// заведены фикстурой заранее, не создаются в UI), ознакомление КАЖДОГО члена
// группы отдельно (§24.19, у INDIVIDUAL-подмножества тоже упрощено до одной
// смены целиком), заступление/несение/замены/сдача/факт (§24.13 ACTIVE→
// COMPLETED lifecycle), Conflict Repository (§24.17 — пересечение с ОМ/другим
// дежурством), представление подачи от имени другого лица (§24.5), режимы
// покрытия SEQUENTIAL/PARALLEL пересчитываются НЕ на frontend (только
// хранятся, backend бы проверял состав — здесь просто demo-фикстура).
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
