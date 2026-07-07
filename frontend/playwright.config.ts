// Минимальная Playwright-инфра (стори 8.8, Д1): chromium-only, БЕЗ бэка,
// против ПРОДАКШН-сборки через vite preview (Ловушка 8: именно в dist CSS
// конкатенирован — там утечка скоупа print.css и проявилась бы; dev-сервер
// инжектит стили по-модульно и маскирует каскад). Канон L260: Playwright на
// FF100 невозможен — смок доказывает МЕХАНИКУ изоляции, пиксельная верность
// печати FF100 — ручной релизный смоук (Ловушка 4). E2e вне gate (Д4:
// бюджет <5 мин + офлайн-контур без Playwright-браузеров) — `npm run test:e2e`.
// E9.8/9.9 переиспользуют этот конфиг (CDP-throttling/compose — их стори).
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  // fileURLToPath, не URL.pathname — путь репо содержит кириллицу (Ловушка 7)
  testDir: fileURLToPath(new URL('./e2e', import.meta.url)),
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
