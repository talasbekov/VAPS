/**
 * Меню показывает ровно то, что человеку доступно (Plane №350).
 *
 * РЕШЕНИЕ ЗАКАЗЧИКА 31.08.2026: недоступные пункты ПРЯТАТЬ. До этого пункты
 * раздела ОМ стояли в меню всегда, а экран отвечал «Доступ закрыт»; под ролью
 * «Сотрудник» так оставалось десять пунктов из шестнадцати, и заказчик
 * прочитал это как сломанную систему.
 *
 * Проба держит ОБА конца правила, а не один:
 *   • пункта нет → экран за ним отвечает отказом (не спрятали работающее);
 *   • пункт есть → экран за ним открывается (не показали неработающее).
 * Одного первого мало: спрятать вообще всё тоже «спрятало недоступное».
 */
import { expect, test, type Page, type Locator } from '@playwright/test'
import { MODULE_PERMISSION } from '../entities/portal-access'

/**
 * Пункт ищется ПО АДРЕСУ, а не по видимой подписи. У «Реестра ОМ» в подписи
 * живёт бейдж-счётчик, и доступное имя ссылки — «Реестр ОМ 9»: поиск по точному
 * имени находил его только при пустом реестре, то есть проба зеленела бы от
 * состояния данных, а не от прав.
 */
function itemByHref(menu: Locator, href: string): Locator {
  // ДВА ВАРИАНТА АДРЕСА, а не один: Next дорисовывает завершающий слэш
  // (`trailingSlash`), и в разметке стоит `/security-ops/events/`. Селектор без
  // слэша не находил НИЧЕГО — и проба «пункта нет» зеленела на каждом пункте,
  // включая те, что стоят на месте. Замерено 31.08.2026: у администратора,
  // который видит все 22 пункта, находилось ноль.
  return menu.locator(`a[href="${href}"], a[href="${href}/"]`)
}

/** Формулировка отказа — ОДНА на весь раздел (`components/ops-access-denied`);
 *  подставлять свою значило бы проверять текст, которого в приложении нет. */
const DENIED = 'Недостаточно прав для просмотра'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''

/** Пункты меню раздела ОМ и подписи, под которыми они стоят. */
const ITEMS: Array<{ name: string; href: string }> = [
  { name: 'Командный центр', href: '/security-ops/command-center' },
  { name: 'Аналитика службы', href: '/security-ops/analytics' },
  { name: 'Объекты и паспорта', href: '/security-ops/objects' },
  { name: 'Реестр ОМ', href: '/security-ops/events' },
  { name: 'Охраняемые лица', href: '/security-ops/persons' },
  { name: 'Законы об ОМ', href: '/security-ops/laws' },
  { name: 'Транспорт ГОН', href: '/security-ops/vehicles' },
  { name: 'Аналитика ОМ', href: '/security-ops/analytics/operations' },
  { name: 'Отчеты по ОМ', href: '/security-ops/service-reports' },
  { name: 'Справочники', href: '/security-ops/dictionaries' },
  { name: 'Администрирование', href: '/security-ops/settings' },
  { name: 'Аудит', href: '/security-ops/audit' },
  { name: 'Журнал изменений', href: '/security-ops/changelog' },
]

/** Списки — словами заказчика из карточки №348, а не пересчётом прав. */
const CLOSED_TO_EMPLOYEE = [
  'Командный центр', 'Реестр ОМ', 'Транспорт ГОН', 'Аналитика ОМ',
  'Отчеты по ОМ', 'Аналитика службы', 'Справочники', 'Администрирование',
  'Журнал изменений',
]
const OPEN_TO_EMPLOYEE = ['Объекты и паспорта', 'Охраняемые лица', 'Законы об ОМ']

async function signIn(page: Page, username: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'меню: видно только доступное' : 'меню (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(PASSWORD === '', 'нужен ACCESS_MATRIX_PASSWORD — учётки матрицы доступа (Plane №348)')

  test('у сотрудника скрыто ровно то, что закрыто', async ({ page }) => {
    await signIn(page, 'acc_employee')
    await page.goto(`${APP}/security-ops/profile`)

    const menu = page.locator('aside')
    // Меню отрисовалось: ассерт «пункта нет» на пустой странице зелен всегда.
    await expect(menu.getByRole('link', { name: 'Мой профиль' })).toBeVisible()

    // Заказчик перечислил недоступное сотруднику поимённо — проверяем его
    // словами, а не пересчётом прав.
    for (const item of ITEMS.filter((row) => CLOSED_TO_EMPLOYEE.includes(row.name))) {
      await expect(
        itemByHref(menu, item.href),
        `«${item.name}» заказчик назвал недоступным — пункта быть не должно`,
      ).toHaveCount(0)
    }
    // И столь же поимённо — оставленное открытым.
    for (const item of ITEMS.filter((row) => OPEN_TO_EMPLOYEE.includes(row.name))) {
      await expect(
        itemByHref(menu, item.href),
        `«${item.name}» среди недоступных не назван — пункт должен остаться`,
      ).toBeVisible()
    }
    await expect(itemByHref(menu, '/statuses')).toBeVisible()
  })

  test('спрятанный пункт и закрытый экран — одно и то же', async ({ page }) => {
    await signIn(page, 'acc_employee')
    await page.goto(`${APP}/security-ops/profile`)
    const menu = page.locator('aside')
    await expect(menu.getByRole('link', { name: 'Мой профиль' })).toBeVisible()

    for (const item of ITEMS) {
      const visible = (await itemByHref(menu, item.href).count()) > 0
      await page.goto(`${APP}${item.href}`)
      // Ждём, пока страница РЕШИТ: гейт срабатывает после ответа о правах.
      // `networkidle` для этого не годится — на dev-стенде маршрут ещё
      // компилируется, сеть замирает раньше, чем экран что-то показал, и
      // проба однажды намеряла «открыт» на недорисованной странице.
      // Ждём видимого исхода: либо отказ, либо заголовок экрана.
      await expect(
        page.getByText(DENIED).or(page.locator('h1')).first(),
      ).toBeVisible({ timeout: 30_000 })
      const denied = await page.getByText(DENIED).count()
      expect(
        denied === 0,
        `«${item.name}»: в меню ${visible ? 'есть' : 'нет'}, а экран ${denied ? 'закрыт' : 'открыт'} — меню и гейт разошлись`,
      ).toBe(visible)
    }
  })

  test('администратор видит все пункты раздела', async ({ page }) => {
    await signIn(page, 'acc_admin')
    await page.goto(`${APP}/security-ops/profile`)

    const menu = page.locator('aside')
    await expect(menu.getByRole('link', { name: 'Мой профиль' })).toBeVisible()
    for (const item of ITEMS) {
      await expect(
        itemByHref(menu, item.href),
        `администратору «${item.name}» закрывать нечем`,
      ).toBeVisible()
    }
  })

  test('карта прав покрывает каждый пункт меню', async () => {
    // Пункт, забытый в карте, ведёт себя как «права не требует» и виден всем —
    // отказ пришёл бы только от экрана. Ловится здесь, а не человеком.
    for (const item of ITEMS) {
      expect(
        Object.prototype.hasOwnProperty.call(MODULE_PERMISSION, item.href),
        `«${item.name}» (${item.href}) не назван в MODULE_PERMISSION`,
      ).toBe(true)
    }
  })
})
