import { test, expect, signIn } from '../../../PersonnelStatus/PersonalRecordFront/e2e/ux-fixture';
import type { ListReportJobsResponse } from '../../../PersonnelStatus/PersonalRecordFront/entities/service-report';

test('a denied service-report refresh removes previously readable job parameters', async ({ page, businessWrites }) => {
  const endpoint = '/api/ops/service-report-jobs/';
  const permission = 'report.generate';
  const marker = 'AUDIT_PRIVATE_REPORT';
  let denyJobs = false;
  let deniedReads = 0;
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: [permission], global_permissions: [permission], roles: [],
  } }));
  await page.route(url => url.pathname === endpoint, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (denyJobs) {
      deniedReads++;
      return route.fulfill({ status: 403, json: { error_code: 'PERMISSION_DENIED', message: 'Audit: report access was revoked' } });
    }
    return route.fulfill({ json: {
      results: [{ reportJobId: 'audit-private-job', reportTypeCode: marker, format: 'CSV',
        state: 'PROCESSING', progressPercent: 25, createdAt: '2026-10-15T08:00:00+05:00',
        createdBy: { userId: 'audit-user', safeLabel: 'Audit report owner' }, completedAt: null,
        failureCode: null, safeFailureMessage: null, artifactId: null, idempotencyKey: 'audit-memory-only',
        sensitive: false, parameters: { from: '2026-10-01', to: '2026-10-07' }, parametersRedactedReason: null }],
      artifacts: [], actions: [], unavailableColumns: [], totalVisible: 1,
      serverTime: '2026-10-15T08:00:00+05:00',
    } satisfies ListReportJobsResponse });
  });
  await signIn(page);
  await page.goto('/security-ops/service-reports/history/');
  const privateRow = page.getByRole('row').filter({ hasText: marker });
  await expect(privateRow).toBeVisible();
  await expect(privateRow).toContainText('2026-10-01 — 2026-10-07');

  // PROCESSING jobs poll on their own. Only the jobs endpoint changes;
  // the frontend permission response remains successful and unchanged.
  const denial = page.waitForResponse(response => response.request().method() === 'GET' &&
    new URL(response.url()).pathname === endpoint && response.status() === 403);
  denyJobs = true;
  const deniedResponse = await denial;
  await expect.poll(() => deniedReads, { message: 'The jobs endpoint must actually return a denial' }).toBeGreaterThan(0);
  expect(businessWrites).toEqual([]);
  await test.info().attach('denied-report-context', {
    body: JSON.stringify({ permission, deniedReads, deniedStatus: deniedResponse.status(), visibleCachedRows: await privateRow.count() }),
    contentType: 'application/json',
  });
  await expect(privateRow, 'A confirmed 403 must hide the cached job and its private parameters').toHaveCount(0);
});
