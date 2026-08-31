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

/** Пункты меню и подписи, под которыми они стоят.
 *
 * 🔴 ЧЕТЫРЕ ПОРТАЛЬНЫХ ПУНКТА ДОПИСАНЫ 31.08.2026 (Plane №352). Их здесь не
 * было, и это стоило дефекта: гейт `/employees` уехал внутрь ветки `if
 * (denial)` — синтаксис верный, `tsc` молчит, а проверка прав выполнялась
 * только когда сервер и так отказал. В обычном случае экран открывался кому
 * угодно. Нашло фоновое ревью коммита, а не проба, потому что проба ходила
 * только по экранам раздела. Теперь ходит по всем.
 */
const ITEMS: Array<{ name: string; href: string }> = [
  { name: 'Обзор', href: '/dashboard' },
  { name: 'Статусы сотрудников', href: '/statuses' },
  { name: 'Сбор сил на ОМ', href: '/employees' },
  { name: 'Ежедневный отчет', href: '/reports' },
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
      // 🔴 ЖДАТЬ ЗАГОЛОВОК НЕЛЬЗЯ, и это проверено ошибкой. Было «дождись
      // отказа ИЛИ h1» — а `h1` рисует КАРКАС страницы, до того как гейт
      // получил ответ о правах. Проба замеряла «экран открыт» на экране,
      // который через полсекунды показывал отказ, и краснела на «Обзоре»,
      // где всё работало.
      //
      // Отказ — единственный видимый исход, который нас интересует, поэтому
      // ждём ЕГО с ограниченным терпением: не появился за отведённое время —
      // экран открыт.
      await page.waitForLoadState('networkidle').catch(() => {})
      // Заглушка загрузки раздела уходит ПОСЛЕ того, как маршрут собран и
      // отрисован. На dev-стенде первый заход в маршрут компилируется дольше
      // любого разумного ожидания сети: замерено 31.08.2026 — `/security-ops/
      // vehicles` через 3,5 с после `networkidle` всё ещё показывал
      // «Загрузка раздела…», и проба читала это как «экран открыт».
      await expect(page.getByText('Загрузка раздела')).toHaveCount(0, {
        timeout: 60_000,
      })
      let denied = 0
      await expect
        .poll(
          async () => {
            denied = await page.getByText(DENIED).count()
            return denied
          },
          // Терпение 12 с, а не 4: на dev-стенде гейт отвечает после ответа о
          // правах, а тот идёт за только что скомпилированным маршрутом.
          // Замерено — «Администрирование» отказывало на шестой секунде, и
          // четырёх не хватало. На прод-стенде тот же ассерт укладывается в
          // сотни миллисекунд; лишнее терпение стоит только тогда, когда
          // экран и правда открыт.
          { timeout: 12_000, intervals: [200, 300, 500, 1000] },
        )
        .toBeGreaterThanOrEqual(visible ? 0 : 1)
        .catch(() => {})
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
