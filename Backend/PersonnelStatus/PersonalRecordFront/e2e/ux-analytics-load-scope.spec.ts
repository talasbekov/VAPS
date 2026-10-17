import { test, expect, signIn } from './ux-fixture';

test('aggregate load stays useful when personal detail is restricted', async ({ page, businessWrites }) => {
  const day = '2026-10-16';
  const permissions = ['analytics.view'];
  const envelope = { snapshotId: 'scope-load-test', businessDate: day, timezone: 'Asia/Qyzylorda',
    period: { from: day, to: day, presetCode: 'TODAY' }, scope: { scopeType: 'DIVISION_SUBTREE', scopeId: 'divisions:test', safeLabel: 'Доступные подразделения' },
    generatedAt: day + 'T10:00:00+05:00', sourceUpdatedAt: null, sourceWatermark: null, freshnessState: 'CURRENT', completenessState: 'COMPLETE', calculationVersion: '1', policyVersion: '1' };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions, global_permissions: permissions } }));
  await page.route('**/api/ops/service-analytics-presets/**', route => route.fulfill({ json: { defaultPresetCode: 'TODAY', results: [{ presetCode: 'TODAY', safeLabel: 'Сегодня', offsetDays: 0, lengthDays: 1 }], maxCustomPeriodDays: null, limitPolicyVersion: null, customPeriodUnavailableReason: null } }));
  await page.route('**/api/ops/service-analytics/**', route => route.fulfill({ json: { ...envelope, data: { metrics: [], unavailableMetrics: [] }, unavailableHeaderBlocks: [], drilldownAllowed: false, drilldownDeniedReason: null } }));
  await page.route('**/api/ops/service-analytics-attention/**', route => route.fulfill({ json: { ...envelope, data: { items: [], detectionState: 'COMPLETE', detectionUnavailableReason: null, unavailableDetectors: [] } } }));
  const reason = 'Персональная нагрузка скрыта: нет отдельного права в выбранных подразделениях.';
  await page.route('**/api/ops/load-analytics/**', route => route.fulfill({ json: { businessDate: day, generatedAt: envelope.generatedAt, unavailable: [], view: {
    units: [{ employeeId: null, safeLabel: 'Учебное управление', organizationUnitId: '9007199254740993', plannedMinutes: 480, actualMinutes: 120, nightMinutes: null, loadState: 'NORMAL', safeReasonCodes: [], policyVersion: '1' }],
    employees: [], unlinkedShiftsCount: 0, policy: { periodDays: 7, policyVersion: '1', warningMinutes: 2400, overloadMinutes: 3600 }, personalDetailSuppressed: true, personalDetailReason: reason,
  } } }));
  await signIn(page);
  await page.goto('/security-ops/analytics/');
  const load = page.getByRole('region', { name: 'Нагрузка', exact: true });
  await expect(load.getByText('Учебное управление', { exact: true })).toBeVisible();
  await expect(load.getByText('8 ч', { exact: true })).toBeVisible();
  await expect(load.getByText(reason, { exact: true })).toBeVisible();
  await expect(load.getByRole('table', { name: 'По сотрудникам', exact: true })).toHaveCount(0);
  await expect(load.getByText('Смен в окне расчёта нет.', { exact: true })).toHaveCount(0);
  const sources = page.getByRole('region', { name: 'Источники показателей', exact: true });
  await expect(sources).toContainText('Смены, конфликты и часы — по месячному плану дежурств.');
  await expect(sources.getByRole('link', { name: 'Открыть состав на сегодня', exact: true })).toHaveAttribute('href', '/security-ops/duty-register/?date=2026-10-16&section=roster');
  await expect(sources.getByRole('link', { name: 'Журнал за выбранный период', exact: true })).toHaveAttribute('href', '/security-ops/duty-register/?from=2026-10-16&to=2026-10-16&section=records');
  expect(businessWrites).toEqual([]);
});
