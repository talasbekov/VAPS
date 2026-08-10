// Источник данных раздела ОМ (/security-ops/*): mock (по умолчанию — реального
// бэкенда ОМ пока нет) или api. Переключение: NEXT_PUBLIC_OPS_DATA_SOURCE=api.
export function isOpsMockMode(): boolean {
  return process.env.NEXT_PUBLIC_OPS_DATA_SOURCE !== "api";
}

// Пер-доменное подключение живого бэка: NEXT_PUBLIC_OPS_LIVE_DOMAINS —
// список доменов через запятую (пока поддержан только "objects"). Домен из
// списка исключается из host-MSW: его запросы уходят в сеть (bypass) к
// реальному бэку. Глобальный NEXT_PUBLIC_OPS_DATA_SOURCE=api остаётся жестом
// «весь раздел живой» и этот список перекрывает.
export function opsLiveDomains(): ReadonlySet<string> {
  const raw = process.env.NEXT_PUBLIC_OPS_LIVE_DOMAINS ?? "";
  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "")
  );
}

export function isOpsObjectsLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("objects");
}

export function isOpsSecurityEventsLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("security-events");
}

export function isOpsDutiesLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("duties");
}

export function isOpsCombatLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("combat");
}

export function isOpsDictionariesLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("dictionaries");
}

export function isOpsSettingsLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("settings");
}

export function isOpsAuditLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("audit");
}

export function isOpsRatingsLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("ratings");
}

export function isOpsAnalyticsLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("analytics");
}

export function isOpsServiceReportsLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("service-reports");
}

export function isOpsFeedbackLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("feedback");
}

export function isOpsDailyLive(): boolean {
  return !isOpsMockMode() || opsLiveDomains().has("daily");
}
