import { expect, test } from '@playwright/test';
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials';

const APP = process.env.SMOKE_APP ?? 'http://localhost:3352';

test('scene labels reduce backing buffers, retain close detail, and release replaced resources', async ({ page }, info) => {
  test.setTimeout(120_000);
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated development browser; all non-auth writes blocked');
  await page.route('**/api/**', route => !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) && !new URL(route.request().url()).pathname.startsWith('/api/auth/') ? route.abort() : route.fallback());
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['orgstructure.view'], global_permissions: ['orgstructure.view'], roles: [] } }));
  const counts = { staff_units_count: 20, employees_count: 18, vacancies_count: 2 };
  const departments = Array.from({ length: 13 }, (_, index) => ({ department_id: index + 2, department_name: `Департамент ${index + 1}`, ancestors: [], ...counts }));
  const directorates = Array.from({ length: 180 }, (_, index) => ({ directorate_id: index + 100, directorate_name: `Управление ${index + 1}`, ancestors: [departments[index % departments.length].department_name], ...counts }));
  const tree = { id: 1, name: 'Служба', parent: null, division_type: 'organization', children: departments.map(department => ({ id: department.department_id, name: department.department_name, parent: 1, division_type: 'department', children: directorates.filter(unit => unit.ancestors[0] === department.department_name).map(unit => ({ id: unit.directorate_id, name: unit.directorate_name, parent: department.department_id, division_type: 'directorate', children: [] })) })) };
  await page.route('**/api/staff_unit/statistics/**', route => route.fulfill({ json: { scope_division: tree, summary: counts, departments, directorates, divisions: [] } }));
  await page.route('**/api/divisions/divisions_tree/**', route => route.fulfill({ json: tree }));
  await page.route('**/api/staff_unit/staff-units/**', route => route.fulfill({ json: { count: 0, next: null, results: [] } }));
  await page.addInitScript(() => {
    const canvases: HTMLCanvasElement[] = [];
    const renderers: string[] = [];
    let draws = 0;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      const context = Reflect.apply(original, this, [kind, ...args]);
      if (kind === '2d' && this.width * 512 === this.height * 1040 && !canvases.includes(this)) canvases.push(this);
      if ((kind === 'webgl2' || kind === 'webgl') && context && !(context as any).__sceneCounted) {
        const gl = context as WebGLRenderingContext;
        (gl as any).__sceneCounted = true;
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        renderers.push(String(gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)));
        const clear = gl.clear.bind(gl);
        gl.clear = (mask: number) => { draws++; clear(mask); };
      }
      return context;
    } as typeof original;
    (window as any).__sceneLabelProbe = () => ({ buffers: canvases.map(canvas => ({ width: canvas.width, height: canvas.height })), pixels: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0), draws, renderers });
  });
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json();
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } });
  expect((await login.json()).url).not.toContain('error=');
  await page.goto(`${APP}/dashboard/`);
  const scene = page.getByRole('region', { name: '3D-структура организации', exact: true });
  const canvas = scene.getByRole('img', { name: 'Вращаемая 3D-сцена структуры организации' });
  await expect(scene.getByRole('button', { name: 'Сбросить вид', exact: true })).toBeEnabled({ timeout: 45000 });
  await expect(scene.getByTestId('org-scene-visible')).toHaveText('Показано 14 из 194 подразделений · 13 связей');
  const nextPaint = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const snapshot = async () => { await nextPaint(); return page.evaluate(() => (window as any).__sceneLabelProbe()); };
  const initial = await snapshot();
  const initialCamera = await canvas.getAttribute('data-camera');
  await scene.getByRole('button', { name: 'Сбросить вид', exact: true }).click();
  await nextPaint();
  const unchanged = await snapshot();
  expect(await canvas.getAttribute('data-camera')).toBe(initialCamera);
  expect(unchanged.buffers.length, 'Reset at the working scale must not allocate textures for an intermediate fit camera').toBe(initial.buffers.length);
  expect(unchanged.draws - initial.draws, 'One reset paints at most one final camera state').toBeLessThanOrEqual(1);
  await scene.screenshot({ path: info.outputPath('default.png') });
  const projected = JSON.parse((await canvas.getAttribute('data-bounds'))!);
  for (const node of projected) expect(node.titlePx).toBeGreaterThanOrEqual(12);
  expect.soft(initial.pixels, 'Overview must use at most one quarter of fixed label canvas pixels').toBeLessThanOrEqual(14 * 1040 * 512 / 4);
  await scene.getByRole('textbox').fill('Департамент 7');
  await scene.getByRole('group', { name: 'Выбор подразделения' }).getByRole('button').filter({ has: page.getByText('Департамент 7', { exact: true }) }).click();
  for (let click = 0; click < 2; click++) await scene.getByRole('button', { name: 'Приблизить', exact: true }).click();
  const close = await snapshot();
  expect.soft(close.buffers.some((buffer: { width: number }) => buffer.width === 1040), 'Close zoom keeps original maximum label resolution').toBe(true);
  expect.soft(close.buffers.filter((buffer: { width: number }) => buffer.width === 1040).length, 'Zoom must not upgrade every offscreen card').toBeLessThan(7);
  await scene.screenshot({ path: info.outputPath('close.png') });
  await scene.getByRole('button', { name: 'Сбросить вид', exact: true }).click();
  const reset = await snapshot();
  expect.soft(reset.pixels, 'Zooming back must release high-resolution buffers, not accumulate tiers').toBeLessThanOrEqual(14 * 1040 * 512 / 4);
  for (const department of departments) {
    await scene.getByRole('textbox').fill(department.department_name);
    await scene.getByRole('group', { name: 'Выбор подразделения' }).getByRole('button').filter({ has: page.getByText(department.department_name, { exact: true }) }).click();
    await scene.getByRole('button', { name: 'Раскрыть подразделение', exact: true }).click();
    await expect(scene.getByRole('button', { name: 'Сбросить вид', exact: true })).toBeEnabled();
  }
  await expect(scene.getByTestId('org-scene-visible')).toHaveText('Показано 194 из 194 подразделений · 193 связей');
  await scene.getByRole('textbox').fill('');
  await scene.getByRole('button', { name: 'Сбросить вид', exact: true }).click();
  const expanded = await snapshot();
  expect.soft(expanded.buffers.filter((buffer: { width: number }) => buffer.width > 0)).toHaveLength(194);
  expect.soft(expanded.pixels, 'Fully expanded hierarchy keeps the same per-node overview budget').toBeLessThanOrEqual(194 * 1040 * 512 / 4);
  await scene.getByRole('textbox').fill('Управление 90');
  await scene.getByRole('group', { name: 'Выбор подразделения' }).getByRole('button').filter({ has: page.getByText('Управление 90', { exact: true }) }).click();
  for (let click = 0; click < 3; click++) await scene.getByRole('button', { name: 'Приблизить', exact: true }).click();
  const expandedClose = await snapshot();
  expect.soft(expandedClose.buffers.some((buffer: { width: number }) => buffer.width === 1040)).toBe(true);
  expect.soft(expandedClose.buffers.filter((buffer: { width: number }) => buffer.width === 1040).length, 'Close zoom keeps the large offscreen hierarchy at low resolution').toBeLessThan(20);
  expect.soft(expandedClose.pixels).toBeLessThanOrEqual(194 * 1040 * 512 / 4);
  await scene.screenshot({ path: info.outputPath('expanded-close.png') });
  await page.waitForTimeout(500);
  const idleStart = (await snapshot()).draws;
  await page.waitForTimeout(350);
  expect((await snapshot()).draws, 'Idle scene issues no extra WebGL frames').toBe(idleStart);
  await info.attach('allocation.json', { body: JSON.stringify({ initial, close, reset, expanded, expandedClose, projected }, null, 2), contentType: 'application/json' });
  await page.getByRole('link', { name: 'Мой профиль', exact: true }).first().click();
  await expect(scene).toHaveCount(0);
  expect.soft((await snapshot()).pixels, 'Unmount releases backing buffers even when canvas objects remain observable').toBe(0);
});
