/**
 * «Утвердить» на странице визита гаснет, пока сводка не пришла (Plane №522,
 * п. 2).
 *
 * `approveBlocker` считался по `row` — данным сводки. Пока запрос идёт (или
 * отказал), `row` пуст, `missingRequired` пуст просто потому, что данных нет,
 * — и кнопка выглядела рабочей. Человек жал и получал голый 422 вместо
 * погашенной кнопки с причиной.
 *
 * 🔴 ДВА СОСТОЯНИЯ, И ОНИ РАЗНЫЕ. «Подождите» после 500 — совет, который не
 * может помочь; «обновите страницу» во время загрузки — совет, который сделает
 * хуже. Поэтому и проверяются оба: задержанный ответ и отказ.
 *
 * Ответ подменяется, а не ищется на стенде: попасть в момент загрузки живой
 * ручкой нельзя, а отказ сводки на стенде пришлось бы устраивать поломкой.
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
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

/** Самодостаточная фикстура: проба не зависит от старого FOREIGN-ОМ на стенде. */
async function foreignEventId(token: string): Promise<string> {
  const res = await fetch(`${API}/api/ops/security-events/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Проба блокировки утверждения (e2e)',
      businessDate: '2026-09-27',
      businessDateEnd: '2026-09-28',
      kind: 'FOREIGN',
    }),
  })
  const body = (await res.json().catch(() => ({}))) as { id?: string }
  expect(res.status, `не удалось завести FOREIGN-ОМ: ${JSON.stringify(body).slice(0, 300)}`).toBe(201)
  expect(body.id, 'созданный FOREIGN-ОМ не вернул id').toBeTruthy()
  return body.id as string
}

test.use({ serviceWorkers: 'block' })

test.describe(
  LIVE ? 'страница визита: «Утвердить» и сводка' : 'страница визита (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

    test('пока сводка едет и когда она отказала, «Утвердить» выключена (Plane №522)', async ({
      page,
    }) => {
      const token = await apiToken()
      const eventId = await foreignEventId(token)
      try {
        // Сводка отвечает МЕДЛЕННО: так проверяется состояние загрузки, в
        // которое живой ручкой не попасть.
        let slow = true
        await page.route(
          (url) => url.pathname.includes('/api/ops/gvo-summaries/'),
          async (route) => {
            if (slow) await new Promise((done) => setTimeout(done, 4000))
            return route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ detail: 'сводка не собралась' }),
            })
          },
        )

        await signIn(page)
        await page.goto(`${APP}/security-ops/visits/${eventId}/`)

        const approve = page.getByRole('button', { name: 'Утвердить', exact: true })
        await expect(approve).toBeVisible({ timeout: 20_000 })
        // Пока запрос идёт — выключена и говорит, что идёт загрузка.
        await expect(
          approve,
          'кнопка утверждения кликабельна до загрузки сводки — сервер ответит 422',
        ).toBeDisabled()
        // 🔴 ПРИЧИНА ЧИТАЕТСЯ ВИДИМОЙ СТРОКОЙ, А НЕ `title` (правило №801,
        // найдено ревью №825): на выключенной кнопке подсказка не показывается
        // ни при каком поведении браузера, и прежний пин стерёг атрибут,
        // которого человек не видит. Связь строки с кнопкой держит
        // `aria-describedby` — её проверяем отдельно, иначе читалка произнесёт
        // текст «неизвестно о чём».
        const hint = page.locator('[data-slot="right-hint"]')
        await expect(hint).toHaveText('Сводка ещё загружается')
        await expect(approve).toHaveAttribute('aria-describedby', /.+/)

        // Ответ пришёл ОТКАЗОМ — причина меняется: «подождите» тут уже неправда.
        slow = false
        await expect(hint).toHaveText('Сводка не загрузилась — обновите страницу', {
          timeout: 20_000,
        })
        await expect(approve, 'после отказа сводки кнопка ожила').toBeDisabled()
      } finally {
        await fetch(`${API}/api/ops/security-events/${encodeURIComponent(eventId)}/`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      }
    })
  },
)
