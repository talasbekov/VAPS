/**
 * Рабочий стол ответственного за сбор сил (Plane №1199, 12.09.2026):
 * «Ежедневный расход» и «Сбор сил на ОМ» открываются ВНУТРИ рабочего стола —
 * из его карточек и из вложенных пунктов меню, — а на экране модуля есть
 * «Назад на рабочий стол».
 *
 * Проба живая и ПИШЕТ ВИДЕО (`video: 'on'`): заказчик просил прогон, который
 * можно посмотреть. Ролик — в `test-results/…/video.webm`, снимки —
 * `smoke-results/1199-*.png`.
 */
import fs from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
const OFFICER = 'role_forces_gathering_officer'

async function signIn(page: Page, username: string): Promise<void> {
  const csrf = await page.request.get(`${APP}/api/auth/csrf/`)
  const csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken
  const response = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken, username, password: ROLE_PASSWORD, json: 'true' },
  })
  expect(((await response.json()) as { url: string }).url, `вход ${username}`).not.toContain('error=')
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  fs.mkdirSync('smoke-results', { recursive: true })
  const body = await page.screenshot({ path: `smoke-results/1199-${name}.png`, fullPage: true })
  await testInfo.attach(name, { body, contentType: 'image/png' })
}

/** Пауза для ролика: без неё переходы мелькают быстрее, чем глаз читает. */
const pause = (page: Page) => page.waitForTimeout(900)

// Видео задаётся на уровне файла: внутри describe Playwright его не принимает.
test.use({ video: 'on', viewport: { width: 1440, height: 900 } })

test.describe('№1199 — модули внутри рабочего стола', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нет пароля ролевых учёток')
  test.setTimeout(150_000)

  test('карточки и вложенные пункты открывают модули; «Назад» возвращает на рабочий стол', async ({ page }, testInfo) => {
    await signIn(page, OFFICER)
    await page.goto(`${APP}/employees`)
    await expect(page.getByRole('heading', { name: 'Рабочий стол', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('link', { name: 'Назад на рабочий стол' })).toHaveCount(0)

    // Меню: оба модуля стоят ВНУТРИ «Рабочего стола» (вложенные пункты).
    const nav = page.locator('aside')
    await expect(nav.getByRole('link', { name: 'Рабочий стол', exact: true })).toHaveCount(1)
    const nested = nav.locator('li[data-nested="true"]')
    await expect(nested).toHaveCount(2)
    await expect(nested.getByRole('link', { name: 'Ежедневный расход', exact: true })).toBeVisible()
    await expect(nested.getByRole('link', { name: 'Сбор сил на ОМ', exact: true })).toBeVisible()
    await pause(page)
    await shot(page, testInfo, '01-desk')

    // Из карточки «Ежедневный расход» → модуль → «Назад».
    await page.getByRole('link', { name: 'Открыть свод' }).first().click()
    await expect(page.getByRole('heading', { name: 'Ежедневный расход', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/view=daily/)
    const back = page.getByRole('link', { name: 'Назад на рабочий стол' })
    await expect(back).toBeVisible()
    await expect(page.getByRole('region', { name: 'Расход департамента' })).toBeVisible({ timeout: 30_000 })
    await pause(page)
    await shot(page, testInfo, '02-daily-with-back')
    await back.click()
    await expect(page.getByRole('heading', { name: 'Рабочий стол', exact: true })).toBeVisible()
    await expect(page).not.toHaveURL(/view=/)
    await pause(page)

    // Из карточки «Сбор сил на ОМ» → модуль → «Назад».
    await page.getByRole('link', { name: 'Открыть заявки' }).click()
    await expect(page.getByRole('heading', { name: 'Сбор сил на ОМ', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/view=forces/)
    await expect(back).toBeVisible()
    await pause(page)
    await shot(page, testInfo, '03-forces-with-back')
    await back.click()
    await expect(page.getByRole('heading', { name: 'Рабочий стол', exact: true })).toBeVisible()
    await pause(page)

    // Те же модули из вложенных пунктов меню; активный пункт подсвечен.
    await nested.getByRole('link', { name: 'Ежедневный расход', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Ежедневный расход', exact: true })).toBeVisible()
    await expect(nested.getByRole('link', { name: 'Ежедневный расход', exact: true })).toHaveAttribute('aria-current', 'page')
    await pause(page)
    await nested.getByRole('link', { name: 'Сбор сил на ОМ', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Сбор сил на ОМ', exact: true })).toBeVisible()
    await expect(nested.getByRole('link', { name: 'Сбор сил на ОМ', exact: true })).toHaveAttribute('aria-current', 'page')
    await pause(page)
    await back.click()
    await expect(page.getByRole('heading', { name: 'Рабочий стол', exact: true })).toBeVisible()
    await pause(page)
    await shot(page, testInfo, '04-desk-again')
  })
})
