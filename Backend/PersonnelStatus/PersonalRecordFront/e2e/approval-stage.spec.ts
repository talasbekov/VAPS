/**
 * Этап «Согласование» карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на два вопроса: сводка и блок обходов предупреждений стоят
 * на РЕАЛЬНОМ расчёте (обход показывается с тем обоснованием, которое ввели
 * при назначении), и пустую причину возврата отбивает СЕРВЕР, а не экран.
 *
 * Фикстуру проба готовит сама: нужен ОМ на «Согласовании», где хотя бы одно
 * назначение прошло через мягкий 409 по требованию поста к рейтингу. Такой
 * набор на стенде не заводится сам — посты из паспорта приходят без
 * minRating, его проба выставляет на рекогносцировке.
 *
 * Утверждение проба НЕ выполняет: переход необратим и сделал бы фикстуру
 * одноразовой. Возврат тоже не доводится до конца — только отказ на пустой
 * причине, он состояние не меняет.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const OVERRIDE_REASON = 'Проба: обоснование обхода предупреждения'

interface EventRow {
  id: string
  code: string
  stage: string
  updatedAt: string
  reconSectorPosts: { id: string; sector: string; post: string; need: number }[]
  placementAssignments: {
    id: string
    employeeName: string
    postId: string
    ratingOverrideReason: string | null
  }[]
  approvalRoute: { id: string; name: string; status: string; comment: string }[]
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(token: string): Promise<EventRow[]> {
  const res = await fetch(`${API}/api/ops/security-events/?page_size=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

test.describe(LIVE ? 'согласование' : 'согласование (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('сводка и обходы идут от расчёта, пустой возврат отбивает сервер', async ({
    page,
  }) => {
    const token = await apiToken()
    const suitable = (rows: EventRow[]): EventRow | undefined =>
      rows.find(
        (e) =>
          e.stage === 'APPROVAL' &&
          e.placementAssignments.some((a) => a.ratingOverrideReason !== null),
      )
    let event = suitable(await events(token))
    if (event === undefined) {
      await prepareEvent(token)
      event = suitable(await events(token))
      expect(event, 'не удалось подготовить фикстуру').toBeDefined()
    }
    const target = event!
    const override = target.placementAssignments.find(
      (a) => a.ratingOverrideReason !== null,
    )!
    const totalNeed = target.reconSectorPosts.reduce((sum, p) => sum + p.need, 0)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const card = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', {
        hasText: 'Согласование расстановки',
      }),
    })
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Сводка — из расчёта, а не из воздуха
    await expect(card).toContainText(
      `${target.placementAssignments.length} / ${totalNeed}`,
    )
    // Число и подпись — соседние элементы без пробела между ними, поэтому
    // сверяем образцом, а не литералом со пробелом.
    await expect(card).toContainText(
      new RegExp(
        `${target.placementAssignments.filter((a) => a.ratingOverrideReason !== null).length}\\s*обходов предупреждений`,
      ),
    )

    // Обход показан ИМЕННО с тем обоснованием, что записал бэк
    const post = target.reconSectorPosts.find((p) => p.id === override.postId)!
    await expect(card).toContainText(override.employeeName)
    await expect(card).toContainText(`Обоснование: ${override.ratingOverrideReason}`)
    await expect(card).toContainText(`${post.sector} · ${post.post}`)

    // Маршрут согласования из прототипа: добавляем согласующего, решаем по
    // нему и сверяем с тем, что вернул БЭК, а не с экраном.
    const route = card.locator('section', { hasText: 'Маршрут согласования' }).first()
    await route.getByRole('button', { name: '+ Добавить согласующего' }).click()
    const who = `Проба ${Date.now()}`
    await route.getByLabel('ФИО согласующего').fill(who)
    await route.getByLabel('Подразделение согласующего').fill('Управление ОМ')
    await route.getByLabel('Должность согласующего').fill('полковник')
    await route.getByRole('button', { name: 'Добавить', exact: true }).click()
    await expect(route).toContainText(who, { timeout: 15_000 })
    await expect(route).toContainText('Ожидает решения')

    const added = await expect
      .poll(async () => {
        const fresh = (await events(token)).find((e) => e.id === target.id)
        return fresh?.approvalRoute.find((a) => a.name === who)?.id ?? null
      }, { timeout: 15_000 })
      .not.toBeNull()
    void added

    // Возврат требует причины — отказ приходит от сервера
    const row = route.locator('li', { hasText: who })
    await row.getByRole('button', { name: 'Вернуть' }).click()
    await row.getByRole('button', { name: 'Подтвердить возврат' }).click()
    await expect(card).toContainText('Укажите причину возврата', { timeout: 15_000 })

    // С причиной решение фиксируется, и его видит бэк
    await row.getByLabel(`Причина возврата: ${who}`).fill('Уточнить расчёт постов')
    await row.getByRole('button', { name: 'Подтвердить возврат' }).click()
    await expect
      .poll(async () => {
        const fresh = (await events(token)).find((e) => e.id === target.id)
        const mine = fresh?.approvalRoute.find((a) => a.name === who)
        return `${mine?.status}|${mine?.comment}`
      }, { timeout: 15_000 })
      .toBe('RETURNED|Уточнить расчёт постов')

    // Пустую причину возврата отбивает сервер; стадия не двигается
    await card.getByRole('button', { name: 'Вернуть на доработку' }).click()
    await expect(card).toContainText('Укажите причину возврата', { timeout: 15_000 })
    expect((await events(token)).find((e) => e.id === target.id)?.stage).toBe('APPROVAL')
  })
})

/**
 * Заводит ОМ и доводит его до «Согласования» так, чтобы одно назначение
 * прошло через мягкий конфликт: посту выставляется minRating, и назначение
 * уходит с override + обоснованием.
 */
async function prepareEvent(token: string): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.json().catch(() => ({}))
  }

  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')

  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба согласования (e2e)',
    objectId: object.id,
    businessDate: '2026-08-23',
    // См. recon-stage: без обязательного `kind` создание отбивается 400.
    kind: 'INTERNAL',
  })
  const base = `/api/ops/security-events/${created.id}`

  await call('PATCH', `${base}/bulletin/`, {
    briefDescription: 'Проба согласования.',
    initialTasks: '—',
  })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
  const afterImport = await call('GET', `${base}/`)
  // Требование к рейтингу — на первом посту: без него мягкого конфликта не
  // возникнет и обосновывать будет нечего.
  const posts = afterImport.reconSectorPosts.map(
    (post: Record<string, unknown>, index: number) =>
      index === 0 ? { ...post, minRating: 8 } : post,
  )
  await call('PATCH', `${base}/recon/`, {
    checklist: afterImport.reconChecklist.map((item: Record<string, unknown>) => ({
      ...item,
      done: true,
      result: 'MATCHES',
    })),
    sectorPosts: posts,
  })
  await call('POST', `${base}/recon/complete/`)
  await call('POST', `${base}/demand/approve/`, {
    rows: posts.map((post: Record<string, string | number>, index: number) => ({
      id: `row-${index + 1}`,
      sector: post.sector,
      task: post.task,
      shift: 'Дневная',
      need: post.need,
      group: 'Физическая охрана',
      requirements: post.requirements,
      comment: '',
    })),
  })
  const afterDemand = await call('GET', `${base}/`)
  for (const request of afterDemand.forceRequests) {
    await call('PATCH', `${base}/forces/${encodeURIComponent(request.id)}/`, {
      allocatedCount: request.requestedCount,
      comment: 'проба',
    })
  }
  await call('POST', `${base}/forces/complete/`)
  const roster = await call('GET', '/api/ops/personnel/')
  for (const [index, post] of posts.entries()) {
    await call('POST', `${base}/placement/assign/`, {
      postId: (post as { id: string }).id,
      employeeId: roster.results[index].id,
      // обход нужен только там, где выставлено требование
      ...(index === 0 ? { override: true, override_reason: OVERRIDE_REASON } : {}),
    })
  }
  await call('POST', `${base}/placement/complete/`)
}
