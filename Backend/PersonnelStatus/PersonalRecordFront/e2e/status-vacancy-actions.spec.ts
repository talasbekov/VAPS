/**
 * Меню действий у ВАКАНТНОЙ строки таблицы статусов — ЖИВОЙ стенд (Plane №257).
 *
 * Дефект: три пункта меню прятались у вакансии явной проверкой имени, а
 * четвёртый — «Запланировать статус» — оставался. Окно открывалось, форма
 * заполнялась, сохранение падало в «Сотрудник не найден»: у вакансии сотрудника
 * нет вовсе. Тот же класс, что и №255 — меню обещает операцию, которой нет.
 *
 * Проба стережёт обе половины правки и падает на мутации каждой:
 *   1) вернуть пункт «Запланировать статус» вакансии — красен первый ассерт;
 *   2) убрать объясняющую строку (спрятать меню целиком) — красен второй:
 *      пустое место в столбце действий читается как «кнопку забыли», и
 *      пользователь не узнаёт, почему действий нет.
 *
 * Строка ищется по подписи «ВАКАНТ» в самой таблице, а не по данным стенда:
 * незанятые штатные единицы там есть всегда, но у КОНКРЕТНОЙ фамилии места
 * меняются от прогона к прогону.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /тему|theme/i }).first()).toBeEnabled({
    timeout: 20_000,
  })
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'статусы: действия у вакансии' : 'статусы/вакансия (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('вакансии не предлагается ни одного действия, и причина названа', async ({ page }) => {
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })

    const vacancyRow = page.locator('table tbody tr', { hasText: 'ВАКАНТ' }).first()
    await expect(
      vacancyRow,
      'на первой странице таблицы нет ни одной вакантной строки — проверять нечего',
    ).toBeVisible({ timeout: 25_000 })

    await vacancyRow.getByRole('button', { name: /^Действия:/ }).click()

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()

    // (1) НИ ОДНОГО работающего пункта: все четыре адресованы человеку.
    for (const label of [
      'Запланировать статус',
      'Запланированные статусы',
      'Откомандировать сотрудника',
      'Просмотр профиля',
    ]) {
      await expect(
        menu.getByRole('menuitem', { name: label }),
        `у вакансии предлагается «${label}» — операции, которой нет`,
      ).toHaveCount(0)
    }

    // (2) ПРИЧИНА НАЗВАНА, а не пустое меню.
    await expect(menu.getByText('Должность вакантна — действий нет')).toBeVisible()
  })

  test('занятой строке меню действий по-прежнему предлагается', async ({ page }) => {
    // Парная проба: правка не должна была погасить меню ВСЕМ. Без неё «спрятать
    // меню у всех подряд» прошло бы первую пробу насквозь.
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })

    const staffedRow = page
      .locator('table tbody tr')
      .filter({ hasNot: page.getByText('ВАКАНТ') })
      .first()
    await expect(staffedRow).toBeVisible({ timeout: 25_000 })
    await staffedRow.getByRole('button', { name: /^Действия:/ }).click()

    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: 'Запланировать статус' })).toBeVisible()
    await expect(menu.getByText('Должность вакантна — действий нет')).toHaveCount(0)
  })
})
