// Конфигурация API для подключения к бэкенду
// В dev используем полный URL бэкенда (NEXT_PUBLIC_API_URL)
// В prod используем относительные пути (Next.js rewrites проксируют на backend)
import { BACKEND_URL } from "@/shared/config/env";
// Токен берётся из ОБЩЕГО кэша (`lib/access-token.ts`), а не спрашивается у
// сессии заново на каждый запрос (Plane №343). Здесь стоял собственный
// `getSession()` без памяти, и каждое обращение к бэку стоило лишний
// round-trip: замерено 158 запросов `/api/auth/session` на 84 запроса данных.
// Разбор и обоснование срока годности — в шапке `lib/access-token.ts`.
import { getAccessToken } from "@/lib/access-token";
const API_BASE_URL = BACKEND_URL;

// Интерфейсы для API
export interface ApiResponse<T> {
  data: T;
  message?: string;
  success: boolean;
}

export interface Employee {
  id: string;
  name: string;
  position: string;
  /**
   * Действующий статус; `undefined` — статуса нет (в том числе у вакантной
   * должности). Раньше поле было обязательным, и отсутствие подменялось
   * литералом "in_service" — вакансия показывалась «в строю».
   */
  status?:
    | "in_service"
    | "vacation"
    | "leave_by_report"
    | "sick_leave"
    | "business_trip"
    | "training"
    | "competition"
    | "conference"
    | "other_absence"
    | "on_duty"
    | "after_duty"
    | "seconded_from"
    | "seconded_to";
  statusState?: "planned" | "active" | "completed" | "cancelled";
  avatar: string;
  phone?: string;
  email?: string;
  department_id?: string;
  manager_id?: string;
  statusStartDate?: string;
  statusEndDate?: string;
}

export interface Department {
  id: string;
  name: string;
  head_id: string;
  parent_id?: string;
  type: "leadership" | "department" | "directorate" | "section";
  color?: string;
}

export interface OrgUnit {
  id: string;
  name: string;
  head: Employee;
  employees: Employee[];
  color: string;
  type: "leadership" | "department" | "directorate" | "section";
  children?: OrgUnit[];
}

// Интерфейсы для данных из staff-units API
export interface StaffUnitEmployee {
  position: {
    id: number;
    name: string;
    level: number;
  };
  employee: {
    id: number;
    first_name: string;
    last_name: string;
    middle_name?: string;
    photo?: string;
    photo_url?: string;
    current_status?: {
      status_type:
        | "in_service"
        | "vacation"
        | "leave_by_report"
        | "sick_leave"
        | "business_trip"
        | "training"
        | "competition"
        | "conference"
        | "other_absence"
        | "on_duty"
        | "after_duty"
        | "seconded_from"
        | "seconded_to";
      state: "planned" | "active" | "completed" | "cancelled";
      start_date?: string;
      end_date?: string | null;
    } | null;
    rank?: number | null;
  } | null; // employee может быть null для вакантных должностей
}

// Интерфейс для нового формата ответа API (дерево)
export interface StaffUnitTreeResponse {
  id: number;
  division: {
    id: number;
    name: string;
    level?: number;
    code?: string;
  };
  employees: Array<{
    position: {
      id: number;
      name: string;
      level: number;
    };
    employee: {
      id: number;
      first_name: string;
      last_name: string;
      middle_name?: string;
      photo?: string;
      photo_url?: string;
      current_status?: {
        status_type:
          | "in_service"
          | "vacation"
          | "leave_by_report"
          | "sick_leave"
          | "business_trip"
          | "training"
          | "competition"
          | "conference"
          | "other_absence"
          | "on_duty"
          | "after_duty"
          | "seconded_from"
          | "seconded_to";
        state: "planned" | "active" | "completed" | "cancelled";
        start_date?: string;
        end_date?: string | null;
      } | null;
      rank?: number | null;
    } | null;
    vacancy: number | null;
    index: number;
  }>;
  children: StaffUnitTreeResponse[];
}

export interface StaffUnit {
  id: number;
  division: {
    id: number;
    name: string;
    level?: number;
    code?: string;
  };
  index: number;
  parent_id: number | null;
  vacancy: number | null; // vacancy может быть null
  employees: StaffUnitEmployee[]; // массив сотрудников с позициями
  children?: StaffUnit[]; // children может быть undefined или отсутствовать (добавляется при построении дерева)
}

// Интерфейсы для статистики по штатным единицам
export interface StaffUnitStatisticsSummary {
  departments_count: number;
  directorates_count: number;
  divisions_count: number;
  staff_units_count: number;
  employees_count: number;
  vacancies_count: number;
}

export interface StaffUnitStatistics {
  /**
   * Подразделение, ОДНИМ КОТОРЫМ описывается область актора, либо `null`.
   *
   * `null` приходит, когда область накрывает несколько поддеревьев: так бывает
   * у роли раздела с двумя грантами и у права без области (Plane №339).
   * Назвать такую область первым попавшимся узлом значило бы соврать — тот же
   * довод, что у `division` в ручке `directorate` после №304. Читатель обязан
   * пережить `null`: голова доски тогда не показывается, а строки не теряются.
   */
  scope_division: {
    id: number;
    name: string;
    division_type: string;
  } | null;
  summary: StaffUnitStatisticsSummary;
  departments: Array<{
    department_id: number;
    department_name: string;
    /** Путь до подразделения СВЕРХУ ВНИЗ, без корня организации (Plane №214). */
    ancestors: string[];
    directorates_count: number;
    divisions_count: number;
    staff_units_count: number;
    employees_count: number;
    vacancies_count: number;
  }>;
  directorates: Array<{
    directorate_id: number;
    directorate_name: string;
    /** Путь до подразделения СВЕРХУ ВНИЗ, без корня организации (Plane №214). */
    ancestors: string[];
    divisions_count: number;
    staff_units_count: number;
    employees_count: number;
    vacancies_count: number;
  }>;
  divisions: Array<{
    division_id: number;
    division_name: string;
    /** Путь до подразделения СВЕРХУ ВНИЗ, без корня организации (Plane №214). */
    ancestors: string[];
    staff_units_count: number;
    employees_count: number;
    vacancies_count: number;
  }>;
}

/** Отбор и страницы у ручки штатки (все поля необязательны, Plane №227). */
export interface DirectorateQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  divisionId?: number | string;
  /** Код действующего статуса либо `none` — «статуса нет». */
  status?: string;
  /** Должности не ниже уровня (`level <= N`): так отбирается руководство. */
  positionLevelMax?: number;
  /** Только штатные единицы этих сотрудников (не больше 200). */
  employeeIds?: (number | string)[];
  /** Попросить сводку по отбору (сколько без статуса, просрочено, запланировано). */
  withSummary?: boolean;
  /** Исключить эти коды действующего статуса; строки без статуса тоже уходят. */
  statusNot?: string[];
}

// Интерфейсы для справочников
export interface Position {
  id: number;
  name: string;
  level: number;
}

export interface Rank {
  id: number;
  name: string;
  level: number;
  created_at?: string;
  updated_at?: string;
}

export interface Division {
  id: number;
  name: string;
  code: string;
  division_type: string;
  parent: number | null;
  is_active: boolean;
  order: number;
  children: Division[];
}

// Расход (строевая записка): форма ответа /api/operations/strength-report/.
// `columns` — коды статусов, порядок задаёт СЕРВЕР, поэтому шапку таблицы
// строим по этому массиву, а не по ключам объекта `row.columns`: порядок
// ключей объекта в JS не гарантирован и разъехался бы с сервером.
/**
 * Занятость мероприятиями — СПРАВОЧНО, рядом с колонками и ВНЕ их суммы
 * (Plane №243). Человек на ОМ остаётся в строю, поэтому своей колонки у него
 * нет: она вынула бы его из «В строю» и сломала «Σ колонок == Список».
 * `total` считает сервер отдельно, а не как сумму двух — появившийся третий
 * вид участия попадёт в него сам.
 */
export interface EventInvolvement {
  total: number;
  /** В составе боевой группы. */
  group: number;
  /** Физическим нарядом на объекте. */
  squad: number;
}

export interface StrengthReportRow {
  division_id: number;
  name: string;
  /**
   * Путь до подразделения СВЕРХУ ВНИЗ, без корня организации (Plane №327).
   *
   * Имена уникальны только внутри родителя: на структуре стенда «Второй
   * отдел» встречается пять раз, «Второе управление» — трижды. Строевая
   * записка, подписанная одним именем, печатала пять неразличимых строк с
   * одинаковыми числами — и это читалось как дубль выгрузки, то есть как
   * ошибка там, где ошибки нет.
   *
   * Необязательное: старый ответ без поля остаётся валидным, и читатель
   * обязан пережить его пустым.
   */
  ancestors?: string[];
  staff_total: number;
  list_total: number;
  vacancies: number;
  attached: number;
  off_list: number;
  columns: Record<string, number>;
  event: EventInvolvement;
}

/**
 * Кадровая карточка в контракте ядра (`/api/core/employees/`). Часть полей
 * сервер отдаёт null по построению — источника у них нет, и подставлять
 * похожее поле хуже молчания (см. докстринг сериализатора на бэке).
 */
export interface CoreEmployee {
  id: number;
  external_id: string | null;
  iin: string | null;
  full_name: string;
  last_name: string;
  first_name: string;
  middle_name: string;
  rank_code: string | null;
  rank_index: number | null;
  position_code: string | null;
  division: number | null;
  phone: string | null;
  gender: string | null;
  height_cm: number | null;
  is_active: boolean;
  is_attached_force: boolean | null;
  data_source: string | null;
  personnel_number: string | null;
  birth_date: string | null;
  photo_file_path: string | null;
  hire_date: string | null;
  dismissal_date: string | null;
  work_phone: string | null;
  work_email: string | null;
  personal_phone: string | null;
  personal_email: string | null;
  notes: string | null;
  employment_status: string | null;
}

/**
 * Ответ «кто я». `employee: null` — ШТАТНЫЙ исход: связь учётки с кадровой
 * записью заполняется вручную, и у части учёток её нет. Причина приходит
 * словами сервера, экран её не сочиняет.
 */
export interface MyEmployeeResponse {
  employee: CoreEmployee | null;
  unlinked_reason: string | null;
}

/** Справочники ядра: у них есть КОД, которым карточка ссылается на запись. */
export interface CoreRank {
  code: string;
  name: string;
  rank_index: number | null;
}

export interface CorePosition {
  code: string;
  name: string;
  level: number | null;
}

export interface CoreDivision {
  id: number;
  name: string;
  code: string | null;
  parent: number | null;
  /** Тип узла оргструктуры: organization / department / directorate / division.
   * Ручка отдавала его и раньше — читателя не было. Читает «Сбор сил на ОМ»:
   * адресатом заявки бывает только ДЕПАРТАМЕНТ (Plane №73). */
  type_code: string;
  /** Действует ли узел. Ручка отдавала поле и раньше — тип его не называл, и
   * «Сбор сил на ОМ» рисовал АРХИВНЫЕ управления строкой с полем ввода
   * (Plane №530). Сервер знает только действующие и отбивал всё тело. */
  is_active: boolean;
}

/**
 * Строка статуса раздела ОМ (`/api/operations/statuses/`). ЭТОТ адрес, а не
 * легаси `/api/statuses/statuses/`: раздел ОМ живёт своим каталогом типов и
 * своей областью видимости, и «мой профиль» читает именно его.
 *
 * Прежняя причина выбора («у легаси фильтр по сотруднику молча не
 * применяется — он отдаёт статусы ВСЕХ») снята 29.08.2026, Plane №289:
 * легаси-список получил фильтры `?employee=`/`?status_type=`/`?state=`, и
 * неизвестное значение теперь отбивается 400, а не тихой выдачей всего.
 */
export interface OpsEmployeeStatusRow {
  id: number;
  employee_id: number;
  status_type_code: string;
  date_start: string;
  date_end: string;
  state: "PLANNED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  source: string;
  comment: string;
  document_basis: string;
  cancelled_at: string | null;
  cancelled_reason: string;
  /** Мероприятия, на которые человек привлечён ЭТИМ статусом (Plane №281).
   *  Пустой массив — статус ни к какому ОМ не привязан. */
  participations: OpsStatusParticipation[];
}

/** Участие статуса в ОДНОМ мероприятии.
 *
 *  `event_code` и `event_title` едут с сервера ВМЕСТЕ с участием: без них у
 *  клиента был бы только `event_id`, и ссылку не на что подписать — экран так
 *  и показывал общий разрез «Сбор сил» вместо адреса ОМ (Plane №281). Обе
 *  строки пусты, если мероприятие удалено: ссылка в модели плоская, участие
 *  переживает удаление ОМ. */
export interface OpsStatusParticipation {
  event_id: number;
  kind_code: string;
  role_code: string;
  event_code: string;
  event_title: string;
  /** Колонка «По разделу ОМ» (Plane №427): объект посещения и пост из
   *  расстановки ОМ, отметка ознакомления; пусто — штаб ещё не распределил. */
  visit_object_name?: string;
  post_label?: string;
  acknowledged_at?: string | null;
}

/**
 * Тип статуса из справочника раздела (`/api/operations/status-types/`).
 *
 * `report_column_code` — В КАКУЮ КОЛОНКУ РАСХОДА попадает этот статус, и это
 * не то же самое, что сам код: «Привлечён на мероприятие» и «Группа
 * экстренного выезда» ложатся в чужие колонки («В строю» и «На дежурстве»
 * соответственно). Поэтому счёт «сколько на мероприятии» из расхода не
 * выводится — его даёт только поимённый разрез по статусам.
 */
export interface OpsStatusType {
  code: string;
  name: string;
  report_column_code: string;
  priority: number;
  counts_in_list: boolean;
  counts_in_staff: boolean;
  is_active: boolean;
  // Поля ниже сервер отдавал и раньше (`StatusTypeSerializer`), а тип о них
  // молчал — до Plane №344 их никто не показывал. Экран справочника типов
  // показывает СВОЙСТВА типа, а не только имя: администратор, заводящий тип,
  // выбирает ровно их.
  is_hard_block: boolean;
  restricts_editing: boolean;
  is_ku_owned: boolean;
  max_duration_days: number | null;
  color: string;
  /** Код того же статуса в кадровом словаре; `null` — типа там не было. */
  legacy_code: string | null;
}

/**
 * Строка журнала раздела ОМ (`/api/operations/audit-logs/`, право
 * `audit.view`). Плоский снимок доменного события — сервер не отдаёт ни
 * имени актора, ни имени сущности, только идентификаторы; собирать из них
 * читаемое имя на фронте значило бы придумывать данные, которых нет.
 */
export interface OpsAuditLogEntry {
  id: number;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: number;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string;
  created_at: string;
}

export interface StrengthReportTotals {
  staff_total: number;
  list_total: number;
  vacancies: number;
  attached: number;
  off_list: number;
  columns: Record<string, number>;
  event: EventInvolvement;
}

export interface StrengthReport {
  business_date: string;
  columns: string[];
  /**
   * Подписи колонок расхода. Владелец — сервер (`expense_layout`), общий с
   * выгрузками: свой словарь на клиенте разошёлся бы с файлами, а сличают их
   * как раз тогда, когда что-то пошло не так. Незнакомый код сервер подписывает
   * им же самим — пустая подпись скрыла бы, что колонка вообще есть.
   */
  column_labels: Record<string, string>;
  rows: StrengthReportRow[];
  totals: StrengthReportTotals;
  warnings: Record<string, unknown>[];
}

/** Страница расхода за один день внутри ответа периода. */
export interface StrengthReportPage {
  business_date: string;
  rows: StrengthReportRow[];
  totals: StrengthReportTotals;
}

export interface StrengthReportPeriod {
  pages: StrengthReportPage[];
}

/**
 * Узел светофора сдачи дня.
 *
 * Цветов ПЯТЬ, а не три: `NEUTRAL` — узлу нечего сдавать (людей нет),
 * `UNKNOWN` — справочник узла сломан и цвет неизвестен. Оба намеренно не
 * приравнены к зелёному: «не знаю» честнее, чем «всё в порядке».
 *
 * Цвет узла С ПОТОМКАМИ — худший в поддереве (каскад), поэтому складывать
 * родителей с детьми нельзя: одно подразделение посчиталось бы дважды.
 */
export interface TrafficLightNode {
  division_id: number;
  name: string;
  parent_id: number | null;
  status: "GREEN" | "YELLOW" | "RED" | "NEUTRAL" | "UNKNOWN";
  late: boolean;
}

export interface TrafficLightTree {
  business_date: string;
  /** Порог опоздания из настроек контроля сдачи, «HH:MM:SS». Едет вместе с
   * вердиктом: по нему выставлен `late` у узлов, и отдельной ручкой порог
   * разъехался бы с вердиктом, который объясняет. */
  control_hour: string;
  nodes: TrafficLightNode[];
}

/**
 * Уведомление раздела — ФАКТ, а не готовый текст: вид, деловая дата и плоские
 * данные. Как это прочитать человеку — дело читающего экрана, поэтому
 * формулировка живёт в UI, а не в ответе.
 *
 * `payload.laggard_division_ids` несёт ТОЛЬКО идентификаторы: уведомление
 * переживает удаление того, о чём сообщало, и хранить в нём имена значило бы
 * хранить их снимок. Имя доклеивает экран из уже загруженного дерева
 * светофора; чего в дереве нет — показывается номером.
 */
export interface OpsNotification {
  id: number;
  recipient: string;
  kind:
    | "SUBMISSION_LAGGING"
    | "EVENT_ACKNOWLEDGEMENT"
    | "FORCES_REQUEST"
    | "PLACEMENT_RETURNED"
    | "ACKNOWLEDGEMENT_DUE_SOON"
    | "FORCES_RESPONSE"
    | "ASSIGNMENT_DECLINED";
  business_date: string;
  /** `laggard_division_ids` — только у `SUBMISSION_LAGGING`; остальные поля —
   *  у `EVENT_ACKNOWLEDGEMENT` (Plane №402, `acknowledgement_notify.py`).
   *  `asSupervisor` отличает уведомление руководителя от уведомления самого
   *  заступающего — текст один и тот же payload, а звучать должен по-разному. */
  payload: {
    laggard_division_ids?: number[];
    eventId?: string;
    eventCode?: string;
    eventTitle?: string;
    businessDate?: string;
    objectName?: string;
    asSupervisor?: boolean;
    /** `FORCES_REQUEST` (Plane №392): запрос сил управлению. */
    allocationId?: string;
    departmentName?: string;
    directorateId?: string;
    directorateName?: string;
    need?: number;
    dueAt?: string | null;
    /** `FORCES_RESPONSE` (Plane №426, `[СБС-12]`): департамент ответил штабу
     *  «Выделяем: X» на запрос из `requested`. */
    requested?: number;
    allocating?: number;
    /** `PLACEMENT_RETURNED` (Plane №400, `[ВОЗ-03]`): возврат расстановки
     *  объекта — старшему и замещающим. */
    visitObjectId?: string;
    comment?: string;
    remarksOpen?: number;
    urgent?: boolean;
    documentVersion?: number;
    /** `ASSIGNMENT_DECLINED` (Plane №451, `[ПРФ-04]`): сотрудник ответил
     *  «Не могу заступить». Старшему нужно ИМЯ и ПРИЧИНА — по ним он решает,
     *  кем заменять; идентификатор назначения ведёт в лист ознакомления. */
    assignmentId?: string;
    employeeName?: string;
    reason?: string;
    /** `ACKNOWLEDGEMENT_DUE_SOON` (Plane №427, `[ОЗН-06]`): за час до
     *  заступления — ПОИМЁННО те, кто ещё не подтвердил. Список, а не число:
     *  руководителю нужно знать, кому звонить, а не сколько их. */
    unconfirmed?: { employeeId: string; employeeName: string }[];
    /** Признак того самого часа — сервер ставит его тем же payload'ом. */
    oneHourBefore?: boolean;
  };
  read_at: string | null;
  created_at: string;
}

export interface OpsNotificationPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: OpsNotification[];
}

/** Поимённое расхождение сданного дня с живыми данными (только у жёлтого).
 * names доклеивает бэк: {employee_id: «Фамилия Имя»}; id без имени — человек
 * уже не находится (уволен/удалён), UI показывает номер честно. */
export interface TrafficLightDrift {
  added: number[];
  removed: number[];
  changed: { employee_id: number; from: string; to: string }[];
  names: Record<string, string>;
}

export interface DivisionTrafficLight {
  division_id: number;
  business_date: string;
  status: TrafficLightNode["status"];
  late: boolean;
  drift: TrafficLightDrift | null;
}

// Ошибка раздела ОМ: бэк отвечает конвертом {error_code, message, details}.
// Держим `code` отдельно от текста, чтобы UI мог разводить случаи по коду
// (например DAY_NOT_SUBMITTED — это не поломка, а «выгружать нечего»), а не
// сравнением строк сообщения, которое переписывают без предупреждения.
export class OpsApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "OpsApiError";
    this.status = status;
    this.code = code;
  }
}

// Отказ ручки старого стека (staff_unit и соседи): статус несём полем, а не
// строкой «HTTP error! status: 403 - ...». UI обязан разводить «нет прав» и
// «сервер упал» РАЗНЫМИ экранами, а по тексту сообщения это делалось бы
// подстрокой — сломается при первой же правке формулировки на бэке.
//
// Намеренно НЕ переиспользуем OpsApiError: тот разбирает конверт
// {error_code, message} раздела ОМ, а у старого стека конверта нет вовсе —
// тут прилетает {"error": "..."} или голый текст.
export class ApiHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

// Достаёт человекочитаемую причину из тела отказа старого стека. Тело читаем
// как текст и лишь потом пробуем как JSON: на 500 Django отдаёт HTML-страницу,
// и response.json() подменил бы причину отказа своим SyntaxError.
function staffErrorMessage(raw: string, status: number): string {
  try {
    const body = JSON.parse(raw);
    const detail = body?.error ?? body?.detail;
    if (typeof detail === "string" && detail !== "") return detail;
  } catch {
    // не JSON — падать обратно на сырой текст
  }
  return raw !== "" ? raw : `HTTP ${status}`;
}

// Разбирает неуспешный ответ в OpsApiError. Тело читаем как текст и лишь
// потом пробуем как JSON: у выгрузки тип ответа файловый, и на ошибке там
// может прийти не-JSON — `response.json()` тогда бросил бы SyntaxError,
// подменив настоящую причину отказа.
async function toDomainError(response: Response): Promise<OpsApiError> {
  const raw = await response.text();
  let code: string | null = null;
  let message = "";
  try {
    const body = JSON.parse(raw);
    code = body?.error_code ?? null;
    message = body?.message || body?.detail || "";
  } catch {
    message = raw;
  }
  return new OpsApiError(
    response.status,
    code,
    message || `HTTP ${response.status}`
  );
}

/**
 * Достать человекочитаемую причину отказа из тела ответа.
 *
 * Бэкенд статусов отдаёт `{"error": "...", "errors": [...]}`. Старые ответы
 * (и часть ручек) кладут в `error` repr питоновского словаря
 * `{'start_date': ['Период пересекается...']}` — из него вынимаются строки в
 * кавычках: показать пользователю дамп хуже, чем не показать ничего.
 *
 * Вернёт null, если разобрать не удалось — тогда зовущий покажет своё
 * сообщение, а не пустоту.
 */
export function extractApiErrorMessage(body: string): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.errors) && record.errors.length > 0) {
    return record.errors.map(String).join(" ");
  }

  const raw = record.error ?? record.detail;
  if (typeof raw !== "string") return null;

  // repr словаря: вытаскиваем сами сообщения, без имён полей и скобок.
  if (raw.trimStart().startsWith("{")) {
    const quoted = raw.match(/'((?:[^'\\]|\\.)*)'/g);
    if (!quoted) return null;
    const messages = quoted
      .map((part) => part.slice(1, -1).replace(/\\'/g, "'"))
      // Ключи словаря — имена полей без пробелов; причина всегда фраза.
      .filter((part) => part.includes(" "));
    return messages.length > 0 ? messages.join(" ") : null;
  }
  return raw;
}

// Класс для работы с API
class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    token?: string | null
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const defaultHeaders: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    // Получаем токен из NextAuth сессии, если не передан явно
    let authToken = token;
    if (!authToken && typeof window !== "undefined") {
      authToken = await getAccessToken();
    }

    // Добавляем токен авторизации, если он есть
    if (authToken) {
      defaultHeaders["Authorization"] = `Bearer ${authToken}`;
    }

    const config: RequestInit = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Методы для работы с сотрудниками
  async getEmployees(): Promise<ApiResponse<Employee[]>> {
    return this.request<Employee[]>("/api/employees");
  }

  async getEmployee(id: string): Promise<ApiResponse<Employee>> {
    return this.request<Employee>(`/api/employees/${id}/`);
  }

  async createEmployee(
    employee: Omit<Employee, "id">
  ): Promise<ApiResponse<Employee>> {
    return this.request<Employee>("/api/employees/", {
      method: "POST",
      body: JSON.stringify(employee),
    });
  }

  async updateEmployee(
    id: string,
    employee: Partial<Employee>
  ): Promise<ApiResponse<Employee>> {
    return this.request<Employee>(`/api/employees/${id}/`, {
      method: "PUT",
      body: JSON.stringify(employee),
    });
  }

  async deleteEmployee(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/api/employees/${id}/`, {
      method: "DELETE",
    });
  }

  // Методы для работы с департаментами
  async getDepartments(): Promise<ApiResponse<Department[]>> {
    return this.request<Department[]>("/api/departments/");
  }

  async getDepartment(id: string): Promise<ApiResponse<Department>> {
    return this.request<Department>(`/api/departments/${id}/`);
  }

  async createDepartment(
    department: Omit<Department, "id">
  ): Promise<ApiResponse<Department>> {
    return this.request<Department>("/api/departments/", {
      method: "POST",
      body: JSON.stringify(department),
    });
  }

  async updateDepartment(
    id: string,
    department: Partial<Department>
  ): Promise<ApiResponse<Department>> {
    return this.request<Department>(`/api/departments/${id}/`, {
      method: "PUT",
      body: JSON.stringify(department),
    });
  }

  async deleteDepartment(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/api/departments/${id}/`, {
      method: "DELETE",
    });
  }

  // Методы для работы с организационной структурой
  async getOrgChart(): Promise<ApiResponse<OrgUnit>> {
    return this.request<OrgUnit>("/api/org-chart/");
  }

  // Новый метод для получения данных из staff-units API
  // API возвращает массив напрямую, не в формате ApiResponse
  /**
   * Штатные единицы. БЕЗ аргументов — ВСЕ, а не первая страница (Plane №269).
   *
   * Ручка постраничная (конверт DRF `{count, next, previous, results}`), и
   * метод брал только первый ответ: на стенде это 50 строк из 442, то есть
   * «Структура организации» показывала девятую часть департамента и молчала об
   * этом. Заказчик: «Структура организации должна показывать всю штатку
   * департамента».
   *
   * Страницы обходятся ПО `next`, а не одним запросом с большим `page_size`.
   * Сервер сегодня отдаёт по `page_size=500` всё разом, но это его нынешняя
   * щедрость, а не контракт: вырастет штат или появится потолок — и обрезание
   * вернётся ровно тем же молчаливым способом. Крупный `page_size` остаётся
   * как способ сократить число ходов, а `next` — как гарантия полноты.
   *
   * Явная `page` сохраняет прежнее поведение «одна страница»: у метода могут
   * быть читатели, которым нужна именно страница.
   */
  async getStaffUnits(page?: number, pageSize?: number): Promise<StaffUnit[]> {
    const wantsEveryPage = page === undefined;
    const params = new URLSearchParams();
    if (page !== undefined) params.append("page", page.toString());
    // Полный обход начинается с крупной страницы: 442 строки стенда приезжают
    // одним ходом, а не девятью.
    params.append(
      "page_size",
      (pageSize ?? (wantsEveryPage ? 500 : 50)).toString()
    );
    const queryString = params.toString();
    const endpoint = `/api/staff_unit/staff-units/${
      queryString ? `?${queryString}` : ""
    }`;

    // Используем относительный путь (Next.js rewrites проксируют)
    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    console.log("📡 [API Client] getStaffUnits");
    console.log("  → Base URL:", this.baseUrl || "(empty - using rewrites)");
    console.log("  → Endpoint:", endpoint);
    console.log("  → Full URL:", url);

    // Получаем токен из NextAuth сессии
    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Хвост страниц. Ходим по `next` сервера, а не считаем адреса сами:
      // адрес знает сервер, и собранный вручную разошёлся бы с ним на первом
      // же изменении отбора. Потолок ходов — страховка от кольца в `next`, а
      // не бизнес-ограничение: до него не доходит ни один реальный штат.
      if (wantsEveryPage && data && typeof data === "object" && "results" in data) {
        const envelope = data as { next?: string | null; results: unknown[] };
        let nextUrl = envelope.next ?? null;
        for (let hop = 0; nextUrl !== null && hop < 200; hop += 1) {
          const hopResponse = await fetch(nextUrl, { headers });
          if (!hopResponse.ok) {
            // Оборванный обход — это НЕ «получили сколько получили»: неполный
            // список молча соврёт о штатке ровно так же, как первая страница.
            throw new Error(
              `HTTP error! status: ${hopResponse.status} — обход страниц штатки прерван`
            );
          }
          const hopData = (await hopResponse.json()) as {
            next?: string | null;
            results?: unknown[];
          };
          envelope.results.push(...(hopData.results ?? []));
          nextUrl = hopData.next ?? null;
        }
      }

      // Функция для преобразования дерева в плоский массив
      const flattenTree = (
        tree: StaffUnitTreeResponse,
        parentId: number | null = null
      ): StaffUnit[] => {
        const result: StaffUnit[] = [];

        // Преобразуем employees из нового формата в старый
        const employees: StaffUnitEmployee[] = tree.employees.map((emp) => ({
          position: emp.position,
          employee: emp.employee,
        }));

        // Вычисляем минимальный index из всех employees для сортировки
        const minIndex =
          tree.employees.length > 0
            ? Math.min(...tree.employees.map((emp) => emp.index))
            : 0;

        // Проверяем наличие вакансий (если хотя бы один employee имеет vacancy !== null)
        const hasVacancy = tree.employees.some((emp) => emp.vacancy !== null);
        const vacancy = hasVacancy
          ? tree.employees.find((emp) => emp.vacancy !== null)?.vacancy ?? null
          : null;

        // Создаем StaffUnit из текущего узла дерева
        const staffUnit: StaffUnit = {
          id: tree.id,
          division: {
            id: tree.division.id,
            name: tree.division.name,
            level: tree.division.level,
            code: tree.division.code,
          },
          index: minIndex,
          parent_id: parentId,
          vacancy: vacancy,
          employees: employees,
        };

        result.push(staffUnit);

        // Рекурсивно обрабатываем детей
        if (tree.children && tree.children.length > 0) {
          tree.children.forEach((child) => {
            result.push(...flattenTree(child, tree.id));
          });
        }

        return result;
      };

      // Если API возвращает дерево (объект с children)
      if (data && typeof data === "object" && "children" in data) {
        return flattenTree(data as StaffUnitTreeResponse);
      }

      // Живой бэкенд (StaffUnitViewSet.list) отдаёт конверт DRF-пагинации
      // {count, next, previous, results}. Раньше он не совпадал ни с веткой
      // дерева, ни с веткой массива, метод молча возвращал [] — и экран
      // /organization/ писал «Данные не загружены из API» при HTTP 200.
      const rows: unknown[] | null = Array.isArray(data)
        ? data
        : data &&
            typeof data === "object" &&
            Array.isArray((data as { results?: unknown }).results)
          ? ((data as { results: unknown[] }).results)
          : null;

      if (rows) {
        // Строка списка описывает ОДНУ штатную единицу: должность и сотрудник
        // лежат в корне (position/employee), а не в массиве employees, который
        // ждут convertStaffUnitsResponseToOrgUnit и OrgNode. Приводим форму
        // бэка к форме потребителя — контракт бэка источник правды.
        return rows.map((row) => {
          const unit = row as StaffUnit & {
            position?: StaffUnitEmployee["position"] | null;
            employee?: StaffUnitEmployee["employee"] | null;
          };

          let employees: StaffUnitEmployee[];
          if (Array.isArray(unit.employees)) {
            employees = unit.employees;
          } else if (unit.position || unit.employee) {
            employees = [
              {
                // position на строке может быть null (штатная единица без
                // должности в справочнике). Пустой employees здесь означал бы
                // «вакансия» и стирал реального сотрудника из строки, поэтому
                // подставляем нейтральную должность — ту же формулировку, что
                // используют остальные экраны для отсутствующей должности.
                position: unit.position ?? {
                  id: 0,
                  name: "Должность не указана",
                  level: Number.MAX_SAFE_INTEGER,
                },
                // Вакантная строка приходит с employee: null — оставляем
                // как есть, конвертер подписывает её «Вакантная должность».
                employee: unit.employee as StaffUnitEmployee["employee"],
              },
            ];
          } else {
            employees = [];
          }

          return {
            id: unit.id,
            division: unit.division,
            index: unit.index,
            parent_id: unit.parent_id ?? null,
            vacancy: unit.vacancy ?? null,
            employees,
          };
        });
      }

      return [];
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Отбор и страницы штатки — см. `_directorate_get` в staff_unit/views.py.
  // Метод для получения staff units по директории
  // API возвращает данные напрямую, не в формате ApiResponse
  async getStaffUnitsByDirectorate(params: DirectorateQuery = {}): Promise<{
    /** Подразделение, ОДНИМ КОТОРЫМ описывается ответ, либо `null`.
     *
     * `null` приходит, когда такого подразделения не существует: у
     * суперпользователя, видящего все деревья оргструктуры сразу (корней в базе
     * бывает несколько). Раньше сервер отдавал в этом случае первый корень —
     * и диалог статусов писал его в `related_division` всем подряд (Plane
     * №304). Читателю положен запасной путь: подразделение ШТАТНОЙ ЕДИНИЦЫ
     * сотрудника. */
    division: {
      id: number;
      name: string;
      code: string;
    } | null;
    staff_units: StaffUnit[];
    /** Сколько строк В ЭТОМ ответе. */
    total_count: number;
    /** Сколько строк отвечает отбору (без страниц равен `total_count`). */
    matched_count?: number;
    page?: number;
    page_size?: number;
    has_next?: boolean;
    summary?: {
      employees: number;
      without_status: number;
      overdue: number;
      scheduled: number;
    };
  }> {
    // Параметры НЕОБЯЗАТЕЛЬНЫ, и это несущее решение бэка (Plane №227): без
    // них ручка отдаёт весь состав подразделения, как отдавала всегда — этим
    // живут календарь статусов и массовая правка.
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set("page", String(params.page));
    if (params.pageSize !== undefined) query.set("page_size", String(params.pageSize));
    if (params.search) query.set("search", params.search);
    if (params.divisionId) query.set("division_id", String(params.divisionId));
    if (params.status) query.set("status", params.status);
    if (params.positionLevelMax !== undefined)
      query.set("position_level_max", String(params.positionLevelMax));
    if (params.employeeIds !== undefined && params.employeeIds.length > 0)
      query.set("employee_ids", params.employeeIds.join(","));
    if (params.withSummary) query.set("with_summary", "1");
    if (params.statusNot !== undefined && params.statusNot.length > 0)
      query.set("status_not", params.statusNot.join(","));
    const suffix = query.toString() === "" ? "" : `?${query.toString()}`;
    const endpoint = `/api/staff_unit/staff-units/directorate/${suffix}`;

    // Используем относительный путь (Next.js rewrites проксируют)
    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    console.log("📡 [API Client] getStaffUnitsByDirectorate");
    console.log("  → Base URL:", this.baseUrl || "(empty - using rewrites)");
    console.log("  → Endpoint:", endpoint);
    console.log("  → Full URL:", url);

    // Получаем токен из NextAuth сессии
    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new ApiHttpError(
          response.status,
          staffErrorMessage(errorText, response.status)
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для обновления штатного расписания подразделения
  // PUT /api/staff_unit/staff-units/directorate/
  async updateStaffUnitsByDirectorate(data: {
    staff_units?: Array<{
      id?: number;
      division?: number;
      position?: number;
      index?: string;
    }>;
    employees?: Array<{
      id?: number;
      first_name?: string;
      last_name?: string;
      middle_name?: string;
      iin?: string;
      rank?: number;
    }>;
    employee_statuses: Array<{
      employee: number;
      // 🔴 `string`, а не перечисление тринадцати кодов (Plane №354). Здесь
      // лежала ТРЕТЬЯ копия каталога статусов — после модели и клиентского
      // зеркала. Типы обещали то, чего сервер уже не требует: список типов
      // живёт в справочнике и пополняется администратором, и union запрещал
      // отправить заведённый им код ещё до всякого запроса. Проверку взял на
      // себя сервер — он сверяет код со справочником и отвечает словами.
      status_type: string;
      start_date?: string;
      end_date?: string;
      comment?: string;
    }>;
    // Ручка отвечает сводкой, а НЕ списком штатных единиц: объявленный тип
    // StaffUnit[] был неправдой, и потребитель не мог прочитать ни счётчик
    // применённых, ни причины отказов — молча считал вызов успешным.
  }): Promise<{
    success: boolean;
    updated: { staff_units: number; employees: number; statuses: number };
    division: { id: number; name: string };
    errors?: unknown[];
  }> {
    const endpoint = `/api/staff_unit/staff-units/directorate/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(data),
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Методы для работы со статусами
  async updateEmployeeStatus(
    id: string,
    status: Employee["status"]
  ): Promise<ApiResponse<Employee>> {
    return this.request<Employee>(`/api/employees/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  /**
   * Действие над конкретным статусом.
   *
   * Отдельно от `updateEmployeeStatusById`, потому что это РАЗНЫЕ операции
   * домена, а не разновидность правки: PATCH активного статуса сервер
   * запрещает всегда («Активный статус можно только продлить или завершить
   * досрочно»), и продление с досрочным завершением — единственный способ его
   * тронуть (Plane №255).
   *
   * Сервер знает и третье действие — `cancel` (отмена запланированного). Оно
   * здесь НЕ заведено намеренно: читателя у него пока нет, а метод без
   * читателя не проверяется ничем.
   */
  private async postStatusAction(
    statusId: number,
    action: "extend" | "terminate",
    body: Record<string, unknown>
  ): Promise<any> {
    const endpoint = `/api/statuses/statuses/${statusId}/${action}/`;
    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API request failed: ${response.status}`, errorText);
      // Причина отказа — текст для человека («Новая дата окончания должна быть
      // позже текущей»), а не дамп тела ответа.
      throw new Error(
        extractApiErrorMessage(errorText) ||
          `HTTP error! status: ${response.status} - ${errorText}`
      );
    }

    return await response.json();
  }

  /** Продление действующего статуса: новая дата окончания. */
  async extendEmployeeStatus(
    statusId: number,
    newEndDate: string
  ): Promise<any> {
    return this.postStatusAction(statusId, "extend", {
      new_end_date: newEndDate,
    });
  }

  /** Досрочное завершение действующего статуса: дата и причина. */
  async terminateEmployeeStatus(
    statusId: number,
    terminationDate: string,
    reason: string
  ): Promise<any> {
    return this.postStatusAction(statusId, "terminate", {
      termination_date: terminationDate,
      reason,
    });
  }

  // Обновление конкретного статуса по ID
  async updateEmployeeStatusById(
    statusId: number,
    data: {
      employee: number;
      status_type: string;
      start_date?: string;
      end_date?: string;
      comment?: string;
    }
  ): Promise<any> {
    const endpoint = `/api/statuses/statuses/${statusId}/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify(data),
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        // Как и при создании: пользователю едет причина отказа, а не тело
        // ответа. Здесь она особенно нужна — сервер отказывает содержательно
        // («Нельзя изменить статус, дата начала которого уже наступила»).
        throw new Error(
          extractApiErrorMessage(errorText) ||
            `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Создание нового статуса сотрудника
  async createEmployeeStatus(data: {
    employee: number;
    // `string`, а не тринадцать кодов (Plane №354): ЧЕТВЁРТАЯ копия каталога
    // жила здесь и запрещала отправить тип, заведённый администратором, ещё
    // до запроса. Список допустимого держит сервер и сверяет со справочником.
    status_type: string;
    start_date?: string;
    end_date?: string;
    comment?: string;
    location?: string;
    related_division?: number;
  }): Promise<any> {
    const endpoint = `/api/statuses/statuses/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        // Пользователю показывается причина отказа, а не тело ответа: «нельзя,
        // период пересекается с отпуском» и «HTTP 400 {"error": "..."}» —
        // разные сообщения, и второе ничего не объясняет.
        throw new Error(
          extractApiErrorMessage(errorText) ||
            `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  async massUpdateStatus(
    employeeIds: string[],
    status: Employee["status"]
  ): Promise<ApiResponse<Employee[]>> {
    return this.request<Employee[]>("/api/employees/mass-status-update", {
      method: "PATCH",
      body: JSON.stringify({ employee_ids: employeeIds, status }),
    });
  }

  // Методы для работы со справочниками
  async getPositions(
    page?: number,
    pageSize?: number
  ): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Position[];
  }> {
    const params = new URLSearchParams();
    if (page !== undefined) params.append("page", page.toString());
    if (pageSize !== undefined) params.append("page_size", pageSize.toString());
    const queryString = params.toString();
    const endpoint = `/api/dictionaries/positions/${
      queryString ? `?${queryString}` : ""
    }`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        // ApiHttpError, а не безымянная Error (Plane №329): по коду отличают
        // «нет права» от поломки — на этом стоит и запрет повтора 4xx в
        // `retryUnlessClientError`, и текст причины вместо общего «HTTP error».
        const errorText = await response.text();
        throw new ApiHttpError(
          response.status,
          staffErrorMessage(errorText, response.status)
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  async getRanks(
    page?: number,
    pageSize?: number
  ): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Rank[];
  }> {
    const params = new URLSearchParams();
    if (page !== undefined) params.append("page", page.toString());
    if (pageSize !== undefined) params.append("page_size", pageSize.toString());
    const queryString = params.toString();
    const endpoint = `/api/dictionaries/ranks/${
      queryString ? `?${queryString}` : ""
    }`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        // ApiHttpError, а не безымянная Error (Plane №329): по коду отличают
        // «нет права» от поломки — на этом стоит и запрет повтора 4xx в
        // `retryUnlessClientError`, и текст причины вместо общего «HTTP error».
        const errorText = await response.text();
        throw new ApiHttpError(
          response.status,
          staffErrorMessage(errorText, response.status)
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Методы для аутентификации
  // Новый метод для получения токена из /api/token/
  async login(
    username: string,
    password: string
  ): Promise<{
    access: string;
    refresh: string;
  }> {
    // Используем относительный путь (Next.js rewrites проксируют)
    const url = this.baseUrl ? `${this.baseUrl}/api/token/` : "/api/token/";

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        // Пытаемся получить детали ошибки от сервера
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorText = await response.text();
          if (errorText) {
            errorMessage += ` - ${errorText}`;
          }
        } catch (e) {
          // Игнорируем ошибку чтения текста ошибки
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    }
  }

  async logout(): Promise<ApiResponse<void>> {
    return this.request<void>("/api/auth/logout/", {
      method: "POST",
    });
  }

  async getCurrentUser(): Promise<ApiResponse<Employee>> {
    return this.request<Employee>("/api/auth/me/");
  }

  // Методы для статистики
  async getDashboardStats(): Promise<
    ApiResponse<{
      totalEmployees: number;
      activeEmployees: number;
      onVacation: number;
      sick: number;
      onBusinessTrip: number;
      departments: number;
    }>
  > {
    return this.request("/api/dashboard/stats/");
  }

  // Метод для получения статистики по отсутствиям
  async getAbsenceStatistics(): Promise<{
    period: {
      start_date: string;
      end_date: string;
    };
    division_id: number;
    staff_count: number;
    total_absences: number;
    by_type: {
      vacation: number;
      leave_by_report: number;
      sick_leave: number;
      business_trip: number;
      training: number;
      competition: number;
      conference: number;
      other_absence: number;
      on_duty: number;
      after_duty: number;
      seconded_from: number;
      seconded_to: number;
    };
  }> {
    const endpoint = `/api/statuses/statuses/absence_statistics/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        // ApiHttpError, а не безымянная Error (Plane №340): «учётка не
        // привязана к сотруднику» — ШТАТНОЕ состояние служебной учётки, и
        // отличить его от поломки можно только по коду ответа.
        throw new ApiHttpError(
          response.status,
          staffErrorMessage(errorText, response.status)
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для получения текущего и запланированных статусов сотрудника
  async getEmployeePlannedStatuses(employeeId: number): Promise<{
    current: any | null;
    planned: any[];
  }> {
    const endpoint = `/api/statuses/statuses/planned/?employee_id=${employeeId}`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для создания сотрудника и штатной единицы
  // POST /api/staff_unit/staff-units/directorate/
  async createStaffUnit(data: {
    employees: Array<{
      first_name: string;
      last_name: string;
      middle_name?: string;
      iin: string;
      rank?: number;
    }>;
    staff_units: Array<{
      division: number;
      position: number;
    }>;
  }): Promise<any> {
    const endpoint = `/api/staff_unit/staff-units/directorate/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const responseData = await response.json();
      return responseData;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для получения дерева подразделений
  // GET /api/divisions/divisions_tree/
  async getDivisionsTree(): Promise<Division> {
    const endpoint = `/api/divisions/divisions_tree/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "*/*",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для получения статистики по штатным единицам и сотрудникам
  async getStaffUnitStatistics(): Promise<StaffUnitStatistics> {
    const endpoint = `/api/staff_unit/statistics/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        // ApiHttpError, а не безымянная Error (Plane №339): по коду
        // отличают «области нет» (400) от поломки, и на этом стоит запрет
        // повтора 4xx — без него react-query переспрашивал трижды, и один
        // отказ печатался в консоли четырьмя строками.
        throw new ApiHttpError(
          response.status,
          staffErrorMessage(errorText, response.status)
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для обновления профиля пользователя
  async updateProfile(data: {
    first_name?: string;
    last_name?: string;
    email?: string;
  }): Promise<ApiResponse<any>> {
    return this.request<any>("/api/user/profile/", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // Метод для смены пароля
  async changePassword(data: {
    current_password: string;
    new_password: string;
  }): Promise<ApiResponse<void>> {
    return this.request<void>("/api/user/change-password/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Методы для отчетов
  async downloadExpenseReport(date?: string): Promise<Blob> {
    const params = new URLSearchParams();
    if (date) params.append("date", date);
    const queryString = params.toString();
    const endpoint = `/api/reports/reports/expense/${
      queryString ? `?${queryString}` : ""
    }`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {};

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const blob = await response.blob();
      return blob;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Расход (строевая записка) — ЖИВОЙ контракт раздела ОМ.
  //
  // Соседний `downloadExpenseReport` выше бьёт в донорскую ручку
  // `/api/reports/reports/expense/<department_id>/`. ОСНОВАНИЕ «она нерабочая,
  // шаблона нет в репозитории» СНЯТО 29.08.2026 (Plane №254): шаблон
  // `расход.xlsx` возвращён в поставку (`apps/reports/`), ручка собирает
  // документ, пробы гоняются по настоящему шаблону.
  //
  // Расход всё равно читается ОТСЮДА, и причина осталась своя: это живой
  // контракт раздела ОМ — он строится из подписанных сдач дня, знает область
  // видимости и умеет четыре формата, тогда как донорская ручка отдаёт один
  // xlsx по департаменту и области видимости не знает. Перевод экранов на неё
  // — отдельная работа, а не «заодно».
  //
  // `division_id` НЕ обязателен: бэк сужает выборку по области видимости
  // всегда, поэтому «свой департамент» определяет он, а не клиент. Клиенту
  // незачем угадывать, какой из предков его подразделения — департамент.
  async getStrengthReport(params: {
    businessDate?: string;
    divisionId?: number;
  } = {}): Promise<StrengthReport> {
    const query = new URLSearchParams();
    if (params.businessDate) query.append("business_date", params.businessDate);
    if (params.divisionId !== undefined) {
      query.append("division_id", String(params.divisionId));
    }
    const queryString = query.toString();
    const endpoint = `/api/operations/strength-report/${
      queryString ? `?${queryString}` : ""
    }`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;
    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) {
      throw await toDomainError(response);
    }
    return response.json();
  }

  // Чтение под тем же контрактом ошибок, что и расход выше: отказ раздела
  // приезжает конвертом {error_code, message}, и общий `request` подменил бы
  // его безымянным «HTTP error 403» — экран не смог бы отличить «нет права»
  // от поломки.
  private async getDomainJson<T>(endpoint: string): Promise<T> {
    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;
    const token = await getAccessToken();
    const headers: HeadersInit = { accept: "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) {
      throw await toDomainError(response);
    }
    return response.json();
  }

  /** POST под тем же конвертом ошибок, что и `getDomainJson` — для действий
   *  раздела, у которых нет своего именованного `postXxx`-метода. */
  private async postDomainJson<T>(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;
    const token = await getAccessToken();
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) {
      throw await toDomainError(response);
    }
    return response.json();
  }

  /** Каталог кадровых типов статусов (Plane №354).
   *
   * Список правится администратором в справочнике и меняется БЕЗ выкатки
   * клиента — поэтому он спрашивается у сервера, а не лежит копией в коде.
   */
  async getEmployeeStatusTypes(
    selectableOnly = true
  ): Promise<Array<{ code: string; label: string; color: string }>> {
    const query = selectableOnly ? "?selectable=1" : "";
    return this.getDomainJson(`/api/statuses/types/${query}`);
  }

  // Статусы ОДНОГО сотрудника. Фильтр серверный (`employee_id`) и проверен
  // живой пробой: у легаси-адреса тот же по смыслу параметр игнорируется.
  //
  // 🔴 `limit`, А НЕ `page_size`. Списки раздела ОМ пагинируются
  // `LimitOffsetPagination` — она понимает `limit`/`offset`, а `page_size`
  // ИГНОРИРУЕТ и молча отдаёт умолчание в 50 строк. Проверено живьём:
  // `?page_size=500` → 50 строк при `count` 1045, `?limit=500` → 500.
  // Молчание здесь и есть дефект: клиент, попросивший всё, получает часть и
  // не может отличить «больше нет» от «больше не дали» (Plane №321).
  async getOpsStatusesFor(employeeId: number): Promise<OpsEmployeeStatusRow[]> {
    return this.getAllOpsStatuses(`employee_id=${employeeId}`);
  }

  /** Все строки списка статусов раздела.
   *
   *  Одной страницы «побольше» недостаточно: потолок `limit` у пагинации
   *  раздела 1000, а строк на дату бывает и больше — обрезанный ответ
   *  выглядел бы как «столько и есть».
   *
   *  🔴 СТРАНИЦЫ БЕРУТСЯ ПАРАЛЛЕЛЬНО, а не цепочкой по `next` (Plane №343).
   *  Здесь стоял `while (path !== null)` с `await` внутри: каждая страница
   *  ждала предыдущую, и экран статусов платил столько задержек сети, сколько
   *  у него страниц. Замерено на стенде: 1162 строки — это три страницы по
   *  500, то есть три задержки подряд там, где хватает одной.
   *
   *  Так можно, потому что пагинация раздела — `LimitOffsetPagination`: она
   *  отдаёт `count` в ПЕРВОМ же ответе, и адреса остальных страниц считаются
   *  из него арифметикой, а не вычитываются из `next`. Первая страница
   *  по-прежнему берётся отдельно — до неё число строк неизвестно.
   *
   *  ЧЕГО ЭТО НЕ УХУДШАЕТ. Если между запросами строку добавили или сняли,
   *  сдвиг `offset` даст дубль или пропуск — но ровно то же самое делал и
   *  обход по `next`, и он делал это ДОЛЬШЕ, то есть с большим окном для
   *  сдвига. Порядок страниц сохраняется: части склеиваются по возрастанию
   *  `offset`, а не по тому, кто первым ответил. */
  private async getAllOpsStatuses(query: string): Promise<OpsEmployeeStatusRow[]> {
    const LIMIT = 500;
    const pageAt = (offset: number) =>
      this.getDomainJson<{ results: OpsEmployeeStatusRow[]; count: number }>(
        `/api/operations/statuses/?${query}&limit=${LIMIT}&offset=${offset}`
      );

    const first = await pageAt(0);
    if (first.results.length >= first.count) return first.results;

    const offsets: number[] = [];
    for (let o = LIMIT; o < first.count; o += LIMIT) offsets.push(o);
    const rest = await Promise.all(offsets.map((o) => pageAt(o)));

    return [first, ...rest].flatMap((page) => page.results);
  }

  // Статусы РАЗДЕЛА на деловую дату — тот же адрес, но разрез другой: не «чья
  // служба», а «кто сегодня в каком состоянии». Дата серверная (business_date):
  // «сегодня», посчитанное в браузере, в минусовых зонах спрашивало бы вчера.
  //
  // `period__contains` на сервере означает, что запрошенный день попадает
  // ВНУТРЬ интервала статуса — вчерашний отпуск, кончившийся вчера, сюда не
  // приедет.
  async getOpsStatusesOn(params: {
    businessDate?: string;
    statusTypeCode?: string;
    divisionId?: number;
  }): Promise<OpsEmployeeStatusRow[]> {
    const query = new URLSearchParams();
    if (params.businessDate) query.append("business_date", params.businessDate);
    if (params.statusTypeCode)
      query.append("status_type_code", params.statusTypeCode);
    if (params.divisionId !== undefined)
      query.append("division_id", String(params.divisionId));
    // `limit`, а не `page_size` — см. `getOpsStatusesFor`: `page_size`
    // пагинация раздела игнорирует, и экран получал 50 строк из тысячи.
    return this.getAllOpsStatuses(query.toString());
  }

  // Справочник типов статусов: он несёт КОЛОНКУ РАСХОДА у каждого кода
  // (`report_column_code`), и без неё «в строю» не отличить от отсутствия —
  // своя копия этой таблицы на фронте разошлась бы со справочником при первой
  // же правке в админке.
  async getOpsStatusTypes(): Promise<OpsStatusType[]> {
    const page = await this.getDomainJson<{ results: OpsStatusType[] }>(
      "/api/operations/status-types/?page_size=200"
    );
    return page.results;
  }

  // «Кто я» — кадровая запись самого вызывающего. Самообслуживание: права
  // раздела ручка не спрашивает, связь `User → Employee` резолвит сервер.
  async getMyEmployee(): Promise<MyEmployeeResponse> {
    return this.getDomainJson<MyEmployeeResponse>(
      "/api/operations/my-employee/"
    );
  }

  // Лента журнала для дашборда: последние N записей, свежие первыми (порядок
  // задаёт сервер). Право `audit.view` — не у каждой роли, отказ прилетает
  // тем же конвертом {error_code, message}, что и у остальных ручек раздела.
  async getRecentAuditLogs(limit: number = 4): Promise<OpsAuditLogEntry[]> {
    const page = await this.getDomainJson<{ results: OpsAuditLogEntry[] }>(
      `/api/operations/audit-logs/?limit=${limit}`
    );
    return page.results;
  }

  // Справочники ядра. Именно ядра, а не `/api/dictionaries/`: карточка
  // ссылается на звание и должность КОДОМ (`RANK-1`, `POS-4`), а у должностей
  // в справочнике кода нет вовсе — сопоставить было бы нечем.
  async getCoreRanks(): Promise<CoreRank[]> {
    const page = await this.getDomainJson<{ results: CoreRank[] }>(
      "/api/core/ranks/?page_size=200"
    );
    return page.results;
  }

  async getCorePositions(): Promise<CorePosition[]> {
    const page = await this.getDomainJson<{ results: CorePosition[] }>(
      "/api/core/positions/?page_size=200"
    );
    return page.results;
  }

  async getCoreDivisions(): Promise<CoreDivision[]> {
    const page = await this.getDomainJson<{ results: CoreDivision[] }>(
      "/api/core/divisions/?page_size=200"
    );
    return page.results;
  }

  // Расход за ПЕРИОД: страница на дату. Отдельный маршрут, а не цикл запросов
  // по дням — ряд собирает сервер, и день из середины периода не может
  // разойтись с остальными из-за гонки отдельных ответов.
  async getStrengthReportPeriod(params: {
    dateFrom: string;
    dateTo: string;
    divisionId?: number;
  }): Promise<StrengthReportPeriod> {
    const query = new URLSearchParams();
    query.append("date_from", params.dateFrom);
    query.append("date_to", params.dateTo);
    if (params.divisionId !== undefined) {
      query.append("division_id", String(params.divisionId));
    }
    return this.getDomainJson<StrengthReportPeriod>(
      `/api/operations/strength-report/period/?${query.toString()}`
    );
  }

  // Светофор сдачи дня — дерево подразделений со статусом и признаком
  // опоздания. Владелец витрины сдачи: своего счёта «сдали / не сдали» на
  // других экранах быть не должно, иначе две витрины разойдутся.
  async getTrafficLightTree(params: { businessDate?: string } = {}): Promise<TrafficLightTree> {
    const query = new URLSearchParams();
    if (params.businessDate) query.append("business_date", params.businessDate);
    const queryString = query.toString();
    return this.getDomainJson<TrafficLightTree>(
      `/api/operations/traffic-light/tree/${queryString ? `?${queryString}` : ""}`
    );
  }

  // Личная лента уведомлений раздела: своё и только своё — фильтр по
  // получателю накладывает сервер безусловно, параметра «чья лента» нет и
  // быть не может. Гейт ручки — аутентификация, а не код права: вопрос здесь
  // не «кому можно читать», а «чьи».
  async getOpsNotifications(
    params: { unread?: boolean } = {}
  ): Promise<OpsNotificationPage> {
    const query = new URLSearchParams();
    if (params.unread) query.append("unread", "true");
    const queryString = query.toString();
    return this.getDomainJson<OpsNotificationPage>(
      `/api/operations/notifications/${queryString ? `?${queryString}` : ""}`
    );
  }

  /** Отметить ОДНО уведомление раздела прочитанным (Plane №402). Идемпотентно
   *  на сервере — повторный вызов не двигает момент прочтения. */
  async markOpsNotificationRead(id: number): Promise<OpsNotification> {
    return this.postDomainJson<OpsNotification>(
      `/api/operations/notifications/${id}/read/`,
      {}
    );
  }

  /** Отметить прочитанными ВСЕ свои уведомления раздела. */
  /** Отметить прочитанными свои уведомления раздела ОМ.
   *
   *  `until` — ВЕРХНЯЯ ГРАНИЦА по времени появления, включительно (Plane
   *  №566). Сервер её принимает и объясняет зачем: «клиент отмечает то, что
   *  ВИДЕЛ, а прилетевшее между открытием ленты и нажатием иначе оказалось бы
   *  прочитанным, не будучи показанным». Клиент её не слал вовсе, и граница
   *  существовала только в докстринге сервера. */
  async markAllOpsNotificationsRead(until?: string): Promise<{ marked: number }> {
    return this.postDomainJson<{ marked: number }>(
      `/api/operations/notifications/read-all/`,
      until === undefined ? {} : { until }
    );
  }

  // Точечный светофор одного подразделения — с поимённым расхождением.
  // Дерево выше расхождение НЕ несёт (свод отвечает «куда смотреть»);
  // подробности «кого проверять» берутся этой ручкой по клику.
  async getDivisionTrafficLight(divisionId: number): Promise<DivisionTrafficLight> {
    return this.getDomainJson<DivisionTrafficLight>(
      `/api/operations/traffic-light/${divisionId}/`
    );
  }

  // Выгрузка расхода СДАННОГО дня файлом.
  //
  // Здесь `divisionId` обязателен — в отличие от чтения выше: бэк требует его
  // явно и на пустой параметр отвечает 400 (проверено живой пробой).
  //
  // Параметр формата зовётся `file_format`, а НЕ `format`: имя `format` DRF
  // резервирует под выбор рендерера ответа, и `?format=xlsx` ушло бы в
  // согласование содержимого, отвечая 404 ещё до вьюхи.
  async downloadStrengthReportExport(params: {
    divisionId: number;
    businessDate?: string;
    fileFormat?: "csv" | "xlsx" | "docx";
  }): Promise<Blob> {
    const query = new URLSearchParams();
    query.append("division_id", String(params.divisionId));
    if (params.businessDate) query.append("business_date", params.businessDate);
    query.append("file_format", params.fileFormat ?? "xlsx");

    const endpoint = `/api/operations/strength-report/export/?${query.toString()}`;
    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;
    const token = await getAccessToken();

    const headers: HeadersInit = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) {
      throw await toDomainError(response);
    }
    return response.blob();
  }

  // Метод для получения уведомлений
  async getNotifications(): Promise<
    ApiResponse<
      Array<{
        id: number;
        title: string;
        message: string;
        read: boolean;
        created_at: string;
      }>
    >
  > {
    return this.request<
      Array<{
        id: number;
        title: string;
        message: string;
        read: boolean;
        created_at: string;
      }>
    >("/api/notifications/");
  }
}

// Функция для преобразования данных из StaffUnit в OrgUnit
export function convertStaffUnitToOrgUnit(staffUnit: StaffUnit): OrgUnit {
  // Находим руководителя (обычно это сотрудник с наименьшим level позиции или с определенными должностями)
  const headEmployee =
    staffUnit.employees.find(
      (emp) =>
        emp.position.level <= 7 ||
        emp.position.name.toUpperCase().includes("НАЧАЛЬНИК") ||
        emp.position.name.toUpperCase().includes("ЗАМЕСТИТЕЛЬ")
    ) || staffUnit.employees[0];

  // Определяем тип на основе уровня позиции руководителя
  let type: "leadership" | "department" | "directorate" | "section" = "section";
  if (headEmployee) {
    const level = headEmployee.position.level;
    if (level === 1) {
      type = "leadership";
    } else if (level <= 3) {
      type = "department";
    } else if (level <= 7) {
      type = "directorate";
    }
  }

  // Определяем цвет на основе типа
  const colors = {
    leadership:
      "bg-gradient-to-br from-blue-100 via-blue-150 to-blue-200 border-blue-300",
    department:
      "bg-gradient-to-br from-green-100 via-green-150 to-green-200 border-green-300",
    directorate:
      "bg-gradient-to-br from-green-50 via-green-100 to-green-150 border-green-200",
    section:
      "bg-gradient-to-br from-green-25 via-green-50 to-green-75 border-green-100",
  };

  // Создаем объект Employee для руководителя
  const head: Employee = headEmployee
    ? {
        id: headEmployee.employee?.id?.toString() || staffUnit.id.toString(),
        name: headEmployee.employee
          ? `${headEmployee.employee.first_name} ${headEmployee.employee.last_name}`
          : "Вакантная должность",
        position: headEmployee.position.name,
        // Без фолбэка на «в строю»: `headEmployee` бывает ВАКАНСИЕЙ (имя
        // тогда «Вакантная должность»), и приписывать ей действующий статус
        // значит показывать человека там, где его нет.
        status: headEmployee.employee?.current_status?.status_type,
        statusState: headEmployee.employee?.current_status?.state,
        statusStartDate: headEmployee.employee?.current_status?.start_date,
        statusEndDate:
          headEmployee.employee?.current_status?.end_date || undefined,
        avatar: (() => {
          const photoUrl = headEmployee.employee?.photo_url;
          const photo = headEmployee.employee?.photo;

          // Если есть photo_url и это не null/пустая строка, используем его
          if (photoUrl && photoUrl !== "null" && photoUrl.trim() !== "") {
            return photoUrl;
          }

          // Если есть photo и это не null/пустая строка, добавляем MEDIA_URL
          if (photo && photo !== "null" && photo.trim() !== "") {
            const mediaUrl = process.env.NEXT_PUBLIC_MEDIA_URL || "";
            // Если photo уже начинается с http, используем как есть
            if (photo.startsWith("http://") || photo.startsWith("https://")) {
              return photo;
            }
            // Иначе добавляем MEDIA_URL
            return mediaUrl ? `${mediaUrl}${photo}` : photo;
          }

          // Иначе используем заглушку
          return "/placeholder.svg";
        })(),
      }
    : {
        id: staffUnit.id.toString(),
        name: "Вакантная должность",
        position: "Должность не указана",
        // У вакансии статуса нет и быть не может: здесь стояло «в строю»
        // литералом, и пустая должность светилась в оргструктуре зелёной
        // точкой наравне с работающим человеком.
        avatar: "/placeholder.svg",
      };

  // Остальные строки подразделения, кроме руководителя.
  //
  // 🔴 Вакантные строки (`employee === null`) ОСТАЮТСЯ в списке. Пока узлом
  // дерева была одна штатная единица, вакансия оказывалась «руководителем»
  // своей карточки и была видна; после склейки строк по подразделению она
  // попала бы под этот фильтр и пропала с экрана вовсе — а «Подразделения»
  // ровно про занятые ставки И вакансии. Статуса у вакансии нет: точка
  // остаётся серой, подпись — «Вакантная должность».
  const otherEmployees = staffUnit.employees
    .filter((emp) => emp !== headEmployee)
    .map((emp) => {
      if (!emp.employee) {
        return {
          id: `vacant-${staffUnit.id}-${emp.position.id}-${emp.position.name}`,
          name: "Вакантная должность",
          position: emp.position.name,
          avatar: "/placeholder.svg",
        };
      }
      return {
      id: emp.employee!.id.toString(),
      name: `${emp.employee!.first_name} ${emp.employee!.last_name}`,
      position: emp.position.name,
      status: emp.employee!.current_status?.status_type,
      statusState: emp.employee!.current_status?.state,
      statusStartDate: emp.employee!.current_status?.start_date,
      statusEndDate: emp.employee!.current_status?.end_date || undefined,
      avatar: (() => {
        const photoUrl = (emp.employee as any)?.photo_url;
        const photo = emp.employee!.photo;

        // Если есть photo_url и это не null/пустая строка, используем его
        if (photoUrl && photoUrl !== "null" && photoUrl.trim() !== "") {
          return photoUrl;
        }

        // Если есть photo и это не null/пустая строка, добавляем MEDIA_URL
        if (photo && photo !== "null" && photo.trim() !== "") {
          const mediaUrl = process.env.NEXT_PUBLIC_MEDIA_URL || "";
          // Если photo уже начинается с http, используем как есть
          if (photo.startsWith("http://") || photo.startsWith("https://")) {
            return photo;
          }
          // Иначе добавляем MEDIA_URL
          return mediaUrl ? `${mediaUrl}${photo}` : photo;
        }

        // Иначе используем заглушку
        return "/placeholder.svg";
      })(),
      };
    });

  // Преобразуем детей (если они есть)
  const children: OrgUnit[] = (staffUnit.children || []).map(
    convertStaffUnitToOrgUnit
  );

  return {
    id: staffUnit.id.toString(),
    name: staffUnit.division.name,
    head,
    employees: otherEmployees,
    color: colors[type],
    type,
    children: children.length > 0 ? children : undefined,
  };
}

// Функция для преобразования ответа API в OrgUnit
// API возвращает массив, нужно построить дерево на основе parent_id
/**
 * Схлопнуть штатные единицы ОДНОГО подразделения в один узел дерева.
 *
 * 🔴 Дерево строилось по штатным единицам, а КАЖДЫЙ узел подписывался именем
 * своего подразделения. Отдел из пяти ставок рисовался пятью карточками с
 * ОДНИМ И ТЕМ ЖЕ заголовком «Отдел пропускного режима», в каждой по одному
 * человеку: экран показывал пять отделов вместо одного отдела с пятью людьми.
 *
 * Узел дерева — это ПОДРАЗДЕЛЕНИЕ, а штатная единица — строка внутри него.
 * Поэтому строки группируются по `division.id`, их `employees` складываются, а
 * родителем группы становится ближайшее по цепочке `parent_id` подразделение,
 * ОТЛИЧНОЕ от своего (иначе отдел оказался бы сам себе родителем).
 */
export function mergeStaffUnitsByDivision(staffUnits: StaffUnit[]): StaffUnit[] {
  const byId = new Map(staffUnits.map((unit) => [unit.id, unit]));

  // Представитель подразделения — строка с минимальным id: у неё же берутся
  // id узла и порядок сортировки, поэтому выбор обязан быть устойчивым.
  const representative = new Map<number, StaffUnit>();
  for (const unit of staffUnits) {
    const current = representative.get(unit.division.id);
    if (current === undefined || unit.id < current.id) {
      representative.set(unit.division.id, unit);
    }
  }

  /** Ближайший вверх по цепочке предок ДРУГОГО подразделения. */
  const parentDivisionId = (unit: StaffUnit): number | null => {
    const seen = new Set<number>([unit.id]);
    let parent = unit.parent_id === null ? undefined : byId.get(unit.parent_id);
    while (parent !== undefined && !seen.has(parent.id)) {
      if (parent.division.id !== unit.division.id) return parent.division.id;
      seen.add(parent.id);
      parent = parent.parent_id === null ? undefined : byId.get(parent.parent_id);
    }
    return null;
  };

  const merged: StaffUnit[] = [];
  for (const [divisionId, head] of representative) {
    const rows = staffUnits.filter((unit) => unit.division.id === divisionId);
    const parentId = (() => {
      for (const row of rows) {
        const found = parentDivisionId(row);
        if (found !== null) return representative.get(found)?.id ?? null;
      }
      return null;
    })();

    merged.push({
      ...head,
      parent_id: parentId,
      employees: rows.flatMap((row) => row.employees ?? []),
    });
  }

  return merged;
}

export function convertStaffUnitsResponseToOrgUnit(
  rawStaffUnits: StaffUnit[]
): OrgUnit | null {
  if (!rawStaffUnits || rawStaffUnits.length === 0) {
    return null;
  }

  const staffUnits = mergeStaffUnitsByDivision(rawStaffUnits);

  // Создаем Set всех существующих ID для быстрой проверки
  const existingIds = new Set(staffUnits.map((unit) => unit.id));

  // Рекурсивная функция для построения дерева
  const buildTree = (parentId: number | null): StaffUnit[] => {
    return staffUnits
      .filter((unit) => unit.parent_id === parentId)
      .map((unit) => {
        // Рекурсивно находим детей для каждого элемента
        const children = buildTree(unit.id);
        return {
          ...unit,
          children: children.length > 0 ? children : undefined,
        };
      });
  };

  // Находим корневые элементы:
  // 1. Элементы с parent_id === null
  // 2. Элементы, у которых parent_id не существует в данных (сироты)
  const rootUnits = staffUnits.filter(
    (unit) =>
      unit.parent_id === null ||
      (unit.parent_id !== null && !existingIds.has(unit.parent_id))
  );

  if (rootUnits.length === 0) {
    // Если нет явных корней, берем элемент с минимальным ID
    const minIdUnit = staffUnits.reduce((min, unit) =>
      unit.id < min.id ? unit : min
    );
    const rootWithChildren: StaffUnit = {
      ...minIdUnit,
      children: buildTree(minIdUnit.id),
    };
    return convertStaffUnitToOrgUnit(rootWithChildren);
  }

  // Если есть несколько корневых элементов, создаем виртуальный корень
  if (rootUnits.length > 1) {
    // Находим элемент с минимальным ID среди корневых
    const mainRoot = rootUnits.reduce((min, unit) =>
      unit.id < min.id ? unit : min
    );

    // Строим дерево для главного корня, включая другие корни как его детей
    const otherRoots = rootUnits.filter((unit) => unit.id !== mainRoot.id);
    const mainRootChildren = buildTree(mainRoot.id);

    // Добавляем другие корни как детей главного корня
    const allChildren = [
      ...mainRootChildren,
      ...otherRoots.map((root) => ({
        ...root,
        children: buildTree(root.id),
      })),
    ];

    const rootWithChildren: StaffUnit = {
      ...mainRoot,
      children: allChildren.length > 0 ? allChildren : undefined,
    };

    return convertStaffUnitToOrgUnit(rootWithChildren);
  }

  // Если корневой элемент один, строим дерево для него
  const rootUnit = rootUnits[0];
  const rootWithChildren: StaffUnit = {
    ...rootUnit,
    children: buildTree(rootUnit.id),
  };

  return convertStaffUnitToOrgUnit(rootWithChildren);
}

// Создаем экземпляр API клиента
export const apiClient = new ApiClient();

// Экспортируем также класс для создания других экземпляров
export { ApiClient };

// Экспортируем функцию для использования в компонентах
export { getAccessToken };
