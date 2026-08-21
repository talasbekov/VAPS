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
})
