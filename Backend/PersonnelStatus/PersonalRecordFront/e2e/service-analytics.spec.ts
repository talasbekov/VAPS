/**
 * Аналитика службы на ЖИВОМ стенде.
 *
 * Экран сводит ДВА источника, и проба стережёт границу между ними:
 *
 * 1. кадровая часть (численность, статусы, подразделения, вакансии) взята у
 *    расхода — владельца этих чисел, а не посчитана из смен; подписи колонок
 *    приходят с сервера, а не из своего словаря;
 * 2. сдача дня считается по ЛИСТЬЯМ светофора: цвет узла с потомками — худший
 *    в поддереве, и сложение его с детьми посчитало бы подразделение дважды;
 * 3. ряд динамики строится за период снимка и обрывается датой раздела —
 *    расхода за будущее не существует;
 * 4. отсутствие права `status.view` названо вслух, а не показано нулями.
 *
 * 🔴 Service worker MSW блокируется на весь файл: без этого `page.route` не
 * перехватывает запросы приложения (они идут через воркер), и подмена прав
 * ниже молча не применилась бы.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SCREEN = '/security-ops/analytics'

interface StrengthRow {
  division_id: number
  name: string
  staff_total: number
  list_total: number
  vacancies: number
  columns: Record<string, number>
}

interface StrengthReport {
  business_date: string
  columns: string[]
  column_labels: Record<string, string>
  rows: StrengthRow[]
  totals: {
    staff_total: number
    list_total: number
    vacancies: number
    attached: number
    off_list: number
    columns: Record<string, number>
  }
}

interface TrafficNode {
  division_id: number
  name: string
  parent_id: number | null
  status: string
  late: boolean
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
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as T
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

/** Плитка показателя по подписи; число берётся без разделителей разрядов. */
function kpiTile(page: Page, label: string) {
  return page
    .getByRole('group', { name: 'Численность личного состава' })
    .locator('div')
    .filter({ hasText: label })
    .first()
}

function share(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(1).replace('.', ',')}%`
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'аналитика службы' : 'аналитика службы (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('кадровые показатели и подписи статусов взяты у расхода', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const totals = report.totals
    expect(totals.list_total, 'расход на стенде пуст — проба вакуумна').toBeGreaterThan(0)
    expect(totals.staff_total, 'штат не задан — доля не проверяется').toBeGreaterThan(0)
    expect(report.rows.length, 'в расходе нет подразделений').toBeGreaterThan(0)
    const inService = totals.columns.IN_SERVICE
    expect(inService, 'в расходе нет колонки «в строю»').not.toBeUndefined()
    // Фикстура обязана РАЗВОДИТЬ «в строю» и «по списку»: пока все в строю,
    // плитка, взявшая не то поле, показывала бы то же число, и проба
    // молча перестала бы сторожить (так и было — красная проба осталась
    // зелёной, пока на стенде не появилось ни одного отсутствующего).
    expect(
      inService,
      'на стенде все в строю — плитка «В строю» неотличима от «по списку»',
    ).not.toBe(totals.list_total)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    await expect(kpiTile(page, 'Списочная численность')).toBeVisible({ timeout: 20_000 })

    await expect(kpiTile(page, 'Списочная численность')).toContainText(
      String(totals.staff_total),
    )
    await expect(kpiTile(page, 'Фактическая численность')).toContainText(
      `${share(totals.list_total, totals.staff_total)} от списочной`,
    )
    await expect(kpiTile(page, 'В строю')).toContainText(String(inService))
    await expect(kpiTile(page, 'Вакансии')).toContainText(String(totals.vacancies))

    // Донат: в центре — сумма колонок расхода, а не число сотрудников из
    // какого-то другого ответа.
    const listed = report.columns.reduce((sum, code) => sum + (totals.columns[code] ?? 0), 0)
    const donut = page.getByRole('group', { name: 'Состояние личного состава' })
    await expect(donut.getByRole('img')).toHaveAttribute(
      'aria-label',
      `Всего по списку: ${listed}`,
    )

    // Подписи колонок — СЕРВЕРНЫЕ. Если бы сервер перестал их отдавать, в
    // легенде и шапке стояли бы коды, и эти проверки покраснели бы.
    for (const code of report.columns) {
      const label = report.column_labels[code]
      expect(label, `сервер не подписал колонку ${code}`).toBeTruthy()
      expect(label, `подпись колонки ${code} — её же код`).not.toBe(code)
      await expect(donut.getByRole('listitem').filter({ hasText: label })).toHaveCount(1)
    }

    const table = page.getByRole('group', { name: 'Сравнение подразделений' })
    await expect(table.locator('tbody tr')).toHaveCount(report.rows.length)
    const first = report.rows[0]
    const firstRow = table.getByRole('row').filter({ hasText: first.name })
    await expect(firstRow).toContainText(share(first.list_total, first.staff_total))
  })

  test('сдача дня считается по листьям светофора, а не по всем узлам', async ({ page }) => {
    const token = await apiToken()
    const tree = await get<{ business_date: string; nodes: TrafficNode[] }>(
      token,
      '/api/operations/traffic-light/tree/',
    )
    const parents = new Set(
      tree.nodes.map((node) => node.parent_id).filter((id): id is number => id !== null),
    )
    const leaves = tree.nodes.filter((node) => !parents.has(node.division_id))
    expect(leaves.length, 'светофор пуст — проба вакуумна').toBeGreaterThan(0)
    expect(
      leaves.length,
      'в дереве нет ни одного родителя — проба не отличит счёт по листьям от счёта по всем',
    ).toBeLessThan(tree.nodes.length)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const block = page.getByRole('group', { name: 'Актуальность ежедневного расхода' })
    await expect(block).toBeVisible({ timeout: 20_000 })
    await expect(block).toContainText(`подразделений ${leaves.length}`)

    const red = leaves.filter((node) => node.status === 'RED')
    await expect(block).toContainText(`не сдали ${red.length}`)

    // Родитель в списке проблемных не появляется: его цвет — худший в
    // поддереве, и он повторил бы своего же ребёнка под другим именем.
    const parentNode = tree.nodes.find((node) => parents.has(node.division_id))
    expect(parentNode, 'в дереве нет родителя').toBeDefined()
    await expect(block.getByRole('listitem').filter({ hasText: parentNode!.name })).toHaveCount(0)
    for (const leaf of red) {
      await expect(block.getByRole('listitem').filter({ hasText: leaf.name })).toHaveCount(1)
    }
  })

  test('ряд динамики идёт за период снимка и обрывается датой раздела', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const today = report.business_date
    const from = new Date(`${today}T00:00:00Z`)
    from.setUTCDate(from.getUTCDate() - 6)
    const fromIso = from.toISOString().slice(0, 10)

    await signIn(page)

    // Семь дней — семь подписей на оси.
    await page.goto(`${APP}${SCREEN}?period=CUSTOM&from=${fromIso}&to=${today}`)
    const chart = page.getByRole('group', { name: 'Динамика доступности' })
    await expect(chart).toBeVisible({ timeout: 20_000 })
    await expect(chart.locator('ul li').filter({ hasText: /^\d{2}\.\d{2}$/ })).toHaveCount(7)
    await expect(chart).not.toContainText('Недостаточно данных')

    // Один день — не динамика; строка прототипа стоит вместо графика.
    await page.goto(`${APP}${SCREEN}?period=TODAY`)
    await expect(chart).toContainText('Недостаточно данных для графика за один день')

    // Период, уходящий в будущее, обрезается датой раздела — и это сказано.
    await page.goto(`${APP}${SCREEN}?period=CURRENT_WEEK`)
    await expect(chart).toContainText(`Ряд обрывается на ${today}`)
  })

  test('без status.view кадровая часть названа, а не обнулена', async ({ page }) => {
    await signIn(page)
    // Такой набор прав бэк вернуть МОЖЕТ: аналитика раздела и расход закрыты
    // РАЗНЫМИ правами, и выдуманного состояния здесь нет.
    await page.route(
      (url) => url.pathname.includes('/api/operations/my-permissions/'),
      (route) => route.fulfill({ json: { permissions: ['analytics.view'] } }),
    )
    await page.goto(`${APP}${SCREEN}`)

    const personnel = page.getByRole('group', { name: 'Личный состав' })
    await expect(personnel).toBeVisible({ timeout: 20_000 })
    await expect(personnel).toContainText('закрыты правом «Статусы: просмотр»')
    // Ноль вместо числа читался бы как «в строю никого».
    await expect(page.getByRole('group', { name: 'Численность личного состава' })).toHaveCount(0)
    // Дежурные показатели закрыты ДРУГИМ правом и остаются на месте. Подпись
    // берётся из ответа сервера, а не пишется здесь: своя копия разошлась бы
    // с реестром показателей при первом же его изменении.
    const metrics = await get<{ data: { metrics: { safeLabel: string }[] } }>(
      await apiToken(),
      '/api/ops/service-analytics/?preset=TODAY',
    )
    const anyMetric = metrics.data.metrics[0]
    expect(anyMetric, 'сервер не отдал ни одного показателя дежурств').toBeDefined()
    await expect(page.getByRole('group', { name: anyMetric.safeLabel })).toBeVisible()
  })
})
