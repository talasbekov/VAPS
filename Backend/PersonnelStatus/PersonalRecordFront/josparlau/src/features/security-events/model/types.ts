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
/**
 * Снимок привязки ОМ к опубликованной версии паспорта объекта (§9.6). Именно
 * снимок, а не ссылка: §9.6 «старые назначения продолжают ссылаться на
 * историческую версию» и «публикация новой версии паспорта не переписывает
 * действующую расстановку» — если бы карточка каждый раз перерешала, какая
 * версия действует, публикация молча переписала бы согласованную расстановку.
 *
 * `objectName` продублирован СОЗНАТЕЛЬНО: переименование объекта не должно
 * задним числом менять уже напечатанные и заархивированные документы.
 */
export interface PassportBinding {
  objectId: string
  objectName: string
  versionId: string
  versionNumber: number
  /** Дата, с которой действует привязанная версия (YYYY-MM-DD). */
  effectiveFrom: string
  boundAt: string
}

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

/**
 * Строка «Посты и секторы» рекогносцировки (Smart Josparlau.dc.html:441-480) —
 * СКОПИРОВАНА в контекст ОМ, не Object/Sector/Post Epic 14 (тот — Этап 5,
 * полноценный паспорт объекта). §9.6 это прямо разрешает: «рекогносцировка
 * может создать event-specific расчёт на основе паспорта», «event-specific
 * изменение поста не редактирует паспорт автоматически».
 *
 * `sourceSectorId`/`sourcePostId` — откуда строка пришла в расчёт. Заполнены
 * при импорте из привязанной версии паспорта, `null` у строк, заведённых
 * руками. Через них замыкается цепочка §9.6 «расстановка ссылается на
 * objectId / passportVersionId / sectorId / postId»: назначение → строка
 * расчёта → снимок привязки (`SecurityEvent.passportBinding`) → объект.
 */
export interface ReconSectorPost {
  id: string
  sector: string
  post: string
  task: string
  need: number
  requirements: string
  result: ReconCheckResult
  comment: string
  /** Сектор привязанной версии паспорта, `null` у ручной строки. */
  sourceSectorId: string | null
  /** Пост привязанной версии паспорта, `null` у ручной строки. */
  sourcePostId: string | null
  /**
   * Требование поста к оперативному рейтингу (`post.min_rating`, §19.24).
   * `null` — требования нет, и это ОТДЕЛЬНЫЙ случай, а не «ноль»: пост без
   * требования не сравнивает рейтинг ни с чем.
   *
   * Требование — свойство ПОСТА, а не рейтинга: оно едет в расстановку даже
   * тому, кому закрыто само значение рейтинга (§19.24 «показывай только
   * разрешённую краткую сводку»).
   */
  minRating: number | null
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
  /**
   * Обоснование обхода мягкого предупреждения по рейтингу (§19.24). Заполнено
   * ТОЛЬКО если предупреждение действительно возникло: обоснование при
   * отсутствии конфликта потом читалось бы как «здесь что-то обходили»
   * (тот же довод, что у смены дежурства).
   */
  ratingOverrideReason: string | null
}

/**
 * Соответствие рейтинга требованию поста (§19.24 «соответствие `min_rating`»).
 *
 * `NOT_REQUIRED` — у поста нет требования; `NOT_CHECKED` — проверка выключена
 * флагом `ENABLE_RATING_CONFLICTS` (§19.3 «`post.min_rating` не участвует в
 * проверке назначения»). Оба отделены от `UNKNOWN` («требование есть, данных
 * нет»): §19.3 требует ОТДЕЛЬНОЕ предупреждение об отсутствии данных, а не
 * молчаливое «соответствует».
 */
export type PlacementRatingCompliance =
  | 'MEETS'
  | 'BELOW'
  | 'UNKNOWN'
  | 'NOT_REQUIRED'
  | 'NOT_CHECKED'

/**
 * Разрешённая краткая сводка рейтинга назначенного сотрудника (§19.24).
 *
 * Перечень полей — это ровно список §19.24 («агрегированный рейтинг, состояние
 * данных, количество учтённых оценок, если разрешено, соответствие
 * `min_rating`, дата расчёта, policy version»). Запрещённого списка (последние
 * персональные оценки, комментарии, оценщики, благодарности и замечания,
 * sensitive documents) здесь нет ДАЖЕ В МОДЕЛИ: сервер их не собирает, а не
 * прячет вёрсткой.
 *
 * `aggregateRating`, `evaluationsCount`, `policyVersion` и `calculatedAt`
 * приходят `null` тому, кому закрыт просмотр агрегата: соответствие требованию
 * поста — свойство НАЗНАЧЕНИЯ, и знать его расстановщик вправе, не видя самого
 * значения рейтинга.
 */
export interface PlacementRatingRow {
  assignmentId: string
  postId: string
  employeeId: string
  employeeName: string
  /** Требование поста — видно независимо от прав на рейтинг. */
  postMinRating: number | null
  compliance: PlacementRatingCompliance
  /** Состояние данных рейтинга: `null`, если сводка закрыта смотрящему. */
  dataState: 'READY' | 'INSUFFICIENT_DATA' | 'NOT_RECORDED' | 'FEATURE_DISABLED' | null
  aggregateRating: number | null
  evaluationsCount: number | null
  policyVersion: string | null
  calculatedAt: string | null
  /** Обоснование обхода, если назначение прошло через предупреждение. */
  ratingOverrideReason: string | null
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

/**
 * §22.14: событие перехода жизненного цикла. APPEND-ONLY — записи не
 * правятся и не удаляются, потому что журнал переходов и есть история; правка
 * задним числом сделала бы воронку недоказуемой.
 *
 * Пишется ДИФФОМ на записи слайса (см. `mocks/repository.ts` `commitEvents`),
 * а не руками на каждом переходе: девять операций меняют стадию, и ручная
 * запись рано или поздно была бы забыта в одной из них — а забытый переход
 * молча исказил бы конверсию.
 */
export interface SecurityEventTransition {
  id: string
  eventId: string
  /** `null` — создание мероприятия: до него стадии не было. */
  fromStage: SecurityEventStage | null
  toStage: SecurityEventStage
  /** `RETURN` — переход НАЗАД по порядку стадий (возврат на доработку).
   * §22.14 считает возвраты отдельно от переходов, а не вычитает их. */
  kind: 'FORWARD' | 'RETURN'
  occurredAt: string
}

export interface SecurityEvent {
  id: string
  code: string
  title: string
  /**
   * Объект реестра, на котором проводится ОМ (§9.6 «объект и паспорт — разные
   * сущности»). `null` — мероприятие, заведённое до появления привязки:
   * так честнее, чем угадывать объект по `objectName` (совпадение имён —
   * ровно та ложная склейка, которую запретили в A44-A46).
   */
  objectId: string | null
  /** Снимок имени объекта: показывается и в тех ОМ, где `objectId` — null. */
  objectName: string
  /**
   * §9.6: конкретная опубликованная версия паспорта, действующая на дату ОМ.
   * `null` — либо объект не привязан, либо на дату нет опубликованной версии
   * (оба случая обрабатываются ЯВНО, см. lib/passportBinding.ts).
   */
  passportBinding: PassportBinding | null
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
