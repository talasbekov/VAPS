// Feature model (§7.7): UI-модель охранного мероприятия. Wire DTO живёт в
// api/pending-contracts.ts — здесь то, чем реально оперирует UI (реестр,
// карточка, бюллетень).
//
// Стадии — полный жизненный цикл Epic 15/16/17/18 §8.9
// `SecurityEventStageTransition`: bulletin → recon → demand → forces →
// placement → approval → acknowledgement → conduct → closed. Оценки
// участников (Epic 18.3, скрытые рейтинги D3) и полный архив-просмотр —
// Not started, см. FRONTEND_TRACEABILITY_MATRIX.md (не заявлять статусы,
// которых ещё нет ни в UI, ни в repository, запрет §35).
export const SECURITY_EVENT_STAGES = [
  'BULLETIN',
  'RECON',
  'DEMAND',
  'FORCES',
  'PLACEMENT',
  'APPROVAL',
  'ACKNOWLEDGEMENT',
  'CONDUCT',
  'CLOSED',
] as const

export type SecurityEventStage = (typeof SECURITY_EVENT_STAGES)[number]

/** Результат проверки пункта чек-листа/поста рекогносцировки (прототип: select «Соответствует»/«Требует изменений»). */
export type ReconCheckResult = 'MATCHES' | 'NEEDS_CHANGES' | null

export interface ReconChecklistItem {
  id: string
  label: string
  done: boolean
  result: ReconCheckResult
  comment: string
}

/** Строка «Посты и секторы» рекогносцировки (Smart Josparlau.dc.html:441-480) — СКОПИРОВАНА в контекст ОМ, не Object/Sector/Post Epic 14 (тот — Этап 5, полноценный паспорт объекта). */
export interface ReconSectorPost {
  id: string
  sector: string
  post: string
  task: string
  need: number
  requirements: string
  result: ReconCheckResult
  comment: string
}

/** Строка потребности в силах (Smart Josparlau.dc.html:551-583 «1 · Потребность в силах»). */
export interface StaffingDemandRow {
  id: string
  sector: string
  task: string
  shift: string
  need: number
  group: string
  requirements: string
  comment: string
}

export type ForceRequestStatus =
  | 'NOT_SENT'
  | 'SENT'
  | 'PARTIALLY_ALLOCATED'
  | 'ALLOCATED'

/** Запрос группе (Smart Josparlau.dc.html:611-624 «2 · Выделение сил») — агрегат по группе, автосформированный при утверждении потребности. */
export interface ForceRequest {
  id: string
  group: string
  requestedCount: number
  allocatedCount: number
  status: ForceRequestStatus
  comment: string
}

/** Назначение сотрудника на пост рекогносцировки (Smart Josparlau.dc.html:807-996 «Расстановка»). Двойное назначение внутри ОДНОГО ОМ запрещено (hard rule) — межсобытийные конфликты/отдых/усталость (Epic 16.3) НЕ реализованы, см. FRONTEND_DECISIONS. */
export interface PlacementAssignment {
  id: string
  postId: string
  employeeId: string
  employeeName: string
  /** Ознакомление (Smart Josparlau.dc.html:1124-1149): null до подтверждения. */
  acknowledgedAt: string | null
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'RETURNED'

/** Внешний кадровый read-only snapshot (§8.9) — используется только для подбора кандидатов на «Расстановке». НЕ Smart Josparlau сущность, не редактируется через продуктовый UI. */
export interface PersonnelSummarySnapshot {
  id: string
  name: string
  rankLabel: string
  unit: string
}

/** Тип записи журнала штаба (Smart Josparlau.dc.html:1181-1252 «Проведение»). */
export type JournalEntryType = 'INSTRUCTION' | 'ORDER' | 'INCIDENT' | 'REPLACEMENT'

export interface JournalEntry {
  id: string
  type: JournalEntryType
  title: string
  description: string
  createdAt: string
}

/** Итог направления при закрытии (Epic 18.1 FR-30: итоги ВСЕХ направлений обязательны). Направление = сектор reconSectorPosts. */
export interface ClosureDirectionSummary {
  direction: string
  summary: string
}

export interface SecurityEvent {
  id: string
  code: string
  title: string
  objectName: string
  businessDate: string
  stage: SecurityEventStage
  /** Готовность текущей стадии, 0–100 (демонстрационная метрика — не читай как факт). */
  readinessPercent: number
  forceNeed: number
  conflictsCount: number
  ownerName: string
  /** Бюллетень (§16 прототипа): краткое описание, обязательное поле этапа BULLETIN. */
  briefDescription: string
  /** Бюллетень: первичные задачи направлениям, обязательное поле этапа BULLETIN. */
  initialTasks: string
  /** Рекогносцировка: чек-лист объекта (Smart Josparlau.dc.html:421-436). */
  reconChecklist: ReconChecklistItem[]
  /** Рекогносцировка: посты и секторы, рассчитанные для этого ОМ. */
  reconSectorPosts: ReconSectorPost[]
  /** Потребность: строки расчёта сил (редактируемые до утверждения). */
  demandRows: StaffingDemandRow[]
  /** Потребность: утверждена → строки locked, автосформированы forceRequests. */
  demandApproved: boolean
  /** Выделение сил: агрегированные запросы по группам. */
  forceRequests: ForceRequest[]
  /** Расстановка: назначения сотрудников на посты (из reconSectorPosts). */
  placementAssignments: PlacementAssignment[]
  /** Согласование: статус утверждения расстановки. */
  approvalStatus: ApprovalStatus
  /** Согласование: причина возврата на доработку (обязательна при RETURNED). */
  approvalComment: string
  /** Проведение: журнал штаба (инструктаж/указания/инциденты/замены). */
  journalEntries: JournalEntry[]
  /** Закрытие: итоги по направлениям (пусто до закрытия). */
  closureDirectionSummaries: ClosureDirectionSummary[]
  /** Закрытие: момент закрытия, null пока не закрыт. */
  closedAt: string | null
  createdAt: string
  updatedAt: string
}
