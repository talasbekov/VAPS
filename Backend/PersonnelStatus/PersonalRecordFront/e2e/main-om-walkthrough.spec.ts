import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { anyChiefId } from './stand-chief'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { uniqueBusinessDate } from './business-date'
import { assertStep } from './fixture-step'
import { ROUTES } from './portal-routes'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const execFileAsync = promisify(execFile)
const BACKEND_ROOT = path.resolve(__dirname, '../../Personnel-Records')
let probeMarker: string | null = null

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
  await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  fs.mkdirSync('smoke-results', { recursive: true })
  const body = await page.screenshot({
    path: `smoke-results/1046-om-${name}.png`,
    fullPage: true,
  })
  await testInfo.attach(name, {
    body,
    contentType: 'image/png',
  })
}

async function purgeOwnEvent(marker: string): Promise<void> {
  await execFileAsync(
    path.join(BACKEND_ROOT, '.venv/bin/python'),
    [
      'manage.py',
      'purge_probe_events',
      '--marker',
      marker,
      '--yes',
      '--force',
      '--settings=organization_management.config.settings.local_postgres',
    ],
    { cwd: BACKEND_ROOT, timeout: 120_000 },
  )
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
    if (probeMarker === null) return
    await purgeOwnEvent(probeMarker)
    probeMarker = null
  })

  test('бюллетень → рекогносцировка → потребность → расстановка → две подписи → ознакомление → проведение', async ({ page }, testInfo) => {
    const accessToken = await token()
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
    await call(accessToken, 'PATCH', `${base}/bulletin/`, {
      briefDescription: 'Сквозная проверка основной проходки.',
      initialTasks: 'Обеспечить охрану объекта.',
    })
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
      reconSectorPosts: { id: string }[]
    }>(accessToken, 'POST', `${base}/recon/complete/`)
    expect(placement.stage).toBe('PLACEMENT')
    expect(placement.demandRows.every((row) => row.kindCode !== '' && row.need > 0)).toBe(true)
    const personnel = await call<{ results: { id: string }[] }>(accessToken, 'GET', '/api/ops/personnel/?page_size=100')
    for (const [index, post] of placement.reconSectorPosts.entries()) {
      await call(accessToken, 'POST', `${base}/placement/assign/`, {
        postId: post.id,
        employeeId: personnel.results[index]!.id,
      })
    }
    await call(accessToken, 'POST', `${base}/placement/complete/`)
    let approval = await call<{ approvalRoute: { id: string }[] }>(accessToken, 'POST', `${base}/approval/route/`, {
      name: 'Первый согласующий проходки', unit: 'Второй департамент', position: 'Руководитель',
    })
    approval = await call(accessToken, 'POST', `${base}/approval/route/`, {
      name: 'Второй согласующий проходки', unit: 'Второй департамент', position: 'Руководитель',
    })
    expect(approval.approvalRoute).toHaveLength(2)
    await call(accessToken, 'POST', `${base}/approval/send/`)
    for (const approver of approval.approvalRoute) {
      await call(accessToken, 'POST', `${base}/approval/route/${approver.id}/decide/`, {
        decision: 'APPROVED', comment: '',
      })
    }

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${event.id}/`)
    await expect(page.getByRole('heading', { name: 'Ознакомление' })).toBeVisible({ timeout: 20_000 })
    await shot(page, testInfo, '01-acknowledgement-after-two-signatures')

    const campaign = {
      id: 'main-walkthrough', code: 'РМ-E2E', title: 'Общий пул основной проходки', status: 'DISTRIBUTING',
      events: [{ eventId: event.id, code: event.code, title: 'Основная проходка ОМ', businessDate: uniqueBusinessDate(), visitObjects: [], demandRows: [] }],
      pool: [{ employeeId: personnel.results[0]!.id, employeeName: 'Сотрудник проходки', kindCode: 'PHYSICAL_SQUAD', sourceEventIds: [event.id] }],
      assignments: [], warnings: [],
    }
    await page.route((url) => url.pathname.endsWith('/forces/campaigns/'), (route) => route.fulfill({ json: { results: [campaign] } }))
    await page.route((url) => url.pathname.endsWith('/forces/campaigns/main-walkthrough/'), (route) => route.fulfill({ json: campaign }))
    await page.route((url) => url.pathname.endsWith('/forces/collections/'), (route) => route.fulfill({ json: { results: [] } }))
    await page.goto(`${APP}/employees?view=forces`)
    await page.getByRole('tab', { name: 'Сборы', exact: true }).click()
    await expect(page.getByText('Общий пул основной проходки', { exact: true })).toBeVisible()
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
