/**
 * «Сбор сил на ОМ» (`/employees`) — ЖИВОЙ стенд.
 *
 * Экран сводит три источника, и проба стережёт ровно стыки между ними:
 *
 * 1. знаменатели (штат, список, «в строю») взяты у РАСХОДА — владельца этих
 *    чисел; своего счёта личного состава экран не заводит;
 * 2. «Участие в ОМ» посчитано ПОИМЁННО по статусам, потому что расход этого
 *    не даёт: справочник кладёт `EVENT_ASSIGNMENT` в колонку `IN_SERVICE`;
 * 3. «Осталось в строю» = колонка расхода МИНУС привлечённые — без вычитания
 *    одни и те же люди считались бы дважды;
 * 4. статусы берутся НА ДЕЛОВУЮ ДАТУ: без неё ручка отдаёт все дни подряд, и
 *    завершённое дежружство недельной давности выбивало живого человека из
 *    строя (так и было — поймано живой сверкой 12 против 10).
 *
 * 🔴 Service worker MSW блокируется: иначе `page.route` не перехватывает
 * запросы приложения, и подмены ниже молча не применились бы.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SCREEN = '/employees'

const EVENT_ASSIGNMENT = 'EVENT_ASSIGNMENT'
const IN_SERVICE_COLUMN = 'IN_SERVICE'

interface StrengthReport {
  business_date: string
  rows: { division_id: number; name: string; list_total: number; columns: Record<string, number> }[]
  totals: { staff_total: number; list_total: number; columns: Record<string, number> }
}

interface StatusRow {
  id: number
  employee_id: number
  status_type_code: string
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

function metric(page: Page, label: string) {
  return page
    .getByRole('group', { name: 'Личный состав на сбор' })
    .locator('[data-slot="stat-card"]')
    .filter({ hasText: label })
    .first()
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'сбор сил на ОМ' : 'сбор сил на ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('знаменатели взяты у расхода, привлечённые посчитаны по статусам', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const statuses = await get<{ results: StatusRow[] }>(
      token,
      `/api/operations/statuses/?business_date=${report.business_date}&status_type_code=${EVENT_ASSIGNMENT}&page_size=500`,
    )
    const assigned = statuses.results.length
    const inServiceColumn = report.totals.columns[IN_SERVICE_COLUMN] ?? 0

    expect(report.totals.list_total, 'расход пуст — проба вакуумна').toBeGreaterThan(0)
    expect(assigned, 'на стенде никого не выставили на ОМ — разделение колонки не проверяется').toBeGreaterThan(0)
    // Фикстура обязана РАЗВОДИТЬ штат и список: пока они равны, плитка,
    // взявшая не то поле, показывала бы то же число.
    expect(
      report.totals.staff_total,
      'штат равен списку — плитки «По штату» и «По списку» неотличимы',
    ).not.toBe(report.totals.list_total)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    await expect(metric(page, 'По штату')).toBeVisible({ timeout: 25_000 })

    await expect(metric(page, 'По штату')).toContainText(String(report.totals.staff_total))
    await expect(metric(page, 'По списку')).toContainText(String(report.totals.list_total))
    await expect(metric(page, 'В строю')).toContainText(String(inServiceColumn))
    await expect(metric(page, 'Участие в ОМ')).toContainText(String(assigned))
    // Ключевая арифметика экрана: остаток — это колонка МИНУС привлечённые.
    await expect(metric(page, 'Осталось в строю')).toContainText(
      String(inServiceColumn - assigned),
    )
  })

  test('люди разложены по управлениям, вкладки не пересекаются', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const statuses = await get<{ results: StatusRow[] }>(
      token,
      `/api/operations/statuses/?business_date=${report.business_date}&status_type_code=${EVENT_ASSIGNMENT}&page_size=500`,
    )
    const assigned = statuses.results.length
    expect(assigned, 'на стенде нет привлечённых — вкладка пуста, проба вакуумна').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)

    const assignedTab = page.getByRole('tab', { name: /Участие в ОМ/ })
    await expect(assignedTab).toBeVisible({ timeout: 25_000 })
    await expect(assignedTab).toContainText(`(${assigned})`)

    // Список разложен ПО УПРАВЛЕНИЯМ: имя подразделения приезжает из расхода,
    // и хотя бы одно из его подразделений обязано быть названо на экране.
    const panel = page.getByRole('tabpanel')
    const divisionNames = report.rows.map((row) => row.name)
    const shown = await panel.innerText()
    expect(
      divisionNames.some((name) => shown.includes(name)),
      `ни одно подразделение расхода не названо в списке: ${divisionNames.join(', ')}`,
    ).toBe(true)
    // Люди во вкладке — те же, что вернула ручка статусов, по числу карточек.
    const rows = panel.getByRole('listitem')
    await expect(rows).toHaveCount(assigned)

    // Вторая вкладка — ОСТАЛЬНЫЕ: привлечённый не может стоять в обеих, иначе
    // «осталось» и «отдано» описывали бы одних людей.
    const assignedNames = (await rows.allInnerTexts()).map((text) => text.split('\n')[0])
    const inServiceTab = page.getByRole('tab', { name: /В строю/ })
    await inServiceTab.click()
    // 🔴 Ждать ОБЯЗАТЕЛЬНО: без этого innerText читается с ещё не сменившейся
    // панели, и проба сравнивает список привлечённых сам с собой — она падала
    // именно так, показывая «человек в обеих вкладках» там, где его не было.
    await expect(inServiceTab).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/tab=in-service/)
    const inServiceText = await page.getByRole('tabpanel').innerText()
    for (const name of assignedNames) {
      expect(
        inServiceText.includes(name),
        `${name} стоит и в «Участии в ОМ», и в «В строю» — один человек посчитан дважды`,
      ).toBe(false)
    }
  })

  test('статусы спрашиваются на деловую дату, а не за все дни', async ({ page }) => {
    // 🔴 Регресс, пойманный живой сверкой: без business_date ручка отдаёт все
    // строки подряд, и ЗАВЕРШЁННЫЙ статус прошлой недели перетирал живое
    // состояние. Проба ловит это со стороны сети — запрос обязан нести дату.
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')

    await signIn(page)
    const asked: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.endsWith('/api/operations/statuses/')) asked.push(url.search)
    })
    await page.goto(`${APP}${SCREEN}`)
    await expect(metric(page, 'По штату')).toBeVisible({ timeout: 25_000 })
    await expect
      .poll(() => asked.length, { timeout: 15_000 })
      .toBeGreaterThan(0)
    expect(
      asked.every((search) => search.includes(`business_date=${report.business_date}`)),
      `запрос статусов ушёл без деловой даты: ${asked.join(' | ')}`,
    ).toBe(true)
  })

  test('недобор по заявке назван поимённо, а не только суммой', async ({ page }) => {
    await signIn(page)
    // Такой ответ бэк вернуть МОЖЕТ: ровно эта форма приходит у мероприятия на
    // стадии «Запрос сил» — департамент отдал меньше запрошенного.
    await page.route(
      (url) => url.pathname.includes('/api/ops/security-events/') && !url.pathname.match(/security-events\/[^/]+\//),
      async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as {
          results?: { forceRequests?: { requestedCount: number; allocatedCount: number }[] }[]
        }
        const first = body.results?.[0]
        if (first?.forceRequests?.length) {
          first.forceRequests[0].requestedCount = 9
          first.forceRequests[0].allocatedCount = 4
        }
        await route.fulfill({ json: body })
      },
    )
    await page.goto(`${APP}${SCREEN}`)
    const block = page.getByText('Запрос сил по мероприятиям')
    await expect(block).toBeVisible({ timeout: 25_000 })
    // Строка департамента обязана назвать СВОЙ недобор: сумма отвечает
    // «сколько не хватает», строка — «с кого недобрали».
    await expect(page.getByText('не отдано 5')).toBeVisible()
  })

  test('реестр личного состава остался достижим', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    await page.getByRole('link', { name: 'Реестр личного состава' }).click()
    await expect(page).toHaveURL(/\/employees\/registry/)
    await expect(page.getByRole('heading', { name: 'Управление персоналом' })).toBeVisible({
      timeout: 25_000,
    })
  })
})
