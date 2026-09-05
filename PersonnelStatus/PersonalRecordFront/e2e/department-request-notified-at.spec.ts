/**
 * «Запрошено <дата>» в карточке заявки департаменту печатает МОМЕНТ, а не
 * UTC-префикс (Plane №560).
 *
 * `notifiedAt` — метка времени сервера («2026-09-04T22:00:00+00:00»), а
 * колонка «Статус» читала её `formatIsoDate`, который РЕГУЛЯРКОЙ режет из
 * строки «ГГГГ-ММ-ДД» и часовой пояс не разбирает вовсе (и правильно делает
 * для `businessDate` — там дат без времени). Департамент, разославший запрос
 * в 03:00 по местному (+05), попадал в базу вчерашним днём по UTC, и человек
 * читал «Запрошено 04.09.2026» о том, что было сегодня в три ночи.
 *
 * 🔴 ПОЧЕМУ ПОДМЕНА ОТВЕТОВ, А НЕ ФИКСТУРА НА СТЕНДЕ. Предмет пробы — ОДИН
 * КОНКРЕТНЫЙ МОМЕНТ на границе суток: «22:00 UTC» обязано печататься как
 * «05.09.2026, 03:00». Стенд ставит `notifiedAt` часами сервера в секунду
 * оповещения — попасть фикстурой в нужную минуту невозможно, а проба,
 * согласная на любую дату, дефект не сторожит. Стенд НЕ ТРОГАЕТСЯ: подменены
 * ровно две ручки «Сбора сил», всё остальное на экране живое.
 *
 * 🔴 ЗОНА ЗАДАНА ЯВНО. Без `timezoneId` браузер берёт зону машины, и в UTC
 * оба формата напечатали бы 04.09 — проба стала бы зелёной на сломанном коде
 * там, где её погонял бы кто-то с другими часами.
 *
 * Красная до правки: `formatIsoDate` печатал «Запрошено 04.09.2026».
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

/** 22:00 UTC 4 сентября = 03:00 5 сентября в +05. Даты РАЗНЫЕ — в этом суть. */
const NOTIFIED_AT = '2026-09-04T22:00:00+00:00'
const ALLOCATION_ID = 'synthetic-allocation-560'
const CODE = 'ОМ-СИНТ-560'

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

const directorate = {
  id: 'force-directorate-9560',
  divisionId: '9560',
  name: 'Синт. управление 560',
  // need > assigned — иначе ячейка печатает «Выделено» и до даты не доходит.
  need: 3,
  assigned: 1,
  notifiedAt: NOTIFIED_AT,
}

test.describe(
  LIVE ? 'заявка департаменту: «Запрошено» печатает момент' : 'заявка департаменту: момент (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

    // Часы браузера — +05, как у машин, на которых работает заказчик.
    test.use({ timezoneId: 'Asia/Almaty' })

    test('«Запрошено 05.09.2026, 03:00», а не вчерашняя дата по UTC', async ({ page }) => {
      await signIn(page)

      await page.route(
        (url) => url.pathname.endsWith('/forces/requests/'),
        (route) =>
          route.fulfill({
            json: {
              results: [
                {
                  eventId: '900560',
                  code: CODE,
                  title: 'Синтетическое мероприятие 560',
                  businessDate: '2026-09-10',
                  eventTime: null,
                  location: 'Синт. адрес',
                  stage: 'PLACEMENT',
                  allocationId: ALLOCATION_ID,
                  departmentId: '9500',
                  departmentName: 'Синт. департамент 560',
                  need: 3,
                  allocating: null,
                  assigned: 1,
                  status: 'NOTIFIED',
                  dueAt: null,
                  overdue: false,
                  submittedLate: false,
                },
              ],
            },
          })
      )
      await page.route(
        (url) => url.pathname.endsWith(`/forces/requests/${ALLOCATION_ID}/`),
        (route) =>
          route.fulfill({
            json: {
              eventId: '900560',
              code: CODE,
              title: 'Синтетическое мероприятие 560',
              businessDate: '2026-09-10',
              eventTime: null,
              location: 'Синт. адрес',
              stage: 'PLACEMENT',
              allocation: {
                id: ALLOCATION_ID,
                departmentId: '9500',
                departmentName: 'Синт. департамент 560',
                need: 3,
                status: 'NOTIFIED',
                comment: '',
                notifiedAt: NOTIFIED_AT,
                submittedAt: null,
                decidedAt: null,
                decisionComment: '',
                directorates: [directorate],
                members: [],
              },
            },
          })
      )

      await page.goto(`${APP}/employees?view=forces`)
      // Таблица департамента живёт во вкладке «Заявки»: соседняя вкладка —
      // штабная лента «кому я раздал», и без клика на экране именно она.
      const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()
      await page.getByRole('button', { name: new RegExp(`^Открыть заявку ${CODE} `) }).click()

      const splitSection = page.locator('section[aria-labelledby="split-heading"]')
      // 🔴 ЯЧЕЙКА СВОЕЙ СТРОКИ, А НЕ ПЕРВОЕ «Запрошено» НА ЭКРАНЕ: колонка
      // таблицы называется тем же словом, и `getByText('Запрошено').first()`
      // ловит ЗАГОЛОВОК — проба была бы зелёной при любой дате в ячейке.
      const row = splitSection.locator('tbody tr').filter({ hasText: directorate.name })
      await expect(row).toHaveCount(1, { timeout: 15_000 })
      const cell = row.locator('td').last()

      // Ассерт на ОБА конца: правильный момент есть, вчерашней даты нет.
      // Одной проверки «есть 05.09» мало — «Запрошено» осталось бы на месте и
      // с UTC-датой, а именно она и была дефектом.
      await expect(cell).toHaveText('Запрошено 05.09.2026, 03:00')
      await expect(splitSection.getByText('04.09.2026', { exact: false })).toHaveCount(0)
    })
  }
)
