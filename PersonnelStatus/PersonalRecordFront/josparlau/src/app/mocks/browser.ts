// setupWorker bootstrap (§8.1). Импортируется ТОЛЬКО динамически из main.tsx
// при VITE_DATA_SOURCE=mock — реальный API-режим не должен тянуть MSW/mock-код
// в обязательный startup chunk.
import { setupWorker } from 'msw/browser'
import { registerRbacDirectory } from '../../shared/testing/mock-runtime/rbac-directory'
import { composeHandlers } from './compose-handlers'
import { DEMO_PERSONAS } from './demo-personas'

let started = false

/**
 * Запускает MSW worker и ждёт его готовности ПЕРЕД монтированием React —
 * иначе первые queries уходят в сеть до перехвата (§8.1 «это предотвращает
 * гонку»). Идемпотентно: повторный вызов (HMR) не плодит вторую регистрацию.
 */
export async function startMockWorker(): Promise<void> {
  if (started) return
  // Регистрация ОДИН раз до первого перехваченного запроса: feature-хендлеры
  // (не могут импортировать app/mocks/demo-personas, ARCH-FE-013) проверяют
  // права через shared/testing/mock-runtime/rbac-directory.
  registerRbacDirectory(DEMO_PERSONAS.map((p) => ({ userId: p.userId, permissions: p.permissions })))
  const worker = setupWorker(...composeHandlers())
  await worker.start({
    onUnhandledRequest: 'error',
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
  started = true
}
