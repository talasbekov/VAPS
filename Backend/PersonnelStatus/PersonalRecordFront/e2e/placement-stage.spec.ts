/**
 * Этап «Расстановка» карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на один вопрос: дерево «сектор → посты» и карточка поста
 * стоят на настоящих данных расчёта и на живых мутациях назначения — счётчик
 * заполненности меняется от РЕАЛЬНОГО назначения, а не от локального стейта.
 *
 * Мероприятие берётся с живого стенда — зашитых id нет, стенд пересевается.
 * Если ОМ на стадии «Расстановка» нет, проба СКИПАЕТСЯ (молча не зеленеет).
 * Подготовить такое ОМ можно через API: создать → bulletin/complete →
 * recon/import-from-passport → отметить чек-лист → recon/complete →
 * demand/approve → forces/<id> allocatedCount → forces/complete.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function apiToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = (await res.json()) as { access?: string }
  if (body.access === undefined) throw new Error('нет токена стенда')
  return body.access
}

async function signIn(page: Page, username = 'admin', password = 'admin123'): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'расстановка' : 'расстановка (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('дерево постов и назначение идут от живого расчёта', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    const token = await apiToken('admin', 'admin123')
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }

    // Берём ОМ на стадии расстановки; расчёт постов заводим сами, чтобы проба
    // не зависела от того, что осталось в БД от прошлых прогонов.
    // Стадию фильтрует СЕРВЕР: на растущем реестре стенда фикстура уходит со
    // первой страницы, и проба молча превращается в skip.
    const list = (await (
      await request.get(`${API}/api/ops/security-events/?page_size=50&stage=PLACEMENT`, {
        headers: auth,
      })
    ).json()) as { results: { id: string; code: string; stage: string }[] }
    const target = list.results[0]
    test.skip(target === undefined, 'на стенде нет ОМ на стадии расстановки')
    const eventId = target!.id

    const before = (await (
      await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
    ).json()) as {
      reconSectorPosts: { id: string; sector: string; post: string; need: number }[]
      placementAssignments: { id: string }[]
    }
    test.skip(before.reconSectorPosts.length === 0, 'у ОМ нет расчёта постов')
    const post = before.reconSectorPosts[0]

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${eventId}/`)
    // CardTitle рендерится <div data-slot="card-title">, а не заголовком —
    // роль heading здесь не ищется.
    const card = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Расстановка' }),
    })
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Дерево слева перечисляет ИМЕННО посты расчёта, а не выдумку экрана
    const postButton = page.getByRole('button', { name: new RegExp(post.post) }).first()
    await expect(postButton).toBeVisible()
    await postButton.click()

    // Карточка показывает выбранный пост, его сектор и заполненность
    const panel = page.locator('section', { hasText: 'Требования поста' }).first()
    await expect(panel).toContainText(post.post)
    await expect(panel).toContainText(post.sector)
    await expect(panel).toContainText(`из ${post.need}`)

    // Правая колонка подбора — из прототипа: заголовок, чипы пула, кандидаты
    await expect(page.getByText('Доступные сотрудники')).toBeVisible()
    await expect(page.getByText('Подбор по требованиям поста')).toBeVisible()
    await expect(page.getByText(/Выделено \d+/)).toBeVisible()
    await expect(page.getByText(/Совпадение \d+%/).first()).toBeVisible()

    // Сводка шага — шесть показателей прототипа
    for (const label of ['постов', 'требуется', 'назначено', 'свободно', 'незаполнено', 'конфликтов']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    }

    // Назначение — живая мутация: счётчик в дереве растёт, и бэк это видит
    const assignedBefore = (
      await (
        await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
      ).json()
    ).placementAssignments.length as number

    // Назначение — клик по кандидату в правой колонке (как в прототипе)
    await page.locator('aside button', { hasText: 'Совпадение' }).first().click()

    await expect
      .poll(async () => {
        const fresh = (await (
          await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
        ).json()) as { placementAssignments: { id: string }[] }
        return fresh.placementAssignments.length
      }, { timeout: 15_000 })
      .toBe(assignedBefore + 1)

    // Снимаем назначение обратно — проба не оставляет за собой мусор
    await page.getByRole('button', { name: 'Удалить с поста' }).first().click()
    await expect
      .poll(async () => {
        const fresh = (await (
          await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
        ).json()) as { placementAssignments: { id: string }[] }
        return fresh.placementAssignments.length
      }, { timeout: 15_000 })
      .toBe(assignedBefore)

    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })
})
