/**
 * Порядок и названия вкладок модуля (Plane №273, Ш-1).
 *
 * Требование заказчика дословно: «Внутри модуля первая вкладка это Ежедневный
 * расход Организации. Вторая вкладка Сбор сил на ОМ».
 *
 * Стережёт ТРИ вещи, и третья — та, о которой легко забыть:
 *
 * 1. порядок кнопок;
 * 2. их названия — полные, а не сокращённые: «Расход» и «Сбор сил» на одном
 *    экране не говорят, ЧЕЙ расход и ЧТО собирают;
 * 3. АДРЕС ПО УМОЛЧАНИЮ. Переставить кнопки и оставить умолчанием прежний вид
 *    значило бы, что первая вкладка открывается второй: человек приходит на
 *    `/employees` и попадает не туда, куда показывает подсветка.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe('вкладки модуля', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('первая — расход организации, вторая — сбор сил, и адрес открывает первую', async ({
    page,
  }) => {
    await signIn(page)
    await page.goto(`${APP}/employees`)

    const nav = page.getByRole('navigation', { name: 'Разделы модуля' })
    await expect(nav).toBeVisible({ timeout: 30_000 })

    const labels = await nav.getByRole('button').allTextContents()
    expect(
      labels.map((label) => label.trim()),
      'порядок и названия вкладок — требование заказчика, а не оформление',
    ).toEqual(['Ежедневный расход организации', 'Сбор сил на ОМ'])

    // Адрес БЕЗ параметра открывает ПЕРВУЮ вкладку.
    await expect(
      nav.getByRole('button', { name: 'Ежедневный расход организации' }),
      'первая вкладка не подсвечена на адресе по умолчанию',
    ).toHaveAttribute('aria-current', 'page')

    // Вторая вкладка переключает и подсвечивается сама.
    await nav.getByRole('button', { name: 'Сбор сил на ОМ' }).click()
    await expect(nav.getByRole('button', { name: 'Сбор сил на ОМ' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(
      nav.getByRole('button', { name: 'Ежедневный расход организации' }),
    ).not.toHaveAttribute('aria-current', 'page')
  })
})
