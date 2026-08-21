/**
 * Аналитика службы на ЖИВОМ стенде.
 *
 * Экран сводит ДВА источника, и проба стережёт границу между ними:
 *
 * 1. кадровая часть (численность, статусы, подразделения, вакансии) взята у
 *    расхода — владельца этих чисел, а не посчитана из смен; подписи колонок
 *    приходят с сервера, а не из своего словаря;
 * 2. сдача дня считается по ЛИСТЬЯМ светофора В СЧЁТЧИКАХ (цвет узла с
 *    потомками — худший в поддереве, и сложение его с детьми посчитало бы
 *    подразделение дважды), а под счётчиками — ПОЛНОЕ дерево: все узлы,
 *    вложенные буквально по `parent_id`, здоровые ветки свёрнуты в сводку;
 * 3. ряд динамики строится за период снимка и обрывается датой раздела —
 *    расхода за будущее не существует;
 * 4. отсутствие права `status.view` названо вслух, а не показано нулями.
 *
 * 🔴 Service worker MSW блокируется на весь файл: без этого `page.route` не
 * перехватывает запросы приложения (они идут через воркер), и подмена прав
 * ниже молча не применилась бы.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

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

/** Кликает по каждому свёрнутому переключателю ветки, пока не останется ни
 * одного. Сводка «+N …» прячет потомков полностью (не CSS) — без клика их
 * не будет в DOM, и без этого цикла количество строк не сравнить с
 * `nodes.length` ответа. */
async function expandAllBranches(container: Locator): Promise<void> {
  for (let guard = 0; guard < 50; guard += 1) {
    const toggle = container.locator('button[aria-expanded="false"]').first()
    if ((await toggle.count()) === 0) break
    await toggle.click()
  }
}

const SYNTHETIC_TREE_WITH_HEALTHY_BRANCH = {
  business_date: '2026-08-22',
  control_hour: '17:00:00',
  nodes: [
    { division_id: 9001, name: 'Служба (проба)', parent_id: null, status: 'RED', late: false },
    {
      division_id: 9002,
      name: 'Управление (проба, здоровое)',
      parent_id: 9001,
      status: 'GREEN',
      late: false,
    },
    { division_id: 9003, name: 'Отдел А (проба)', parent_id: 9002, status: 'GREEN', late: false },
    {
      division_id: 9004,
      name: 'Отдел Б (проба)',
      parent_id: 9002,
      status: 'NEUTRAL',
      late: false,
    },
    { division_id: 9005, name: 'Отдел В (проба)', parent_id: 9001, status: 'YELLOW', late: true },
  ],
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

  test('счётчики считаются по листьям светофора, а не по всем узлам', async ({ page }) => {
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
  })

  test('дерево показывает всю иерархию: родитель виден, потомок вложен буквально в его DOM', async ({
    page,
  }) => {
    const token = await apiToken()
    const tree = await get<{ business_date: string; nodes: TrafficNode[] }>(
      token,
      '/api/operations/traffic-light/tree/',
    )
    const parents = new Set(
      tree.nodes.map((node) => node.parent_id).filter((id): id is number => id !== null),
    )
    expect(parents.size, 'в дереве нет ни одного родителя — вложенность не проверить').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const block = page.getByRole('group', { name: 'Актуальность ежедневного расхода' })
    await expect(block).toBeVisible({ timeout: 20_000 })

    // Каждый узел дерева виден — включая родителей, не только листья.
    for (const node of tree.nodes) {
      await expect(block.locator(`[data-division-id="${node.division_id}"]`)).toHaveCount(1)
    }

    // Цепочка «лист → … → корень» обязана лежать ОДНА ВНУТРИ ДРУГОЙ в DOM —
    // проверка САМОЙ вложенности по parent_id, а не присутствия имени
    // где-то в блоке текстом (плоский рендер прошёл бы вторую проверку, но
    // не эту: nestedSelector требует буквальной CSS-вложенности).
    const startLeaf = tree.nodes.find(
      (node) => !tree.nodes.some((other) => other.parent_id === node.division_id),
    )
    expect(startLeaf, 'в дереве нет ни одного листа').toBeDefined()
    const chain: number[] = []
    let current: TrafficNode | undefined = startLeaf
    while (current !== undefined) {
      chain.unshift(current.division_id)
      current = tree.nodes.find((node) => node.division_id === current!.parent_id)
    }
    expect(chain.length, 'выбранный лист лежит на верхнем уровне — цепочку не собрать').toBeGreaterThan(1)
    const nestedSelector = chain.map((id) => `[data-division-id="${id}"]`).join(' ')
    await expect(block.locator(nestedSelector)).toHaveCount(1)

    // Два независимых корня стенда (`parent_id === null` — «Служба» и
    // сиротский стенд-артефакт «Управление (стенд)», см. отчёты задач 3/6)
    // — второй корень НЕ вложен в DOM первого, и наоборот.
    const roots = tree.nodes.filter((node) => node.parent_id === null)
    if (roots.length > 1) {
      await expect(
        block.locator(
          `[data-division-id="${roots[0].division_id}"] [data-division-id="${roots[1].division_id}"]`,
        ),
      ).toHaveCount(0)
      await expect(
        block.locator(
          `[data-division-id="${roots[1].division_id}"] [data-division-id="${roots[0].division_id}"]`,
        ),
      ).toHaveCount(0)
    }
  })

  test('полное дерево: после разворачивания всех веток строк столько же, сколько узлов в ответе', async ({
    page,
  }) => {
    const token = await apiToken()
    const tree = await get<{ nodes: TrafficNode[] }>(token, '/api/operations/traffic-light/tree/')
    expect(tree.nodes.length, 'светофор пуст — проба вакуумна').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const block = page.getByRole('group', { name: 'Актуальность ежедневного расхода' })
    await expect(block).toBeVisible({ timeout: 20_000 })

    await expandAllBranches(block)

    await expect(block.locator('[data-division-id]')).toHaveCount(tree.nodes.length)
  })

  test('здоровая ветка сворачивается в сводку «+N сдавших» и разворачивается по клику (стенд сегодня вырожден — все узлы RED, эта ветка живыми данными не покрыта, синтетическая фикстура через page.route)', async ({
    page,
  }) => {
    await signIn(page)
    await page.route(
      (url) => url.pathname.endsWith('/api/operations/traffic-light/tree/'),
      (route) => route.fulfill({ json: SYNTHETIC_TREE_WITH_HEALTHY_BRANCH }),
    )
    await page.goto(`${APP}${SCREEN}`)
    const block = page.getByRole('group', { name: 'Актуальность ежедневного расхода' })
    await expect(block).toBeVisible({ timeout: 20_000 })

    // Здоровая ветка (9002, GREEN) свёрнута по умолчанию — потомки (9003,
    // 9004) не в DOM вовсе, не просто скрыты стилем.
    await expect(block.locator('[data-division-id="9002"]')).toHaveCount(1)
    await expect(block.locator('[data-division-id="9003"]')).toHaveCount(0)
    await expect(block.locator('[data-division-id="9004"]')).toHaveCount(0)
    const summary = block.locator('[data-division-id="9002"] > button', { hasText: 'сдавших' })
    await expect(summary).toHaveText('+ 2 сдавших')

    // Проблемная ветка (9001, корень RED) и её проблемный лист (9005,
    // YELLOW) — развёрнуты по умолчанию без единого клика.
    await expect(block.locator('[data-division-id="9005"]')).toHaveCount(1)
    const rootToggle = block.locator('[data-division-id="9001"] > div > button[aria-expanded]')
    await expect(rootToggle).toHaveAttribute('aria-expanded', 'true')

    // Клик по сводке разворачивает ветку — счётчик уступает место строкам.
    await summary.click()
    await expect(block.locator('[data-division-id="9003"]')).toHaveCount(1)
    await expect(block.locator('[data-division-id="9004"]')).toHaveCount(1)
    await expect(
      block.locator('[data-division-id="9002"] > button', { hasText: 'сдавших' }),
    ).toHaveCount(0)
    const branchToggle = block.locator('[data-division-id="9002"] > div > button[aria-expanded]')
    await expect(branchToggle).toHaveAttribute('aria-expanded', 'true')
  })

  test('пустой контрольный час — честная фраза, не эхо сырого значения', async ({ page }) => {
    const token = await apiToken()
    const tree = await get<{ control_hour: string; business_date: string; nodes: TrafficNode[] }>(
      token,
      '/api/operations/traffic-light/tree/',
    )

    await signIn(page)
    await page.route(
      (url) => url.pathname.endsWith('/api/operations/traffic-light/tree/'),
      (route) => route.fulfill({ json: { ...tree, control_hour: '' } }),
    )
    await page.goto(`${APP}${SCREEN}`)

    const block = page.getByRole('group', { name: 'Актуальность ежедневного расхода' })
    await expect(block).toBeVisible({ timeout: 20_000 })
    await expect(block).toContainText('Контрольный час не задан.')
    await expect(block.getByText(/undefined/)).toHaveCount(0)
    // Полуоборванная фраза с эхом пустоты («Контрольный час  — сдача…») не
    // должна остаться на экране — вместо неё честная альтернатива выше.
    await expect(block.getByText(/Контрольный час\s{2,}/)).toHaveCount(0)

    const reminders = page.getByRole('group', { name: 'Напоминания об отставших' })
    await expect(reminders).toContainText(
      'Уходят ответственным автоматически после контрольного часа — одно за день.',
    )
  })

  test('контрольный час показан тот, что вернул сервер', async ({ page }) => {
    // «с опозданием N» без порога нечем прочитать. Ожидание берётся из
    // ОТВЕТА: час — настройка раздела, и пин литералом «17:00» сторожил бы
    // дефолт, а не проводку.
    const token = await apiToken()
    const tree = await get<{ control_hour: string; business_date: string; nodes: TrafficNode[] }>(
      token,
      '/api/operations/traffic-light/tree/',
    )
    expect(tree.control_hour, 'сервер не отдал контрольный час').toMatch(/^\d{2}:\d{2}/)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const block = page.getByRole('group', { name: 'Актуальность ежедневного расхода' })
    await expect(block).toBeVisible({ timeout: 20_000 })
    await expect(block).toContainText(`Контрольный час ${tree.control_hour.slice(0, 5)}`)
    // Секунды порога на экране не печатаются: сравнение идёт по времени суток.
    await expect(block).not.toContainText(tree.control_hour)

    // 🔴 Ассерта выше МАЛО: на стенде стоит дефолт 17:00, и зашитая в вёрстку
    // строка «17:00» прошла бы его. Порог подменяется в ОТВЕТЕ — экран обязан
    // поехать за сервером. Такой ответ бэк вернуть может: час меняется в
    // настройках контроля сдачи, выдуманного состояния здесь нет.
    const moved = { ...tree, control_hour: '09:30:00' }
    await page.route(
      (url) => url.pathname.endsWith('/api/operations/traffic-light/tree/'),
      (route) => route.fulfill({ json: moved }),
    )
    await page.goto(`${APP}${SCREEN}`)
    await expect(block).toContainText('Контрольный час 09:30', { timeout: 20_000 })
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
