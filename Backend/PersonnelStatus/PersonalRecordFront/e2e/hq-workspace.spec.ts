/** Plane №1094: HQ request ownership and cross-event pool HTTP contracts. */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { QueryClient } from '@tanstack/react-query'
import { refreshForceWorkspaceViews } from '../hooks/use-force-campaigns'

test('изменение сбора или кампании обновляет пул, резервы и затронутые сборы', async () => {
  const client = new QueryClient()
  const changed = [['ops-force-campaigns'], ['ops-force-campaign', 'c1094'], ['ops-force-campaign-reserves'], ['ops-force-collections'], ['ops-force-collection', '1094'], ['ops-force-collection', '1094', 'roster'], ['ops-security-events']]
  const unchanged = [['ops-force-collection', 'other-event'], ['employees']]
  for (const key of [...changed, ...unchanged]) client.setQueryData(key, { old: true })
  await refreshForceWorkspaceViews(client, ['1094'])
  for (const key of changed) expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true)
  for (const key of unchanged) expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(false)
  client.clear()
})

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
async function signIn(page: Page) {
  const api = page.context().request
  const csrf = await (await api.get(`${APP}/api/auth/csrf/`)).json()
  const login = await api.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' } })
  expect((await login.json()).url).not.toContain('error=')
}
async function screenshots(page: Page, name: string) {
  if (process.env.WORKSPACE_SCREENSHOTS !== '1') return
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.evaluate(() => { window.scrollTo(0, 0) })
  await page.waitForTimeout(300) // Let the existing sidebar resize transition finish.
  await page.screenshot({ path: `/tmp/hq-1094-${name}-desktop.png`, fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { window.scrollTo(0, 0) })
  await page.waitForTimeout(300)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `/tmp/hq-1094-${name}-mobile.png`, fullPage: true, animations: 'disabled' })
}

test.describe('рабочее место Штаба', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'нужен авторизованный фронтенд')
  test('новое распределение сохраняет выбранные ОМ и открывает прямую ссылку', async ({ page }) => {
    await signIn(page)
    const event = { eventId: '1094', code: 'ОМ-1094', title: 'Проверка запроса Штаба', businessDate: '2026-09-15', need: 5, requested: 5, allocating: 3, sent: 2, shortage: 3, departments: 1, boardStatus: { code: 'NEW', label: 'Новая' } }
    const calls: unknown[] = []
    const campaign = { id: 'created1094', code: 'РС-1094', title: 'Осеннее распределение', status: 'DRAFT', events: [], pool: [], assignments: [], warnings: [] }
    await page.route(url => url.pathname.endsWith('/forces/collections/'), route => route.fulfill({ json: { results: [event] } }))
    await page.route(url => url.pathname.endsWith('/campaigns/created1094/'), route => route.fulfill({ json: campaign }))
    await page.route(url => url.pathname.endsWith('/forces/campaigns/'), async route => {
      if (route.request().method() === 'POST') { calls.push(route.request().postDataJSON()); await new Promise(resolve => setTimeout(resolve, 500)); await route.fulfill({ json: campaign }); return }
      await route.fulfill({ json: { results: [] } })
    })
    await page.goto(`${APP}/employees?view=forces&tab=collections`)
    await expect(page.locator('[data-slot="collection-requested"]')).toHaveText('5')
    await expect(page.locator('[data-slot="collection-allocating"]')).toHaveText('3')
    await expect(page.locator('[data-slot="collection-shortage"]')).toHaveText('3')
    await page.getByRole('button', { name: 'Новое распределение', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Создать распределение', exact: true })).toBeDisabled()
    await page.getByLabel('Название', { exact: true }).fill(campaign.title)
    await page.getByRole('checkbox', { name: /ОМ-1094/ }).check()
    await page.getByRole('button', { name: 'Создать распределение', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Создать распределение', exact: true })).toBeDisabled()
    await expect(page).toHaveURL(/campaign=created1094/)
    await expect(page.getByRole('heading', { name: campaign.title, exact: true })).toBeVisible()
    expect(calls).toEqual([{ title: campaign.title, eventIds: ['1094'] }])
  })
  test('черновик → отправка: физический наряд, группы, срок и комментарий; ответ перечитывается', async ({ page }) => {
    await signIn(page)
    const allocation = { id: 'a1094', departmentId: '1094', departmentName: 'Департамент охраны', need: 5, comment: 'Исходный комментарий', dueAt: null as string | null, allocating: null as number | null, sent: 0, status: 'DRAFT', sentAt: null as string | null, notifiedAt: null, submittedAt: null, decidedAt: null, decisionComment: '', directorates: [], members: [] as object[], groupDemands: [] as object[] }
    const group = { id: 'g1094', kindCode: 'SCREENING_GROUP', need: 2, place: 'Вход', specification: 'Досмотр' }
    const collection = { eventId: '1094', code: 'ОМ-1094', title: 'Проверка запроса Штаба', businessDate: '2026-09-15', location: 'Дворец', eventTime: null, stage: 'FORCES', need: 5, allocated: 5, gathered: 0, remaining: 5, collectionStatus: 'NEW', urgent: false, boardStatus: { code: 'NEW', label: 'Новая' }, needByObject: [{ visitObjectId: 'o1094', objectName: 'Дворец', need: 5, statusLabel: 'Завершена', chiefName: '' }], demandRows: [{ id: 'd1094', kindCode: 'PHYSICAL_SQUAD', need: 5, visitObjectId: 'o1094', place: 'Периметр' }, group], allocations: [allocation], totals: { need: 5, allocating: 0, sent: 0, shortage: 5 }, roster: [], objects: [], handover: {} }
    const calls: unknown[] = []
    let reads = 0
    await page.route(url => url.pathname.endsWith('/core/divisions/'), route => route.fulfill({ json: { results: [{ id: 1094, name: 'Департамент охраны', type_code: 'department', parent: null, is_active: true }, { id: 1095, name: 'Первый департамент', type_code: 'department', parent: null, is_active: true }] } }))
    await page.route(url => url.pathname.endsWith('/force-collection/'), route => { reads++; return route.fulfill({ json: collection }) })
    await page.route(url => url.pathname.endsWith('/forces/allocation/'), async route => {
      const body = route.request().postDataJSON(); calls.push(body)
      await new Promise(resolve => setTimeout(resolve, 500))
      allocation.need = body.rows[0].need; allocation.comment = body.rows[0].comment; allocation.dueAt = body.rows[0].dueAt
      allocation.groupDemands = [group]
      if (!body.draft) { allocation.sentAt = '2026-09-09T10:00:00Z'; allocation.allocating = 3; allocation.sent = 2; allocation.members = [{ employeeId: 'p1094', name: 'Полученный сотрудник', divisionName: 'Первое управление', source: 'STATUS' }]; collection.totals = { need: 5, allocating: 3, sent: 2, shortage: 3 } }
      await route.fulfill({ json: {} })
    })
    await page.goto(`${APP}/employees?view=forces&tab=collections&collection=1094`)
    await expect(page.getByRole('heading', { name: collection.title, exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('list', { name: 'Этапы работы Штаба' }).getByRole('listitem')).toHaveCount(4)
    await page.getByLabel('Комментарий Штаба, строка 1').fill('Основной объём')
    await page.getByLabel('Срок сдачи списка, строка 1').fill('2026-09-14T15:00')
    await page.getByRole('checkbox', { name: /Досмотр/ }).check()
    await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click()
    await expect.poll(() => reads).toBeGreaterThan(1)
    await expect(page.locator('[data-slot="draft-row"]')).toHaveCount(1)
    await expect(page.getByLabel('Комментарий Штаба, строка 1')).toHaveValue('Основной объём')
    await screenshots(page, 'draft')
    await page.getByRole('button', { name: 'Отправить запросы', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Отправляю…' })).toBeDisabled()
    await expect.poll(() => reads).toBeGreaterThan(1)
    await expect(page.locator('[data-slot="draft-row"]')).toHaveCount(0)
    await expect(page.locator('[data-slot="department-allocating"]')).toHaveText('3')
    await expect(page.locator('[data-slot="collection-totals"]')).toContainText('прислано 2')
    await page.getByRole('button', { name: 'Департамент охраны', exact: true }).click()
    await expect(page.getByText('Полученный сотрудник', { exact: true })).toBeVisible()
    const expectedRows = [{ departmentId: '1094', need: 5, comment: 'Основной объём', groupDemandIds: ['g1094'], dueAt: await page.evaluate(() => new Date('2026-09-14T15:00').toISOString()) }]
    expect(calls).toEqual([{ draft: true, rows: expectedRows }, { draft: false, rows: expectedRows }])
    await screenshots(page, 'received')
    await page.getByRole('button', { name: 'Департамент', exact: true }).click()
    await page.getByLabel('Департамент, строка 1', { exact: true }).selectOption('1095')
    await page.getByLabel('Сколько человек, строка 1').fill('2')
    await page.getByLabel('Комментарий Штаба, строка 1').fill('Резерв')
    await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click()
    await expect.poll(() => calls.length).toBe(3)
    expect(calls[2]).toEqual({ draft: true, rows: [...expectedRows, { departmentId: '1095', need: 2, comment: 'Резерв', groupDemandIds: [] }] })
    await expect(page.locator('[data-slot="department-row"] input')).toHaveCount(0)
    await page.getByRole('button', { name: 'Назад к списку сборов', exact: true }).click()
    await expect(page).not.toHaveURL(/collection=/)
  })

  test('общий пул: точные назначения, конфликт и передача с причиной недобора', async ({ page }) => {
    await signIn(page)
    const campaign = { id: 'c1094', code: 'РС-1094', title: 'Распределение Штаба', status: 'DISTRIBUTING', events: ['1', '2'].map(id => ({ eventId: `e${id}`, code: `ОМ-${id}`, title: `Мероприятие ${id}`, businessDate: '2026-09-15', businessDateEnd: null, eventTime: '08:00', visitObjects: [{ visitObjectId: `o${id}`, objectName: `Объект ${id}` }], demandRows: [{ id: `d${id}`, visitObjectId: `o${id}`, kindCode: 'PHYSICAL_SQUAD', need: 3, place: 'Периметр' }] })), pool: ['1', '2'].map(id => ({ employeeId: `p${id}`, employeeName: `Сотрудник ${id}`, kindCode: 'PHYSICAL_SQUAD', sourceEventIds: ['e1'] })), assignments: [] as any[], warnings: [] }
    const calls: { action: string; body: unknown }[] = []
    let reads = 0
    await page.route(url => url.pathname.endsWith('/force-collection/'), route => route.fulfill({ json: { allocations: [{ id: 'request-pool', departmentName: 'Департамент охраны', need: 3, allocating: 2, sent: 1, sentAt: '2026-09-09T10:00:00Z' }], totals: { allocating: 2, sent: 1, shortage: 2 } } }))
    await page.route(url => url.pathname.endsWith('/campaigns/c1094/'), route => { reads++; return route.fulfill({ json: campaign }) })
    await page.route(url => /\/campaigns\/c1094\/(assignments|hand-over)\/$/.test(url.pathname), async route => {
      const action = new URL(route.request().url()).pathname.split('/').at(-2)!
      const body = route.request().postDataJSON(); calls.push({ action, body })
      await new Promise(resolve => setTimeout(resolve, 500))
      if (action === 'assignments') campaign.assignments.push({ id: `a${calls.length}`, ...body, employeeName: 'Сотрудник 1', kindCode: 'PHYSICAL_SQUAD' })
      if (action === 'hand-over' && !body.comment) { await route.fulfill({ status: 422, json: { error_code: 'VALIDATION_ERROR', message: 'При неполном распределении укажите причину передачи.', details: { comment: ['При неполном распределении укажите причину передачи.'] } } }); return }
      if (action === 'hand-over') campaign.status = 'HANDED_OVER'
      await route.fulfill({ json: campaign })
    })
    await page.goto(`${APP}/employees?view=forces&tab=collections&campaign=c1094`)
    await expect(page.getByRole('heading', { name: campaign.title, exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('list', { name: 'Этапы работы Штаба' }).getByRole('listitem')).toHaveCount(4)
    await page.getByLabel('Сотрудник', { exact: true }).selectOption('p1')
    await page.getByLabel('Мероприятие', { exact: true }).selectOption('e1')
    await page.getByLabel('Объект', { exact: true }).selectOption('o1')
    await page.getByLabel('Строка потребности', { exact: true }).selectOption('d1')
    await page.getByRole('button', { name: 'Назначить', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toBeDisabled()
    await expect.poll(() => reads).toBeGreaterThan(1)
    await page.getByLabel('Мероприятие', { exact: true }).selectOption('e2')
    await page.getByLabel('Объект', { exact: true }).selectOption('o2')
    await page.getByLabel('Строка потребности', { exact: true }).selectOption('d2')
    await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toBeDisabled()
    await page.getByLabel('Подтвердить назначение с конфликтом').check()
    await page.getByLabel('Причина конфликта').fill('Разные часы дежурства')
    await page.getByRole('button', { name: 'Назначить', exact: true }).click()
    await expect.poll(() => campaign.assignments.length).toBe(2)
    await page.getByRole('button', { name: 'Передать в расстановку', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'причину передачи' })).toBeVisible()
    await page.getByLabel('Комментарий при неполном распределении').fill('Оставшийся сотрудник — резерв')
    await screenshots(page, 'pool')
    await page.getByRole('button', { name: 'Передать в расстановку', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Передать в расстановку', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toHaveCount(0)
    expect(calls).toEqual([
      { action: 'assignments', body: { employeeId: 'p1', eventId: 'e1', visitObjectId: 'o1', demandRowId: 'd1' } },
      { action: 'assignments', body: { employeeId: 'p1', eventId: 'e2', visitObjectId: 'o2', demandRowId: 'd2', overrideConflict: true, overrideReason: 'Разные часы дежурства' } },
      { action: 'hand-over', body: { comment: '' } }, { action: 'hand-over', body: { comment: 'Оставшийся сотрудник — резерв' } },
    ])
    await page.getByRole('button', { name: 'Назад к распределениям', exact: true }).click()
    await expect(page).not.toHaveURL(/campaign=/)
  })
})
