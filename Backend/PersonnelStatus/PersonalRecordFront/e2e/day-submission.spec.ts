/**
 * «Сдать день» (`/employees?view=daily`) — панель сдачи, восстановленная из
 * `4d83f361^` (`features/ops-daily/day-submission-panel.tsx`) и посаженная В
 * КАЖДУЮ группу управления «Ежедневного расхода» (решение координатора
 * 21.08, журнал 21→22.08): сдача версионируется ПО УПРАВЛЕНИЮ
 * (`DaySubmission.division_id`) — одна кнопка на весь департамент технически
 * невозможна без бэк-этапа (ручка принимает ровно один `division_id`).
 *
 * Борд сверху несёт СВОДКУ «Сдано N из M управлений на <дата>» + кто не
 * сдал — числа из ЖИВЫХ ответов, без своего счёта. Само действие — кнопка/
 * бейдж в шапке КАЖДОГО управления, доступная кнопка ищется ВНУТРИ группы
 * конкретного управления (`role="group"` по имени из расхода).
 *
 * Третья находка ревью (21.08, после второй фикс-секции): панель сдачи
 * заводит СВОЙ внутренний запрос истории версий на каждое монтирование
 * (`historyQuery`, БЕЗ гейта на `open`) — держать её смонтированной у КАЖДОЙ
 * группы сразу означало бы N безусловных запросов при каждой загрузке
 * экрана, что прямо противоречит правилу ленивости, которое сам файл
 * объявляет в шапке («шесть управлений … иначе означали бы шесть запросов…»).
 * Починено: панель монтируется ТОЛЬКО при раскрытии строки; в свёрнутом виде
 * шапка несёт лёгкий БЕЗ-интерактивный бейдж («День не сдан» / «Сдан · vN»),
 * собранный из ОДНОГО списочного запроса борда (`business_date`-фильтр, без
 * `division_id`) — того же, что кормит сводку сверху. Спека проверяет ОБА
 * состояния бейджа (до и после сдачи) и то, что сводка/бейдж синхронно
 * реагируют на сдачу БЕЗ дополнительного действия пользователя.
 *
 * Проба НЕ мутирует стенд: POST сдачи перехвачен `page.route` и отвечает
 * подменённым, но валидным по форме конвертом (`DaySubmission`, 9 полей) —
 * реальной строки в БД не появляется. После успешного POST перехвачен ТОЛЬКО
 * повторный списочный GET борда (`business_date`-фильтр, без `division_id`)
 * — он и есть тот запрос, который борд перечитывает по сигналу инвалидации
 * панели; отвечает списком с добавленной (фейковой) записью, имитируя то,
 * что легло бы в БД. Любой другой GET (история версий конкретного
 * управления, другие управления) идёт НАЖИВУЮ.
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

// Тот же алгоритм, что `formatIsoDate` в `shared/lib/date.ts` («ГГГГ-ММ-ДД» →
// «ДД.ММ.ГГГГ»), но БЕЗ `toLocaleDateString`: движок теста (Node) и движок
// страницы (Chromium) не обязаны иметь идентичные ICU-данные, а точный текст
// (Minor-находка ревью: не подстрочный `toContainText`) требует байт-в-байт
// совпадения.
function formatIsoDateRu(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

function fakeSubmission(divisionId: string, businessDate: string) {
  return {
    id: 999999,
    division_id: divisionId,
    business_date: businessDate,
    version: 1,
    is_current: true,
    event: 'CHANGED',
    submitted_by: 'admin',
    submitted_at: new Date().toISOString(),
    late: false,
  }
}

/**
 * Перехват сдачи ОДНОГО целевого управления:
 * - POST → тело складывается в `captured`, ответ — правдоподобный фейк.
 * - GET БЕЗ `division_id`, С `business_date=<дата>` (списочный запрос
 *   борда — тот, что борд перечитывает по сигналу инвалидации панели) — ДО
 *   успешной сдачи проходит НАЖИВУЮ (честный список без цели), ПОСЛЕ —
 *   отвечает списком с добавленной записью для целевого управления.
 * - Любой другой GET (история версий конкретного управления — свой
 *   внутренний запрос панели, БЕЗ `business_date`, с `division_id`; другие
 *   управления) — НАЖИВУЮ всегда.
 */
async function interceptSubmit(
  page: Page,
  captured: { body: DaySubmissionBody | null },
  targetDivisionId: string,
  businessDate: string,
): Promise<void> {
  let submitted = false
  await page.route(
    (url) => url.pathname.includes('/api/ops/daily/daily-submissions/'),
    async (route) => {
      const request = route.request()
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as DaySubmissionBody
        captured.body = body
        submitted = true
        await route.fulfill({ status: 201, json: fakeSubmission(body.division_id, body.business_date) })
        return
      }
      const requestUrl = new URL(request.url())
      const isBoardListQuery =
        requestUrl.searchParams.get('business_date') === businessDate &&
        requestUrl.searchParams.get('division_id') === null
      if (submitted && isBoardListQuery) {
        await route.fulfill({
          status: 200,
          json: {
            count: 1,
            next: null,
            previous: null,
            results: [fakeSubmission(targetDivisionId, businessDate)],
          },
        })
        return
      }
      await route.continue()
    },
  )
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'сдача дня' : 'сдача дня (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('бейдж/кнопка сдачи — внутри группы своего управления, ленивая панель, сводка синхронна с сдачей', async ({
    page,
  }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    expect(
      report.rows.length,
      'в расходе нет управлений — пробе нечем проверить сдачу',
    ).toBeGreaterThanOrEqual(1)

    // Гвард вакуумности: цель пробы — управление, которое СЕЙЧАС не сдано на
    // деловую дату (иначе шапка несла бы бейдж «Сдан», а не кнопку — клик
    // проверять было бы нечем, и сводке было бы некуда расти).
    const existing = await get<{ results: DaySubmissionRow[] }>(
      token,
      `/api/ops/daily/daily-submissions/?business_date=${report.business_date}&limit=200`,
    )
    const submittedIdsBefore = new Set(
      existing.results.filter((row) => row.is_current).map((row) => row.division_id),
    )
    const target = report.rows.find((row) => !submittedIdsBefore.has(String(row.division_id)))
    expect(target, 'все управления уже сданы на сегодня — пробе нечем проверить кнопку').toBeDefined()
    const targetDivisionId = String(target!.division_id)
    const notSubmittedNamesBefore = report.rows
      .filter((row) => !submittedIdsBefore.has(String(row.division_id)))
      .map((row) => row.name)

    const captured: { body: DaySubmissionBody | null } = { body: null }
    await interceptSubmit(page, captured, targetDivisionId, report.business_date)

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })

    // Сводка сверху — ТОЧНЫЙ текст (не подстрочный toContainText — Minor-
    // находка ревью), N/M/дата из живых ответов, не хардкод.
    const summary = board.getByRole('group', { name: 'Сводка сдачи дня' })
    const summaryHeadline = summary.locator('p').first()
    await expect(summaryHeadline).toHaveText(
      `Сдано ${submittedIdsBefore.size} из ${report.rows.length} управлений на ${formatIsoDateRu(report.business_date)}`,
    )
    if (notSubmittedNamesBefore.length > 0) {
      await expect(summary.locator('p').nth(1)).toHaveText(
        `Не сдали: ${notSubmittedNamesBefore.join(', ')}`,
      )
    } else {
      await expect(summary.locator('p')).toHaveCount(1)
    }

    // Группа ИМЕННО этого управления — бейдж СВЁРНУТОЙ шапки: «День не
    // сдан», без запроса и без интерактивности (панель ещё не смонтирована —
    // требование A.3 держится ленивостью, не наоборот).
    const group = board.getByRole('group', { name: nameRegExp(target!.name) })
    await expect(group.getByText('День не сдан', { exact: true })).toBeVisible()
    await expect(group.getByRole('button', { name: 'Сдать день' })).toHaveCount(0)

    // Раскрытие строки — ТОЛЬКО теперь монтируется интерактивная панель.
    await group.getByRole('button', { name: nameRegExp(target!.name) }).click()
    const submitButton = group.getByRole('button', { name: 'Сдать день' })
    await expect(submitButton).toBeVisible()
    await submitButton.click()
    await group.getByRole('button', { name: 'Подтвердить сдачу' }).click()

    await expect.poll(() => captured.body !== null, { timeout: 10_000 }).toBe(true)
    // Деловая дата — ИЗ ОТВЕТА расхода, division_id — ИМЕННО этой группы (не
    // соседней).
    expect(captured.body?.business_date).toBe(report.business_date)
    expect(captured.body?.division_id).toBe(targetDivisionId)

    // UI дошёл до конца по подменённому ответу — бейдж «День сдан» появился
    // ИМЕННО в группе этого управления (собственное состояние панели, без
    // ожидания рефетча).
    await expect(group.getByText(/День сдан/)).toBeVisible()

    // Сводка ОБЯЗАНА смениться: N выросло ровно на единицу, целевое
    // управление ушло из списка несдавших — точный текст, не хардкод.
    await expect(summaryHeadline).toHaveText(
      `Сдано ${submittedIdsBefore.size + 1} из ${report.rows.length} управлений на ${formatIsoDateRu(report.business_date)}`,
    )
    const notSubmittedNamesAfter = notSubmittedNamesBefore.filter((name) => name !== target!.name)
    if (notSubmittedNamesAfter.length > 0) {
      await expect(summary.locator('p').nth(1)).toHaveText(
        `Не сдали: ${notSubmittedNamesAfter.join(', ')}`,
      )
    } else {
      await expect(summary.locator('p')).toHaveCount(1)
    }

    // Схлопнули строку обратно — свёрнутый бейдж ТОЖЕ синхронен (питается тем
    // же обновлённым списочным ответом борда, без своего запроса).
    await group.getByRole('button', { name: nameRegExp(target!.name) }).click()
    await expect(group.getByText('Сдан · v1', { exact: true })).toBeVisible()
  })
})
