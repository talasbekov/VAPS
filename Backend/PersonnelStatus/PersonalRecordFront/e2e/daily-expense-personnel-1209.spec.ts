/**
 * Кадровый статус начальника управления попадает в ежедневный расход
 * (Plane №1209, 12.09.2026).
 *
 * До правки «Сдать день» со «Статусов» (№1197) сдавал не то, что начальник
 * видел и правил: кадровый отпуск/больничный жил в `employee_statuses`, а
 * расход, снимок и таблица ответственного читали только факты раздела.
 * Теперь кадровая строка проецируется в раздел (`source=PERSONNEL`).
 *
 * Проба ЖИВАЯ (стенд `:3106` + Django `:8100`): ставит кадровый отпуск на
 * свободную деловую дату сотруднику управления начальника, проверяет числа
 * в карточке «Расход на дату» на `/statuses`, сдаёт день, читает снимок
 * версии и колонку «Отпуск» у ответственного. Уборка — отмена кадровой
 * строки (проекция гаснет), сдача остаётся историей стенда как у №1197.
 */
import fs from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { probeComment } from './probe-statuses'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
const HEAD = 'role_directorate_head'
const OFFICER = 'role_forces_gathering_officer'

interface PersonnelStatus {
  id: number
  status_type: string
  state: string
  start_date: string
  end_date: string | null
}

async function token(username: string): Promise<string> {
  const response = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: ROLE_PASSWORD }),
  })
  expect(response.status, `учётка ${username} не получила токен`).toBe(200)
  return ((await response.json()) as { access: string }).access
}

async function api<T>(path: string, access: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${access}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  expect(response.ok, `${init.method ?? 'GET'} ${path}: ${response.status} ${text}`).toBeTruthy()
  return (text === '' ? {} : JSON.parse(text)) as T
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
  const body = await page.screenshot({ path: `smoke-results/1209-${name}.png`, fullPage: true })
  await testInfo.attach(name, { body, contentType: 'image/png' })
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatRu(value: string): string {
  const [y, m, d] = value.split('-')
  return `${d}.${m}.${y}`
}

test.describe('№1209 — кадровый статус в ежедневном расходе', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нет пароля ролевых учёток')
  test.setTimeout(180_000)

  test('отпуск, поставленный в «Статусах», виден в расходе на дату, в снимке сдачи и у ответственного', async ({ page }, testInfo) => {
    const headToken = await token(HEAD)
    const me = await api<{ roles: { code: string; scope_division_id: number | null; scope_division_name: string | null }[] }>(
      '/api/operations/my-permissions/', headToken,
    )
    const scope = me.roles.find((role) => role.code === 'DIRECTORATE_HEAD' && role.scope_division_id !== null)
    expect(scope, 'у role_directorate_head нет области управления').toBeTruthy()
    const divisionId = scope!.scope_division_id as number
    const tomorrow = (await api<{ business_date: string }>('/api/operations/tomorrow-block/', headToken)).business_date

    // Свободная дата: без сдачи управления и такая, чтобы отпуск не задел чужих проб.
    let businessDate: string | null = null
    for (let offset = 7; offset < 60; offset += 1) {
      const candidate = addDays(tomorrow, offset)
      const list = await api<{ count: number }>(
        `/api/ops/daily/daily-submissions/?division_id=${divisionId}&business_date=${candidate}`, headToken,
      )
      if (list.count === 0) { businessDate = candidate; break }
    }
    expect(businessDate, 'в окне нет свободной даты').not.toBeNull()
    const date = businessDate as string

    // Сотрудник управления, у которого на эту дату нет ни кадрового, ни секционного факта.
    // Люди сидят в ОТДЕЛАХ управления, а ручка состава не раскрывает поддерево —
    // подразделения называются перечислением (`division_id` повторяемый, Plane №376).
    const tree = await api<{ results: { id: string; parent_id: string | null }[] }>(
      `/api/ops/daily/divisions/?business_date=${date}`, headToken,
    )
    const subtree = new Set<string>([String(divisionId)])
    let grew = true
    while (grew) {
      grew = false
      for (const node of tree.results) {
        if (node.parent_id !== null && subtree.has(node.parent_id) && !subtree.has(node.id)) { subtree.add(node.id); grew = true }
      }
    }
    const people = await api<{ results: { id: string; division_id: number }[] }>(
      `/api/ops/daily/employees/?${[...subtree].map((id) => `division_id=${id}`).join('&')}`, headToken,
    )
    expect(people.results.length, `в поддереве управления ${divisionId} нет людей`).toBeGreaterThan(0)
    let employeeId: number | null = null
    for (const person of people.results) {
      const personnel = await api<{ results: PersonnelStatus[] }>(
        `/api/statuses/statuses/?employee=${person.id}&limit=200`, headToken,
      )
      const busy = personnel.results.some(
        (row) => row.status_type !== 'in_service' && (row.state === 'active' || row.state === 'planned')
          && row.start_date <= date && (row.end_date === null || row.end_date >= date),
      )
      if (busy) continue
      const section = await api<{ results: { employee_id: number; date_start: string; date_end: string; cancelled_at: string | null }[] }>(
        `/api/operations/statuses/?employee_id=${person.id}&limit=200`, headToken,
      )
      const sectionBusy = section.results.some(
        (row) => row.cancelled_at === null && row.date_start <= date && row.date_end > date,
      )
      if (!sectionBusy) { employeeId = Number(person.id); break }
    }
    expect(employeeId, 'в управлении нет свободного на дату сотрудника').not.toBeNull()

    // Числа ДО: расход управления на дату.
    const before = await api<{ totals: { columns: Record<string, number> } }>(
      `/api/operations/strength-report/?business_date=${date}&division_id=${divisionId}`, headToken,
    )
    const vacationBefore = before.totals.columns.VACATION ?? 0

    // ── Кадровый отпуск ставится как из окна «Статусов» — тем же API ─────────
    const created = await api<PersonnelStatus>('/api/statuses/statuses/', headToken, {
      method: 'POST',
      body: JSON.stringify({
        employee: employeeId,
        status_type: 'vacation',
        start_date: date,
        end_date: addDays(date, 1),
        comment: probeComment('Проба №1209: отпуск начальника управления'),
      }),
    })
    try {
      // Проекция в раздел: факт PERSONNEL на ту же дату.
      const projected = await api<{ results: { source: string; status_type_code: string; date_start: string; date_end: string }[] }>(
        `/api/operations/statuses/?employee_id=${employeeId}&limit=200`, headToken,
      )
      const fact = projected.results.find((row) => row.source === 'PERSONNEL' && row.status_type_code === 'VACATION' && row.date_start === date)
      expect(fact, 'кадровый отпуск не спроецирован в раздел').toBeTruthy()
      expect(fact!.date_end).toBe(addDays(date, 2))

      const after = await api<{ totals: { columns: Record<string, number> } }>(
        `/api/operations/strength-report/?business_date=${date}&division_id=${divisionId}`, headToken,
      )
      expect(after.totals.columns.VACATION ?? 0).toBe(vacationBefore + 1)

      // ── Начальник на «Статусах»: карточка «Расход на дату» и сдача ─────────
      await signIn(page, HEAD)
      await page.goto(`${APP}/statuses?businessDate=${date}`)
      const close = page.getByRole('region', { name: 'Сдача дня за управление' })
      await expect(close).toBeVisible({ timeout: 30_000 })
      const preview = close.getByRole('region', { name: 'Расход на дату' })
      await expect(preview.getByRole('heading', { name: `Расход на ${formatRu(date)}` })).toBeVisible()
      const figures = preview.getByRole('definition')
      await expect(preview.getByText('Список', { exact: true })).toBeVisible({ timeout: 20_000 })
      // Подпись колонки — серверная (`expense_layout`: «В отпуске»); в бланке
      // ответственного та же колонка сокращена до «Отпуск».
      await expect(preview.getByText('В отпуске', { exact: true })).toBeVisible()
      const vacationFigure = preview.locator('dt', { hasText: /^В отпуске$/ }).locator('xpath=following-sibling::dd[1]')
      await expect(vacationFigure).toHaveText(String(vacationBefore + 1))
      expect(await figures.count()).toBeGreaterThanOrEqual(3)
      await shot(page, testInfo, '01-statuses-expense-preview')

      await close.getByRole('button', { name: 'Сдать день' }).click()
      await close.getByRole('button', { name: 'Подтвердить сдачу' }).click()
      await expect(close.getByText(/День сдан: v1/)).toBeVisible({ timeout: 20_000 })
      await shot(page, testInfo, '02-statuses-day-submitted')

      // Снимок версии несёт кадровый факт.
      const submissions = await api<{ results: { id: number }[] }>(
        `/api/ops/daily/daily-submissions/?division_id=${divisionId}&business_date=${date}`, headToken,
      )
      expect(submissions.results.length).toBe(1)
      const detail = await api<{ snapshot: { rows: { employee_id: number; status_type_code: string; source: string }[] } }>(
        // Одна версия со снимком отдаётся ручкой раздела: у прокси `/api/ops/daily/…` чтения версии нет.
        `/api/operations/daily-submissions/${submissions.results[0].id}/`, headToken,
      )
      const row = detail.snapshot.rows.find((item) => item.employee_id === employeeId)
      expect(row, 'в снимке сдачи нет кадрового отпуска').toBeTruthy()
      expect([row!.status_type_code, row!.source]).toEqual(['VACATION', 'PERSONNEL'])

      // ── Ответственный видит отпуск в колонке бланка ────────────────────────
      const officerToken = await token(OFFICER)
      const officer = await api<{ roles: { code: string; scope_division_id: number | null }[] }>(
        '/api/operations/my-permissions/', officerToken,
      )
      const department = officer.roles.find((role) => role.code === 'FORCES_GATHERING_OFFICER')?.scope_division_id
      const divisions = await api<{ results: { id: string; parent_id: string | null }[] }>(
        `/api/ops/daily/divisions/?business_date=${date}`, officerToken,
      )
      const own = divisions.results.find((item) => item.id === String(divisionId))
      const inDepartment = own !== undefined && own.parent_id === String(department)
      if (inDepartment) {
        await signIn(page, OFFICER)
        await page.goto(`${APP}/employees?view=daily&businessDate=${date}`)
        const screen = page.getByRole('region', { name: 'Расход департамента' })
        await expect(screen).toBeVisible({ timeout: 30_000 })
        const name = scope!.scope_division_name as string
        const line = screen.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) })
        await expect(line).toBeVisible({ timeout: 30_000 })
        await expect(line.getByRole('img', { name: 'Сдача: Сдано', exact: true })).toBeVisible()
        const headers = await screen.getByRole('columnheader').allTextContents()
        const vacationIndex = headers.findIndex((text) => text.trim() === 'Отпуск')
        expect(vacationIndex, `колонки «Отпуск» нет среди ${headers.join(' | ')}`).toBeGreaterThan(0)
        const cell = line.getByRole('cell').nth(vacationIndex)
        await expect(cell).toHaveText(String(vacationBefore + 1))
        await shot(page, testInfo, '03-responsible-vacation-column')
      } else {
        test.info().annotations.push({ type: 'scope', description: `управление ${divisionId} не в департаменте ответственного ${department} — экран ответственного не проверялся` })
      }
    } finally {
      // Уборка: плановая кадровая строка отменяется, проекция гаснет.
      await api(`/api/statuses/statuses/${created.id}/cancel/`, headToken, {
        method: 'POST',
        body: JSON.stringify({ reason: probeComment('уборка пробы №1209') }),
      })
      const left = await api<{ results: { source: string; date_start: string; cancelled_at: string | null }[] }>(
        `/api/operations/statuses/?employee_id=${employeeId}&limit=200`, headToken,
      )
      expect(left.results.filter((row) => row.source === 'PERSONNEL' && row.date_start === date && row.cancelled_at === null)).toEqual([])
    }
  })
})
