/**
 * «Сдать день» (`/employees?view=daily`) — панель сдачи, восстановленная из
 * `4d83f361^` (`features/ops-daily/day-submission-panel.tsx`) и посаженная В
 * КАЖДУЮ группу управления «Ежедневного расхода» (решение координатора
 * 21.08, журнал 21→22.08): сдача версионируется ПО УПРАВЛЕНИЮ
 * (`DaySubmission.division_id`) — одна кнопка на весь департамент технически
 * невозможна без бэк-этапа (ручка принимает ровно один `division_id`).
 *
 * Борд сверху несёт СВОДКУ «Сдано N из M управлений на <дата>» + кто не
 * сдал — числа из ЖИВЫХ ответов (расход + фильтр `daily-submissions` по
 * `business_date`, без своего счёта). Само действие — кнопка/бейдж в шапке
 * КАЖДОГО управления, доступная кнопка ищется ВНУТРИ группы конкретного
 * управления (`role="group"` по имени из расхода), не где-то на экране.
 *
 * Проба НЕ мутирует стенд: POST сдачи перехвачен `page.route` и отвечает
 * подменённым, но валидным по форме конвертом (`DaySubmission`, 9 полей) —
 * реальной строки в БД не появляется. Живые GET (история версий, состояние
 * дня, сводка сдачи) проба не трогает — читать стенд можно, менять нельзя.
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

interface DaySubmissionRow {
  division_id: string
  business_date: string
  is_current: boolean
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

// 🔴 Название управления — не литерал теста: голые скобки («Управление
// (стенд)») читались бы `new RegExp` как группа захвата. Имя экранируем —
// тот же приём, что уже в `daily-expense.spec.ts`.
function nameRegExp(name: string): RegExp {
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

/** Перехват POST сдачи: тело складывается в `captured` для проверки, ответ —
 * правдоподобный фейк. GET того же пути (история версий, состояние дня,
 * сводка сдачи борда) проходит НАЖИВО — читать стенд пробе можно, писать
 * нельзя. */
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

  test('кнопка «Сдать день» видна внутри группы своего управления, сводка и POST сходятся с живым расходом', async ({
    page,
  }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    expect(
      report.rows.length,
      'в расходе нет управлений — пробе нечем проверить сдачу',
    ).toBeGreaterThanOrEqual(2) // ⩾2: нужен ещё «сосед» для красной пробы ниже

    // Гвард вакуумности: цель пробы — управление, которое СЕЙЧАС не сдано на
    // деловую дату (иначе шапка несла бы бейдж «Сдан», а не кнопку — клик
    // проверять было бы нечем).
    const existing = await get<{ results: DaySubmissionRow[] }>(
      token,
      `/api/ops/daily/daily-submissions/?business_date=${report.business_date}&limit=200`,
    )
    const submittedIds = new Set(
      existing.results.filter((row) => row.is_current).map((row) => row.division_id),
    )
    const target = report.rows.find((row) => !submittedIds.has(String(row.division_id)))
    expect(target, 'все управления уже сданы на сегодня — пробе нечем проверить кнопку').toBeDefined()

    const captured: { body: DaySubmissionBody | null } = { body: null }
    await interceptSubmit(page, captured)

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })

    // Сводка сверху — «Сдано N из M управлений» — N и M РАЗДЕЛЬНО из живых
    // ответов (расход даёт M, фильтр `daily-submissions` даёт N), не свой
    // счёт. Гвард вырождения (N === M): тогда строки «Не сдали» бы не было —
    // проверяем её присутствие ТОЛЬКО когда есть кому не сдать.
    const summary = board.getByRole('group', { name: 'Сводка сдачи дня' })
    await expect(summary).toContainText(
      `Сдано ${submittedIds.size} из ${report.rows.length} управлений на`,
    )
    if (submittedIds.size < report.rows.length) {
      await expect(summary).toContainText('Не сдали:')
      await expect(summary).toContainText(target!.name)
    }

    // Кнопка — ВНУТРИ группы ИМЕННО этого управления (`role="group"` по
    // имени), не где-то ещё на экране (у соседних управлений своя кнопка).
    const group = board.getByRole('group', { name: nameRegExp(target!.name) })
    const submitButton = group.getByRole('button', { name: 'Сдать день' })
    await expect(submitButton).toBeVisible()
    await submitButton.click()
    await group.getByRole('button', { name: 'Подтвердить сдачу' }).click()

    await expect.poll(() => captured.body !== null, { timeout: 10_000 }).toBe(true)
    // Деловая дата — ИЗ ОТВЕТА расхода, division_id — ИМЕННО этой группы (не
    // соседней и не первой из списка).
    expect(captured.body?.business_date).toBe(report.business_date)
    expect(captured.body?.division_id).toBe(String(target!.division_id))

    // UI дошёл до конца по подменённому ответу — не завис в «Отправка…», и
    // бейдж появился ИМЕННО в группе этого управления.
    await expect(group.getByText(/День сдан/)).toBeVisible()
  })
})
