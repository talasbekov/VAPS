// Композиция MSW-обработчиков мок-слоя раздела ОМ. По мере портирования фич
// сюда добавляются handler-наборы (objects, security-events, duties, …).
// Пути пишутся с завершающим слэшом — в next.config.js включён
// trailingSlash: true, паттерны без слэша промахиваются мимо перехвата.
import { identityHandlers } from "./identity";
import { objectsHandlers } from "./objects-handlers";
import { securityEventsHandlers } from "./security-events-handlers";
import { dutiesHandlers } from "./duties-handlers";
import { auditHandlers } from "./audit-store";
import { settingsHandlers } from "./settings-store";
import { dictionariesHandlers } from "./dictionaries-handlers";
import { ratingsHandlers } from "./ratings-handlers";

export function composeOpsHandlers() {
  return [
    ...identityHandlers,
    ...objectsHandlers,
    ...securityEventsHandlers,
    ...dutiesHandlers,
    ...auditHandlers,
    ...settingsHandlers,
    ...dictionariesHandlers,
    ...ratingsHandlers,
  ];
}
