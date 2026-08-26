/**
 * Экран «Роли» в настройках на ЖИВОМ стенде (Plane №36, шаг «П-7»).
 *
 * Проба отвечает на два вопроса: поиск СУЖАЕТ реестр ролей (проверяется и
 * отсев — поиск, который ничего не отсеивает, прошёл бы проверку «нужная роль
 * видна»), и состав прав правится на самом экране — выданное право появляется
 * в составе, снятое исчезает, причём снятие спрашивает подтверждение.
 *
 * Проба МЕНЯЕТ состояние стенда и потому убирает за собой: заведённая роль
 * остаётся (удаления ролей в системе нет по построению), но состав её прав
 * возвращается к пустому.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
/** Роль пробы: код узнаваемый, чтобы её было видно в реестре стенда. */
const PROBE_ROLE = 'E2E_PROBE_ROLE'

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'роли в настройках' : 'роли в настройках (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('поиск сужает реестр, состав прав собирается и снимается', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    await signIn(page)
    await page.goto(`${APP}/settings/roles/`)
    await expect(page.getByRole('heading', { name: 'Роли', exact: true })).toBeVisible()

    const registry = page.getByRole('table')
    // Список приезжает запросом: считать строки сразу после перехода значит
    // считать пустую таблицу (первый прогон так и упал на нуле).
    await expect.poll(async () => registry.getByRole('row').count()).toBeGreaterThan(2)
    const everything = await registry.getByRole('row').count()

    // Роль пробы заводится экраном же — заодно это проверка формы заведения.
    if ((await registry.getByRole('button', { name: PROBE_ROLE }).count()) === 0) {
      await page.getByRole('button', { name: 'Завести роль' }).click()
      await page.getByLabel('Код').fill(PROBE_ROLE)
      await page.getByLabel('Название').fill('Роль пробы')
      await page.getByRole('button', { name: 'Завести' }).click()
    }

    await page.getByLabel('Поиск по справочнику ролей').fill(PROBE_ROLE)
    await expect(registry.getByRole('button', { name: PROBE_ROLE })).toBeVisible()
    // ОТСЕВ: без него проба зеленела бы и на поиске, который ничего не делает.
    await expect.poll(async () => registry.getByRole('row').count()).toBeLessThan(everything)

    await registry.getByRole('button', { name: PROBE_ROLE }).click()
    await expect(page.getByText('Состав прав')).toBeVisible()

    // Выдача: право уезжает из «выдать» в «состав».
    await page.getByLabel('Поиск права для выдачи роли').fill('admin.roles')
    const grant = page.getByRole('button', { name: 'Выдать' }).first()
    await grant.click()
    const composition = page.getByRole('button', { name: 'Снять' })
    await expect(composition).toHaveCount(1)

    // Снятие спрашивает подтверждение: доступ пропадает у всех, кому роль выдана.
    await composition.click()
    await expect(page.getByRole('heading', { name: 'Снять право с роли?' })).toBeVisible()
    await page.getByRole('button', { name: 'Снять', exact: true }).last().click()
    await expect(page.getByRole('button', { name: 'Снять' })).toHaveCount(0)

    await page.screenshot({ path: 'smoke-results/access-roles.png', fullPage: true })

    expect(errors).toEqual([])
  })
})
