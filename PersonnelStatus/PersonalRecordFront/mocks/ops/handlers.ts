// Композиция MSW-обработчиков мок-слоя раздела ОМ. По мере портирования фич
// сюда добавляются handler-наборы (objects, security-events, duties, …).
// Пути пишутся с завершающим слэшом — в next.config.js включён
// trailingSlash: true, паттерны без слэша промахиваются мимо перехвата.
import { isOpsObjectsLive } from "@/lib/ops-env";
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
    ...securityEventsHandlers,
    ...dutiesHandlers,
    ...auditHandlers,
    ...settingsHandlers,
    ...dictionariesHandlers,
    ...ratingsHandlers,
    ...analyticsHandlers,
    ...reportsHandlers,
    ...feedbackHandlers,
    ...dailyHandlers,
    ...combatHandlers,
  ];
}
