// setupWorker bootstrap (§8.1). Импортируется ТОЛЬКО динамически из main.tsx
// при VITE_DATA_SOURCE=mock — реальный API-режим не должен тянуть MSW/mock-код
// в обязательный startup chunk.
import { setupWorker } from 'msw/browser'
import { registerRbacDirectory } from '../../shared/testing/mock-runtime/rbac-directory'
import { composeHandlers } from './compose-handlers'
import { DEMO_PERSONAS } from './demo-personas'

// Promise, а не флаг: два ПАРАЛЛЕЛЬНЫХ вызова (StrictMode-эффект host-моста)
// проходили гонкой мимо булевого guard'а и поднимали ДВА инстанса worker'а —
// каждый исполнял handler, мутация писалась дважды (Этап M2).
let startPromise: Promise<void> | null = null

/**
 * Запускает MSW worker и ждёт его готовности ПЕРЕД монтированием React —
 * иначе первые queries уходят в сеть до перехвата (§8.1 «это предотвращает
 * гонку»). Идемпотентно: повторный вызов (HMR) не плодит вторую регистрацию.
 */
export function startMockWorker(): Promise<void> {
  if (startPromise !== null) return startPromise
  startPromise = start()
  return startPromise
}

async function start(): Promise<void> {
  // Регистрация ОДИН раз до первого перехваченного запроса: feature-хендлеры
  // (не могут импортировать app/mocks/demo-personas, ARCH-FE-013) проверяют
  // права через shared/testing/mock-runtime/rbac-directory.
  registerRbacDirectory(DEMO_PERSONAS.map((p) => ({ userId: p.userId, permissions: p.permissions })))
  const worker = setupWorker(...composeHandlers())
  await worker.start({
    onUnhandledRequest: 'error',
    serviceWorker: { url: '/mockServiceWorker.js' },
  })
}
