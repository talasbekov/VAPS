// Конфиг смоук-обхода (e2e/smoke-buttons.spec.ts). Отдельный файл по тому же
// принципу, что playwright.live.config.ts и playwright.mock.config.ts: штатный
// `playwright.config.ts` умышленно backend-free, а этому обходу нужен живой
// стек — засунув его туда, мы заставили бы КАЖДЫЙ `npm run test:e2e` поднимать
// Django и требовать данных на стенде.
//
// 🔴 Браузер — firefox: контур целевой FF (build.target firefox100 в
// vite.config.ts), и обход обязан ходить тем же движком, что пользователь.
// headless: false — по заданию (видимое окно), и заодно печать/фокус ведут
// себя как на живой машине.
//
// webServer НЕТ намеренно: стенд поднимается снаружи (.claude/launch.json →
// `personnel-django` :8100 и `vaps-spa-live` :5180). Смоук — диагностика по
// работающему стенду, а не самодостаточная сборка; подняв сервера сам, он
// прятал бы «фронт не стартует» за собственным билдом.
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  // fileURLToPath, не URL.pathname — путь репо содержит кириллицу (ловушка 8.8 №7)
  testDir: fileURLToPath(new URL('./e2e', import.meta.url)),
  testMatch: 'smoke-buttons.spec.ts',
  // Один воркер: обход кликает по живому стенду и меняет его состояние —
  // параллельные персоны видели бы правки друг друга.
  workers: 1,
  // Находки — данные отчёта, а не падения: обход обязан дойти до конца.
  retries: 0,
  reporter: [['list']],
  projects: [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:5180',
    headless: false,
    viewport: { width: 1600, height: 1000 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
})
