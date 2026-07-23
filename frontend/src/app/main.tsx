import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import App from './App.tsx'
import { Providers } from './providers.tsx'

/**
 * Mock-режим (§8.1): worker должен запуститься и сеид — прогрузиться ДО
 * первого React-рендера, иначе первые queries уходят в сеть до перехвата
 * (гонка). `import.meta.env.MODE === 'mock'` — ЛИТЕРАЛЬНАЯ проверка (Vite
 * подставляет строку на build-time, ARCH L459): Rollup статически исключает
 * весь блок и весь `./mocks/browser`-chunk (MSW + handlers + fixtures) из
 * `vite build` (дефолт, mode=production) — размер `size-gate` считает КАЖДЫЙ
 * JS-файл в dist/, включая lazy-чанки, поэтому недостаточно просто
 * динамического import() под рантайм-условием (`getFrontendEnv()`
 * зависит от `VITE_DATA_SOURCE`, но это уже НЕ build-time литерал).
 */
async function bootstrap(): Promise<void> {
  if (import.meta.env.MODE === 'mock') {
    const [{ startMockWorker }, { ensureSeeded }] = await Promise.all([
      import('./mocks/browser'),
      import('./mocks/demo-runtime'),
    ])
    // Сид ДО старта worker'а: иначе первый перехваченный запрос застаёт
    // пустое хранилище (безопасно — repository отдаёт [] — но без причины).
    await ensureSeeded()
    await startMockWorker()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Providers>
        <App />
      </Providers>
    </StrictMode>,
  )
}

void bootstrap()
