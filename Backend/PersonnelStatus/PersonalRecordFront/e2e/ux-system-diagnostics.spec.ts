import { test as base, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';
import type { Diagnostics } from '@/features/system-diagnostics/model';

// The dependency activates the existing unexpected-business-write blocker.
const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: async ({ page, businessWrites: _businessWrites }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors).toEqual([]);
  },
});

function snapshot(): Diagnostics {
  return {
    checked_at: '2026-10-27T08:00:00Z', time_zone: 'Asia/Qyzylorda',
    database: { state: 'available', last_recorded_migration: '0154_assistant_credential_format', migration_recorded_at: '2026-10-27T07:00:00Z' },
    ai: { state: 'configured', provider: 'openai', model: 'fixture-model-old', updated_at: '2026-10-27T07:00:00Z',
      connectivity: 'not_checked', last_check: null },
    ai_queue: { scope: 'visible_tasks', snapshot: 'sequential_reads', observed_at: '2026-10-27T08:00:00Z',
      worker_connection: 'not_checked', counts: { queued: 2, running: 1, failed: 3 }, lease_seconds: 180,
      latest_task_update_at: null,
      pending: { inspected: 3, total: 6, limit: 1000, truncated: true, stale_queued: 1, stale_running: 0,
        invalid_timestamps: 1, future_timestamps: 1, oldest_queued_at: '2026-10-27T07:55:00Z', oldest_started_at: null } },
    digital_twin: { state: 'unknown', last_success_at: null, acknowledgement: 'not_recorded',
      catalog_import: { state: 'recorded', recorded_at: '2026-10-27T06:00:00Z', export_id: 'fixture-catalog-27', bundle_sha256: 'b'.repeat(64) } },
    release: { state: 'declared', revision: 'a'.repeat(40), installation_verified: false },
  };
}

async function prepare(page: Page, permissions = ['settings.view', 'settings.manage'], globalPermissions = permissions) {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const state = { data: snapshot(), permissions, globalPermissions, reads: 0, permissionReads: 0, status: 200, hold: false, release };
  await page.routeWebSocket('**/ws/**', () => {});
  await page.route('**/api/**', route => {
    if (new URL(route.request().url()).pathname.startsWith('/api/auth/')) return route.fallback();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.fallback();
    return route.fulfill({ json: { results: [], count: 0 } });
  });
  await page.route('**/api/operations/my-permissions/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    state.permissionReads++;
    return route.fulfill({ json: { permissions: state.permissions, global_permissions: state.globalPermissions, roles: [] } });
  });
  await page.route('**/api/ops/settings/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { results: [], sectionVersions: {} } });
  });
  await page.route('**/api/ops/system-diagnostics/**', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    state.reads++;
    if (state.hold) await waiting;
    return route.fulfill({ status: state.status,
      json: state.status === 200 ? state.data : { error_code: 'DIAGNOSTICS_UNAVAILABLE', message: 'Учебный отказ диагностики', details: {} } });
  });
  await signIn(page);
  await page.goto('/settings/');
  await expect(page.getByRole('heading', { name: 'Администрирование', exact: true })).toBeVisible();
  const panel = page.locator('details').filter({ has: page.getByText('Состояние системы', { exact: true }) });
  return { state, panel };
}

for (const width of [320, 1440]) test(`diagnostics reads on demand and qualifies every integration claim at ${width}px`, async ({ page, browserErrors: _browserErrors }) => {
  await page.setViewportSize({ width, height: 1000 });
  const { state, panel } = await prepare(page);
  await expect(page.getByText('Состояние системы', { exact: true })).toBeVisible();
  expect(state.reads).toBe(0);
  await page.getByText('Состояние системы', { exact: true }).click();
  await expect(panel).toContainText('Настроена модель: fixture-model-old.');
  await expect(panel).toContainText('В очереди: 2');
  await expect(panel).toContainText('Обрабатываются: 1');
  await expect(panel).toContainText('С ошибкой: 3');
  await expect(panel).toContainText('Чужие личные поручения не учитываются');
  await expect(panel).toContainText('нижняя граница');
  await expect(panel).toContainText('Некорректное или отсутствующее время: 1');
  await expect(panel).toContainText('Время в будущем: 1');
  await expect(panel).toContainText('Пустая очередь не подтверждает его работу');
  await expect(panel).toContainText('Актуальность данных двойника неизвестна');
  await expect(panel).toContainText('fixture-catalog-27');
  await expect(panel).toContainText('Импорт каталога в Smart');
  await expect(panel).toContainText('Эта квитанция не подтверждает получение данных двойником');
  await expect(panel).toContainText('В приложении нет подтверждения последней проверенной копии');
  await panel.getByText('Версия и обслуживание', { exact: true }).click();
  await expect(panel).toContainText('Это не подтверждение успешной установки');
  await expect(panel.getByRole('link', { name: 'Проверить подключение ИИ', exact: true })).toHaveAttribute('href', '/settings/ai/');
  expect(state.reads).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

for (const match of ['draft', 'previous', 'current'] as const) test(`diagnostics labels the ${match} probe without claiming current connectivity`, async ({ page, browserErrors: _browserErrors }) => {
  const { state, panel } = await prepare(page);
  state.data.ai.last_check = { checked_at: '2026-10-27T07:30:00Z', succeeded: match !== 'current',
    provider: 'openai', model: 'checked-fixture-model', configuration_match: match };
  await page.getByText('Состояние системы', { exact: true }).click();
  const label = match === 'draft' ? 'Проверен черновик' : match === 'previous' ? 'Проверены прежние настройки' : 'Проверены текущие сохранённые настройки';
  await expect(panel).toContainText(label);
  await expect(panel).toContainText('checked-fixture-model');
  await expect(panel).toContainText('Этот результат не подтверждает доступность сейчас');
  await expect(panel).toContainText(match === 'current' ? 'Проверка завершилась ошибкой' : 'Модель вернула корректный ответ при проверке');
  expect(state.reads).toBe(1);
});

test('diagnostics hides the previous snapshot during refresh and failure, then shows a fresh result', async ({ page, browserErrors: _browserErrors }) => {
  const { state, panel } = await prepare(page);
  await page.getByText('Состояние системы', { exact: true }).click();
  await expect(panel).toContainText('Настроена модель: fixture-model-old.');
  state.hold = true;
  await panel.getByRole('button', { name: 'Обновить состояние системы', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Получаем сведения с сервера');
  await expect(panel.getByText('Настроена модель: fixture-model-old.', { exact: true })).toHaveCount(0);
  state.status = 503;
  state.hold = false;
  state.release();
  await expect(panel.getByRole('alert')).toContainText('Прежний результат скрыт');
  await expect(panel.getByText('Настроена модель: fixture-model-old.', { exact: true })).toHaveCount(0);
  state.status = 200;
  state.data.ai.model = 'fixture-model-new';
  await panel.getByRole('button', { name: 'Обновить состояние системы', exact: true }).click();
  await expect(panel).toContainText('Настроена модель: fixture-model-new.');
});

test('department-scoped settings permission does not expose global diagnostics or fetch its snapshot', async ({ page, browserErrors: _browserErrors }) => {
  const { state, panel } = await prepare(page, ['settings.view', 'settings.manage'], ['settings.view']);
  await expect(page.getByText('версия не задана', { exact: true }).first()).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Подключение ИИ', exact: true })).toHaveCount(0);
  expect(state.reads).toBe(0);
});

test('a denied diagnostics refresh cannot reveal its cached previous snapshot', async ({ page, browserErrors: _browserErrors }) => {
  const { state, panel } = await prepare(page);
  await page.getByText('Состояние системы', { exact: true }).click();
  await expect(panel).toContainText('Настроена модель: fixture-model-old.');
  state.status = 403;
  await panel.getByRole('button', { name: 'Обновить состояние системы', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Прежний результат скрыт');
  await expect(panel.getByText('Настроена модель: fixture-model-old.', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('В очереди: 2', { exact: true })).toHaveCount(0);
});

test('revoking global administration removes the warmed diagnostics and stops its reads', async ({ page, browserErrors: _browserErrors }) => {
  const { state, panel } = await prepare(page);
  await page.getByText('Состояние системы', { exact: true }).click();
  await expect(panel).toContainText('Настроена модель: fixture-model-old.');
  await page.waitForLoadState('networkidle');
  // Keep the scoped manage grant: only global administration is revoked.
  state.globalPermissions = ['settings.view'];
  const permissionReads = state.permissionReads;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => state.permissionReads).toBeGreaterThan(permissionReads);
  await expect(panel).toHaveCount(0);
  // The first focus may also refresh diagnostics using the still-current grant.
  // Assert future reads only after the revoked authority has been processed.
  await page.waitForLoadState('networkidle');
  const diagnosticReads = state.reads, nextPermissionReads = state.permissionReads;
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => state.permissionReads).toBeGreaterThan(nextPermissionReads);
  await expect(panel).toHaveCount(0);
  expect(state.reads).toBe(diagnosticReads);
});
