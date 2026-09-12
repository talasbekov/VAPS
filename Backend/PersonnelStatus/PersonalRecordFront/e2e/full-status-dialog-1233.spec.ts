/**
 * «Проставить» на сводах открывает ПОЛНОЕ окно статуса модуля «Статусы
 * сотрудников» (Plane №1233, решение заказчика 12.09.2026, `[РАСХ-РШ-11]`),
 * а не урезанное окно борда (одна дата, только код статуса).
 *
 * Признак полного окна — заголовок «Статусы сотрудника» и поле «Комментарий»
 * (`EditStatusDialog`); у урезанного заголовок «Статус на <дата>» и поля
 * комментария нет. Проба ЖИВАЯ и только читает: окно открывается и
 * закрывается без сохранения.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''

async function signIn(page: Page, username: string): Promise<void> {
  const csrf = await page.request.get(`${APP}/api/auth/csrf/`)
  const csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken
  const response = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken, username, password: ROLE_PASSWORD, json: 'true' },
  })
  expect(((await response.json()) as { url: string }).url, `вход ${username}`).not.toContain('error=')
}

test.describe('№1233 — полное окно статуса со свода', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нет пароля ролевых учёток')

  test('ответственный: «Проставить» у человека открывает «Статусы сотрудника» с комментарием и датами', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page, 'role_forces_gathering_officer')
    await page.goto(`${APP}/employees?view=daily`, { waitUntil: 'networkidle' })
    const screen = page.getByRole('region', { name: 'Расход департамента' })
    await expect(screen.getByRole('table')).toBeVisible({ timeout: 60_000 })

    // Спуск до людей: управление → первый отдел (или само управление).
    const directorate = screen.getByRole('table').getByRole('button', { expanded: false }).filter({ hasNotText: 'Руководство департамента' }).first()
    await directorate.click()
    const section = screen.getByRole('table').getByRole('button', { expanded: false }).filter({ hasNotText: 'Руководство департамента' }).first()
    if ((await section.count()) > 0) await section.click()
    const pick = screen.getByRole('button', { name: /^Проставить статус: / }).first()
    await expect(pick).toBeVisible({ timeout: 30_000 })
    const who = ((await pick.getAttribute('aria-label')) ?? '').replace('Проставить статус: ', '')
    await pick.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Статусы сотрудника')).toBeVisible()
    await expect(dialog.getByText(who)).toBeVisible()
    await expect(dialog.getByLabel('Комментарий')).toBeVisible()
    await expect(dialog.getByText(/Статус на \d{4}-\d{2}-\d{2}/)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })
})
