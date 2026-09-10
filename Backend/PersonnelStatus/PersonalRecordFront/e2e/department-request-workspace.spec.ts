/** Plane №1093: real card → HTTP contract → refetched stages and locks. */
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { QueryClient } from '@tanstack/react-query'
import { refreshDepartmentRequestViews } from '../hooks/use-department-requests'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const ID = 'workspace-1093'

test('обновление заявки помечает сводки Штаба и резервы устаревшими', async () => {
  const client = new QueryClient()
  const changed = [
    ['ops-department-requests'], ['ops-department-request', ID],
    ['ops-force-collections'], ['ops-force-collection', '91093'],
    ['ops-force-campaigns'], ['ops-force-campaign', 'campaign-1'], ['ops-force-campaign-reserves'],
  ]
  const unchanged = [['ops-force-collection', 'other-event'], ['ops-department-request', 'other-request'], ['employees']]
  for (const key of [...changed, ...unchanged]) client.setQueryData(key, { old: true })
  await refreshDepartmentRequestViews(client, '91093', ID)
  for (const key of changed) expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true)
  for (const key of unchanged) expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(false)
  client.clear()
})

async function signIn(page: Page) {
  const api = page.context().request
  const csrf = await (await api.get(`${APP}/api/auth/csrf/`)).json()
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe('рабочее место ответственного — карточка запроса', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'нужен живой фронтенд с авторизацией')

  test('живой запрос роли ответственного сохраняет состав и прямую ссылку', async ({ page }) => {
    const api = page.context().request
    const csrf = await (await api.get(`${APP}/api/auth/csrf/`)).json()
    const login = await api.post(`${APP}/api/auth/callback/credentials/`, {
      form: { csrfToken: csrf.csrfToken, username: 'acc_forces_officer', password: process.env.ACCESS_MATRIX_PASSWORD ?? '', json: 'true' },
    })
    expect((await login.json()).url).not.toContain('error=')
    const listResponse = page.waitForResponse(response => response.url().includes('/forces/requests/') && !response.url().includes('/directorate') && response.status() === 200)
    await page.goto(`${APP}/employees?view=forces&tab=requests`)
    const rows = (await (await listResponse).json()).results
    expect(rows.length, 'изолированному стенду нужна входящая заявка роли').toBeGreaterThan(0)
    const first = rows[0]
    await page.goto(`${APP}/employees?view=forces&tab=requests&request=${encodeURIComponent(first.allocationId)}`)
    await expect(page.getByRole('heading', { name: first.title, exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-slot="stat-card"]').filter({ has: page.getByText('Запрошено Штабом', { exact: true }) }).locator('[data-slot="stat-value"]')).toHaveText(String(first.need))
    await expect(page.getByRole('list', { name: 'Этапы запроса сил' }).getByRole('listitem')).toHaveCount(4)
    if (process.env.WORKSPACE_SCREENSHOTS === '1') await page.screenshot({ path: path.join('/tmp', 'department-request-1093-live.png'), fullPage: true })
    await page.getByRole('button', { name: 'Назад к заявкам', exact: true }).click()
    await expect(page).toHaveURL(/view=forces&tab=requests$/)
  })

  test('ответ → раскладка → запрос управлений → неполный список → отправка и отзыв', async ({ page }) => {
    test.setTimeout(90_000)
    await signIn(page)
    const allocation = {
      id: ID, departmentId: '91093', departmentName: 'Департамент проверки', need: 5,
      allocating: null as number | null, status: 'DRAFT', comment: '', answerComment: '',
      notifiedAt: null as string | null, submittedAt: null as string | null, decidedAt: null,
      decisionComment: '', groupDemands: [{ id: 'demand-1093', kindCode: 'SCREENING_GROUP', need: 2, place: 'КПП', specification: 'Досмотр' }], groupOffers: [] as { demandRowId: string; kindCode: string; count: number; place: string; specification: string; comment: string }[],
      dueAt: '2026-09-14T10:00:00Z', overdue: false, submittedLate: false,
      directorates: [{ id: 'dir-1093', divisionId: '91094', name: 'Управление проверки', need: 0, assigned: 0, notifiedAt: null as string | null, groupDemandIds: [] }],
      members: [] as { employeeId: string; name: string; divisionName: string; source: string }[],
    }
    const event = { eventId: '91093', code: 'ОМ-1093', title: 'Сбор сил для проверки', businessDate: '2026-09-15', eventTime: null, location: 'Тестовая площадка', stage: 'PLACEMENT' }
    const calls: { action: string; body: unknown }[] = []
    let submitAttempts = 0
    let reads = 0
    await page.route((url) => url.pathname.endsWith('/core/divisions/'), (route) => route.fulfill({ json: { results: [
      { id: 91093, name: 'Департамент проверки', type_code: 'department', parent: null, is_active: true },
      { id: 91094, name: 'Управление проверки', type_code: 'directorate', parent: 91093, is_active: true },
    ] } }))
    await page.route((url) => url.pathname.endsWith('/forces/requests/'), (route) => route.fulfill({ json: { results: [{ ...event, ...allocation, allocationId: ID, assigned: allocation.members.length, dueAt: null, overdue: false, submittedLate: false }] } }))
    await page.route((url) => url.pathname.endsWith(`/forces/requests/${ID}/`), (route) => {
      reads++
      return route.fulfill({ json: { ...event, allocation, memberDirectorateById: { 'employee-1093': '91094' } } })
    })
    await page.route((url) => url.pathname.includes(`/forces/allocation/${ID}/`), async (route) => {
      const action = route.request().url().split('/').filter(Boolean).at(-1)!
      const raw = route.request().postData()
      const body = raw ? JSON.parse(raw) : null
      calls.push({ action, body })
      if (action === 'respond') { allocation.allocating = body.allocating; allocation.answerComment = body.comment; allocation.groupOffers = body.groupOffers }
      if (action === 'split') allocation.directorates[0].need = body.rows[0].need
      if (action === 'notify') {
        allocation.status = 'NOTIFIED'
        allocation.notifiedAt = '2026-09-09T10:00:00Z'
        allocation.directorates[0].notifiedAt = allocation.notifiedAt
        allocation.directorates[0].assigned = 1
        allocation.members = [{ employeeId: 'employee-1093', name: 'Сотрудник проверки', divisionName: 'Управление проверки', source: 'STATUS' }]
      }
      if (action === 'submit') {
        submitAttempts++
        if (submitAttempts === 1) {
          await new Promise(resolve => setTimeout(resolve, 500))
          await route.fulfill({ status: 503, json: { detail: 'Список временно не принимается' } })
          return
        }
        allocation.status = 'SUBMITTED'; allocation.submittedAt = '2026-09-09T11:00:00Z'
      }
      if (action === 'withdraw') { allocation.status = 'NOTIFIED'; allocation.submittedAt = null }
      await route.fulfill({ json: {} })
    })

    await page.goto(`${APP}/employees?view=forces&tab=requests&request=${ID}`)
    const allocating = page.locator('#answer-allocating')
    await expect(allocating).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Срок сдачи: 14.09.2026, 15:00', { exact: true })).toBeVisible()
    await allocating.fill('4')
    await page.locator('#answer-comment').fill('Один сотрудник занят')
    await page.getByRole('spinbutton', { name: 'Количество групп, строка 1' }).fill('2')
    await page.getByRole('button', { name: 'Сохранить ответ', exact: true }).click()
    await expect.poll(() => reads).toBeGreaterThan(1)
    const metric = (label: string) => page.locator('[data-slot="stat-card"]').filter({ has: page.getByText(label, { exact: true }) }).locator('[data-slot="stat-value"]')
    // Catches the old summary mixing HQ need, own promise and gathered people.
    await expect(metric('Выделяем')).toHaveText('4')
    await expect(metric('Запрошено Штабом')).toHaveText('5')
    await expect(metric('Недобор к обещанию')).toHaveText('4')
    const quota = page.locator('#quota-91094')
    await quota.fill('4')
    await page.getByRole('button', { name: 'Сохранить раскладку', exact: true }).click()
    await expect.poll(() => reads).toBeGreaterThan(2)
    await page.getByRole('button', { name: 'Отправить в управления', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(quota).toBeDisabled()
    await expect(page.getByText('Сотрудник проверки', { exact: true })).toBeVisible()
    await expect(metric('Собрано')).toHaveText('1')
    await expect(metric('Недобор к обещанию')).toHaveText('3')
    await expect(page.getByRole('list', { name: 'Этапы запроса сил' }).getByRole('listitem')).toHaveCount(4)
    await page.getByRole('button', { name: 'Отправить список в штаб', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Отправить 1 из 4?')
    await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Отправляю…', exact: true })).toBeDisabled()
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
    await expect(allocating).toBeEnabled()
    await expect(quota).toBeDisabled()
    await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(allocating).toBeDisabled()
    await expect(page.getByRole('spinbutton', { name: 'Количество групп, строка 1' })).toBeDisabled()
    await expect(page.getByText('Отправлено — ждём решения штаба.')).toBeVisible()
    await page.getByRole('button', { name: 'Отозвать список', exact: true }).click()
    await expect(allocating).toBeEnabled()
    await expect(quota).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Отправить список в штаб', exact: true })).toBeVisible()
    expect(calls).toEqual([
      { action: 'respond', body: { allocating: 4, comment: 'Один сотрудник занят', groupOffers: [{ demandRowId: 'demand-1093', kindCode: 'SCREENING_GROUP', count: 2, place: 'КПП', specification: 'Досмотр', comment: '' }] } },
      { action: 'split', body: { rows: [{ divisionId: '91094', need: 4, groupDemandIds: [] }] } },
      { action: 'notify', body: null }, { action: 'submit', body: null }, { action: 'submit', body: null }, { action: 'withdraw', body: null },
    ])
    if (process.env.WORKSPACE_SCREENSHOTS === '1') {
      await page.setViewportSize({ width: 1440, height: 1100 })
      await page.screenshot({ path: path.join('/tmp', 'department-request-1093-desktop.png'), fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: path.join('/tmp', 'department-request-1093-mobile.png'), fullPage: true })
    }
    await page.getByRole('button', { name: 'Назад к заявкам', exact: true }).click()
    await expect(page).toHaveURL(/view=forces&tab=requests$/)
    await expect(page.getByRole('heading', { name: 'Заявки департаменту' })).toBeVisible()
  })
})
