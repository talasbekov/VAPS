/**
 * Правая колонка расстановки — только пул штаба (`[РАС-04]`, `[РАС-05]`, Plane №428).
 *
 * До этой задачи, пока штаб не принял состав, колонка «Доступные сотрудники»
 * показывала ВСЮ кадровую базу (440 человек) с поиском и страницами — и
 * предлагала на пост тех, кого сервер всё равно отклонит. Теперь:
 *
 *  1) ОМ без принятого состава — пустое состояние «Силы на объект ещё не
 *     выделены · Заявка ОМ-код: прислано Y из N → Сбор сил на ОМ», ни поиска,
 *     ни списка, ни запроса к кадровой базе (проба ловит сетевой запрос);
 *  2) ОМ с составом — заголовок «Выделено на объект штабом», подзаголовок
 *     «Выделено X из потребности N», фильтр «Управление», у строки
 *     «свободен» либо «на посту …».
 *
 * Фикстуры проба готовит сама (как `placement-stage`); для (2) состав
 * принимается общим помощником `stand-roster` тем же API-путём, что в «Сборе сил».
 *
 * КРАСНОТА НА МУТАЦИИ: верни `enabled: !fromRoster` у `usePersonnelPage` —
 * (1) красна на запросе `/api/ops/personnel/`.
 */
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { acceptRosterFor } from './stand-roster'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SHOTS = path.join(__dirname, '..', '..', '..', '..', 'docs', 'audit', 'om-2026-09-03')

interface EventRow {
  id: string
  code: string
  stage: string
  forceRoster: { employeeId: string }[]
}

async function token(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(tok: string): Promise<EventRow[]> {
  const res = await fetch(`${API}/api/ops/security-events/?page_size=100`, {
    headers: { Authorization: `Bearer ${tok}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

/** ОМ на «Расстановке» без состава — тем же путём, что и проба этапа. */
async function prepareWithoutRoster(tok: string): Promise<string> {
  const headers = { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }
  const call = async (method: string, p: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return res.json().catch(() => ({}))
  }
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find((o: { publishedVersionCount: number }) => o.publishedVersionCount > 0)
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  const roster = await call('GET', '/api/ops/personnel/?page_size=1')
  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба пула штаба (e2e)',
    objectId: object.id,
    businessDate: '2026-09-22',
    kind: 'INTERNAL',
    // Старший объекта — с №424 рекогносцировка без него закрыта.
    chiefEmployeeId: roster.results[0]?.id,
  })
  const base = `/api/ops/security-events/${created.id}`
  await call('PATCH', `${base}/bulletin/`, { briefDescription: 'Проба пула.', initialTasks: '—' })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
  const after = await call('GET', `${base}/`)
  await call('PATCH', `${base}/recon/`, {
    checklist: after.reconChecklist.map((i: Record<string, unknown>) => ({ ...i, done: true, result: 'MATCHES' })),
    sectorPosts: after.reconSectorPosts,
  })
  await call('POST', `${base}/recon/complete/`)
  return created.id as string
}

test.describe(LIVE ? 'пул штаба на расстановке' : 'пул штаба (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('без принятого состава — пустое состояние, кадровая база не спрашивается', async ({ page }) => {
    const tok = await token()
    let target = (await events(tok)).find((e) => e.stage === 'PLACEMENT' && e.forceRoster.length === 0)
    if (target === undefined) {
      const id = await prepareWithoutRoster(tok)
      target = (await events(tok)).find((e) => e.id === id)
    }
    expect(target, 'не удалось подготовить ОМ на «Расстановке» без состава').toBeDefined()

    const personnelCalls: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/ops/personnel/')) personnelCalls.push(req.url())
    })
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const card = page.getByRole('region', { name: 'Расстановка сил' })
    await expect(card).toBeVisible()
    const empty = card.locator('[data-slot="placement-pool-empty"]')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('Силы на объект ещё не выделены')
    await expect(empty).toContainText(new RegExp(`Заявка ${target!.code}: прислано \\d+ из \\d+`))
    await expect(empty.getByRole('link', { name: 'Сбор сил на ОМ →' })).toBeVisible()
    await expect(card.getByLabel('Поиск кандидатов')).toHaveCount(0)
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(personnelCalls, 'кадровая база не должна спрашиваться без состава').toEqual([])
    await card.screenshot({ path: path.join(SHOTS, 'placement-pool-empty.png') })
  })

  test('с составом — «Выделено X из потребности N», фильтр по управлению, «свободен / на посту»', async ({ page }) => {
    const tok = await token()
    let target = (await events(tok)).find((e) => e.stage === 'PLACEMENT' && e.forceRoster.length > 0)
    if (target === undefined) {
      // Состав принимается тем же API-путём, что и в «Сборе сил» (общий
      // помощник `stand-roster`): своего ОМ с составом на стенде может не быть.
      const id = await prepareWithoutRoster(tok)
      await acceptRosterFor(tok, id, { count: 2 })
      target = (await events(tok)).find((e) => e.id === id)
    }
    expect(target, 'не удалось подготовить ОМ с принятым составом').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const card = page.getByRole('region', { name: 'Расстановка сил' })
    await expect(card.getByText('Выделено на объект штабом')).toBeVisible()
    await expect(card.getByText(/Выделено \d+ из потребности \d+/)).toBeVisible()
    await expect(card.getByLabel('Фильтр по управлению')).toBeVisible()
    await expect(card.getByText(/свободен|на посту /).first()).toBeVisible()
    await card.screenshot({ path: path.join(SHOTS, 'placement-pool.png') })
  })
})
