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
    ],
    sectionVersions: {
      CONFLICT_RULES: "conflict-policy-v1",
      PASSPORT_FRESHNESS: "policy-v1",
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
