// Справочники: generic-реестр «справочник → значения». Не дублирует уже
// существующих владельцев данных (виды дежурств — свой реестр, кадровые
// должности/звания — бэкенд хоста). Удаление значения, используемого
// связанными сущностями, запрещено — связи считает сервер поимённо.
export type DictionaryCode =
  | "RETURN_REASONS"
  | "POST_REQUIREMENTS"
  | "SEASONAL_CORRECTIONS"
  | "JOURNAL_ENTRY_TYPES"
  | "POST_REQUIREMENT_GROUPS";

export interface DictionaryDefinition {
  code: DictionaryCode;
  label: string;
  description: string;
}

export interface DictionaryEntry {
  id: string;
  dictionaryCode: DictionaryCode;
  code: string;
  label: string;
  description: string;
  isActive: boolean;
  /** Только для POST_REQUIREMENTS — код записи POST_REQUIREMENT_GROUPS. */
  groupCode: string | null;
  updatedAt: string;
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

export interface DictionaryDefinitionSummary extends DictionaryDefinition {
  totalCount: number;
  activeCount: number;
}

export interface ListDictionaryDefinitionsResponse {
  results: DictionaryDefinitionSummary[];
}

export interface ListDictionaryEntriesResponse {
  results: DictionaryEntryView[];
}

export interface CreateDictionaryEntryRequest extends Record<string, unknown> {
  code: string;
  label: string;
  description: string;
  groupCode?: string | null;
}

/** Правка значения (Plane №274). Кода здесь НЕТ намеренно: на значение
 * ссылаются по коду, и смена оборвала бы ссылки молча — сервер его не
 * принимает, форма не показывает. */
export interface UpdateDictionaryEntryRequest extends Record<string, unknown> {
  label: string;
  description: string;
  groupCode?: string | null;
}

export interface SetDictionaryEntryActiveRequest
  extends Record<string, unknown> {
  isActive: boolean;
}
