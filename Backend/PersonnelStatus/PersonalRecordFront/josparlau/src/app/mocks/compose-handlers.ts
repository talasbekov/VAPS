// Композиция MSW handlers для browser mock-режима (§8.2 «Композиция находится
// на уровне app»). НЕ переиспользует `shared/api/testing/handlers.ts` целиком:
// те фикстуры — намеренно сломанные протокольные пробы (500/502/network-error)
// для тестов обработки ошибок, а не рабочий demo (§8 intro, явный запрет).
// Feature handlers добавляются сюда по мере Этапа 2+ (сейчас реестр пуст).
import type { HttpHandler, WebSocketHandler } from 'msw'
import { createSecurityEventsHandlers } from '../../features/security-events/mocks/handlers'
import { createPersonnelHandlers } from '../../features/personnel/mocks/handlers'
import { createObjectsHandlers } from '../../features/objects/mocks/handlers'
import { auditHandlers } from '../../features/audit/mocks/handlers'
import { createDutiesHandlers } from '../../features/duties/mocks/handlers'
import { createDictionariesHandlers } from '../../features/dictionaries/mocks/handlers'
import { createServiceReportsHandlers } from '../../features/service-reports/mocks/handlers'
import { createServiceAnalyticsHandlers } from '../../features/service-analytics/mocks/handlers'
import { createFeedbackHandlers } from '../../features/feedback/mocks/handlers'
import { createSettingsHandlers } from '../../features/settings/mocks/handlers'
import { createRatingsHandlers } from '../../features/ratings/mocks/handlers'
import { getDemoClock, getPersistenceAdapter } from './demo-runtime'
import { donorDefaultHandlers } from './donor-defaults'
import { identityHandlers } from './identity-handlers'

export function composeHandlers(): (HttpHandler | WebSocketHandler)[] {
  const adapter = getPersistenceAdapter()
  const clock = getDemoClock()
  return [
    ...identityHandlers,
    ...createSecurityEventsHandlers(adapter, clock),
    ...createPersonnelHandlers(adapter, clock),
    ...createObjectsHandlers(adapter, clock),
    ...auditHandlers,
    ...createDutiesHandlers(adapter, clock),
    ...createDictionariesHandlers(adapter, clock),
    ...createServiceReportsHandlers(adapter, clock),
    ...createServiceAnalyticsHandlers(adapter, clock),
    ...createFeedbackHandlers(adapter, clock),
    ...createSettingsHandlers(adapter, clock),
    ...createRatingsHandlers(adapter, clock),
    // ПОСЛЕДНИМИ: нейтральные дефолты донорской линии PersonnelStatus —
    // fallback, который не может перехватить путь живой фичи.
    ...donorDefaultHandlers(),
  ]
}
