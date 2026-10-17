// Справочники: generic-реестр «справочник → значения». Не дублирует уже
// существующих владельцев данных (виды дежурств — свой реестр, кадровые
// должности/звания — бэкенд хоста). Удаление значения, используемого
// связанными сущностями, запрещено — связи считает сервер поимённо.
/**
 * Коды справочников раздела ОМ — ЗАКРЫТЫЙ мир, растущий вместе с сервером
 * (`ops/dictionaries.py: DEFINITIONS`). Список отставал от сервера на роли
 * наряда (Plane №237); догнан вместе с №274.
 */
export type DictionaryCode =
  | "RETURN_REASONS"
  | "POST_REQUIREMENTS"
  | "SEASONAL_CORRECTIONS"
  | "JOURNAL_ENTRY_TYPES"
  | "POST_REQUIREMENT_GROUPS"
  | "PLACEMENT_ROLES"
  | "EVENT_PARTICIPATION_KINDS"
  | "EVENT_GROUP_ROLES"
  | "SERVICE_DUTY_KINDS";

export interface DictionaryDefinition {
  /** Код generic-справочника ЛИБО внешнего (`STATUS_TYPES`, Plane №344):
   *  реестр перечисляет и те, и другие, а закрытый `DictionaryCode` описывает
   *  только те, чьи значения обслуживает generic-ручка. */
  code: DictionaryCode | string;
  label: string;
  description: string;
}

export interface DictionaryEntryRef {
  id: string;
  code: string;
}

export type DictionaryChange = { operation: string; at: string; actor: string };

export interface DictionaryEntry {
  id: string;
  dictionaryCode: DictionaryCode;
  code: string;
  label: string;
  /** Казахское наименование (UC-REF-001); пустая строка — перевода нет. */
  labelKk: string;
  description: string;
  isActive: boolean;
  /** Только для POST_REQUIREMENTS — код записи POST_REQUIREMENT_GROUPS. */
  groupCode: string | null;
  /** Подразделение-владелец специальной группы участия (Plane №1100). */
  ownerDivisionId?: string | null;
  ownerDivisionName?: string | null;
  ownerDivisionPath?: string | null;
  /** Входит ли владелец группы в область status.manage текущего пользователя. */
  isOwn?: boolean;
  updatedAt: string;
  lastChange?: DictionaryChange | null;
  replacementFamily?: { rootId: string; currentId: string; memberIds: string[]; totalCount: number };
  /** Дата неактуальности (UC-REF-001): ставится при деактивации. */
  inactiveSince: string | null;
  /** Прежняя запись, которую эта заменила. */
  supersedes: DictionaryEntryRef | null;
  /** Преемник; у записи с преемником активировать и удалять нечего. */
  supersededBy: DictionaryEntryRef | null;
}

/**
 * Отслеживаемость связей значения:
 * TRACKED — потребитель хранит КОД значения, связи пересчитаны сервером;
 * NOT_TRACKED — потребитель хранит свободный текст: ноль был бы утверждением
 * «удалять безопасно», вместо числа отдаётся причина;
 * UNKNOWN — источник связей недоступен («посчитать не удалось» ≠ «связей нет»).
 */
export type DictionaryUsageStatus = "TRACKED" | "NOT_TRACKED" | "UNKNOWN";

export interface DictionaryUsageReference {
  sourceLabel: string;
  count: number;
  /** Носители ссылки — до трёх, чтобы зависимость была понятной, а не числом. */
  samples: string[];
}

export interface DictionaryUsage {
  status: DictionaryUsageStatus;
  reason: string | null;
  references: DictionaryUsageReference[];
  totalCount: number;
}

export interface DictionaryEntryView extends DictionaryEntry {
  usage: DictionaryUsage;
}

// ── Контракты ────────────────────────────────────────────────────────────

export const DICTIONARIES_PATH = "/api/ops/dictionaries/";

export function dictionaryEntriesPath(code: string): string {
  return `${DICTIONARIES_PATH}${code}/entries/`;
}
export function dictionaryEntrySetActivePath(id: string): string {
  return `${DICTIONARIES_PATH}entries/${id}/set-active/`;
}
/** Удаление — свой путь: правило строже деактивации (необратимо, требует
 * доказанного отсутствия связей). */
export function dictionaryEntryPath(id: string): string {
  return `${DICTIONARIES_PATH}entries/${id}/`;
}
/** Замена преемником (UC-REF-001, «Редактирование»). */
export function dictionaryEntrySupersedePath(id: string): string {
  return `${DICTIONARIES_PATH}entries/${id}/supersede/`;
}

export interface DictionaryDefinitionSummary extends DictionaryDefinition {
  totalCount: number;
  activeCount: number;
  /**
   * Экран значений, если справочник живёт СВОЕЙ таблицей (Plane №344).
   * `null` — обычный generic-справочник, его значения открываются по коду.
   * Строка — часть адреса: `/security-ops/dictionaries/<screen>`.
   *
   * Поле нужно затем, чтобы реестр не строил адрес по соглашению «код =
   * маршрут»: у типов статусов generic-адреса нет вовсе, и ссылка по коду
   * привела бы на ручку, которая этот справочник не обслуживает.
   */
  screen: string | null;
  /** Правится сидом, а не экраном: кнопок правки на таком экране нет. */
  readOnly: boolean;
}

export interface ListDictionaryDefinitionsResponse {
  results: DictionaryDefinitionSummary[];
}

export interface ListDictionaryEntriesResponse {
  results: DictionaryEntryView[];
}

export interface CreateDictionaryEntryRequest extends Record<string, unknown> {
  confirmSimilar?: boolean;
  code: string;
  label: string;
  labelKk?: string;
  description: string;
  groupCode?: string | null;
  ownerDivisionId?: string | null;
}

/** Правка значения (Plane №274). Кода здесь НЕТ намеренно: на значение
 * ссылаются по коду, и смена оборвала бы ссылки молча — сервер его не
 * принимает, форма не показывает. */
export interface UpdateDictionaryEntryRequest extends Record<string, unknown> {
  label: string;
  labelKk?: string;
  description: string;
  groupCode?: string | null;
  ownerDivisionId?: string | null;
}

export interface SetDictionaryEntryActiveRequest
  extends Record<string, unknown> {
  isActive: boolean;
}

export type SupersedeDictionaryEntryRequest = CreateDictionaryEntryRequest;

/** Ответ DELETE: 204 — удалено; 200 с телом — деактивировано по связям. */
export type RemoveDictionaryEntryResult =
  | { result: "deleted" }
  | { result: "deactivated"; entry: DictionaryEntryView };
