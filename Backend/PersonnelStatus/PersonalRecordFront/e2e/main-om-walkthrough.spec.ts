import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { anyChiefId } from './stand-chief'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { uniqueBusinessDate } from './business-date'
import { assertStep } from './fixture-step'
import { ROUTES } from './portal-routes'
import { runBackendCommand } from './backend-command'
import { acceptRosterFor } from './stand-roster'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
let probeMarker: string | null = null
let probeCampaign: { id: string; title: string } | null = null
type ApprovalStep = { roleLabel: string; unit: string; username: string; fullName: string }
let approvalSnapshot: { token: string; steps: ApprovalStep[] } | null = null

const CHECKPOINTS = [
  ['бюллетень', 'bulletin-stage.spec.ts', 'Бюллетень мероприятия'],
  ['объекты и старшие', 'event-capabilities.spec.ts', 'canManageVisitObjects'],
  ['рекогносцировка', 'recon-stage.spec.ts', 'рекогносцировк'],
  ['типизированная потребность', 'forces-gathering.spec.ts', 'EVENT_ASSIGNMENT_GROUP'],
  ['раскладка департаментам', 'force-collections.spec.ts', 'Запрошено'],
  ['раскладка управлениям', 'department-requests.spec.ts', 'Распределение по управлениям'],
  ['резерв без фиктивного статуса', 'department-requests.spec.ts', 'Резерв ОМ'],
  ['общая кампания', 'force-collections.spec.ts', 'общее распределение'],
  ['расстановка', 'placement-stage.spec.ts', 'Расстановка сил'],
  ['выбор первого согласующего', 'approval-rights-rules.spec.ts', 'выбирает первого согласующего'],
  ['две подписи', 'approval-route.spec.ts', 'Второй шаг раньше первого'],
  ['возврат и новая версия', 'approval-return.spec.ts', 'возврат'],
  ['ознакомление', 'acknowledgement-stage.spec.ts', 'ознакомлен'],
  ['начальник за сотрудника без учётки', 'acknowledgement-stage.spec.ts', 'без учётки'],
  ['проведение и оценки', 'conduct-evaluations.spec.ts', 'оцен'],
  ['закрытие объекта', 'visit-object-close.spec.ts', 'Закрыть объект'],
  ['итоговый статус и профиль', 'my-profile.spec.ts', 'История'],
] as const

async function token(): Promise<string> {
  const response = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  expect(response.status).toBe(200)
  return ((await response.json()) as { access: string }).access
}

async function signIn(page: Page): Promise<void> {
  const csrf = await page.request.get(`${APP}/api/auth/csrf/`)
  const csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken
  const response = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
  expect(response.status(), 'вход основной проходки ОМ не принят').toBe(200)
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const body = await page.screenshot({
    path: process.env.SMOKE_RESULTS_DIR ? testInfo.outputPath(`1046-om-${name}.png`) : `smoke-results/1046-om-${name}.png`,
    fullPage: true,
  })
  await testInfo.attach(name, {
    body,
    contentType: 'image/png',
  })
}

async function purgeOwnEvent(marker: string): Promise<void> {
  await runBackendCommand(
    [
      'purge_probe_events',
      '--marker',
      marker,
      '--yes',
      '--force',
      '--settings=organization_management.config.settings.local_postgres',
    ],
    { timeout: 120_000 },
  )
}

async function purgeOwnCampaign(campaign: { id: string; title: string }): Promise<void> {
  // Campaign links protect their event from deletion. Match both captured PK
  // and the exact unique title before removing this test's campaign only.
  const script = [
    'import os',
    'from organization_management.apps.operations.models_forces import OpsForceCampaign',
    'row = OpsForceCampaign.objects.get(pk=os.environ["E2E_CAMPAIGN_ID"], title=os.environ["E2E_CAMPAIGN_TITLE"])',
    'row.delete()',
  ].join('\n')
  await runBackendCommand(['shell', '-c', script], { env: { E2E_CAMPAIGN_ID: campaign.id, E2E_CAMPAIGN_TITLE: campaign.title } })
}

async function call<T>(accessToken: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  await assertStep(response, method, path)
  expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBeLessThan(300)
  return (await response.json()) as T
}

test('17 переходов ОМ привязаны к живым целевым сторожам и карте маршрутов', () => {
  expect(CHECKPOINTS).toHaveLength(17)
  for (const [label, file, marker] of CHECKPOINTS) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    expect(source, `${label}: в ${file} нет маркера «${marker}»`).toContain(marker)
  }
  const routes = new Set(ROUTES.map((row) => row.template))
  for (const route of [
    '/security-ops/events',
    '/security-ops/events/{eventId}',
    '/employees?view=forces',
    '/statuses',
  ]) {
    expect(routes.has(route), route).toBe(true)
  }
})

test.describe(LIVE ? 'основная проходка ОМ' : 'основная проходка ОМ (скип)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test.afterEach(async () => {
    try {
      if (probeCampaign !== null) {
        await purgeOwnCampaign(probeCampaign)
        probeCampaign = null
      }
      if (probeMarker !== null) {
        await purgeOwnEvent(probeMarker)
        probeMarker = null
      }
    } finally {
      if (approvalSnapshot !== null) {
        const original = approvalSnapshot
        approvalSnapshot = null
        await call(original.token, 'PUT', '/api/ops/approval-route/', { steps: original.steps })
      }
    }
  })

  test('бюллетень → рекогносцировка → потребность → расстановка → две подписи → ознакомление → проведение', async ({ page }, testInfo) => {
    const accessToken = await token()
    const previousRoute = await call<{ results: ApprovalStep[] }>(accessToken, 'GET', '/api/ops/approval-route/')
    approvalSnapshot = { token: accessToken, steps: previousRoute.results.map(({ roleLabel, unit, username, fullName }) => ({ roleLabel, unit, username, fullName })) }
    await call(accessToken, 'PUT', '/api/ops/approval-route/', { steps: [
      { roleLabel: 'Первый согласующий проходки', unit: 'Второй департамент', username: '', fullName: 'Первый согласующий проходки' },
      { roleLabel: 'Второй согласующий проходки', unit: 'Второй департамент', username: '', fullName: 'Второй согласующий проходки' },
    ] })
    const objects = await call<{ results: { id: string; publishedVersionCount: number }[] }>(
      accessToken,
      'GET',
      '/api/ops/security-events/bindable-objects/',
    )
    const object = objects.results.find((row) => row.publishedVersionCount > 0)
    expect(object, 'на стенде нет объекта с опубликованным паспортом').toBeDefined()
    probeMarker = `Основная проходка ОМ №1046 ${Date.now()}`
    const event = await call<{ id: string; code: string }>(accessToken, 'POST', '/api/ops/security-events/', {
      title: `${probeMarker} (e2e)`,
      objectId: object!.id,
      businessDate: uniqueBusinessDate(),
      kind: 'INTERNAL',
      chiefEmployeeId: await anyChiefId(accessToken),
    })
    const base = `/api/ops/security-events/${event.id}`
    // Заводить и завершать бюллетень не нужно: ОМ с объектом заводится сразу
    // на рекогносцировке («Реестр ОМ-5»); ручка и поля текста бюллетеня
    // сняты Plane №950.
    await call(accessToken, 'POST', `${base}/recon/import-from-passport/`)
    const recon = await call<{
      reconChecklist: Record<string, unknown>[]
      reconSectorPosts: { id: string; need: number; kindCode?: string }[]
    }>(accessToken, 'GET', `${base}/`)
    await call(accessToken, 'PATCH', `${base}/recon/`, {
      checklist: recon.reconChecklist.map((row) => ({ ...row, state: 'NORMAL', done: true, result: 'MATCHES' })),
      sectorPosts: recon.reconSectorPosts,
    })
    const placement = await call<{
      stage: string
      demandRows: { kindCode: string; need: number }[]
      reconSectorPosts: { id: string; need: number }[]
    }>(accessToken, 'POST', `${base}/recon/complete/`)
    expect(placement.stage).toBe('PLACEMENT')
    expect(placement.demandRows.every((row) => row.kindCode !== '' && row.need > 0)).toBe(true)
    const needed = placement.reconSectorPosts.reduce((sum, post) => sum + Math.max(post.need, 1), 0)
    expect(needed, 'расстановка без потребности не доказывает жизненный цикл').toBeGreaterThan(0)
    const accepted = await acceptRosterFor(accessToken, event.id, { count: needed })
    expect(accepted.employeeIds).toHaveLength(needed)
    let cursor = 0
    for (const post of placement.reconSectorPosts) {
      for (let i = 0; i < Math.max(post.need, 1); i += 1) {
        await call(accessToken, 'POST', `${base}/placement/assign/`, {
          postId: post.id,
          employeeId: accepted.employeeIds[cursor++],
        })
      }
    }
    const complete = await call<{ visitObjects: { id: string }[] }>(accessToken, 'POST', `${base}/placement/complete/`)
    expect(complete.visitObjects).toHaveLength(1)
    const visitObjectId = complete.visitObjects[0].id
    const sent = await call<{ visitObjects: { id: string; approvalRoute: { id: string; status: string }[] }[] }>(accessToken, 'POST', `${base}/approval/send/`, { visitObjectId })
    const route = sent.visitObjects.find(visit => visit.id === visitObjectId)!.approvalRoute
    expect(route).toHaveLength(2)
    for (const approver of route) {
      await call(accessToken, 'POST', `${base}/approval/route/${approver.id}/decide/`, {
        decision: 'APPROVED', comment: '', visitObjectId,
      })
    }

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${event.id}/`)
    await expect(page.getByRole('heading', { name: 'Ознакомление' })).toBeVisible({ timeout: 20_000 })
    await shot(page, testInfo, '01-acknowledgement-after-two-signatures')

    const campaign = await call<{ id: string; code: string; title: string; pool: { employeeId: string }[] }>(accessToken, 'POST', '/api/ops/security-events/forces/campaigns/', {
      title: `Общий пул основной проходки · ${probeMarker}`, eventIds: [event.id],
    })
    probeCampaign = { id: campaign.id, title: campaign.title }
    const savedCampaign = await call<typeof campaign>(accessToken, 'GET', `/api/ops/security-events/forces/campaigns/${campaign.id}/`)
    expect(savedCampaign.pool.map(person => person.employeeId).sort()).toEqual([...accepted.employeeIds].sort())
    await page.goto(`${APP}/employees?view=forces`)
    await page.getByRole('tab', { name: 'Сборы', exact: true }).click()
    await page.getByRole('button', { name: `Открыть распределение ${campaign.code}`, exact: true }).click()
    await expect(page.getByRole('heading', { name: campaign.title, exact: true })).toBeVisible()
    await expect(page.locator('input[name="campaign-employee"]')).toHaveCount(needed)
    await shot(page, testInfo, '02-shared-force-pool')

    await call(accessToken, 'POST', `${base}/acknowledgement/complete/`, {
      force: true,
      comment: 'Подтверждено в рамках основной проходки.',
    })
    await page.goto(`${APP}/security-ops/events/${event.id}/`)
    await expect(page.getByRole('heading', { name: 'Проведение' })).toBeVisible({ timeout: 20_000 })
    await shot(page, testInfo, '03-conduct')
    await page.goto(`${APP}/security-ops/ratings/workspace`)
    await expect(page.getByRole('main')).toBeVisible()
    await shot(page, testInfo, '04-ratings-workspace')
  })
})
