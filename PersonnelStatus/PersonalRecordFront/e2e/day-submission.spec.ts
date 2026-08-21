/**
 * «Сдать день» (`/employees?view=daily`) — панель сдачи, восстановленная из
 * `4d83f361^` (`features/ops-daily/day-submission-panel.tsx`) и посаженная в
 * «Ежедневный расход» под сводной строкой.
 *
 * Экран департаментский (несколько управлений разом), а ручка сдачи — НА ОДНО
 * подразделение (`DaySubmissionCreateBody` = ровно `{division_id,
 * business_date}`). У `/api/ops/daily/divisions/` нет поля родителя (см.
 * `LeadershipStrip.tsx`) — понятия «id департамента» тут нет, и панель
 * прагматично привязана к ПЕРВОМУ управлению расхода (`report.rows[0]`,
 * стабильный порядок сервера); проба сверяет ИМЕННО этот division_id, чтобы
 * не разойтись с реальной проводкой. Открытый вопрос — см. отчёт Task 4.
 *
 * Проба НЕ мутирует стенд: POST сдачи перехвачен `page.route` и отвечает
 * подменённым, но валидным по форме конвертом (`DaySubmission`, 9 полей) —
 * реальной строки в БД не появляется. Живые GET (история версий, состояние
 * дня) проба не трогает — читать стенд можно, менять нельзя.
 *
 * 🔴 Service worker MSW блокируется: без этого `page.route` не перехватывает
 * запросы приложения.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface StrengthReport {
  business_date: string
  rows: { division_id: number; name: string; list_total: number }[]
}

interface DaySubmissionBody {
  division_id: string
  business_date: string
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

/** Перехват POST сдачи: тело складывается в `captured` для проверки, ответ —
 * правдоподобный фейк. GET того же пути (история версий, состояние дня)
 * проходит НАЖИВО — читать стенд пробе можно, писать нельзя. */
async function interceptSubmit(
  page: Page,
  captured: { body: DaySubmissionBody | null },
): Promise<void> {
  await page.route(
    (url) => url.pathname.includes('/api/ops/daily/daily-submissions/'),
    async (route) => {
      const request = route.request()
      if (request.method() !== 'POST') {
        await route.continue()
        return
      }
      const body = request.postDataJSON() as DaySubmissionBody
      captured.body = body
      await route.fulfill({
        status: 201,
        json: {
          id: 999999,
          division_id: body.division_id,
          business_date: body.business_date,
          version: 1,
          is_current: true,
          event: 'CHANGED',
          submitted_by: 'admin',
          submitted_at: new Date().toISOString(),
          late: false,
        },
      })
    },
  )
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'сдача дня' : 'сдача дня (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('кнопка «Сдать день» видна под admin и POST несёт деловую дату расхода', async ({
    page,
  }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    expect(
      report.rows.length,
      'в расходе нет управлений — пробе нечем проверить сдачу',
    ).toBeGreaterThan(0)
    const first = report.rows[0]

    const captured: { body: DaySubmissionBody | null } = { body: null }
    await interceptSubmit(page, captured)

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })

    const submitButton = board.getByRole('button', { name: 'Сдать день' })
    await expect(submitButton).toBeVisible()
    await submitButton.click()

    await board.getByRole('button', { name: 'Подтвердить сдачу' }).click()

    await expect.poll(() => captured.body !== null, { timeout: 10_000 }).toBe(true)
    // Деловая дата — ИЗ ОТВЕТА расхода, не из часов браузера.
    expect(captured.body?.business_date).toBe(report.business_date)
    expect(captured.body?.division_id).toBe(String(first.division_id))

    // UI дошёл до конца по подменённому ответу — не завис в «Отправка…».
    await expect(board.getByText(/День сдан/)).toBeVisible()
  })
})
