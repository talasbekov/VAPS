/**
 * Окно «Создать бюллетень»: кнопка по-настоящему неактивна до обязательных
 * полей (`[БЛН-12]`, Plane №439).
 *
 * До правки кнопка гасла только видом (`aria-disabled`) и кликалась — клик
 * уходил в проверку формы. Теперь `disabled`: клик по ней невозможен, запрос
 * на создание не уходит, а строка под кнопкой называет, чего не хватает.
 * Заполнение обязательного делает кнопку активной.
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

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'окно создания ОМ: обязательные поля' : 'окно создания ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('кнопка «Создать бюллетень» disabled до обязательных, запрос не уходит (Plane №439)', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
    const dialog = page.getByRole('dialog')
    const submit = dialog.getByRole('button', { name: 'Создать бюллетень' })
    await expect(submit).toBeDisabled()
    const hint = dialog.getByTestId('missing-required')
    await expect(hint).toContainText('Заполните:')
    await expect(hint).toContainText('тип')
    await expect(hint).toContainText('название')

    // Красная проверка: запрос на создание не уходит даже при попытке клика.
    let posts = 0
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/ops/security-events')) posts += 1
    })
    await submit.click({ force: true, trial: false }).catch(() => undefined)
    await page.waitForTimeout(500)
    expect(posts, 'неактивная кнопка отправила запрос').toBe(0)

    // Заполняем обязательное по одному — подсказка сжимается, кнопка оживает.
    await dialog.getByRole('button', { name: 'Внутреннее' }).click()
    await expect(hint).not.toContainText('тип')
    await dialog.getByLabel('Дата начала').fill('2026-11-11')
    await dialog.getByLabel('Дата окончания').fill('2026-11-11')
    await dialog.getByLabel('Охраняемые лица').click()
    await page.locator('[data-slot="persons-combobox"] li button').first().click()
    await dialog.getByLabel('Название ОМ').fill('Проба обязательных (e2e)')
    // Страна и город подставляются умолчанием (Казахстан → Астана).
    await expect(dialog.getByLabel('Город')).not.toHaveValue('', { timeout: 15_000 })
    await expect(submit).toBeEnabled()
    await expect(hint).toHaveCount(0)
  })
})
