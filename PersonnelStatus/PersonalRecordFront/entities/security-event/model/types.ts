// Домен «Охранное мероприятие» (ОМ). Полный жизненный цикл:
// bulletin → recon → demand → forces → placement → approval →
// acknowledgement → conduct → closed.
import type { EventVehicle } from "@/entities/vehicle";
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
  /**
   * Смена поста — свойство ПОСТА, как в эталоне («Сектор A · смена
   * 07:00–15:00»). До Plane №123 её вводили в строке потребности, и когда бокс
   * потребности сняли (№110), задавать смену стало негде вовсе.
   *
   * Необязательная: строки, заведённые до появления поля, её не несут, а
   * расстановка у таких мероприятий по-прежнему читает смену из строки
   * потребности — старый источник живёт, пока его кто-то читает.
   */
  shift?: string;
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

/** Состояние заявки департаменту в цепочке «Сбор сил на ОМ» (Plane №73).
 *
 * `DRAFT` — штаб разложил, но департаменту ещё не сказали; дальше по цепочке
 * идут оповещение управлений, отправка списка и решение штаба (шаги СС-2…СС-5).
 */
export type ForceAllocationStatus =
  | "DRAFT"
  | "NOTIFIED"
  | "SUBMITTED"
  | "ACCEPTED"
  | "RETURNED";

/** Управление внутри департамента, которому ушла заявка (заполняется СС-2). */
export interface ForceAllocationDirectorate {
  id: string;
  divisionId: string;
  name: string;
  notifiedAt: string | null;
}

/** Выделенный управлением сотрудник (заполняется СС-3). */
export interface ForceAllocationMember {
  employeeId: string;
  name: string;
  divisionId: string;
  divisionName: string;
  addedAt: string;
}

/** Заявка ДЕПАРТАМЕНТУ: сколько людей он должен выделить на мероприятие.
 *
 * Не путать с `ForceRequest`: там числа по свободным «группам» утверждённой
 * потребности, адресата у них нет вовсе.
 */
export interface ForceAllocationRow {
  id: string;
  departmentId: string;
  departmentName: string;
  need: number;
  status: ForceAllocationStatus;
  comment: string;
  notifiedAt: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionComment: string;
  directorates: ForceAllocationDirectorate[];
  members: ForceAllocationMember[];
}

/** Человек в СОСТАВЕ мероприятия: штаб принял его и отдал ОМ (шаг СС-5).
 *
 * Не то же, что назначение на пост: в состав человек приходит до расстановки и
 * остаётся в нём, когда его с поста снимают.
 */
export interface ForceRosterMember {
  employeeId: string;
  name: string;
  divisionId: string | null;
  divisionName: string;
  departmentId: string | null;
  departmentName: string;
  /** null — состав выведен из расстановки миграцией, решения штаба не было. */
  acceptedAt: string | null;
  /** Статус на деловую дату ОМ; null — статуса нет, что и есть «в строю». */
  statusCode: string | null;
  statusLabel: string | null;
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
  /** Роль наряда из справочника `PLACEMENT_ROLES` (Plane №238). `null` —
   * роль не назначена: место в бланке «Общая расстановка» останется пустым,
   * и это честнее, чем поставить туда человека наугад. */
  roleCode: string | null;
  /** Подразделение сотрудника; пусто — штатной единицы у него нет. */
  divisionName: string;
  /** Статус на ДЕЛОВУЮ дату мероприятия. null — действующего статуса нет,
   * что и есть «в строю»: строки «в строю» в справочнике не существует, и
   * подписывает её клиент. Оба поля считаются сервером на чтении — копия,
   * записанная в момент назначения, соврала бы к утру. */
  statusCode: string | null;
  statusLabel: string | null;
  /** Старший СЕКТОРА (сектор берётся у поста): один на сектор. */
  isSectorSenior: boolean;
}

export type ApprovalStatus = "PENDING" | "APPROVED" | "RETURNED";

/**
 * Строка маршрута согласования из прототипа: кто согласует, в каком порядке и
 * с каким решением. Порядок — позиция в списке; отдельного поля под номер нет,
 * иначе появились бы два источника правды.
 */
/**
 * Состояние согласующего в маршруте. `NOT_SENT` — начальное: человека внесли
 * в маршрут, но расстановку ему ещё не ОТПРАВЛЯЛИ, и решать ему нечего.
 * `PENDING` значит «на согласовании» — отправлено, решения нет.
 */
export type ApproverStatus = "NOT_SENT" | "PENDING" | "APPROVED" | "RETURNED";

export interface Approver {
  id: string;
  name: string;
  unit: string;
  position: string;
  status: ApproverStatus;
  /** null — решение ещё не принято. */
  decidedAt: string | null;
  comment: string;
}

/**
 * Замечание, порождённое ВОЗВРАТОМ согласующего. Отдельный список, а не поле
 * у согласующего: один человек возвращает дважды по разным поводам, и вторая
 * причина затёрла бы первую, хотя закрывают их по одной.
 */
export interface ApprovalRemark {
  id: string;
  approverId: string;
  author: string;
  createdAt: string;
  text: string;
  resolved: boolean;
  resolvedAt: string | null;
}

/** Внешний кадровый read-only снимок — только для подбора кандидатов. */
export interface PersonnelSummarySnapshot {
  id: string;
  name: string;
  rankLabel: string;
  unit: string;
  /** Статус на дату, СПРОШЕННУЮ клиентом (`business_date`). null — либо даты
   * не спрашивали, либо статуса на неё нет: форма ответа одна на оба случая,
   * две заставили бы читателя гадать, что ему пришло. */
  statusCode: string | null;
  statusLabel: string | null;
  /** Агрегат оперативного рейтинга (Plane №67, шаг РЙ-4).
   *
   * Поля НЕТ ВОВСЕ, когда у спросившего нет права `rating.view_aggregate` —
   * это НЕ то же самое, что `null`. `null` значит «судить не по чему»:
   * человек не связан с рейтингом, оценок меньше порога методики либо
   * функция выключена. Отсутствие поля значит «вам не показывают», и
   * рисовать по нему «нет данных» нельзя — это соврало бы о сотруднике. */
  aggregateRating?: number | null;
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
  /**
   * ВЕСЬ список лиц бюллетеня (Plane №188). Поля выше остаются и означают
   * ГЛАВНОЕ лицо — колонка «ОЛ» бланка одна, и кто-то обязан в неё попасть.
   *
   * Список отсортирован сервером ПО ИМЕНИ: у связи своего порядка нет, и
   * «как легло» менялось бы от каждой перезаписи, читаясь при этом как
   * значимое. Главное лицо названо отдельным полем, поэтому старшинство
   * списку не нужно.
   */
  protectedPersons: { id: string; name: string }[];
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
  /**
   * Машины реестра ГОН, ВЫДЕЛЕННЫЕ на мероприятие (Plane №215).
   *
   * Это не то же самое, что строки «Выделяемый транспорт» в сводке ГВО: те —
   * свободный текст, набранный человеком, и ни ГРНЗ, ни класса брони в них
   * нет. Оба источника живут рядом намеренно, пока у текста есть читатели.
   */
  vehicles: EventVehicle[];
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
  /** Раскладка потребности по департаментам — первое звено «Сбора сил». */
  forceAllocation: ForceAllocationRow[];
  /** Состав мероприятия — принятые штабом люди (шаг СС-5). */
  forceRoster: ForceRosterMember[];
  /** Сколько всего людей делит штаб. Считает СЕРВЕР: по этому же числу он
   * отбивает перебор, и второй счёт на клиенте разошёлся бы с ним молча. */
  forceDemandTotal: number;
  placementAssignments: PlacementAssignment[];
  approvalStatus: ApprovalStatus;
  approvalComment: string;
  approvalRoute: Approver[];
  /** Замечания от возвратов; закрываются по одному. */
  approvalRemarks: ApprovalRemark[];
  /** Расстановка изменилась ПОСЛЕ отправки на согласование. Считает сервер:
   * по этому же признаку он блокирует завершение этапа, и вторая реализация
   * правила на клиенте разошлась бы с ним молча. */
  approvalStale: boolean;
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
/** Выделение машины реестра на мероприятие и снятие её с него. */
export function eventVehiclesPath(eventId: string): string {
  return `${securityEventDetailPath(eventId)}vehicles/`;
}

export function eventVehicleDetailPath(
  eventId: string,
  allocationId: string
): string {
  return `${eventVehiclesPath(eventId)}${allocationId}/`;
}

export function visitObjectsPath(eventId: string): string {
  return `${securityEventDetailPath(eventId)}visit-objects/`;
}

export function visitObjectDetailPath(
  eventId: string,
  visitObjectId: string
): string {
  return `${visitObjectsPath(eventId)}${visitObjectId}/`;
}

/** Правка СВЕДЕНИЙ бюллетеня — название, период, время, ОЛ, локация
 * (Plane №192). Отдельный адрес, а не PATCH самого мероприятия: у ОМ есть
 * поля, которые правкой формы менять нельзя (стадия, состав, расстановка), и
 * ручка «что угодно из модели» однажды приняла бы и их. Тип мероприятия,
 * объекты и старший сюда НЕ входят — у каждого своя причина, см. сервер. */
export function eventDetailsPath(eventId: string): string {
  return `${securityEventDetailPath(eventId)}details/`;
}

/** Старший НАРЯДА мероприятия (Plane №190). ОДИН адрес на три действия:
 * назначение, замену и снятие — у мероприятия старший один, и «сначала
 * снимите» разбило бы обычную замену на две операции. Снятие — тот же POST
 * с пустым `employeeId`. Не путать с `visitObjectChiefPath`: старший наряда и
 * старший объекта — разные люди с разной ответственностью. */
export function eventChiefPath(eventId: string): string {
  return `${securityEventDetailPath(eventId)}chief/`;
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
  /** Одна стадия, `"ALL"` — без отбора, либо НЕСКОЛЬКО стадий через запятую:
   * ленты сбора сил спрашивают окно из трёх стадий одним запросом. */
  stage: SecurityEventStage | "ALL" | `${SecurityEventStage},${string}`;
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
  /** Id из справочника «Охраняемые лица»; пусто — не выбрано.
   * Одиночное поле оставлено ради вызовов, написанных до №188; окно создания
   * шлёт `protectedPersonIds`. Прислали оба — список главнее. */
  protectedPersonId?: string;
  /** Список лиц бюллетеня (Plane №188); первое — главное. */
  protectedPersonIds?: string[];
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

/** Выделение сотрудника управлением (Plane №73, СС-3). */
export interface AddAllocationMemberRequest extends Record<string, unknown> {
  employeeId: string;
}

/** Возврат списка департаменту: причина обязательна (Plane №73, СС-5). */
export interface ReturnAllocationRequest extends Record<string, unknown> {
  reason: string;
}

/** Раскладка потребности по департаментам: список целиком (Plane №73, СС-1). */
export interface SplitForceDemandRequest extends Record<string, unknown> {
  rows: { departmentId: string; need: number; comment?: string }[];
}

export interface AssignPlacementRequest extends Record<string, unknown> {
  postId: string;
  employeeId: string;
  /** Роль наряда из справочника `PLACEMENT_ROLES` (Plane №239). Необязательна:
   * назначить человека на пост можно и без роли. */
  roleCode?: string;
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

/**
 * Страница кадрового списка. ЕДИНСТВЕННЫЙ вид ответа ручки: безстраничная
 * ветка («весь снимок целиком») снята вместе с последним её читателем (Plane
 * №61) — два способа читать один список расходятся молча, а снимок на живой
 * кадровой базе это тысячи строк одним ответом.
 *
 * `next`/`previous` — НОМЕРА страниц (контракт раздела), `null` — края списка.
 */
export interface PersonnelPageResponse {
  results: PersonnelSummarySnapshot[];
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
  /** Подразделение-владелец: управление подбирает СВОИХ (Plane №73, СС-3).
   * Сервер отбирает по ПОДДЕРЕВУ — человек числится в отделе, а не в
   * управлении. */
  divisionId?: string;
  /** Деловая дата, НА КОТОРУЮ спрашивается статус (Plane №65, «Р-2»). Дату
   * даёт мероприятие: считать «сегодня» за клиента сервер не станет —
   * расстановка ведётся на будущий день. */
  businessDate?: string;
  /** Полоса рейтинга — КОД, а не подпись с экрана (Plane №67, шаг РЙ-4):
   * `9_10`, `8_9`, `7_8`, `below_7`, `no_data`. Отбор идёт НА СЕРВЕРЕ и до
   * постранички: пока он жил на клиенте, «нет кандидатов» означало «нет на
   * этой странице». Без права на агрегат сервер ОТБИВАЕТ отбор (403), а не
   * молчит: молча проигнорированный фильтр выглядел бы сработавшим. */
  ratingBand?: string;
  /** Порядок выдачи. `rating` — ранжирование по баллу ПО ВСЕЙ выборке
   * (решение заказчика 26.08.2026), а не в пределах страницы.
   *
   * Закрыто тем же правом `rating.view_aggregate`, что и само значение:
   * порядок САМ рассказывает балл — кто выше, тот сильнее. Без права сервер
   * отвечает 403.
   *
   * Безоценочные идут В КОНЕЦ: `null` значит «судить не по чему», а не ноль.
   * При равных баллах порядок задаёт фамилия — иначе страницы «плавали» бы
   * между запросами. */
  ordering?: "rating";
}): string {
  const query = new URLSearchParams({
    page: String(params.page),
    page_size: String(params.pageSize),
  });
  if (params.search.trim() !== "") query.set("search", params.search.trim());
  if ((params.divisionId ?? "").trim() !== "")
    query.set("division_id", (params.divisionId as string).trim());
  if ((params.businessDate ?? "").trim() !== "")
    query.set("business_date", (params.businessDate as string).trim());
  if ((params.ratingBand ?? "").trim() !== "")
    query.set("rating_band", (params.ratingBand as string).trim());
  if (params.ordering !== undefined) query.set("ordering", params.ordering);
  return `${OPS_PERSONNEL_PATH}?${query.toString()}`;
}

/** Старший сектора: назначить или снять (Plane №65, «Р-4»). */
export function securityEventPlacementSeniorPath(
  id: string,
  assignmentId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/${encodeURIComponent(assignmentId)}/senior/`;
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
// `securityEventDemandApprovePath` СНЯТ вместе с ручкой (Plane №149): стадию
// «Потребность» проходит сервер, формы у неё нет.
export function securityEventForceAllocationPath(
  id: string,
  requestId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/${requestId}/`;
}
/** Раскладка потребности по департаментам — список ЦЕЛИКОМ одним запросом:
 * «кому сколько» это одно решение штаба, и построчное сохранение позволяло бы
 * сумме уехать за потребность между двумя запросами. */
export function securityEventForcesSplitPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/`;
}
/** Оповещение управлений департамента о заявке (Plane №73, шаг СС-2). */
export function securityEventForcesNotifyPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/notify/`;
}
/** Выделенные управлением люди у заявки департаменту (Plane №73, СС-3). */
export function securityEventForcesMembersPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/members/`;
}
export function securityEventForcesMemberPath(
  id: string,
  allocationId: string,
  employeeId: string
): string {
  return `${securityEventForcesMembersPath(id, allocationId)}${encodeURIComponent(
    employeeId
  )}/`;
}
/** Отправка окончательного списка штабу и её отзыв (Plane №73, СС-4). */
export function securityEventForcesSubmitPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/submit/`;
}
export function securityEventForcesWithdrawPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/withdraw/`;
}
/** Решение штаба по присланному списку (Plane №73, СС-5). */
export function securityEventForcesAcceptPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/accept/`;
}
export function securityEventForcesReturnPath(
  id: string,
  allocationId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/allocation/${encodeURIComponent(
    allocationId
  )}/return/`;
}
// `securityEventForcesCompletePath` СНЯТ вместе с ручкой (Plane №149).
export function securityEventPlacementAssignPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/assign/`;
}
export function securityEventPlacementUnassignPath(
  id: string,
  assignmentId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/${assignmentId}/`;
}
/**
 * Снятие ПУСТОГО поста с расчёта на этапе «Расстановка» (Plane №259).
 *
 * Путь идёт через `placement/posts/`, а не `placement/<id>`: второй занят
 * снятием НАЗНАЧЕНИЯ, и одиночный сегмент там съедается идентификатором
 * назначения.
 */
export function securityEventPlacementPostPath(
  id: string,
  postId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/posts/${encodeURIComponent(
    postId
  )}/`;
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

export function securityEventApproverMovePath(
  id: string,
  approverId: string
): string {
  return `${securityEventApproverPath(id, approverId)}move/`;
}

export interface MoveApproverRequest extends Record<string, unknown> {
  direction: "UP" | "DOWN";
}

export function securityEventApprovalSendPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/send/`;
}
export function securityEventApprovalWithdrawPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/withdraw/`;
}
export function securityEventRemarkResolvePath(
  id: string,
  remarkId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/remarks/${encodeURIComponent(remarkId)}/resolve/`;
}

export interface ResolveRemarkRequest extends Record<string, unknown> {
  resolved: boolean;
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

/** Рассылка уведомлений о заступлении: назначенным и их руководителям
 * (Plane №243). Отвечает ОТЧЁТОМ о рассылке, а не мероприятием: вопрос
 * кнопки — «кому ушло». */
export function securityEventAcknowledgementNotifyPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledgement/notify/`;
}

export interface AcknowledgementNotifyReport {
  /** Всего адресатов: сотрудники плюс их руководители. */
  notified: number;
  employees: number;
  supervisors: number;
  /** Кому НЕ ушло: у кадровой записи нет связанной учётки. Поимённо, а не
   *  числом — иначе чинить это некому. */
  unlinkedEmployeeIds: string[];
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
