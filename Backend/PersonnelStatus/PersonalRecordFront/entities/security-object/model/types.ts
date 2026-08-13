// Домен «Объекты и паспорта» раздела ОМ. Состояние объекта, состояние
// паспорта и актуальность паспорта — РАЗНЫЕ поля, не один бейдж.
export type ObjectState = "ACTIVE" | "ARCHIVED";

/** Красный/жёлтый/зелёный — состояние ПАСПОРТА, не объекта. */
export type PassportState = "RED" | "YELLOW" | "GREEN";

/**
 * Принадлежность объекта. ЗНАЧЕНИЙ ДВА, хотя вкладок реестра три: «объект
 * ОМ» — не свойство объекта, а факт наличия у него мероприятий, и приходит
 * отдельным производным полем `hasSecurityEvents`. Третьим кодом здесь он
 * стал бы хранимым флагом, который протухает молча.
 */
export type ObjectOwnership = "OWN" | "GUARDED";

/**
 * Политика актуальности паспорта. Интервал — хранимая настройка со своей
 * версией, а не константа в коде: фиксированный frontend-период («паспорт
 * старше 90 дней») запрещён — каждый посчитанный результат несёт версию
 * политики, по которой он посчитан.
 */
export interface PassportFreshnessPolicy {
  version: string;
  verificationIntervalDays: number;
  /** Порог «скоро проверка» — доля интервала в процентах, не своё число дней. */
  dueSoonPercent: number;
}

/**
 * Производное состояние актуальности: пересчитывается на каждом чтении от
 * бизнес-даты, у объекта не хранится. NO_PUBLISHED_VERSION — отдельный исход,
 * а не «просрочен»: ни разу не публиковавшийся паспорт не «устарел».
 */
export type PassportFreshnessState =
  | "FRESH"
  | "DUE_SOON"
  | "OVERDUE"
  | "NO_PUBLISHED_VERSION";

export interface PassportFreshness {
  objectId: string;
  state: PassportFreshnessState;
  /** Дата следующей обязательной проверки; null — публикаций не было. */
  verificationDueAt: string | null;
  freshnessPolicyVersion: string;
}

/** Пост постоянного дежурства на секторе объекта. */
export interface SecurityPost {
  id: string;
  name: string;
  task: string;
  requirements: string;
}

export interface ObjectSector {
  id: string;
  name: string;
  posts: SecurityPost[];
}

/**
 * Опубликованная версия паспорта — неизменяема после публикации; sectors —
 * СНИМОК на момент публикации, дальнейшее редактирование объекта версию
 * не трогает. На одну дату — не более одной опубликованной версии.
 */
export interface PassportVersion {
  id: string;
  versionNumber: number;
  /** Дата, с которой версия действует (YYYY-MM-DD). */
  effectiveFrom: string;
  publishedAt: string;
  /** Идентификатор опубликовавшего (ФИО в demo-модели нет). */
  publishedBy: string;
  note: string;
  sectors: ObjectSector[];
}

export interface SecurityObject {
  id: string;
  name: string;
  code: string;
  type: string;
  region: string;
  address: string;
  objectState: ObjectState;
  passportState: PassportState;
  ownership: ObjectOwnership;
  /** Производное: у объекта есть хотя бы одно охранное мероприятие. Считает
   * сервер аннотацией — у объекта такого поля нет. */
  hasSecurityEvents: boolean;
  /** Действующая редакция (черновик): её и правит форма паспорта. */
  sectors: ObjectSector[];
  /** История публикаций, по возрастанию номера версии. Неизменяема. */
  passportVersions: PassportVersion[];
  createdAt: string;
  updatedAt: string;
}

/** Показатель прототипа, которого модель не выдаёт — приходит с причиной. */
export interface UnavailableMetric {
  code: string;
  label: string;
  reason: string;
}

/** Серверные агрегаты реестра: считаются по ВСЕМУ реестру, не по странице. */
export interface ObjectsRegistryKpi {
  total: number;
  passportGreen: number;
  passportYellow: number;
  passportRed: number;
  /** Срок проверки прошёл (по действующей политике). */
  verificationOverdue: number;
  /** Паспорт ни разу не публиковали. */
  neverPublished: number;
}

/**
 * Ответ списка: агрегаты и актуальность приходят С СЕРВЕРА вместе со списком
 * одним ответом — KPI по другому снимку реестра, чем таблица, хуже
 * отсутствующего.
 */
export interface ListObjectsResponse {
  results: SecurityObject[];
  /** По одной записи на каждую строку results, тот же порядок. */
  freshness: PassportFreshness[];
  kpi: ObjectsRegistryKpi;
  /** Действующая политика — экран показывает, ЧЕМ посчитан срок. */
  freshnessPolicy: PassportFreshnessPolicy;
  unavailableKpi: UnavailableMetric[];
}

export interface UpdatePassportRequest extends Record<string, unknown> {
  sectors: ObjectSector[];
}

/**
 * Публикация версии. Секторы в запросе НЕ передаются: снимок берётся с
 * действующей редакции на сервере — иначе клиент мог бы опубликовать не то,
 * что показывает паспорт.
 */
export interface PublishPassportVersionRequest extends Record<string, unknown> {
  effectiveFrom: string;
  note: string;
}

// Контракты путей бэкенда ОМ (реального бэка нет — статус pending, см. отчёт).
export const OPS_OBJECTS_PATH = "/api/ops/objects/";

export function objectDetailPath(id: string): string {
  return `${OPS_OBJECTS_PATH}${id}/`;
}

export function objectPassportPath(id: string): string {
  return `${OPS_OBJECTS_PATH}${id}/passport/`;
}

export function objectPassportVersionsPath(id: string): string {
  return `${OPS_OBJECTS_PATH}${id}/passport/versions/`;
}
