/**
 * Этап «Бюллетень» карточки ОМ на ЖИВОМ стенде.
 *
 * Первая проба отвечает на один вопрос: готовность этапа считается по
 * СОХРАНЁННОМУ бюллетеню, а не по набранному в полях. Разница не
 * косметическая: сервер смотрит на своё состояние, и набранный, но не
 * сохранённый текст этап не откроет — экран, считающий по форме, обещал бы
 * завершение, которого не будет.
 *
 * Вторая — что «Сведения об ОМ» собраны из ответов сервера, а не из вёрстки:
 * адрес приходит из КАРТОЧКИ ОБЪЕКТА (отдельный запрос), продолжительность
 * выводится из пары дат, статус — из стадии.
 *
 * Фикстуры проба готовит сама и переиспользует по названию; этапы не
 * завершает — иначе фикстура одноразовая.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

// Фикстура «Сведений об ОМ»: даты выбраны так, что и дни недели, и
// продолжительность различимы (вторник → четверг, три дня включительно).
const FACTS_TITLE = 'Проба сведений об ОМ (e2e)'
const FACTS_START = '2026-09-01'
const FACTS_END = '2026-09-03'

interface EventRow {
  id: string
  code: string
  title: string
  stage: string
  objectId: string | null
  objectName: string
  businessDate: string
  businessDateEnd: string | null
  briefDescription: string
  initialTasks: string
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(token: string, search = ''): Promise<EventRow[]> {
  const query = `page_size=50${search === '' ? '' : `&search=${encodeURIComponent(search)}`}`
  const res = await fetch(`${API}/api/ops/security-events/?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

async function objectCard(token: string, id: string): Promise<{ address: string }> {
  const res = await fetch(`${API}/api/ops/objects/${id}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as { address: string }
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

test.describe(LIVE ? 'бюллетень' : 'бюллетень (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('готовность считается по сохранённому, а не по набранному', async ({ page }) => {
    const token = await apiToken()
    const suitable = (rows: EventRow[]): EventRow | undefined =>
      rows.find(
        (e) =>
          e.stage === 'BULLETIN' &&
          (e.briefDescription.trim() === '' || e.initialTasks.trim() === ''),
      )
    let event = suitable(await events(token))
    if (event === undefined) {
      await prepareEvent(token)
      event = suitable(await events(token))
      expect(event, 'не удалось подготовить фикстуру').toBeDefined()
    }
    const target = event!

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const card = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Бюллетень' }),
    })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toContainText('заполнено не всё')
    await expect(card).toContainText('Краткое описание — не заполнено')

    // Набранное, но НЕ сохранённое готовность не меняет — меняет предупреждение
    await card.getByLabel('Краткое описание *').fill('Проба бюллетеня.')
    await card.getByLabel('Первичные задачи направлениям *').fill('Проба задач.')
    await expect(card).toContainText('Есть несохранённые правки')
    await expect(card).toContainText('заполнено не всё')
    await expect(card).toContainText('Краткое описание — не заполнено')

    // Сохранение переводит этап в «можно завершать», и это видит бэк
    await card.getByRole('button', { name: 'Сохранить бюллетень' }).click()
    await expect(card).toContainText('можно завершать', { timeout: 15_000 })
    await expect(card).toContainText('Краткое описание — сохранено')
    const fresh = (await events(token)).find((e) => e.id === target.id)
    expect(fresh?.briefDescription).toBe('Проба бюллетеня.')
  })

  test('«Сведения об ОМ» собраны из ответов сервера', async ({ page }) => {
    const token = await apiToken()
    const target = await factsEvent(token)
    expect(target.objectId, 'фикстура должна быть привязана к объекту').not.toBeNull()
    const object = await objectCard(token, target.objectId!)
    expect(object.address.trim(), 'у объекта стенда пустой адрес — проба вакуумна').not.toBe('')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const facts = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Сведения об ОМ' }),
    })
    await expect(facts).toBeVisible({ timeout: 15_000 })

    await expect(facts).toContainText(`Номер ОМ: ${target.code}`)
    await expect(facts).toContainText(`Объект проведения: ${target.objectName}`)
    // Адрес живёт НЕ в мероприятии: карточка ходит за ним в реестр объектов
    await expect(facts).toContainText(`Место / адрес: ${object.address}`)
    // Дни недели и продолжительность выводятся из дат, а не хранятся
    await expect(facts).toContainText('Дата начала: 01.09.2026, вторник')
    await expect(facts).toContainText('Дата окончания: 03.09.2026, четверг')
    await expect(facts).toContainText('Продолжительность: 3 дня')
    await expect(facts).toContainText('Текущий статус: Бюллетень')

    // Чего система не хранит — названо, а не нарисовано пустыми ячейками
    await expect(facts).toContainText('мероприятие не хранит')
    // Слэш на конце добавляет Next (trailingSlash), в разметке его нет
    await expect(facts.getByRole('link', { name: 'сводке ГВО' })).toHaveAttribute(
      'href',
      `/security-ops/gvo/${target.id}/`,
    )
  })

  test('незагруженные права — не отказ: адрес ждёт, а не обвиняет', async ({ page }) => {
    const token = await apiToken()
    const target = await factsEvent(token)
    const object = await objectCard(token, target.objectId!)

    await signIn(page)
    // Права приходят медленно — ровно то состояние, в котором hasPermission
    // ещё отвечает false, хотя право у администратора есть
    await page.route('**/api/operations/my-permissions/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4_000))
      await route.continue()
    })
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const facts = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Сведения об ОМ' }),
    })
    await expect(facts).toContainText('Место / адрес: загрузка карточки объекта…', {
      timeout: 15_000,
    })
    await expect(facts).not.toContainText('нужно право')

    // Дождались прав — адрес появился, отказа не было ни на одном кадре
    await expect(facts).toContainText(`Место / адрес: ${object.address}`, {
      timeout: 15_000,
    })
  })
})

/** Заводит пустое ОМ на этапе «Бюллетень». */
async function prepareEvent(token: string): Promise<void> {
  await createEvent(token, {
    title: 'Проба бюллетеня (e2e)',
    businessDate: '2026-08-25',
  })
}

/** ОМ с обеими датами для «Сведений об ОМ» — заводится один раз и потом
 * находится по названию: каждый прогон новое мероприятие засорял бы реестр. */
async function factsEvent(token: string): Promise<EventRow> {
  const match = (rows: EventRow[]): EventRow | undefined =>
    rows.find(
      (e) =>
        e.title === FACTS_TITLE &&
        e.stage === 'BULLETIN' &&
        e.businessDate === FACTS_START &&
        e.businessDateEnd === FACTS_END,
    )
  let found = match(await events(token, FACTS_TITLE))
  if (found === undefined) {
    await createEvent(token, {
      title: FACTS_TITLE,
      businessDate: FACTS_START,
      businessDateEnd: FACTS_END,
    })
    found = match(await events(token, FACTS_TITLE))
  }
  expect(found, 'не удалось подготовить ОМ со сведениями').toBeDefined()
  return found!
}

/** Создаёт ОМ на первом объекте с опубликованным паспортом. */
async function createEvent(
  token: string,
  body: { title: string; businessDate: string; businessDateEnd?: string },
): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, payload?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    return res.json().catch(() => ({}))
  }
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  await call('POST', '/api/ops/security-events/', { ...body, objectId: object.id })
}
