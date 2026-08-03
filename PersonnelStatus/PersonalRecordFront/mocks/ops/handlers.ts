// Композиция MSW-обработчиков мок-слоя раздела ОМ. По мере портирования фич
// сюда добавляются handler-наборы (objects, security-events, duties, …).
// Пути пишутся с завершающим слэшом — в next.config.js включён
// trailingSlash: true, паттерны без слэша промахиваются мимо перехвата.
import { identityHandlers } from "./identity";
import { objectsHandlers } from "./objects-handlers";

export function composeOpsHandlers() {
  return [...identityHandlers, ...objectsHandlers];
}
