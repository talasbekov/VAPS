/**
 * Диалог «Редактировать профиль» на ЖИВОМ стенде: смена своего пароля
 * (Plane №180) и сохранение профиля (Plane №181).
 *
 * ЧТО СТЕРЕЖЁТ ПРОБА. До правки обе кнопки диалога били в адреса, которых в
 * бэкенде не существовало вовсе (`/api/user/change-password/`,
 * `/api/user/profile/` — 404), а клиент на 404 читал тело ответа дважды и
 * показывал жалобу на поток вместо причины. Серверная часть закрыта
 * pytest-пробами (`test_self_account_api.py`); здесь проверяется ровно то,
 * чего они не видят: что диалог ДОХОДИТ до сервера и что ответ сервера
 * оказывается на экране рядом с тем полем, к которому относится.
 *
 * ПОЧЕМУ ПАРОЛЬ СТЕНДА НЕ МЕНЯЕТСЯ. Успешная смена меняет состояние, откатить
 * которое проба не может: упав посередине, она оставила бы стенд с паролем,
 * которого не знает ни один следующий прогон. Поэтому проверяется путь
 * ОТКАЗА — он проходит ровно ту же дорогу (форма → сеть → сервер → разбор
 * ответа → показ), но ничего не меняет. Успешная смена проверена на сервере.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

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

async function openProfileDialog(page: Page): Promise<void> {
  await page.goto(`${APP}/dashboard/`)
  // Меню открывается по аватару — у кнопки нет текста, поэтому берём её по
  // доступному имени, которое ставит сам компонент.
  await page.getByRole('button', { name: /меню пользователя|user menu/i }).click()
  await page.getByRole('menuitem', { name: 'Редактировать профиль' }).click()
  await expect(
    page.getByRole('heading', { name: 'Редактировать профиль' }),
  ).toBeVisible()
}

test.describe(
  LIVE
    ? 'диалог профиля: смена пароля'
    : 'диалог профиля: смена пароля (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

    test('неверный текущий пароль отбивается сервером, и ответ виден под своим полем', async ({
      page,
    }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
      })

      await signIn(page)
      await openProfileDialog(page)

      await page.getByLabel('Текущий пароль').fill('заведомо-не-тот-пароль')
      await page.getByLabel('Новый пароль', { exact: true }).fill('Тжр7-каспий-берег')
      await page.getByLabel('Подтвердите новый пароль').fill('Тжр7-каспий-берег')

      const request = page.waitForResponse(
        (r) => r.url().includes('/api/user/change-password/'),
      )
      await page.getByRole('button', { name: 'Изменить пароль' }).click()
      const response = await request

      // Адрес существует: 404 здесь означал бы возврат исходного дефекта.
      expect(response.status()).toBe(400)

      // Ответ сервера стоит под тем полем, о котором он говорит, — а не одной
      // строкой «current_password: …» в шапке диалога.
      const currentPassword = page.getByLabel('Текущий пароль')
      await expect(currentPassword).toHaveAttribute('aria-invalid', 'true')
      const described = await currentPassword.getAttribute('aria-describedby')
      expect(described).toBe('current_password-error')
      await expect(page.locator('#current_password-error')).toHaveText(
        'Текущий пароль неверен.',
      )

      // Техническое имя поля человеку не показывается нигде.
      await expect(page.getByText('current_password:')).toHaveCount(0)

      // Консоль чистая — КРОМЕ самого 400: браузер сообщает о нём как об
      // ошибке загрузки ресурса, а этот 400 здесь и вызван намеренно. Всё
      // остальное (исключения разбора ответа — тот самый «body stream already
      // read») пробу краснит.
      const unexpected = errors.filter((e) => !e.includes('status of 400'))
      expect(unexpected).toEqual([])
    })

    test('слабый новый пароль отбивается сервером по-русски', async ({ page }) => {
      await signIn(page)
      await openProfileDialog(page)

      // Клиент проверяет только длину ≥ 8, поэтому «12345678» доходит до
      // сервера — и должен быть отбит ИМ, а не остаться принятым.
      await page.getByLabel('Текущий пароль').fill('что-угодно-непустое')
      await page.getByLabel('Новый пароль', { exact: true }).fill('12345678')
      await page.getByLabel('Подтвердите новый пароль').fill('12345678')

      const request = page.waitForResponse(
        (r) => r.url().includes('/api/user/change-password/'),
      )
      await page.getByRole('button', { name: 'Изменить пароль' }).click()
      await request

      // Сообщение приходит из валидаторов Django и показывается как есть:
      // проба не пришпиливает точную формулировку (она принадлежит Django и
      // меняется с версией), но требует, чтобы это был русский текст про
      // пароль, а не английский и не код поля.
      const shown = page.locator(
        '#new_password-error, #current_password-error',
      )
      await expect(shown.first()).toBeVisible()
      await expect(shown.first()).toContainText(/парол/i)
    })

    test('несовпадение подтверждения ловится формой, не отправляя ничего на сервер', async ({
      page,
    }) => {
      await signIn(page)
      await openProfileDialog(page)

      let sent = false
      page.on('request', (r) => {
        if (r.url().includes('/api/user/change-password/')) sent = true
      })

      await page.getByLabel('Текущий пароль').fill('что-угодно-непустое')
      await page.getByLabel('Новый пароль', { exact: true }).fill('Тжр7-каспий-берег')
      await page.getByLabel('Подтвердите новый пароль').fill('Тжр7-каспий-другое')
      await page.getByRole('button', { name: 'Изменить пароль' }).click()

      await expect(page.locator('#confirm_password-error')).toHaveText(
        'Пароли не совпадают',
      )
      // Опечатку в подтверждении сервер увидеть не может — ему уходит один
      // пароль. Значит и ходить к нему незачем.
      expect(sent).toBe(false)
    })
  },
)
