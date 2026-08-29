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
// Подготовка ОМ до посчитанной потребности — общий модуль, а не копия:
// две реализации одной подготовки разошлись бы при первой правке цепочки
// стадий (см. шапку `prepare-events.ts`).
import { prepareDemandEvent } from './prepare-events'

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

  test('карточка сбора открывается на месте списка и раскрывает департамент', async ({
    page,
  }) => {
    /**
     * Plane №271, Ш-2. Карточка открывается НА МЕСТЕ списка («← Назад к
     * списку сборов»), как на эталоне и как у департамента в №272.
     *
     * 🔴 ПРОБА ЗАВОДИТ СВОЁ МЕРОПРИЯТИЕ, а не берёт стендовое. Первая версия
     * выбирала первый сбор без раскладки — а это фикстура смоука, с которой
     * работают соседние спеки. В одиночку проба была зелёной, в ПОЛНОМ
     * прогоне падала: сосед успевал разослать по той же заявке разнарядку, и
     * замена раскладки отбивалась `ALLOCATION_LOCKED`. Драться за общую
     * фикстуру нельзя — своё мероприятие ничего ни у кого не отнимает.
     */
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const own = await prepareDemandEvent(token, '2026-09-15')
    const list = (await (
      await fetch(`${API}/api/ops/security-events/forces/collections/`, { headers })
    ).json()) as { results: (CollectionRow & { eventId: string; departments: number })[] }
    const target = list.results.find((row) => row.code === own.code)
    expect(target, 'своё мероприятие не попало в список сборов').toBeDefined()

    const divisions = (await (
      await fetch(`${API}/api/ops/daily/divisions/?page_size=100`, { headers })
    ).json()) as { results: { id: string; name: string; ancestors?: string[] }[] }
    const department = divisions.results.find(
      (row) => (row.ancestors ?? []).length === 0,
    )
    expect(department, 'в справочнике нет ни одного департамента').toBeDefined()

    const created = await fetch(
      `${API}/api/ops/security-events/${target!.eventId}/forces/allocation/`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ rows: [{ departmentId: String(department!.id), need: 3 }] }),
      },
    )
    expect(created.status, await created.text()).toBe(200)

    try {
      await signIn(page)
      await page.goto(`${APP}/employees?view=forces`)
      const tab = page.getByRole('tab', { name: 'Сборы', exact: true })
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()

      await page.getByRole('button', { name: `Открыть сбор ${target!.code}` }).click()
      await expect(
        page.getByRole('button', { name: 'Назад к списку сборов' }),
        'карточка открылась на месте списка',
      ).toBeVisible({ timeout: 20_000 })

      // Четыре плитки эталона.
      for (const label of [
        'Требуется по рекогносцировке',
        'Распределено квотами',
        'Собрано',
        'Осталось собрать',
      ]) {
        await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
      }

      // Раскрытие строки департамента — то, ради чего карточка и нужна.
      const split = page.locator('section[aria-labelledby="collection-split-heading"]')
      const row = split.locator('button[aria-expanded]').first()
      await expect(row).toHaveAttribute('aria-expanded', 'false')
      await row.click()
      await expect(row).toHaveAttribute('aria-expanded', 'true')
      await expect(
        split.getByText('Выделенные сотрудники', { exact: false }),
        'раскрытая строка не показала список выделенных',
      ).toBeVisible()

      // Возврат работает: человек не заперт в карточке.
      await page.getByRole('button', { name: 'Назад к списку сборов' }).click()
      await expect(page.getByRole('heading', { name: 'Сборы сил' })).toBeVisible()
    } finally {
      await fetch(`${API}/api/ops/security-events/${target!.eventId}/forces/allocation/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ rows: [] }),
      }).catch(() => undefined)
    }
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
