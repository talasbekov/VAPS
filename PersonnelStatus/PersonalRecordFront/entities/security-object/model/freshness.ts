// Актуальность паспорта и KPI реестра — чистая модель без React/клиента.
// Правила:
//   • интервал живёт в ДАННЫХ (PassportFreshnessPolicy), не константой;
//   • срок и состояние считаются на «сервере» (в мок-слое) и приходят на
//     экран готовыми — страница не сравнивает даты сама;
//   • KPI считаются по всему реестру, а не по отрисованной странице.
// Арифметика дат — только через Date.UTC, без локального new Date(строка):
// это календарные дни, разбор в локальной зоне сдвигал бы день в минусовых
// таймзонах.
import type {
  PassportFreshness,
  PassportFreshnessPolicy,
  PassportFreshnessState,
  ObjectsRegistryKpi,
  SecurityObject,
} from "./types";

export function addDays(date: string, amount: number): string {
  const year = Number(date.slice(0, 4));
  const monthIndex = Number(date.slice(5, 7)) - 1;
  const day = Number(date.slice(8, 10));
  return new Date(Date.UTC(year, monthIndex, day + amount))
    .toISOString()
    .slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const toUtc = (date: string) =>
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10))
    );
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Последняя по номеру опубликованная версия; null — публикаций не было. */
function latestVersion(object: SecurityObject) {
  if (object.passportVersions.length === 0) return null;
  return object.passportVersions.reduce((best, version) =>
    version.versionNumber > best.versionNumber ? version : best
  );
}

/**
 * Срок проверки отсчитывается от effectiveFrom ПОСЛЕДНЕЙ публикации:
 * актуальность задаёт то, когда паспорт в последний раз утвердили, а не
 * когда правили черновик.
 */
export function resolveFreshness(
  object: SecurityObject,
  policy: PassportFreshnessPolicy,
  businessDate: string
): PassportFreshness {
  const version = latestVersion(object);
  if (version === null) {
    return {
      objectId: object.id,
      state: "NO_PUBLISHED_VERSION",
      verificationDueAt: null,
      freshnessPolicyVersion: policy.version,
    };
  }
  const verificationDueAt = addDays(
    version.effectiveFrom,
    policy.verificationIntervalDays
  );
  const daysLeft = daysBetween(businessDate, verificationDueAt);
  // порог «скоро» тоже приходит от политики — доля интервала, не второе
  // захардкоженное число периода
  const dueSoonThreshold = Math.ceil(
    (policy.verificationIntervalDays * policy.dueSoonPercent) / 100
  );
  const state: PassportFreshnessState =
    daysLeft < 0 ? "OVERDUE" : daysLeft <= dueSoonThreshold ? "DUE_SOON" : "FRESH";
  return {
    objectId: object.id,
    state,
    verificationDueAt,
    freshnessPolicyVersion: policy.version,
  };
}

export function buildObjectsKpi(
  objects: readonly SecurityObject[],
  freshness: readonly PassportFreshness[]
): ObjectsRegistryKpi {
  const stateById = new Map(freshness.map((item) => [item.objectId, item.state]));
  return {
    total: objects.length,
    passportGreen: objects.filter((o) => o.passportState === "GREEN").length,
    passportYellow: objects.filter((o) => o.passportState === "YELLOW").length,
    passportRed: objects.filter((o) => o.passportState === "RED").length,
    verificationOverdue: objects.filter(
      (o) => stateById.get(o.id) === "OVERDUE"
    ).length,
    neverPublished: objects.filter(
      (o) => stateById.get(o.id) === "NO_PUBLISHED_VERSION"
    ).length,
  };
}

/**
 * Подписи актуальности обязаны отличаться на словах от подписей состояния
 * паспорта: GREEN уже называется «Актуален», одноимённое состояние срока
 * давало бы два одинаковых слова в соседних колонках.
 */
export const FRESHNESS_LABEL: Record<PassportFreshnessState, string> = {
  FRESH: "Срок соблюдён",
  DUE_SOON: "Скоро проверка",
  OVERDUE: "Проверка просрочена",
  NO_PUBLISHED_VERSION: "Не публиковался",
};

export const PASSPORT_STATE_LABEL: Record<
  SecurityObject["passportState"],
  string
> = {
  GREEN: "Актуален",
  YELLOW: "Требует проверки",
  RED: "Требует внимания",
};
