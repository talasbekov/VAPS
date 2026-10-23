import { test, expect, signIn } from './ux-fixture';
import type { Page } from '@playwright/test';

const date = '2026-10-20';
const now = date + 'T10:00:00+05:00';
const key = 'STATUS:9007199254740993:' + 'ab'.repeat(32);
const employee = 'Контрольный сотрудник';

async function setup(page: Page) {
  const state = { phase: 'PLANNED', status: 200, writes: [] as string[] };
  const record = () => ({
    id: key, source: 'STATUS', source_id: '9007199254740993', employee_id: 6161, employee_name: employee,
    division_id: 2, division_name: 'Контрольный департамент', service_duty_code: 'POST', service_duty_label: 'Постовое дежурство',
    business_date: date, state: state.phase, planned_start: date + 'T09:00:00+05:00', planned_end: date + 'T11:00:00+05:00',
    planned_minutes: 120, period_planned_minutes: 120, acknowledged_at: state.phase === 'PLANNED' ? null : date + 'T08:30:00+05:00',
    actual_start: state.phase === 'ACTIVE' ? now : null, actual_end: null, actual_minutes: null, period_actual_minutes: null,
    location_label: 'Контрольный объект · Пост А', document_basis: '', note: '', created_at: '2026-10-19T12:00:00+05:00', updated_at: now,
    generated_at: now, revision: null, attention_codes: state.phase === 'ACTIVE' ? ['LATE_START'] : ['MISSING_START'],
    needs_attention: true, actions: state.phase === 'PLANNED' ? ['acknowledge', 'classify'] : state.phase === 'ACKNOWLEDGED' ? ['start', 'classify'] : ['complete', 'classify'],
    execution_mode: 'RECORDED_TIME', time_zone: 'Asia/Almaty', history: [],
  });
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['duty.view', 'duty.dispatch', 'status.view', 'service_summary.view'], global_permissions: ['duty.view', 'duty.dispatch', 'status.view', 'service_summary.view'],
    roles: [{ code: 'DUTY_OFFICER', name: 'Оперативный дежурный', scope_division_id: null, scope_division_name: null }],
  } }));
  await page.route('**/api/operations/service-summary-context/**', route => route.fulfill({ json: { root_division_id: 690, root_name: 'Контрольная организация', can_generate_root_summary: false } }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: '2026-10-21', blocked: false, overridden: false, laggards: [] } }));
  await page.route('**/api/ops/duty-register/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'POST') {
      const operation = url.pathname.endsWith('/acknowledge/') ? 'acknowledge' : url.pathname.endsWith('/start/') ? 'start' : 'unexpected';
      state.writes.push(operation);
      if (operation === 'acknowledge') state.phase = 'ACKNOWLEDGED';
      else if (operation === 'start') state.phase = 'ACTIVE';
      return route.fulfill({ json: record() });
    }
    if (url.pathname.endsWith('/kinds/')) return route.fulfill({ json: { results: [{ code: 'POST', label: 'Постовое дежурство', label_kk: '', description: '', is_active: true }] } });
    if (state.status !== 200) return route.fulfill({ status: state.status, json: { error_code: 'FORBIDDEN', message: 'Нет доступа' } });
    if (url.pathname.endsWith('/roster/')) return route.fulfill({ json: {
      business_date: date, generated_at: now, time_zone: 'Asia/Almaty', combat_groups: [],
      departments: [{ id: 2, name: 'Контрольный департамент', employees: [{
        employee_id: '6161', full_name: employee, position_name: 'Сотрудник', status_label: 'На дежурстве',
        date_start: date, date_end: date, destination: '', placements: [{ source: 'STATUS', source_id: '9007199254740993',
          label: 'Контрольный объект · Пост А', record_id: null, start_at: null, end_at: null,
          intervals: [{ start_at: date + 'T09:00:00+05:00', end_at: date + 'T11:00:00+05:00' }] }],
      }] }],
    } });
    if (url.pathname !== '/api/ops/duty-register/') return route.fulfill({ json: record() });
    const rows = url.searchParams.get('state') === 'ACTIVE' && state.phase !== 'ACTIVE' ? [] : [record()];
    return route.fulfill({ json: {
      rows, period: { from: date, to: date }, generated_at: now, time_zone: 'Asia/Almaty',
      control: { assigned: 1, acknowledged: state.phase === 'PLANNED' ? 0 : 1, started: state.phase === 'ACTIVE' ? 1 : 0,
        missing_start: state.phase === 'ACTIVE' ? 0 : 1, late_start: state.phase === 'ACTIVE' ? 1 : 0, missing_end: 0 },
      summary: { record_count: rows.length, employee_count: rows.length, completed_count: 0, active_count: state.phase === 'ACTIVE' ? 1 : 0, cancelled_count: 0,
        unconfirmed_count: state.phase === 'PLANNED' ? 1 : 0, attention_count: rows.length, overlap_count: 0, missing_kind_count: 0,
        unknown_planned_count: 0, unknown_actual_count: 0, confirmed_actual_count: 0, planned_minutes: 120, actual_record_minutes: 0, actual_minutes: 0 },
      by_kind: [], by_employee: [], filters: { divisions: [{ id: 2, name: 'Контрольный департамент' }], employees: [{ employee_id: 6161, employee_name: employee }] },
      pagination: { count: rows.length, page: 1, pages: 1, page_size: 25 },
    } });
  });
  return state;
}

test('each STATUS exit opens its own record and acknowledgement never marks actual start', async ({ page, businessWrites }) => {
  const state = await setup(page);
  await signIn(page); await page.goto('/security-ops/duty-register/?from=' + date + '&to=' + date);
  const list = page.getByRole('list', { name: 'Этапы исполнения', exact: true });
  await expect(list.getByRole('listitem').nth(1)).toContainText('Не отмечено');
  await expect(list.getByRole('listitem').nth(2)).toContainText('Не отмечено');
  await page.getByRole('button', { name: 'Открыть запись: ' + employee, exact: true }).click();
  await expect(page).toHaveURL(new RegExp('record=STATUS'));
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('list', { name: 'Этапы исполнения' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await dialog.getByRole('button', { name: 'Сохранить отметку', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Отметить начало', exact: true })).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Этапы исполнения' }).getByRole('listitem').nth(2)).toContainText('Не отмечено');
  expect(state.writes).toEqual(['acknowledge']);
  await dialog.getByRole('button', { name: 'Отметить начало', exact: true }).click();
  await dialog.getByRole('button', { name: 'Сохранить отметку', exact: true }).click();
  await expect(dialog.getByRole('list', { name: 'Этапы исполнения' }).getByRole('listitem').nth(2)).toContainText('10:00');
  expect(state.writes).toEqual(['acknowledge', 'start']);
  expect(businessWrites).toEqual([]);
});

test('composition opens that employee exits for the selected day without stale control filters', async ({ page, businessWrites }) => {
  await setup(page); await signIn(page);
  await page.goto('/security-ops/duty-register/?section=roster&date=' + date + '&state=CANCELLED&search=old&page=9');
  await page.getByRole('link', { name: 'Учёт выходов', exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get('section') === 'records');
  const query = new URL(page.url()).searchParams;
  expect(query.get('section')).toBe('records'); expect(query.get('source')).toBe('STATUS');
  expect(query.get('employee_id')).toBe('6161'); expect(query.get('from')).toBe(date); expect(query.get('to')).toBe(date);
  expect(query.has('state')).toBe(false); expect(query.has('search')).toBe(false); expect(query.has('page')).toBe(false);
  await expect(page.getByRole('button', { name: 'Открыть запись: ' + employee, exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

for (const width of [1440, 320]) test('duty officer starts with today control and current shifts at ' + width + 'px', async ({ page, businessWrites }, testInfo) => {
  const state = await setup(page); state.phase = 'ACTIVE';
  await page.setViewportSize({ width, height: 1000 });
  await signIn(page); await page.goto('/');
  await expect(page).toHaveURL(/\/security-ops\/service-summary\/?$/);
  const control = page.getByRole('region').filter({ has: page.getByRole('heading', { name: 'Контроль дежурств на сегодня', exact: true }) }).last();
  await expect(control).toContainText('20.10.2026');
  await expect(control).toContainText('Назначено выходов');
  await expect(control).toContainText('Отмечено ознакомление');
  await expect(control).toContainText('Отмечено заступление');
  await expect(control).toContainText(employee);
  await expect(control.getByRole('link', { name: /Заступили позже плана/ })).toHaveAttribute('href', /from=2026-10-20&to=2026-10-20&attention=LATE_START/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(businessWrites).toEqual([]);
  await control.screenshot({ path: testInfo.outputPath('today-control.png') });
});

test('a denied control read hides all cached counts and current personal details until a successful retry', async ({ page, businessWrites }) => {
  const state = await setup(page); state.phase = 'ACTIVE';
  await signIn(page); await page.goto('/security-ops/service-summary/');
  const control = page.getByRole('region').filter({ has: page.getByRole('heading', { name: 'Контроль дежурств на сегодня', exact: true }) }).last();
  await expect(control).toContainText(employee);
  state.status = 403;
  await control.getByRole('button', { name: 'Обновить дежурства', exact: true }).click();
  await expect(control.getByRole('alert')).toBeVisible();
  await expect(control).not.toContainText(employee);
  await expect(control).not.toContainText('Назначено выходов');
  state.status = 200;
  await control.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(control).toContainText(employee);
  expect(businessWrites).toEqual([]);
});
