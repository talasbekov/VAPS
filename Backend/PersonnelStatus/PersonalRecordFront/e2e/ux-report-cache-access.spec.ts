import { test, expect, signIn } from './ux-fixture';
import type { ListReportJobsResponse } from '@/entities/service-report';

for (const denialStatus of [401, 403, 404]) test(`report ${denialStatus} clears visible parameters and a 503 retry cannot restore the denied cache`, async ({ page, businessWrites }) => {
  const endpoint = '/api/ops/service-report-jobs/';
  const marker = 'PRIVATE_REPORT_CACHE_REGRESSION';
  let jobStatus = 200;
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['report.generate'], global_permissions: ['report.generate'], roles: [],
  } }));
  await page.route(url => url.pathname === endpoint, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (jobStatus !== 200) return route.fulfill({ status: jobStatus, json: { detail: 'Report read rejected' } });
    return route.fulfill({ json: {
      results: [{ reportJobId: 'private-regression-job', reportTypeCode: marker, format: 'CSV',
        state: 'PROCESSING', progressPercent: 25, createdAt: '2026-10-15T08:00:00+05:00',
        createdBy: { userId: 'regression-user', safeLabel: 'Synthetic report owner' }, completedAt: null,
        failureCode: null, safeFailureMessage: null, artifactId: null, idempotencyKey: 'memory-only-regression',
        sensitive: false, parameters: { from: '2026-10-01', to: '2026-10-07' }, parametersRedactedReason: null }],
      artifacts: [], actions: [], unavailableColumns: [], totalVisible: 1,
      serverTime: '2026-10-15T08:00:00+05:00',
    } satisfies ListReportJobsResponse });
  });
  await signIn(page);
  await page.goto('/security-ops/service-reports/history/');
  const row = page.getByRole('row').filter({ hasText: marker });
  await expect(row).toBeVisible();
  await expect(row).toContainText('2026-10-01 — 2026-10-07');
  const response = (status: number) => page.waitForResponse(reply => new URL(reply.url()).pathname === endpoint && reply.status() === status);
  jobStatus = denialStatus;
  const denied = response(denialStatus);
  await denied;
  await expect(row).toHaveCount(0);
  jobStatus = 503;
  const failed = response(503);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await failed;
  await expect(row).toHaveCount(0);
  jobStatus = 200;
  const restored = response(200);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await restored;
  await expect(row).toBeVisible();
  expect(businessWrites).toEqual([]);
});
