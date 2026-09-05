/**
 * «Передано на расстановку …» печатает МОМЕНТ, а не срез UTC-метки
 * (Plane №581).
 *
 * `handover.at` — метка времени сервера в UTC (`force_collection._now_iso()`),
 * а карточка брала из неё календарный день `.slice(0, 10)` и печатала
 * `formatIsoDate`. Передача после 19:00 по местному (+05) лежит в базе
 * ВЧЕРАШНИМ днём по Гринвичу, и штаб читал «Передано на расстановку <вчера>»
 * о том, что сделали вечером. Тот же дефект и та же правка, что в №560 у даты
 * рассылки запроса управлениям.
 *
 * 🔴 ПОДМЕНА ОТВЕТОВ, А НЕ ФИКСТУРА. Предмет пробы — ОДИН МОМЕНТ на границе
 * суток: «22:00 UTC» обязано печататься как «05.09.2026, 03:00». Стенд
 * ставит `handover.at` своими часами в секунду передачи — попасть в нужную
 * минуту фикстурой невозможно, а проба, согласная на любую дату, дефект не
 * сторожит. Стенд НЕ ТРОГАЕТСЯ: подменены ровно две ручки «Сборов».
 *
 * 🔴 ЗОНА ЗАДАНА ЯВНО: без `timezoneId` браузер берёт часы машины, и в UTC оба
 * формата напечатали бы 04.09 — проба зеленела бы на сломанном коде.
 *
 * Красная до правки: «Передано на расстановку 04.09.2026».
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

/** 22:00 UTC 4 сентября = 03:00 5 сентября в +05. Даты РАЗНЫЕ — в этом суть. */
const HANDED_AT = '2026-09-04T22:00:00+00:00'
const EVENT_ID = '900581'
const CODE = 'ОМ-СИНТ-581'

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

const boardStatus = { code: 'DISTRIBUTED', label: 'Распределено', answered: 1, total: 1 }
const common = {
  eventId: EVENT_ID,
  code: CODE,
  title: 'Синтетическое мероприятие 581',
  businessDate: '2026-09-10',
  eventTime: null,
  location: 'Синт. адрес',
  stage: 'PLACEMENT',
  boardStatus,
  urgent: false,
  need: 2,
  allocated: 2,
  gathered: 2,
  collectionStatus: 'IN_PROGRESS',
}

test.describe(
  LIVE ? 'сбор сил: момент передачи на расстановку' : 'сбор сил: момент передачи (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

    // Часы браузера — +05, как у машин, на которых работает заказчик.
    test.use({ timezoneId: 'Asia/Almaty' })

    test('«Передано на расстановку 05.09.2026, 03:00», а не вчерашний день по UTC', async ({
      page,
    }) => {
      await signIn(page)

      await page.route(
        (url) => url.pathname.endsWith('/forces/collections/'),
        (route) =>
          route.fulfill({
            json: {
              results: [
                {
                  ...common,
                  requested: 2,
                  allocating: 2,
                  sent: 2,
                  shortage: 0,
                  isNew: false,
                  departments: 1,
                },
              ],
            },
          }),
      )
      await page.route(
        (url) => url.pathname.endsWith(`/${EVENT_ID}/force-collection/`),
        (route) =>
          route.fulfill({
            json: {
              ...common,
              needByObject: [
                {
                  visitObjectId: 'vo-581',
                  objectName: 'Синт. объект',
                  need: 2,
                  statusLabel: 'Согласовано',
                  chiefName: 'Абаев А.',
                },
              ],
              totals: { need: 2, requested: 2, allocating: 2, sent: 2, shortage: 0 },
              remaining: 0,
              allocations: [],
              // Состав НЕ пустой: секция «Собранные сотрудники → объекты»
              // при пустом составе не рисуется вовсе (`roster.length === 0 →
              // return null`), и проверять было бы нечего.
              roster: [
                {
                  employeeId: 'emp-581',
                  name: 'Синтетов С.',
                  divisionId: '9101',
                  divisionName: 'Синт. управление',
                  departmentId: '9500',
                  departmentName: 'Синт. департамент',
                  acceptedAt: HANDED_AT,
                  statusCode: null,
                  statusLabel: null,
                  visitObjectId: 'vo-581',
                },
              ],
              objects: [
                { visitObjectId: 'vo-581', objectName: 'Синт. объект', need: 2, assigned: 2 },
              ],
              // Состав ПЕРЕДАН — иначе строка печатает «Прислано …» и до
              // проверяемого текста дело не доходит вовсе.
              handover: { at: HANDED_AT, by: 'Абаев А.', comment: '', shortfall: [] },
            },
          }),
      )

      await page.goto(`${APP}/employees?view=forces`)
      const tab = page.getByRole('tab', { name: 'Сборы', exact: true })
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()
      // Ждём САМУ секцию, а не сразу кнопку: вкладка «Сборы» рисуется поверх
      // ещё грузящегося списка сотрудников, и щелчок по кнопке до появления
      // таблицы уходит в старую панель (поймано первым прогоном).
      const section = page.locator('section[aria-labelledby="force-collections-heading"]')
      await expect(section.getByRole('heading', { name: 'Сборы сил' })).toBeVisible({
        timeout: 20_000,
      })
      await section.getByRole('button', { name: `Открыть сбор ${CODE}` }).click()

      const block = page.locator('section[aria-labelledby="roster-objects-heading"]')
      const line = block.getByText('Передано на расстановку', { exact: false })
      await expect(line).toBeVisible({ timeout: 15_000 })

      // Ассерт на ОБА конца: правильный момент есть, вчерашней даты нет.
      await expect(line).toHaveText('Передано на расстановку 05.09.2026, 03:00')
      await expect(block.getByText('04.09.2026', { exact: false })).toHaveCount(0)
    })
  },
)
