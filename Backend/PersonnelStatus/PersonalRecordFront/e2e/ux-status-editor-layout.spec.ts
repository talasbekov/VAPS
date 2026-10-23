import { test, expect, signIn } from './ux-fixture';
import type { Locator, Page } from '@playwright/test';

// Keep all employee/status data at a fake HTTP boundary. The shared fixture
// blocks every unhandled business write, including accidental form submits.
async function openEditor(page: Page) {
  const current = { id: 17, status_type: 'business_trip', state: 'active', start_date: '2026-10-16', end_date: '2026-10-20', location: 'Учебный город' };
  const unit = { id: 10, division: { id: 3, name: 'Учебное управление А' }, directorate_id: 3, directorate_name: 'Учебное управление А',
    employee: { id: 1, last_name: 'Учебный', first_name: 'Сотрудник', middle_name: '02', current_status: current }, position: { id: 1, name: 'Специалист' } };
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
    permissions: ['status.view', 'status.workspace', 'status.manage', 'object.view'],
    global_permissions: ['status.view', 'status.workspace', 'status.manage', 'object.view'],
  } }));
  await page.route('**/api/staff_unit/staff-units/directorate/**', route => route.fulfill({ json: {
    division: null, staff_units: [unit], total_count: 1, matched_count: 1, page: 1, page_size: 50, has_next: false,
  } }));
  await page.route('**/api/statuses/statuses/planned/**', route => route.fulfill({ json: { current, planned: [] } }));
  await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 0, next: null, results: [] } }));
  await page.route('**/api/statuses/types/**', route => route.fulfill({ json: [
    { code: 'business_trip', label: 'В командировке', color: '' },
    { code: 'on_duty', label: 'На дежурстве', color: '' },
    { code: 'IN_EVENT', label: 'Участие в ОМ', color: '' },
  ] }));
  await page.route('**/api/ops/dictionaries/EVENT_PARTICIPATION_KINDS/entries/**', route => route.fulfill({ json: { results: [
    { code: 'PHYSICAL_SQUAD', label: 'Физнаряд', isActive: true },
    { code: 'INSPECTION', label: 'Группа досмотра', isActive: true, isOwn: true, ownerDivisionId: '3', ownerDivisionPath: 'Учебное управление А' },
  ] } }));
  await page.route('**/api/ops/dictionaries/EVENT_GROUP_ROLES/entries/**', route => route.fulfill({ json: { results: [
    { code: 'INSPECTOR', label: 'Досмотрщик', groupCode: 'INSPECTION', isActive: true },
  ] } }));
  await page.route('**/api/ops/security-events/forces/directorate-requests/**', route => route.fulfill({ json: { results: [
    { eventId: '71', code: 'ОМ-DEMO-01', title: 'Учебное мероприятие с длинным названием', businessDate: '2026-10-18', allocationId: '81', departmentName: 'Учебный департамент', status: 'SENT', dueAt: null, directorates: [] },
  ] } }));
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: {
    business_date: '2026-10-17', blocked: false, laggards: [],
  } }));
  await signIn(page);
  await page.goto('/statuses/');
  await page.getByRole('button', { name: 'Действия: Учебный Сотрудник 02', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true });
  await expect(dialog.getByRole('combobox', { name: /^Новый статус/ })).toContainText('В командировке');
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled();
  // The Radix enter animation transforms the whole dialog. Read layout only
  // once that transform has settled, and still fail if the final frame spills.
  await expect.poll(() => dialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.getAnimations().every(animation => animation.playState !== 'running')
      && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight;
  }), { message: 'The opened editor must settle inside the viewport' }).toBeTruthy();
  return dialog;
}

async function expectContained(container: Locator, content: Locator) {
  const parent = await container.boundingBox(), child = await content.boundingBox();
  expect(parent).not.toBeNull(); expect(child).not.toBeNull();
  expect(child!.x).toBeGreaterThanOrEqual(parent!.x - 1);
  expect(child!.x + child!.width).toBeLessThanOrEqual(parent!.x + parent!.width + 1);
}

test('the standard status editor groups destination and dates and fits a common desktop viewport', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const dialog = await openEditor(page);
  await expect(dialog).toContainText('Сотрудник: Учебный Сотрудник 02');
  await expect(dialog).toContainText('Специалист · Учебное управление А');
  const direction = dialog.getByRole('region', { name: 'Статус и направление', exact: true });
  const period = dialog.getByRole('region', { name: 'Период', exact: true });
  const status = await direction.getByRole('combobox', { name: /^Новый статус/ }).boundingBox();
  const location = await direction.getByRole('textbox', { name: 'Место убытия', exact: true }).boundingBox();
  expect(Math.abs(status!.y - location!.y)).toBeLessThanOrEqual(2);
  expect(location!.x).toBeGreaterThan(status!.x + status!.width);
  const start = await period.locator('#startDate').boundingBox(), end = await period.locator('#endDate').boundingBox();
  expect(Math.abs(start!.y - end!.y)).toBeLessThanOrEqual(2);
  const comment = dialog.getByRole('textbox', { name: 'Комментарий', exact: true });
  const commentBox = await comment.boundingBox();
  expect(commentBox!.y).toBeGreaterThan(end!.y + end!.height);
  expect(commentBox!.width).toBeGreaterThan(status!.width + location!.width);
  await expect(dialog.getByText('* Обязательные поля', { exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Отмена', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toBeInViewport();
  await expect(comment).toBeInViewport();
  const fields = dialog.getByRole('region', { name: 'Поля статуса', exact: true });
  expect(await fields.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBeTruthy();
  expect(businessWrites).toEqual([]);
});

for (const width of [390, 320]) test(`at ${width}px the status editor keeps fields within its frame and actions visible while scrolling`, async ({ page, businessWrites }) => {
  await page.setViewportSize({ width, height: 740 });
  const dialog = await openEditor(page);
  const frame = await dialog.boundingBox();
  expect(frame!.x).toBeGreaterThanOrEqual(0);
  expect(frame!.x + frame!.width).toBeLessThanOrEqual(width);
  const fields = dialog.getByRole('region', { name: 'Поля статуса', exact: true });
  const save = dialog.getByRole('button', { name: 'Сохранить', exact: true });
  const cancel = dialog.getByRole('button', { name: 'Отмена', exact: true });
  await expect(save).toBeInViewport(); await expect(cancel).toBeInViewport();
  const initialFooter = await save.boundingBox();
  for (const control of [dialog.locator('#status'), dialog.locator('#location'), dialog.locator('#startDate'), dialog.locator('#endDate'), dialog.locator('#comment')]) {
    await expectContained(dialog, control);
  }
  await dialog.getByRole('textbox', { name: 'Комментарий', exact: true }).fill('Несохранённый мобильный черновик');
  await expect(dialog.getByRole('textbox', { name: 'Комментарий', exact: true })).toBeInViewport();
  await fields.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(save).toBeInViewport(); await expect(cancel).toBeInViewport();
  expect((await save.boundingBox())!.y).toBeCloseTo(initialFooter!.y, 0);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await cancel.click(); await expect(dialog).toBeHidden();
  expect(businessWrites).toEqual([]);
});

test('multiple OM participation cards scroll independently while header and action buttons stay accessible', async ({ page, businessWrites }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const dialog = await openEditor(page);
  await dialog.getByRole('combobox', { name: /^Новый статус/ }).click();
  await page.getByRole('option', { name: 'Участие в ОМ', exact: true }).click();
  await dialog.getByRole('button', { name: 'Группы', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Свои группы', exact: true }).click();
  await page.getByRole('option', { name: /Группа досмотра/ }).click();
  await dialog.getByRole('combobox', { name: 'Специальность', exact: true }).click();
  await page.getByRole('option', { name: 'Досмотрщик', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Мероприятие 1', exact: true }).click();
  await page.getByRole('option', { name: /ОМ-DEMO-01/ }).click();
  await dialog.getByRole('button', { name: '+ Мероприятие', exact: true }).click();
  await dialog.getByRole('button', { name: 'Физнаряд', exact: true }).nth(1).click();
  await expect(dialog.getByRole('combobox', { name: 'Мероприятие 2', exact: true })).toBeVisible();
  const fields = dialog.getByRole('region', { name: 'Поля статуса', exact: true });
  expect(await fields.evaluate(el => el.scrollHeight > el.clientHeight + 1)).toBeTruthy();
  const save = dialog.getByRole('button', { name: 'Сохранить', exact: true });
  const position = await save.boundingBox();
  await expect(save).toBeInViewport();
  await expect(dialog.getByRole('heading', { name: 'Статусы сотрудника', exact: true })).toBeInViewport();
  await dialog.getByRole('textbox', { name: 'Комментарий', exact: true }).fill('Черновик с двумя участиями');
  await expect(dialog.getByRole('textbox', { name: 'Комментарий', exact: true })).toBeInViewport();
  await expect(save).toBeInViewport();
  expect((await save.boundingBox())!.y).toBeCloseTo(position!.y, 0);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await fields.evaluate(el => { el.scrollTop = 0; });
  await expect(dialog.getByRole('combobox', { name: 'Мероприятие 1', exact: true })).toContainText('ОМ-DEMO-01');
  await expect(dialog.getByRole('combobox', { name: 'Специальность', exact: true })).toContainText('Досмотрщик');
  expect(businessWrites).toEqual([]);
});
