import { test, expect, signIn } from '../../../PersonnelStatus/PersonalRecordFront/e2e/ux-fixture';

test('an unsent duty draft survives a transient permission failure and successful retry', async ({ page, businessWrites }) => {
  const endpoint = '/api/ops/duty-register/';
  const draftNote = 'AUDIT_UNSENT_DUTY_DRAFT';
  let failPermissions = false;
  let permissionFailures = 0;
  await page.route('**/api/operations/my-permissions/**', route => {
    if (failPermissions) {
      permissionFailures++;
      return route.fulfill({ status: 503, json: { message: 'Audit: temporary permission service failure' } });
    }
    return route.fulfill({ json: {
      permissions: ['duty.view', 'duty.manage'], global_permissions: ['duty.view', 'duty.manage'], roles: [],
    } });
  });
  await page.route('**/api/ops/duty-register/**', route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === endpoint + 'kinds/') return route.fulfill({ json: { results: [
      { code: 'GBR', label: 'ГБР', label_kk: '', description: '', is_active: true },
    ] } });
    if (pathname === endpoint + 'choices/') return route.fulfill({ json: { results: [
      { employee_id: 7, employee_name: 'Audit duty employee', division_id: 4, division_name: 'Audit division', position_name: 'Сотрудник' },
    ], count: 1, page: 1, page_size: 25 } });
    if (pathname !== endpoint) return route.fallback();
    return route.fulfill({ json: {
      period: { from: '2026-10-15', to: '2026-10-15' }, generated_at: '2026-10-15T14:00:00+05:00', time_zone: 'Asia/Qyzylorda',
      rows: [], by_kind: [], by_employee: [], filters: { divisions: [], employees: [] },
      pagination: { count: 0, page: 1, pages: 1, page_size: 25 },
      summary: { record_count: 0, employee_count: 0, completed_count: 0, active_count: 0, cancelled_count: 0,
        unconfirmed_count: 0, attention_count: 0, overlap_count: 0, missing_kind_count: 0, unknown_planned_count: 0,
        unknown_actual_count: 0, confirmed_actual_count: 0, planned_minutes: 0, actual_record_minutes: 0, actual_minutes: 0 },
    } });
  });
  await signIn(page);
  await page.goto('/security-ops/duty-register/?from=2026-10-15&to=2026-10-15');
  await page.getByRole('button', { name: 'Добавить запись', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новая запись дежурства', exact: true });
  // getByLabel(exact) includes React textarea textContent after a fill.
  // The textbox's accessible name remains the visible field name.
  const noteField = dialog.getByRole('textbox', { name: 'Примечание', exact: true });
  await dialog.getByRole('button', { name: /Audit duty employee/ }).click();
  await dialog.getByRole('combobox', { name: 'Вид дежурства', exact: true }).selectOption('GBR');
  await dialog.getByLabel('Плановое начало', { exact: true }).fill('2026-10-15T08:00');
  await dialog.getByLabel('Плановое завершение', { exact: true }).fill('2026-10-15T20:00');
  await noteField.fill(draftNote);
  await expect(noteField).toHaveValue(draftNote);

  const permissionDenial = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/operations/my-permissions/' && response.status() === 503);
  failPermissions = true;
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await permissionDenial;
  await expect(page.getByRole('heading', { name: 'Не удалось проверить права доступа', exact: true })).toBeVisible();
  expect(permissionFailures).toBeGreaterThan(0);
  failPermissions = false;
  const permissionRecovery = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/operations/my-permissions/' && response.status() === 200);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await permissionRecovery;
  await expect(page.getByRole('heading', { name: 'Журнал дежурств', exact: true })).toBeVisible();
  // A recovered editor may reopen itself or offer its retained draft on demand.
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Добавить запись', exact: true }).click();
  const restoredNote = dialog.getByRole('textbox', { name: 'Примечание', exact: true });
  await expect(restoredNote).toBeVisible();
  expect(businessWrites).toEqual([]);
  await test.info().attach('duty-draft-recovery-context', {
    body: JSON.stringify({ permissionFailures, noteAfterRecovery: await restoredNote.inputValue() }),
    contentType: 'application/json',
  });
  await expect(restoredNote, 'A transient permission outage must preserve the unsent draft after access recovers').toHaveValue(draftNote);
});
