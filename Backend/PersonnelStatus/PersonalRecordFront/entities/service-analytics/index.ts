// Аналитика службы (§22.3-22.7, §22.9, §22.11-22.15) — нативный порт из
// Smart Josparlau. Ключевое свойство раздела: СЕРВЕР — владелец расчётов.
// Экран не считает ни численность, ни конфликты, ни просрочку и не назначает
// цвет по числу — он печатает `state` и `displayValue` из ответа.
//
// ⚠️ Все расчётные функции ниже исполняются ТОЛЬКО на стороне mock-сервера
// (mocks/ops/analytics-handlers.ts): «итог по видимой части таблицы» стоит в
// §22.3 в одном списке с численностью и просрочкой.

// ── Модель ───────────────────────────────────────────────────────────────

/** Единица измерения — часть КОНТРАКТА: «12» без единицы читается двояко. */
export type MetricUnit = "COUNT" | "PERCENT" | "MINUTES" | "HOURS" | "SCORE" | "TEXT";

/** Состояние считает СЕРВЕР. UNKNOWN — «посчитать не удалось», не ноль и не
 * зелёный: «0 конфликтов» и «конфликты неизвестны» — разные утверждения. */
export type MetricState = "NORMAL" | "WARNING" | "CRITICAL" | "UNKNOWN";

export interface MetricValue {
  metricCode: string;
  safeLabel: string;
  /** null ровно тогда, когда значение неизвестно. */
  value: number | null;
  /** Готовая к печати строка: единица и «нет данных» — семантика, не вёрстка. */
  displayValue: string;
  unit: MetricUnit;
  state: MetricState;
  /** §22.12: существует ли для показателя разрешённая выборка. */
  drilldownAvailable: boolean;
  /** Версия ОПРЕДЕЛЕНИЯ показателя — меняется вместе со смыслом. */
  metricDefinitionVersion: string;
}

/** §22.4 контракт аналитического снимка: период, scope, актуальность и версии
 * расчёта едут вместе с числами — иначе число нельзя перепроверить. */
export interface AnalyticsSnapshot<T> {
  /** Стабильный идентификатор снимка; drill-down обязан принадлежать ему же. */
  snapshotId: string;
  businessDate: string;
  timezone: string;
  period: AnalyticsPeriod;
  scope: AnalyticsScope;
  generatedAt: string;
  sourceUpdatedAt: string | null;
  sourceWatermark: string | null;
  freshnessState: "CURRENT" | "STALE" | "PARTIAL" | "UNKNOWN";
  completenessState: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
  calculationVersion: string;
  policyVersion: string;
  data: T;
}

export interface AnalyticsPeriod {
  from: string;
  to: string;
  /** null у произвольного периода: preset — ИМЕНОВАННЫЙ период. */
  presetCode: string | null;
}

export interface AnalyticsScope {
  scopeType: string;
  scopeId: string;
  safeLabel: string;
}

/** §22.5: пресеты приходят из registry — «последних 7 дней» в коде экрана нет. */
export interface PeriodPreset {
  presetCode: string;
  safeLabel: string;
  /** Смещение начала от бизнес-даты в днях (0 — сама бизнес-дата). */
  offsetDays: number;
  /** Длительность в днях, включая день начала. */
  lengthDays: number;
}

/** Определение показателя. Пороги — В ДАННЫХ; null — порога нет, всегда NORMAL. */
export interface MetricDefinition {
  metricCode: string;
  safeLabel: string;
  unit: MetricUnit;
  warningFrom: number | null;
  criticalFrom: number | null;
  drilldownAvailable: boolean;
}

export interface ServiceAnalyticsData {
  metrics: MetricValue[];
  unavailableMetrics: UnavailableMetric[];
}

export interface UnavailableMetric {
  code: string;
  label: string;
  reason: string;
}

/** §22.12 строка выборки: rowId — стабильный ID сущности (смены). Сотрудник
 * вырезается СЕРВЕРОМ вместе с personalDetailSuppressed (§22.26/§22.30). */
export interface DrilldownRow {
  rowId: string;
  businessDate: string;
  objectLabel: string;
  stateLabel: string;
  employeeLabel: string | null;
}

/** §22.11 элемент «Требует внимания» — КАЖДОЕ поле приходит с сервера, включая
 * текст: собрать элемент из показанных KPI значило бы выдать перестановку
 * чисел экрана за серверное наблюдение. */
export interface AttentionItem {
  attentionId: string;
  categoryCode: string;
  severity: AttentionSeverity;
  /** Одна из РАЗРЕШЁННЫХ §22.11 формулировок — не свободный текст. */
  safeTitle: string;
  safeDescription: string;
  /** null, когда считать нечего: ноль читался бы как «ноль случаев». */
  count: number | null;
  scopeLabel: string | null;
  /** Куда ведёт наблюдение; маршрут ПОВТОРНО проверит право. */
  targetRoute: string | null;
  targetPermission: string | null;
  detectedAt: string;
  policyVersion: string;
}

export type AttentionSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface AttentionData {
  items: AttentionItem[];
  /** Пустой список и неработающий детектор — РАЗНЫЕ утверждения (§35). */
  detectionState: "COMPLETE" | "UNAVAILABLE";
  detectionUnavailableReason: string | null;
  unavailableDetectors: UnavailableMetric[];
}

/** §22.15 иерархия: Все ОМ → объект → ОМ → направление → пост → участие. */
export type OpsLevel = "ALL" | "OBJECT" | "EVENT" | "DIRECTION" | "POST";

export interface OpsBreadcrumbItem {
  level: OpsLevel;
  /** null только у корня «Все ОМ». */
  id: string | null;
  safeLabel: string;
}

/** Набор колонок задаёт СЕРВЕР: §22.15 запрещает смешивать «запрошено»,
 * «выделено», «назначено» и «фактически участвовало». */
export interface OpsColumn {
  code: string;
  safeLabel: string;
}

export interface OpsCell {
  code: string;
  value: number | null;
  unavailableReason: string | null;
}

export interface OpsRow {
  /** Стабильный идентификатор — objectId, id ОМ, id направления, id поста. */
  rowId: string;
  safeLabel: string;
  /** Уровень, на который ведёт строка; null — глубже некуда. */
  childLevel: OpsLevel | null;
  cells: OpsCell[];
}

/** §22.13 распределение — только состояния Lifecycle Registry. */
export interface LifecycleBucket {
  stateCode: string;
  safeLabel: string;
  count: number;
}

export interface OpsFact {
  code: string;
  safeLabel: string;
  displayValue: string;
  unavailableReason: string | null;
}

export interface OpsEventCard {
  eventId: string;
  code: string;
  safeLabel: string;
  facts: OpsFact[];
}

export interface OperationsAnalyticsData {
  level: OpsLevel;
  breadcrumb: OpsBreadcrumbItem[];
  columns: OpsColumn[];
  rows: OpsRow[];
  lifecycleDistribution: LifecycleBucket[];
  /** Коды вне реестра называются ОТДЕЛЬНО, а не растворяются в корзинах. */
  unknownLifecycleCodes: string[];
  eventCard: OpsEventCard | null;
  /** §22.14 воронка по журналу переходов; null — журнала нет. */
  funnel: FunnelView | null;
  funnelUnavailableReason: string | null;
  unavailableMeasures: UnavailableMetric[];
}

/** §22.14: шесть показателей держатся раздельно, экран показывает ОДИН за раз. */
export interface FunnelView {
  measures: { code: string; safeLabel: string; unit: string }[];
  stages: {
    stateCode: string;
    safeLabel: string;
    values: Record<string, number | null>;
  }[];
  excludedEventIds: string[];
  exclusionNote: string;
  transitionCount: number;
}

export interface DrilldownPage {
  metricCode: string;
  rows: DrilldownRow[];
  /** null — страниц больше нет. Курсор непрозрачен для экрана. */
  nextCursor: string | null;
  totalCount: number;
  personalDetailSuppressed: boolean;
  personalDetailReason: string | null;
}

// ── Пути API (pending-контракт). Все пути — СИБЛИНГИ: вложенный путь MSW
// отдал бы первому совпавшему handler'у молча (коллизия путей). ─────────────

export const ANALYTICS_SNAPSHOT_PATH = "/api/ops/service-analytics/";
export const ANALYTICS_PRESETS_PATH = "/api/ops/service-analytics-presets/";
export const ANALYTICS_DRILLDOWN_PATH = "/api/ops/service-analytics-drilldown/";
export const ANALYTICS_ATTENTION_PATH = "/api/ops/service-analytics-attention/";
export const OPERATIONS_ANALYTICS_PATH = "/api/ops/operations-analytics/";
export const LOAD_ANALYTICS_PATH = "/api/ops/load-analytics/";

// ── Контракты ответов ────────────────────────────────────────────────────

export type HeaderBlock = UnavailableMetric;

export interface AnalyticsPresetsResponse {
  results: PeriodPreset[];
  /** null — предела нет в политике, и произвольный период не принимается. */
  maxCustomPeriodDays: number | null;
  limitPolicyVersion: string | null;
  customPeriodUnavailableReason: string | null;
  /** §22.6: пресет по умолчанию решает сервер. */
  defaultPresetCode: string;
}

export type ServiceAnalyticsResponse = AnalyticsSnapshot<ServiceAnalyticsData> & {
  unavailableHeaderBlocks: HeaderBlock[];
  /** §22.26: право на дашборд и право на раскрытие — разные. */
  drilldownAllowed: boolean;
  drilldownDeniedReason: string | null;
};

/** §22.12: экран обязан прислать snapshotId — строки должны принадлежать
 * ТОМУ ЖЕ снимку, что и раскрытый показатель. */
export interface DrilldownQuery {
  snapshotId: string;
  metricCode: string;
  presetCode: string | null;
  from: string;
  to: string;
  cursor: string | null;
}

export type DrilldownResponse = AnalyticsSnapshot<DrilldownPage>;

export interface OperationsQuery {
  level: OpsLevel;
  objectId?: string;
  eventId?: string;
  directionId?: string;
  postId?: string;
}

export type OperationsAnalyticsResponse = AnalyticsSnapshot<OperationsAnalyticsData>;

/** §22.11: policyVersion конверта — версия политики НАБЛЮДЕНИЙ. */
export type AttentionResponse = AnalyticsSnapshot<AttentionData>;

export interface LoadAnalyticsResponse {
  businessDate: string;
  generatedAt: string;
  view: LoadAnalyticsView;
  unavailable: UnavailableMetric[];
}

// ── Источник (узкая проекция стора дежурств) ─────────────────────────────

export interface AnalyticsSourceShift {
  id: string;
  businessDate: string;
  employeeName: string;
  /** §22.9: устойчивая связь с человеком/подразделением; null — связи нет. */
  employeeId: string | null;
  unitId: string | null;
  objectLabel: string;
  stateCode: string;
  dutyTypeCode: string;
  actualStart: string | null;
  actualEnd: string | null;
  updatedAt: string;
}

/** Вид дежурства: срок отдыха и плановая длительность — атрибуты ВИДА. */
export interface AnalyticsDutyType {
  dutyTypeCode: string;
  restAfterMinutes: number;
  defaultDurationMinutes: number;
}

/** Режим нарушения отдыха §21.35 — ТА ЖЕ политика, что у плана дежурств. */
export type AnalyticsRestMode = "HARD_BLOCK" | "SOFT_OVERRIDE";

export interface AnalyticsSource {
  shifts: AnalyticsSourceShift[];
  dutyTypes: AnalyticsDutyType[];
  restMode: AnalyticsRestMode;
  /** Подписи подразделений по ключу unitId. */
  unitLabels: Record<string, string>;
}

// ── Расчёт показателей (серверная сторона мока) ──────────────────────────

export const CALCULATION_VERSION = "service-analytics-2026.07.1";
export const METRIC_DEFINITION_VERSION = "metrics-2026.07.1";
export const POLICY_VERSION = "analytics-policy-2026.07.1";

export const METRIC_CODES = {
  onDuty: "DUTY_ACTIVE",
  planned: "DUTY_PLANNED",
  rest: "REST_AFTER_DUTY",
  unfinished: "UNFINISHED_PAST_DUTIES",
  hardConflicts: "CONFLICT_HARD",
  softConflicts: "CONFLICT_SOFT",
  unconfirmed: "UNCONFIRMED_PARTICIPATION",
} as const;

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  const base = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10))
  );
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

/** §22.5: границы периода строит СЕРВЕР по пресету и бизнес-дате. */
export function resolvePreset(
  preset: PeriodPreset,
  businessDate: string
): { from: string; to: string } {
  const from = addDays(businessDate, preset.offsetDays);
  // Включительные границы: длительность 1 день — это from === to.
  return { from, to: addDays(from, preset.lengthDays - 1) };
}

export function inPeriod(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/** §22.7 «незавершённые прошедшие»: строго ДО бизнес-даты — сегодняшняя смена
 * ещё не обязана быть закрытой. */
export function isUnfinishedPast(
  shift: AnalyticsSourceShift,
  businessDate: string
): boolean {
  if (shift.businessDate >= businessDate) return false;
  return shift.stateCode !== "COMPLETED" && shift.stateCode !== "CANCELLED";
}

/** «Неподтверждённое участие»: смена дошла до несения службы, а факта нет. */
export function isUnconfirmed(shift: AnalyticsSourceShift): boolean {
  if (shift.stateCode === "ACTIVE") return shift.actualStart === null;
  if (shift.stateCode === "COMPLETED")
    return shift.actualStart === null || shift.actualEnd === null;
  return false;
}

/** Длина отдыха — у ВИДА, в сутках с округлением ВВЕРХ. */
export function restDays(type: AnalyticsDutyType | undefined): number {
  if (type === undefined) return 0;
  return Math.ceil(type.restAfterMinutes / (24 * 60));
}

export function isResting(
  shift: AnalyticsSourceShift,
  type: AnalyticsDutyType | undefined,
  onDate: string
): boolean {
  if (shift.stateCode !== "COMPLETED") return false;
  const days = restDays(type);
  if (days === 0) return false;
  return onDate > shift.businessDate && onDate <= addDays(shift.businessDate, days);
}

/**
 * Конфликты (§21.34/§22.7) — ТЕМ ЖЕ способом, что в плане дежурств:
 * пересечение в один день — всегда жёсткий; нарушение отдыха — severity по
 * режиму политики. Возвращает ИДЕНТИФИКАТОРЫ смен: число показателя получается
 * из выборки, а не наоборот (§22.12).
 */
export function detectConflictShiftIds(
  shifts: readonly AnalyticsSourceShift[],
  types: readonly AnalyticsDutyType[],
  restMode: AnalyticsRestMode
): { hard: string[]; soft: string[] } {
  const typeByCode = new Map(types.map((type) => [type.dutyTypeCode, type]));
  const active = shifts.filter((shift) => shift.stateCode !== "CANCELLED");
  const byEmployee = new Map<string, AnalyticsSourceShift[]>();
  for (const shift of active) {
    const list = byEmployee.get(shift.employeeName) ?? [];
    list.push(shift);
    byEmployee.set(shift.employeeName, list);
  }

  const hard = new Set<string>();
  const soft = new Set<string>();
  for (const list of byEmployee.values()) {
    const sorted = [...list].sort((a, b) =>
      a.businessDate.localeCompare(b.businessDate)
    );
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const first = sorted[i];
        const second = sorted[j];
        if (first.businessDate === second.businessDate) {
          hard.add(first.id);
          hard.add(second.id);
          continue;
        }
        const type = typeByCode.get(first.dutyTypeCode);
        const days = restDays(type);
        if (days === 0) continue;
        if (second.businessDate <= addDays(first.businessDate, days)) {
          // Нарушение принадлежит ВТОРОЙ смене пары — она заступает раньше
          // положенного.
          const target = restMode === "HARD_BLOCK" ? hard : soft;
          target.add(second.id);
        }
      }
    }
  }
  // Смена в обоих наборах остаётся жёсткой: занижать severity нельзя.
  for (const id of hard) soft.delete(id);
  return { hard: [...hard].sort(), soft: [...soft].sort() };
}

/** §22.3: состояние — по СЕРВЕРНЫМ порогам из определения. */
export function metricState(
  value: number | null,
  definition: MetricDefinition
): MetricState {
  if (value === null) return "UNKNOWN";
  if (definition.criticalFrom !== null && value >= definition.criticalFrom)
    return "CRITICAL";
  if (definition.warningFrom !== null && value >= definition.warningFrom)
    return "WARNING";
  return "NORMAL";
}

export function metricDisplayValue(
  value: number | null,
  unit: MetricDefinition["unit"]
): string {
  if (value === null) return "нет данных";
  if (unit === "PERCENT") return `${value}%`;
  if (unit === "MINUTES") return `${value} мин`;
  if (unit === "HOURS") return `${value} ч`;
  return String(value);
}

/** Сборка показателя. null — «посчитать не удалось», не ноль (§35). */
export function buildMetric(
  definition: MetricDefinition,
  value: number | null
): MetricValue {
  return {
    metricCode: definition.metricCode,
    safeLabel: definition.safeLabel,
    value,
    displayValue: metricDisplayValue(value, definition.unit),
    unit: definition.unit,
    state: metricState(value, definition),
    // Раскрывать нечего, если значение неизвестно.
    drilldownAvailable: definition.drilldownAvailable && value !== null,
    metricDefinitionVersion: METRIC_DEFINITION_VERSION,
  };
}

/** §22.12: идентификатор снимка ДЕТЕРМИНИРОВАН входом (версия данных, период,
 * scope) — иначе drill-down нельзя сверить с показателем. */
export function buildSnapshotId(input: {
  revision: string;
  from: string;
  to: string;
  scopeId: string;
}): string {
  return `snap-${input.revision}-${input.from}-${input.to}-${input.scopeId}`;
}

/** Курсор страницы: непрозрачен для экрана, но не секретен. */
export function encodeCursor(offset: number): string {
  return `offset:${offset}`;
}

export function decodeCursor(cursor: string | null): number {
  if (cursor === null) return 0;
  const match = /^offset:(\d+)$/.exec(cursor);
  return match === null ? 0 : Number(match[1]);
}

const SHIFT_STATE_LABEL: Record<string, string> = {
  PLANNED: "Запланировано",
  ACKNOWLEDGED: "Ознакомлен",
  ACTIVE: "На посту",
  COMPLETED: "Завершено",
  CANCELLED: "Отменено",
};

/** Строка выборки: персональная детализация вырезается ЗДЕСЬ, на сервере —
 * скрыть ФИО в вёрстке значит всё равно отдать его браузеру. */
export function toDrilldownRow(
  shift: AnalyticsSourceShift,
  personalDetailAllowed: boolean
): DrilldownRow {
  return {
    rowId: shift.id,
    businessDate: shift.businessDate,
    objectLabel: shift.objectLabel,
    stateLabel: SHIFT_STATE_LABEL[shift.stateCode] ?? shift.stateCode,
    employeeLabel: personalDetailAllowed ? shift.employeeName : null,
  };
}

// ── Наблюдения §22.11 (серверные детекторы) ──────────────────────────────
// Ни один детектор не читает MetricValue: «внимание» — не перекрашенный KPI,
// у элементов СВОИ policyVersion и detectedAt.

export const ATTENTION_POLICY_VERSION = "attention-policy-2026.07.1";

/** §22.11 «Используй формулировки» — РОВНО пять разрешённых. */
export const ATTENTION_TITLES = {
  VERIFICATION_REQUIRED: "Требуется проверка",
  DATA_UNCONFIRMED: "Данные не подтверждены",
  THRESHOLD_EXCEEDED: "Обнаружено превышение серверного порога",
  UNFINISHED_PROCESSES: "Есть незавершённые процессы",
  SOURCE_NOT_UPDATED: "Источник не обновлён",
} as const;

export type AttentionTitleCode = keyof typeof ATTENTION_TITLES;

export type AttentionMeasure =
  | "ACKNOWLEDGEMENT_MISSING"
  | "CONFLICT_SHARE"
  | "UNFINISHED_OVERDUE"
  | "UNCONFIRMED_OVERDUE"
  | "SOURCE_AGE";

/** Определение детектора: пороги и допуски — В ДАННЫХ (администрируются
 * разделом «Настройки»). */
export interface AttentionDetectorDefinition {
  categoryCode: string;
  measure: AttentionMeasure;
  titleCode: AttentionTitleCode;
  /** Плейсхолдеры {count}/{parameter}/{value}: описание составляет СЕРВЕР. */
  safeDescriptionTemplate: string;
  parameter: number;
  warningFrom: number | null;
  criticalFrom: number | null;
  baseSeverity: AttentionSeverity;
  targetRoute: string | null;
  targetPermission: string | null;
}

interface Measurement {
  value: number;
  count: number | null;
}

const HOUR_MS = 3_600_000;

function measureDetector(
  definition: AttentionDetectorDefinition,
  source: AnalyticsSource,
  context: { from: string; to: string; businessDate: string; generatedAt: string }
): Measurement | null {
  const inRange = source.shifts.filter((shift) =>
    inPeriod(shift.businessDate, context.from, context.to)
  );

  switch (definition.measure) {
    case "ACKNOWLEDGEMENT_MISSING": {
      // Ближайшие заступления без отметки: смена через месяц — не наблюдение.
      const horizon = addDays(context.businessDate, definition.parameter);
      const hits = inRange.filter(
        (shift) =>
          shift.stateCode === "PLANNED" &&
          shift.businessDate >= context.businessDate &&
          shift.businessDate <= horizon
      );
      return { value: hits.length, count: hits.length };
    }
    case "CONFLICT_SHARE": {
      // ДОЛЯ, а не количество: 3 конфликта на 4 смены и на 40 — разные
      // наблюдения. При пустом периоде наблюдения нет (0/0 — не 0%).
      if (inRange.length === 0) return null;
      const conflicts = detectConflictShiftIds(
        inRange,
        source.dutyTypes,
        source.restMode
      );
      const affected = conflicts.hard.length + conflicts.soft.length;
      return {
        value: Math.round((affected / inRange.length) * 100),
        count: affected,
      };
    }
    case "UNFINISHED_OVERDUE": {
      // Выдержка: вчерашняя незакрытая смена — обычный ход работы.
      const deadline = addDays(context.businessDate, -definition.parameter);
      const hits = inRange.filter(
        (shift) =>
          shift.businessDate < deadline &&
          shift.stateCode !== "COMPLETED" &&
          shift.stateCode !== "CANCELLED"
      );
      return { value: hits.length, count: hits.length };
    }
    case "UNCONFIRMED_OVERDUE": {
      const deadline = addDays(context.businessDate, -definition.parameter);
      const hits = inRange.filter(
        (shift) => shift.businessDate < deadline && isUnconfirmed(shift)
      );
      return { value: hits.length, count: hits.length };
    }
    case "SOURCE_AGE": {
      // Утверждение об ИСТОЧНИКЕ, а не о людях. count остаётся null.
      const latest = source.shifts.reduce(
        (max, shift) => (shift.updatedAt > max ? shift.updatedAt : max),
        ""
      );
      if (latest === "") return null;
      const ageMs =
        new Date(context.generatedAt).getTime() - new Date(latest).getTime();
      return { value: Math.max(0, Math.floor(ageMs / HOUR_MS)), count: null };
    }
  }
}

function detectorFires(
  definition: AttentionDetectorDefinition,
  value: number
): boolean {
  const thresholds = [definition.warningFrom, definition.criticalFrom].filter(
    (item): item is number => item !== null
  );
  if (thresholds.length === 0) return value > 0;
  return value >= Math.min(...thresholds);
}

function detectorSeverity(
  definition: AttentionDetectorDefinition,
  value: number
): AttentionSeverity {
  if (definition.criticalFrom !== null && value >= definition.criticalFrom)
    return "CRITICAL";
  if (definition.warningFrom !== null && value >= definition.warningFrom)
    return "WARNING";
  return definition.baseSeverity;
}

function renderDescription(
  definition: AttentionDetectorDefinition,
  measurement: Measurement
): string {
  return definition.safeDescriptionTemplate
    .replaceAll("{count}", measurement.count === null ? "—" : String(measurement.count))
    .replaceAll("{parameter}", String(definition.parameter))
    .replaceAll("{value}", String(measurement.value));
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

export interface AttentionPolicyValues {
  parameter?: number;
  warningFrom?: number;
  criticalFrom?: number;
}

/**
 * Наложение администрируемой политики на определения. Политики нет —
 * детекторов нет: наблюдать по методике, которую никто не администрирует,
 * значит выдать результат за действующую политику. Детектор без своей записи
 * сохраняет собственные значения.
 */
export function applyAttentionPolicy(
  definitions: readonly AttentionDetectorDefinition[],
  policy: { byDetector: ReadonlyMap<string, AttentionPolicyValues> } | null
): AttentionDetectorDefinition[] {
  if (policy === null) return [];
  return definitions.map((definition) => {
    const values = policy.byDetector.get(definition.categoryCode);
    if (values === undefined) return definition;
    return {
      ...definition,
      parameter: values.parameter ?? definition.parameter,
      warningFrom: values.warningFrom ?? definition.warningFrom,
      criticalFrom: values.criticalFrom ?? definition.criticalFrom,
    };
  });
}

/** Сборка блока. Порядок задаёт СЕРВЕР (severity, затем код категории). */
export function buildAttentionItems(
  definitions: readonly AttentionDetectorDefinition[],
  source: AnalyticsSource,
  context: {
    from: string;
    to: string;
    businessDate: string;
    generatedAt: string;
    snapshotId: string;
    scopeLabel: string | null;
    policyVersion: string;
  }
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const definition of definitions) {
    const measurement = measureDetector(definition, source, context);
    if (measurement === null) continue;
    if (!detectorFires(definition, measurement.value)) continue;
    items.push({
      // Идентификатор ДЕТЕРМИНИРОВАН снимком и категорией.
      attentionId: `att-${context.snapshotId}-${definition.categoryCode}`,
      categoryCode: definition.categoryCode,
      severity: detectorSeverity(definition, measurement.value),
      safeTitle: ATTENTION_TITLES[definition.titleCode],
      safeDescription: renderDescription(definition, measurement),
      count: measurement.count,
      scopeLabel: context.scopeLabel,
      targetRoute: definition.targetRoute,
      targetPermission: definition.targetPermission,
      detectedAt: context.generatedAt,
      policyVersion: context.policyVersion,
    });
  }
  return items.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.categoryCode.localeCompare(b.categoryCode)
  );
}

// ── Нагрузка §22.9 ───────────────────────────────────────────────────────
// План — по назначениям, факт — по подтверждённому участию; они считаются
// разными проходами и НЕ смешиваются. loadState красится ТОЛЬКО по плану.

export interface LoadPolicyView {
  periodDays: number;
  warningMinutes: number;
  overloadMinutes: number;
  policyVersion: string;
}

export type LoadState = "NORMAL" | "WARNING" | "OVERLOADED" | "UNKNOWN";

export interface LoadMetric {
  employeeId: string | null;
  safeLabel: string;
  organizationUnitId: string;
  plannedMinutes: number | null;
  actualMinutes: number | null;
  /** Всегда null — окна ночной работы в модели нет (NIGHT-WINDOW-001). */
  nightMinutes: number | null;
  loadState: LoadState;
  safeReasonCodes: string[];
  policyVersion: string | null;
}

export interface LoadAnalyticsView {
  units: LoadMetric[];
  employees: LoadMetric[];
  /** Смены окна без связи §22.9 (employeeId === null). */
  unlinkedShiftsCount: number;
  policy: LoadPolicyView | null;
}

function minutesBetween(startIso: string, endIso: string): number {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  return Math.round((end - start) / 60_000);
}

function resolveLoadState(planned: number, policy: LoadPolicyView): LoadState {
  if (planned >= policy.overloadMinutes) return "OVERLOADED";
  if (planned >= policy.warningMinutes) return "WARNING";
  return "NORMAL";
}

function loadStateReasons(state: LoadState): string[] {
  if (state === "OVERLOADED") return ["PLANNED_OVERLOAD"];
  if (state === "WARNING") return ["PLANNED_WARNING"];
  return [];
}

/**
 * §22.9. План: PLANNED/ACKNOWLEDGED/ACTIVE/COMPLETED окна; отменённая смена не
 * входит никуда. Факт: только COMPLETED с обоими штампами. Политики нет —
 * значения null и UNKNOWN: «посчитать нельзя», не «нормально».
 */
export function buildLoadAnalytics(
  source: AnalyticsSource,
  policy: LoadPolicyView | null,
  businessDate: string
): LoadAnalyticsView {
  const durationByType = new Map(
    source.dutyTypes.map((type) => [type.dutyTypeCode, type.defaultDurationMinutes])
  );

  interface Bucket {
    employeeId: string | null;
    safeLabel: string;
    organizationUnitId: string;
    planned: number;
    actual: number;
  }
  const unitBuckets = new Map<string, Bucket>();
  const employeeBuckets = new Map<string, Bucket>();
  let unlinked = 0;

  const windowFrom =
    policy === null ? null : addDays(businessDate, -(policy.periodDays - 1));
  const windowShifts = source.shifts.filter(
    (shift) =>
      shift.stateCode !== "CANCELLED" &&
      (windowFrom === null || inPeriod(shift.businessDate, windowFrom, businessDate))
  );
  for (const shift of windowShifts) {
    const planned =
      policy === null ? 0 : (durationByType.get(shift.dutyTypeCode) ?? 0);
    const actual =
      policy !== null &&
      shift.stateCode === "COMPLETED" &&
      shift.actualStart !== null &&
      shift.actualEnd !== null
        ? minutesBetween(shift.actualStart, shift.actualEnd)
        : 0;
    if (shift.employeeId === null || shift.unitId === null) {
      // Связь не установлена: сумма без владельца поехала бы в чужую строку.
      unlinked += 1;
      continue;
    }
    const unit = unitBuckets.get(shift.unitId) ?? {
      employeeId: null,
      safeLabel: source.unitLabels[shift.unitId] ?? shift.unitId,
      organizationUnitId: shift.unitId,
      planned: 0,
      actual: 0,
    };
    unit.planned += planned;
    unit.actual += actual;
    unitBuckets.set(shift.unitId, unit);

    const employee = employeeBuckets.get(shift.employeeId) ?? {
      employeeId: shift.employeeId,
      safeLabel: shift.employeeName,
      organizationUnitId: shift.unitId,
      planned: 0,
      actual: 0,
    };
    employee.planned += planned;
    employee.actual += actual;
    employeeBuckets.set(shift.employeeId, employee);
  }

  const toMetric = (bucket: Bucket): LoadMetric => {
    if (policy === null) {
      return {
        employeeId: bucket.employeeId,
        safeLabel: bucket.safeLabel,
        organizationUnitId: bucket.organizationUnitId,
        plannedMinutes: null,
        actualMinutes: null,
        nightMinutes: null,
        loadState: "UNKNOWN",
        safeReasonCodes: ["POLICY_UNDEFINED"],
        policyVersion: null,
      };
    }
    const state = resolveLoadState(bucket.planned, policy);
    return {
      employeeId: bucket.employeeId,
      safeLabel: bucket.safeLabel,
      organizationUnitId: bucket.organizationUnitId,
      plannedMinutes: bucket.planned,
      actualMinutes: bucket.actual,
      nightMinutes: null,
      loadState: state,
      safeReasonCodes: loadStateReasons(state),
      policyVersion: policy.policyVersion,
    };
  };

  // Порядок — по ПОДПИСИ: сортировка по величине была бы таблицей «кто
  // перегружен», собранной без запроса.
  const units = [...unitBuckets.values()]
    .map(toMetric)
    .sort((a, b) => a.safeLabel.localeCompare(b.safeLabel, "ru"));
  const employees = [...employeeBuckets.values()]
    .map(toMetric)
    .sort((a, b) => a.safeLabel.localeCompare(b.safeLabel, "ru"));

  return { units, employees, unlinkedShiftsCount: unlinked, policy };
}

// ── Аналитика ОМ §22.13/§22.15 ───────────────────────────────────────────

/** Узкая проекция стора ОМ. */
export interface OpsSourcePost {
  postId: string;
  sectorLabel: string;
  /** Сектор привязанной версии паспорта; null у строки, заведённой руками. */
  sourceSectorId: string | null;
  postLabel: string;
  need: number;
  assigned: number;
  acknowledged: number;
}

export interface OpsSourceEvent {
  id: string;
  code: string;
  title: string;
  objectId: string | null;
  objectName: string;
  businessDate: string;
  stageCode: string;
  readinessPercent: number | null;
  conflictsCount: number;
  demandApproved: boolean;
  demandNeedTotal: number;
  requestedTotal: number;
  allocatedTotal: number;
  incidentsCount: number;
  closedAt: string | null;
  posts: OpsSourcePost[];
}

export interface LifecycleStateDefinition {
  stateCode: string;
  safeLabel: string;
}

export const OPS_CALCULATION_VERSION = "operations-analytics-2026.07.1";

/** Корзина ОМ без объекта в реестре: склейка по имени запрещена. */
export const UNBOUND_OBJECT_ID = "object:unbound";

export const OPS_COLUMNS = {
  events: { code: "EVENTS", safeLabel: "ОМ" },
  demandNeed: { code: "DEMAND_NEED", safeLabel: "Утверждённая потребность" },
  requested: { code: "REQUESTED", safeLabel: "Запрошено" },
  allocated: { code: "ALLOCATED", safeLabel: "Выделено" },
  assigned: { code: "ASSIGNED", safeLabel: "Назначено" },
  acknowledged: { code: "ACKNOWLEDGED", safeLabel: "Ознакомлено" },
  conflicts: { code: "CONFLICTS", safeLabel: "Конфликты" },
  incidents: { code: "INCIDENTS", safeLabel: "Записи об инцидентах" },
  posts: { code: "POSTS", safeLabel: "Постов" },
  need: { code: "NEED", safeLabel: "Требуется по расчёту" },
} as const;

/** §22.15: набор колонок принадлежит УРОВНЮ — на уровне поста «запрошено»
 * неизвестно, и пустая колонка читалась бы как ноль. */
export function columnsFor(level: OpsLevel): OpsColumn[] {
  switch (level) {
    case "ALL":
    case "OBJECT":
      return [
        OPS_COLUMNS.events,
        OPS_COLUMNS.demandNeed,
        OPS_COLUMNS.requested,
        OPS_COLUMNS.allocated,
        OPS_COLUMNS.assigned,
        OPS_COLUMNS.acknowledged,
        OPS_COLUMNS.conflicts,
        OPS_COLUMNS.incidents,
      ];
    case "EVENT":
      return [
        OPS_COLUMNS.posts,
        OPS_COLUMNS.need,
        OPS_COLUMNS.assigned,
        OPS_COLUMNS.acknowledged,
      ];
    case "DIRECTION":
      return [OPS_COLUMNS.need, OPS_COLUMNS.assigned, OPS_COLUMNS.acknowledged];
    case "POST":
      return [OPS_COLUMNS.assigned, OPS_COLUMNS.acknowledged];
  }
}

function opsCell(code: string, value: number): OpsCell {
  return { code, value, unavailableReason: null };
}

function sumOf(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Идентификатор направления всегда содержит id ОМ: одинаковый сектор в двух
 * мероприятиях — ДВА разных направления. */
export function directionId(eventId: string, post: OpsSourcePost): string {
  return post.sourceSectorId === null
    ? `${eventId}::local:${post.sectorLabel}`
    : `${eventId}::${post.sourceSectorId}`;
}

function directionLabel(post: OpsSourcePost): string {
  return post.sourceSectorId === null
    ? `Сектор ${post.sectorLabel} (расчёт ОМ, без связи с паспортом)`
    : `Сектор ${post.sectorLabel}`;
}

function eventCells(events: OpsSourceEvent[]): OpsCell[] {
  const posts = events.flatMap((event) => event.posts);
  return [
    opsCell(OPS_COLUMNS.events.code, events.length),
    opsCell(
      OPS_COLUMNS.demandNeed.code,
      // Только УТВЕРЖДЁННАЯ потребность: черновые строки — не обязательство.
      sumOf(
        events
          .filter((event) => event.demandApproved)
          .map((event) => event.demandNeedTotal)
      )
    ),
    opsCell(OPS_COLUMNS.requested.code, sumOf(events.map((e) => e.requestedTotal))),
    opsCell(OPS_COLUMNS.allocated.code, sumOf(events.map((e) => e.allocatedTotal))),
    opsCell(OPS_COLUMNS.assigned.code, sumOf(posts.map((post) => post.assigned))),
    opsCell(
      OPS_COLUMNS.acknowledged.code,
      sumOf(posts.map((post) => post.acknowledged))
    ),
    opsCell(OPS_COLUMNS.conflicts.code, sumOf(events.map((e) => e.conflictsCount))),
    opsCell(OPS_COLUMNS.incidents.code, sumOf(events.map((e) => e.incidentsCount))),
  ];
}

/** §22.13: распределение по реестру + коды вне реестра ОТДЕЛЬНО. */
export function lifecycleDistribution(
  events: readonly OpsSourceEvent[],
  registry: readonly LifecycleStateDefinition[]
): { buckets: LifecycleBucket[]; unknownCodes: string[] } {
  const counts = new Map<string, number>();
  for (const event of events) {
    counts.set(event.stageCode, (counts.get(event.stageCode) ?? 0) + 1);
  }
  const buckets = registry.map((state) => ({
    stateCode: state.stateCode,
    safeLabel: state.safeLabel,
    count: counts.get(state.stateCode) ?? 0,
  }));
  const known = new Set(registry.map((state) => state.stateCode));
  const unknownCodes = [...counts.keys()].filter((code) => !known.has(code)).sort();
  return { buckets, unknownCodes };
}

export function objectRows(events: readonly OpsSourceEvent[]): OpsRow[] {
  const groups = new Map<string, OpsSourceEvent[]>();
  for (const event of events) {
    const key = event.objectId ?? UNBOUND_OBJECT_ID;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.entries()]
    .map(([objectId, group]) => ({
      rowId: objectId,
      safeLabel:
        objectId === UNBOUND_OBJECT_ID
          ? "Объект вне реестра (связь по названию не выводится)"
          : group[0].objectName,
      childLevel: "OBJECT" as const,
      cells: eventCells(group),
    }))
    .sort((a, b) => a.safeLabel.localeCompare(b.safeLabel));
}

export function eventRows(events: readonly OpsSourceEvent[]): OpsRow[] {
  return [...events]
    .sort(
      (a, b) =>
        a.businessDate.localeCompare(b.businessDate) || a.code.localeCompare(b.code)
    )
    .map((event) => ({
      rowId: event.id,
      safeLabel: `${event.code} · ${event.title}`,
      childLevel: "EVENT" as const,
      cells: eventCells([event]),
    }));
}

export function directionRows(event: OpsSourceEvent): OpsRow[] {
  const groups = new Map<string, OpsSourcePost[]>();
  for (const post of event.posts) {
    const key = directionId(event.id, post);
    groups.set(key, [...(groups.get(key) ?? []), post]);
  }
  return [...groups.entries()]
    .map(([id, posts]) => ({
      rowId: id,
      safeLabel: directionLabel(posts[0]),
      childLevel: "DIRECTION" as const,
      cells: [
        opsCell(OPS_COLUMNS.posts.code, posts.length),
        opsCell(OPS_COLUMNS.need.code, sumOf(posts.map((post) => post.need))),
        opsCell(OPS_COLUMNS.assigned.code, sumOf(posts.map((post) => post.assigned))),
        opsCell(
          OPS_COLUMNS.acknowledged.code,
          sumOf(posts.map((post) => post.acknowledged))
        ),
      ],
    }))
    .sort((a, b) => a.safeLabel.localeCompare(b.safeLabel));
}

export function postRows(event: OpsSourceEvent, direction: string): OpsRow[] {
  return event.posts
    .filter((post) => directionId(event.id, post) === direction)
    .map((post) => ({
      rowId: post.postId,
      safeLabel: post.postLabel,
      childLevel: "POST" as const,
      cells: [
        opsCell(OPS_COLUMNS.need.code, post.need),
        opsCell(OPS_COLUMNS.assigned.code, post.assigned),
        opsCell(OPS_COLUMNS.acknowledged.code, post.acknowledged),
      ],
    }));
}

/** Последний уровень — АГРЕГИРОВАННОЕ участие, не список людей (§22.26). */
export function participationRows(post: OpsSourcePost): OpsRow[] {
  return [
    {
      rowId: post.postId,
      safeLabel: "Участие по посту (агрегированно)",
      childLevel: null,
      cells: [
        opsCell(OPS_COLUMNS.assigned.code, post.assigned),
        opsCell(OPS_COLUMNS.acknowledged.code, post.acknowledged),
      ],
    },
  ];
}

function opsFact(
  code: string,
  safeLabel: string,
  displayValue: string,
  unavailableReason: string | null = null
): OpsFact {
  return { code, safeLabel, displayValue, unavailableReason };
}

/** §22.15 карточка ОМ: недоступные поля приходят С ПРИЧИНОЙ, не нулём. */
export function buildEventCard(
  event: OpsSourceEvent,
  registry: readonly LifecycleStateDefinition[]
): OpsEventCard {
  const state = registry.find((item) => item.stateCode === event.stageCode);
  const assigned = sumOf(event.posts.map((post) => post.assigned));
  const acknowledged = sumOf(event.posts.map((post) => post.acknowledged));
  return {
    eventId: event.id,
    code: event.code,
    safeLabel: event.title,
    facts: [
      opsFact("CODE", "Код", event.code),
      opsFact(
        "OBJECT",
        "Объект",
        event.objectId === null
          ? `${event.objectName} — объекта нет в реестре`
          : event.objectName
      ),
      opsFact("PERIOD", "Период", event.businessDate),
      opsFact(
        "LIFECYCLE",
        "Состояние жизненного цикла",
        state?.safeLabel ?? `${event.stageCode} — состояния нет в Lifecycle Registry`
      ),
      opsFact(
        "REVISION",
        "Revision",
        "нет данных",
        "Формальной редакции у ОМ в модели нет: изменения пишутся в саму карточку, версии не нумеруются. Показать «1» значило бы придумать номер."
      ),
      opsFact(
        "READINESS",
        "Готовность",
        event.readinessPercent === null ? "нет данных" : `${event.readinessPercent}%`
      ),
      opsFact(
        "DEMAND",
        "Утверждённая потребность",
        event.demandApproved
          ? String(event.demandNeedTotal)
          : "потребность не утверждена"
      ),
      opsFact("REQUESTED", "Запрошено", String(event.requestedTotal)),
      opsFact("ALLOCATED", "Выделено", String(event.allocatedTotal)),
      opsFact("ASSIGNED", "Назначено", String(assigned)),
      opsFact(
        "ACTUAL",
        "Фактически участвовало",
        "нет данных",
        "Факта участия в ОМ модель не ведёт: отмечается только ознакомление. Приравнять факт к назначению значило бы записать в участники того, кто мог не выйти."
      ),
      opsFact("ACKNOWLEDGED", "Ознакомлено", String(acknowledged)),
      opsFact("CONFLICTS", "Конфликты", String(event.conflictsCount)),
      opsFact("INCIDENTS", "Записи об инцидентах", String(event.incidentsCount)),
      opsFact(
        "CLOSURE_READY",
        "Готовность к закрытию",
        event.closedAt === null ? "мероприятие не закрыто" : "закрыто",
        "Правила «можно ли закрыть» в модели нет — есть только факт закрытия."
      ),
    ],
  };
}

export function breadcrumbFor(
  level: OpsLevel,
  parts: {
    objectId?: string;
    objectLabel?: string;
    eventId?: string;
    eventLabel?: string;
    directionId?: string;
    directionLabel?: string;
    postId?: string;
    postLabel?: string;
  }
): OpsBreadcrumbItem[] {
  const trail: OpsBreadcrumbItem[] = [{ level: "ALL", id: null, safeLabel: "Все ОМ" }];
  if (level === "ALL") return trail;
  trail.push({
    level: "OBJECT",
    id: parts.objectId ?? null,
    safeLabel: parts.objectLabel ?? "",
  });
  if (level === "OBJECT") return trail;
  trail.push({
    level: "EVENT",
    id: parts.eventId ?? null,
    safeLabel: parts.eventLabel ?? "",
  });
  if (level === "EVENT") return trail;
  trail.push({
    level: "DIRECTION",
    id: parts.directionId ?? null,
    safeLabel: parts.directionLabel ?? "",
  });
  if (level === "DIRECTION") return trail;
  trail.push({
    level: "POST",
    id: parts.postId ?? null,
    safeLabel: parts.postLabel ?? "",
  });
  return trail;
}
