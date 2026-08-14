// Композиция MSW-обработчиков мок-слоя раздела ОМ. По мере портирования фич
// сюда добавляются handler-наборы (objects, security-events, duties, …).
// Пути пишутся с завершающим слэшом — в next.config.js включён
// trailingSlash: true, паттерны без слэша промахиваются мимо перехвата.
import { isOpsAnalyticsLive, isOpsAuditLive, isOpsCombatLive, isOpsDailyLive, isOpsDictionariesLive, isOpsDutiesLive, isOpsFeedbackLive, isOpsObjectsLive, isOpsRatingsLive, isOpsSecurityEventsLive, isOpsServiceReportsLive, isOpsSettingsLive } from "@/lib/ops-env";
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
import { gvoHandlers } from "./gvo-handlers";
import { protectedPersonsHandlers } from "./protected-persons-handlers";

export function composeOpsHandlers() {
  return [
    // Права раздела (`/api/operations/my-permissions/`) мок больше НЕ рисует:
    // ручка живёт на бэке, а wildcard-персона мока маскировала RBAC —
    // на любой учётке раздел выглядел администраторским.
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
    ...(isOpsAuditLive() ? [] : auditHandlers),
    // Настройки живьём — владелец политик (сквозная запись в синглтоны);
    // мок-стор остаётся источником readConflictPolicy/readFreshnessPolicy
    // для ещё не переведённых слайсов.
    ...(isOpsSettingsLive() ? [] : settingsHandlers),
    ...(isOpsDictionariesLive() ? [] : dictionariesHandlers),
    // Рейтинг живьём — тот же пер-доменный переключатель (срез G): в live
    // его handlers не регистрируются, запросы уходят bypass-ом в сеть.
    ...(isOpsRatingsLive() ? [] : ratingsHandlers),
    // Аналитика живьём — тот же пер-доменный переключатель (срез H).
    ...(isOpsAnalyticsLive() ? [] : analyticsHandlers),
    // Служебные отчёты живьём — тот же пер-доменный переключатель (срез I).
    ...(isOpsServiceReportsLive() ? [] : reportsHandlers),
    // Обратная связь живьём — тот же пер-доменный переключатель (срез J).
    ...(isOpsFeedbackLive() ? [] : feedbackHandlers),
    // «Расход дня» живьём — адаптеры над /api/operations/ (без своего бэка).
    ...(isOpsDailyLive() ? [] : dailyHandlers),
    ...(isOpsCombatLive() ? [] : combatHandlers),
    // «Реестр ГВО» — без пер-доменного переключателя: своего бэкенда у раздела
    // нет вовсе, поэтому live-режим ему нечего означать. Патчи правок живут в
    // моке всегда (запись об этом — в lib/api-gaps.ts).
    ...gvoHandlers,
    // Каталог охраняемых лиц — по той же причине без переключателя: справочник
    // существует только в мок-слое.
    ...protectedPersonsHandlers,
  ];
}
