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
  }
)
