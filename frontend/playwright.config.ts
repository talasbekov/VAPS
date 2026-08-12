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
  // Смоук-обход портала лежит в e2e/ (так назван по заданию), но офлайн-контуру
  // не принадлежит: ему нужен живой Django и данные на стенде. Свой конфиг —
  // playwright.smoke.config.ts. Без этой строки `npm run test:e2e` собирал бы
  // 127 чужих тестов и отчитывался о них «skipped».
  testIgnore: 'smoke-buttons.spec.ts',
  // Один воркер (ревью 9.9 P10): перф-замеры daily-grid не должны делить CPU
  // с параллельным print-воркером — иначе p95-артефакт несравним между прогонами.
  workers: 1,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    baseURL: 'http://localhost:4173',
  },
  // 9.9: второй сервер — e2e-харнес грида (отдельная сборка dist-e2e, порт
  // 4174; Ловушка №3 — прод-dist/size-gate нетронуты). Грид-спеки ходят по
  // АБСОЛЮТНОМУ URL 4174 (глобальный baseURL остаётся 4173 для print-спеков).
  webServer: [
    {
      command: 'npm run build && npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run build:e2e && npm run preview:e2e',
      url: 'http://localhost:4174/e2e-harness/index.html',
      // ВСЕГДА пересобирать (ревью 9.9 P10): залипший preview со старым
      // dist-e2e дал бы зелёные спеки против кода, которого больше нет —
      // build:e2e не входит ни в один другой пайплайн (в отличие от 4173,
      // который пересобирает gate).
      reuseExistingServer: false,
    },
  ],
})
