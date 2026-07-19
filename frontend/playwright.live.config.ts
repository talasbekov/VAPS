// Story 11.6 — ЖИВОЙ стек для сценария №4 из лимита 5 (architecture.md#L259):
// «WS-событие → UI». Отдельный конфиг, отдельная папка, отдельный скрипт —
// НЕ расширение playwright.config.ts, и это несущее решение (Решение №6).
//
// webServer в Playwright глобален для запуска: положив живую спеку в e2e/, мы
// заставили бы КАЖДЫЙ `npm run test:e2e` поднимать docker, Postgres, Redis и
// uvicorn. Штатный e2e сегодня backend-free умышленно (8.8 Д4: офлайн-контур
// без бэка), поэтому `playwright.config.ts` не трогается ни на строку.
//
// Топология (Решение №1): compose db+redis (те же контейнеры, что у `make gate`)
// + ЛОКАЛЬНЫЙ uvicorn. Прод-compose (nginx + worker + beat) — это 12.1.
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// Env живого стека — ОДИН источник на оба процесса (uvicorn здесь и дочерние
// manage.py в спеке). 🔴 VAPS_REDIS_URL обязана совпадать: разные Redis дают
// самый дорогой отказ — group_send уходит в другой брокер, ошибки нет, лога
// нет, кадр просто не приходит (architecture.md#L337). Дословно Makefile:95-101.
export const LIVE_ENV = {
  VAPS_DB: 'postgres',
  VAPS_DB_NAME: 'vaps',
  VAPS_DB_USER: 'vaps',
  VAPS_DB_PASSWORD: 'vaps',
  VAPS_DB_HOST: 'localhost',
  VAPS_DB_PORT: '5433',
  VAPS_REDIS_URL: 'redis://127.0.0.1:6380/0',
}

const BACKEND_DIR = fileURLToPath(new URL('../Backend/VAPS', import.meta.url))

export default defineConfig({
  // fileURLToPath, не URL.pathname — путь репо содержит кириллицу (ловушка 8.8 №7)
  testDir: fileURLToPath(new URL('./e2e-live', import.meta.url)),
  // Один воркер: эмиттер берёт advisory_lock(blocking=False) и при неудаче
  // МОЛЧА выходит (lagging_check.py:104-111) — два параллельных прогона дали бы
  // «notified 0» без единой ошибки. Не украшение.
  workers: 1,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Одной командой: контейнеры → миграции → сервер.
      // 🔴 Базу `vaps` мигрируем ЯВНО. Гейт живёт в `test_vaps` (pytest создаёт
      // свою), базовая `vaps` может быть девственно пустой — без migrate uvicorn
      // отдаст 500 на первом же запросе. Пересечений с гейтом нет: разные базы.
      command:
        'sh -c "docker compose up -d --wait db redis && ' +
        '.venv/bin/python manage.py migrate --noinput && ' +
        '.venv/bin/uvicorn config.asgi:application --host 127.0.0.1 --port 8001"',
      cwd: BACKEND_DIR,
      env: LIVE_ENV,
      // 🔴 Адрес подобран curl'ом, а не предположением (Ловушка 20): Playwright
      // ждёт 2xx/3xx, а `/api/notifications/` отдаёт 403 без actor'а →
      // «сервер не поднялся» по таймауту, хотя он поднялся. Замерено на живом
      // стеке: /api/schema/ → 404 (не смонтирован), / → 404, /api/notifications/
      // → 403, /admin/login/ → 200. Единственный 2xx без аутентификации.
      url: 'http://127.0.0.1:8001/admin/login/',
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    },
    {
      // ВСЕГДА пересобирать (ревью 9.9 P10): залипший preview со старым dist-e2e
      // дал бы зелёную спеку против кода, которого больше нет.
      command: 'npm run build:e2e && npm run preview:e2e',
      url: 'http://localhost:4174/e2e-harness/notifications.html',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
