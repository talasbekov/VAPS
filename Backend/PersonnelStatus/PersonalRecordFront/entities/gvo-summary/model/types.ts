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
  /** Ссылки на справочник сотрудников (`[ГВО-08]`, Plane №435): встречающие,
   * провожающие, состав делегации — идентификаторами; подписи считает сервер. */
  meetEmployeeIds?: string[];
  farewellEmployeeIds?: string[];
  delegationEmployeeIds?: string[];
  meetRefs?: { id: string; name: string }[];
  farewellRefs?: { id: string; name: string }[];
  delegationRefs?: { id: string; name: string }[];
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
  /** Флаги «уточняется» — ПУТЯМИ полей в сводке (Plane №686/№687). Хранит их
   * мок; на сервере это `visit.unspecified`. */
  unspecified?: string[];
  /** Отметка утверждения визита (`[ГВО-07]`); null — не утверждён. */
  approvedAt?: string | null;
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

/**
 * СОБРАННАЯ сводка мероприятия — то, что показывает экран. Приходит с сервера
 * целиком (Plane №166): раньше базу выводил браузер, а сервер хранил только
 * патч, и две сборки успели разойтись на форме даты.
 *
 * `filled` — «Заполнена» против «Черновика»: есть ли по мероприятию хоть одна
 * ручная правка. Клиент это больше не вычисляет: признак приходит оттуда же,
 * откуда сводка.
 */
/** Визит иностранного ОЛ — сущность со статусом (Plane №435, `[МД-05]`);
 * null — у внутреннего ОМ визита нет. */
export interface GvoVisit {
  status: "DRAFT" | "READY" | "APPROVED";
  version: number;
  protectedPersonId: string | null;
  /** Поля, у которых «данных нет от принимающей стороны» (`[ГВО-06]`). */
  unspecified: string[];
  approvedAt: string | null;
}

export interface GvoSummaryRow {
  omCode: string;
  summary: GvoSummary;
  filled: boolean;
  /** null — правок не было вовсе, а не «время неизвестно». */
  updatedAt: string | null;
  visit: GvoVisit | null;
  /** Ключи полей с флагом «уточняется» (`[ГВО-06]`). */
  unspecified: string[];
  /** Обязательные поля (`[ГВО-07]`, Plane №436): чего не хватает до
   * «Утвердить» и прогресс «заполнено K из N». Старый сервер полей не несёт. */
  missingRequired?: string[];
  requiredTotal?: number;
  requiredFilled?: number;
}

export interface ListGvoSummariesResponse {
  results: GvoSummaryRow[];
}

/** Собранные сводки ВСЕХ мероприятий — одним запросом, для реестров. */
export const GVO_SUMMARIES_ASSEMBLED_PATH = `${GVO_SUMMARIES_PATH}assembled/`;

/** Собранная сводка ОДНОГО мероприятия. Тот же адрес, что у правки: PATCH
 * кладёт правки, GET отдаёт результат. */
export const gvoSummaryPath = gvoSummaryPatchPath;

export interface UpdateGvoSummaryRequest extends Record<string, unknown> {
  /**
   * Раздел правки; `null` — «несколько разделов разом» (Plane №694).
   *
   * Сервер раздел только ПРОВЕРЯЕТ, а состав тела бьёт по списку разрешённых
   * ключей, поэтому одна правка нескольких разделов уезжает ОДНИМ запросом.
   * Пока раздел был обязателен, форма слала цикл из PATCH по одному на
   * раздел: падение середины оставляло половину сохранённой, а флаги
   * «уточняется», ехавшие с последним вызовом, — нет.
   */
  section: GvoSection | null;
  /** Разобранные значения формы — разбор текста живёт на клиенте. */
  values: GvoSummaryPatch;
  /** Полный список полей с флагом «уточняется» после правки (Plane №435). */
  unspecified?: string[];
}

export interface ResetGvoSummaryRequest extends Record<string, unknown> {
  section: GvoSection;
}
