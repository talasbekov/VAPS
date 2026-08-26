// Композиция MSW-обработчиков мок-слоя раздела ОМ. По мере портирования фич
// сюда добавляются handler-наборы (objects, security-events, duties, …).
// Пути пишутся с завершающим слэшом — в next.config.js включён
// trailingSlash: true, паттерны без слэша промахиваются мимо перехвата.
import {
  isOpsAnalyticsLive,
  isOpsAccessLive,
  isOpsAuditLive,
  isOpsDictionariesLive,
  isOpsDutiesLive,
  isOpsFeedbackLive,
  isOpsGvoLive,
  isOpsLegalDocumentsLive,
  isOpsObjectsLive,
  isOpsProtectedPersonsLive,
  isOpsRatingsLive,
  isOpsSecurityEventsLive,
  isOpsServiceReportsLive,
  isOpsSettingsLive,
} from "@/lib/ops-env";
import { accessHandlers } from "./access-handlers";
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
import { gvoHandlers } from "./gvo-handlers";
import { protectedPersonsHandlers } from "./protected-persons-handlers";
import { legalDocumentsHandlers } from "./legal-documents-handlers";

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
    // План дежурств — тот же пер-доменный переключатель (срез C1).
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
    // «Реестр ГВО» живьём с 20.08.2026 (патчи сводок — /api/ops/gvo-summaries/);
    // мок остаётся для демо через NEXT_PUBLIC_OPS_MOCK_DOMAINS=gvo.
    ...(isOpsGvoLive() ? [] : gvoHandlers),
    // Каталог охраняемых лиц живьём с 20.08.2026 (/api/ops/protected-persons/).
    ...(isOpsProtectedPersonsLive() ? [] : protectedPersonsHandlers),
    // Нормативная база живьём с 21.08.2026 (/api/ops/legal-documents/).
    ...(isOpsLegalDocumentsLive() ? [] : legalDocumentsHandlers),
    // Раздел доступа (права, роли, назначения, учётки) живьём с 26.08.2026 —
    // шаги «П-1»…«П-5». Мок включается возвратом домена: демо без бэка и
    // отладка экранов (NEXT_PUBLIC_OPS_MOCK_DOMAINS=access).
    ...(isOpsAccessLive() ? [] : accessHandlers),
  ];
}
