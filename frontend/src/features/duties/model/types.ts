// Служба → План дежурств (мастер-промпт §24 «Суточные дежурства на
// собственных и охраняемых объектах, боевые группы на Трассах»). Реализован
// ТОЛЬКО первый столбец таблицы §24 («Собственные объекты»/«Охраняемые
// объекты», assignmentMode=INDIVIDUAL) — «Боевые группы на Трассе»
// (assignmentMode=COMBAT_GROUP, ROUTE_SET, многоуровневая подача/утверждение
// §24.5-24.10) сознательно НЕ реализованы: §24.1 «нельзя моделировать как
// обычный объект» — это отдельный, гораздо больший процесс (потребность →
// подача начальником управления → рассмотрение → утверждение → ...),
// см. FRONTEND_DECISIONS. Регистрировать мёртвые типы дежурств без рабочего
// процесса за ними — нечестно (§35 запрет мёртвых кнопок).
export type DutyTargetType = 'OWN_OBJECT' | 'PROTECTED_OBJECT'

/** §24.3 «Виды дежурств не должны быть захардкожены во frontend» — Duty Type Registry. */
export interface DutyTypeDefinition {
  dutyTypeCode: string
  safeLabel: string
  targetType: DutyTargetType
  defaultDurationMinutes: number
  requiresSenior: boolean
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
