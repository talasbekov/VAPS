import { expect, test, type Page, type Locator } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';
import type { StaffUnitStatistics } from '../lib/api';

const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350';
async function paintedAttribute(canvas: Locator, name: string) {
  await canvas.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return canvas.getAttribute(name);
}
const cameraDistance = (signature: string) => {
  const [x, y, z, tx, ty, tz] = signature.split(',').map(Number);
  return Math.hypot(x - tx, y - ty, z - tz);
};
async function dashboard(page: Page) {
  const csrf = await (await page.request.get(APP + '/api/auth/csrf/')).json();
  const response = await page.request.post(APP + '/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto(APP + '/dashboard/', { waitUntil: 'domcontentloaded' });
}

test.describe('real organization 3D scene', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Requires authenticated live portal with actual hierarchy');

  test('real geometry supports drag, keyboard, zoom, reset and accessible unit selection', async ({ page }, testInfo) => {
    const hierarchyResponse = page.waitForResponse(response => response.url().includes('/api/staff_unit/statistics/') && response.status() === 200);
    await dashboard(page);
    const hierarchy: StaffUnitStatistics = await (await hierarchyResponse).json();
    const scene = page.getByRole('region', { name: '3D-структура организации', exact: true });
    const canvas = scene.getByRole('img', { name: 'Вращаемая 3D-сцена структуры организации' });
    await expect(canvas).toBeVisible({ timeout: 45000 });
    await expect(scene.getByRole('button', { name: 'Сбросить вид', exact: true })).toBeEnabled();
    const original = await paintedAttribute(canvas, 'data-camera');
    expect(original).toBeTruthy();
    await expect(scene.getByTestId('org-scene-visible')).toContainText(/^Показано \d+ из \d+ подразделений · \d+ связей$/);
    const initialNodes = (await paintedAttribute(canvas, 'data-nodes'))!.split(',').map(Number);
    const initialEdges = (await paintedAttribute(canvas, 'data-edges'))!.split(',').filter(Boolean);
    expect(initialEdges.length, 'Overview must contain connected parent-child relationships').toBeGreaterThan(0);
    const plaqueBounds = JSON.parse((await paintedAttribute(canvas, 'data-bounds'))!) as Array<{ id: number; left: number; right: number; top: number; bottom: number; titlePx: number }>;
    for (const plaque of plaqueBounds) expect(plaque.titlePx, 'Working view stays readable without wrapping departments').toBeGreaterThanOrEqual(12);
    await scene.getByRole('button', { name: 'Вместить всё', exact: true }).click();
    for (const plaque of JSON.parse((await paintedAttribute(canvas, 'data-bounds'))!)) {
      expect(plaque.left).toBeGreaterThanOrEqual(-1);
      expect(plaque.right).toBeLessThanOrEqual(1);
      expect(plaque.top).toBeLessThanOrEqual(1);
      expect(plaque.bottom).toBeGreaterThanOrEqual(-1);
    }
    await scene.getByRole('button', { name: 'Сбросить вид', exact: true }).click();
    await scene.getByRole('button', { name: 'Переместить вид вправо', exact: true }).click();
    await expect(canvas).not.toHaveAttribute('data-camera', original!);
    await scene.getByRole('button', { name: 'Переместить вид влево', exact: true }).click();
    const returned = (await paintedAttribute(canvas, 'data-camera'))!.split(',').map(Number);
    original!.split(',').map(Number).forEach((value, index) => expect(returned[index]).toBeCloseTo(value, 3));
    await scene.getByRole('button', { name: 'Сбросить вид', exact: true }).click();
    for (const department of hierarchy.departments) expect(initialNodes).toContain(department.department_id);
    const positions = JSON.parse((await paintedAttribute(canvas, 'data-positions'))!) as Array<{ id: number; parentId: number | null; position: number[] }>;
    const departmentIds = hierarchy.departments.map(row => row.department_id);
    const departmentPositions = positions.filter(row => departmentIds.includes(row.id));
    expect(new Set(departmentPositions.map(row => row.position[1])).size, 'Departments share one generation, regardless of count').toBe(1);
    const overviewLabel = await scene.getByTestId('org-scene-visible').textContent();
    await scene.screenshot({ path: testInfo.outputPath('org-scene3d-overview.png') });
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + bounds!.width * 0.35, bounds!.y + bounds!.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + bounds!.width * 0.55, bounds!.y + bounds!.height * 0.45, { steps: 8 });
    await page.mouse.up();
    await expect(canvas).not.toHaveAttribute('data-camera', original!);
    await scene.getByRole('button', { name: 'Сбросить вид', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-camera', original!);
    await canvas.focus();
    await canvas.press('ArrowLeft');
    await expect(canvas).not.toHaveAttribute('data-camera', original!);
    await canvas.press('Home');
    await expect(canvas).toHaveAttribute('data-camera', original!);
    await scene.getByRole('button', { name: 'Приблизить', exact: true }).click();
    await expect(canvas).not.toHaveAttribute('data-camera', original!);
    const closer = await paintedAttribute(canvas, 'data-camera');
    expect(cameraDistance(closer!)).toBeLessThan(cameraDistance(original!));
    await scene.getByRole('button', { name: 'Отдалить', exact: true }).click();
    const farther = await paintedAttribute(canvas, 'data-camera');
    expect(cameraDistance(farther!)).toBeGreaterThan(cameraDistance(closer!));
    const expandable = hierarchy.departments.filter(department => hierarchy.directorates.some(directorate =>
      JSON.stringify(directorate.ancestors) === JSON.stringify([...department.ancestors, department.department_name])));
    const department = expandable[2] ?? expandable[0];
    expect(department, 'Real stand needs at least one department with a child to exercise branch navigation').toBeTruthy();
    const unit = scene.getByRole('group', { name: 'Выбор подразделения' }).getByRole('button')
      .filter({ has: page.getByText(department!.department_name, { exact: true }) }).first();
    await unit.focus();
    await unit.press('Enter');
    await expect(unit).toHaveAttribute('aria-pressed', 'true');
    await expect(scene.getByText('Штатных единиц', { exact: true })).toBeVisible();
    // Stand administrator has personnel.view. Selection must carry a concrete
    // division scope instead of silently opening the unfiltered directory.
    await expect(scene.getByRole('link', { name: 'Сотрудники подразделения →' })).toHaveAttribute('href', new RegExp(`^/service-employees/?\\?division_id=${department!.department_id}$`));
    await scene.getByRole('button', { name: 'Раскрыть подразделение', exact: true }).click();
    await expect(scene.getByRole('button', { name: 'Сбросить вид', exact: true })).toBeEnabled();
    const expandedNodes = (await paintedAttribute(canvas, 'data-nodes'))!.split(',').map(Number);
    const expandedPositions = JSON.parse((await paintedAttribute(canvas, 'data-positions'))!) as typeof positions;
    const parent = expandedPositions.find(row => row.id === department!.department_id)!;
    const children = expandedPositions.filter(row => row.parentId === parent.id);
    expect(children.length).toBeGreaterThan(0);
    expect(new Set(children.map(row => row.position[1])).size).toBe(1);
    const childXs = children.map(row => row.position[0]);
    expect(parent.position[0]).toBe((Math.min(...childXs) + Math.max(...childXs)) / 2);
    expect(children.every(row => row.position[1] < parent.position[1])).toBeTruthy();
    const familyIds = [parent.id, ...children.map(row => row.id)];
    const focusedBounds = JSON.parse((await paintedAttribute(canvas, 'data-bounds'))!);
    for (const plaque of focusedBounds.filter((row: { id: number }) => familyIds.includes(row.id))) {
      expect(plaque.left).toBeGreaterThanOrEqual(-1);
      expect(plaque.right).toBeLessThanOrEqual(1);
      expect(plaque.top).toBeLessThanOrEqual(1);
      expect(plaque.bottom).toBeGreaterThanOrEqual(-1);
      if ((await canvas.boundingBox())!.width >= 650) expect(plaque.titlePx).toBeGreaterThanOrEqual(10);
    }
    await scene.screenshot({ path: testInfo.outputPath('org-scene3d-third-department-focused.png') });
    await scene.getByRole('button', { name: 'Вместить всё', exact: true }).click();
    for (const plaque of JSON.parse((await paintedAttribute(canvas, 'data-bounds'))!)) {
      expect(plaque.left).toBeGreaterThanOrEqual(-1);
      expect(plaque.right).toBeLessThanOrEqual(1);
    }
    for (const id of initialNodes) expect(expandedNodes).toContain(id);
    expect(expandedNodes.length).toBeGreaterThan(initialNodes.length);
    const directorate = hierarchy.directorates.find(row => JSON.stringify(row.ancestors) === JSON.stringify([...department!.ancestors, department!.department_name]))!;
    expect((await paintedAttribute(canvas, 'data-edges'))!.split(',')).toContain(`${department!.department_id}:${directorate.directorate_id}`);
    await scene.screenshot({ path: testInfo.outputPath('org-scene3d-selected.png') });
    await scene.getByRole('button', { name: 'Свернуть подразделение', exact: true }).click();
    await expect(scene.getByTestId('org-scene-visible')).toHaveText(overviewLabel!);
    // A search result hidden inside a collapsed branch reveals its ancestry.
    await scene.getByRole('textbox').fill(String(directorate.directorate_id));
    await scene.getByRole('group', { name: 'Выбор подразделения' }).getByRole('button')
      .filter({ has: page.getByText(directorate.directorate_name, { exact: true }) }).first().click();
    await expect(scene.getByRole('button', { name: 'Сбросить вид', exact: true })).toBeEnabled();
    expect((await paintedAttribute(canvas, 'data-nodes'))!.split(',').map(Number)).toContain(directorate.directorate_id);
    expect((await paintedAttribute(canvas, 'data-edges'))!.split(',')).toContain(`${department!.department_id}:${directorate.directorate_id}`);
    await scene.getByRole('button', { name: 'Свернуть ветви', exact: true }).click();
    await expect(scene.getByTestId('org-scene-visible')).toHaveText(overviewLabel!);
  });

  test('WebGL failure preserves accessible real data and offers the table', async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
        return Reflect.apply(original, this, [type, ...args]);
      } as typeof original;
    });
    await dashboard(page);
    const scene = page.getByRole('region', { name: '3D-структура организации', exact: true });
    await expect(scene.getByRole('alert')).toContainText('3D-сцена недоступна', { timeout: 45000 });
    const unit = scene.getByRole('group', { name: 'Выбор подразделения' }).getByRole('button').first();
    await unit.click();
    await expect(unit).toHaveAttribute('aria-pressed', 'true');
    await expect(scene.getByText('Сотрудников', { exact: true })).toBeVisible();
    await scene.getByRole('button', { name: 'Открыть таблицу', exact: true }).click();
    await expect(page.getByRole('table').first()).toBeVisible();
    await expect(scene).toHaveCount(0);
  });

  test('a failed scheduled frame releases the scene and offers the table', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      WebGL2RenderingContext.prototype.clear = () => { throw new Error('Synthetic graphics frame failure'); };
    });
    await dashboard(page);
    const scene = page.getByRole('region', { name: '3D-структура организации', exact: true });
    await expect(scene.getByRole('alert')).toContainText('3D-сцена недоступна', { timeout: 45000 });
    await expect(scene.getByRole('button', { name: 'Сбросить вид', exact: true })).toBeDisabled();
    await expect(scene.getByRole('img', { name: 'Вращаемая 3D-сцена структуры организации' })).toHaveCount(0);
    await scene.getByRole('button', { name: 'Открыть таблицу', exact: true }).click();
    await expect(page.getByRole('table').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('lost graphics context exposes recovery instead of a frozen successful scene', async ({ page }) => {
    await dashboard(page);
    const scene = page.getByRole('region', { name: '3D-структура организации', exact: true });
    const canvas = scene.getByRole('img', { name: 'Вращаемая 3D-сцена структуры организации' });
    await expect(scene.getByRole('button', { name: 'Сбросить вид', exact: true })).toBeEnabled({ timeout: 45000 });
    const supported = await canvas.evaluate(element => {
      const context = (element as HTMLCanvasElement).getContext('webgl2');
      const extension = context?.getExtension('WEBGL_lose_context');
      if (!extension) return false;
      extension.loseContext();
      return true;
    });
    expect(supported, 'Browser must expose actual context-loss extension for this regression').toBeTruthy();
    await expect(scene.getByRole('alert')).toContainText('3D-сцена недоступна');
    await expect(scene.getByRole('button', { name: 'Сбросить вид', exact: true })).toBeDisabled();
    await expect(scene.getByRole('button', { name: 'Открыть таблицу', exact: true })).toBeVisible();
  });
});
