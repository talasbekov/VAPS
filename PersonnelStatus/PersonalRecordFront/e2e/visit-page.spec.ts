/**
 * Страница визита иностранного ОЛ (`[ГВО-01]`, `[ГВО-04]`, `[ГВО-07]`, Plane №436).
 *
 * Путь заказчика: реестр ОМ → вкладка «Визиты иностранных ОЛ» → строка ведёт
 * на `/security-ops/visits/{id}`: шапка «тип · статус · заполнено K из N
 * обязательных · PDF · Утвердить», вкладки. «Утвердить» выключена, пока
 * обязательные поля пусты (подсказка перечисляет их); после заполнения страны
 * и пометки остальных «уточняется» по API — кнопка доступна, утверждение
 * ставит статус «Утверждён». У внутреннего ОМ страница говорит «визита нет».
 *
 * Фикстура: FOREIGN-ОМ заводится по API админа; в конце проба ничего не
 * убирает — уборка стенда снимает ОМ по заголовку «Проба».
 *
 * КРАСНОТА НА МУТАЦИИ: убери `missingRequired` из `summary_row` — прогресс и
 * подсказка не появятся; сними гейт `approveBlocker` — кнопка активна при
 * пустых обязательных.
 */
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SHOTS = path.join(__dirname, '..', '..', '..', '..', 'docs', 'audit', 'om-2026-09-03')

function caller(token: string) {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  return async (method: string, p: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    return { status: res.status, ...json }
  }
}

async function token(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'страница визита' : 'страница визита (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('визит открывается своей страницей, «Утвердить» ждёт обязательные поля', async ({ page }) => {
    const admin = caller(await token())
    const persons = await admin('GET', '/api/ops/protected-persons/?page_size=1')
    const created = await admin('POST', '/api/ops/security-events/', {
      title: 'Проба страницы визита (e2e)',
      businessDate: '2026-09-27',
      businessDateEnd: '2026-09-28',
      kind: 'FOREIGN',
      protectedPersonIds: persons.results?.[0] ? [persons.results[0].id] : undefined,
    })
    expect(created.status, JSON.stringify(created).slice(0, 200)).toBe(201)

    await signIn(page)
    await page.goto(`${APP}/security-ops/visits/${created.id}`)
    const head = page.locator('[data-slot="visit-head"]')
    await expect(head).toBeVisible()
    await expect(head.locator('[data-slot="visit-status"]')).toHaveText(/Черновик|Заполнен/)
    await expect(head.locator('[data-slot="visit-progress"]')).toContainText(/заполнено \d+ из \d+ обязательных/)
    const approve = head.getByRole('button', { name: 'Утвердить' })
    await expect(approve).toBeDisabled()
    await expect(approve).toHaveAttribute('title', /Заполните обязательные поля/)
    await expect(page.getByRole('tab', { name: 'Сводные данные ГВО' })).toBeVisible()
    await expect(page.getByRole('tab', { name: /Объекты посещения/ })).toBeVisible()
    await page.screenshot({ path: path.join(SHOTS, 'visit-page-draft.png') })

    // Заполняем страну, остальное — «уточняется»: этого достаточно (ГВО-06/07).
    const patched = await admin('PATCH', `/api/ops/gvo-summaries/${encodeURIComponent(created.code)}/`, {
      section: 'head',
      values: { country: 'Черногория' },
      unspecified: ['persons', 'arrival.date', 'departure.date', 'responsible'],
    })
    expect(patched.status, JSON.stringify(patched).slice(0, 200)).toBe(200)
    await page.reload()
    await expect(head.getByRole('button', { name: 'Утвердить' })).toBeEnabled()
    await head.getByRole('button', { name: 'Утвердить' }).click()
    await expect(head.locator('[data-slot="visit-status"]')).toHaveText('Утверждён')
    await expect(head.getByRole('button', { name: 'Утвердить' })).toBeDisabled()
    await page.screenshot({ path: path.join(SHOTS, 'visit-page-approved.png') })

    // Из реестра визитов строки ведут на страницу визита (первая строка —
    // поиска у вкладки нет, а свой ОМ может лежать не на первой странице).
    await page.goto(`${APP}/security-ops/events/?view=gvo`)
    const link = page.getByRole('main').getByRole('link', { name: /^Сводные данные / }).first()
    await expect(link).toHaveAttribute('href', /^\/security-ops\/visits\/[^/]+\/?$/)
  })

  test('у внутреннего ОМ визита нет — страница говорит это словами', async ({ page }) => {
    const admin = caller(await token())
    const list = await admin('GET', '/api/ops/security-events/?page_size=50&kind=INTERNAL')
    const internal = (list.results as { id: string; kind: string }[]).find((e) => e.kind === 'INTERNAL')
    test.skip(internal === undefined, 'на стенде нет внутреннего ОМ')
    await signIn(page)
    await page.goto(`${APP}/security-ops/visits/${internal!.id}`)
    await expect(page.locator('[data-slot="visit-none"]')).toContainText('визита у него нет')
  })
})
