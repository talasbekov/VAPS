/**
 * «Ежедневный расход» (`/employees?view=daily`) — ЖИВОЙ стенд. Тот же
 * департамент, что и «Сбор сил», но привычной формой прототипа: управления
 * раскрываются построчно, поимённый список грузится ЛЕНИВО — только по
 * первому клику на строку.
 *
 * Проба стережёт ровно стык между источниками:
 *
 * 1. знаменатели строки (списочно) — из РАСХОДА (`/api/operations/strength-
 *    report/`), а не из подсчёта на фронте;
 * 2. раскрытие строки грузит `/api/ops/daily/employees/?division_id=` —
 *    и число строк таблицы обязано сойтись с числом людей ИМЕННО этого
 *    управления, а не всех сразу (без фильтра ручка отвечает 400).
 *
 * 🔴 Service worker MSW блокируется: иначе `page.route` (в будущих пробах
 * этого файла) не перехватывал бы запросы приложения.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface StrengthReport {
  business_date: string
  rows: { division_id: number; name: string; list_total: number; columns: Record<string, number> }[]
  totals: { staff_total: number; list_total: number; columns: Record<string, number> }
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
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return (await res.json()) as T
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

// 🔴 Название управления — не литерал теста: на живом стенде среди них есть
// «Управление (стенд)», и голые скобки в `new RegExp(row.name)` читались бы
// как группа захвата, а не как символы — regex искал бы «Управление» сразу
// перед «стенд» без скобок между ними и не находил бы ничего. Имя экранируем.
function nameRegExp(name: string): RegExp {
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'ежедневный расход' : 'ежедневный расход (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('управления раскрываются поимённо и числа сходятся с расходом', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })
    // Каждое управление расхода названо строкой со своим списочным числом
    for (const row of report.rows) {
      const line = board.getByRole('button', { name: nameRegExp(row.name) })
      await expect(line).toContainText(String(row.list_total))
    }
    // Раскрытие первой группы грузит ПОИМЁННЫЙ список этого управления
    const first = report.rows[0]
    const employees = await get<{ results: { id: number }[] }>(
      token, `/api/ops/daily/employees/?division_id=${first.division_id}`)
    expect(employees.results.length, 'в управлении нет людей — проба вакуумна').toBeGreaterThan(0)
    await board.getByRole('button', { name: nameRegExp(first.name) }).click()
    await expect(board.getByRole('region', { name: nameRegExp(first.name) })
      .locator('tbody tr')).toHaveCount(employees.results.length)
  })
})
