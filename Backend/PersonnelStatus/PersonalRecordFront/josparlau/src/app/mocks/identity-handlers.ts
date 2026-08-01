// Mock-обработчик СУЩЕСТВУЮЩЕЙ операции my-permissions (contract_status:
// existing — путь и форма ответа из schema.d.ts, см.
// docs/frontend/FRONTEND_MOCK_API_CONTRACT.md). В browser mock-режиме права
// зависят от текущей demo-persona (`X-User-Id`), а не от статичной фикстуры —
// иначе смена persona не меняла бы видимые разделы (§8.1 demo persona).
import { http, HttpResponse } from 'msw'
import type { paths } from '../../shared/api/schema'
import { findDemoPersonaByUserId } from './demo-personas'

type MyPermissionsResponse =
  paths['/api/operations/my-permissions/']['get']['responses']['200']['content']['application/json']

export const identityHandlers = [
  http.get('*/api/operations/my-permissions/', ({ request }) => {
    const userId = request.headers.get('X-User-Id')
    const persona = userId === null ? undefined : findDemoPersonaByUserId(userId)
    if (persona === undefined) {
      // Нет распознанной persona — честный deny-all, а НЕ admin-фолбэк
      // (§35 «создавать production role codes из подписей demo-переключателя»
      // тот же принцип: неизвестный credential не получает прав по умолчанию).
      console.warn(
        `[mock] my-permissions: неизвестный X-User-Id=${String(userId)} — возвращён пустой набор прав`,
      )
      const empty: MyPermissionsResponse = { permissions: [] }
      return HttpResponse.json(empty)
    }
    const body: MyPermissionsResponse = { permissions: persona.permissions }
    return HttpResponse.json(body)
  }),
]
