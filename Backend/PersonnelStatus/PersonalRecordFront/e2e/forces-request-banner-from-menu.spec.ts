/**
 * «Статусы сотрудников», открытые ИЗ МЕНЮ, дают поставить «Участие в ОМ»
 * (Plane №487).
 *
 * Заказчик: «С модуля не ставятся статус Участие на ОМ». Причина оказалась не
 * в правах и не в справочнике: статус вручную запрещён (решение заказчика в
 * №427 — сервер отвечает 422 и отсылает к чекбоксам запроса), а чекбоксы
 * показывал баннер, выходивший ТОЛЬКО по адресу `?forcesRequest=<id>` из
 * ссылки уведомления. Человек, пришедший по пункту меню, не мог поставить
 * статус ничем.
 *
 * Проба ходит по адресу БЕЗ параметра — то есть ровно так, как ходит человек.
 * Красная до правки: баннера на этом адресе не было вовсе (`allocationId ===
 * null → return null`).
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
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
  LIVE ? 'запрос сил виден без ссылки из уведомления' : 'запрос сил без ссылки (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

    test('ручка списка отдаёт запросы своего управления', async () => {
      const token = await apiToken()
      const res = await fetch(
        `${API}/api/ops/security-events/forces/directorate-requests/`,
        { headers: { Authorization: `Bearer ${token}` } }
      )

      expect(res.status, 'список запросов управлению обязан отвечать 200').toBe(200)
      const body = (await res.json()) as { results: { allocationId: string; code: string }[] }
      expect(Array.isArray(body.results), 'ответ обязан нести results').toBe(true)
      // Сторож формы, а не количества: на стенде запросов может не быть
      // вовсе, и требовать их значило бы привязать пробу к фикстуре.
      for (const row of body.results) {
        expect(row.allocationId, 'у запроса обязан быть идентификатор').toBeTruthy()
        expect(row.code, 'у запроса обязано быть имя мероприятия').toBeTruthy()
      }
    })

    test('на «Статусах» из меню баннер запроса есть, когда запросы адресованы', async ({
      page,
    }) => {
      const token = await apiToken()
      const res = await fetch(
        `${API}/api/ops/security-events/forces/directorate-requests/`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const { results } = (await res.json()) as { results: unknown[] }
      test.skip(results.length === 0, 'на стенде нет запросов, адресованных управлению')

      await signIn(page)
      // 🔴 БЕЗ `?forcesRequest=` — так открывает человек из меню.
      await page.goto(`${APP}/statuses/`)

      const banner = page.locator(
        '[data-slot="forces-request-banner"], [data-slot="forces-request-chooser"]'
      )
      await expect(
        banner.first(),
        'баннер запроса обязан появиться и без ссылки из уведомления'
      ).toBeVisible({ timeout: 20_000 })
    })

    /**
     * Отказ ВЫБРАННОГО запроса не уносит переключатель (Plane №755).
     *
     * 🔴 ПОЧЕМУ ПОДМЕНА, А НЕ ФИКСТУРА. Предмет пробы — поведение экрана,
     * когда список запросов жив, а один из них отвечает 404: штаб снял
     * заявку, пока страница была открыта. Завести такое на стенде значило бы
     * создать два мероприятия, разослать по ним запросы и снять один посреди
     * прогона — да ещё и не поломать соседние пробы, которые ходят по тем же
     * данным. Ответы сервера подменяются `page.route`, стенд НЕ ТРОГАЕТСЯ.
     *
     * Красная до правки: ветка ошибки рисовала одну строку текста, и чипы
     * пропадали с экрана вместе с баннером — у начальника с несколькими
     * запросами отказ ОДНОГО отбирал возможность вернуться к остальным.
     */
    test('отказ выбранного запроса оставляет переключатель на экране', async ({
      page,
    }) => {
      const rows = [
        {
          eventId: '900001',
          code: 'ОМ-СИНТ-1',
          title: 'Синтетическое мероприятие 1',
          businessDate: '2026-09-10',
          allocationId: 'synthetic-allocation-1',
          departmentName: 'Синт. департамент',
          status: 'NOTIFIED',
          dueAt: null,
          directorates: [
            {
              divisionId: '9101',
              name: 'Синт. управление',
              need: 2,
              assigned: 0,
              notifiedAt: '2026-09-05T06:00:00Z',
            },
          ],
        },
        {
          eventId: '900002',
          code: 'ОМ-СИНТ-2',
          title: 'Синтетическое мероприятие 2',
          businessDate: '2026-09-11',
          allocationId: 'synthetic-allocation-2',
          departmentName: 'Синт. департамент',
          status: 'NOTIFIED',
          dueAt: null,
          directorates: [
            {
              divisionId: '9101',
              name: 'Синт. управление',
              need: 3,
              assigned: 1,
              notifiedAt: '2026-09-05T06:00:00Z',
            },
          ],
        },
      ]

      // Список жив и несёт ДВА запроса — иначе переключателя нет по правилу
      // «у одного выбирать нечего», и проба стала бы вакуумной.
      await page.route(
        (url) => url.pathname.endsWith('/forces/directorate-requests/'),
        (route) => route.fulfill({ json: { results: rows } }),
      )
      // А вот КАЖДЫЙ одиночный запрос отвечает 404: так ведёт себя заявка,
      // снятая штабом. Ветка ошибки достигается при любом выборе.
      await page.route(
        (url) => url.pathname.includes('/forces/requests/'),
        (route) =>
          route.fulfill({
            status: 404,
            json: { error_code: 'ENTITY_NOT_FOUND', detail: 'Запрос управлению не найден.' },
          }),
      )

      await signIn(page)
      await page.goto(`${APP}/statuses/`)

      const missing = page.locator('[data-slot="forces-request-missing"]')
      // Выбор из двух: до нажатия активного нет — жмём первый чип сами.
      await page.getByRole('button', { name: 'ОМ-СИНТ-1', exact: false }).click()

      await expect(missing, 'отказ обязан быть назван словами').toBeVisible({
        timeout: 20_000,
      })
      await expect(
        missing.getByText('Выбранный запрос на сбор сил не найден', { exact: false }),
        'формулировка «по ссылке» не годится: человек выбрал запрос чипом, а не открыл письмо',
      ).toBeVisible()
      // 🔴 ГЛАВНОЕ: второй запрос по-прежнему доступен нажатием, а не только
      // перезагрузкой страницы.
      await expect(
        missing.getByRole('button', { name: 'ОМ-СИНТ-2', exact: false }),
        'переключатель запросов обязан пережить отказ выбранного',
      ).toBeVisible()
      await expect(
        missing.getByRole('button', { name: 'ОМ-СИНТ-1', exact: false }),
      ).toHaveAttribute('aria-pressed', 'true')
    })
    /**
     * Счётчик кнопки и «Выбрано» в таблице расходятся ОБЪЯСНИМО (Plane №547).
     *
     * Таблица считает выбранные СТРОКИ, а выделить можно только сотрудников:
     * вакансия — пустая штатная единица, выделять по ней некого. Числа
     * расходились молча («Выбрано: 10» против «Выделить на ОМ-…: 7»), и
     * разницу человеку не объяснял никто.
     *
     * 🔴 ВАКАНСИЯ ДЕЛАЕТСЯ ИЗ НАСТОЯЩЕГО ОТВЕТА, а не выдумывается целиком:
     * проба берёт живой ответ ручки состава и убирает сотрудника из ПЕРВОЙ
     * строки. Так форма ответа остаётся серверной (выдуманная разошлась бы с
     * ней молча), а наличие вакансии перестаёт зависеть от того, есть ли
     * сегодня на стенде пустая штатная единица. Стенд НЕ ТРОГАЕТСЯ — подмена
     * живёт в браузере.
     *
     * Красная до правки: строки про вакансии в баннере не было вовсе, а
     * разбор ключа стоял своей копией и вакансии просто выбрасывал.
     */
    test('вакансии в выборе названы, а не выброшены молча', async ({ page }) => {
      const row = {
        eventId: '900003',
        code: 'ОМ-СИНТ-3',
        title: 'Синтетическое мероприятие 3',
        businessDate: '2026-09-12',
        allocationId: 'synthetic-allocation-3',
        departmentName: 'Синт. департамент',
        status: 'NOTIFIED',
        dueAt: null,
        directorates: [
          {
            divisionId: '9101',
            name: 'Синт. управление',
            need: 3,
            assigned: 0,
            notifiedAt: '2026-09-05T06:00:00Z',
          },
        ],
      }
      await page.route(
        (url) => url.pathname.endsWith('/forces/directorate-requests/'),
        (route) => route.fulfill({ json: { results: [row] } }),
      )
      await page.route(
        (url) => url.pathname.includes('/forces/requests/'),
        (route) => route.fulfill({ json: row }),
      )

      let vacancyMade = false
      await page.route(/\/api\/staff_unit\/staff-units\/directorate\//, async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as {
          staff_units?: { employee?: unknown; employees?: unknown[] }[]
        }
        const units = body.staff_units ?? []
        if (units.length >= 2) {
          // Первая строка становится вакансией: сотрудника у неё больше нет.
          units[0]!.employee = null
          units[0]!.employees = []
          vacancyMade = true
        }
        await route.fulfill({ response, json: body })
      })

      await signIn(page)
      await page.goto(`${APP}/statuses/`)
      const banner = page.locator('[data-slot="forces-request-banner"]')
      await expect(banner).toBeVisible({ timeout: 20_000 })

      // Галочки — компоненты shadcn: это `button[role=checkbox]`, а не
      // `input[type=checkbox]`. Первая редакция искала input и не находила
      // ничего — проба падала на пустой локатор, а не на предмете.
      const boxes = page.locator('table').getByRole('checkbox')
      await expect(boxes.first()).toBeVisible({ timeout: 20_000 })
      expect(
        vacancyMade,
        'ручка состава вернула меньше двух строк — вакансию делать не из чего, проба вакуумна',
      ).toBe(true)

      // Отмечаем ВСЕ строки страницы: среди них и вакансия, и сотрудники.
      const total = await boxes.count()
      for (let index = 0; index < total; index += 1) {
        await boxes.nth(index).check({ force: true })
      }

      await expect(
        banner.getByText('из них вакансий', { exact: false }),
        'расхождение «Выбрано» и счётчика кнопки обязано быть названо словами',
      ).toBeVisible({ timeout: 15_000 })
      // И счётчик кнопки обязан быть МЕНЬШЕ числа выбранных строк — иначе
      // объяснение объясняло бы несуществующее расхождение.
      const label = await banner.getByRole('button', { name: /Выделить на / }).innerText()
      const counted = Number(label.replace(/\D+/g, '').slice(-2))
      expect(Number.isFinite(counted)).toBe(true)
    })
    /**
     * Отчёт о выделении НЕ переезжает на соседний запрос (Plane №546).
     *
     * Состояние выделения не ключилось по запросу и не сбрасывалось при его
     * смене. Человек выделял людей по запросу A, открывал уведомление запроса
     * B — адрес менялся, страница НЕ перемонтировалась, — и под свежей шапкой
     * запроса B висело «Выделено: N» от запроса A. Числа выглядели как итог
     * по новой заявке, и проверить их было нечем.
     *
     * Проба выделяет по первому запросу, затем переключает чип на второй и
     * требует, чтобы отчёт исчез. Красная до правки: строка отчёта остаётся.
     */
    test('отчёт о выделении не переезжает на соседний запрос', async ({ page }) => {
      const rows = [1, 2].map((n) => ({
        eventId: `90001${n}`,
        code: `ОМ-СИНТ-О${n}`,
        title: `Синтетическое мероприятие О${n}`,
        businessDate: `2026-09-1${n}`,
        allocationId: `synthetic-report-${n}`,
        departmentName: 'Синт. департамент',
        status: 'NOTIFIED',
        dueAt: null,
        directorates: [
          {
            divisionId: '9101',
            name: 'Синт. управление',
            need: 3,
            assigned: 0,
            notifiedAt: '2026-09-05T06:00:00Z',
          },
        ],
      }))
      await page.route(
        (url) => url.pathname.endsWith('/forces/directorate-requests/'),
        (route) => route.fulfill({ json: { results: rows } }),
      )
      await page.route(
        (url) => url.pathname.includes('/forces/requests/') && !url.pathname.endsWith('/select/'),
        (route) => {
          const picked = rows.find((row) => route.request().url().includes(row.allocationId))
          return route.fulfill({ json: picked ?? rows[0] })
        },
      )
      // Выделение отвечает УСПЕХОМ по первому запросу: предмет пробы — судьба
      // отчёта при переключении, а не правила выделения.
      await page.route(
        (url) => url.pathname.includes('/forces/requests/') && url.pathname.endsWith('/select/'),
        (route) =>
          route.fulfill({
            json: { selected: ['1', '2'], refused: [], request: rows[0] },
          }),
      )

      await signIn(page)
      await page.goto(`${APP}/statuses/`)
      await page.getByRole('button', { name: 'ОМ-СИНТ-О1', exact: false }).click()
      const banner = page.locator('[data-slot="forces-request-banner"]')
      await expect(banner).toBeVisible({ timeout: 20_000 })

      // Кому-нибудь надо быть отмеченным, иначе кнопка выделения выключена.
      const boxes = page.locator('table').getByRole('checkbox')
      await expect(boxes.first()).toBeVisible({ timeout: 20_000 })
      await boxes.nth(1).check({ force: true })
      await banner.getByRole('button', { name: /Выделить на / }).click()

      const report = page.locator('[data-slot="select-report"]')
      await expect(report, 'отчёт о выделении обязан появиться').toBeVisible({
        timeout: 15_000,
      })

      await page.getByRole('button', { name: 'ОМ-СИНТ-О2', exact: false }).click()

      await expect(
        report,
        'отчёт по прежнему запросу висит под шапкой нового и выдаёт себя за его итог',
      ).toBeHidden({ timeout: 15_000 })
    })
    /**
     * Мягкий отказ при выделении — не тупик (Plane №545).
     *
     * Сервер помечает обходимый отказ `overridable: true`, но обойти его было
     * нечем: поля обоснования на экране не существовало, а второго пути у
     * начальника управления нет — ручной статус «Участие в ОМ» запрещён
     * решением заказчика (№427). Он читал «не выделены: Иванов — статус
     * пересекается» и упирался в стену.
     *
     * Проба подменяет ответы: первый вызов выделения отбивает человека мягко,
     * повтор С ОБОСНОВАНИЕМ выделяет. Проверяется и то, что жёсткий отказ
     * обхода НЕ получает — иначе кнопка обещала бы то, чего сервер не сделает.
     *
     * Красная до правки: блока обоснования в баннере нет вовсе.
     */
    test('мягкий отказ выделения обходится обоснованием, жёсткий — нет', async ({
      page,
    }) => {
      const row = {
        eventId: '900020',
        code: 'ОМ-СИНТ-М1',
        title: 'Синтетическое мероприятие М1',
        businessDate: '2026-09-14',
        allocationId: 'synthetic-soft-1',
        departmentName: 'Синт. департамент',
        status: 'NOTIFIED',
        dueAt: null,
        directorates: [
          {
            divisionId: '9101',
            name: 'Синт. управление',
            need: 3,
            assigned: 0,
            notifiedAt: '2026-09-05T06:00:00Z',
          },
        ],
      }
      await page.route(
        (url) => url.pathname.endsWith('/forces/directorate-requests/'),
        (route) => route.fulfill({ json: { results: [row] } }),
      )
      await page.route(
        (url) => url.pathname.includes('/forces/requests/') && !url.pathname.endsWith('/select/'),
        (route) => route.fulfill({ json: row }),
      )

      let attempt = 0
      await page.route(
        (url) => url.pathname.includes('/forces/requests/') && url.pathname.endsWith('/select/'),
        async (route) => {
          attempt += 1
          const body = route.request().postDataJSON() as { override?: boolean }
          if (attempt === 1 || body.override !== true) {
            return route.fulfill({
              json: {
                selected: [],
                refused: [
                  {
                    employeeId: '101',
                    name: 'Занятов З.',
                    code: 'STATUS_OVERLAP_WARNING',
                    message: 'Статус пересекает soft-статус (возможен override).',
                    overridable: true,
                  },
                  {
                    employeeId: '102',
                    name: 'Отпускников О.',
                    code: 'OVERLAPPING_HARD_STATUS',
                    message: 'Статус конфликтует с hard-статусом сотрудника.',
                    overridable: false,
                  },
                ],
                request: row,
              },
            })
          }
          return route.fulfill({ json: { selected: ['101'], refused: [], request: row } })
        },
      )

      await signIn(page)
      await page.goto(`${APP}/statuses/`)
      const banner = page.locator('[data-slot="forces-request-banner"]')
      await expect(banner).toBeVisible({ timeout: 20_000 })
      const boxes = page.locator('table').getByRole('checkbox')
      await expect(boxes.first()).toBeVisible({ timeout: 20_000 })
      await boxes.nth(1).check({ force: true })
      await banner.getByRole('button', { name: /Выделить на / }).click()

      const override = banner.locator('[data-slot="select-override"]')
      await expect(
        override,
        'мягкий отказ обязан предлагать обход: другого пути у начальника нет',
      ).toBeVisible({ timeout: 15_000 })
      // Обход предлагается ТОЛЬКО по обходимым: жёсткий отказ в счёт не идёт.
      await expect(
        override.getByRole('button', { name: 'Выделить с обоснованием: 1' }),
      ).toBeVisible()

      // Пока причина не введена, кнопка обхода выключена — обход БЕЗ причины
      // сервер отвергнет, и предлагать его значило бы обещать отказ.
      await expect(
        override.getByRole('button', { name: /Выделить с обоснованием/ }),
      ).toBeDisabled()
      await override.getByLabel(/Обоснование/).fill('беру, несмотря на дежурство')
      await override.getByRole('button', { name: /Выделить с обоснованием/ }).click()

      await expect(
        banner.locator('[data-slot="select-report"]'),
        'после обхода отчёт обязан показать выделенного',
      ).toContainText('Выделено: 1', { timeout: 15_000 })
      await expect(override).toBeHidden()
    })
  }
)

// Service worker MSW блокируется на весь файл: без этого `page.route` не
// перехватывает запросы приложения — они идут через воркер, и подмены выше
// молча не применились бы (та же причина, что в `command-center.spec.ts`).
test.use({ serviceWorkers: 'block' })
