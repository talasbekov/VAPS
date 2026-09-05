/**
 * Раздел настроек, у которого нет ни версии, ни строк, ГОВОРИТ об этом
 * (Plane №670).
 *
 * Откуда взялось. Карта версий приходит с сервера перебором заведённых строк
 * (`settings_service.section_versions`), то есть раздел без строки в неё
 * просто не попадает. На базе, накатанной миграциями без `seed_operations`,
 * версий нет ни у одного раздела, а настроек нет вовсе — замерено: после
 * одних миграций и версий, и настроек по нулю. Экран верил, что версия есть
 * всегда: бейдж рисовал «версия:» и обрывался, а тело карточки оставалось
 * белым местом. Администратор не мог отличить «нечего настраивать» от «экран
 * сломан».
 *
 * ПОЧЕМУ ПОДМЕНА ОТВЕТА, А НЕ ЖИВАЯ ПУСТАЯ БАЗА. Стенд посеян, и другого у
 * проб нет; ронять сид ради одной пробы значило бы уронить его всем сессиям.
 * Предмет пробы — «видно ли отсутствие», а не «как получить пустую базу», и
 * подмена отвечает ровно на него.
 *
 * КРАСНОТА НА МУТАЦИИ: верни в `page.tsx` безусловное
 * `версия: {sectionVersions[sectionCode]}` — бейдж «версия не задана»
 * исчезнет; убери блок `rows.length === 0` — исчезнет объяснение пустоты.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

// `page.route` не перехватывает запросы, идущие через service worker мок-слоя.
test.use({ serviceWorkers: 'block' })

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: STAND_USERNAME,
      password: STAND_PASSWORD,
      json: 'true',
    },
  })
}

test.describe(
  LIVE ? 'настройки: незасеянный раздел' : 'настройки: незасеянный раздел (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

    test('раздел без версии и без строк называет и то, и другое', async ({ page }) => {
      await signIn(page)

      // Ответ БЕЗ карты версий и БЕЗ строк «Политики согласования» — ровно то,
      // что отдаёт сервер на базе без сида.
      await page.route('**/api/ops/settings/', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ results: [], sectionVersions: {} }),
        })
      })

      await page.goto(`${APP}/security-ops/settings`)

      const card = page
        .locator('div')
        .filter({ hasText: /^Политика согласования/ })
        .first()
      await expect(card).toBeVisible({ timeout: 20_000 })

      // Версии нет — бейдж говорит это словами, а не обрывается на двоеточии.
      await expect(page.getByText('версия не задана').first()).toBeVisible()
      await expect(page.getByText(/^версия:\s*$/)).toHaveCount(0)

      // Пустое тело раздела объяснено, и объяснение называет, что делать.
      await expect(
        page.getByText('Настройки этого раздела не заведены в базе').first(),
      ).toBeVisible()
      await expect(page.getByText('manage.py seed_operations').first()).toBeVisible()
    })
  },
)
