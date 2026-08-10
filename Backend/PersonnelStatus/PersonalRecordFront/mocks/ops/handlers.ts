// Композиция MSW-обработчиков мок-слоя раздела ОМ. По мере портирования фич
// сюда добавляются handler-наборы (objects, security-events, duties, …).
// Пути пишутся с завершающим слэшом — в next.config.js включён
// trailingSlash: true, паттерны без слэша промахиваются мимо перехвата.
import { isOpsCombatLive, isOpsDutiesLive, isOpsObjectsLive, isOpsSecurityEventsLive } from "@/lib/ops-env";
import { identityHandlers } from "./identity";
import { objectsHandlers } from "./objects-handlers";
import { securityEventsHandlers } from "./security-events-handlers";
import { dutiesHandlers } from "./duties-handlers";
import { auditHandlers } from "./audit-store";
import { settingsHandlers } from "./settings-store";
import { dictionariesHandlers } from "./dictionaries-handlers";
import { ratingsHandlers } from "./ratings-handlers";
import { analyticsHandlers } from "./analytics-handlers";
import { reportsHandlers } from "./reports-handlers";
import { feedbackHandlers } from "./feedback-handlers";
import { dailyHandlers } from "./daily-handlers";
import { combatHandlers } from "./combat-handlers";

export function composeOpsHandlers() {
  return [
    ...identityHandlers,
    // Объекты подключены к живому бэку пер-доменно (срез A2): в live-режиме
    // их handlers НЕ регистрируются, запросы уходят bypass-ом в сеть.
    // Стор объектов при этом остаётся: соседние мок-слайсы (ОМ, дежурства)
    // по-прежнему читают его фикстуры через readObjectsStore().
    ...(isOpsObjectsLive() ? [] : objectsHandlers),
    // ОМ и кадровый снимок подключены тем же пер-доменным переключателем
    // (срез B1). Стор мока остаётся: dictionaries/analytics/ratings читают
    // его фикстуры через readSecurityEventsStore().
    ...(isOpsSecurityEventsLive() ? [] : securityEventsHandlers),
    // План дежурств — тот же пер-доменный переключатель (срез C1). Боевые
    // группы (combatHandlers) остаются на моке — их бэка ещё нет.
    ...(isOpsDutiesLive() ? [] : dutiesHandlers),
    ...auditHandlers,
    ...settingsHandlers,
    ...dictionariesHandlers,
    ...ratingsHandlers,
    ...analyticsHandlers,
    ...reportsHandlers,
    ...feedbackHandlers,
    ...dailyHandlers,
    ...(isOpsCombatLive() ? [] : combatHandlers),
  ];
}
