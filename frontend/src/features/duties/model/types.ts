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

/** §24.22 «Передача и завершение смены», СОКРАЩЕНО до честного подмножества
 * под текущую модель (см. FRONTEND_DECISIONS A55): мастер-промпт описывает
 * РОТАЦИЮ экипажей (сдающий состав передаёт принимающему), а модель проекта —
 * один экипаж на businessDate, без ротации внутри дня. Реализована только
 * часть «сдающий фиксирует данные передачи» — БЕЗ выдуманного принимающего
 * экипажа. Обязательный checkpoint ПЕРЕД `completeCombatDuty` (§24.23). */
export interface CombatDutyHandover {
  /** Пустая строка — сдающий явно отметил «нет незакрытых происшествий», не
   * пропущенное поле (тот же принцип честного пустого состояния, что везде
   * в проекте). */
  unresolvedIncidents: string
  remarks: string
  confirmedByEmployeeName: string
  confirmedAt: string
}

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
  /** §24.22 — `null`, пока сдача смены не оформлена; `completeCombatDuty`
   * требует `handover !== null` (MISSING_HANDOVER иначе). */
  handover: CombatDutyHandover | null
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

/** §21.35 «Отдых после дежурства»: действующее значение политики читается,
 * а не предполагается. HARD_BLOCK — назначение в период отдыха невозможно,
 * SOFT_OVERRIDE — возможно с обоснованием и отдельным permission (§21.34). */
export type DutyRestPolicy = 'HARD_BLOCK' | 'SOFT_OVERRIDE'

/** §24.3 «Виды дежурств не должны быть захардкожены во frontend» — Duty Type Registry. */
export interface DutyTypeDefinition {
  dutyTypeCode: string
  safeLabel: string
  targetType: DutyTargetType
  defaultDurationMinutes: number
  requiresSenior: boolean
  /** §21.35 «не хардкодь 24 часа: используй restAfterMinutes вида дежурства». */
  restAfterMinutes: number
  /** §21.35 называет политику отдыха глобальной серверной настройкой
   * (`REST_AFTER_DUTY_POLICY`), здесь она — атрибут ВИДА дежурства: там же,
   * где `restAfterMinutes`, к которому она относится. Frontend в любом случае
   * читает действующее значение и никогда не выводит severity сам (§21.34). */
  restPolicy: DutyRestPolicy
  /** §21.31 «Если паспорт красный и выбранный вид требует актуального
   * паспорта, создание или утверждение блокируется согласно server policy» —
   * требование это атрибут ВИДА дежурства, а не глобальная константа. */
  requiresCurrentPassport: boolean
}

/**
 * §21.33 «Подбор кандидатов» — кандидат на индивидуальное дежурство.
 * СОБСТВЕННЫЙ снапшот `features/duties` (тот же принцип, что
 * `CombatRosterCandidate` и A26/A35: `features/personnel` живёт в другом
 * ID-пространстве, склейка по ФИО дала бы ложные совпадения — A50).
 *
 * ⚠️ Список полей — ровно то, что §21.33 разрешает показывать И что выводимо
 * из модели. Доступность, статус (отпуск/больничный), допуски, нагрузка,
 * рейтинг и «соответствие требованиям поста» здесь СОЗНАТЕЛЬНО отсутствуют:
 * ни одного из этих read model в demo-срезе нет, а §35 запрещает выдумывать.
 * Причины перечисляет `unavailableAttributes` в ответе, а не молчание.
 */
export interface DutyCandidate {
  employeeName: string
  unitName: string
  positionName: string
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
 * PLANNED сразу назначен, дальше ознакомление→заступление→завершение.
 *
 * `CANCELLED` — ТУПИКОВОЕ состояние, не шаг конвейера: отменить можно только
 * ещё не начатую смену (PLANNED/ACKNOWLEDGED), обратного перехода нет.
 * Отменённая смена остаётся в данных и видна в плане — удаление стёрло бы
 * след планирования, а он и есть предмет §21. */
export type DutyShiftState = 'PLANNED' | 'ACKNOWLEDGED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'

/**
 * След отмены смены. Причина ОБЯЗАТЕЛЬНА: отменённая смена продолжает занимать
 * строку плана, и «почему её нет» — единственное, что отличает отмену от
 * ошибки данных.
 */
export interface DutyShiftCancellation {
  reason: string
  cancelledAt: string
}

/**
 * §9.6 «дежурство должно ссылаться минимум на objectId / passportVersionId /
 * sectorId / postId» — ХРАНИМЫЙ снимок привязки на момент планирования.
 * Именно снимок, а не ссылка: публикация новой редакции паспорта не
 * переписывает уже спланированные дежурства (§9.6), поэтому имена сектора и
 * поста копируются сюда, а не резолвятся при чтении.
 *
 * Производное «какая версия действует ПРЯМО СЕЙЧАС» здесь НЕ хранится — это
 * `DutyPassportStatus` в api/pending-contracts.ts, пересчитываемый на каждом
 * чтении (хранимый флаг устаревания молча протух бы).
 */
export interface DutyPassportBinding {
  objectId: string
  objectName: string
  versionId: string
  versionNumber: number
  /** Дата, с которой действует привязанная версия (YYYY-MM-DD). */
  effectiveFrom: string
  sectorId: string
  sectorName: string
  postId: string
  postName: string
  boundAt: string
}

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
  /** §9.6. `null` — объекта нет в реестре ЛИБО на дату нет опубликованной
   * версии/постов: причину различает `DutyPassportStatus`, а не это поле. */
  passportBinding: DutyPassportBinding | null
  /** §21.31 «примечание». `null` — поле не заполняли (смены из сида и все,
   * заведённые до этого среза); пустая строка сюда не пишется. */
  note: string | null
  /** `null` — смена не отменена. `stateCode === 'CANCELLED'` и `cancellation`
   * идут только вместе: состояние без причины было бы отменой без объяснения. */
  cancellation: DutyShiftCancellation | null
  /** §21.34: обоснование обхода SOFT-конфликта, с которым смена заведена.
   * `null` — конфликта при создании не возникло. Хранится, потому что §21.34
   * требует обход «с обоснованием», а обоснование без следа в данных —
   * не обоснование. */
  overrideReason: string | null
}

/**
 * §21.27 «Lifecycle месячного плана». Промпт называет цепочку
 * `DRAFT → VALIDATED → APPROVED` и тут же ограничивает её:
 *
 *   «Если API registry содержит только DRAFT и APPROVED, не добавляй
 *    промежуточный статус в данные. VALIDATED может быть результатом
 *    проверки, а не состоянием сущности.»
 *
 * Ровно этот случай: в данных ДВА состояния, а `VALIDATED` живёт как
 * `MonthlyPlanRecord.lastValidation` — результат проверки конфликтов, а не
 * третий вариант `stateCode`. Тип нарочно не содержит `'VALIDATED'`: сделать
 * его недостижимым НА УРОВНЕ ТИПА надёжнее, чем договориться его не писать.
 */
export type MonthlyPlanStateCode = 'DRAFT' | 'APPROVED'

/**
 * Результат последней проверки конфликтов месяца (§21.27 «VALIDATED может быть
 * результатом проверки»).
 *
 * `planFingerprint` — отпечаток состава месяца на момент проверки. Без него
 * проверка «протухала» бы молча: план проверили, потом завели ещё смену, и
 * утверждение шло бы по устаревшему результату. Утверждать можно только план,
 * отпечаток которого совпадает с текущим.
 */
export interface MonthlyPlanValidation {
  checkedAt: string
  hardConflicts: number
  softConflicts: number
  /** Проверка пройдена: жёстких конфликтов нет. Мягкие утверждению не мешают —
   * они уже обойдены с обоснованием при заведении смены (§21.34). */
  passed: boolean
  planFingerprint: string
}

export type MonthlyPlanHistoryEvent = 'DRAFT_CREATED' | 'VALIDATED' | 'APPROVED' | 'REOPENED'

/** §21.27 «история не перезаписывается» — список только дополняется. */
export interface MonthlyPlanHistoryEntry {
  at: string
  /** Редакция, В КОТОРОЙ произошло событие (а не та, что получилась после). */
  revision: number
  event: MonthlyPlanHistoryEvent
  note: string
}

/**
 * Сущность месячного плана. Появляется НЕ автоматически: пока черновик не
 * сформирован, плана на месяц не существует вовсе — «автоматически созданный
 * черновик не считается утверждённым» (§21.27), а созданный сам собой при
 * первом открытии экрана был бы ещё и не сформированным человеком.
 *
 * §21.27 «изменения выполняются через новую revision»: утверждённый месяц
 * закрыт для планирующих мутаций, а `REOPEN` поднимает `revision` и возвращает
 * план в `DRAFT`. Правки поверх утверждённой редакции не существует.
 */
export interface MonthlyPlanRecord {
  /** YYYY-MM. Первичный ключ: план на месяц один. */
  month: string
  stateCode: MonthlyPlanStateCode
  /** Начинается с 1 у черновика; растёт только при открытии новой редакции. */
  revision: number
  createdAt: string
  lastValidation: MonthlyPlanValidation | null
  approvedAt: string | null
  /** userId утвердившего (dev-credential demo-режима). */
  approvedBy: string | null
  history: MonthlyPlanHistoryEntry[]
}
