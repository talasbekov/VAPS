// Домен «Охранное мероприятие» (ОМ). Полный жизненный цикл:
// bulletin → recon → demand → forces → placement → approval →
// acknowledgement → conduct → closed.
/**
 * Снимок привязки ОМ к опубликованной версии паспорта объекта. Именно снимок,
 * а не ссылка: публикация новой версии паспорта не переписывает согласованную
 * расстановку. objectName продублирован сознательно — переименование объекта
 * не должно задним числом менять заархивированные документы.
 */
export interface PassportBinding {
  objectId: string;
  objectName: string;
  versionId: string;
  versionNumber: number;
  /** Дата, с которой действует привязанная версия (YYYY-MM-DD). */
  effectiveFrom: string;
  boundAt: string;
}

export const SECURITY_EVENT_STAGES = [
  "BULLETIN",
  "RECON",
  "DEMAND",
  "FORCES",
  "PLACEMENT",
  "APPROVAL",
  "ACKNOWLEDGEMENT",
  "CONDUCT",
  "CLOSED",
] as const;

export type SecurityEventStage = (typeof SECURITY_EVENT_STAGES)[number];

/** Результат проверки пункта чек-листа/поста рекогносцировки. */
export type ReconCheckResult = "MATCHES" | "NEEDS_CHANGES" | null;

export interface ReconChecklistItem {
  id: string;
  label: string;
  done: boolean;
  result: ReconCheckResult;
  comment: string;
}

/**
 * Строка «Посты и секторы» рекогносцировки — event-specific расчёт на основе
 * паспорта; правка строки не редактирует паспорт. sourceSectorId/sourcePostId
 * заполнены при импорте из привязанной версии паспорта, null у ручных строк.
 */
export interface ReconSectorPost {
  id: string;
  sector: string;
  post: string;
  task: string;
  need: number;
  requirements: string;
  result: ReconCheckResult;
  comment: string;
  sourceSectorId: string | null;
  sourcePostId: string | null;
  /** Требование поста к рейтингу; null — требования нет (не «ноль»). */
  minRating: number | null;
  /**
   * Колонки таблицы постов из прототипа. Хранятся в том же JSON-поле, что и
   * остальная строка расчёта, — миграции не требуют, сервер пропускает
   * незнакомые ключи как есть (update_recon разворачивает строку через **row).
   * Необязательные: строки, заведённые до появления колонок, их не несут.
   */
  postType?: string;
  weapon?: string;
  uniform?: string;
  /** Пост-родитель для подпоста; пусто — строка самостоятельная. */
  parentPostId?: string;
}

/** Строка потребности в силах. */
export interface StaffingDemandRow {
  id: string;
  sector: string;
  task: string;
  shift: string;
  need: number;
  group: string;
  requirements: string;
  comment: string;
}

export type ForceRequestStatus =
  | "NOT_SENT"
  | "SENT"
  | "PARTIALLY_ALLOCATED"
  | "ALLOCATED";

/** Запрос группе — агрегат, автосформированный при утверждении потребности. */
export interface ForceRequest {
  id: string;
  group: string;
  requestedCount: number;
  allocatedCount: number;
  status: ForceRequestStatus;
  comment: string;
}

/** Назначение сотрудника на пост. Двойное назначение внутри одного ОМ запрещено. */
export interface PlacementAssignment {
  id: string;
  postId: string;
  employeeId: string;
  employeeName: string;
  /** Ознакомление: null до подтверждения. */
  acknowledgedAt: string | null;
  /** Обоснование обхода предупреждения по рейтингу; заполнено только если предупреждение было. */
  ratingOverrideReason: string | null;
}

export type ApprovalStatus = "PENDING" | "APPROVED" | "RETURNED";

/**
 * Строка маршрута согласования из прототипа: кто согласует, в каком порядке и
 * с каким решением. Порядок — позиция в списке; отдельного поля под номер нет,
 * иначе появились бы два источника правды.
 */
export interface Approver {
  id: string;
  name: string;
  unit: string;
  position: string;
  status: ApprovalStatus;
  /** null — решение ещё не принято. */
  decidedAt: string | null;
  comment: string;
}

/** Внешний кадровый read-only снимок — только для подбора кандидатов. */
export interface PersonnelSummarySnapshot {
  id: string;
  name: string;
  rankLabel: string;
  unit: string;
}

export type JournalEntryType = "INSTRUCTION" | "ORDER" | "INCIDENT" | "REPLACEMENT";

export interface JournalEntry {
  id: string;
  type: JournalEntryType;
  title: string;
  description: string;
  createdAt: string;
}

/** Итог направления при закрытии (итоги всех направлений обязательны). */
export interface ClosureDirectionSummary {
  direction: string;
  summary: string;
}

/**
 * Тип мероприятия. От него зависят маршрут согласования и старший:
 * FOREIGN уводит запись в реестр ГВО и назначает старшего ГВО.
 */
export type SecurityEventKind = "INTERNAL" | "FOREIGN";

export const SECURITY_EVENT_KIND_LABEL: Record<SecurityEventKind, string> = {
  INTERNAL: "Внутреннее",
  FOREIGN: "С участием иностранцев",
};

/**
 * Объект посещения в рамках ОМ. Мероприятие — это бюллетень, у которого может
 * быть несколько объектов: реестр раскрывает строку мероприятия именно этим
 * списком. У объекта СВОЁ охраняемое лицо и своя привязка паспорта.
 */
export interface VisitObject {
  id: string;
  /** Объект реестра; null — объект удалён, снимок имени остался. */
  objectId: string | null;
  objectName: string;
  passportBinding: PassportBinding | null;
  /** Охраняемое лицо этого объекта; null — не названо. */
  protectedPersonId: string | null;
  protectedPersonName: string;
  position: number;
  /**
   * День посещения в формате ISO; `null` — посещение идёт в дату мероприятия.
   * Это ОТВЕТ, а не пробел: у однодневного ОМ дата названа в бюллетене, и
   * дублировать её в каждой строке значило бы завести второй ответ.
   */
  visitDay: string | null;
  /** Примечание к посещению («основной объект», время) — свободный текст. */
  note: string;
  /**
   * Старший ЭТОГО объекта посещения — не старший мероприятия: у визита
   * иностранного ОЛ объектов несколько, ответственный у каждого свой.
   * `null` — не назначен, и это ответ: объект может стоять в маршруте
   * раньше, чем под него нашли человека.
   */
  chiefEmployeeId: string | null;
  /** Снимок подписи старшего: увольнение не превращает строку в номер. */
  chiefName: string;
  /**
   * Готовность расстановки: сколько людей нужно постам объекта и сколько
   * назначено. `null` — НЕИЗВЕСТНО (расчёт постов не размечен по объектам),
   * `0` — посты не рассчитаны. Это разные ответы, и экран их различает.
   */
  placementNeed: number | null;
  placementAssigned: number | null;
  /** Замещающие старшего на этом объекте: кто может править его расстановку,
   * не имея общего права вести мероприятие. Приходят вместе со строкой
   * объекта — раскрытие реестра иначе стучалось бы за списком на каждую. */
  deputies: VisitObjectDeputy[];
}

/** Замещающий на объекте посещения (Plane «Реестр ОМ-24»). */
export interface VisitObjectDeputy {
  id: string;
  employeeId: string;
  /** Снимок подписи: увольнение не превращает журнал в набор номеров. */
  employeeName: string;
  /** Право править расстановку СВОЕГО объекта. `false` — назначенный
   * наблюдатель: он в списке, но расстановку не трогает. */
  canEditPlacement: boolean;
  /** Кто выдал право — подпись человека, а не id учётки. */
  assignedBy: string;
  assignedAt: string;
}

export interface SecurityEvent {
  id: string;
  code: string;
  title: string;
  /** Объект реестра; null — ОМ заведено до появления привязки. */
  objectId: string | null;
  /** Снимок имени объекта: показывается и там, где objectId — null. */
  objectName: string;
  /** Версия паспорта на дату ОМ; null обрабатывается явно. */
  passportBinding: PassportBinding | null;
  businessDate: string;
  /** Дата окончания; null — однодневное ОМ либо заведённое до появления поля. */
  businessDateEnd: string | null;
  /** Тип мероприятия; null — ОМ заведено до появления поля. */
  kind: SecurityEventKind | null;
  /** Время начала «ЧЧ:ММ»; null — час не назван (необязательная деталь). */
  eventTime: string | null;
  /** Охраняемое лицо из справочника; null — не выбрано. */
  protectedPersonId: string | null;
  /** Снимок имени лица: показывается и там, где лицо скрыто из справочника. */
  protectedPersonName: string;
  /** Локация мероприятия; пусто — не указана. */
  location: string;
  /** Старший (наряда или ГВО — по типу мероприятия); null — не назначен. */
  chiefEmployeeId: string | null;
  /** Снимок подписи старшего — как ownerName. */
  chiefName: string;
  stage: SecurityEventStage;
  /** Готовность текущей стадии, 0–100 (демонстрационная метрика). */
  readinessPercent: number;
  forceNeed: number;
  conflictsCount: number;
  ownerName: string;
  /** Объекты посещения бюллетеня — минимум один (объект окна создания). */
  visitObjects: VisitObject[];
  /** Бюллетень: краткое описание, обязательное поле этапа BULLETIN. */
  briefDescription: string;
  /** Бюллетень: первичные задачи направлениям. */
  initialTasks: string;
  reconChecklist: ReconChecklistItem[];
  reconSectorPosts: ReconSectorPost[];
  /** Запрос личного состава с рекогносцировки — ОЦЕНКА старшего наряда,
   * которую получает штаб 2-го департамента. Не путать с `forceNeed`: тот
   * считается системой из утверждённой потребности тремя шагами позже. */
  reconForceRequest: number;
  /** Момент отправки запроса штабу (проставляется завершением этапа), либо
   * `null` — запрос ещё черновик и штабу не виден. */
  reconForceRequestedAt: string | null;
  demandRows: StaffingDemandRow[];
  demandApproved: boolean;
  forceRequests: ForceRequest[];
  placementAssignments: PlacementAssignment[];
  approvalStatus: ApprovalStatus;
  approvalComment: string;
  approvalRoute: Approver[];
  journalEntries: JournalEntry[];
  closureDirectionSummaries: ClosureDirectionSummary[];
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Контракты API (реального бэка нет — pending, см. отчёт) ──────────────

export const SECURITY_EVENTS_PATH = "/api/ops/security-events/";

export function securityEventDetailPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/`;
}

/** Удаление мероприятия: своё право `event.delete`, ответ 204 без тела. */
export function securityEventDeletePath(id: string): string {
  return securityEventDetailPath(id);
}

export const BINDABLE_OBJECTS_PATH = `${SECURITY_EVENTS_PATH}bindable-objects/`;

/** Объекты посещения мероприятия: добавление и снятие. */
export function visitObjectsPath(eventId: string): string {
  return `${securityEventDetailPath(eventId)}visit-objects/`;
}

export function visitObjectDetailPath(
  eventId: string,
  visitObjectId: string
): string {
  return `${visitObjectsPath(eventId)}${visitObjectId}/`;
}

/** Старший объекта посещения: POST назначает (и заменяет), DELETE снимает. */
export function visitObjectChiefPath(
  eventId: string,
  visitObjectId: string
): string {
  return `${visitObjectDetailPath(eventId, visitObjectId)}chief/`;
}

/** Замещающие на объекте посещения: назначение и отзыв права. */
export function visitObjectDeputiesPath(
  eventId: string,
  visitObjectId: string
): string {
  return `${visitObjectDetailPath(eventId, visitObjectId)}deputies/`;
}

export function visitObjectDeputyDetailPath(
  eventId: string,
  visitObjectId: string,
  deputyId: string
): string {
  return `${visitObjectDeputiesPath(eventId, visitObjectId)}${deputyId}/`;
}

/**
 * Подпись объекта мероприятия для экранов. Пустое имя — «объект не выбран»
 * (ОМ заводят до согласования маршрута), и это надо СКАЗАТЬ: пустое место в
 * строке «Объект: » читается как потерянное значение.
 */
export function objectLabel(event: {
  objectName: string;
}): string {
  return event.objectName === "" ? "не выбран" : event.objectName;
}

/** Строка реестра объектов для выбора: подпись и наличие паспорта. */
export interface BindableObject {
  id: string;
  name: string;
  code: string;
  publishedVersionCount: number;
}

export interface ListSecurityEventsParams {
  search: string;
  stage: SecurityEventStage | "ALL";
  /** Границы периода по бизнес-дате (YYYY-MM-DD); пусто — без границы. */
  from: string;
  to: string;
  /** Точное имя ответственного; пусто — все. */
  owner: string;
  page: number;
  pageSize: number;
}

/** LimitOffset-подобный конверт — канон пагинируемых эндпоинтов. */
export interface ListSecurityEventsResponse {
  /** Значения фильтра «ответственный» — считает сервер по ВСЕМУ реестру. */
  owners: string[];
  count: number;
  next: string | null;
  previous: string | null;
  results: SecurityEvent[];
}

export interface CreateSecurityEventRequest extends Record<string, unknown> {
  title: string;
  /** Пусто — однодневное мероприятие. */
  businessDateEnd?: string;
  /** ОМ заводится НА ОБЪЕКТ реестра — иначе версию паспорта не к чему привязать. */
  objectId: string;
  businessDate: string;
  /** Обязателен: от типа зависят маршрут согласования и состав старших. */
  kind: SecurityEventKind;
  /** «ЧЧ:ММ»; пусто — час не назван. */
  eventTime?: string;
  /** Id из справочника «Охраняемые лица»; пусто — не выбрано. */
  protectedPersonId?: string;
  location?: string;
  /** Id сотрудника — старшего наряда или ГВО; пусто — не назначен. */
  chiefEmployeeId?: string;
}

/** Строка выпадающего списка объектов в форме создания ОМ. */
export interface BindableObject {
  id: string;
  name: string;
  code: string;
  /** 0 — у объекта нет ни одной опубликованной версии паспорта. */
  publishedVersionCount: number;
}

export interface ListBindableObjectsResponse {
  results: BindableObject[];
}

// ── Контракты операций этапов карточки ОМ ────────────────────────────────

export interface UpdateBulletinRequest extends Record<string, unknown> {
  briefDescription: string;
  initialTasks: string;
}

export interface UpdateReconRequest extends Record<string, unknown> {
  checklist: ReconChecklistItem[];
  sectorPosts: ReconSectorPost[];
  /** Запрос личного состава. Необязателен: тело БЕЗ ключа оставляет
   * сохранённое число (сервер трактует «нет ключа» как «не трогать»), и
   * правка расчёта постов запрос штабу не стирает. */
  forceRequest?: number;
}

/** Секция потребности не даёт отдельного «сохранить черновик» — одна операция
 * сохраняет строки И утверждает потребность (без «сохранено, не утверждено»). */
export interface UpdateDemandRequest extends Record<string, unknown> {
  rows: StaffingDemandRow[];
}

export interface UpdateForceAllocationRequest extends Record<string, unknown> {
  allocatedCount: number;
  comment: string;
}

export interface AssignPlacementRequest extends Record<string, unknown> {
  postId: string;
  employeeId: string;
  /** Протокол обхода мягкого конфликта: оба поля добавляет confirmOverride
   * в корень тела — своего протокола у рейтинга нет намеренно. */
  override?: boolean;
  override_reason?: string;
}

export interface ReturnPlacementRequest extends Record<string, unknown> {
  comment: string;
}

export interface AddJournalEntryRequest extends Record<string, unknown> {
  type: JournalEntryType;
  title: string;
  description: string;
}

export interface CloseSecurityEventRequest extends Record<string, unknown> {
  directionSummaries: ClosureDirectionSummary[];
}

/** Замена выбывшего: без авто-подбора кандидата — только ручной выбор,
 * атомарная замена одной мутацией (снять + назначить + запись в журнал). */
export interface ReplaceAssignmentRequest extends Record<string, unknown> {
  assignmentId: string;
  incomingEmployeeId: string;
  reasonCode: string;
}

export const OPS_PERSONNEL_PATH = "/api/ops/personnel/";

/**
 * Сотрудник, привязанный к учётной записи. Нужен «экрану сотрудника» на
 * ознакомлении: связать учётку с кадровой записью можно только через
 * Employee.user, а сопоставление по ФИО показало бы тёзке чужое назначение.
 * 404 EMPLOYEE_NOT_LINKED — привязки нет (сид её не заполняет).
 */
export const OPS_PERSONNEL_ME_PATH = "/api/ops/personnel/me/";

export interface ListPersonnelResponse {
  results: PersonnelSummarySnapshot[];
}

/**
 * Страница кадрового списка («Реестр ОМ-35.3»). Приходит ТОЛЬКО когда клиент
 * попросил постраничку (`page`/`pageSize`); без них ручка отдаёт весь снимок
 * в `ListPersonnelResponse` — экраны расстановки и ознакомления читают его
 * целиком, и обрезка сузила бы им выбор людей.
 *
 * `next`/`previous` — НОМЕРА страниц (контракт раздела), `null` — края списка.
 */
export interface PersonnelPageResponse extends ListPersonnelResponse {
  /** Сколько НАЙДЕНО всего — с учётом поиска, а не на странице. */
  count: number;
  next: string | null;
  previous: string | null;
}

/** Поиск идёт НА СЕРВЕР: фильтр по загруженной странице отвечал бы «такого
 * сотрудника нет», имея в виду «нет на этой странице». */
export function opsPersonnelPagePath(params: {
  search: string;
  page: number;
  pageSize: number;
}): string {
  const query = new URLSearchParams({
    page: String(params.page),
    page_size: String(params.pageSize),
  });
  if (params.search.trim() !== "") query.set("search", params.search.trim());
  return `${OPS_PERSONNEL_PATH}?${query.toString()}`;
}

export function securityEventBulletinPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/bulletin/`;
}
export function securityEventBulletinCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/bulletin/complete/`;
}
export function securityEventReconPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/`;
}
export function securityEventReconImportPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/import-from-passport/`;
}
export function securityEventReconCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/complete/`;
}
export function securityEventDemandApprovePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/demand/approve/`;
}
export function securityEventForceAllocationPath(
  id: string,
  requestId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/${requestId}/`;
}
export function securityEventForcesCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/complete/`;
}
export function securityEventPlacementAssignPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/assign/`;
}
export function securityEventPlacementUnassignPath(
  id: string,
  assignmentId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/${assignmentId}/`;
}
export function securityEventPlacementCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/complete/`;
}
export function securityEventApprovalRoutePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/route/`;
}
export function securityEventApproverPath(id: string, approverId: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/route/${encodeURIComponent(approverId)}/`;
}
export function securityEventApproverDecidePath(
  id: string,
  approverId: string
): string {
  return `${securityEventApproverPath(id, approverId)}decide/`;
}

export interface AddApproverRequest extends Record<string, unknown> {
  name: string;
  unit: string;
  position: string;
}

export interface DecideApproverRequest extends Record<string, unknown> {
  decision: "APPROVED" | "RETURNED";
  comment: string;
}

export function securityEventApprovalApprovePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/approve/`;
}
export function securityEventApprovalReturnPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/return/`;
}
// Раздельные сегменты ("acknowledge" vs "acknowledgement/complete") — иначе
// path-to-regexp у MSW матчит /acknowledgement/complete/ более ранним
// :assignmentId-роутом (assignmentId="complete") и отвечает не тот handler.
export function securityEventAcknowledgePath(
  id: string,
  assignmentId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledge/${assignmentId}/`;
}
export function securityEventAcknowledgementCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledgement/complete/`;
}
export function securityEventJournalPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/journal/`;
}
export function securityEventReplaceAssignmentPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/conduct/replace/`;
}
export function securityEventClosePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/close/`;
}

/** Перевод ОМ на выбранный этап в обход условий — админ-полномочие
 * (`event.stage_override`), см. apps/ops/security_events.py::override_stage. */
export function securityEventStagePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/stage/`;
}

export interface OverrideStageRequest extends Record<string, unknown> {
  stage: SecurityEventStage;
}
