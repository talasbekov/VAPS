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
 * 3. блок «Руководство департамента» (первым, раскрыт сразу) — состав и
 *    статус-пилюли сверяются с ПРАВДОЙ штатки (`staff-units/directorate/`,
 *    `position.level`), а не со счётом в разметке.
 * 4. блок «Суточный свод» — версии СВОДНОГО заявления департамента
 *    (`division_id=2`, составное подразделение — родитель управлений 4/5,
 *    см. `/api/divisions/divisions_tree/`). У вьюсета `daily-summaries`
 *    (задуманного брифом источника) НЕТ действия чтения списка версий
 *    вовсе (только create/rebuild/freshness/export) — свод физически ХРАНИТСЯ
 *    в ТОЙ ЖЕ таблице/сериализаторе, что обычная сдача (см. докстринг
 *    `DailySummaryViewSet` на бэке), и версии читаются ЧЕРЕЗ УЖЕ ИЗВЕСТНУЮ
 *    `daily-submissions` с точным (не поддеревным) фильтром `division_id`.
 *    На живом стенде (21.08.2026) свода ЗА ЛЮБУЮ дату ещё ни разу не
 *    собирали (`count: 0`) — вакуумный гвард честно уходит в пустое
 *    состояние; строчный рендер отдельно проверен перехватом.
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

// Форма `staff-units/directorate/` на живом стенде — ПЛОСКАЯ (одна
// `position`/один `employee` на штатную единицу), не форма, которую
// объявляет `StaffUnit` в `lib/api.ts`. См. `LeadershipStrip.tsx`.
interface RawStaffUnit {
  id: number
  division?: { id: number; name?: string } | null
  position?: { id: number; name: string; level: number } | null
  employee?: { id: number; first_name: string; last_name: string } | null
}

// Дублируем ПОРОГ уровня, а не импортируем `features/daily-expense`: во всей
// сюите e2e ни одна спека не тянет `@/`-модуль приложения (`LeadershipStrip`
// — «use client» React-компонент, сборка вне Next.js рискованна и без
// прецедента в этом файле). Значение обязано совпадать с
// `LEADERSHIP_MAX_LEVEL`, экспортированным `features/daily-expense/index.ts`.
const LEADERSHIP_MAX_LEVEL = 1

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

// Дублируем значение, а не импортируем `features/daily-expense`: та же
// причина, что у `LEADERSHIP_MAX_LEVEL` выше — «use client» React-компонент,
// сборка вне Next.js рискованна. Обязано совпадать с `SUMMARY_DIVISION_ID`,
// экспортированным `features/daily-expense/index.ts`.
const SUMMARY_DIVISION_ID = 2

interface DailySubmissionRow {
  id: number
  division_id: string
  business_date: string
  version: number
  is_current: boolean
  event: string
  submitted_by: string
  submitted_at: string
  late: boolean
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

  test('«Руководство департамента» — первым, раскрыт сразу, состав и статусы по правде штатки', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const directorate = await get<{ staff_units: RawStaffUnit[] }>(
      token, '/api/staff_unit/staff-units/directorate/')

    // Правда штатки: руководители — штатные единицы с level ⩽ порога,
    // заведённые ФИЗИЧЕСКИ (не вакансия).
    const leaders = directorate.staff_units.filter(
      (unit): unit is RawStaffUnit & { employee: NonNullable<RawStaffUnit['employee']>; division: NonNullable<RawStaffUnit['division']> } =>
        (unit.position?.level ?? Infinity) <= LEADERSHIP_MAX_LEVEL &&
        unit.employee != null &&
        unit.division != null
    )
    expect(leaders.length, 'в штатке нет руководителей уровня ⩽ порога — проба вакуумна').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })

    // Раскрыт СРАЗУ — без клика, в отличие от рядовых управлений.
    const leadership = board.getByRole('region', { name: 'Руководство департамента' })
    await expect(leadership).toBeVisible()

    // Стоит ПЕРВЫМ — выше первой строки-кнопки рядового управления.
    const firstDivisionButton = board.getByRole('button', { name: nameRegExp(report.rows[0].name) })
    await expect(firstDivisionButton).toBeVisible()
    const leadershipBox = await leadership.boundingBox()
    const divisionBox = await firstDivisionButton.boundingBox()
    expect(leadershipBox, 'блок руководства не отрисован').not.toBeNull()
    expect(divisionBox, 'первая строка управления не отрисована').not.toBeNull()
    expect((leadershipBox as { y: number }).y).toBeLessThan((divisionBox as { y: number }).y)

    // Число строк — РОВНО число руководителей из штатки. `listitem` несут
    // ТОЛЬКО отрисованные строки (скелетные плейсхолдеры — без этой роли),
    // поэтому совпадение счёта не может быть скелетом, отловленным рано.
    await expect(leadership.getByRole('listitem')).toHaveCount(leaders.length)
    for (const leader of leaders) {
      await expect(leadership.getByText(
        `${leader.employee.last_name} ${leader.employee.first_name}`, { exact: true }
      )).toBeVisible()
    }

    // Пилюля первой строки — по ПРАВДЕ статуса на деловую дату (не по
    // умолчанию «в строю», как у рядовых строк расхода: тут честная метка
    // «статус не заведён», если действующего статуса нет).
    const statusTypes = await get<{ results: { code: string; name: string }[] }>(
      token, '/api/operations/status-types/?page_size=200')
    const nameByCode = new Map(statusTypes.results.map((t) => [t.code, t.name]))
    const first = leaders[0]
    const divisionStatuses = await get<{ results: { employee_id: number; status_type_code: string }[] }>(
      token,
      `/api/operations/statuses/?business_date=${report.business_date}&division_id=${first.division.id}&page_size=500`
    )
    const activeStatus = divisionStatuses.results.find((row) => row.employee_id === first.employee.id)
    const expectedLabel = activeStatus
      ? (nameByCode.get(activeStatus.status_type_code) ?? activeStatus.status_type_code)
      : 'статус не заведён'
    const firstRow = leadership.getByRole('listitem').filter({
      hasText: `${first.employee.last_name} ${first.employee.first_name}`,
    })
    await expect(firstRow.getByText(expectedLabel, { exact: true })).toBeVisible()

    // Честная подпись под блоком — verbatim, не подстрокой.
    await expect(leadership.getByText(
      'Руководство собрано по уровню должности из штатного расписания (level ≤ 1); отдельного серверного признака „руководство" нет — появится бэк-этапом.',
      { exact: true }
    )).toBeVisible()
  })

  test('«Суточный свод» — версии сходятся с живой ручкой (вакуумный гвард на честную пустоту)', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const businessDate = report.business_date
    const live = await get<{ results: DailySubmissionRow[] }>(
      token,
      `/api/ops/daily/daily-submissions/?division_id=${SUMMARY_DIVISION_ID}&business_date=${businessDate}`
    )

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })
    const summary = board.getByRole('region', { name: 'Суточный свод' })
    await expect(summary).toBeVisible()

    const currentCount = live.results.filter((row) => row.is_current).length

    if (live.results.length === 0) {
      // Вакуумный гвард честно не проходит на этом стенде (свод ни разу не
      // собирался ни на одну дату) — проверяем ЧЕСТНУЮ пустоту против ЖИВОГО
      // «ноль», а не молчим об этом.
      await expect(summary.getByText('свод ещё не собирался', { exact: true })).toBeVisible()
      await expect(summary.getByRole('listitem')).toHaveCount(0)
    } else {
      expect(currentCount, 'на подразделении больше одной текущей версии — инвариант бэка нарушен').toBe(1)
      await expect(summary.getByRole('listitem')).toHaveCount(live.results.length)
      await expect(summary.getByText('Текущая', { exact: true })).toHaveCount(currentCount)
      for (const row of live.results) {
        await expect(summary.getByText(`Версия ${row.version}`, { exact: true })).toBeVisible()
      }
    }
  })

  test('«Суточный свод» — строки версии и снимок рендерятся по перехваченному ответу (2 версии, одна текущая)', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const businessDate = report.business_date

    const fakeRows: DailySubmissionRow[] = [
      {
        id: 90001,
        division_id: String(SUMMARY_DIVISION_ID),
        business_date: businessDate,
        version: 2,
        is_current: true,
        event: 'AMENDED',
        submitted_by: 'проба',
        submitted_at: `${businessDate}T10:00:00+05:00`,
        late: false,
      },
      {
        id: 90000,
        division_id: String(SUMMARY_DIVISION_ID),
        business_date: businessDate,
        version: 1,
        is_current: false,
        event: 'CHANGED',
        submitted_by: 'проба',
        submitted_at: `${businessDate}T09:00:00+05:00`,
        late: false,
      },
    ]

    // Предикат, а не глоб: путь совпадает с ДВУМЯ другими живыми запросами
    // этого же экрана (сводкой борда без `division_id` и внутренней историей
    // панели `DaySubmissionPanel` с `division_id` управления и `limit=200`,
    // без `business_date`) — молчаливая коллизия глоба перехватила бы чужой
    // запрос вместо нашего.
    await page.route(
      (url) =>
        url.pathname === '/api/ops/daily/daily-submissions/' &&
        url.searchParams.get('division_id') === String(SUMMARY_DIVISION_ID) &&
        url.searchParams.get('business_date') === businessDate &&
        url.searchParams.get('limit') === null,
      async (route) => {
        await route.fulfill({
          json: { count: fakeRows.length, next: null, previous: null, results: fakeRows },
        })
      }
    )
    await page.route(
      (url) => url.pathname === '/api/operations/daily-submissions/90001/',
      async (route) => {
        await route.fulfill({
          json: {
            id: 90001,
            division_id: SUMMARY_DIVISION_ID,
            business_date: businessDate,
            version: 2,
            is_current: true,
            event: 'AMENDED',
            submitted_by: '1',
            submitted_at: `${businessDate}T10:00:00+05:00`,
            late: false,
            reason: 'проверка пробой',
            sanction: 'выговор',
            triggered_by_status_id: null,
            snapshot: { roster: [{}, {}], rows: [{}] },
          },
        })
      }
    )

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })
    const summary = board.getByRole('region', { name: 'Суточный свод' })

    await expect(summary.getByRole('listitem')).toHaveCount(2)
    await expect(summary.getByText('Текущая', { exact: true })).toHaveCount(1)
    await expect(summary.getByText('Версия 2', { exact: true })).toBeVisible()
    await expect(summary.getByText('Версия 1', { exact: true })).toBeVisible()

    // Бейдж обязан стоять НА ПРАВИЛЬНОЙ строке (v2, `is_current: true`), а не
    // просто существовать где-то в блоке — иначе счёт «ровно один» прошёл бы
    // и при бейдже, ошибочно повешенном на v1.
    const currentRow = summary.getByRole('listitem').filter({ hasText: 'Версия 2' })
    const supersededRow = summary.getByRole('listitem').filter({ hasText: 'Версия 1' })
    await expect(currentRow.getByText('Текущая', { exact: true })).toBeVisible()
    await expect(supersededRow.getByText('Текущая', { exact: true })).toHaveCount(0)

    await currentRow.getByRole('button', { name: 'Открыть' }).click()
    await expect(currentRow.getByText(
      'В списке 2, отклонений 1 · причина: проверка пробой · санкция: выговор',
      { exact: true }
    )).toBeVisible()
  })
})
