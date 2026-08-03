// Композиция MSW handlers для browser mock-режима (§8.2 «Композиция находится
// на уровне app»). НЕ переиспользует `shared/api/testing/handlers.ts` целиком:
// те фикстуры — намеренно сломанные протокольные пробы (500/502/network-error)
// для тестов обработки ошибок, а не рабочий demo (§8 intro, явный запрет).
// Feature handlers добавляются сюда по мере Этапа 2+ (сейчас реестр пуст).
import type { HttpHandler } from 'msw'
import { createSecurityEventsHandlers } from '../../features/security-events/mocks/handlers'
import { personnelHandlers } from '../../features/personnel/mocks/handlers'
import { createObjectsHandlers } from '../../features/objects/mocks/handlers'
import { auditHandlers } from '../../features/audit/mocks/handlers'
import { createDutiesHandlers } from '../../features/duties/mocks/handlers'
import { dutyPlansHandlers } from '../../features/duty-plans/mocks/handlers'
import { placementHandlers } from '../../features/placement/mocks/handlers'
import { getDemoClock, getPersistenceAdapter } from './demo-runtime'
import { identityHandlers } from './identity-handlers'

export function composeHandlers(): HttpHandler[] {
  const adapter = getPersistenceAdapter()
  const clock = getDemoClock()
  return [
    ...identityHandlers,
    ...createSecurityEventsHandlers(adapter, clock),
    ...personnelHandlers,
    ...createObjectsHandlers(adapter, clock),
    ...auditHandlers,
    ...createDutiesHandlers(adapter, clock),
    ...dutyPlansHandlers,
    ...placementHandlers,
  ]
}
