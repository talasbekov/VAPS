/**
 * Выход из профиля: кнопка «Выйти» в меню пользователя.
 *
 * 🔴 Проба заведена по дефекту 23.08.2026: выход уводил на
 * `http://localhost:3000/` — пустой порт. NextAuth резолвит относительный
 * `callbackUrl` от `NEXTAUTH_URL`, а та в dev стоит на `:3000`, тогда как
 * стенд живёт на `:3106`. Сессия снималась, но человек оставался на странице
 * ошибки соединения.
 *
 * Смоук-обход дефект НЕ ЛОВИЛ и не мог: он сравнивал только `pathname`, а у
 * мёртвого адреса путь ровно «/» — вердикт выходил «✅ увело на экран входа».
 * Поэтому ассерт здесь идёт по ПОЛНОМУ адресу, а не по пути.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const ROLE_USERNAME = process.env.BLACKLIST_USERNAME ?? 'role_ops_reader'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'выход из профиля' : 'выход из профиля (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('«Выйти» уводит на экран входа ТОГО ЖЕ стенда и снимает сессию', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard/`)
    await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Меню пользователя' }).click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()

    // Ассерт по ПОЛНОМУ адресу: путь «/» совпадал и у мёртвого :3000.
    await expect(page).toHaveURL(new RegExp(`^${APP}/?$`), { timeout: 20_000 })
    // И страница действительно живая — экран входа, а не ошибка соединения.
    // Не `getByRole('heading')`: заголовок карточки входа — `CardTitle`, то
    // есть <div>, роли heading у него нет.
    await expect(page.getByText('Вход в систему')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible()

    // Сессия снята: иначе «выход» был бы только переходом на другой экран.
    const session = await page.request.get(`${APP}/api/auth/session/`)
    expect(await session.json()).toEqual({})
  })
})

test.describe('отзыв refresh-токена (Plane №828)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нужен пароль ролевых учёток стенда')

  test('не-администратор продолжает только с новым refresh и выходит из портала', async ({ page }) => {
    const csrf = (await (await page.request.get(`${APP}/api/auth/csrf/`)).json()) as {
      csrfToken: string
    }
    const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
      form: {
        csrfToken: csrf.csrfToken,
        username: ROLE_USERNAME,
        password: ROLE_PASSWORD,
        json: 'true',
      },
    })
    expect(login.status(), 'браузерный вход не-администратора не принят').toBe(200)

    await page.goto(`${APP}/dashboard/`)
    await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible({ timeout: 20_000 })

    const pairResponse = await page.request.post(`${API}/api/token/`, {
      data: { username: ROLE_USERNAME, password: ROLE_PASSWORD },
    })
    expect(pairResponse.status(), 'не-административная учётка не получила токены').toBe(200)
    const pair = (await pairResponse.json()) as { refresh: string }

    const rotatedResponse = await page.request.post(`${API}/api/token/refresh/`, {
      data: { refresh: pair.refresh },
    })
    expect(rotatedResponse.status(), 'первое обновление refresh не принято').toBe(200)
    const rotated = (await rotatedResponse.json()) as { refresh: string }
    expect(rotated.refresh, 'сервер не выдал новый refresh при ротации').toBeTruthy()

    const reusedResponse = await page.request.post(`${API}/api/token/refresh/`, {
      data: { refresh: pair.refresh },
    })
    expect(reusedResponse.status(), 'старый refresh повторно принят после отзыва').toBe(401)

    const continuedResponse = await page.request.post(`${API}/api/token/refresh/`, {
      data: { refresh: rotated.refresh },
    })
    expect(continuedResponse.status(), 'новый refresh не продолжил сессию').toBe(200)

    await page.getByRole('button', { name: 'Меню пользователя' }).click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()
    await expect(page).toHaveURL(new RegExp(`^${APP}/?$`), { timeout: 20_000 })
    await expect(page.getByText('Вход в систему')).toBeVisible({ timeout: 20_000 })
    expect(await (await page.request.get(`${APP}/api/auth/session/`)).json()).toEqual({})
  })
})
