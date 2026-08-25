// Домен «Сводные данные ГВО» — проекция охранного мероприятия, а не
// самостоятельная запись реестра: сводка существует ровно для тех ОМ, что уже
// заведены в «Реестре ОМ», и появляется в момент создания бюллетеня.
//
// Персистится ТОЛЬКО патч ручных правок (GvoSummaryPatch) — база каждый раз
// выводится из бюллетеня (см. model/derive.ts). Так «Вернуть исходные»
// остаётся операцией над данными, а не восстановлением из копии, и правка
// бюллетеня не расходится со сводкой в тех полях, которых руками не касались.

/** Литерал незаполненного поля. Пустых значений в сводке не бывает вовсе. */
export const UNSPECIFIED = "уточняется";

export interface GvoFact {
  key: string;
  value: string;
}

export interface GvoPerson {
  name: string;
  role: string;
  facts: GvoFact[];
}

/** Борт прибытия/убытия. dur — «время в полёте 5:40 часа» целой строкой. */
export interface GvoFlight {
  date: string;
  time: string;
  route: string;
  flight: string;
  dur: string;
}

export interface GvoMember {
  name: string;
  callsign: string;
  role: string;
}

export interface GvoGroup {
  name: string;
  members: GvoMember[];
}

export interface GvoStay {
  place: string;
  room: string;
}

export interface GvoTransportRow {
  code: string;
  car: string;
  note: string;
}

export interface GvoVisitItem {
  obj: string;
  note: string;
}

export interface GvoVisitDay {
  day: string;
  weekday: string;
  items: GvoVisitItem[];
}

export interface GvoSummary {
  country: string;
  persons: GvoPerson[];
  arrival: GvoFlight;
  departure: GvoFlight;
  meet: string[];
  farewell: string[];
  stay: GvoStay;
  delegation: string[];
  sbChief: string;
  weapons: string;
  wishes: string;
  obVariant: string;
  radio: string;
  /** null — ответственный не назначен (не то же, что «уточняется»). */
  responsible: GvoMember | null;
  groups: GvoGroup[];
  transport: GvoTransportRow[];
  visits: GvoVisitDay[];
}

/**
 * Патч ручных правок. Вложенные объекты приходят целиком (сливаются глубоко —
 * см. mergeGvoSummary), остальные ключи заменяют значение базы.
 *
 * `visits` в патч НЕ входит («Реестр ОМ-35.1»): объекты посещения живут
 * таблицей мероприятия, и патч с этим ключом был вторым списком тех же
 * объектов. Сервер такой ключ отбивает — `Omit` не даёт отправить его молча.
 */
export type GvoSummaryPatch = Partial<Omit<GvoSummary, "visits">>;

export interface GvoSummaryPatchRecord {
  omCode: string;
  patch: GvoSummaryPatch;
  updatedAt: string;
}

// ── Разделы правки ───────────────────────────────────────────────────────

/**
 * Раздел модального окна. `person:<i>` / `group:<i>` правят один элемент
 * списка, `person:new` / `group:new` добавляют; остальные — секции целиком.
 *
 * «Объекты посещения» разделом НЕ являются («Реестр ОМ-35.1»): они живут
 * таблицей мероприятия и правятся своим окном, а не патчем сводки.
 */
export type GvoSection =
  | "head"
  | "persons"
  | "arrival"
  | "departure"
  | "org"
  | "resp"
  | "groups"
  | "transport"
  | `person:${number}`
  | "person:new"
  | `group:${number}`
  | "group:new";

// ── Контракты API (реального бэка нет — см. lib/api-gaps.ts) ─────────────

export const GVO_SUMMARIES_PATH = "/api/ops/gvo-summaries/";

export function gvoSummaryPatchPath(omCode: string): string {
  return `${GVO_SUMMARIES_PATH}${encodeURIComponent(omCode)}/`;
}

export function gvoSummaryResetPath(omCode: string): string {
  return `${gvoSummaryPatchPath(omCode)}reset/`;
}

export interface ListGvoSummaryPatchesResponse {
  results: GvoSummaryPatchRecord[];
}

export interface UpdateGvoSummaryRequest extends Record<string, unknown> {
  section: GvoSection;
  /** Разобранные значения формы — разбор текста живёт на клиенте. */
  values: GvoSummaryPatch;
}

export interface ResetGvoSummaryRequest extends Record<string, unknown> {
  section: GvoSection;
}
