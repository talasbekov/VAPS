// Конфиг смоук-обхода (e2e/smoke-buttons.spec.ts). Отдельный файл, потому что
// штатного playwright.config.ts у этого фронта нет вовсе: обход — единственная
// спека, и заводить общий конфиг «на будущее» значит навязать всем следующим
// тестам живой стенд.
//
// webServer НЕТ намеренно: стенд поднимается снаружи (Django :8100 и
// `npm run dev -- -p 3106`). Смоук — диагностика по РАБОТАЮЩЕМУ стенду, а не
// самодостаточная сборка; подняв сервера сам, он прятал бы «фронт не стартует»
// за собственным билдом.
//
// 🔴 `__dirname`, а НЕ `import.meta.url`: package.json без `"type": "module"`,
// Playwright компилирует конфиг и спеки в CJS — `import.meta` там запрещён, и
// файл падает ещё до старта («exports is not defined in ES module scope»).
// Заодно снимается ловушка кириллицы в пути: `__dirname` — обычный путь ФС, а
// не URL, процентного кодирования в нём не бывает.
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: path.join(__dirname, 'e2e'),
  // Обход и точечные пробы по живому стенду перечислены явно: `**/*.spec.ts`
  // затянул бы сюда любую будущую спеку, которой живой стенд не нужен, и она
  // падала бы у всех, кто его не поднял.
  testMatch: ['smoke-buttons.spec.ts', 'objects-tabs.spec.ts', 'gvo-sections.spec.ts', 'protected-persons.spec.ts', 'legal-documents.spec.ts', 'placement-stage.spec.ts', 'closure-stage.spec.ts', 'acknowledgement-stage.spec.ts', 'approval-stage.spec.ts', 'recon-stage.spec.ts'],
  // Один воркер: обход кликает по живому стенду и меняет его состояние —
  // параллельные персоны видели бы правки друг друга.
  workers: 1,
  // Находки — данные отчёта, а не падения: обход обязан дойти до конца.
  retries: 0,
  reporter: [['list']],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:3106',
    headless: true,
    viewport: { width: 1600, height: 1000 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
})
