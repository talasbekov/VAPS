/**
 * Экран «Права» в настройках на ЖИВОМ стенде (Plane №36, шаг «П-6»).
 *
 * Проба отвечает на два вопроса: поиск действительно СУЖАЕТ реестр (и
 * переживает перезагрузку, потому что живёт в URL), и карточка права
 * показывает реальный каталог применения, а не пустой блок. Каждый шаг
 * проверяет и попадание, и ОТСЕВ — поиск, который ничего не отсеивает, прошёл
 * бы проверку «нужное право видно».
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'права в настройках' : 'права в настройках (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('поиск сужает реестр, карточка называет функции права', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    await signIn(page)
    await page.goto(`${APP}/settings/permissions/`)
    await expect(page.getByRole('heading', { name: 'Права', exact: true })).toBeVisible()

    const registry = page.getByRole('table')
    await expect(registry.getByRole('button', { name: 'admin.roles' })).toBeVisible()
    const everything = await registry.getByRole('row').count()
    expect(everything).toBeGreaterThan(2)

    await page.getByLabel('Поиск по справочнику прав').fill('admin.roles')
    await expect(registry.getByRole('button', { name: 'admin.roles' })).toBeVisible()
    // ОТСЕВ: без него проба зеленела бы и на поиске, который ничего не делает.
    await expect
      .poll(async () => registry.getByRole('row').count())
      .toBeLessThan(everything)

    // Поиск живёт в URL и переживает перезагрузку.
    await expect.poll(() => page.url()).toContain('search=admin.roles')
    await page.reload()
    await expect(page.getByLabel('Поиск по справочнику прав')).toHaveValue('admin.roles')

    await page.getByRole('button', { name: 'admin.roles' }).click()
    const card = page.getByText('Где применяется')
    await expect(card).toBeVisible()
    // Каталог собирается из карт `permission_map`, и у `admin.roles` такая
    // карта есть ровно у одной ручки — самого каталога. Пустой список тут
    // означал бы, что каталог не доехал.
    //
    // Ручки администрирования (`/api/operations/roles/` и соседние) сюда ТЕПЕРЬ
    // ПОПАДАЮТ: каталог читает не только карты `permission_map`, но и
    // построчные вызовы `require_permission` в теле метода (Plane №108). До
    // этого экран «Права» отвечал «право не стоит ни на одной ручке» ровно
    // про то право, которым закрыт он сам.
    await expect(page.getByText('/api/ops/access-catalog/', { exact: false }).first()).toBeVisible()
    await expect(
      page.getByText('/api/operations/user-roles/', { exact: false }).first(),
    ).toBeVisible()

    await page.screenshot({
      path: 'smoke-results/access-permissions.png',
      fullPage: true,
    })

    expect(errors).toEqual([])
  })
})
