import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { ROUTES } from './portal-routes'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
const DEPARTMENT_ID = 2
const CHILD_DIVISION_ID = 3
const execFileAsync = promisify(execFile)
const BACKEND_ROOT = path.resolve(__dirname, '../../Personnel-Records')
let probeBusinessDate: string | null = null

const CHECKPOINTS = [
  ['единая дата завтра', 'daily-business-date.spec.ts', 'ЗАВТРА'],
  ['плановый статус', 'daily-expense.spec.ts', 'statusTypes'],
  ['сдача управления', 'day-submission.spec.ts', 'сдач'],
  ['сборка свода департамента', 'department-summary.spec.ts', 'Собрать свод'],
  ['неполный свод с причиной', 'department-summary.spec.ts', 'неполный свод'],
  ['передача дежурному', 'department-summary.spec.ts', 'Отправить дежурному'],
  ['свод Службы и детализация', 'service-summary.spec.ts', 'Свод по Службе'],
  ['будущая дата и диапазон', 'service-summary.spec.ts', 'dateFrom'],
] as const

async function token(username = STAND_USERNAME, password = STAND_PASSWORD): Promise<string> {
  const response = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  expect(response.status, `учётка ${username} не получила токен`).toBe(200)
  return ((await response.json()) as { access: string }).access
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const csrf = await page.request.get(`${APP}/api/auth/csrf/`)
  const csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken
  await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken, username, password, json: 'true' },
  })
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  fs.mkdirSync('smoke-results', { recursive: true })
  const body = await page.screenshot({
    path: `smoke-results/1046-daily-${name}.png`,
    fullPage: true,
  })
  await testInfo.attach(name, {
    body,
    contentType: 'image/png',
  })
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function freshDate(accessToken: string, firstDate: string): Promise<string> {
  for (let offset = 5; offset < 62; offset += 1) {
    const date = addDays(firstDate, offset)
    const counts = await Promise.all(
      [DEPARTMENT_ID, CHILD_DIVISION_ID].map(async (divisionId) => {
        const response = await fetch(
          `${API}/api/ops/daily/daily-submissions/?division_id=${divisionId}&business_date=${date}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        )
        return ((await response.json()) as { count: number }).count
      }),
    )
    if (counts.every((count) => count === 0)) return date
  }
  throw new Error('в 62-дневном окне нет свободной даты для проходки')
}

async function purgeDailyFixtures(businessDate: string): Promise<void> {
  const script = [
    'from organization_management.apps.operations.models_submission import OpsDailySubmission',
    `print(OpsDailySubmission.objects.filter(business_date=${JSON.stringify(businessDate)}, division_id__in=[${DEPARTMENT_ID}, ${CHILD_DIVISION_ID}]).delete()[0])`,
  ].join('; ')
  await execFileAsync(
    path.join(BACKEND_ROOT, '.venv/bin/python'),
    ['manage.py', 'shell', '-c', script, '--settings=organization_management.config.settings.local_postgres'],
    { cwd: BACKEND_ROOT, timeout: 30_000 },
  )
}

test('8 переходов расхода привязаны к живым сторожам и deep-link маршрутам', () => {
  expect(CHECKPOINTS).toHaveLength(8)
  for (const [label, file, marker] of CHECKPOINTS) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    expect(source, `${label}: в ${file} нет маркера «${marker}»`).toContain(marker)
  }
  const routes = new Set(ROUTES.map((row) => row.template))
  for (const route of [
    '/employees?view=daily',
    '/employees?view=department-summary',
    '/security-ops/service-summary',
  ]) {
    expect(routes.has(route), route).toBe(true)
  }
})

test.describe(LIVE ? 'основная проходка ежедневного расхода' : 'основная проходка расхода (скип)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нужен ROLE_ACCOUNTS_PASSWORD')

  test.afterEach(async () => {
    if (probeBusinessDate === null) return
    await purgeDailyFixtures(probeBusinessDate)
    probeBusinessDate = null
  })

  test('завтра → сдача управления → неполный свод с причиной → диапазон дежурного', async ({ page }, testInfo) => {
    const adminToken = await token()
    const tomorrowResponse = await fetch(`${API}/api/operations/tomorrow-block/`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    const tomorrow = ((await tomorrowResponse.json()) as { business_date: string }).business_date

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })
    await expect(board.getByRole('region', { name: 'Суточный свод' })).toBeVisible()
    await expect(page).not.toHaveURL(/businessDate=/)
    await shot(page, testInfo, '01-tomorrow-default')

    const businessDate = await freshDate(adminToken, tomorrow)
    probeBusinessDate = businessDate
    const submitted = await fetch(`${API}/api/operations/daily-submissions/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ division_id: CHILD_DIVISION_ID, business_date: businessDate }),
    })
    expect(submitted.status, await submitted.text()).toBe(201)

    await signIn(page, 'role_forces_gathering_officer', ROLE_PASSWORD)
    await page.goto(`${APP}/employees?view=department-summary&businessDate=${businessDate}`)
    const summary = page.getByRole('region', { name: 'Суточный свод' })
    await expect(summary).toBeVisible({ timeout: 30_000 })
    await summary.getByRole('button', { name: 'Собрать свод' }).click()
    await expect(summary.getByText('Свод собран — новая версия в списке ниже')).toBeVisible({ timeout: 15_000 })
    await summary.getByRole('button', { name: 'Отправить дежурному' }).click()
    const warning = summary.getByText(/Свод неполный — не сдали/)
    if (await warning.isVisible()) {
      const confirm = summary.getByRole('button', { name: 'Подтвердить отправку' })
      await expect(confirm).toBeDisabled()
      await summary.getByPlaceholder('Причина неполной отправки — обязательна').fill(
        'частичная отправка основной проходки; дежурный предупреждён',
      )
      await confirm.click()
    }
    await expect(summary.getByText('Свод отправлен дежурному')).toBeVisible({ timeout: 15_000 })
    await shot(page, testInfo, '02-department-summary-sent')

    const rangeEnd = addDays(businessDate, 2)
    // Plane №1223: «Свод по Службе» — рабочее место оперативного дежурного.
    await signIn(page, 'role_duty_officer', ROLE_PASSWORD)
    await page.goto(`${APP}/security-ops/service-summary?dateFrom=${businessDate}&dateTo=${rangeEnd}`)
    const serviceSummary = page.getByRole('region', { name: 'Свод по Службе', exact: true })
    await expect(serviceSummary).toBeVisible({ timeout: 30_000 })
    await expect(serviceSummary.getByText('Загрузка структуры и сдач…')).toHaveCount(0, {
      timeout: 30_000,
    })
    await expect(serviceSummary.getByText(/Сдали \d+ из \d+ департаментов/).first()).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`dateFrom=${businessDate}.*dateTo=${rangeEnd}`))
    await shot(page, testInfo, '03-duty-officer-range')
  })
})
