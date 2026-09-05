// Конфиг ЦЕЛЕВЫХ проб по живому стенду. Штатного playwright.config.ts у этого
// фронта нет вовсе: живой стенд нужен не всякой будущей спеке, и общий конфиг
// «на будущее» навязал бы его всем.
//
// ОБХОДА КНОПОК ЗДЕСЬ БОЛЬШЕ НЕТ (Plane №94). `smoke-buttons.spec.ts` уехал в
// свой `playwright.walk.config.ts`, и вот почему: обход идёт больше часа и
// ходит по всему порталу пятью персонами, а сторож памяти перезапускает стенд
// посреди такого прогона — 26.08.2026 обход упал на 15-й пробе из 132 и унёс с
// собой ВСЕ целевые пробы, которые стояли в очереди за ним. Замер того же дня:
// за 2400 секунд обход успевает 67 проб, отдельные маршруты стоят по 2,8-2,9
// минуты. Смешивать часовую диагностику с пробами, которые проверяют правку
// прямо сейчас, — значит платить час за каждый ответ «сломал я что-то или
// нет».
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
import fs from 'node:fs'
import os from 'node:os'
import { defineConfig, devices } from '@playwright/test'

// Пароль стенда — из файла вне репозитория (`~/.config/vaps/stand-admin-password`,
// права 600). В спеках литерала пароля больше нет: до 24.08.2026 `admin123` был
// вписан в 30 файлов, и смена пароля означала правку каждого.
// Пароль ролевых учёток (`manage.py seed_role_accounts`) — оттуда же и по той
// же причине: проба отказа по правам заходит НЕ администратором.
if (process.env.ROLE_ACCOUNTS_PASSWORD === undefined) {
  try {
    process.env.ROLE_ACCOUNTS_PASSWORD = fs
      .readFileSync(path.join(os.homedir(), '.config', 'vaps', 'role-accounts-password'), 'utf8')
      .trim()
  } catch {
    // Файла нет — проба скипнется с внятной причиной, а не упадёт на входе.
  }
}

// Пароль семи учёток матрицы доступа (`acc_*`) — оттуда же
// (`~/.config/vaps/access-matrix-password`, права 600). До 02.09.2026 файла не
// было вовсе, и проба `access-matrix-menu` молча скипалась КАЖДЫЙ прогон: в
// итогах она читалась как «1 skipped», то есть матрица доступа заказчика не
// проверялась ничем. Пароль задан единым для семи учёток; сами учётки заводит
// `seed_access_matrix`.
if (process.env.ACCESS_MATRIX_PASSWORD === undefined) {
  try {
    process.env.ACCESS_MATRIX_PASSWORD = fs
      .readFileSync(path.join(os.homedir(), '.config', 'vaps', 'access-matrix-password'), 'utf8')
      .trim()
  } catch {
    // Файла нет — проба скипнется с внятной причиной, а не упадёт на входе.
  }
}

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
  // Уборка стенда после прогона: пробные ОМ снимаются с реестра (Plane №62).
  // Здесь, а не в `afterAll` каждого спека, — см. шапку файла уборки.
  globalTeardown: path.join(__dirname, 'e2e', 'global-teardown.ts'),
  // Обход и точечные пробы по живому стенду перечислены явно: `**/*.spec.ts`
  // затянул бы сюда любую будущую спеку, которой живой стенд не нужен, и она
  // падала бы у всех, кто его не поднял.
  testMatch: ['objects-tabs.spec.ts', 'gvo-sections.spec.ts', 'protected-persons.spec.ts', 'legal-documents.spec.ts', 'vehicles-registry.spec.ts', 'placement-stage.spec.ts', 'closure-stage.spec.ts', 'visit-object-close.spec.ts', 'conduct-evaluations.spec.ts', 'acknowledgement-stage.spec.ts', 'approval-stage.spec.ts', 'recon-stage.spec.ts', 'bulletin-stage.spec.ts', 'command-center.spec.ts', 'stage-chain.spec.ts', 'stage-override.spec.ts', 'events-registry.spec.ts', 'operations-analytics.spec.ts', 'service-analytics.spec.ts', 'my-profile.spec.ts', 'object-passport.spec.ts', 'forms-validation.spec.ts', 'tables-data.spec.ts', 'org-structure-status.spec.ts', 'org-structure-view.spec.ts', 'prototype-skin.spec.ts', 'dashboard-metrics.spec.ts', 'lagging-reminders.spec.ts', 'forces-gathering.spec.ts', 'daily-expense.spec.ts', 'day-submission.spec.ts', 'hydration.spec.ts', 'auth-logout.spec.ts', 'mock-contract.spec.ts', 'access-permissions.spec.ts', 'access-roles.spec.ts', 'access-users.spec.ts', 'access-accounts.spec.ts', 'change-password.spec.ts', 'employee-status-actions.spec.ts', 'status-set-dialog.spec.ts', 'department-requests.spec.ts', 'force-collections.spec.ts', 'module-tabs.spec.ts', 'status-calendar.spec.ts', 'status-vacancy-actions.spec.ts', 'status-dialog-calendar-locale.spec.ts', 'status-event-link.spec.ts', 'allocation-due-at.spec.ts', 'route-map-coverage.spec.ts', 'ru-plural.spec.ts', 'notifications-feed.spec.ts', 'session-refresh.spec.ts', 'directorate-denial.spec.ts', 'reports-strength-path.spec.ts', 'expense-section-role.spec.ts', 'dashboard-unlinked-account.spec.ts', 'session-fetch-storm.spec.ts', 'status-catalog-source.spec.ts', 'status-catalog-label.spec.ts', 'status-portal-participation.spec.ts', 'access-matrix-menu.spec.ts', 'status-types-dictionary.spec.ts', 'menu-access.spec.ts', 'identity-without-portal-role.spec.ts', 'access-multi-role.spec.ts', 'table-column-headers.spec.ts', 'forces-batch-requests.spec.ts', 'employees-read-access.spec.ts', 'approval-rights.spec.ts', 'in-development-badge.spec.ts', 'staff-rights.spec.ts', 'ui-access-rule.spec.ts', 'bulletin-issues.spec.ts', 'placement-pool.spec.ts', 'approval-print.spec.ts', 'approval-route.spec.ts', 'approval-return.spec.ts', 'visit-page.spec.ts', 'geo-dictionaries.spec.ts', 'create-event-required.spec.ts', 'forces-request-banner-from-menu.spec.ts'],
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
