// Конфиг ОБХОДА ПОРТАЛА (`e2e/smoke-buttons.spec.ts`) — отдельный от целевых
// проб (Plane №94).
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ. Обход ходит по всем маршрутам портала пятью персонами и
// идёт больше часа. Пока он стоял в одном конфиге с целевыми пробами, любой
// вопрос «не сломал ли я экран» стоил часа, а падение обхода уносило с собой
// очередь: 26.08.2026 сторож памяти перезапустил стенд на 15-й пробе из 132, и
// вместе с обходом не выполнились ВСЕ целевые пробы за ним. Замер того же дня:
// 67 проб за 2400 секунд, отдельные маршруты по 2,8-2,9 минуты.
//
// Обход — диагностика состояния портала, целевые пробы — проверка правки.
// Разные вопросы, разная частота, разное время: у них не должно быть общей
// очереди.
//
// Как гонять:
//   SMOKE_LIVE=1 npx playwright test -c playwright.walk.config.ts
//   SMOKE_LIVE=1 npx playwright test -c playwright.walk.config.ts -g "persona admin"
//
// ⚠️ Перед обходом — замер памяти стенда, после каждого блока персон — снова:
// у выросшего `next dev` обход падает САМ, и такое падение читается как дефект
// кода (см. CLAUDE.md § «Стенд»).
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { defineConfig, devices } from '@playwright/test'

if (process.env.SMOKE_PASSWORD === undefined) {
  try {
    process.env.SMOKE_PASSWORD = fs
      .readFileSync(path.join(os.homedir(), '.config', 'vaps', 'stand-admin-password'), 'utf8')
      .trim()
  } catch {
    // Файла нет — пусть падает сам спек с внятным текстом (stand-credentials.ts).
  }
}

export default defineConfig({
  testDir: path.join(__dirname, 'e2e'),
  // Уборка та же, что у целевых проб: обход тоже заводит пробные ОМ.
  globalTeardown: path.join(__dirname, 'e2e', 'global-teardown.ts'),
  testMatch: ['smoke-buttons.spec.ts'],
  // Один воркер: обход меняет состояние живого стенда, и параллельные персоны
  // видели бы правки друг друга.
  workers: 1,
  // ОДИН ПОВТОР — против перезапуска стенда, а не против дефектов (полный
  // прогон 26.08.2026). Обход длиннее часа, за это время `next dev` упирается
  // в потолок памяти, сторож его перезапускает, и пробы, попавшие в окно
  // перезапуска, падают с `ECONNREFUSED 127.0.0.1:3106` — это факт о стенде, а
  // не находка о портале. Проверено: маршруты, упавшие так в блоке, поодиночке
  // проходят за 33-44 секунды.
  //
  // Настоящая находка переживает повтор: она падает оба раза. Больше одного
  // повтора не ставим — тогда мигающая проба стала бы зелёной и молчала.
  retries: 1,
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
