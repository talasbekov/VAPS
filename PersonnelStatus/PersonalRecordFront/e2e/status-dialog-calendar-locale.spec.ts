/**
 * Календарь в диалогах статусов говорит по-русски — ЖИВОЙ стенд (Plane №258).
 *
 * Дефект: шапка календаря печатала «August 2026», дни недели — «Su Mo Tu We Th
 * Fr Sa», а кнопка даты В ТОМ ЖЕ ОКНЕ рядом писала «28 августа 2026» (у неё
 * `format` с `locale: ru`). Локаль не передавал компоненту НИ ОДИН из пяти
 * читателей `components/ui/calendar.tsx`, и умолчание react-day-picker —
 * английский с неделей от воскресенья.
 *
 * Проба стережёт три следствия одной правки, и мутация «убрать `locale = ru`»
 * краснит каждое:
 *   1) месяц в шапке — русский;
 *   2) дни недели — русские;
 *   3) неделя начинается с ПОНЕДЕЛЬНИКА (у `ru` `weekStartsOn: 1`; английское
 *      умолчание ставит первым воскресенье, и сетка сдвинута на день).
 *
 * Числа месяца одинаковы на обоих языках, поэтому проверять надо ИМЕННО
 * подписи: ассерт «в календаре есть 15» прошёл бы и на английском.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

const RU_MONTHS =
  /(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i

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

test.describe(LIVE ? 'статусы: язык календаря' : 'статусы/календарь (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('календарь заведения статуса печатает месяц и дни недели по-русски', async ({ page }) => {
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })

    const staffedRow = page
      .locator('table tbody tr')
      .filter({ hasNot: page.getByText('ВАКАНТ') })
      .first()
    await staffedRow.getByRole('button', { name: /^Действия:/ }).click()
    await page.getByRole('menuitem', { name: 'Запланировать статус' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 20_000 })

    // СРОЧНЫЙ тип статуса выбирается пробой, а не берётся какой достался: у
    // «В строю» (частое умолчание строки) полей дат НЕТ ВОВСЕ — окно
    // открывается без календаря, и проба падала бы на данных стенда, а не на
    // дефекте. Первый прогон в связке так и упал: первой строке досталось
    // бессрочное «В строю».
    await dialog.getByRole('combobox', { name: /Новый статус/ }).click()
    await page.getByRole('option', { name: 'Командировка' }).click()

    // Кнопка даты подписана меткой поля («Дата начала *»), а не своим текстом:
    // ярлык связан с ней программно, и доступное имя приходит из него.
    await dialog.getByRole('button', { name: /^Дата начала/ }).click()

    // Слой календаря, а не `getByRole('grid')`: гридов на странице бывает
    // несколько (таблица, вид «Календарь статусов»), и `.first()` мог взять
    // чужой.
    const calendar = page.locator('[data-slot=calendar]').first()
    await expect(calendar).toBeVisible({ timeout: 10_000 })

    // (1) МЕСЯЦ.
    await expect(calendar).toContainText(RU_MONTHS)
    await expect(calendar).not.toContainText(
      /January|February|March|April|May|June|July|August|September|October|November|December/,
    )

    // (2) ДНИ НЕДЕЛИ и (3) ПОРЯДОК: первый столбец — понедельник, а не Su.
    // Селектор по классу `rdp-weekday`, а не по роли: react-day-picker рисует
    // шапку недели ячейками `<th>` без `scope`, и роли `columnheader` у них
    // нет — `getByRole('columnheader')` находит НОЛЬ элементов и ассерт был бы
    // зелёным на любом языке.
    const weekdays = await calendar.locator('.rdp-weekday').allInnerTexts()
    expect(weekdays.length, 'в шапке недели не семь столбцов').toBe(7)
    expect(weekdays[0].toLowerCase(), 'неделя начинается не с понедельника').toContain('пн')
    expect(
      weekdays.join(' '),
      `дни недели не по-русски: ${weekdays.join(' ')}`,
    ).not.toMatch(/Su|Mo|Tu|We|Th|Fr|Sa/)

    // (4) ПОДПИСИ ЛИСТАНИЯ — их читает скринридер, и локаль до них не доходит.
    await expect(page.getByRole('button', { name: 'Предыдущий месяц' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Следующий месяц' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Go to the (Previous|Next) Month/ })).toHaveCount(
      0,
    )
  })
})
