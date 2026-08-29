/**
 * «Сборы» на `/employees?view=forces` — вид ШТАБА (Plane №271, Ш-1).
 *
 * ЗЕРКАЛО «ЗАЯВОК». Департамент спрашивает «что просят у меня», штаб —
 * «сколько я раздал и сколько мне вернули»; вкладки соседние и обе видны
 * тому, у кого оба права (администратор). Проба стережёт, что они НЕ
 * подменяют друг друга.
 *
 * Стережёт также: числа приходят с сервера, а не считаются на клиенте
 * (второй счёт разошёлся бы с первым), и полоса объявлена вспомогательным
 * технологиям.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface CollectionRow {
  code: string
  need: number
  gathered: number
  collectionStatus: 'NEW' | 'NOTIFIED' | 'IN_PROGRESS'
}

const STATUS_LABEL = {
  NEW: 'Новый',
  NOTIFIED: 'Разнарядка разослана',
  IN_PROGRESS: 'Сбор идёт',
} as const

async function apiToken(): Promise<string> {
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

test.describe('сборы сил (вид штаба)', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('таблица собрана из ручки сборов и не подменяет вкладку заявок', async ({ page }) => {
    const token = await apiToken()
    const server = (await (
      await fetch(`${API}/api/ops/security-events/forces/collections/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: CollectionRow[] }
    expect(
      server.results.length,
      'на стенде нет ни одного сбора — таблице нечего показать',
    ).toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}/employees?view=forces`)

    // ОБЕ вкладки на месте: у администратора есть оба права, и одна не должна
    // прятать другую.
    const collections = page.getByRole('tab', { name: 'Сборы', exact: true })
    await expect(collections).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('tab', { name: 'Заявки', exact: true })).toBeVisible()

    await collections.click()
    const section = page.locator('section[aria-labelledby="force-collections-heading"]')
    await expect(section.getByRole('heading', { name: 'Сборы сил' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(section.locator('tbody tr'), 'строк столько же, сколько отдала ручка').toHaveCount(
      server.results.length,
      { timeout: 20_000 },
    )

    const first = server.results[0]
    await expect(section.getByText(first.code, { exact: false }).first()).toBeVisible()
    await expect(
      section.getByText(`${first.gathered} из ${first.need}`, { exact: false }).first(),
      'прогресс не назван числом',
    ).toBeVisible()
    await expect(
      section.getByText(STATUS_LABEL[first.collectionStatus], { exact: true }).first(),
      'состояние сбора названо словом эталона',
    ).toBeVisible()

    const bar = section.locator('[role="progressbar"]').first()
    await expect(bar).toHaveAttribute('aria-valuemax', String(first.need))
    await expect(bar).toHaveAttribute('aria-valuenow', String(first.gathered))
  })

  test('на вкладке сборов нет чужих управлений — поиска по людям и выгрузки', async ({
    page,
  }) => {
    /**
     * Отбор по ФИО и «Экспорт CSV» — про СПИСОК ЛЮДЕЙ. На вкладке сборов они
     * не делают ничего, а пустой элемент управления не нейтрален: человек
     * пробует им пользоваться. Ровно это уже чинили на вкладке заявок
     * (Plane №272, Ш-3), и проба закрепляет правило для обеих.
     */
    await signIn(page)
    await page.goto(`${APP}/employees?view=forces`)
    const collections = page.getByRole('tab', { name: 'Сборы', exact: true })
    await expect(collections).toBeVisible({ timeout: 30_000 })
    await collections.click()
    await expect(
      page.getByRole('heading', { name: 'Сборы сил' }),
    ).toBeVisible({ timeout: 20_000 })

    await expect(page.getByPlaceholder('Поиск по ФИО, должности, отделу...')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Экспорт CSV/ })).toHaveCount(0)
  })
})
