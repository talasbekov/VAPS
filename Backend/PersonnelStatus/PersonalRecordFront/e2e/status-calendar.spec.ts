/**
 * Календарь статусов, вид «Месяц» (Plane №270, Ш-3).
 *
 * Стережёт то, ради чего вид переписан: сетка месяца показывает ЗАНЯТОСТЬ по
 * дням, посчитанную сервером по всей области, а не раскладку текущих статусов
 * загруженной страницы состава (так делал прежний вид на FullCalendar).
 *
 * Красная на мутации «рисовать точки из `results` вместо `summary`»: состав
 * области больше страницы, и число в ячейке разошлось бы со сводкой.
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

test.describe('календарь статусов', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('вкладка показывает месячную сетку с легендой и выбором дня', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/statuses`)

    await page.getByRole('tab', { name: 'Календарь статусов' }).click()

    const grid = page.getByRole('grid', { name: /Занятость/ })
    await expect(grid).toBeVisible({ timeout: 30_000 })

    // Дни месяца — кнопки: день выбирается, и выбор виден (им живёт панель Ш-4).
    const days = grid.getByRole('button')
    await expect(days.first()).toBeVisible()
    const count = await days.count()
    expect(count, 'в сетке должны быть все дни месяца').toBeGreaterThanOrEqual(28)

    const first = days.first()
    await first.click()
    await expect(first).toHaveAttribute('aria-pressed', 'true')

    // Смысл не держится на одном цвете: у каждого дня есть подпись словами.
    const label = await first.getAttribute('aria-label')
    expect(label, 'у дня обязана быть подпись для чтения с экрана').toBeTruthy()
    expect(label ?? '').toMatch(/занятости нет|на дежурстве|задействованы в ом|отсутствуют/i)

    // Легенда называет все три группы — цвет сам по себе ничего не сообщает.
    for (const name of ['На дежурстве', 'Задействованы в ОМ', 'Отсутствуют']) {
      await expect(page.getByText(name, { exact: true })).toBeVisible()
    }

    // Состав, по которому считается сводка, назван числом и своими словами.
    await expect(page.getByText(/Сводка по \d+ сотрудникам области/)).toBeVisible()
  })

  test('месяц переключается стрелками и возвращается кнопкой «Сегодня»', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/statuses`)
    await page.getByRole('tab', { name: 'Календарь статусов' }).click()

    const grid = page.getByRole('grid', { name: /Занятость/ })
    await expect(grid).toBeVisible({ timeout: 30_000 })
    const initial = await grid.getAttribute('aria-label')

    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await expect
      .poll(async () => grid.getAttribute('aria-label'), { timeout: 15_000 })
      .not.toBe(initial)

    await page.getByRole('button', { name: 'Сегодня' }).click()
    await expect
      .poll(async () => grid.getAttribute('aria-label'), { timeout: 15_000 })
      .toBe(initial)
  })
})

test.describe('панель занятости за день', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('панель называет три группы поимённо и «в строю» числом', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/statuses`)
    await page.getByRole('tab', { name: 'Календарь статусов' }).click()

    const grid = page.getByRole('grid', { name: /Занятость/ })
    await expect(grid).toBeVisible({ timeout: 30_000 })

    const panel = page.getByRole('complementary', { name: 'Занятость за выбранный день' })
    await expect(panel).toBeVisible()

    // Три группы эталона названы и несут СВОЙ счётчик.
    for (const name of ['На дежурстве', 'Задействованы в ОМ', 'Отсутствуют']) {
      await expect(panel.getByRole('heading', { name: new RegExp(name) })).toBeVisible()
    }

    // «В строю» — числом из состава, а не списком: поимённо это весь состав.
    await expect(panel.getByText(/В строю:\s*\d+\s*из\s*\d+/)).toBeVisible()

    // Клик по другому дню меняет заголовок панели: она читает ТОТ ЖЕ выбор,
    // что подсвечен в сетке, а не свой собственный.
    const before = await panel.getByRole('heading', { level: 3 }).textContent()
    const days = grid.getByRole('button')
    await days.nth(1).click()
    await expect
      .poll(async () => panel.getByRole('heading', { level: 3 }).textContent(), {
        timeout: 15_000,
      })
      .not.toBe(before)
  })
})
