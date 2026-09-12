/**
 * Вид оперативного дежурного по одобренному макету (Plane №1232, решение
 * заказчика 12.09.2026, RAW/README §23.4 `[РАСХ-РШ-09]`–`[РАСХ-РШ-10]`).
 *
 *  • свод Службы дежурный ТОЛЬКО собирает — кнопки «Отправить дежурному»
 *    на уровне Службы нет нигде в регионе;
 *  • чип состояния свода Службы (`role="status"`) и одна кнопка «Собрать
 *    свод Службы» (или чип «собран», если уже собран);
 *  • дерево — таблица с числовыми колонками «Список», «В строю», «Откл.»;
 *  • у каждого департамента есть строка «Руководство департамента»;
 *  • история — регион «Версии свода Службы»;
 *  • режим «Диапазон» — плитки дневных срезов, ровно одна нажата.
 *
 * Проба ЖИВАЯ и только читает: свод Службы не собирает (это меняло бы день
 * на общем стенде).
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

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

test.describe('№1232 — свод по Службе глазами дежурного', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нет пароля ролевых учёток')

  test('день: чип и «Собрать свод Службы», без отправки; таблица с числами; руководство департамента; версии', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page, 'role_duty_officer')
    await page.goto(`${APP}/security-ops/service-summary`, { waitUntil: 'domcontentloaded' })
    const region = page.getByRole('region', { name: 'Свод по Службе', exact: true })
    await expect(region).toBeVisible({ timeout: 30_000 })
    await expect(region.getByText('Загрузка структуры и сдач…')).toHaveCount(0, { timeout: 30_000 })

    await expect(region.getByRole('button', { name: /Отправить дежурному/ })).toHaveCount(0)
    const chip = region.getByRole('status').filter({ hasText: /^Свод Службы/ })
    await expect(chip).toHaveCount(1)
    const assembled = /собран/i.test((await chip.innerText()).replace('не собран', ''))
    if (!assembled) await expect(region.getByRole('button', { name: 'Собрать свод Службы' })).toBeVisible()

    const table = region.getByRole('table', { name: 'Служба по департаментам' })
    await expect(table).toBeVisible()
    for (const column of ['Список', 'В строю', 'Откл.']) {
      await expect(table.getByRole('columnheader', { name: column })).toBeVisible()
    }
    await expect(table.getByRole('row', { name: /Руководство Службы/ })).toHaveCount(1)

    // Раскрыть первый департамент — под ним строка «Руководство департамента».
    const departmentButtons = table.getByRole('button', { name: /^Раскрыть: (?!Руководство)/ })
    expect(await departmentButtons.count(), 'на стенде нет ни одного департамента').toBeGreaterThan(0)
    await departmentButtons.first().click()
    await expect(table.getByRole('row', { name: /Руководство департамента/ }).first()).toBeVisible()

    await expect(region.getByRole('region', { name: 'Версии свода Службы' })).toBeVisible()
  })

  test('диапазон: плитки дневных срезов, одна нажата, срез — по нажатой', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page, 'role_duty_officer')
    await page.goto(`${APP}/security-ops/service-summary`, { waitUntil: 'domcontentloaded' })
    const region = page.getByRole('region', { name: 'Свод по Службе', exact: true })
    await expect(region).toBeVisible({ timeout: 30_000 })
    await expect(region.getByText('Загрузка структуры и сдач…')).toHaveCount(0, { timeout: 30_000 })
    const heading = region.getByRole('heading', { level: 2 }).first()
    const from = (await heading.innerText()).match(/(\d{2})\.(\d{2})\.(\d{4})/)
    expect(from, 'заголовок среза без даты').not.toBeNull()
    const iso = `${from![3]}-${from![2]}-${from![1]}`
    await page.goto(`${APP}/security-ops/service-summary?dateFrom=${iso}&dateTo=${addDays(iso, 2)}`, { waitUntil: 'domcontentloaded' })
    const tiles = region.getByRole('tablist', { name: 'Дневные срезы диапазона' }).getByRole('tab')
    await expect(tiles).toHaveCount(3, { timeout: 30_000 })
    await expect(region.getByRole('tab', { selected: true })).toHaveCount(1)
    await tiles.nth(1).click()
    await expect(tiles.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(region.getByRole('heading', { level: 2 }).first()).toContainText(addDays(iso, 1).split('-').reverse().join('.'))
  })
})
