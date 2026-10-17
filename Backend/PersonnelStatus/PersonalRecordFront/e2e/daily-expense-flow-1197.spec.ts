/**
 * Проходка «Ежедневный расход» по замыслу заказчика (Plane №1197, 12.09.2026).
 *
 * Шаг 1 — начальник управления на `/statuses`: выбирает дату (по умолчанию
 * завтра сервера, можно любой день вперёд) и сдаёт день с той же страницы.
 * Шаг 2 — ответственный на `/employees?view=daily` проверяет сдачу,
 * собирает свод и явно отправляет его, при неполноте указывает причину.
 * Шаг 3 — дежурный читает ту же отправленную версию и её основание.
 *
 * Проба пишет настоящую сдачу и свод только в изолированном клоне
 * (SMOKE_ISOLATED_CLONE=1, явные SMOKE_APP / SMOKE_API). Ищет свободную
 * дату для обоих уровней; оставляет данные в клоне для проверки.
 * Снимки — `smoke-results/1197-*.png`.
 */
import fs from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
const HEAD = 'role_directorate_head'
const OFFICER = process.env.UX_DEPARTMENT_USER ?? 'role_department_expense_officer'
const DUTY = 'role_duty_officer'
type Submission = { id: number; version: number; is_current: boolean; sent_at: string | null; incomplete_reason: string }

async function token(username: string): Promise<string> {
  const response = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: ROLE_PASSWORD }),
  })
  expect(response.status, `учётка ${username} не получила токен`).toBe(200)
  return ((await response.json()) as { access: string }).access
}

async function getJson<T>(path: string, access: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${access}` } })
  expect(response.status, `${path}: ${await response.clone().text()}`).toBe(200)
  return (await response.json()) as T
}

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
  const videoCapture = process.env.WALKTHROUGH_VIDEO_CAPTURE === '1'
  // Keep the recorded viewport stable and let each verified stage be read.
  // Ordinary regression runs retain the complete-page screenshots.
  if (videoCapture) await page.waitForTimeout(1500)
  const body = await page.screenshot({ path: `smoke-results/1197-${name}.png`, fullPage: !videoCapture })
  await testInfo.attach(name, { body, contentType: 'image/png' })
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

test.describe('№1197 — проходка ежедневного расхода', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нет пароля ролевых учёток')
  test.skip(process.env.SMOKE_ISOLATED_CLONE !== '1', 'сдача и отправка разрешены только на клоне: SMOKE_ISOLATED_CLONE=1')
  test.setTimeout(240_000)

  test('три роли: начальник проверяет и сдаёт расход → ответственный собирает и отправляет → дежурный читает ту же версию', async ({ page }, testInfo) => {
    expect(process.env.SMOKE_APP, 'задайте адрес фронта клона').toBeTruthy()
    expect(process.env.SMOKE_API, 'задайте адрес API клона').toBeTruthy()
    // ── Разведка по API: область роли и свободная дата ────────────────────
    const headToken = await token(HEAD)
    const me = await getJson<{ roles: { code: string; scope_division_id: number | null; scope_division_name: string | null }[] }>(
      '/api/operations/my-permissions/', headToken,
    )
    const scope = me.roles.find((role) => role.code === 'DIRECTORATE_HEAD' && role.scope_division_id !== null)
    expect(scope, 'у role_directorate_head нет области управления').toBeTruthy()
    const divisionId = scope!.scope_division_id as number
    const tomorrow = (await getJson<{ business_date: string }>('/api/operations/tomorrow-block/', headToken)).business_date
    const officerToken = await token(OFFICER)
    const dutyToken = await token(DUTY)
    const officer = await getJson<{ permissions: string[]; roles: { code: string; scope_division_id: number | null }[] }>(
      '/api/operations/my-permissions/', officerToken,
    )
    const departmentRole = officer.roles.find(role => role.code === 'DEPARTMENT_EXPENSE_OFFICER' && role.scope_division_id !== null)
      ?? officer.roles.find(role => role.code === 'FORCES_GATHERING_OFFICER' && role.scope_division_id !== null)
    const department = departmentRole?.scope_division_id
    expect(department, 'ответственному нужен департамент').toBeTruthy()
    expect(officer.permissions.some(code => code === 'daily_report.generate' || code === '*'),
      `${OFFICER}: нужно право сборки и отправки свода`).toBe(true)
    const divisions = await getJson<{ results: { id: string; parent_id: string | null; name: string }[] }>(
      `/api/ops/daily/divisions/?business_date=${tomorrow}`, officerToken,
    )
    const own = divisions.results.find((row) => row.id === String(divisionId))
    expect(own?.parent_id, 'роли должны работать в одной цепочке управления и департамента').toBe(String(department))
    const departmentName = divisions.results.find(row => row.id === String(department))?.name
    expect(departmentName, 'департамент должен присутствовать в доступной структуре').toBeTruthy()

    let businessDate: string | null = null
    for (let offset = 5; offset < 60; offset += 1) {
      const candidate = addDays(tomorrow, offset)
      const list = await getJson<{ count: number }>(
        `/api/ops/daily/daily-submissions/?division_id=${divisionId}&business_date=${candidate}`, headToken,
      )
      const summary = await getJson<{ count: number }>(
        `/api/ops/daily/daily-submissions/?division_id=${department}&business_date=${candidate}`, officerToken,
      )
      if (list.count === 0 && summary.count === 0) { businessDate = candidate; break }
    }
    expect(businessDate, 'в окне нет свободной даты').not.toBeNull()

    // ── Шаг 1: «Статусы сотрудников», дата по умолчанию — завтра сервера ──
    await signIn(page, HEAD)
    await page.goto(`${APP}/statuses`)
    const close = page.getByRole('region', { name: 'Сдача дня за управление' })
    await expect(close).toBeVisible({ timeout: 30_000 })
    await expect(close.locator('#status-business-date')).toHaveValue(tomorrow)
    await expect(close.getByText('Завтра', { exact: true })).toBeVisible()
    await expect(page).not.toHaveURL(/businessDate=/)
    await shot(page, testInfo, '01-statuses-default-tomorrow')

    // ── Дата на 5+ дней вперёд: раньше клиент отказывал «только сегодня или завтра» ──
    await close.locator('#status-business-date').fill(businessDate as string)
    await expect(page).toHaveURL(new RegExp(`businessDate=${businessDate}`))
    await expect(close.getByLabel('Расход на дату', { exact: true }).and(close.locator('input[type="date"]'))).toHaveValue(businessDate as string)
    await expect(close.getByRole('button', { name: 'Вернуть завтра', exact: true })).toBeVisible()
    await expect(close.getByText('Дата относится только к расходу и сдаче дня. Текущие статусы в таблице меняются с сегодняшнего дня.', { exact: true })).toBeVisible()
    const report = await getJson<{ totals: { list_total: number } }>(
      `/api/operations/strength-report/?business_date=${businessDate}&division_id=${divisionId}`, headToken,
    )
    await expect(close.getByLabel('Числа расхода')).toBeVisible()
    await close.getByRole('button', { name: 'Сдать день' }).click()
    const formattedDate = (businessDate as string).split('-').reverse().join('.')
    await expect(close.getByText(`Сдать расход за ${formattedDate}? Сотрудников по списку: ${report.totals.list_total}.`, { exact: true })).toBeVisible()
    await expect(close.getByText('Сдать можно только за сегодня или завтра.')).toHaveCount(0)
    await close.getByRole('button', { name: 'Подтвердить сдачу' }).click()
    await expect(close.getByText(/День сдан: v1/)).toBeVisible({ timeout: 20_000 })
    await shot(page, testInfo, '02-statuses-day-submitted')

    const after = await getJson<{ count: number }>(
      `/api/ops/daily/daily-submissions/?division_id=${divisionId}&business_date=${businessDate}`, headToken,
    )
    expect(after.count, 'сдача не дошла до сервера').toBe(1)

    // ── Шаг 2: ответственный за сбор сил видит сдачу управления на ту же дату ──
    test.info().annotations.push({ type: 'scope', description: `управление ${divisionId} → департамент ${department}; дата ${businessDate}` })

    await signIn(page, OFFICER)
    await page.goto(`${APP}/employees?view=daily&businessDate=${businessDate}`)
    const screen = page.getByRole('region', { name: 'Расход департамента' })
    await expect(screen).toBeVisible({ timeout: 30_000 })
    await expect(screen.getByText(/Сдали \d+ из \d+/)).toBeVisible({ timeout: 30_000 })
    // Таблица по бланку: «Руководство» первой строкой, «ИТОГО» последней, колонки бланка.
    await expect(screen.getByRole('row', { name: /Руководство департамента/ })).toBeVisible()
    await expect(screen.getByRole('row', { name: /ИТОГО по департаменту/ })).toBeVisible()
    for (const head of ['Штат', 'Список', 'В строю', 'Вакансии']) {
      await expect(screen.getByRole('columnheader', { name: head, exact: true })).toBeVisible()
    }
    {
      const name = scope!.scope_division_name as string
      // `has` — от корня страницы: локатор, уже сужённый регионом, внутри filter не находит вложенное.
      const row = screen.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) })
      await expect(row).toBeVisible()
      await expect(row.getByRole('img', { name: 'Сдача: Сдано', exact: true })).toBeVisible()
      await shot(page, testInfo, '03-responsible-table')
      // Раскрытие: отделы вторым уровнем, под отделом — люди по статусам.
      await row.getByRole('button', { name, exact: true }).click()
      const sections = divisions.results.filter((item) => item.parent_id === String(divisionId))
      if (sections.length > 0) {
        const section = screen.getByRole('button', { name: sections[0].name, exact: true })
        await expect(section).toBeVisible()
        await section.click()
        await expect(screen.getByText(/Без отдельной отметки: в строю|Загрузка сотрудников/).first()).toBeVisible({ timeout: 20_000 })
      }
      await shot(page, testInfo, '04-responsible-expanded')
    }
    // Свод — под таблицей, на том же экране.
    await expect(screen.getByRole('region', { name: 'Суточный свод' })).toBeVisible()
    // Режим «Диапазон»: плитки по датам, каждая со своим индикатором.
    await screen.getByRole('button', { name: 'Диапазон', exact: true }).click()
    await expect(page).toHaveURL(/dateFrom=/)
    const tiles = screen.getByRole('list', { name: 'Расход по датам' })
    await expect(tiles.getByRole('listitem')).toHaveCount(5, { timeout: 30_000 })
    await expect(tiles.getByRole('listitem').first()).toContainText(/сдали \d+ из \d+/)
    await shot(page, testInfo, '05-responsible-range')
    await screen.getByRole('button', { name: 'День', exact: true }).click()
    await expect(page).not.toHaveURL(/dateFrom=/)

    // Сборка не отправляет: проверяем обе ступени на реальном сервере.
    const summary = screen.getByRole('region', { name: 'Суточный свод', exact: true })
    await summary.getByRole('button', { name: 'Собрать свод', exact: true }).click()
    await expect(summary.getByText('Свод собран — новая версия в списке ниже', { exact: true })).toBeVisible()
    const summaries = () => getJson<{ results: Submission[] }>(
      `/api/ops/daily/daily-submissions/?division_id=${department}&business_date=${businessDate}`, officerToken,
    )
    const assembled = (await summaries()).results.find(row => row.is_current)
    expect(assembled).toBeTruthy()
    expect(assembled!.sent_at, 'сборка не должна отправлять свод').toBeNull()
    const sendResponse = page.waitForResponse(response => response.url().includes('/daily-summaries/send/') && response.request().method() === 'POST')
    await summary.getByRole('button', { name: 'Отправить дежурному', exact: true }).click()
    const sent = await sendResponse
    let incompleteReason = ''
    if (!sent.ok()) {
      await expect(summary.getByText(/Свод неполный — не сдали/)).toBeVisible()
      const confirm = summary.getByRole('button', { name: 'Подтвердить отправку', exact: true })
      await expect(confirm).toBeDisabled()
      incompleteReason = `Проверка трёх ролей на клоне: ожидаются остальные управления, ${businessDate}`
      await summary.getByLabel('Причина неполной отправки', { exact: false }).fill(incompleteReason)
      await confirm.click()
    }
    await expect(summary.getByText('Свод отправлен дежурному', { exact: true })).toBeVisible()
    const delivered = (await summaries()).results.find(row => row.is_current)
    expect(delivered?.id).toBe(assembled!.id)
    expect(delivered?.version).toBe(assembled!.version)
    expect(delivered?.sent_at).toBeTruthy()
    expect(delivered?.incomplete_reason).toBe(incompleteReason)
    await shot(page, testInfo, '06-department-sent')

    // Дежурный читает именно отправленную версию, а не просто открывает страницу.
    const received = await getJson<{ results: Submission[] }>(
      `/api/ops/daily/daily-submissions/?division_id=${department}&business_date=${businessDate}`, dutyToken,
    )
    expect(received.results.find(row => row.is_current)).toMatchObject({
      id: delivered!.id, version: delivered!.version, sent_at: delivered!.sent_at, incomplete_reason: incompleteReason,
    })
    await signIn(page, DUTY)
    await page.goto(`${APP}/security-ops/service-summary?dateFrom=${businessDate}`)
    const service = page.getByRole('region', { name: `Свод по Службе на ${formattedDate}`, exact: true })
    await expect(service).toBeVisible({ timeout: 30_000 })
    const departmentRow = service.getByRole('row').filter({
      has: page.getByRole('button', { name: `Раскрыть: ${departmentName}`, exact: true }),
    })
    await expect(departmentRow.getByText('Отправлено дежурному', { exact: true })).toBeVisible()
    await expect(departmentRow).toContainText(`v${delivered!.version}`)
    if (incompleteReason) await expect(departmentRow).toContainText(incompleteReason)
    await departmentRow.getByRole('button', { name: `Раскрыть: ${departmentName}`, exact: true }).click()
    await expect(service.getByRole('button', { name: `Раскрыть: ${scope!.scope_division_name}`, exact: true })).toBeVisible()
    if (process.env.WALKTHROUGH_VIDEO_CAPTURE === '1') {
      await service.getByRole('button', { name: `Свернуть: ${departmentName}`, exact: true }).scrollIntoViewIfNeeded()
    }
    await shot(page, testInfo, '07-duty-received-same-version')
  })
})
