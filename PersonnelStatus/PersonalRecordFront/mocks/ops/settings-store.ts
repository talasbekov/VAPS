// Стор политик «Настроек» — ЕДИНСТВЕННЫЙ источник для потребителей:
// планирование дежурств читает режим отдыха (readConflictPolicy), реестр
// объектов — интервалы свежести паспорта (readFreshnessPolicy). Правка здесь
// меняет исход операций на других экранах, а не окраску экрана настроек.
import { http, HttpResponse } from "msw";
import {
  formatSettingValue,
  nextPolicyVersion,
  validateSettingValue,
  SETTINGS_PATH,
  SETTING_CHANGES_PATH,
} from "@/entities/policy-setting";
import type {
  ListSettingsResponse,
  PolicySetting,
  SettingChangeEvent,
  SettingSectionCode,
  StoredSetting,
  UpdateSettingRequest,
  UpdateSettingResponse,
} from "@/entities/policy-setting";
import type { ConflictPolicy } from "@/entities/duty-shift";
import type { PassportFreshnessPolicy } from "@/entities/security-object";
import type { RatingPolicy } from "@/entities/operational-rating";
import { appendAudit } from "./audit-store";

const STORE_KEY = "ops-mock-settings";

interface SettingsState {
  settings: StoredSetting[];
  sectionVersions: Record<SettingSectionCode, string>;
  changeLog: SettingChangeEvent[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildSeed(): SettingsState {
  return {
    settings: [
      {
        settingCode: "conflict.rest_after_duty.mode",
        sectionCode: "CONFLICT_RULES",
        kind: "CHOICE",
        valueType: "MODE",
        safeLabel: "Отдых после дежурства",
        description:
          "Как планирование реагирует на назначение в период обязательного отдыха.",
        value: "SOFT_OVERRIDE",
        options: [
          {
            value: "SOFT_OVERRIDE",
            safeLabel: "Обход с обоснованием",
            description:
              "Назначение возможно: планирующий подтверждает конфликт причиной, она сохраняется на смене.",
          },
          {
            value: "HARD_BLOCK",
            safeLabel: "Жёсткая блокировка",
            description:
              "Назначение в период отдыха отвергается без возможности обхода.",
          },
        ],
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "conflict.duty_overlap.mode",
        sectionCode: "CONFLICT_RULES",
        kind: "CHOICE",
        valueType: "MODE",
        safeLabel: "Пересечение дежурств",
        description:
          "Два дежурства одного сотрудника в один день.",
        value: "HARD_BLOCK",
        options: [
          {
            value: "HARD_BLOCK",
            safeLabel: "Жёсткая блокировка",
            description: "Пересечение отвергается всегда.",
          },
        ],
        updatedAt: null,
        updatedBy: null,
        // редактируемость — свойство самого правила
        editable: false,
        lockedReason:
          "Жёсткий запрет пересечения нельзя ослабить никому — правило показано для полноты списка.",
      },
      {
        settingCode: "passport.verification_interval_days",
        sectionCode: "PASSPORT_FRESHNESS",
        kind: "NUMBER",
        valueType: "DAYS",
        safeLabel: "Интервал проверки паспорта",
        description:
          "Через сколько дней после публикации версии паспорт требует проверки.",
        value: 120,
        minValue: 30,
        maxValue: 365,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "passport.due_soon_percent",
        sectionCode: "PASSPORT_FRESHNESS",
        kind: "NUMBER",
        valueType: "PERCENT",
        safeLabel: "Порог «скоро проверка»",
        description:
          "Доля интервала до срока, с которой паспорт помечается «скоро проверка».",
        value: 25,
        minValue: 5,
        maxValue: 50,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "RATING.PERIOD.PARAMETER",
        sectionCode: "RATING_POLICY",
        kind: "NUMBER",
        valueType: "DAYS",
        safeLabel: "Период расчёта рейтинга",
        description:
          "Сколько суток назад от бизнес-даты входит в расчёт агрегата. Правка меняет сводку рейтинга, а не окраску экрана настроек.",
        value: 90,
        minValue: 7,
        maxValue: 365,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "RATING.MIN_EVALUATIONS.PARAMETER",
        sectionCode: "RATING_POLICY",
        kind: "NUMBER",
        valueType: "COUNT",
        safeLabel: "Минимум оценок для агрегата",
        description:
          "Меньше этого числа учтённых оценок — состояние «Недостаточно данных», а не нулевой рейтинг.",
        value: 4,
        minValue: 1,
        maxValue: 20,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "RATING.SUPPRESSION_MIN_GROUP.PARAMETER",
        sectionCode: "RATING_POLICY",
        kind: "NUMBER",
        valueType: "COUNT",
        safeLabel: "Порог безопасной агрегации",
        description:
          "Минимальный размер группы, для которой публикуется средний агрегат в аналитике. Меньше — значение подавляется, а не показывается.",
        value: 3,
        minValue: 2,
        maxValue: 10,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "LIMITS.ANALYTICS_CUSTOM_PERIOD.PARAMETER",
        sectionCode: "ANALYTICS_LIMITS",
        kind: "NUMBER",
        valueType: "DAYS",
        safeLabel: "Предел произвольного периода аналитики",
        description:
          "Максимальная глубина произвольного периода на дашборде аналитики службы. Проверяет сервер при запросе снимка.",
        value: 92,
        minValue: 7,
        maxValue: 366,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "LOAD.PERIOD.PARAMETER",
        sectionCode: "LOAD_POLICY",
        kind: "NUMBER",
        valueType: "DAYS",
        safeLabel: "Окно расчёта нагрузки",
        description:
          "Сколько суток назад от бизнес-даты входит в расчёт плановой и фактической нагрузки.",
        value: 30,
        minValue: 7,
        maxValue: 92,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "LOAD.WARNING_MINUTES.PARAMETER",
        sectionCode: "LOAD_POLICY",
        kind: "NUMBER",
        valueType: "MINUTES",
        safeLabel: "Порог предупреждения нагрузки",
        description:
          "Плановые минуты окна, с которых строка нагрузки получает состояние «Предупреждение».",
        value: 2880,
        minValue: 480,
        maxValue: 20160,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "LOAD.OVERLOAD_MINUTES.PARAMETER",
        sectionCode: "LOAD_POLICY",
        kind: "NUMBER",
        valueType: "MINUTES",
        safeLabel: "Порог перегрузки",
        description:
          "Плановые минуты окна, с которых строка нагрузки получает состояние «Перегрузка».",
        value: 5760,
        minValue: 960,
        maxValue: 40320,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      // Политика наблюдений §22.11: методику (меры, тексты) держит аналитика,
      // ЧИСЛА — здесь. Код: ATTENTION.<детектор>.<PARAMETER|WARNING_FROM|CRITICAL_FROM>.
      {
        settingCode: "ATTENTION.CONFLICT_SHARE.WARNING_FROM",
        sectionCode: "ATTENTION_POLICY",
        kind: "NUMBER",
        valueType: "PERCENT",
        safeLabel: "Доля конфликтных смен: предупреждение",
        description:
          "Доля смен периода с конфликтом планирования, с которой блок «Требует внимания» фиксирует наблюдение.",
        value: 18,
        minValue: 1,
        maxValue: 100,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "ATTENTION.CONFLICT_SHARE.CRITICAL_FROM",
        sectionCode: "ATTENTION_POLICY",
        kind: "NUMBER",
        valueType: "PERCENT",
        safeLabel: "Доля конфликтных смен: критично",
        description:
          "Доля смен периода с конфликтом, с которой наблюдение становится критическим.",
        value: 34,
        minValue: 1,
        maxValue: 100,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "ATTENTION.ACKNOWLEDGEMENT_MISSING.PARAMETER",
        sectionCode: "ATTENTION_POLICY",
        kind: "NUMBER",
        valueType: "DAYS",
        safeLabel: "Срок упреждения ознакомления",
        description:
          "За сколько дней до заступления отсутствие отметки об ознакомлении становится наблюдением «Требуется проверка».",
        value: 3,
        minValue: 1,
        maxValue: 14,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      // Пределы отчётности §22.5: глубина периода ПО ТИПУ отчёта (тип — хвост
      // кода LIMITS.REPORT_PERIOD.<TYPE>) и срок хранения артефактов §22.22.
      {
        settingCode: "LIMITS.REPORT_PERIOD.PERSONNEL_EXPENSE",
        sectionCode: "REPORT_LIMITS",
        kind: "NUMBER",
        valueType: "DAYS",
        safeLabel: "Предел периода «Расход личного состава»",
        description:
          "Максимальная глубина периода отчёта. Проверяет сервер при запуске работы.",
        value: 92,
        minValue: 7,
        maxValue: 366,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
      {
        settingCode: "LIMITS.REPORT_RETENTION.PARAMETER",
        sectionCode: "REPORT_LIMITS",
        kind: "NUMBER",
        valueType: "DAYS",
        safeLabel: "Срок хранения артефактов отчётов",
        description:
          "Сколько дней собранный файл доступен для скачивания. Срок замораживается в артефакте при сборке.",
        value: 14,
        minValue: 1,
        maxValue: 366,
        updatedAt: null,
        updatedBy: null,
        editable: true,
        lockedReason: null,
      },
    ],
    sectionVersions: {
      CONFLICT_RULES: "conflict-policy-v1",
      PASSPORT_FRESHNESS: "policy-v1",
      ANALYTICS_LIMITS: "analytics-limits-v1",
      LOAD_POLICY: "load-policy-v1",
      ATTENTION_POLICY: "attention-policy-v1",
      REPORT_LIMITS: "report-limits-v1",
      // Формат версии методики рейтинга — свой (OPERATIONAL-RATING-<год>.<мес>.N):
      // ею подписываются агрегаты, и точки динамики прошлых редакций несут
      // версии того же формата.
      RATING_POLICY: "OPERATIONAL-RATING-2026.07.1",
    },
    changeLog: [],
  };
}

let state: SettingsState | null = null;

function getState(): SettingsState {
  if (state === null) {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      state = raw === null ? buildSeed() : (JSON.parse(raw) as SettingsState);
    } catch {
      state = buildSeed();
    }
  }
  return state;
}

function persist(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // квота/приватный режим
  }
}

// ── Ридеры для потребителей политики ─────────────────────────────────────

export function readConflictPolicy(): ConflictPolicy {
  const s = getState();
  const mode = s.settings.find(
    (item) => item.settingCode === "conflict.rest_after_duty.mode"
  );
  return {
    restAfterDutyMode:
      mode?.value === "HARD_BLOCK" ? "HARD_BLOCK" : "SOFT_OVERRIDE",
    conflictPolicyVersion: s.sectionVersions.CONFLICT_RULES,
  };
}

export function readFreshnessPolicy(): PassportFreshnessPolicy {
  const s = getState();
  const interval = s.settings.find(
    (item) => item.settingCode === "passport.verification_interval_days"
  );
  const dueSoon = s.settings.find(
    (item) => item.settingCode === "passport.due_soon_percent"
  );
  return {
    version: s.sectionVersions.PASSPORT_FRESHNESS,
    verificationIntervalDays:
      interval?.kind === "NUMBER" ? interval.value : 120,
    dueSoonPercent: dueSoon?.kind === "NUMBER" ? dueSoon.value : 25,
  };
}

/**
 * Методика рейтинга (§19.19: период, минимум и версия приходят от policy).
 * `null` — методика не определена, и это ОТДЕЛЬНОЕ состояние, а не повод взять
 * умолчания: подставленный период вернул бы захардкоженные «90 дней». Неполная
 * политика (стейл-сид sessionStorage без раздела RATING_POLICY) — тоже null.
 */
export function readRatingPolicy(): RatingPolicy | null {
  const s = getState();
  const policyVersion = s.sectionVersions.RATING_POLICY;
  if (typeof policyVersion !== "string" || policyVersion === "") return null;
  let periodDays: number | null = null;
  let minEvaluations: number | null = null;
  for (const item of s.settings) {
    if (item.sectionCode !== "RATING_POLICY" || item.kind !== "NUMBER") continue;
    if (item.settingCode === "RATING.PERIOD.PARAMETER") periodDays = item.value;
    if (item.settingCode === "RATING.MIN_EVALUATIONS.PARAMETER")
      minEvaluations = item.value;
  }
  if (periodDays === null || minEvaluations === null) return null;
  return { periodDays, minEvaluations, policyVersion };
}

/**
 * Порог безопасной агрегации (§22.17) — отдельная проекция, не поле политики:
 * методика управляет РАСЧЁТОМ, порог — ПУБЛИКАЦИЕЙ отчёта. `null` — правило не
 * задано, и отчёт аналитики не публикуется, а не берёт умолчание.
 */
export function readRatingSuppressionMinGroup(): number | null {
  const s = getState();
  for (const item of s.settings) {
    if (item.sectionCode !== "RATING_POLICY") continue;
    if (item.settingCode !== "RATING.SUPPRESSION_MIN_GROUP.PARAMETER") continue;
    return item.kind === "NUMBER" ? item.value : null;
  }
  return null;
}

function numberValue(
  sectionCode: SettingSectionCode,
  settingCode: string
): number | null {
  const s = getState();
  for (const item of s.settings) {
    if (item.sectionCode !== sectionCode || item.settingCode !== settingCode)
      continue;
    return item.kind === "NUMBER" ? item.value : null;
  }
  return null;
}

/**
 * §22.5 предел произвольного периода аналитики. `null` — политика не задана
 * (стейл-сид), и это НЕ «ограничения нет»: произвольный период не принимается
 * вовсе, именованные пресеты продолжают работать.
 */
export function readAnalyticsCustomPeriodLimit(): {
  maxDays: number;
  policyVersion: string;
} | null {
  const s = getState();
  const policyVersion = s.sectionVersions.ANALYTICS_LIMITS;
  if (typeof policyVersion !== "string" || policyVersion === "") return null;
  const maxDays = numberValue(
    "ANALYTICS_LIMITS",
    "LIMITS.ANALYTICS_CUSTOM_PERIOD.PARAMETER"
  );
  if (maxDays === null) return null;
  return { maxDays, policyVersion };
}

/** §22.9 пороги нагрузки. `null` — методика не задана ИЛИ неполна: посчитать
 * по половине политики и подписать её версией значило бы соврать. */
export function readLoadPolicy(): {
  periodDays: number;
  warningMinutes: number;
  overloadMinutes: number;
  policyVersion: string;
} | null {
  const s = getState();
  const policyVersion = s.sectionVersions.LOAD_POLICY;
  if (typeof policyVersion !== "string" || policyVersion === "") return null;
  const periodDays = numberValue("LOAD_POLICY", "LOAD.PERIOD.PARAMETER");
  const warningMinutes = numberValue("LOAD_POLICY", "LOAD.WARNING_MINUTES.PARAMETER");
  const overloadMinutes = numberValue(
    "LOAD_POLICY",
    "LOAD.OVERLOAD_MINUTES.PARAMETER"
  );
  if (periodDays === null || warningMinutes === null || overloadMinutes === null)
    return null;
  return { periodDays, warningMinutes, overloadMinutes, policyVersion };
}

/**
 * §22.11 политика наблюдений: числа по детекторам из кодов вида
 * ATTENTION.<детектор>.<PARAMETER|WARNING_FROM|CRITICAL_FROM>. `null`, а не
 * пустая политика, когда раздела нет: пустая означала бы «порогов не задано»
 * и молча превратила бы меры в бинарные.
 */
export function readAttentionPolicy(): {
  policyVersion: string;
  byDetector: Map<
    string,
    { parameter?: number; warningFrom?: number; criticalFrom?: number }
  >;
} | null {
  const s = getState();
  const policyVersion = s.sectionVersions.ATTENTION_POLICY;
  if (typeof policyVersion !== "string" || policyVersion === "") return null;
  const byDetector = new Map<
    string,
    { parameter?: number; warningFrom?: number; criticalFrom?: number }
  >();
  for (const item of s.settings) {
    if (item.sectionCode !== "ATTENTION_POLICY" || item.kind !== "NUMBER") continue;
    const match = /^ATTENTION\.([A-Z_]+)\.(PARAMETER|WARNING_FROM|CRITICAL_FROM)$/.exec(
      item.settingCode
    );
    if (match === null) continue;
    const bucket = byDetector.get(match[1]) ?? {};
    if (match[2] === "PARAMETER") bucket.parameter = item.value;
    if (match[2] === "WARNING_FROM") bucket.warningFrom = item.value;
    if (match[2] === "CRITICAL_FROM") bucket.criticalFrom = item.value;
    byDetector.set(match[1], bucket);
  }
  return { policyVersion, byDetector };
}

export interface ReportLimits {
  /** Глубина периода ПО ТИПУ отчёта: тип — хвост кода записи. Типа нет в
   * карте — политика про него молчит, и это не «без ограничения». */
  maxPeriodDaysByType: Map<string, number>;
  /** null — срок хранения не задан; сборка файла невозможна: артефакт без
   * expiresAt жил бы вечно. */
  retentionDays: number | null;
  policyVersion: string | null;
}

/** §22.5 пределы отчётности. Отсутствие раздела (стейл-сид) даёт пустую карту
 * и null, а не «привычные» значения по умолчанию. */
export function readReportLimits(): ReportLimits {
  const s = getState();
  const policyVersion = s.sectionVersions.REPORT_LIMITS;
  if (typeof policyVersion !== "string" || policyVersion === "") {
    return { maxPeriodDaysByType: new Map(), retentionDays: null, policyVersion: null };
  }
  const maxPeriodDaysByType = new Map<string, number>();
  let retentionDays: number | null = null;
  for (const item of s.settings) {
    if (item.sectionCode !== "REPORT_LIMITS" || item.kind !== "NUMBER") continue;
    const match = /^LIMITS\.REPORT_PERIOD\.([A-Z_]+)$/.exec(item.settingCode);
    if (match !== null) maxPeriodDaysByType.set(match[1], item.value);
    if (item.settingCode === "LIMITS.REPORT_RETENTION.PARAMETER")
      retentionDays = item.value;
  }
  return { maxPeriodDaysByType, retentionDays, policyVersion };
}

// ── Handlers ─────────────────────────────────────────────────────────────

function errorEnvelope(
  errorCode: string,
  message: string,
  details: Record<string, unknown>,
  status: number
) {
  return HttpResponse.json(
    {
      error_code: errorCode,
      message,
      details,
      request_id: null,
      timestamp: nowIso(),
    },
    { status }
  );
}

function withAction(setting: StoredSetting): PolicySetting {
  // право и замок решает сервер: у запертого правила своя причина
  return {
    ...setting,
    action: {
      canEdit: setting.editable,
      disabledReason: setting.editable ? null : setting.lockedReason,
    },
  } as PolicySetting;
}

export const settingsHandlers = [
  http.get(`*${SETTING_CHANGES_PATH}`, () =>
    HttpResponse.json({ results: getState().changeLog })
  ),

  http.get(`*${SETTINGS_PATH}`, () => {
    const s = getState();
    const response: ListSettingsResponse = {
      results: s.settings.map(withAction),
      sectionVersions: s.sectionVersions,
    };
    return HttpResponse.json(response);
  }),

  // паттерн собирается литералом: settingPath() энкодит ":" в %3A, и маршрут
  // с ним никогда не сматчился бы
  http.patch(`*${SETTINGS_PATH}:settingCode/`, async ({ params, request }) => {
    const settingCode = decodeURIComponent(params.settingCode as string);
    const s = getState();
    const setting = s.settings.find((item) => item.settingCode === settingCode);
    if (setting === undefined) {
      return errorEnvelope(
        "ENTITY_NOT_FOUND",
        "Настройка не найдена.",
        { settingCode },
        404
      );
    }
    if (!setting.editable) {
      return errorEnvelope(
        "SETTING_LOCKED",
        setting.lockedReason ?? "Правило заперто.",
        {},
        422
      );
    }
    const body = (await request.json()) as UpdateSettingRequest;
    const fieldErrors = validateSettingValue(setting, body.value);
    if (typeof body.reason !== "string" || body.reason.trim() === "") {
      fieldErrors.reason = ["Укажите причину изменения."];
    }
    if (Object.keys(fieldErrors).length > 0) {
      return errorEnvelope(
        "VALIDATION_ERROR",
        "Проверьте заполнение формы.",
        fieldErrors,
        400
      );
    }

    const now = nowIso();
    const oldLabel = formatSettingValue(setting, setting.value);
    const updated: StoredSetting =
      setting.kind === "NUMBER"
        ? { ...setting, value: body.value as number, updatedAt: now, updatedBy: "demo-admin" }
        : { ...setting, value: body.value as string, updatedAt: now, updatedBy: "demo-admin" };
    const newLabel = formatSettingValue(updated, updated.value);
    const versionAfter = nextPolicyVersion(
      s.sectionVersions[setting.sectionCode]
    );
    const event: SettingChangeEvent = {
      id: `setting-change-${now}-${settingCode}`,
      settingCode,
      sectionCode: setting.sectionCode,
      safeLabel: setting.safeLabel,
      oldValue: oldLabel,
      newValue: newLabel,
      reason: body.reason.trim(),
      actorUserId: "demo-admin",
      changedAt: now,
      policyVersionAfter: versionAfter,
    };
    state = {
      settings: s.settings.map((item) =>
        item.settingCode === settingCode ? updated : item
      ),
      sectionVersions: { ...s.sectionVersions, [setting.sectionCode]: versionAfter },
      changeLog: [event, ...s.changeLog],
    };
    persist();
    appendAudit({
      action: "settings.update",
      entityType: "PolicySetting",
      entityId: settingCode,
      oldValue: { value: oldLabel },
      newValue: { value: newLabel, policyVersion: versionAfter },
      reason: body.reason.trim(),
    });
    const response: UpdateSettingResponse = {
      setting: withAction(updated),
      sectionVersions: state.sectionVersions,
      event,
    };
    return HttpResponse.json(response);
  }),
];
