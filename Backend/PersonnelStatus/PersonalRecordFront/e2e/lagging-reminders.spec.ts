/**
 * «Напоминания об отставших» на ЖИВОМ стенде — лента уведомлений раздела
 * рядом со светофором сдачи.
 *
 * Что стережёт проба:
 *
 * 1. на экране ровно то, что вернула ручка `/api/operations/notifications/` —
 *    ни выдуманных строк, ни своего счёта отставших (владелец витрины сдачи —
 *    светофор выше);
 * 2. имя подразделения ДОКЛЕИВАЕТСЯ из дерева светофора: уведомление хранит
 *    только идентификаторы, и узел, которого в дереве нет, показывается
 *    номером, а не пропадает;
 * 3. срок рассылки назван контрольным часом ИЗ ОТВЕТА, а не зашит числом;
 * 4. пустая лента сказана словами.
 *
 * Данные на стенде не гарантированы (лента наполняется фоновым догоном после
 * контрольного часа), поэтому живой ответ проверяется как есть, а сценарии с
 * содержимым ставятся ПЕРЕХВАТОМ — иначе проба молчала бы на пустой ленте.
 *
 * 🔴 Service worker MSW блокируется на весь файл: без этого `page.route` не
 * перехватывает запросы приложения, и подмены ниже не применились бы.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SCREEN = '/security-ops/analytics'

interface TrafficNode {
  division_id: number
  name: string
  parent_id: number | null
  status: string
  late: boolean
}

interface TrafficTree {
  business_date: string
  control_hour: string
  nodes: TrafficNode[]
}

interface OpsNotification {
  id: number
  recipient: string
  kind: string
  business_date: string
  payload: { laggard_division_ids?: number[] }
  read_at: string | null
  created_at: string
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  return ((await res.json()) as { access: string }).access
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as T
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

function feed(page: Page) {
  return page.getByRole('group', { name: 'Напоминания об отставших' })
}

/** Подменить ленту уведомлений. Такой ответ бэк вернуть МОЖЕТ: строки ленты —
 * ровно эта форма (вид, деловая дата, плоские идентификаторы отставших). */
async function routeFeed(page: Page, rows: OpsNotification[]): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/operations/notifications/'),
    (route) =>
      route.fulfill({
        json: { count: rows.length, next: null, previous: null, results: rows },
      }),
  )
}

function notification(over: Partial<OpsNotification> = {}): OpsNotification {
  return {
    id: 1,
    recipient: '1',
    kind: 'SUBMISSION_LAGGING',
    business_date: '2026-08-20',
    payload: { laggard_division_ids: [] },
    read_at: null,
    created_at: '2026-08-20T18:00:00+05:00',
    ...over,
  }
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'напоминания об отставших' : 'напоминания об отставших (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('на экране ровно те строки, что вернула ручка ленты', async ({ page }) => {
    const token = await apiToken()
    const live = await get<{ results: OpsNotification[] }>(
      token,
      '/api/operations/notifications/',
    )

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page)).toBeVisible({ timeout: 20_000 })
    await expect(feed(page)).not.toContainText('Загрузка напоминаний', { timeout: 20_000 })

    if (live.results.length === 0) {
      await expect(feed(page)).toContainText('Напоминаний нет')
      await expect(feed(page).getByRole('listitem')).toHaveCount(0)
    } else {
      await expect(feed(page).getByRole('listitem')).toHaveCount(live.results.length)
    }
  })

  test('имя подразделения берётся из дерева светофора, чужой id — номером', async ({ page }) => {
    const token = await apiToken()
    const tree = await get<TrafficTree>(token, '/api/operations/traffic-light/tree/')
    const known = tree.nodes[0]
    expect(known, 'светофор пуст — доклеивать имя не из чего').toBeDefined()

    // Идентификатор, которого в дереве заведомо НЕТ: обязанность сдавать
    // держит плоский список id, и подразделения за ним может уже не быть.
    const missing = Math.max(0, ...tree.nodes.map((node) => node.division_id)) + 1_000

    await signIn(page)
    await routeFeed(page, [
      notification({
        id: 77,
        payload: { laggard_division_ids: [known!.division_id, missing] },
      }),
    ])
    await page.goto(`${APP}${SCREEN}`)

    const row = feed(page).getByRole('listitem').first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    // Имя — из дерева. Показать здесь номер известного узла значило бы, что
    // доклейки нет вовсе.
    await expect(row).toContainText(known!.name)
    await expect(row).not.toContainText(`№${known!.division_id}`)
    // А неизвестный узел назван номером — молча пропав, он скрыл бы отставшего.
    await expect(row).toContainText(`№${missing}`)
    // Деловая дата у строки СВОЯ: догон проходит пропущенные дни, и общая дата
    // экрана соврала бы про день, за который ушло напоминание.
    await expect(row).toContainText('20.08')
    await expect(row).toContainText('не прочитано')
  })

  test('срок рассылки назван контрольным часом из ответа', async ({ page }) => {
    await signIn(page)
    await routeFeed(page, [notification()])
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page)).toBeVisible({ timeout: 20_000 })

    const token = await apiToken()
    const tree = await get<TrafficTree>(token, '/api/operations/traffic-light/tree/')
    await expect(feed(page)).toContainText(
      `после контрольного часа ${tree.control_hour.slice(0, 5)}`,
    )

    // 🔴 Ассерта выше мало: час стенда мог совпасть с зашитой строкой. Порог
    // подменяется в ОТВЕТЕ — подпись обязана поехать за сервером.
    await page.route(
      (url) => url.pathname.endsWith('/api/operations/traffic-light/tree/'),
      (route) => route.fulfill({ json: { ...tree, control_hour: '09:30:00' } }),
    )
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page)).toContainText('после контрольного часа 09:30', { timeout: 20_000 })
  })

  test('пустая лента и напоминание без отставших сказаны словами', async ({ page }) => {
    await signIn(page)
    await routeFeed(page, [])
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page)).toContainText('Напоминаний нет', { timeout: 20_000 })

    // Уведомление без идентификаторов — не пустая строка на экране: молчание
    // здесь неотличимо от «отставших не было».
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await routeFeed(page, [notification({ id: 91, payload: {} })])
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page).getByRole('listitem').first()).toContainText(
      'Отставшие в напоминании не названы',
      { timeout: 20_000 },
    )
  })

  test('второго счёта сдачи блок не заводит', async ({ page }) => {
    await signIn(page)
    await routeFeed(page, [notification({ id: 55, payload: { laggard_division_ids: [1, 2, 3] } })])
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page)).toBeVisible({ timeout: 20_000 })
    // Счётчик блока — число НАПОМИНАНИЙ, а не отставших: сложив отставших, он
    // спорил бы со светофором, который считает по листьям дерева.
    await expect(feed(page)).not.toContainText('не сдали')
    await expect(feed(page)).not.toContainText('подразделений 3')
  })
})
