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

// Story 10.10: full-flow (спек submission-flow против РЕАЛЬНОГО бэка) живёт за
// env-гейтом E2E_FULL — без него ни project full-flow, ни webServer Django не
// существуют вовсе: офлайн-канон `npm run test:e2e` (Д4 8.8) не тяжелеет ни
// на секунду. Запуск: `npm run test:e2e:flow` (E2E_FULL=1 --project=full-flow).
const E2E_FULL = Boolean(process.env.E2E_FULL)
// Порт Django: та же переменная читается e2e/serve-backend.sh; на машинах с
// занятым :8000 (чужой сервис) задать E2E_BACKEND_PORT=8001 и т.п.
const BACKEND_PORT = process.env.E2E_BACKEND_PORT ?? '8000'
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`

export default defineConfig({
  // fileURLToPath, не URL.pathname — путь репо содержит кириллицу (Ловушка 7)
  testDir: fileURLToPath(new URL('./e2e', import.meta.url)),
  // Один воркер (ревью 9.9 P10): перф-замеры daily-grid не должны делить CPU
  // с параллельным print-воркером — иначе p95-артефакт несравним между прогонами.
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // 10.10: сквозной спек — ТОЛЬКО project full-flow (иначе офлайн-прогон
      // пытался бы ходить в несуществующий бэк).
      testIgnore: '**/submission-flow.spec.ts',
    },
    ...(E2E_FULL
      ? [
          {
            name: 'full-flow',
            use: { ...devices['Desktop Chrome'] },
            testMatch: '**/submission-flow.spec.ts',
          },
        ]
      : []),
  ],
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
      // 10.10: при full-flow прод-preview получает адрес реального бэка для
      // preview.proxy (vite.config); офлайн-прогон env не трогает — канон 8.8
      // байт-в-байт.
      ...(E2E_FULL ? { env: { VITE_PROXY_TARGET: BACKEND_ORIGIN } } : {}),
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
    // 10.10: РЕАЛЬНЫЙ Django-бэк (compose-Postgres + migrate + сид vaps_e2e +
    // runserver) — запись существует ТОЛЬКО при E2E_FULL (Ловушка №5: офлайн-
    // канон не поднимает ни docker, ни .venv). reuseExistingServer: false —
    // залипший runserver со старым сидом дал бы зелень против протухших данных
    // (прецедент 9.9 P10). Healthcheck: /admin/login/ стабильно < 500.
    ...(E2E_FULL
      ? [
          {
            command: 'bash e2e/serve-backend.sh',
            url: `${BACKEND_ORIGIN}/admin/login/`,
            reuseExistingServer: false,
            // compose --wait + migrate + сид: дефолтных 60с может не хватить.
            timeout: 240_000,
          },
        ]
      : []),
  ],
})
