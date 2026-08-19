/**
 * «Сбор сил на ОМ» (`/security-ops/forces`) — ЖИВОЙ стенд.
 *
 * Экран показывает разрез, которого не делает ни один другой: все мероприятия,
 * стоящие на стадии «Запрос сил», разом. Внутри карточки ОМ те же запросы уже
 * видны, но там они про ОДНО мероприятие.
 *
 * 🔴 Фикстуру приходится заводить самим. Стадия FORCES ТРАНЗИТНАЯ: из 77
 * мероприятий стенда на ней не стоит ни одно (38 в бюллетене, 10 в
 * ознакомлении). Проба, полагающаяся на данные стенда, была бы вечно зелёной
 * на пустом экране — то есть не проверяла бы ничего. Поэтому здесь заводится
 * своё ОМ и доводится РОВНО до сбора: сразу после утверждения потребности
 * мероприятие встаёт на FORCES и дальше не двигается.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface ForceRequest {
  id: string
  group: string
  requestedCount: number
  allocatedCount: number
  status: string
}

interface EventRow {
  id: string
  code: string
  title: string
  stage: string
  forceNeed: number
  forceRequests: ForceRequest[]
}

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /тему|theme/i }).first()).toBeEnabled({
    timeout: 20_000,
  })
}

const FIXTURE_TITLE = 'Проба сбора сил (e2e)'

/**
 * Взять ОМ на стадии «Запрос сил» — переиспользуя своё, если оно уже заведено.
 *
 * 🔴 Удаления мероприятия в API НЕТ (`http_method_names` пускает delete, но
 * действия под него нет), поэтому проба, которая всегда заводит новое ОМ,
 * КОПИТ мусор в реестре: за один сеанс их набежало десять, и «Активных сборов
 * нет» перестало быть достижимым состоянием стенда. Поэтому фикстура ищет
 * своё мероприятие по названию и сбрасывает у него выделение в ноль, а заводит
 * новое только если своего нет.
 */
async function prepareForcesEvent(token: string): Promise<EventRow> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.json().catch(() => ({}))
  }

  const existing = await call(
    'GET',
    `/api/ops/security-events/?stage=FORCES&page_size=50&search=${encodeURIComponent(FIXTURE_TITLE)}`,
  )
  const reused = (existing.results ?? []).find(
    (row: EventRow) => row.title === FIXTURE_TITLE && row.forceRequests.length > 1,
  ) as EventRow | undefined
  if (reused !== undefined) {
    // Сброс выделения: прошлый прогон оставил свои числа, и на них ассерт
    // «второй группе ноль» прошёл бы по чужому следу, а не по своему.
    for (const request of reused.forceRequests) {
      if (request.allocatedCount !== 0) {
        await call(
          'PATCH',
          `/api/ops/security-events/${reused.id}/forces/${encodeURIComponent(request.id)}/`,
          { allocatedCount: 0, comment: '' },
        )
      }
    }
    return (await call('GET', `/api/ops/security-events/${reused.id}/`)) as EventRow
  }

  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')

  const created = await call('POST', '/api/ops/security-events/', {
    title: FIXTURE_TITLE,
    objectId: object.id,
    businessDate: '2026-08-24',
  })
  const base = `/api/ops/security-events/${created.id}`

  await call('PATCH', `${base}/bulletin/`, {
    briefDescription: 'Проба сбора сил.',
    initialTasks: '—',
  })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
  const afterImport = await call('GET', `${base}/`)
  await call('PATCH', `${base}/recon/`, {
    checklist: afterImport.reconChecklist.map((item: Record<string, unknown>) => ({
      ...item,
      done: true,
      result: 'MATCHES',
    })),
    sectorPosts: afterImport.reconSectorPosts,
  })
  await call('POST', `${base}/recon/complete/`)

  // 🔴 ДВЕ разные группы расчёта: на одной строке ассерт «выделили той группе,
  // которую просили» неотличим от «выделили единственной».
  const posts = afterImport.reconSectorPosts as Record<string, string | number>[]
  await call('POST', `${base}/demand/approve/`, {
    rows: posts.map((post, index) => ({
      id: `row-${index + 1}`,
      sector: post.sector,
      task: post.task,
      shift: 'Дневная',
      need: post.need,
      group: index % 2 === 0 ? 'Физическая охрана' : 'Группа досмотра',
      requirements: post.requirements,
      comment: '',
    })),
  })

  const event = (await call('GET', `${base}/`)) as EventRow
  if (event.stage !== 'FORCES') {
    throw new Error(`фикстура встала на ${event.stage}, а не на FORCES`)
  }
  return event
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'сбор сил на ОМ' : 'сбор сил (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('прогресс сбора считается от запрошенного, а не от выделенного', async ({ page }) => {
    /**
     * 🔴 Первая версия читала экран СРАЗУ после утверждения расчёта, когда
     * выделено ноль, и утверждала «0 из N · 0%». На нуле любой знаменатель
     * даёт 0% — проба была зелёной на сломанной формуле. Поэтому здесь одной
     * группе ЧАСТИЧНО выделяют состав через ручку, и экран обязан показать
     * ровно ту долю, что получилась.
     */
    const token = await tokenFor('admin', 'admin123')
    const event = await prepareForcesEvent(token)

    const requested = event.forceRequests.reduce((sum, r) => sum + r.requestedCount, 0)
    expect(event.forceRequests.length, 'фикстура дала одну группу — проба вырождена')
      .toBeGreaterThan(1)

    // Выделяем ЧАСТЬ, а не всё: на полном выделении 100% совпало бы со
    // множеством неверных формул.
    const partial = event.forceRequests[0]
    expect(partial.requestedCount, 'первой группе запрошен ноль').toBeGreaterThan(0)
    await fetch(
      `${API}/api/ops/security-events/${event.id}/forces/${encodeURIComponent(partial.id)}/`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ allocatedCount: partial.requestedCount, comment: '' }),
      },
    )
    const allocated = partial.requestedCount
    const percent = Math.round((allocated / requested) * 100)
    expect(percent, 'выделено всё — доля не отличает знаменатель').toBeLessThan(100)
    expect(percent, 'выделено ноль — доля не отличает знаменатель').toBeGreaterThan(0)

    await signIn(page, 'admin', 'admin123')
    await page.goto('/security-ops/forces')
    await hydrated(page)

    const row = page.locator('table tbody tr').filter({ hasText: event.code })
    await expect(row, 'заведённого сбора нет в списке').toBeVisible({ timeout: 25_000 })
    await expect(row).toContainText(`${allocated} из ${requested} · ${percent}%`)

    await row.click()
    // Плитка «Требуется по расчёту» снята сознательно: она печатала бы то же
    // число, что «Запрошено расчётом» (сервер пишет их из одних строк).
    await expect(page.getByText('Запрошено расчётом')).toBeVisible()
    await expect(page.getByText('Требуется по расчёту')).toHaveCount(0)
    // Каждая группа расчёта — своя строка, с собственным числом.
    for (const request of event.forceRequests) {
      const line = page.locator('div').filter({ hasText: `запрошено ${request.requestedCount}` })
      await expect(line.first()).toBeVisible()
    }
  })

  test('выделение уходит в ту группу, которую просили', async ({ page }) => {
    /**
     * 🔴 Ассерт «после сохранения прогресс вырос» вакуумен, пока групп две, а
     * проверяется только итог: перепутанный `request.id` дал бы ту же сумму.
     * Поэтому выделяем ОДНОЙ группе и требуем, чтобы у ВТОРОЙ осталось ноль.
     */
    const token = await tokenFor('admin', 'admin123')
    const event = await prepareForcesEvent(token)
    const [first, second] = event.forceRequests
    expect(second, 'нужны две группы расчёта — иначе адресность не проверить').toBeTruthy()

    await signIn(page, 'admin', 'admin123')
    await page.goto(`/security-ops/forces?event=${encodeURIComponent(event.id)}`)
    await hydrated(page)

    const field = page.getByLabel(`Выделено: ${first.group}`)
    await expect(field).toBeVisible({ timeout: 25_000 })
    await field.fill(String(first.requestedCount))
    await page.getByRole('button', { name: 'Выделить' }).first().click()

    // Сервер — источник правды: сверяем не экран с экраном, а экран с ответом.
    await expect
      .poll(
        async () => {
          const res = await fetch(`${API}/api/ops/security-events/${event.id}/`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          const fresh = (await res.json()) as EventRow
          return fresh.forceRequests.map((r) => `${r.group}:${r.allocatedCount}:${r.status}`)
        },
        { timeout: 20_000 },
      )
      .toEqual([
        `${first.group}:${first.requestedCount}:ALLOCATED`,
        `${second.group}:0:NOT_SENT`,
      ])

    await expect(page.getByText('Выделено полностью')).toBeVisible()
  })

  test('пустой список говорит, что сборов нет, а не молчит', async ({ page }) => {
    /**
     * Стадия FORCES транзитная, и пустой экран — законное состояние. Проверяем
     * перехватом, что он ОБЪЯСНЯЕТ пустоту: экран без данных и экран без
     * объяснения читаются одинаково, а означают разное.
     */
    await page.route(
      (url) => url.pathname.endsWith('/api/ops/security-events/'),
      async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as { results: unknown[]; count: number }
        await route.fulfill({ response, json: { ...body, results: [], count: 0 } })
      },
    )

    await signIn(page, 'admin', 'admin123')
    await page.goto('/security-ops/forces')
    await hydrated(page)

    await expect(page.getByText(/Активных сборов нет/)).toBeVisible({ timeout: 25_000 })
    await expect(page.getByText(/стадии «Запрос сил»/).first()).toBeVisible()
  })
})
