// Транспорт раздела ОМ (/security-ops/*): поднимать ли host-MSW и подменять ли
// WebSocket наблюдателем мок-стора. Переключение: NEXT_PUBLIC_OPS_DATA_SOURCE=api.
//
// ВНИМАНИЕ: это НЕ переключатель источника данных — им управляет
// isDomainLive() ниже. Разведены намеренно: реальный сокет живёт по
// `${location.host}/ws/notifications/`, то есть на Next-хосте, а тот WS не
// проксирует — на стенде колокольчик обязан оставаться на мок-сокете, даже
// когда все данные идут из живого бэка.
export function isOpsMockMode(): boolean {
  return process.env.NEXT_PUBLIC_OPS_DATA_SOURCE !== "api";
}

// Пер-доменный источник данных. Бэкенд ОМ закрыт целиком (10.08.2026), поэтому
// домен ЖИВОЙ ПО УМОЛЧАНИЮ: чистый клон без env-файла работает поверх реального
// бэка, а не уезжает молча в мок. Раньше живость держал untracked `.env.local`
// со списком NEXT_PUBLIC_OPS_LIVE_DOMAINS — и раздел выглядел рабочим на моке
// везде, где этого файла не оказывалось.
//
// Обратный жест — NEXT_PUBLIC_OPS_MOCK_DOMAINS: список доменов через запятую,
// которые нужно вернуть на мок (демо без бэка, отладка фикстур).
// NEXT_PUBLIC_OPS_LIVE_DOMAINS по-прежнему читается: он ничего не меняет, пока
// домен и так живой, но остаётся валидным явным жестом «этот домен — живьём».
function parseDomains(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "")
  );
}

export function opsLiveDomains(): ReadonlySet<string> {
  return parseDomains(process.env.NEXT_PUBLIC_OPS_LIVE_DOMAINS);
}

export function opsMockDomains(): ReadonlySet<string> {
  return parseDomains(process.env.NEXT_PUBLIC_OPS_MOCK_DOMAINS);
}

function isDomainLive(domain: string): boolean {
  if (opsLiveDomains().has(domain)) return true;
  return !opsMockDomains().has(domain);
}

export function isOpsObjectsLive(): boolean {
  return isDomainLive("objects");
}

export function isOpsSecurityEventsLive(): boolean {
  return isDomainLive("security-events");
}

export function isOpsDutiesLive(): boolean {
  return isDomainLive("duties");
}

export function isOpsCombatLive(): boolean {
  return isDomainLive("combat");
}

export function isOpsGvoLive(): boolean {
  return isDomainLive("gvo");
}

export function isOpsProtectedPersonsLive(): boolean {
  return isDomainLive("protected-persons");
}

export function isOpsDictionariesLive(): boolean {
  return isDomainLive("dictionaries");
}

export function isOpsSettingsLive(): boolean {
  return isDomainLive("settings");
}

export function isOpsAuditLive(): boolean {
  return isDomainLive("audit");
}

export function isOpsRatingsLive(): boolean {
  return isDomainLive("ratings");
}

export function isOpsAnalyticsLive(): boolean {
  return isDomainLive("analytics");
}

export function isOpsServiceReportsLive(): boolean {
  return isDomainLive("service-reports");
}

export function isOpsFeedbackLive(): boolean {
  return isDomainLive("feedback");
}

export function isOpsDailyLive(): boolean {
  return isDomainLive("daily");
}
