import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ForceCampaign } from '../hooks/use-force-campaigns'

const APP = process.env.SMOKE_APP!
const API = process.env.SMOKE_API!
const PASSWORD = process.env.ACCESS_MATRIX_PASSWORD!

async function role(page: Page, username: string) {
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
  expect((await login.json()).url, `Вход ${username}`).not.toContain('error=')
  const auth = await page.request.post(`${API}/api/token/`, { data: { username, password: PASSWORD } })
  expect(auth.status(), `Токен роли ${username}`).toBe(200)
  return (await auth.json()).access as string
}

async function read(page: Page, token: string, path: string) {
  const response = await page.request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(response.ok(), `GET ${path}: ${await response.text()}`).toBe(true)
  return response.json()
}

async function persisted(page: Page, token: string, eventId: string) {
  await page.reload()
  return read(page, token, `/api/ops/security-events/${eventId}/`)
}

async function stableScreenshot(page: Page, file: string) {
  await expect(page.getByText('Загрузка рабочего места…', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Роль не назначена', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' })
}

function prerequisites() {
  const backend = path.resolve(__dirname, '../../Personnel-Records')
  return JSON.parse(execFileSync(path.join(backend, '.venv/bin/python'), [
    'manage.py', 'shell', '--settings=organization_management.config.settings.local_postgres',
    '-c', fs.readFileSync(path.join(__dirname, 'fixtures/1090-prerequisites.py'), 'utf8'),
  ], { cwd: backend, encoding: 'utf8', env: { ...process.env, PR_DB_NAME: 'personnel_records_1090' } }).trim())
}

test('реальный ежедневный расход: статус, сдача управления и свод департамента', async ({ page }) => {
  test.setTimeout(180_000)
  const fixture = prerequisites()
  const token = await role(page, 'probe1090_dailyhead')
  const clock = await read(page, token, '/api/operations/tomorrow-block/')
  expect(clock.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  const today = new Date(`${clock.business_date}T00:00:00Z`)
  today.setUTCDate(today.getUTCDate() - 1)
  const history = await read(page, token, '/api/operations/daily-submissions/?division_id=632')
  const businessDate = [clock.business_date, today.toISOString().slice(0, 10)].find(date => !history.results.some((row: { business_date: string; is_current: boolean }) => row.business_date === date && row.is_current))
  expect(businessDate, 'Prerequisite: хотя бы один несданный день в разрешённом окне сегодня/завтра; без очистки бизнес-фактов').toBeTruthy()
  await page.goto(`${APP}/employees?view=daily&businessDate=${businessDate}`)
  await expect(page.getByRole('button', { name: 'Ежедневный расход организации', exact: true })).toBeVisible()
  const group = page.getByRole('group', { name: 'Первое управление · Первый департамент', exact: true })
  await group.getByRole('button').first().click()
  const employee = group.getByRole('row').filter({ hasText: 'Приёмка1090Начальник' })
  await employee.getByRole('button', { name: 'Проставить', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: 'Статус', exact: true }).click()
  await page.getByRole('option', { name: 'На дежурстве', exact: true }).click()
  await dialog.getByRole('button', { name: 'Проставить', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.reload()
  const statuses = await read(page, token, `/api/operations/statuses/?employee_id=${fixture.people.dailyhead.id}&business_date=${businessDate}`)
  expect(statuses.results).toEqual(expect.arrayContaining([expect.objectContaining({ employee_id: Number(fixture.people.dailyhead.id), status_type_code: 'DUTY', date_start: businessDate, cancelled_at: null, source: 'USER' })]))
  await group.getByRole('button').first().click()
  await group.getByRole('button', { name: 'Сдать день', exact: true }).click()
  await group.getByRole('button', { name: 'Подтвердить сдачу', exact: true }).click()
  await expect(group.getByText(/День сдан/)).toBeVisible()
  await page.reload()
  const submissions = await read(page, token, `/api/operations/daily-submissions/?division_id=632&business_date=${businessDate}`)
  const submission = submissions.results.find((row: { is_current: boolean; business_date: string }) => row.is_current && row.business_date === businessDate)
  expect(submission).toMatchObject({ division_id: 632, version: 1, business_date: businessDate })
  await stableScreenshot(page, `/tmp/1090-daily-${businessDate}-submitted.png`)
  const officer = await role(page, 'acc_forces_officer')
  await page.goto(`${APP}/employees?view=daily&businessDate=${businessDate}`)
  const board = page.getByRole('region', { name: 'Расход департамента', exact: true })
  for (const label of ['Рабочий стол', 'Ежедневный расход', 'Сбор сил на ОМ']) {
    await expect(page.locator('aside').getByRole('link', { name: label, exact: true })).toHaveCount(1)
    await expect(page.locator('aside').getByRole('link', { name: label, exact: true })).toBeVisible()
  }
  const allSubmissions = await read(page, officer, `/api/operations/daily-submissions/?business_date=${businessDate}`)
  const divisions = await read(page, officer, `/api/ops/daily/divisions/?business_date=${businessDate}`)
  const sourceIds = divisions.results.filter((row: { parent_id: string; division_type: string }) => row.parent_id === '631' && row.division_type === 'directorate').map((row: { id: string }) => Number(row.id))
  expect(sourceIds).toHaveLength(6)
  const submittedCount = sourceIds.filter((id: number) => allSubmissions.results.some((row: { division_id: number; business_date: string; is_current: boolean }) => row.division_id === id && row.is_current && row.business_date === businessDate)).length
  await expect(board.getByText(`Сдали ${submittedCount} из ${sourceIds.length}`, { exact: true })).toBeVisible()
  let reminderIds: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = page.waitForResponse(response => response.url().includes('/api/operations/daily-summaries/remind/') && response.request().method() === 'POST')
    await board.getByRole('button', { name: 'Напомнить всем несдавшим', exact: true }).click()
    const result = await response
    expect(result.status()).toBe(200)
    const delivered = await result.json()
    expect(delivered.notified_recipient_count).toBeGreaterThan(0)
    expect(delivered.laggard_division_ids).toContain(fixture.reminderDivisionId)
    await expect(board.getByText(/Получателей уведомлено: [1-9]/)).toBeVisible()
    const notifications = await read(page, token, '/api/operations/notifications/')
    const own = notifications.results.filter((row: { business_date: string; kind: string; payload: { laggard_division_ids?: number[] } }) => row.business_date === businessDate && row.kind === 'SUBMISSION_LAGGING' && row.payload.laggard_division_ids?.includes(fixture.reminderDivisionId))
    expect(own).toHaveLength(1)
    if (attempt === 0) reminderIds = own.map((row: { id: string }) => row.id)
    else expect(own.map((row: { id: string }) => row.id)).toEqual(reminderIds)
  }
  await board.getByRole('button', { name: 'Собрать свод', exact: true }).click()
  await board.getByRole('button', { name: 'Отправить дежурному', exact: true }).click()
  await board.getByPlaceholder('Причина неполной отправки — обязательна').fill('Приёмка1090: отправляем предварительный расход, ожидаем остальные источники')
  await board.getByRole('button', { name: 'Подтвердить отправку', exact: true }).click()
  await expect(board.getByText('Свод отправлен дежурному', { exact: true })).toBeVisible()
  await page.reload()
  await expect(board.getByText(/неполный свод: «Приёмка1090:/)).toBeVisible()
  await stableScreenshot(page, `/tmp/1090-daily-${businessDate}-summary-sent.png`)
  const summaries = await read(page, officer, `/api/operations/daily-submissions/?division_id=631&business_date=${businessDate}`)
  const current = summaries.results.find((row: { is_current: boolean; business_date: string }) => row.is_current && row.business_date === businessDate)
  expect(current).toMatchObject({ version: 1, business_date: businessDate, division_id: 631, incomplete_reason: 'Приёмка1090: отправляем предварительный расход, ожидаем остальные источники' })
  expect(current.sent_at).toBeTruthy()
  await expect(board.getByLabel('Деловая дата')).toHaveValue(businessDate!)
  await expect(board.getByText('Версия 1', { exact: true })).toBeVisible()
  console.log(`Daily UI complete: date=${businessDate}, submission=${submission.id}/v${submission.version}, summary=${current.id}/v${current.version}, reminders=${reminderIds.join(',')} (dedupe verified)`)
})

test('№1103: закрытая карточка рейтинга не запрашивает реестр оценок', async ({ page }) => {
  const token = await role(page, 'probe1090_senior')
  const events = await read(page, token, '/api/ops/security-events/?search=Приёмка1090')
  const event = events.results.find((row: { title: string; stage: string }) => row.title.startsWith('Приёмка1090-') && row.stage === 'PLACEMENT')
  expect(event, 'Prerequisite: ранее созданный через UI приёмочный ОМ на расстановке').toBeTruthy()
  const registryRequests: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/ops/evaluation-registry/') registryRequests.push(request.url())
  })
  await page.goto(`${APP}/security-ops/events/${event.id}`)
  await expect(page.getByRole('main')).toContainText('Задача поста')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  expect(registryRequests, 'Закрытый RatingBriefDialog не читает общий реестр').toEqual([])
})

async function openHandedOverCampaign(page: Page) {
  const hq = await role(page, 'acc_ops_staff')
  const list = await read(page, hq, '/api/ops/security-events/forces/campaigns/')
  const campaign: ForceCampaign = list.results.find((row: ForceCampaign) => row.title.startsWith('Приёмка1090-') && row.status === 'HANDED_OVER')
  expect(campaign, 'Prerequisite: кампания, переданная через UI').toBeTruthy()
  await page.goto(`${APP}/employees?campaign=${campaign.id}&businessDate=2026-10-20`)
  await expect(page.getByRole('heading', { name: campaign.title, exact: true })).toBeVisible()
  await expect(page.getByText('Передано в расстановку', { exact: true })).toBeVisible()
  await expect(page.locator('aside').getByRole('link', { name: 'Распределения', exact: true })).toBeVisible()
  return campaign
}

test('Штаб: специальные группы в ёмкости названы без технического кода', async ({ page }) => {
  const campaign = await openHandedOverCampaign(page)
  await expect(page.getByRole('main')).not.toContainText('SCREENING_GROUP')
  await expect(page.getByText(/Специальная группа · Периметр · Досмотр/).first()).toBeVisible()
  await stableScreenshot(page, `/tmp/1090-campaign-${campaign.id}-handover-stable.png`)
})

test('реальная передача: стабильный кадр Штаба и доступ старшего к расстановке', async ({ page }) => {
  const campaign = await openHandedOverCampaign(page)
  await stableScreenshot(page, `/tmp/1090-campaign-${campaign.id}-handover-stable.png`)
  const senior = await role(page, 'probe1090_senior')
  const event = await read(page, senior, `/api/ops/security-events/${campaign.events[0].eventId}/`)
  const visit = event.visitObjects.find((row: { chiefEmployeeId: string }) => row.chiefEmployeeId === '5131')
  expect(visit).toBeTruthy()
  await page.goto(`${APP}/security-ops/events/${event.id}?visit=${visit.id}`)
  await expect(page.getByRole('region', { name: 'Расстановка сил', exact: true })).toBeVisible()
  await stableScreenshot(page, `/tmp/1090-${event.id}-${visit.id}-senior-placement.png`)
  await expect(page.getByRole('button', { name: 'Распределить автоматически', exact: true })).toBeEnabled()
})

test('продолжение кампании 3: старшие завершают расстановку своих объектов', async ({ page }) => {
  test.setTimeout(180_000)
  page.on('response', async response => {
    if (response.status() >= 400 && response.url().includes('/api/ops/')) console.log(`UI ${response.request().method()} ${new URL(response.url()).pathname}: ${response.status()} ${await response.text().catch(() => '(navigation)')}`)
  })
  for (const [eventId, visitId, username, employeeId] of [
    ['9585', '8506', 'probe1090_senior', '5132'],
    ['9585', '8507', 'probe1090_senior2', '5133'],
    ['9586', '8508', 'probe1090_senior', '5132'],
    ['9586', '8509', 'probe1090_senior2', null],
  ] as const) {
    const token = await role(page, username)
    const event = await read(page, token, `/api/ops/security-events/${eventId}/`)
    expect(event.title).toContain('Приёмка1090-1788976159414')
    const visit = event.visitObjects.find((row: { id: string }) => row.id === visitId)
    expect(visit.canManagePlacement).toBe(true)
    expect(visit.stage).toBe('PLACEMENT')
    await page.goto(`${APP}/security-ops/events/${eventId}?visit=${visitId}`)
    await expect(page.getByRole('region', { name: 'Расстановка сил', exact: true })).toBeVisible()
    if (employeeId !== null) {
      await page.getByRole('button', { name: 'Распределить автоматически', exact: true }).click()
      const preview = page.getByRole('dialog')
      await expect(preview).toContainText('Пост')
      await preview.getByRole('button', { name: 'Подтвердить распределение', exact: true }).click()
      await expect(preview).toHaveCount(0)
      const saved = await persisted(page, token, eventId)
      const post = saved.reconSectorPosts.find((row: { visitObjectId: string; demandKindCode: string }) => row.visitObjectId === visitId && row.demandKindCode === 'PHYSICAL_SQUAD')
      expect(saved.placementAssignments).toEqual(expect.arrayContaining([expect.objectContaining({ employeeId, postId: post.id })]))
      await stableScreenshot(page, `/tmp/1090-${eventId}-${visitId}-assigned.png`)
    }
    await page.getByRole('button', { name: 'Завершить расстановку', exact: true }).click()
    const shortage = page.getByRole('dialog')
    await expect(shortage).toContainText('Конфликт')
    await expect(shortage.getByRole('button', { name: 'Подтвердить оверрайд', exact: true })).toBeDisabled()
    await shortage.getByRole('textbox').fill('Приёмка1090: оставшиеся места не укомплектованы; согласуем предварительную расстановку с явным недобором')
    await shortage.getByRole('button', { name: 'Подтвердить оверрайд', exact: true }).click()
    await expect(shortage).toHaveCount(0)
    const saved = await persisted(page, token, eventId)
    expect(saved.visitObjects.find((row: { id: string }) => row.id === visitId).stage).toBe('APPROVAL')
    await expect(page.getByRole('region', { name: 'Согласование расстановки', exact: true })).toBeVisible()
    await stableScreenshot(page, `/tmp/1090-${eventId}-${visitId}-placement-completed.png`)
    console.log(`PERSISTED ${eventId}/${visitId}: APPROVAL`, JSON.stringify(saved.visitObjects.find((row: { id: string }) => row.id === visitId).approvalRoute))
    console.log(await page.getByRole('main').ariaSnapshot())
  }
})

test('продолжение кампании 3: старший выбирает первый маршрут согласования', async ({ page }) => {
  prerequisites()
  const token = await role(page, 'probe1090_senior')
  await page.goto(`${APP}/security-ops/events/9585?visit=8506`)
  await expect(page.getByRole('region', { name: 'Согласование расстановки', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Выберите согласующего из руководства второго департамента', exact: true }).selectOption({ label: 'Калиев Алишер Дарханович · acc_dir_head_d2' })
  const result = page.waitForResponse(response => response.url().includes('/approval/route/select/') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Назначить первым согласующим', exact: true }).click()
  const response = await result
  console.log('ROLE probe1090_senior', response.request().method(), new URL(response.url()).pathname, response.request().postData(), response.status(), response.ok() ? 'route selected' : await response.text())
  await stableScreenshot(page, '/tmp/1090-9585-8506-approval-route-selection.png')
  const saved = await persisted(page, token, '9585')
  expect(response.status()).toBe(200)
  expect(saved.visitObjects.find((row: { id: string }) => row.id === '8506').approvalRoute).toHaveLength(2)
})

test('продолжение кампании 3: восстановление пустого объекта через правку черновика', async ({ page }) => {
  const token = await role(page, 'probe1090_senior2')
  const event = await read(page, token, '/api/ops/security-events/9586/')
  const visit = event.visitObjects.find((row: { id: string }) => row.id === '8509')
  console.log('PERSISTED recovery8509', JSON.stringify({ forceRoster: event.forceRoster, visit }))
  expect(visit).toMatchObject({ stage: 'APPROVAL', documentStatus: 'DRAFT', canManagePlacement: true })
  await page.goto(`${APP}/security-ops/events/9586?visit=8509`)
  await expect(page.getByRole('region', { name: 'Согласование расстановки', exact: true })).toBeVisible()
  await stableScreenshot(page, '/tmp/1090-9586-8509-recovery-entry.png')
  await expect(page.getByRole('link', { name: 'Поправить расстановку', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Поправить расстановку', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Расстановка сил', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  console.log(await page.getByRole('main').ariaSnapshot())
})

test('продолжение кампании 3: первый согласующий возвращает v1 с общим и постовым замечанием', async ({ page }) => {
  const senior = await role(page, 'probe1090_senior')
  await page.goto(`${APP}/security-ops/events/9585?visit=8506`)
  await page.getByRole('button', { name: 'Отправить на согласование', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'документ v1' })).toContainText('на согласовании')
  const submitted = await persisted(page, senior, '9585')
  const visit = submitted.visitObjects.find((row: { id: string }) => row.id === '8506')
  expect(visit).toMatchObject({ documentVersion: 1, documentStatus: 'SUBMITTED' })
  expect(visit.approvalRoute.map((row: { username: string; status: string }) => [row.username, row.status])).toEqual([['acc_dir_head_d2', 'PENDING'], ['probe1090_approver2', 'PENDING']])
  await stableScreenshot(page, '/tmp/1090-9585-8506-v1-sent.png')
  const approver = await role(page, 'acc_dir_head_d2')
  await page.goto(`${APP}/security-ops/events/9585?visit=8506`)
  await page.getByRole('row').filter({ hasText: 'учётка acc_dir_head_d2' }).getByRole('button', { name: 'Вернуть', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Общая причина *', { exact: true }).fill('Приёмка1090: уточнить порядок действий при недоборе и запись по посту')
  await dialog.getByRole('button', { name: '+ Замечание', exact: true }).click()
  await dialog.getByLabel('Текст замечания 1', { exact: true }).fill('Приёмка1090: закрепить порядок действий при недоборе')
  await dialog.getByRole('button', { name: '+ Замечание', exact: true }).click()
  await dialog.getByLabel('Текст замечания 2', { exact: true }).fill('Приёмка1090: уточнить комментарий физического поста')
  await dialog.getByLabel('Пост замечания 2', { exact: true }).selectOption({ label: 'Периметр · Пост 1' })
  await dialog.getByRole('button', { name: 'Подтвердить возврат', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const returned = await persisted(page, approver, '9585')
  const result = returned.visitObjects.find((row: { id: string }) => row.id === '8506')
  expect(result).toMatchObject({ stage: 'PLACEMENT', approvalStatus: 'RETURNED', documentVersion: 1 })
  expect(result.approvalRemarks).toHaveLength(2)
  expect(result.approvalRemarks.some((row: { postId: string | null }) => row.postId === null)).toBe(true)
  expect(result.approvalRemarks.some((row: { postId: string | null }) => row.postId !== null)).toBe(true)
  await expect(page.getByText('Возвращено с согласования:', { exact: false })).toBeVisible()
  await stableScreenshot(page, '/tmp/1090-9585-8506-v1-returned.png')
  console.log('PERSISTED v1 returned', JSON.stringify(result))
})

test('№1105: старший правит DRAFT на согласовании, но SUBMITTED остаётся закрыт', async ({ page }) => {
  await role(page, 'probe1090_senior2')
  await page.goto(`${APP}/security-ops/events/9586?visit=8509&step=2`)
  await expect(page.getByRole('region', { name: 'Расстановка сил', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  console.log('DRAFT candidates', await page.getByRole('main').ariaSnapshot())
  await stableScreenshot(page, '/tmp/1090-9586-8509-draft-placement.png')
  await expect(page.getByRole('button', { name: 'Распределить автоматически', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Завершить расстановку', exact: true })).toBeDisabled()
  await role(page, 'probe1090_senior')
  await page.goto(`${APP}/security-ops/events/9585?visit=8506&step=2`)
  // Frozen SUBMITTED is rejected by the page-level gate before the editor
  // mounts: the user remains on approval, rather than disabled editor controls.
  await expect(page.getByRole('region', { name: 'Согласование расстановки', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Поправить расстановку', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Распределить автоматически', exact: true })).toHaveCount(0)
})

test('продолжение кампании 3: старший исправляет замечания и отправляет v2', async ({ page }) => {
  const token = await role(page, 'probe1090_senior')
  await page.goto(`${APP}/security-ops/events/9585?visit=8506`)
  await expect(page.getByRole('region', { name: 'Замечания согласования', exact: true })).toBeVisible()
  const correction = 'Приёмка1090: физический пост контролирует периметр; при недоборе вызывает старшего, незанятый досмотр не открывается до усиления'
  await page.getByRole('textbox', { name: 'Комментарий к посту', exact: true }).fill(correction)
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
  const corrected = await persisted(page, token, '9585')
  expect(corrected.reconSectorPosts.find((row: { id: string }) => row.id === 'post-61d200cef808').comment).toBe(correction)
  await stableScreenshot(page, '/tmp/1090-9585-8506-corrected-post.png')
  await page.getByRole('button', { name: 'Завершить расстановку', exact: true }).click()
  const shortage = page.getByRole('dialog')
  await shortage.getByRole('textbox').fill('Приёмка1090: порядок действий при недоборе уточнён; незанятый пост не открывается до усиления')
  await shortage.getByRole('button', { name: 'Подтвердить оверрайд', exact: true }).click()
  await expect(shortage).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Согласование расстановки', exact: true })).toBeVisible()
  for (const remaining of [2, 1]) {
    const buttons = page.getByRole('button', { name: 'Устранено', exact: true })
    await expect(buttons).toHaveCount(remaining)
    await buttons.first().click()
    await expect(buttons).toHaveCount(remaining - 1)
  }
  await page.getByRole('button', { name: 'Отправить на согласование', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'документ v2' })).toContainText('на согласовании')
  const saved = await persisted(page, token, '9585')
  const visit = saved.visitObjects.find((row: { id: string }) => row.id === '8506')
  expect(visit).toMatchObject({ documentVersion: 2, documentStatus: 'SUBMITTED', stage: 'APPROVAL' })
  expect(visit.approvalRemarks.every((row: { status: string }) => row.status === 'RESOLVED')).toBe(true)
  expect(visit.documentVersions.map((row: { number: number; status: string }) => [row.number, row.status])).toEqual([[1, 'RETURNED'], [2, 'SUBMITTED']])
  await expect(page.getByRole('region', { name: 'История версий документа', exact: true })).toBeVisible()
  await stableScreenshot(page, '/tmp/1090-9585-8506-v2-sent-history.png')
  console.log('PERSISTED v2', JSON.stringify({ route: visit.approvalRoute, versions: visit.documentVersions, remarks: visit.approvalRemarks }))
})

test('продолжение кампании 3: два разных согласующих подписывают три непустых объекта', async ({ page }) => {
  test.setTimeout(120_000)
  for (const [eventId, visitId, seniorName, version] of [
    ['9585', '8506', 'probe1090_senior', 2],
    ['9585', '8507', 'probe1090_senior2', 1],
    ['9586', '8508', 'probe1090_senior', 1],
  ] as const) {
    const initialToken = await role(page, seniorName)
    const initial = await read(page, initialToken, `/api/ops/security-events/${eventId}/`)
    const initialVisit = initial.visitObjects.find((row: { id: string }) => row.id === visitId)
    if (initialVisit.documentStatus === 'APPROVED') {
      // Resume only a persisted result of this very UI run; never re-sign
      // or fabricate a transition to work around a harness assertion typo.
      expect(initialVisit).toMatchObject({ stage: 'ACKNOWLEDGEMENT', documentVersion: version })
      expect(initialVisit.approvalRoute.map((row: { signature: { login: string; versionNumber: number } }) => [row.signature.login, row.signature.versionNumber])).toEqual([['acc_dir_head_d2', version], ['probe1090_approver2', version]])
      await role(page, 'probe1090_approver2')
      await page.goto(`${APP}/security-ops/events/${eventId}?visit=${visitId}`)
      await stableScreenshot(page, `/tmp/1090-${eventId}-${visitId}-signature-2.png`)
      console.log(`Previously UI-signed ${eventId}/${visitId}`, JSON.stringify(initialVisit.approvalRoute))
      continue
    }
    if (visitId !== '8506') {
      const senior = await role(page, seniorName)
      await page.goto(`${APP}/security-ops/events/${eventId}?visit=${visitId}`)
      await page.getByRole('combobox', { name: 'Выберите согласующего из руководства второго департамента', exact: true }).selectOption({ label: 'Калиев Алишер Дарханович · acc_dir_head_d2' })
      await page.getByRole('button', { name: 'Назначить первым согласующим', exact: true }).click()
      await expect(page.getByRole('row').filter({ hasText: 'учётка probe1090_approver2' })).toBeVisible()
      await page.getByRole('button', { name: 'Отправить на согласование', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: `документ v${version}` })).toContainText('на согласовании')
      const sent = await persisted(page, senior, eventId)
      expect(sent.visitObjects.find((row: { id: string }) => row.id === visitId).documentStatus).toBe('SUBMITTED')
      await stableScreenshot(page, `/tmp/1090-${eventId}-${visitId}-v${version}-sent.png`)
    }
    for (const [index, username] of ['acc_dir_head_d2', 'probe1090_approver2'].entries()) {
      const signer = await role(page, username)
      await page.goto(`${APP}/security-ops/events/${eventId}?visit=${visitId}`)
      const response = page.waitForResponse(response => response.url().includes('/decide/') && response.request().method() === 'POST')
      await page.getByRole('row').filter({ hasText: `учётка ${username}` }).getByRole('button', { name: 'Согласовать', exact: true }).click()
      const signed = await response
      expect(signed.status(), await signed.text()).toBe(200)
      const saved = await persisted(page, signer, eventId)
      const visit = saved.visitObjects.find((row: { id: string }) => row.id === visitId)
      expect(visit.approvalRoute[index]).toMatchObject({ username, status: 'APPROVED', signature: { versionNumber: version } })
      expect(visit.approvalRoute[index].signature.signedAt).toBeTruthy()
      if (index === 0) expect(visit.approvalRoute[1].status).toBe('PENDING')
      else {
        expect(visit).toMatchObject({ stage: 'ACKNOWLEDGEMENT', documentStatus: 'APPROVED' })
        expect(visit.approvalRoute.map((row: { signature: { login: string } }) => row.signature.login)).toEqual(['acc_dir_head_d2', 'probe1090_approver2'])
      }
      await stableScreenshot(page, `/tmp/1090-${eventId}-${visitId}-signature-${index + 1}.png`)
      console.log(`PERSISTED signature ${eventId}/${visitId}`, JSON.stringify(visit.approvalRoute[index]))
    }
  }
})

test('продолжение кампании 3: участник и начальник открывают свои назначения', async ({ page }) => {
  for (const username of ['probe1090_participant', 'acc_dir_head']) {
    const token = await role(page, username)
    const assignments = await read(page, token, '/api/ops/security-events/my-assignments/')
    console.log('MY ASSIGNMENTS', username, JSON.stringify(assignments))
    await page.goto(`${APP}/security-ops/profile`)
    await page.waitForLoadState('networkidle')
    await stableScreenshot(page, `/tmp/1090-${username}-assignments.png`)
    console.log(username, await page.getByRole('main').ariaSnapshot())
  }
})

test('продолжение кампании 3: участник лично подтверждает первое назначение', async ({ page }) => {
  const token = await role(page, 'probe1090_participant')
  const before = await read(page, token, '/api/ops/security-events/my-assignments/')
  await page.goto(`${APP}/security-ops/profile`)
  const item = page.getByRole('listitem').filter({ hasText: 'Приёмка1090-1788976159414 ОМ1' })
  if (!before.results.find((row: { eventId: string }) => row.eventId === '9585').acknowledgedAt) {
    await item.getByRole('button', { name: 'Ознакомлен, заступлю', exact: true }).click()
  }
  await expect(item.getByRole('button', { name: 'Ознакомлен, заступлю', exact: true })).toHaveCount(0)
  await page.reload()
  const data = await read(page, token, '/api/ops/security-events/my-assignments/')
  const assignment = data.results.find((row: { eventId: string }) => row.eventId === '9585')
  expect(assignment.acknowledgedAt).toBeTruthy()
  expect(data.employeeId).toBe('5132')
  expect(assignment.acknowledgedVia).toBe('self')
  await expect(item).toContainText('Ознакомлен')
  await stableScreenshot(page, '/tmp/1090-9585-5132-self-ack.png')
  console.log('PERSISTED SELF ACK', JSON.stringify(assignment))
})

test('реальные роли: два ОМ от создания до закрытия и личной истории', async ({ page }) => {
  test.setTimeout(900_000)
  expect(process.env.PR_DB_NAME).toBe('personnel_records_1090')
  const fixture = prerequisites()
  const marker = `Приёмка1090-${Date.now()}`
  page.on('response', async response => {
    if (response.status() >= 400 && response.url().includes('/api/ops/')) console.log(`UI API failure ${response.request().method()} ${new URL(response.url()).pathname}: ${response.status()} ${await response.text().catch(() => '(body unavailable after navigation)')}`)
  })
  const businessDate = process.env.OM_ACCEPTANCE_DATE ?? '2026-11-20'
  const eventIds: string[] = []
  const employeeToken = await role(page, 'acc_employee_d2')
  for (let i = 1; i <= 2; i++) {
    await test.step(`Сотрудник: создать INTERNAL ОМ ${i}`, async () => {
      await page.goto(`${APP}/security-ops/events`)
      await expect(page.getByRole('button', { name: '+ Создать бюллетень' })).toBeVisible({ timeout: 60_000 })
      await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Внутреннее', exact: true }).click()
      await dialog.getByLabel('Дата начала').fill(businessDate)
      await dialog.getByLabel('Дата окончания').fill(businessDate)
      await dialog.getByLabel('Время', { exact: true }).fill('10:00')
      await dialog.getByLabel('Охраняемые лица').click()
      await dialog.getByRole('listbox').getByRole('option').first().getByRole('button').click()
      await dialog.getByLabel('Название ОМ').fill(`${marker} ОМ${i}`)
      await expect(dialog.getByLabel('Город')).not.toHaveValue('')
      await dialog.getByRole('button', { name: 'Создать бюллетень', exact: true }).click()
      await expect(page).toHaveURL(/\/security-ops\/events\/\d+/)
      const id = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)!
      const event = await persisted(page, employeeToken, id)
      expect(event.kind).toBe('INTERNAL')
      expect(event.title).toBe(`${marker} ОМ${i}`)
      eventIds.push(id)
      console.log(`UI created ${event.code}, id=${id}, marker=${marker}`)
    })
  }
  const managerToken = await role(page, 'acc_dir_head_d2')
  await test.step('Начальник управления: два объекта и реальные старшие', async () => {
    const objects = await read(page, managerToken, '/api/ops/security-events/bindable-objects/')
    const published = objects.results.filter((row: { publishedVersionCount: number; id: string }) => row.publishedVersionCount > 0 && fixture.objects.some((object: { id: string }) => object.id === row.id))
    expect(published, 'Два prerequisite-паспорта опубликованы').toHaveLength(2)
    for (const eventId of eventIds) {
      await page.goto(`${APP}/security-ops/events?search=${encodeURIComponent(marker)}`)
      const row = page.getByRole('row').filter({ hasText: `${marker} ОМ${eventIds.indexOf(eventId) + 1}` })
      await row.getByRole('button', { name: /^Действия / }).click()
      await page.getByRole('menuitem', { name: /^Добавить объекты посещения/ }).click()
      const dialog = page.getByRole('dialog')
      for (const object of published) await dialog.getByRole('checkbox', { name: new RegExp(object.name) }).check()
      await dialog.getByRole('button', { name: 'Добавить (2)', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const event = await persisted(page, managerToken, eventId)
      expect(event.visitObjects).toHaveLength(2)
      await row.getByRole('button', { name: /^Развернуть объекты/ }).click()
      for (let index = 0; index < 2; index++) {
        const object = published[index]
        const seniorName = index === 0 ? 'Приёмка1090Старший' : 'Приёмка1090Второй'
        await page.getByRole('button', { name: `Назначить старшего объекта ${object.name}`, exact: true }).click()
        await page.getByRole('dialog').getByLabel('Поиск сотрудника').fill(seniorName)
        await page.getByRole('dialog').getByRole('button', { name: new RegExp(seniorName) }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Назначить', exact: true }).click()
        await expect(page.getByRole('dialog')).toHaveCount(0)
      }
      const assigned = await persisted(page, managerToken, eventId)
      expect(assigned.visitObjects.every((visit: { chiefEmployeeId: string | null }) => visit.chiefEmployeeId)).toBe(true)
      await stableScreenshot(page, `/tmp/1090-${marker}-${eventId}-objects.png`)
      await role(page, 'probe1090_senior')
      await page.goto(`${APP}/security-ops/events/${eventId}?visit=${assigned.visitObjects[0].id}`)
      await expect(page.getByRole('button', { name: 'Открыть рекогносцировку', exact: true })).toBeDisabled()
      await expect(page.getByText('Открыть рекогносцировку мероприятия может редактор бюллетеня.', { exact: true })).toBeVisible()
      await role(page, 'acc_dir_head_d2')
      await page.goto(`${APP}/security-ops/events/${eventId}`)
      await page.getByRole('button', { name: 'Открыть рекогносцировку', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Рекогносцировка объекта' })).toBeVisible()
      expect((await persisted(page, managerToken, eventId)).stage).toBe('RECON')
    }
  })
  for (const eventId of eventIds) {
    const event = await read(page, managerToken, `/api/ops/security-events/${eventId}/`)
    for (const visit of event.visitObjects) {
      const first = visit.chiefEmployeeId === fixture.people.senior.id
      const seniorToken = await role(page, first ? 'probe1090_senior' : 'probe1090_senior2')
      await test.step(`Старший ${visit.chiefEmployeeId}: рекогносцировка ${eventId}/${visit.id}`, async () => {
        await page.goto(`${APP}/security-ops/events/${eventId}?visit=${visit.id}`)
        const stage = page.getByRole('region', { name: 'Рекогносцировка объекта' })
        const start = page.getByRole('button', { name: 'Открыть рекогносцировку', exact: true })
        await expect(stage.or(start)).toBeVisible()
        if (await start.count()) await start.click()
        await stage.getByRole('button', { name: 'Импорт из паспорта', exact: true }).click()
        await expect(stage.getByLabel('Пост', { exact: true })).toHaveCount(2)
        const posts = await stage.getByLabel('Пост', { exact: true }).evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))
        for (const button of await stage.locator('[data-slot="recon-check-item"]').getByRole('button', { name: 'Норма', exact: true }).all()) await button.click()
        for (let index = 0; index < posts.length; index++) {
          await stage.getByLabel('Потребность', { exact: true }).nth(index).fill('1')
          await stage.getByLabel(`Подробнее: ${posts[index]}`, { exact: true }).click()
          await stage.getByLabel(`Вид потребности: ${posts[index]}`, { exact: true }).selectOption(index === 0 ? 'PHYSICAL_SQUAD' : 'SCREENING_GROUP')
          await stage.getByLabel(`Спецификация потребности: ${posts[index]}`, { exact: true }).fill(index === 0 ? 'Охрана' : 'Досмотр')
        }
        await stage.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click()
        await expect(stage.getByRole('button', { name: 'Завершить рекогносцировку →', exact: true })).toBeEnabled()
        await stage.getByRole('button', { name: 'Завершить рекогносцировку →', exact: true }).click()
        await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
        await expect(stage).toHaveCount(0)
        const saved = await persisted(page, seniorToken, eventId)
        expect(saved.visitObjects.find((v: { id: string }) => v.id === visit.id).stage).toBe('PLACEMENT')
        await stableScreenshot(page, `/tmp/1090-${marker}-${eventId}-${visit.id}-recon.png`)
      })
    }
  }
  const requests: { eventId: string; allocationId: string; code: string }[] = []
  const hqToken = await role(page, 'acc_ops_staff')
  for (const eventId of eventIds) {
    await test.step(`Штаб: отправить физический наряд и группы по ОМ ${eventId}`, async () => {
      await page.goto(`${APP}/employees?collection=${eventId}&businessDate=${businessDate}`)
      await page.getByRole('button', { name: 'Департамент', exact: true }).click()
      await page.getByLabel('Департамент, строка 1', { exact: true }).selectOption('631')
      await page.getByLabel('Сколько человек, строка 1', { exact: true }).fill('2')
      await page.getByLabel('Комментарий Штаба, строка 1', { exact: true }).fill(`${marker}: физический наряд и досмотр`)
      for (const group of await page.locator('[data-slot="draft-row"]').getByRole('checkbox').all()) await group.check()
      await page.getByRole('button', { name: 'Отправить запросы', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.reload()
      const collection = await read(page, hqToken, `/api/ops/security-events/${eventId}/force-collection/`)
      const allocation = collection.allocations.find((row: { departmentId: string }) => row.departmentId === '631')
      expect(allocation.sentAt).toBeTruthy()
      expect(allocation.need).toBe(2)
      expect(allocation.groupDemands).toHaveLength(2)
      requests.push({ eventId, allocationId: allocation.id, code: collection.code })
      await stableScreenshot(page, `/tmp/1090-${marker}-${eventId}-hq-request.png`)
    })
  }
  const responsibleToken = await role(page, 'acc_forces_officer')
  for (const request of requests) {
    await test.step(`Ответственный: ответ и квоты ${request.code}`, async () => {
      await page.goto(`${APP}/employees?request=${encodeURIComponent(request.allocationId)}&businessDate=${businessDate}`)
      await page.locator('#answer-allocating').fill('3')
      await page.locator('#answer-comment').fill(`${marker}: дополнительный резерв`)
      for (const count of await page.getByRole('spinbutton', { name: /Количество групп, строка/ }).all()) await count.fill('1')
      await page.getByRole('button', { name: 'Сохранить ответ', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Сохранить ответ', exact: true })).toBeDisabled()
      await page.reload()
      const answer = await read(page, responsibleToken, `/api/ops/security-events/forces/requests/${encodeURIComponent(request.allocationId)}/`)
      expect(answer.allocation.allocating).toBe(3)
      expect(answer.allocation.groupOffers).toHaveLength(2)
      await page.locator('#quota-632').fill('3')
      const division = page.locator('#quota-632').locator('xpath=ancestor::tr')
      for (const checkbox of await division.getByRole('checkbox').all()) await checkbox.check()
      await page.getByRole('button', { name: 'Сохранить раскладку', exact: true }).click()
      await page.getByRole('button', { name: 'Отправить в управления', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.reload()
      const notified = await read(page, responsibleToken, `/api/ops/security-events/forces/requests/${encodeURIComponent(request.allocationId)}/`)
      expect(notified.allocation.notifiedAt).toBeTruthy()
      expect(notified.allocation.directorates.find((row: { divisionId: string }) => row.divisionId === '632').need).toBe(3)
      await stableScreenshot(page, `/tmp/1090-${marker}-${request.eventId}-responsible-answer.png`)
    })
  }
  let campaignId = ''
  await test.step('Штаб: создать меж-ОМ контекст до подбора общего резерва', async () => {
    await role(page, 'acc_ops_staff')
    await page.goto(`${APP}/employees?view=forces&businessDate=${businessDate}`)
    await page.getByRole('button', { name: 'Новое распределение', exact: true }).click()
    await page.getByLabel('Название', { exact: true }).fill(`${marker} Общая кампания`)
    for (const request of requests) await page.getByRole('checkbox', { name: new RegExp(`${request.code}.*${marker}`) }).check()
    await page.getByRole('button', { name: 'Создать распределение', exact: true }).click()
    await expect(page).toHaveURL(/campaign=/)
    campaignId = new URL(page.url()).searchParams.get('campaign')!
    await page.reload()
    const campaign = await read(page, hqToken, `/api/ops/security-events/forces/campaigns/${campaignId}/`)
    expect(campaign.events.map((event: { eventId: string }) => event.eventId).sort()).toEqual([...eventIds].sort())
    expect(campaign.assignments).toHaveLength(0)
  })
  for (const request of requests) {
    const headToken = await role(page, 'acc_dir_head')
    await test.step(`Начальник управления: реальные люди ${request.code}`, async () => {
      await page.goto(`${APP}/statuses?forcesRequest=${encodeURIComponent(request.allocationId)}`)
      const banner = page.getByRole('status', { name: `Запрос на ${request.code}`, exact: true })
      await expect(banner).toBeVisible()
      await page.getByPlaceholder('Поиск по ФИО, отделу, должности...').fill('Приёмка1090')
      const participant = page.getByRole('row').filter({ hasText: 'Приёмка1090Участник' })
      const noaccount = page.getByRole('row').filter({ hasText: 'Приёмка1090БезУчётки' })
      if (request === requests[0]) {
        await participant.getByRole('checkbox').check()
        await noaccount.getByRole('checkbox').check()
        await banner.getByRole('button', { name: 'Добавить в общий резерв: 2', exact: true }).click()
        await expect(banner.locator('[data-slot="select-report"]')).toContainText('Выделено: 2')
      }
      await page.reload()
      const reserves = await read(page, headToken, '/api/ops/security-events/forces/campaign-reserves/')
      expect(JSON.stringify(reserves)).toContain(fixture.people.participant.id)
      expect(JSON.stringify(reserves)).toContain(fixture.people.noaccount.id)
      const group = request === requests[0] ? fixture.people.group : fixture.people.group2
      const groupName = request === requests[0] ? 'Приёмка1090Группа' : 'Приёмка1090Досмотр'
      await page.getByPlaceholder('Поиск по ФИО, отделу, должности...').fill(groupName)
      await page.getByRole('row').filter({ hasText: groupName }).getByRole('checkbox').check()
      await chooseScreeningGroup(page, headToken)
      await banner.getByRole('button', { name: `Выделить на ${request.code}: 1`, exact: true }).click()
      await expect(banner.locator('[data-slot="select-report"]')).toContainText('Выделено: 1')
      await page.reload()
      const statuses = await read(page, headToken, `/api/operations/statuses/?employee_id=${group.id}`)
      expect(JSON.stringify(statuses)).toContain(request.eventId)
      expect(JSON.stringify(statuses)).toContain('SCREENING_GROUP')
    })
    const officerToken = await role(page, 'acc_forces_officer')
    await test.step(`Ответственный: отправить настоящий список ${request.code}`, async () => {
      await page.goto(`${APP}/employees?request=${encodeURIComponent(request.allocationId)}&businessDate=${businessDate}`)
      await page.getByRole('button', { name: 'Отправить список в штаб', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.reload()
      const submitted = await read(page, officerToken, `/api/ops/security-events/forces/requests/${encodeURIComponent(request.allocationId)}/`)
      expect(submitted.allocation.submittedAt).toBeTruthy()
      expect(submitted.allocation.members.length).toBeGreaterThan(0)
    })
  }
  await test.step('Штаб: точные назначения, пересечение двух ОМ и мотивированная передача', async () => {
    await role(page, 'acc_ops_staff')
    await page.goto(`${APP}/employees?campaign=${campaignId}&businessDate=${businessDate}`)
    const campaign: ForceCampaign = await read(page, hqToken, `/api/ops/security-events/forces/campaigns/${campaignId}/`)
    for (const [index, employeeId] of [fixture.people.participant.id, fixture.people.noaccount.id, fixture.people.participant.id, fixture.people.noaccount.id].entries()) {
      const event = campaign.events.find(row => row.eventId === eventIds[index >= 2 ? 1 : 0])!
      const visit = event.visitObjects[index % 2]
      const demand = event.demandRows.find(row => row.visitObjectId === visit.visitObjectId && row.kindCode === 'PHYSICAL_SQUAD')!
      await page.getByLabel('Сотрудник', { exact: true }).selectOption(employeeId)
      await page.getByLabel('Мероприятие', { exact: true }).selectOption(event.eventId)
      await page.getByLabel('Объект', { exact: true }).selectOption(visit.visitObjectId)
      await page.getByLabel('Строка потребности', { exact: true }).selectOption(demand.id)
      if (index >= 2) {
        await expect(page.getByText('Период пересекается с существующим назначением сотрудника.', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toBeDisabled()
        await page.getByRole('checkbox', { name: 'Подтвердить назначение с конфликтом', exact: true }).check()
        await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toBeDisabled()
        await page.getByLabel('Причина конфликта', { exact: true }).fill(`${marker}: последовательные смены согласованы Штабом`)
      }
      await page.getByRole('button', { name: 'Назначить', exact: true }).click()
      await expect.poll(async () => (await read(page, hqToken, `/api/ops/security-events/forces/campaigns/${campaignId}/`)).assignments.length).toBe(index + 1)
      await page.reload()
      const saved: ForceCampaign = await read(page, hqToken, `/api/ops/security-events/forces/campaigns/${campaignId}/`)
      expect(saved.assignments.some(row => row.employeeId === employeeId && row.eventId === event.eventId && row.visitObjectId === visit.visitObjectId && row.demandRowId === demand.id)).toBe(true)
      if (index >= 2) expect(saved.assignments.find(row => row.employeeId === employeeId && row.eventId === event.eventId)?.overrideReason).toContain(marker)
    }
    await page.getByLabel('Комментарий при неполном распределении', { exact: true }).fill(`${marker}: физический пост каждого объекта обеспечен; досмотр ожидает усиления`)
    await page.getByRole('button', { name: 'Передать в расстановку', exact: true }).click()
    await expect.poll(async () => (await read(page, hqToken, `/api/ops/security-events/forces/campaigns/${campaignId}/`)).status).toBe('HANDED_OVER')
    await page.reload()
    expect((await read(page, hqToken, `/api/ops/security-events/forces/campaigns/${campaignId}/`)).status).toBe('HANDED_OVER')
    await expect(page.getByRole('heading', { name: `${marker} Общая кампания`, exact: true })).toBeVisible()
    await expect(page.getByText('Передано в расстановку', { exact: true })).toBeVisible()
    await stableScreenshot(page, `/tmp/1090-${marker}-campaign-handover.png`)
  })
  fs.writeFileSync('/tmp/1090-om-ui-resume.json', JSON.stringify({ marker, eventIds, campaignId, businessDate }))
  await finishOmUI(page, { marker, eventIds, campaignId, businessDate })
})

type OmRun = { marker: string; eventIds: string[]; campaignId: string; businessDate: string }

test('граница проведения: старшие объектов остаются на ознакомлении без обхода этапа', async ({ page }) => {
  const run: OmRun = JSON.parse(fs.readFileSync('/tmp/1090-om-ui-resume.json', 'utf8'))
  expect(run.campaignId).not.toBe('3')
  const mutations: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/ops/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(request.url())
  })
  for (const eventId of run.eventIds) {
    for (const [index, username] of ['probe1090_senior', 'probe1090_senior2'].entries()) {
      const token = await role(page, username)
      const event = await read(page, token, `/api/ops/security-events/${eventId}/`)
      expect(event.title).toContain(run.marker)
      expect(event.stage).toBe('ACKNOWLEDGEMENT')
      expect(event.chiefEmployeeId).toBeNull()
      expect(event.placementAssignments.every((row: { acknowledgedAt: string | null }) => row.acknowledgedAt)).toBe(true)
      const visit = event.visitObjects[index]
      await page.goto(`${APP}/security-ops/events/${eventId}?visit=${visit.id}`)
      await expect(page.getByRole('button', { name: 'Завершить ознакомление', exact: true })).toBeDisabled()
      await expect(page.locator('[data-slot="evaluation-panel"]')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Закрыть объект', exact: true })).toHaveCount(0)
      await stableScreenshot(page, `/tmp/1090-${run.campaignId}-${eventId}-${visit.id}-conduct-blocked.png`)
      expect((await read(page, token, `/api/ops/security-events/${eventId}/`)).stage).toBe('ACKNOWLEDGEMENT')
    }
  }
  expect(mutations, 'Только чтение: проведение не имитируется и стадия не обходится').toEqual([])
  console.log('CONDUCT BLOCKED BEFORE START: all four assignments acknowledged; no event chief; no business writes')
})

test('production рабочие места: settled desktop и mobile двух реальных ролей', async ({ page }) => {
  test.setTimeout(120_000)
  for (const [username, key, heading] of [
    ['acc_forces_officer', 'responsible', 'Рабочий стол'],
    ['acc_ops_staff', 'headquarters', 'Распределения'],
  ]) {
    await role(page, username)
    for (const viewport of [{ name: 'desktop', width: 1600, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(`${APP}/employees`)
      await expect(page.getByRole('main').getByRole('heading', { name: heading, exact: true })).toBeVisible()
      if (key === 'responsible') {
        await expect(page.getByRole('main').getByRole('link', { name: 'Открыть заявки', exact: true })).toBeVisible()
        await expect(page.getByRole('main').getByRole('link', { name: 'Открыть свод', exact: true }).first()).toBeVisible()
      }
      await stableScreenshot(page, `/tmp/1090-production-${key}-${viewport.name}.png`)
      const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }))
      expect(width.document, `${username}/${viewport.name}: нет горизонтального переполнения`).toBeLessThanOrEqual(width.viewport + 1)
      console.log(`SETTLED UI ${username} ${viewport.name} ${viewport.width}x${viewport.height}: ${heading}; width=${width.document}`)
    }
  }
})

test('№1126: ответственный открывает рабочее место без 403 счётчика Реестра ОМ', async ({ page }) => {
  test.setTimeout(90_000)
  const forbiddenRegistryResponses: string[] = []
  page.on('response', response => {
    const url = new URL(response.url())
    if (response.status() === 403 && url.pathname === '/api/ops/security-events/') {
      forbiddenRegistryResponses.push(response.url())
    }
  })

  await role(page, 'acc_forces_officer')
  await page.goto(`${APP}/employees`)
  await expect(page.getByRole('main').getByRole('heading', { name: 'Рабочий стол', exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(forbiddenRegistryResponses, 'Sidebar не должен вызывать недоступный ответственного реестр ради счётчика').toEqual([])
})

test('диагностика прав завершения ознакомления текущей UI кампании', async ({ page }) => {
  const run: OmRun = JSON.parse(fs.readFileSync('/tmp/1090-om-ui-resume.json', 'utf8'))
  for (const username of ['acc_dir_head_d2', 'acc_dept_head_d2', 'probe1090_senior']) {
    const token = await role(page, username)
    const permissions = await read(page, token, '/api/operations/my-permissions/')
    const event = await read(page, token, `/api/ops/security-events/${run.eventIds[0]}/`)
    console.log('ACK AUTHORITY', JSON.stringify({ username, roles: permissions.roles, stage: event.stage, chiefEmployeeId: event.chiefEmployeeId, eventManage: permissions.permissions.includes('event.manage'), permissions: permissions.permissions.filter((code: string) => code.includes('event') || code.includes('placement')) }))
    await page.goto(`${APP}/security-ops/events/${event.id}`)
    await stableScreenshot(page, `/tmp/1090-${run.campaignId}-${username}-ack-authority.png`)
  }
})

async function chooseScreeningGroup(page: Page, token: string) {
  const kinds = await read(page, token, '/api/ops/dictionaries/EVENT_PARTICIPATION_KINDS/entries/')
  const kind = kinds.results.find((row: { code: string }) => row.code === 'SCREENING_GROUP')
  expect(kind).toBeTruthy()
  await page.getByRole('group', { name: 'Подгруппа участия ОМ', exact: true }).getByRole('button', { name: 'Группы', exact: true }).click()
  if (kind.isOwn) {
    await page.getByRole('combobox', { name: 'Свои группы', exact: true }).click()
    await page.getByRole('option', { name: new RegExp(kind.label) }).click()
  } else {
    await page.getByRole('button', { name: 'Выбрать другую группу другого подразделения', exact: true }).click()
    await page.getByRole('textbox', { name: 'Поиск другой группы', exact: true }).fill('SCREENING_GROUP')
    await page.getByRole('listbox', { name: 'Другие группы', exact: true }).getByRole('option').click()
  }
  const roles = await read(page, token, '/api/ops/dictionaries/EVENT_GROUP_ROLES/entries/')
  const selectedRole = roles.results.find((row: { groupCode: string; isActive: boolean }) => row.groupCode === 'SCREENING_GROUP' && row.isActive)
  if (selectedRole) {
    await page.getByRole('combobox', { name: 'Специальность', exact: true }).click()
    await page.getByRole('option', { name: selectedRole.label, exact: true }).click()
  }
}

test('продолжение текущего маркера: группы и четыре точных назначения', async ({ page }) => {
  test.setTimeout(900_000)
  const marker = process.env.OM_ACCEPTANCE_MARKER!
  expect(marker).toMatch(/^Приёмка1090-\d+$/)
  const fixture = prerequisites()
  const hq = await role(page, 'acc_ops_staff')
  let campaign = (await read(page, hq, '/api/ops/security-events/forces/campaigns/')).results.find((row: { title: string }) => row.title === `${marker} Общая кампания`)
  expect(campaign).toBeTruthy()
  expect(campaign.id).not.toBe('3')
  const run: OmRun = { marker, campaignId: campaign.id, eventIds: campaign.events.map((row: { eventId: string }) => row.eventId), businessDate: campaign.events[0].businessDate }
  fs.writeFileSync('/tmp/1090-om-ui-resume.json', JSON.stringify(run))
  for (const [index, eventId] of run.eventIds.entries()) {
    const collection = await read(page, hq, `/api/ops/security-events/${eventId}/force-collection/`)
    const allocation = collection.allocations.find((row: { departmentId: string }) => row.departmentId === '631')
    const group = index === 0 ? fixture.people.group : fixture.people.group2
    const groupName = index === 0 ? 'Приёмка1090Группа' : 'Приёмка1090Досмотр'
    const head = await role(page, 'acc_dir_head')
    const statuses = await read(page, head, `/api/operations/statuses/?employee_id=${group.id}`)
    if (!JSON.stringify(statuses).includes(`\"${eventId}\"`)) {
      await page.goto(`${APP}/statuses?forcesRequest=${encodeURIComponent(allocation.id)}`)
      const banner = page.getByRole('status', { name: `Запрос на ${collection.code}`, exact: true })
      await page.getByPlaceholder('Поиск по ФИО, отделу, должности...').fill(groupName)
      await page.getByRole('row').filter({ hasText: groupName }).getByRole('checkbox').check()
      await chooseScreeningGroup(page, head)
      await banner.getByRole('button', { name: `Выделить на ${collection.code}: 1`, exact: true }).click()
      await expect(banner.locator('[data-slot="select-report"]')).toContainText('Выделено: 1')
      await page.reload()
      const saved = await read(page, head, `/api/operations/statuses/?employee_id=${group.id}`)
      expect(JSON.stringify(saved)).toContain(eventId)
      expect(JSON.stringify(saved)).toContain('SCREENING_GROUP')
    }
    const officer = await role(page, 'acc_forces_officer')
    const request = await read(page, officer, `/api/ops/security-events/forces/requests/${encodeURIComponent(allocation.id)}/`)
    if (!request.allocation.submittedAt) {
      await page.goto(`${APP}/employees?request=${encodeURIComponent(allocation.id)}&businessDate=${run.businessDate}`)
      await page.getByRole('button', { name: 'Отправить список в штаб', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.reload()
      expect((await read(page, officer, `/api/ops/security-events/forces/requests/${encodeURIComponent(allocation.id)}/`)).allocation.submittedAt).toBeTruthy()
    }
  }
  await role(page, 'acc_ops_staff')
  await page.goto(`${APP}/employees?campaign=${run.campaignId}&businessDate=${run.businessDate}`)
  campaign = await read(page, hq, `/api/ops/security-events/forces/campaigns/${run.campaignId}/`)
  for (const [index, employeeId] of [fixture.people.participant.id, fixture.people.noaccount.id, fixture.people.participant.id, fixture.people.noaccount.id].entries()) {
    const event = campaign.events.find((row: { eventId: string }) => row.eventId === run.eventIds[Math.floor(index / 2)])
    const visit = event.visitObjects[index % 2]
    const demand = event.demandRows.find((row: { visitObjectId: string; kindCode: string }) => row.visitObjectId === visit.visitObjectId && row.kindCode === 'PHYSICAL_SQUAD')
    if (campaign.assignments.some((row: { employeeId: string; eventId: string; visitObjectId: string }) => row.employeeId === employeeId && row.eventId === event.eventId && row.visitObjectId === visit.visitObjectId)) continue
    await page.getByLabel('Сотрудник', { exact: true }).selectOption(employeeId)
    await page.getByLabel('Мероприятие', { exact: true }).selectOption(event.eventId)
    await page.getByLabel('Объект', { exact: true }).selectOption(visit.visitObjectId)
    await page.getByLabel('Строка потребности', { exact: true }).selectOption(demand.id)
    if (index >= 2) {
      await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toBeDisabled()
      await page.getByRole('checkbox', { name: 'Подтвердить назначение с конфликтом', exact: true }).check()
      await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toBeDisabled()
      await page.getByLabel('Причина конфликта', { exact: true }).fill(`${marker}: последовательные смены согласованы Штабом`)
    }
    await page.getByRole('button', { name: 'Назначить', exact: true }).click()
    await expect.poll(async () => (await read(page, hq, `/api/ops/security-events/forces/campaigns/${run.campaignId}/`)).assignments.length).toBe(index + 1)
    await page.reload()
    campaign = await read(page, hq, `/api/ops/security-events/forces/campaigns/${run.campaignId}/`)
    const saved = campaign.assignments.find((row: { employeeId: string; eventId: string; visitObjectId: string }) => row.employeeId === employeeId && row.eventId === event.eventId && row.visitObjectId === visit.visitObjectId)
    expect(saved.demandRowId).toBe(demand.id)
    if (index >= 2) expect(saved.overrideReason).toContain(marker)
  }
  if (campaign.status !== 'HANDED_OVER') {
    await page.getByLabel('Комментарий при неполном распределении', { exact: true }).fill(`${marker}: физнаряд каждого объекта обеспечен, досмотр ожидает усиления`)
    await page.getByRole('button', { name: 'Передать в расстановку', exact: true }).click()
    await expect.poll(async () => (await read(page, hq, `/api/ops/security-events/forces/campaigns/${run.campaignId}/`)).status).toBe('HANDED_OVER')
  }
  await page.reload()
  await stableScreenshot(page, `/tmp/1090-${run.campaignId}-campaign-handover.png`)
  await finishOmUI(page, run)
})

test('продолжение свежей UI кампании: согласование, ознакомление, закрытие', async ({ page }) => {
  test.setTimeout(900_000)
  page.on('response', async response => {
    if (response.status() >= 400 && response.url().includes('/api/ops/')) console.log(`UI ${response.request().method()} ${new URL(response.url()).pathname}: ${response.status()} ${await response.text().catch(() => '(navigation)')}`)
  })
  expect(process.env.OM_ACCEPTANCE_RESUME).toBe('1')
  const run: OmRun = JSON.parse(fs.readFileSync('/tmp/1090-om-ui-resume.json', 'utf8'))
  expect(run.campaignId).not.toBe('3')
  await finishOmUI(page, run)
})

test('сотрудники обоих ОМ текущей кампании подтверждают ознакомление', async ({ page }) => {
  test.setTimeout(180_000)
  const run: OmRun = JSON.parse(fs.readFileSync('/tmp/1090-om-ui-resume.json', 'utf8'))
  expect(run.campaignId).not.toBe('3')
  await finishOmUI(page, run, 'ack')
})

async function finishOmUI(page: Page, run: OmRun, phase: 'full' | 'ack' = 'full') {
  const fixture = prerequisites()
  const token = await role(page, 'acc_ops_staff')
  const campaign = await read(page, token, `/api/ops/security-events/forces/campaigns/${run.campaignId}/`)
  expect(campaign.title).toBe(`${run.marker} Общая кампания`)
  expect(campaign.status).toBe('HANDED_OVER')
  expect(campaign.assignments).toHaveLength(4)
  for (const [eventIndex, eventId] of run.eventIds.entries()) {
    let event = await read(page, token, `/api/ops/security-events/${eventId}/`)
    expect(event.title).toBe(`${run.marker} ОМ${eventIndex + 1}`)
    for (const [visitIndex, initialVisit] of event.visitObjects.entries()) {
      const visitId = initialVisit.id
      const seniorName = initialVisit.chiefEmployeeId === fixture.people.senior.id ? 'probe1090_senior' : 'probe1090_senior2'
      const screenshot = (step: string) => stableScreenshot(page, `/tmp/1090-${run.campaignId}-${eventId}-${visitId}-${step}.png`)
      const senior = await role(page, seniorName)
      event = await read(page, senior, `/api/ops/security-events/${eventId}/`)
      let visit = event.visitObjects.find((row: { id: string }) => row.id === visitId)
      const needsReturn = eventIndex === 0 && visitIndex === 0
      const finalVersion = needsReturn ? 2 : 1
      if (visit.stage === 'APPROVAL' && visit.approvalRemarks.some((row: { status: string }) => row.status === 'OPEN')) {
        await page.goto(`${APP}/security-ops/events/${eventId}?visit=${visitId}`)
        await expect(page.getByRole('region', { name: 'Согласование расстановки', exact: true })).toBeVisible()
        const unresolved = page.getByRole('button', { name: 'Устранено', exact: true })
        while (await unresolved.count()) {
          const count = await unresolved.count()
          await unresolved.first().click()
          await expect(unresolved).toHaveCount(count - 1)
        }
        event = await persisted(page, senior, eventId)
        visit = event.visitObjects.find((row: { id: string }) => row.id === visitId)
      }
      const physicalPost = event.reconSectorPosts.find((row: { visitObjectId: string; demandKindCode: string }) => row.visitObjectId === visitId && row.demandKindCode === 'PHYSICAL_SQUAD')
      const expectedAssignment = campaign.assignments.find((row: { eventId: string; visitObjectId: string }) => row.eventId === eventId && row.visitObjectId === visitId)
      expect(expectedAssignment).toBeTruthy()
      if (visit.stage === 'PLACEMENT') {
        await page.goto(`${APP}/security-ops/events/${eventId}?visit=${visitId}`)
        if (!event.placementAssignments.some((row: { employeeId: string; postId: string }) => row.employeeId === expectedAssignment.employeeId && row.postId === physicalPost.id)) {
          await page.getByRole('button', { name: 'Распределить автоматически', exact: true }).click()
          await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить распределение', exact: true }).click()
          await expect(page.getByRole('dialog')).toHaveCount(0)
        }
        if (visit.approvalStatus === 'RETURNED') {
          const correction = `${run.marker}: при недоборе старший вызывает усиление; досмотр открывается после усиления`
          await page.getByRole('textbox', { name: 'Комментарий к посту', exact: true }).fill(correction)
          await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled()
          expect((await persisted(page, senior, eventId)).reconSectorPosts.find((row: { id: string }) => row.id === physicalPost.id).comment).toBe(correction)
          await screenshot('corrected-post')
        }
        await page.getByRole('button', { name: 'Завершить расстановку', exact: true }).click()
        const shortage = page.getByRole('dialog')
        await expect(shortage.getByRole('button', { name: 'Подтвердить оверрайд', exact: true })).toBeDisabled()
        await shortage.getByRole('textbox').fill(`${run.marker}: недобор досмотра; до усиления пост не открывается`)
        await shortage.getByRole('button', { name: 'Подтвердить оверрайд', exact: true }).click()
        await expect(shortage).toHaveCount(0)
        event = await persisted(page, senior, eventId)
        visit = event.visitObjects.find((row: { id: string }) => row.id === visitId)
        expect(visit.stage).toBe('APPROVAL')
        expect(event.placementAssignments).toEqual(expect.arrayContaining([expect.objectContaining({ employeeId: expectedAssignment.employeeId, postId: physicalPost.id })]))
        await screenshot('placement-completed')
      }
      if (visit.stage === 'APPROVAL' && visit.documentStatus !== 'SUBMITTED') {
        await page.goto(`${APP}/security-ops/events/${eventId}?visit=${visitId}`)
        await expect(page.getByRole('region', { name: 'Согласование расстановки', exact: true })).toBeVisible()
        const resolved = page.getByRole('button', { name: 'Устранено', exact: true })
        while (await resolved.count()) {
          const count = await resolved.count()
          await resolved.first().click()
          await expect(resolved).toHaveCount(count - 1)
        }
        if (visit.documentVersion === 0 || visit.documentVersions.length === 0) {
          await page.getByRole('combobox', { name: 'Выберите согласующего из руководства второго департамента', exact: true }).selectOption({ label: 'Калиев Алишер Дарханович · acc_dir_head_d2' })
          await page.getByRole('button', { name: 'Назначить первым согласующим', exact: true }).click()
        }
        await page.getByRole('button', { name: 'Отправить на согласование', exact: true }).click()
        event = await persisted(page, senior, eventId)
        visit = event.visitObjects.find((row: { id: string }) => row.id === visitId)
        expect(visit.documentStatus).toBe('SUBMITTED')
        await screenshot(`v${visit.documentVersion}-sent`)
      }
      if (needsReturn && visit.documentVersion === 1 && visit.documentStatus === 'SUBMITTED') {
        const approver = await role(page, 'acc_dir_head_d2')
        await page.goto(`${APP}/security-ops/events/${eventId}?visit=${visitId}`)
        await page.getByRole('row').filter({ hasText: 'учётка acc_dir_head_d2' }).getByRole('button', { name: 'Вернуть', exact: true }).click()
        const dialog = page.getByRole('dialog')
        await dialog.getByLabel('Общая причина *', { exact: true }).fill(`${run.marker}: уточнить действия при недоборе`)
        for (const n of [1, 2]) {
          await dialog.getByRole('button', { name: '+ Замечание', exact: true }).click()
          await dialog.getByLabel(`Текст замечания ${n}`, { exact: true }).fill(`${run.marker}: ${n === 1 ? 'порядок усиления' : 'уточнить запись физического поста'}`)
        }
        await dialog.getByLabel('Пост замечания 2', { exact: true }).selectOption(physicalPost.id)
        await dialog.getByRole('button', { name: 'Подтвердить возврат', exact: true }).click()
        await expect(dialog).toHaveCount(0)
        const returned = (await persisted(page, approver, eventId)).visitObjects.find((row: { id: string }) => row.id === visitId)
        expect(returned).toMatchObject({ stage: 'PLACEMENT', approvalStatus: 'RETURNED', documentVersion: 1 })
        expect(returned.approvalRemarks).toHaveLength(2)
        await screenshot('v1-returned')
        // Repeat this same object's UI correction branch, preserving all saved
        // signatures/version history. Nothing is reset or rebuilt via API.
        return finishOmUI(page, run, phase)
      }
      if (visit.documentStatus === 'SUBMITTED') {
        for (const [index, username] of ['acc_dir_head_d2', 'probe1090_approver2'].entries()) {
          const signer = await role(page, username)
          const saved = await read(page, signer, `/api/ops/security-events/${eventId}/`)
          const current = saved.visitObjects.find((row: { id: string }) => row.id === visitId)
          if (current.approvalRoute[index].status !== 'APPROVED') {
            await page.goto(`${APP}/security-ops/events/${eventId}?visit=${visitId}`)
            const decision = page.waitForResponse(response => response.url().includes('/decide/') && response.request().method() === 'POST')
            await page.getByRole('row').filter({ hasText: `учётка ${username}` }).getByRole('button', { name: 'Согласовать', exact: true }).click()
            const result = await decision
            expect(result.status(), await result.text()).toBe(200)
          }
          const signed = (await persisted(page, signer, eventId)).visitObjects.find((row: { id: string }) => row.id === visitId)
          expect(signed.approvalRoute[index]).toMatchObject({ status: 'APPROVED', signature: { login: username, versionNumber: finalVersion } })
          await screenshot(`signature-${index + 1}`)
        }
      }
      const verified = (await read(page, senior, `/api/ops/security-events/${eventId}/`)).visitObjects.find((row: { id: string }) => row.id === visitId)
      expect(verified.documentStatus).toBe('APPROVED')
      expect(verified.approvalRoute.map((row: { signature: { login: string } }) => row.signature.login)).toEqual(['acc_dir_head_d2', 'probe1090_approver2'])
      if (needsReturn) expect(verified.documentVersions.map((row: { number: number; status: string }) => [row.number, row.status])).toEqual([[1, 'RETURNED'], [2, 'APPROVED']])
    }
  }
  for (const [eventIndex, eventId] of run.eventIds.entries()) {
    for (const noaccount of [false, true]) {
      const username = noaccount ? 'acc_dir_head' : 'probe1090_participant'
      const ackToken = await role(page, username)
      const employeeId = noaccount ? fixture.people.noaccount.id : fixture.people.participant.id
      const endpoint = `/api/ops/security-events/my-assignments/${noaccount ? `?employee=${employeeId}` : ''}`
      const before = await read(page, ackToken, endpoint)
      const assignment = before.results.find((row: { eventId: string }) => row.eventId === eventId)
      expect(assignment).toBeTruthy()
      await page.goto(`${APP}/security-ops/profile${noaccount ? `/${employeeId}` : ''}`)
      const item = page.getByRole('listitem').filter({ hasText: `${run.marker} ОМ${eventIndex + 1}` })
      await expect(item).toBeVisible()
      if (!assignment.acknowledgedAt) {
        if (noaccount) {
          await item.getByRole('button', { name: 'Ознакомлен лично', exact: true }).click()
          const dialog = page.getByRole('dialog')
          await expect(dialog.getByRole('button', { name: 'Подтвердить ознакомление', exact: true })).toBeDisabled()
          await dialog.getByLabel('Способ доведения *', { exact: true }).fill(`${run.marker}: личный инструктаж начальником управления`)
          await expect(dialog.getByRole('button', { name: 'Подтвердить ознакомление', exact: true })).toBeDisabled()
          await dialog.getByLabel('Основание отсутствия учётной записи *', { exact: true }).fill(`${run.marker}: сотруднику ещё не выдана учётная запись`)
          await dialog.getByRole('button', { name: 'Подтвердить ознакомление', exact: true }).click()
          await expect(dialog).toHaveCount(0)
        } else {
          const acknowledgement = page.waitForResponse(response => response.url().includes('/acknowledge/') && response.request().method() === 'POST')
          await item.getByRole('button', { name: 'Ознакомлен, заступлю', exact: true }).click()
          expect((await acknowledgement).status()).toBe(200)
        }
      }
      await page.reload()
      const saved = (await read(page, ackToken, endpoint)).results.find((row: { eventId: string }) => row.eventId === eventId)
      expect(saved.acknowledgedAt).toBeTruthy()
      expect(saved.acknowledgedVia).toBe(noaccount ? 'personal' : 'self')
      if (noaccount) expect(JSON.stringify(saved)).toContain(run.marker)
      await stableScreenshot(page, `/tmp/1090-${run.campaignId}-${eventId}-${noaccount ? 'head-personal' : 'self'}-ack.png`)
    }
    if (phase === 'ack') continue
    const leadToken = await role(page, 'acc_dept_head_d2')
    let event = await read(page, leadToken, `/api/ops/security-events/${eventId}/`)
    if (event.stage === 'ACKNOWLEDGEMENT') {
      expect(event.placementAssignments.every((row: { acknowledgedAt: string | null }) => row.acknowledgedAt)).toBe(true)
      await page.goto(`${APP}/security-ops/events/${eventId}`)
      await expect(page.getByRole('button', { name: 'Завершить ознакомление', exact: true })).toBeEnabled()
      const completion = page.waitForResponse(response => response.url().includes('/acknowledgement/complete/') && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Завершить ознакомление', exact: true }).click()
      const completed = await completion
      expect(completed.status(), await completed.text()).toBe(200)
      event = await persisted(page, leadToken, eventId)
      expect(event.stage).toBe('CONDUCT')
      await stableScreenshot(page, `/tmp/1090-${run.campaignId}-${eventId}-conduct.png`)
    }
    for (const initialVisit of event.visitObjects) {
      if (initialVisit.stage === 'CLOSED') continue
      const seniorName = initialVisit.chiefEmployeeId === fixture.people.senior.id ? 'probe1090_senior' : 'probe1090_senior2'
      const senior = await role(page, seniorName)
      await page.goto(`${APP}/security-ops/events/${eventId}?visit=${initialVisit.id}`)
      await expect(page.locator('[data-slot="evaluation-panel"]')).toBeVisible()
      await stableScreenshot(page, `/tmp/1090-${run.campaignId}-${eventId}-${initialVisit.id}-senior-conduct.png`)
      await expect(page.getByRole('button', { name: 'Всем 10', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: 'Всем 10', exact: true }).click()
      await expect(page.locator('[data-slot="evaluation-progress"]')).toHaveText('Оценено 1 из 1')
      const incidents = page.locator('[data-slot="incidents-panel"]')
      await incidents.getByRole('button', { name: '+ Добавить', exact: true }).click()
      const form = incidents.locator('[data-slot="incident-form"]')
      const post = event.reconSectorPosts.find((row: { visitObjectId: string; demandKindCode: string }) => row.visitObjectId === initialVisit.id && row.demandKindCode === 'PHYSICAL_SQUAD')
      await form.getByLabel('Время', { exact: true }).fill(`${run.businessDate}T11:00`)
      await form.getByLabel('Пост', { exact: true }).selectOption(post.id)
      await form.getByLabel('Описание *', { exact: true }).fill(`${run.marker}: учебная проверка связи ${initialVisit.id}`)
      await form.getByLabel('Принятые меры', { exact: true }).fill('Связь со старшим подтверждена, замечание устранено')
      await form.getByRole('button', { name: 'Записать инцидент', exact: true }).click()
      await expect(form).toHaveCount(0)
      const conducted = await persisted(page, senior, eventId)
      expect(conducted.journalEntries.some((row: { type: string; postId: string; title: string }) => row.type === 'INCIDENT' && row.postId === post.id && row.title.includes(run.marker))).toBe(true)
      await stableScreenshot(page, `/tmp/1090-${run.campaignId}-${eventId}-${initialVisit.id}-evaluated.png`)
      await page.getByRole('button', { name: 'Закрыть объект', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Итоговый комментарий по объекту (необязательно)', { exact: true }).fill(`${run.marker}: служба завершена, связь проверена, оценки выставлены`)
      await dialog.getByRole('button', { name: 'Подтвердить закрытие', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const closed = await persisted(page, senior, eventId)
      expect(closed.visitObjects.find((row: { id: string }) => row.id === initialVisit.id)).toMatchObject({ stage: 'CLOSED' })
      await stableScreenshot(page, `/tmp/1090-${run.campaignId}-${eventId}-${initialVisit.id}-closed.png`)
    }
    expect((await read(page, leadToken, `/api/ops/security-events/${eventId}/`)).stage).toBe('CLOSED')
  }
  if (phase === 'ack') {
    console.log('ACK UI ONLY COMPLETE; conduct/closure not executed', JSON.stringify(run))
    return
  }
  const participant = await role(page, 'probe1090_participant')
  await page.goto(`${APP}/security-ops/profile`)
  await page.getByRole('tab', { name: 'История', exact: true }).click()
  const history = await read(page, participant, '/api/ops/security-events/my-assignments/')
  for (const [index, eventId] of run.eventIds.entries()) {
    expect(history.results.find((row: { eventId: string }) => row.eventId === eventId).eventStage).toBe('CLOSED')
    await expect(page.getByRole('link', { name: new RegExp(`${run.marker} ОМ${index + 1}`) })).toBeVisible()
  }
  await stableScreenshot(page, `/tmp/1090-${run.campaignId}-participant-history.png`)
  const analyst = await role(page, 'acc_ops_staff')
  for (const eventId of run.eventIds) {
    const event = await read(page, analyst, `/api/ops/security-events/${eventId}/`)
    await page.goto(`${APP}/security-ops/analytics/operations?event=${eventId}`)
    await expect(page.getByRole('navigation', { name: 'Путь детализации', exact: true })).toContainText(event.code)
    const analytics = await read(page, analyst, `/api/ops/operations-analytics/?level=EVENT&event_id=${eventId}`)
    expect(JSON.stringify(analytics.data)).toContain(event.code)
    await stableScreenshot(page, `/tmp/1090-${run.campaignId}-${eventId}-analytics.png`)
  }
  console.log('FULL OM UI COMPLETE', JSON.stringify(run))
}
