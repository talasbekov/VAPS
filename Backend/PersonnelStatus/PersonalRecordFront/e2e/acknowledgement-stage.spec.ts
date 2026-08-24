/**
 * Этап «Ознакомление» карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на два вопроса: счётчик и фильтр «Ожидают» считают по
 * РЕАЛЬНЫМ подтверждениям (а не по локальному стейту), и завершить этап,
 * пока подтвердили не все, не даёт СЕРВЕР.
 *
 * Ожидаемые числа берутся из ответа API на старте, а не зашиты: проба
 * подтверждает одного сотрудника и потому меняет состояние. Все назначения
 * она не подтверждает намеренно — иначе следующий прогон получил бы
 * завершаемый этап и фикстура стала бы одноразовой.
 *
 * Фикстуру проба готовит САМА, если подходящей на стенде нет. Иначе тест
 * молча выродился бы в скип: каждый прогон подтверждает одного сотрудника, и
 * через два прогона готовое ОМ перестаёт удовлетворять условию «≥2
 * ожидающих». Снять подтверждение нечем — ручки un-acknowledge нет.
 *
 * Цена такой самодостаточности названа прямо: фикстура из трёх назначений
 * переживает два прогона, дальше на стенде появляется ещё одно ОМ «Проба
 * ознакомления (e2e)». Удалить его через API нельзя — жизненный цикл ОМ
 * односторонний.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface EventRow {
  id: string
  code: string
  stage: string
  objectName: string
  placementAssignments: {
    id: string
    employeeId: string
    employeeName: string
    acknowledgedAt: string | null
  }[]
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
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
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'ознакомление' : 'ознакомление (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('счётчик и фильтр идут от подтверждений, этап держит сервер', async ({ page }) => {
    const token = await apiToken()
    const suitable = (rows: EventRow[]): EventRow | undefined =>
      rows.find(
        (e) =>
          e.stage === 'ACKNOWLEDGEMENT' &&
          e.placementAssignments.filter((a) => a.acknowledgedAt === null).length >= 2,
      )
    let event = suitable(await events(token))
    if (event === undefined) {
      const prepared = await prepareEvent(token)
      event = suitable(await events(token))
      expect(event, `не удалось подготовить фикстуру (${prepared})`).toBeDefined()
    }
    event = event!
    const total = event.placementAssignments.length
    const pending = event.placementAssignments.filter((a) => a.acknowledgedAt === null)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${event.id}/`)
    const card = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Ознакомление' }),
    })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toContainText(`Ознакомление (${total - pending.length}/${total})`)

    // Две колонки прототипа: свой экран и экран старшего объекта
    await expect(card.getByText('Экран сотрудника')).toBeVisible()
    await expect(card.getByText('Экран старшего объекта')).toBeVisible()
    // Своё назначение опознаётся по ЖИВОЙ связи учётки с кадровой записью.
    // Ассерт различающий: спрашиваем бэк, кто «я», и сверяем, ЧТО именно
    // показала колонка — назначение или «вы не назначены». Проверка «нет
    // текста про непривязанную учётку» была бы вакуумной: этот текст исчезает
    // и когда колонка сломана.
    const meRes = await fetch(`${API}/api/ops/personnel/me/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(meRes.status, 'у admin должна быть привязка к сотруднику').toBe(200)
    const me = (await meRes.json()) as { id: string }
    const mine = event.placementAssignments.find((a) => a.employeeId === me.id)
    const own = card.locator('section', { hasText: 'Экран сотрудника' }).first()
    if (mine === undefined) {
      await expect(own).toContainText('Вы не назначены на это мероприятие')
    } else {
      await expect(own).toContainText(`Ваше назначение · ${event.code}`)
      await expect(own).toContainText(event.objectName)
    }

    // Полоса готовности отражает долю подтверждённых
    const bar = card.getByRole('progressbar', { name: 'Готовность ознакомления' })
    await expect(bar).toHaveAttribute(
      'aria-valuenow',
      String(Math.round(((total - pending.length) / total) * 100)),
    )

    // Фильтр «Ожидают» показывает РОВНО неподтверждённых
    await card.getByRole('button', { name: `Ожидают (${pending.length})` }).click()
    await expect(card.locator('li')).toHaveCount(pending.length)
    await expect(card.getByText('Подтверждено', { exact: false })).toHaveCount(0)

    // Завершить этап не даёт сервер, а не экран: кнопка активна
    const finish = card.getByRole('button', { name: /Завершить этап/ })
    await expect(finish).toBeEnabled()
    await finish.click()
    await expect(card).toContainText('подтвердили ознакомление', { timeout: 15_000 })
    expect((await events(token)).find((e) => e.id === event.id)?.stage).toBe(
      'ACKNOWLEDGEMENT',
    )

    // Подтверждение одного — живая мутация: счётчик и фильтр пересчитались
    await card.getByRole('button', { name: 'Отметить ознакомление' }).first().click()
    await expect(card).toContainText(
      `Ознакомление (${total - pending.length + 1}/${total})`,
      { timeout: 15_000 },
    )
    await expect(card).toContainText(`Ожидают (${pending.length - 1})`)
    const fresh = (await events(token)).find((e) => e.id === event.id)
    expect(
      fresh?.placementAssignments.filter((a) => a.acknowledgedAt !== null).length,
    ).toBe(total - pending.length + 1)
  })
})

/**
 * Заводит ОМ и проводит его до «Ознакомления» с тремя неподтверждёнными
 * назначениями. Тем же путём, каким это делает человек в интерфейсе, —
 * своих служебных ручек у стенда нет.
 */
async function prepareEvent(token: string): Promise<string> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }
  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, never> & Record<string, unknown>> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return (await res.json().catch(() => ({}))) as Record<string, never> &
      Record<string, unknown>
  }

  const objects = (await call('GET', '/api/ops/security-events/bindable-objects/')) as unknown as {
    results: { id: string; publishedVersionCount: number }[]
  }
  const object = objects.results.find((item) => item.publishedVersionCount > 0)
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')

  const created = (await call('POST', '/api/ops/security-events/', {
    title: 'Проба ознакомления (e2e)',
    objectId: object.id,
    businessDate: '2026-08-22',
    // `kind` обязателен с 23.08: без него сервер отдаёт 400, `created.id`
    // выходит undefined, и проба падает не на своём предмете, а на строке
    // «не удалось подготовить фикстуру».
    kind: 'INTERNAL',
  })) as unknown as { id: string; code: string }
  const id = created.id
  const base = `/api/ops/security-events/${id}`

  await call('PATCH', `${base}/bulletin/`, {
    briefDescription: 'Проба ознакомления.',
    initialTasks: '—',
  })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
  const afterImport = (await call('GET', `${base}/`)) as unknown as {
    reconChecklist: Record<string, unknown>[]
    reconSectorPosts: {
      id: string
      sector: string
      task: string
      need: number
      requirements: string
    }[]
  }
  await call('PATCH', `${base}/recon/`, {
    checklist: afterImport.reconChecklist.map((item) => ({
      ...item,
      done: true,
      result: 'MATCHES',
    })),
    sectorPosts: afterImport.reconSectorPosts,
  })
  await call('POST', `${base}/recon/complete/`)
  await call('POST', `${base}/demand/approve/`, {
    rows: afterImport.reconSectorPosts.map((post, index) => ({
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
  const afterDemand = (await call('GET', `${base}/`)) as unknown as {
    forceRequests: { id: string; requestedCount: number }[]
  }
  for (const request of afterDemand.forceRequests) {
    await call('PATCH', `${base}/forces/${encodeURIComponent(request.id)}/`, {
      allocatedCount: request.requestedCount,
      comment: 'проба',
    })
  }
  await call('POST', `${base}/forces/complete/`)
  const roster = (await call('GET', '/api/ops/personnel/')) as unknown as {
    results: { id: string }[]
  }
  for (const [index, post] of afterImport.reconSectorPosts.entries()) {
    await call('POST', `${base}/placement/assign/`, {
      postId: post.id,
      employeeId: roster.results[index].id,
    })
  }
  await call('POST', `${base}/placement/complete/`)
  await call('POST', `${base}/approval/approve/`)
  return created.code
}
