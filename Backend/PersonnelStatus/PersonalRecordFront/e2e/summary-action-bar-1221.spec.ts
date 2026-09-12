/**
 * Отправка свода дежурному — ГЛАВНОЕ действие экрана ответственного
 * (Plane №1221, `[РАСХ-РШ-03]`, §20.4 п.6).
 *
 * До карточки сборка и отправка жили в блоке «Суточный свод» ПОД таблицей, а
 * состояние свода читалось только по тому, какая кнопка отрисована. Теперь:
 *  - регион «Суточный свод» стоит в верхнем блоке «Сдали N из M» (выше
 *    таблицы) и несёт чип состояния `role="status"` с полным текстом
 *    («Свод не собран» / «Свод собран … ожидает отправки» / «Отправлен …»)
 *    и одну главную кнопку по состоянию;
 *  - история версий ниже — отдельный регион «Версии свода» БЕЗ кнопок:
 *    главное действие на экране одно, а не два одинаковых.
 *
 * Проба ЖИВАЯ (`SMOKE_LIVE=1`), только чтение: свод не собирает и не
 * отправляет — сборка на общем стенде меняла бы состояние дня для соседних
 * проб. Полный путь «собрать → отправить» стережёт `department-summary.spec.ts`.
 */
import { expect, test, type Page } from '@playwright/test'

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

test.describe('№1221 — свод: чип состояния и главная кнопка в верхнем блоке', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нет пароля ролевых учёток')

  test('регион «Суточный свод» стоит выше таблицы, чип состояния — role=status, история — отдельный регион без кнопок', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page, OFFICER)
    await page.goto(`${APP}/employees?view=daily`, { waitUntil: 'networkidle' })

    const screen = page.getByRole('region', { name: 'Расход департамента' })
    const summary = screen.getByRole('region', { name: 'Суточный свод' })
    await expect(summary).toBeVisible({ timeout: 60_000 })

    // Чип состояния — один, атомарный, с полным текстом (не голый бейдж).
    const chip = summary.getByRole('status').filter({ hasText: /^Свод (не собран|собран|отправлен)/i })
    await expect(chip).toHaveCount(1)
    await expect(chip).toHaveAttribute('aria-atomic', 'true')

    // Главная кнопка — по состоянию, и ровно одна из ступеней.
    const main = summary.getByRole('button', { name: /^(Собрать свод|Отправить дежурному)$/ })
    const sentAlready = await summary.getByText(/^Отправлено /).count()
    if (sentAlready === 0) await expect(main).toHaveCount(1)

    // Регион стоит ВЫШЕ таблицы по бланку.
    const table = screen.getByRole('table')
    const summaryBox = await summary.boundingBox()
    const tableBox = await table.first().boundingBox()
    expect(summaryBox, 'регион свода без геометрии').not.toBeNull()
    expect(tableBox, 'таблица без геометрии').not.toBeNull()
    expect((summaryBox as { y: number }).y, 'регион «Суточный свод» должен стоять выше таблицы').toBeLessThan((tableBox as { y: number }).y)

    // История версий — отдельный регион, кнопок ступеней в нём нет.
    const history = screen.getByRole('region', { name: 'Версии свода' })
    await expect(history).toBeVisible()
    await expect(history.getByRole('button', { name: /^(Собрать свод|Отправить дежурному|Подтвердить отправку)$/ })).toHaveCount(0)
  })
})
