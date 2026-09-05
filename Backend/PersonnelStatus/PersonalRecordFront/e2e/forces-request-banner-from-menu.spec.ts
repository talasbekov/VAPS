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
  }
)

// Service worker MSW блокируется на весь файл: без этого `page.route` не
// перехватывает запросы приложения — они идут через воркер, и подмены выше
// молча не применились бы (та же причина, что в `command-center.spec.ts`).
test.use({ serviceWorkers: 'block' })
