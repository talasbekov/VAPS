// Композиция MSW handlers для browser mock-режима (§8.2 «Композиция находится
// на уровне app»). НЕ переиспользует `shared/api/testing/handlers.ts` целиком:
// те фикстуры — намеренно сломанные протокольные пробы (500/502/network-error)
// для тестов обработки ошибок, а не рабочий demo (§8 intro, явный запрет).
// Feature handlers добавляются сюда по мере Этапа 2+ (сейчас реестр пуст).
import type { HttpHandler } from 'msw'
import { createSecurityEventsHandlers } from '../../features/security-events/mocks/handlers'
import { createPersonnelHandlers } from '../../features/personnel/mocks/handlers'
import { createObjectsHandlers } from '../../features/objects/mocks/handlers'
import { auditHandlers } from '../../features/audit/mocks/handlers'
import { createDutiesHandlers } from '../../features/duties/mocks/handlers'
import { createDictionariesHandlers } from '../../features/dictionaries/mocks/handlers'
import { getDemoClock, getPersistenceAdapter } from './demo-runtime'
import { identityHandlers } from './identity-handlers'

export function composeHandlers(): HttpHandler[] {
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
  ]
}
