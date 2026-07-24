// Smart Josparlau E2E (мастер-промпт §33): отдельный конфиг, отдельная папка,
// отдельный скрипт — тот же принцип, что playwright.live.config.ts (Решение
// №6 стори 11.6): штатный `playwright.config.ts` гоняет ПРОДАКШН-сборку
// (mode=production, БЕЗ MSW, A7/A8) — Smart Josparlau-экраны в неё не входят.
// Здесь — mock-сборка (`build:mock`/`preview:mock`, MODE=mock), свой порт
// (4176, не пересекается с 4173 прод-preview и 4174 e2e-harness).
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: fileURLToPath(new URL('./e2e-mock', import.meta.url)),
  workers: 1,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    baseURL: 'http://localhost:4176',
    // Больше дефолтных 1280×720: DemoToolbar — fixed bottom-4 right-4
    // виджет (только dev-furniture, не продуктовый UI) — на маленьком
    // вьюпорте перекрывает нижние кнопки страницы (например «Закрыть
    // мероприятие» у длинного журнала штаба).
    viewport: { width: 1600, height: 1000 },
  },
  webServer: {
    // ВСЕГДА пересобирать (прецедент 9.9 P10): залипший preview со старым
    // dist дал бы зелёную спеку против кода, которого больше нет.
    command: 'npm run build:mock && npx vite preview --mode mock --port 4176 --strictPort',
    url: 'http://localhost:4176',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
