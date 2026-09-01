/**
 * Несколько ролей у одного человека на ЖИВОМ стенде (Plane №353).
 *
 * Требование заказчика звучит одной фразой — «пользователям можно давать не
 * только одну роль, а несколько», — и распадается на два наблюдаемых факта,
 * которые до этой пробы не стерёг никто:
 *
 *   1. на экране «Пользователи» вторая роль ЛОЖИТСЯ РЯДОМ с первой, а не
 *      заменяет её;
 *   2. человек ВИДИТ весь свой состав ролей — в карточке профиля. До №353 там
 *      печаталась одна первая роль, а полный список жил в атрибуте `title`
 *      подписи в шапке: он не открывается ни с клавиатуры, ни касанием.
 *
 * Проба меняет состояние стенда и убирает за собой: пробная роль снимается
 * тем же экраном. Роль пробы БЕЗ ПРАВ — выдаётся она администратору, и роль
 * с правами меняла бы ему доступ на время прогона.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'
import { confirmInDialog } from './dialog'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
/** Своя роль пробы: чужую снимать нельзя, а настоящие назначения стенда
 *  проба трогать не должна. */
const PROBE_ROLE = 'E2E_SECOND_ROLE'

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'несколько ролей у человека' : 'несколько ролей у человека (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('вторая роль ложится рядом с первой и видна в карточке профиля', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    await signIn(page)

    // Роль заводится ЭКРАНОМ, а не запросом: POST в обход интерфейса на
    // стенде не проходит вовсе (сессия хоста не даёт прав разделу), и проба
    // падала не на своём предмете — «в списке нет такой роли».
    await page.goto(`${APP}/settings/roles/`)
    await expect(page.getByRole('heading', { name: 'Роли', exact: true })).toBeVisible()
    const rolesRegistry = page.getByRole('table')
    await page.getByLabel('Поиск по справочнику ролей').fill(PROBE_ROLE)
    await expect
      .poll(async () => rolesRegistry.getByRole('row').count())
      .toBeGreaterThan(0)
    if ((await rolesRegistry.getByRole('button', { name: PROBE_ROLE }).count()) === 0) {
      await page.getByRole('button', { name: 'Завести роль' }).click()
      await page.getByLabel('Код').fill(PROBE_ROLE)
      await page.getByLabel('Название').fill('Вторая роль пробы')
      await page.getByRole('button', { name: 'Завести' }).click()
      await expect(rolesRegistry.getByRole('button', { name: PROBE_ROLE })).toBeVisible()
    }

    await page.goto(`${APP}/settings/users/`)
    await expect(page.getByRole('heading', { name: 'Пользователи', exact: true })).toBeVisible()

    const registry = page.getByRole('table')
    await expect.poll(async () => registry.getByRole('row').count()).toBeGreaterThan(1)
    const everything = await registry.getByRole('row').count()
    await page.getByLabel('Поиск по учётным записям').fill(STAND_USERNAME)
    // ДОЖДАТЬСЯ СУЖЕНИЯ, а не только появления нужной строки: поиск
    // отложенный, и его ответ перерисовывает реестр. Клик по строке раньше
    // ответа открывал окно подтверждения, которое тут же исчезало вместе с
    // перерисованной карточкой — проба падала «кнопка отцепилась от DOM» на
    // ровном месте (воспроизведено: с уже выданной ролью падала каждый раз).
    await expect.poll(async () => registry.getByRole('row').count()).toBeLessThan(everything)
    await registry.getByRole('button', { name: STAND_USERNAME, exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Выдать роль' })).toBeVisible()
    // Роли человека приезжают своим запросом: смотреть на список сразу после
    // выбора значит смотреть на ещё пустой.
    await expect(page.getByText('Загрузка ролей человека…')).toHaveCount(0)

    // Локаторы по CSS, а не по роли: пока окно подтверждения открывается и
    // закрывается, Radix прячет фон от дерева доступности, и `getByRole`
    // вернул бы ноль независимо от содержимого списка.
    const assigned = page.locator('ul[aria-label="Роли человека"] li')
    const probeRow = assigned.filter({ hasText: PROBE_ROLE })
    if ((await probeRow.count()) > 0) {
      await probeRow.getByRole('button', { name: 'Снять' }).click()
      await confirmInDialog(page, { title: 'Снять роль?', button: 'Снять' })
      await expect(probeRow).toHaveCount(0)
    }
    // ПЕРВАЯ роль уже есть — иначе «вторая рядом с первой» проверять не на чем.
    const before = await assigned.count()
    expect(before).toBeGreaterThan(0)

    await page.getByLabel('Роль', { exact: true }).selectOption(PROBE_ROLE)
    await page.getByRole('button', { name: 'Выдать' }).click()

    // ГЛАВНОЕ: прежняя роль осталась, назначений стало на одно больше.
    await expect(probeRow).toHaveCount(1)
    await expect.poll(async () => assigned.count()).toBe(before + 1)

    // Карточка профиля называет ОБЕ роли: до №353 там стояла одна первая.
    await page.getByRole('button', { name: 'Меню пользователя' }).click()
    const profileRoles = page.locator('ul[aria-label="Роли раздела"] li')
    await expect.poll(async () => profileRoles.count()).toBe(before + 1)
    await expect(page.locator('ul[aria-label="Роли раздела"]')).toContainText(
      'Вторая роль пробы',
    )
    await page.screenshot({ path: 'smoke-results/access-multi-role.png', fullPage: true })
    await page.keyboard.press('Escape')

    // Уборка тем же экраном.
    await probeRow.getByRole('button', { name: 'Снять' }).click()
    await confirmInDialog(page, { title: 'Снять роль?', button: 'Снять' })
    await expect(probeRow).toHaveCount(0)
    await expect.poll(async () => assigned.count()).toBe(before)

    expect(errors).toEqual([])
  })
})
