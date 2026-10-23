import { test, expect, signIn } from './ux-fixture';
import type { Locator, Page } from '@playwright/test';

async function openPlans(page: Page, legacyDuty = false) {
  await page.clock.install({ time: new Date('2026-10-31T07:00:00Z') });
  const current = {
    id: 601, status_type: 'business_trip', status_type_display: 'В командировке',
    state: 'active', state_display: 'Действует', start_date: '2026-10-15',
    end_date: '2026-11-05', effective_end_date: '2026-11-05', comment: 'Учебный выезд',
  };
  const future = {
    id: 602, status_type: legacyDuty ? 'on_duty' : 'vacation', status_type_display: legacyDuty ? 'На дежурстве' : 'В отпуске',
    state: 'planned', state_display: 'Запланирован', start_date: '2026-11-20',
    end_date: '2026-11-25', effective_end_date: '2026-11-25', comment: 'Учебный отпуск',
  };
  const unit = {
    id: 10, index: 1, parent_id: null, vacancy: null,
    division: { id: 3, name: 'Учебное управление' }, directorate_id: 3, directorate_name: 'Учебное управление',
    position: { id: 1, name: 'Специалист', level: 1 },
    employee: { id: 1, last_name: 'Учебный', first_name: 'Сотрудник', middle_name: '02', current_status: current },
  };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'status.workspace', 'status.manage'],
    global_permissions: ['status.view', 'status.workspace', 'status.manage'], status_manage_division_ids: null, roles: [],
  } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => route.fulfill({ json: {
    division: null, staff_units: [unit], total_count: 1, matched_count: 1, page: 1, page_size: 50, has_next: false,
  } }));
  await page.route('**/api/statuses/statuses/planned/**', route => route.fulfill({ json: { current, planned: [future] } }));
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [
    { code: 'in_service', label: 'В строю', color: '' },
    { code: 'business_trip', label: 'В командировке', color: '' },
    { code: 'vacation', label: 'В отпуске', color: '' },
    { code: 'on_duty', label: 'На дежурстве', color: '' },
  ] }));
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { count: 2, next: null, results: [{
    code: 'IN_EVENT', name: 'Участие в ОМ', report_column_code: 'ready', priority: 1,
    counts_in_list: true, counts_in_staff: true, is_active: true, is_hard_block: false,
    restricts_editing: true, is_ku_owned: false, max_duration_days: null, color: '', legacy_code: null,
  }, {
    code: 'TRAINING', name: 'Учебная подготовка', report_column_code: 'study', priority: 2,
    counts_in_list: true, counts_in_staff: true, is_active: true, is_hard_block: false,
    restricts_editing: false, is_ku_owned: false, max_duration_days: null, color: '', legacy_code: null,
  }] } }));
  await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 2, next: null, previous: null, results: [{
    id: 603, employee_id: 1, status_type_code: 'IN_EVENT', state: 'PLANNED', source: 'OM_AUTO',
    date_start: '2026-11-28', date_end: '2026-11-30', comment: 'Учебное мероприятие',
    document_basis: '', cancelled_at: null, cancelled_reason: '',
    participations: [{ event_id: 77, kind_code: 'GROUP', role_code: 'MEMBER', event_code: 'УЧ-77', event_title: 'Учебный сбор' }],
  }, {
    id: 604, employee_id: 1, status_type_code: 'TRAINING', state: 'PLANNED', source: 'OM_AUTO',
    date_start: '2026-12-01', date_end: '2026-12-03', comment: 'Учебное назначение вне ОМ',
    document_basis: '', cancelled_at: null, cancelled_reason: '', participations: [],
  }] } }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: {
    business_date: '2026-11-01', blocked: false, laggards: [],
  } }));
  await signIn(page);
  await page.goto('/statuses/');
  await page.getByRole('button', { name: 'Действия: Учебный Сотрудник 02', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Запланированные статусы', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Запланированные статусы сотрудника', exact: true });
  await expect(dialog.getByText('Учебный выезд', { exact: false })).toBeVisible();
  return dialog;
}

async function expectInsideDialog(dialog: Locator, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  const bounds = await dialog.boundingBox();
  const button = await control.boundingBox();
  expect(bounds).not.toBeNull();
  expect(button).not.toBeNull();
  expect(button!.x).toBeGreaterThanOrEqual(bounds!.x);
  expect(button!.x + button!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
  expect(button!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(button!.y + button!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
}

test('current actions share the status row while future personnel and OM cards keep their own ownership', async ({ page, businessWrites }) => {
  const dialog = await openPlans(page);
  const badge = dialog.getByText('В командировке', { exact: true });
  const extend = dialog.getByRole('button', { name: 'Продлить', exact: true });
  const finish = dialog.getByRole('button', { name: 'Завершить досрочно', exact: true });
  for (const control of [extend, finish]) {
    await expect.poll(async () => {
      const [statusBounds, actionBounds] = await Promise.all([badge.boundingBox(), control.boundingBox()]);
      if (!statusBounds || !actionBounds) return Infinity;
      return Math.abs(actionBounds.y + actionBounds.height / 2 - statusBounds.y - statusBounds.height / 2);
    }, { message: 'Current status actions must remain alongside the current status on desktop' }).toBeLessThan(3);
  }
  const current = dialog.getByRole('article', { name: 'Текущий статус', exact: true });
  await expect(current.getByText('15.10.2026', { exact: true })).toBeVisible();
  await expect(current.getByText('05.11.2026', { exact: true })).toHaveCount(2);
  await expect(current.getByText('Фактическое окончание', { exact: true })).toBeVisible();
  const future = dialog.getByRole('article', { name: 'Запланированный статус: В отпуске', exact: true });
  const edit = future.getByRole('button', { name: 'Изменить запланированный статус: Запланирован', exact: true });
  await expect(edit).toHaveText('Изменить');
  await expect(edit).toHaveCSS('opacity', '1');
  await expect(future.getByText('Эффективная дата окончания', { exact: true })).toBeVisible();
  const om = dialog.getByRole('article', { name: 'Запланированный статус ОМ: Участие в ОМ', exact: true });
  await expect(om.getByText(/Только просмотр/)).toBeVisible();
  await expect(om.getByText(/разделе ОМ/)).toBeVisible();
  await expect(om.getByText('29.11.2026', { exact: true })).toBeVisible();
  await expect(om.getByRole('button')).toHaveCount(0);
  const sectionStatus = dialog.getByRole('article', { name: 'Запланированный статус раздела: Учебная подготовка', exact: true });
  await expect(sectionStatus.getByText(/Только просмотр/)).toBeVisible();
  await expect(sectionStatus.getByText(/разделе назначения/)).toBeVisible();
  await expect(sectionStatus.getByText(/разделе ОМ/)).toHaveCount(0);
  await expect(sectionStatus.getByRole('button')).toHaveCount(0);
  expect(businessWrites).toEqual([]);
});

test('a legacy planned duty without placement or hours keeps date and comment editing available', async ({ page, businessWrites }) => {
  const dialog = await openPlans(page, true);
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/statuses/statuses/602/**', route => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: 602 } });
  });
  const future = dialog.getByRole('article', { name: 'Запланированный статус: На дежурстве', exact: true });
  await future.getByRole('button', { name: 'Изменить запланированный статус: Запланирован', exact: true }).click();
  await expect(future.getByRole('note')).toContainText('Время выходов не указано.');
  await future.getByRole('textbox', { name: 'Комментарий', exact: true }).fill('Уточнён старый план');
  await future.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ employee: 1, status_type: 'on_duty', start_date: '2026-11-20', end_date: '2026-11-25', comment: 'Уточнён старый план' });
  expect(businessWrites).toEqual([]);
});

test.describe('completion follows civil dates when the browser timezone is behind the server', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  for (const width of [320, 390]) test(`early completion returns to service on the selected day with validation and reachable bottom actions at ${width}px`, async ({ page, businessWrites }) => {
    await page.setViewportSize({ width, height: 720 });
    const dialog = await openPlans(page);
    const submissions: { method: string; body: unknown }[] = [];
    let acceptWrite = false;
    await page.route('**/api/statuses/statuses/601/terminate/**', route => {
      submissions.push({ method: route.request().method(), body: route.request().postDataJSON() });
      return acceptWrite
        ? route.fulfill({ json: {
          id: 601, status_type: 'business_trip', status_type_display: 'В командировке',
          state: 'completed', state_display: 'Завершён', start_date: '2026-10-15', end_date: '2026-11-05',
          actual_end_date: '2026-10-31', effective_end_date: '2026-10-31', comment: 'Учебный выезд',
        } })
        : route.fulfill({ status: 400, json: { error: 'Учебный отказ: проверьте дату' } });
    });
    await dialog.getByRole('button', { name: 'Завершить досрочно', exact: true }).click();
    const current = dialog.getByRole('article', { name: 'Текущий статус', exact: true });
    await expect(current.getByLabel(/^Дата выхода в строй/)).toHaveAttribute('id', 'terminate-date');
    await expect(current.locator('#terminate-date')).toHaveAttribute('aria-required', 'true');
    const hint = current.locator('#terminate-date-hint');
    await expect(hint).toContainText('первый день');
    await expect(hint).toContainText('31.10.2026');
    await expect(hint).not.toContainText('01.11.2026');
    await expect(hint).toContainText('календарю сервера');
    const reason = current.getByRole('textbox', { name: /^Причина/ });
    await expect(reason).toHaveAttribute('required', '');
    const cancel = current.getByRole('button', { name: 'Отмена', exact: true });
    const confirm = current.getByRole('button', { name: 'Завершить', exact: true });
    await expectInsideDialog(dialog, cancel);
    await expectInsideDialog(dialog, confirm);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), 'The dialog must not clip controls horizontally').toBe(true);
    await confirm.click();
    await expect(current.getByText('Укажите причину досрочного завершения.', { exact: true })).toBeVisible();
    expect(submissions).toEqual([]);
    await reason.fill('  Учебный выезд завершён  ');
    await confirm.click();
    await expect(current.getByText('Учебный отказ: проверьте дату', { exact: true })).toBeVisible();
    await expect(reason).toHaveValue('  Учебный выезд завершён  ');
    await expect(hint).toContainText('31.10.2026');
    expect(submissions).toEqual([{ method: 'POST', body: { termination_date: '2026-10-31', reason: 'Учебный выезд завершён' } }]);
    await expectInsideDialog(dialog, cancel);
    await cancel.click();
    await expect(current.getByRole('button', { name: 'Завершить досрочно', exact: true })).toBeVisible();
    await current.getByRole('button', { name: 'Завершить досрочно', exact: true }).click();
    await current.getByRole('textbox', { name: /^Причина/ }).fill('Учебный выезд завершён');
    await page.route('**/api/statuses/statuses/planned/**', route => route.fulfill({ json: { current: {
      id: 605, status_type: 'in_service', status_type_display: 'В строю', state: 'active', state_display: 'Действует',
      start_date: '2026-10-31', end_date: null, effective_end_date: null, comment: 'Возвращение с учебного выезда',
    }, planned: [] } }));
    acceptWrite = true;
    await current.getByRole('button', { name: 'Завершить', exact: true }).click();
    await expect(current.getByText('В строю', { exact: true })).toBeVisible();
    await expect(current.getByRole('button', { name: 'Завершить досрочно', exact: true })).toHaveCount(0);
    expect(submissions).toEqual([
      { method: 'POST', body: { termination_date: '2026-10-31', reason: 'Учебный выезд завершён' } },
      { method: 'POST', body: { termination_date: '2026-10-31', reason: 'Учебный выезд завершён' } },
    ]);
    expect(businessWrites).toEqual([]);
  });
});

test('editing a future card keeps its draft and bottom actions in that card after a rejected save', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  const dialog = await openPlans(page);
  const submissions: { method: string; body: unknown }[] = [];
  await page.route('**/api/statuses/statuses/602/**', route => {
    submissions.push({ method: route.request().method(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 400, json: { error: 'Учебный отказ изменения' } });
  });
  const future = dialog.getByRole('article', { name: 'Запланированный статус: В отпуске', exact: true });
  await future.getByRole('button', { name: 'Изменить запланированный статус: Запланирован', exact: true }).click();
  await expect(future.getByRole('heading', { name: 'Редактирование запланированного статуса', exact: true })).toBeVisible();
  const comment = future.getByRole('textbox', { name: 'Комментарий', exact: true });
  await comment.fill('Уточнённый учебный отпуск');
  const cancel = future.getByRole('button', { name: 'Отмена', exact: true });
  const save = future.getByRole('button', { name: 'Сохранить', exact: true });
  await expectInsideDialog(dialog, cancel);
  await expectInsideDialog(dialog, save);
  await save.click();
  await expect(future.getByText('Учебный отказ изменения', { exact: true })).toBeVisible();
  await expect(comment).toHaveValue('Уточнённый учебный отпуск');
  expect(submissions).toEqual([{ method: 'PATCH', body: {
    employee: 1, status_type: 'vacation', start_date: '2026-11-20', end_date: '2026-11-25', comment: 'Уточнённый учебный отпуск',
  } }]);
  await expectInsideDialog(dialog, cancel);
  await cancel.click();
  await expect(future.getByRole('textbox')).toHaveCount(0);
  await expect(future.getByText(/Учебный отпуск/)).toBeVisible();
  expect(businessWrites).toEqual([]);
});
