/**
 * Окно простановки статуса предлагает СПРАВОЧНИК СЕРВЕРА, а не свой список
 * (Plane №342).
 *
 * ОТКУДА ВЗЯЛАСЬ. Заказчик завёл в админке 19-й тип статуса («Участие в ОМ»,
 * код `IN_EVENT`) и не нашёл его на фронте. Причина была не в правах и не в
 * кэше: `entities/daily-grid` держал КОПИЮ каталога — 18 строк константой, —
 * и окно простановки предлагало её. Копия справочника расходится с
 * оригиналом при первой же правке в админке, молча и в обе стороны: новый тип
 * не показывается, деактивированный показывается.
 *
 * ЧТО ИМЕННО СТЕРЕЖЁТ. Не «в списке есть такой-то статус» — такой ассерт
 * стерёг бы одну строку, а болезнь была в источнике. Проба сверяет ДВА
 * СПИСКА: активные типы из `/api/operations/status-types/` и варианты в
 * выпадающем списке окна. Разойдутся в любую сторону — красная.
 *
 * МУТАЦИЯ, НА КОТОРОЙ ОБЯЗАНА ПАДАТЬ: вернуть окну константный каталог
 * (`STATUS_LABEL_BY_CODE`) вместо хука `useOpsStatusTypes` — в списке станет
 * на один вариант меньше, чем отдаёт сервер. Проверено запуском до правки:
 * 18 против 19.
 *
 * СТЕНД НЕ МУТИРУЕТ: окно открывается и закрывается, статус не ставится
 * (в отличие от `status-set-dialog.spec.ts`, где факт расхода остаётся).
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface StatusTypeRow {
  code: string
  name: string
  is_active: boolean
}

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
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

test.describe('расход: каталог статусов окна — из справочника', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('варианты «Статус» совпадают с активными типами справочника', async ({ page }) => {
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const catalog = (await (
      await fetch(`${API}/api/operations/status-types/?limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: StatusTypeRow[] }
    // Статусы участия в ОМ (Plane №427, `[СТС-…]`): вручную не ставятся — окно
    // их не предлагает, и справочник сверяется БЕЗ них.
    const PARTICIPATION = new Set(['EVENT_ASSIGNMENT', 'EVENT_ASSIGNMENT_GROUP', 'IN_EVENT'])
    const expected = catalog.results
      .filter((row) => row.is_active && !PARTICIPATION.has(row.code))
      .map((row) => row.name)
    expect(expected.length, 'справочник на стенде не пуст — иначе проба вакуумна').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`, { waitUntil: 'domcontentloaded' })

    const toggles = page.locator('[role="group"] button[aria-expanded]')
    await expect(toggles.first()).toBeVisible({ timeout: 30_000 })

    // Кнопка «Проставить» есть у КАЖДОГО человека — свободного искать не надо:
    // проба ничего не ставит, ей нужна любая строка.
    const setButton = page.getByRole('button', { name: 'Проставить' })
    const groups = await toggles.count()
    for (let index = 0; index < groups; index += 1) {
      await toggles.nth(index).click()
      if ((await setButton.count()) > 0) break
    }
    await expect(
      setButton.first(),
      'ни в одном управлении нет людей — проверять нечего',
    ).toBeVisible({ timeout: 20_000 })
    await setButton.first().click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Статус', { exact: true }).click()

    const listbox = page.getByRole('listbox')
    await expect(listbox).toBeVisible()
    // Состояние загрузки справочника обязано СМЕНИТЬСЯ списком: пустой список
    // читается как «типов нет» и тогда, когда запрос ещё идёт.
    await expect(page.getByText('Загружаем справочник статусов…')).toHaveCount(0, {
      timeout: 30_000,
    })
    const offered = await page.getByRole('option').allTextContents()

    expect(
      offered.map((text) => text.trim()).sort(),
      `окно предлагает свой список, а не справочник сервера:\n  сервер: ${expected.join(' | ')}\n  окно:   ${offered.join(' | ')}`,
    ).toEqual(expected.map((name) => name.trim()).sort())
  })
})
