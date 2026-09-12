/**
 * Два рабочих места и правка статусов «Руководства» (Plane №1223, решение
 * заказчика 12.09.2026, RAW/README §23 `[РАСХ-РШ-05]`–`[РАСХ-РШ-07]`).
 *
 *  • «Свод по Службе» открывается ОПЕРАТИВНОМУ ДЕЖУРНОМУ (`DUTY_OFFICER`),
 *    а ответственному за сбор сил — нет: у него свой «Свод департамента».
 *  • В дневном срезе есть строка «Руководство Службы» — сотрудники,
 *    прикреплённые к корню организации; она раскрывается до людей, и у
 *    каждого есть «Проставить» (право `status.manage_root`). Люди
 *    департаментов ниже — по-прежнему без кнопок.
 *  • У ответственного строка «Руководство департамента» раскрывается до
 *    людей с «Проставить» (право `status.manage` в области департамента).
 *
 * Проба ЖИВАЯ и только читает: статусов не ставит (это меняло бы день на
 * общем стенде). Серверный запрет «дежурный не правит департамент» стережёт
 * `test_duty_officer_status_scope.py`.
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

test.describe('№1223 — рабочие места дежурного и ответственного', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нет пароля ролевых учёток')

  test('«Свод по Службе» — дежурному; «Руководство Службы» раскрывается с «Проставить»', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page, 'role_duty_officer')
    await page.goto(`${APP}/security-ops/service-summary`, { waitUntil: 'domcontentloaded' })
    const region = page.getByRole('region', { name: 'Свод по Службе', exact: true })
    await expect(region).toBeVisible({ timeout: 30_000 })
    await expect(region.getByText('Загрузка структуры и сдач…')).toHaveCount(0, { timeout: 30_000 })

    const leadership = region.getByRole('group', { name: 'Руководство Службы' }).first()
    await expect(leadership).toBeVisible()
    await leadership.getByRole('button', { name: /Руководство Службы/ }).click()
    await expect(leadership.getByText('Загрузка личного состава…')).toHaveCount(0, { timeout: 15_000 })
    const people = leadership.getByRole('listitem')
    if ((await people.count()) > 0) {
      await expect(people.first().getByRole('button', { name: /^Проставить/ })).toBeVisible()
    } else {
      await expect(leadership.getByText('В подразделении никого нет')).toBeVisible()
    }
  })

  test('ответственному «Свод по Службе» закрыт', async ({ page }) => {
    await signIn(page, 'role_forces_gathering_officer')
    await page.goto(`${APP}/security-ops/service-summary`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Недостаточно прав для просмотра свода по Службе.')).toBeVisible({ timeout: 25_000 })
    await expect(page.getByRole('region', { name: 'Свод по Службе', exact: true })).toHaveCount(0)
  })

  test('у ответственного «Руководство департамента» раскрывается до людей с «Проставить»', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page, 'role_forces_gathering_officer')
    await page.goto(`${APP}/employees?view=daily`, { waitUntil: 'networkidle' })
    const screen = page.getByRole('region', { name: 'Расход департамента' })
    await expect(screen.getByRole('table')).toBeVisible({ timeout: 60_000 })
    const lead = screen.getByRole('button', { name: /Руководство департамента/ })
    await expect(lead).toBeVisible()
    await lead.click()
    await expect(screen.getByText('Загрузка сотрудников…')).toHaveCount(0, { timeout: 15_000 })
    const rows = screen.locator('[data-slot="lead-people"] [data-slot="person"]')
    if ((await rows.count()) > 0) {
      await expect(rows.first().getByRole('button', { name: /^Проставить/ })).toBeVisible()
    } else {
      await expect(screen.locator('[data-slot="lead-people"]').getByText('Нет сотрудников на выбранную дату.')).toBeVisible()
    }
  })
})
