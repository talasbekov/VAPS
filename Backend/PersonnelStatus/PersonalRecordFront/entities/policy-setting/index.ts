// Настройки (role-restricted administration). Администрируется только то,
// под чем есть живой потребитель в этом срезе: правила конфликтов читает
// планирование дежурств, свежесть паспорта — реестр объектов. Разделы
// версионируются порознь — у каждого свой потребитель, общая версия
// означала бы, что правка порога наблюдений меняет методику конфликтов.

/** Единица измерения значения — чтобы экран не подписывал «3» без смысла. */
export type SettingValueType = "DAYS" | "PERCENT" | "COUNT" | "HOURS" | "MINUTES" | "MODE";

export type SettingSectionCode =
  | "CONFLICT_RULES"
  | "PASSPORT_FRESHNESS"
  | "RATING_POLICY";

export const SECTION_LABEL: Record<SettingSectionCode, string> = {
  CONFLICT_RULES: "Правила конфликтов дежурств",
  PASSPORT_FRESHNESS: "Актуальность паспортов объектов",
  RATING_POLICY: "Методика оперативного рейтинга",
};

/** Вариант значения-перечисления. description — следствие для планирующего,
 * а не синоним кода. */
export interface SettingOption {
  value: string;
  safeLabel: string;
  description: string;
}

interface StoredSettingBase {
  settingCode: string;
  sectionCode: SettingSectionCode;
  safeLabel: string;
  /** Что именно меняется — своими словами, не пересказ имени поля. */
  description: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Редактируемость — свойство САМОГО правила: жёсткий запрет пересечения
   * нельзя ослабить никому. Правило показано, чтобы список был полон. */
  editable: boolean;
  lockedReason: string | null;
}

export interface NumericSetting extends StoredSettingBase {
  kind: "NUMBER";
  valueType: Exclude<SettingValueType, "MODE">;
  value: number;
  /** Границы приходят с сервера вместе со значением — диапазон часть политики. */
  minValue: number;
  maxValue: number;
}

export interface ChoiceSetting extends StoredSettingBase {
  kind: "CHOICE";
  valueType: "MODE";
  value: string;
  options: readonly SettingOption[];
}

export type StoredSetting = NumericSetting | ChoiceSetting;

/** Разрешение на правку конкретной записи — посчитано сервером: причина
 * отказа у запертого правила и у нехватки права разная. */
export interface SettingAction {
  canEdit: boolean;
  disabledReason: string | null;
}

export type PolicySetting = StoredSetting & { action: SettingAction };

/** Запись журнала изменений: old/new — готовые подписи (форматирует владелец
 * вариантов — сервер), версия политики ПОСЛЕ изменения. */
export interface SettingChangeEvent {
  id: string;
  settingCode: string;
  sectionCode: SettingSectionCode;
  safeLabel: string;
  oldValue: string;
  newValue: string;
  reason: string;
  actorUserId: string;
  changedAt: string;
  policyVersionAfter: string;
}

// ── Чистые правила политики ──────────────────────────────────────────────

/** Версия обязана меняться при каждом принятом изменении — иначе снимок,
 * подписанный прежней версией, врал бы о методике. Растёт последний
 * числовой сегмент формата `<префикс>.<номер>` / `<префикс>-vN`. */
export function nextPolicyVersion(current: string): string {
  const dotMatch = /^(.*\.)(\d+)$/.exec(current);
  if (dotMatch !== null) {
    return `${dotMatch[1]}${Number(dotMatch[2]) + 1}`;
  }
  const vMatch = /^(.*-v)(\d+)$/.exec(current);
  if (vMatch !== null) {
    return `${vMatch[1]}${Number(vMatch[2]) + 1}`;
  }
  return `${current}.2`;
}

/** Ошибки формы (400) по полям. Вариант проверяется по списку, пришедшему
 * с той же записью; число — по серверному диапазону. */
export function validateSettingValue(
  setting: StoredSetting,
  value: unknown
): Record<string, string[]> {
  if (setting.kind === "CHOICE") {
    if (
      typeof value !== "string" ||
      !setting.options.some((option) => option.value === value)
    ) {
      return { value: ["Выберите один из допустимых режимов."] };
    }
    return {};
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { value: ["Укажите числовое значение."] };
  }
  if (!Number.isInteger(value)) {
    return { value: ["Значение задаётся целым числом."] };
  }
  if (value < setting.minValue || value > setting.maxValue) {
    return {
      value: [`Допустимый диапазон — от ${setting.minValue} до ${setting.maxValue}.`],
    };
  }
  return {};
}

/** Подпись значения для журнала — собирает владелец вариантов. */
export function formatSettingValue(
  setting: StoredSetting,
  value: number | string
): string {
  if (setting.kind === "CHOICE") {
    const option = setting.options.find((item) => item.value === value);
    return option?.safeLabel ?? String(value);
  }
  const unit: Record<Exclude<SettingValueType, "MODE">, string> = {
    DAYS: "дн.",
    PERCENT: "%",
    COUNT: "шт.",
    HOURS: "ч",
    MINUTES: "мин",
  };
  return `${value} ${unit[setting.valueType]}`;
}

// ── Контракты ────────────────────────────────────────────────────────────

export const SETTINGS_PATH = "/api/ops/settings/";
/** Журнал в своём префиксе: `settings/change-log/` сматчился бы маршрутом
 * `settings/:settingCode/` и молча ушёл бы в чужой handler. */
export const SETTING_CHANGES_PATH = "/api/ops/setting-changes/";

export function settingPath(settingCode: string): string {
  return `${SETTINGS_PATH}${encodeURIComponent(settingCode)}/`;
}

export interface ListSettingsResponse {
  results: PolicySetting[];
  /** Действующая версия каждого раздела. */
  sectionVersions: Record<SettingSectionCode, string>;
}

export interface ListSettingChangeLogResponse {
  results: SettingChangeEvent[];
}

export interface UpdateSettingRequest extends Record<string, unknown> {
  value: number | string;
  reason: string;
}

export interface UpdateSettingResponse {
  setting: PolicySetting;
  sectionVersions: Record<SettingSectionCode, string>;
  event: SettingChangeEvent;
}
