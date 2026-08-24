/**
 * Этап «Рекогносцировка» карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на два вопроса: сведения об объекте берутся из ЖИВОЙ
 * карточки объекта и привязанной версии паспорта (а не из полей мероприятия),
 * и результат осмотра поста с замечанием ДОХОДЯТ ДО СЕРВЕРА — до этой правки
 * поля были в контракте, но экран их не показывал.
 *
 * Фикстуру проба готовит сама, если ОМ на «Рекогносцировке» нет. Правку она
 * сохраняет (это и есть предмет проверки), но стадию не завершает — иначе
 * фикстура стала бы одноразовой.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface EventRow {
  id: string
  code: string
  stage: string
  objectId: string | null
  objectName: string
  passportBinding: { versionId: string; versionNumber: number } | null
  reconSectorPosts: {
    id: string
    post: string
    postType?: string
    weapon?: string
    uniform?: string
    parentPostId?: string
    comment: string
  }[]
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

async function objectCard(
  token: string,
  id: string,
): Promise<{ code: string; name: string; type: string; address: string }> {
  const res = await fetch(`${API}/api/ops/objects/${id}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as { code: string; name: string; type: string; address: string }
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

test.describe(LIVE ? 'рекогносцировка' : 'рекогносцировка (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('сведения об объекте живые, осмотр поста доходит до сервера', async ({ page }) => {
    const token = await apiToken()
    const suitable = (rows: EventRow[]): EventRow | undefined =>
      rows.find((e) => e.stage === 'RECON' && e.reconSectorPosts.length > 0)
    let event = suitable(await events(token))
    if (event === undefined) {
      await prepareEvent(token)
      event = suitable(await events(token))
      expect(event, 'не удалось подготовить фикстуру').toBeDefined()
    }
    const target = event!
    const card = await objectCard(token, target.objectId!)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const stage = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Рекогносцировка' }),
    })
    await expect(stage).toBeVisible({ timeout: 15_000 })

    // Сведения — из карточки ОБЪЕКТА, а не из полей мероприятия: адрес и тип
    // у мероприятия отсутствуют вовсе, взяться им больше неоткуда.
    await expect(stage).toContainText(`${card.code} · ${card.name}`, {
      timeout: 15_000,
    })
    await expect(stage).toContainText(card.type)
    await expect(stage).toContainText(card.address)
    if (target.passportBinding !== null) {
      await expect(stage).toContainText(`№ ${target.passportBinding.versionNumber}`)
    }
    await expect(
      stage.getByRole('link', { name: 'История ОМ по объекту →' }),
    ).toHaveAttribute('href', new RegExp(encodeURIComponent(target.objectName)))

    // Колонки таблицы прототипа: тип, вооружение, форма одежды, примечание.
    // Заполняем и сверяем с тем, что вернул БЭК, а не с полем на экране.
    const post = target.reconSectorPosts[0]
    const note = `Проба осмотра ${Date.now()}`
    await stage.getByLabel(`Тип поста: ${post.post}`, { exact: true }).fill('Стационарный')
    await stage.getByLabel(`Вооружение: ${post.post}`, { exact: true }).fill('АКС-74У')
    await stage.getByLabel(`Форма одежды: ${post.post}`, { exact: true }).fill('Повседневная')
    await stage.getByLabel(`Примечание к посту: ${post.post}`, { exact: true }).fill(note)
    await stage.getByRole('button', { name: 'Сохранить рекогносцировку' }).click()

    await expect
      .poll(
        async () => {
          const fresh = (await events(token)).find((e) => e.id === target.id)
          const row = fresh?.reconSectorPosts.find((r) => r.id === post.id)
          return [row?.postType, row?.weapon, row?.uniform, row?.comment].join('|')
        },
        { timeout: 15_000 },
      )
      .toBe(`Стационарный|АКС-74У|Повседневная|${note}`)

    // Подпост из прототипа: строка встаёт за родителем и доезжает до сервера.
    // Ожидание считается ОТ ИСХОДНОГО состояния фикстуры: проба добавляет
    // подпост каждым прогоном, и зашитая единица делала бы её одноразовой.
    const fresh0 = (await events(token)).find((e) => e.id === target.id)!
    const before = fresh0.reconSectorPosts.length
    const subsBefore = fresh0.reconSectorPosts.filter(
      (r) => (r.parentPostId ?? '') !== '',
    ).length
    await stage.getByLabel(`Добавить подпост: ${post.post}`, { exact: true }).click()
    await stage.getByRole('button', { name: 'Сохранить рекогносцировку' }).click()
    await expect
      .poll(
        async () => {
          const fresh = (await events(token)).find((e) => e.id === target.id)
          const subs = fresh?.reconSectorPosts.filter(
            (r) => (r.parentPostId ?? '') !== '',
          )
          return { total: fresh?.reconSectorPosts.length, subs: subs?.length }
        },
        { timeout: 15_000 },
      )
      .toEqual({ total: before + 1, subs: subsBefore + 1 })
  })
})

/** Заводит ОМ и доводит до «Рекогносцировки» с постами из паспорта. */
async function prepareEvent(token: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
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
    title: 'Проба рекогносцировки (e2e)',
    objectId: object.id,
    businessDate: '2026-08-24',
    // `kind` обязателен с 23.08 — без него создание отбивается 400, и вся
    // подготовка дальше бьёт по /security-events/undefined/.
    kind: 'INTERNAL',
  })
  const base = `/api/ops/security-events/${created.id}`
  await call('PATCH', `${base}/bulletin/`, {
    briefDescription: 'Проба рекогносцировки.',
    initialTasks: '—',
  })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
}
