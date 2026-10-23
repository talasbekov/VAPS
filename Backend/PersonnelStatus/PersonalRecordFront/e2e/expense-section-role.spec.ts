/**
 * Роль РАЗДЕЛА открывает цикл расхода (Plane №325).
 *
 * Что было. Экраны «Ежедневный расход» и «Управление статусами» гейтились
 * КАДРОВОЙ ролью (ROLE_3/6/7), а у 28 ролевых учёток раздела кадровая роль —
 * ROLE_1 «Просмотр организации». Цикл проходили ЧЕТЫРЕ учётки из 38; не
 * проходила ни одна роль раздела, включая `role_department_expense_officer`
 * («ответственный за расход департамента») и `role_division_operator`,
 * который по замыслу и проставляет статусы.
 *
 * Решение заказчика 30.08.2026: роль раздела ДАЁТ кадровый доступ.
 *
 * Проба держит три конца:
 *   1) учётка с правом раздела `status.view` видит СОДЕРЖИМОЕ, а не отказ;
 *   2) шапка называет роль РАЗДЕЛА, а не только кадровую ROLE_1 — человек
 *      работает под ней, и до №325 он видел не ту роль;
 *   3) учётка БЕЗ `status.view` по-прежнему получает отказ — расширение не
 *      превратилось в «пускать всех». Этот конец держит `directorate-denial`
 *      (там `role_viewer`… нет: у него право есть). Здесь — `role_ops_reader`.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
const VIEW_USERNAME = process.env.EXPENSE_VIEW_USERNAME ?? 'role_division_operator'
const DENIED_USERNAME = process.env.EXPENSE_DENIED_USERNAME ?? 'role_ops_reader'

async function signIn(page: Page, username: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  const response = await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
  expect(response.status(), `вход ${username} не принят`).toBe(200)
}

/** Права роли — С БЭКЕНДА по токену, а не списком в коде: справочник ролей
 *  меняется, и вшитый список разошёлся бы с ним молча. */
async function permissionsOf(username: string): Promise<{ permissions: Set<string>; roles: { name: string }[] }> {
  const tokenRes = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  })
  expect(tokenRes.status, `учётка ${username} не получила токен`).toBe(200)
  const { access } = (await tokenRes.json()) as { access: string }
  const res = await fetch(`${API}/api/operations/my-permissions/`, {
    headers: { Authorization: `Bearer ${access}` },
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { permissions?: string[]; roles?: { name: string }[] }
  return { permissions: new Set(body.permissions ?? []), roles: body.roles ?? [] }
}

test.describe(LIVE ? 'расход под ролью раздела' : 'расход под ролью раздела (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(PASSWORD === '', 'нужен ROLE_ACCOUNTS_PASSWORD')

  test('оператор подразделения видит статусы и свою роль раздела в шапке', async ({ page }) => {
    const actor = await permissionsOf(VIEW_USERNAME)
    expect(
      actor.permissions.has('status.view') || actor.permissions.has('*'),
      `у ${VIEW_USERNAME} нет status.view — проба проверяла бы не то`,
    ).toBe(true)
    expect(actor.roles.length, 'нет роли раздела — нечего сверять с шапкой').toBeGreaterThan(0)

    await signIn(page, VIEW_USERNAME)
    await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })

    // СОДЕРЖИМОЕ, а не отказ: ждём счётчик шапки экрана.
    const staffSummary = page.locator('dl[aria-label="Сводка статусов"] > div')
      .filter({ has: page.getByText('Сотрудников', { exact: true }) })
    await expect(staffSummary.getByRole('definition')).toHaveText(/^\d+$/, { timeout: 30_000 })
    await expect(
      page.getByText('Недостаточно прав для просмотра этого раздела.'),
    ).toBeHidden()

    // Шапка называет роль РАЗДЕЛА. Имя роли берётся с сервера, не из литерала.
    const header = page.locator('header').first()
    await expect(header.getByLabel('Рабочая роль', { exact: true })).toBeVisible()
    for (const role of actor.roles) await expect(header).toContainText(role.name)

    // Плашка про «ограниченные права» кадровой роли снята: она утверждала бы
    // неправду рядом с рабочим экраном.
    await expect(page.getByText(/имеет ограниченные права доступа/)).toBeHidden()
  })

  test('роль без status.view по-прежнему получает отказ', async ({ page }) => {
    const actor = await permissionsOf(DENIED_USERNAME)
    expect(actor.permissions.has('status.view') || actor.permissions.has('*'),
      `у ${DENIED_USERNAME} есть status.view — отказ проверять нельзя`).toBe(false)

    await signIn(page, DENIED_USERNAME)
    await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })

    // Отказ печатает ГЕЙТ МОДУЛЯ, а не ручка: с Ш-1 (Plane №352) пункт
    // «Статусы» закрыт правом `status.view` на самой странице, и запроса к
    // `staff-units/directorate/` не случается вовсе. Проба держит прежний
    // конец — «без права раздела экран не открывается», — но ждёт тот текст,
    // который человек видит на деле (правлено в Ш-3, №360).
    await expect(
      page.getByText('Недостаточно прав для просмотра статусов сотрудников.'),
    ).toBeVisible({ timeout: 30_000 })
  })
})
