/**
 * Командный центр на ЖИВОМ стенде.
 *
 * Проба отвечает на три вопроса:
 *
 * 1. показатели шапки взяты из ответов сервера, а не нарисованы: численность
 *    сходится с расходом (строевой запиской), дефицит — с незакрытыми
 *    запросами сил по НЕЗАВЕРШЁННЫМ мероприятиям;
 * 2. незагруженные права не выдаются за отказ, а отсутствие права
 *    `status.view` названо вслух — численность тогда прочерк с причиной,
 *    а не ноль;
 * 3. карточка «Расход дня» считает счётчики «Сдано / Не сдано / Просрочено»
 *    ПО ЛИСТЬЯМ дерева светофора (`traffic-light/tree/`) — тем же ответом,
 *    что и её собственный экран (`/security-ops/analytics`), без второго
 *    счёта; без права `status.view` карточка не рендерится вовсе.
 *
 * 🔴 Service worker MSW блокируется на весь файл: без этого `page.route` не
 * перехватывает запросы приложения (они идут через воркер), и подмена прав
 * ниже молча не применилась бы. Разделу ОМ мок не нужен — он живой.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface ForceRequestRow {
  requestedCount: number
  allocatedCount: number
}

interface EventRow {
  id: string
  stage: string
  readinessPercent: number
  forceRequests: ForceRequestRow[]
}

interface StrengthRow {
  staff_total: number
  list_total: number
  columns: Record<string, number>
}

interface TrafficLightNode {
  division_id: number
  name: string
  parent_id: number | null
  status: 'GREEN' | 'YELLOW' | 'RED' | 'NEUTRAL' | 'UNKNOWN'
  late: boolean
}

interface TrafficLightTree {
  business_date: string
  control_hour: string
  nodes: TrafficLightNode[]
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(token: string): Promise<EventRow[]> {
  const res = await fetch(`${API}/api/ops/security-events/?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

async function strengthReport(
  token: string,
): Promise<{ columns: string[]; rows: StrengthRow[] }> {
  const res = await fetch(`${API}/api/operations/strength-report/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as { columns: string[]; rows: StrengthRow[] }
}

async function trafficLightTree(token: string): Promise<TrafficLightTree> {
  const res = await fetch(`${API}/api/operations/traffic-light/tree/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as TrafficLightTree
}

/**
 * Счёт «Сдано / Не сдано / Просрочено» — ТА ЖЕ методика, что в
 * `ExpenseTrafficCard.tsx` (см. её докстринг): по ЛИСТЬЯМ дерева (родители
 * исключены — их цвет каскад, суммировать значило бы посчитать подразделение
 * дважды), `late` берётся с бэка (`submission.late`) и у узла без сдачи
 * (RED/NEUTRAL) он структурно всегда `false` — опаздывать нечему.
 *
 *   Сдано     = GREEN|YELLOW и !late
 *   Просрочено = GREEN|YELLOW и late
 *   Не сдано  = RED или UNKNOWN
 *   NEUTRAL   вне счёта (сдавать некого)
 */
function countSubmission(tree: TrafficLightTree): {
  submitted: number
  late: number
  missing: number
  leaves: TrafficLightNode[]
} {
  const parents = new Set(
    tree.nodes.map((n) => n.parent_id).filter((id): id is number => id !== null),
  )
  const leaves = tree.nodes.filter((n) => !parents.has(n.division_id))
  let submitted = 0
  let late = 0
  let missing = 0
  for (const node of leaves) {
    if (node.status === 'RED' || node.status === 'UNKNOWN') missing += 1
    else if (node.status === 'GREEN' || node.status === 'YELLOW') {
      if (node.late) late += 1
      else submitted += 1
    }
  }
  return { submitted, late, missing, leaves }
}

/**
 * Синтетическое дерево светофора — перехват `page.route`, СТЕНД НЕ
 * МУТИРУЕТСЯ. Живой стенд сегодня (2026-08-21, до контрольного часа)
 * вырожден: все листья RED, `late=false` — ветки «Сдано» и «Просрочено»
 * (весь `if (GREEN||YELLOW)` в `classify()`) ни разу не исполнились на
 * реальном ответе, а `UNKNOWN` («Не сдано» из-за сломанного справочника,
 * не из-за красного) — вывод из чтения бэкового `_PRECEDENCE`, а не
 * наблюдаемый факт. Эта фикстура закрывает обе дыры разом.
 *
 * Дерево НАРОЧНО плоское (все узлы без `parent_id` и без детей): каждый
 * узел одновременно и лист (участвует в счётчиках), и верхний уровень
 * (участвует в списке отстающих) — так проверка счёта и проверка списка не
 * зависят одна от другой через вложенность.
 *
 * Узлов «Сдано» — ДВА, узел «Просрочено» — ОДИН (2 ≠ 1) НАМЕРЕННО: красная
 * проба 21.08 нашла, что при 1-к-1 перестановка веток «Сдано»/«Просрочено»
 * меняет, КАКОЙ узел в какой корзине, но не меняет ИТОГОВЫЕ числа корзин —
 * счётчик-ассерт такую порчу не ловит. При 2-к-1 перестановка обязана
 * изменить сумму (стало бы 1 и 2) — тест ловит именно порчу счёта, а не
 * только порчу состава.
 */
const SYNTHETIC_TREE: TrafficLightTree = {
  business_date: '2026-01-15',
  // НАРОЧНО не 17:00:00 живого стенда — доказывает, что подпись контрольного
  // часа на экране берётся из ответа, а не зашита строкой.
  control_hour: '09:30:00',
  nodes: [
    { division_id: 9001, name: 'Синт. департамент зелёный', parent_id: null, status: 'GREEN', late: false },
    { division_id: 9006, name: 'Синт. департамент зелёный-2', parent_id: null, status: 'GREEN', late: false },
    { division_id: 9002, name: 'Синт. департамент жёлтый просроченный', parent_id: null, status: 'YELLOW', late: true },
    { division_id: 9003, name: 'Синт. департамент красный', parent_id: null, status: 'RED', late: false },
    { division_id: 9004, name: 'Синт. департамент сломанный', parent_id: null, status: 'UNKNOWN', late: false },
    { division_id: 9005, name: 'Синт. департамент нейтральный', parent_id: null, status: 'NEUTRAL', late: false },
  ],
}

async function mockTrafficLightTree(page: Page, tree: TrafficLightTree): Promise<void> {
  await page.route(
    (url) => url.pathname.includes('/api/operations/traffic-light/tree/'),
    (route) => route.fulfill({ json: tree }),
  )
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'командный центр' : 'командный центр (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('показатели шапки сходятся с ответами сервера', async ({ page }) => {
    const token = await apiToken()
    const [rows, report] = await Promise.all([events(token), strengthReport(token)])

    const staff = report.rows.reduce((sum, row) => sum + row.staff_total, 0)
    const list = report.rows.reduce((sum, row) => sum + row.list_total, 0)
    expect(list, 'на стенде пустой расход — проба вакуумна').toBeGreaterThan(0)
    expect(report.columns, 'в расходе нет колонки «в строю»').toContain('IN_SERVICE')
    const inService = report.rows.reduce((sum, row) => sum + (row.columns.IN_SERVICE ?? 0), 0)
    const share = `${((inService / list) * 100).toFixed(1).replace('.', ',')}%`

    const active = rows.filter((e) => e.stage !== 'CLOSED')
    const gaps = active.map((e) =>
      e.forceRequests.reduce(
        (sum, r) => sum + Math.max(0, r.requestedCount - r.allocatedCount),
        0,
      ),
    )
    const deficit = gaps.reduce((sum, gap) => sum + gap, 0)
    const deficitEvents = gaps.filter((gap) => gap > 0).length

    await signIn(page)
    await page.goto(`${APP}/security-ops/command-center/`)
    const personnelCard = kpiCard(page, 'Личный состав')
    await expect(personnelCard).toBeVisible({ timeout: 15_000 })

    await expect(personnelCard).toContainText(String(staff))
    await expect(personnelCard).toContainText(`${list} по списку`)
    const inServiceCard = kpiCard(page, 'В строю')
    await expect(inServiceCard).toContainText(String(inService))
    await expect(inServiceCard).toContainText(`${share} списочного`)

    const deficitCard = kpiCard(page, 'Дефицит по ОМ')
    await expect(deficitCard).toContainText(String(deficit))
    await expect(deficitCard).toContainText(
      deficitEvents === 0
        ? 'запросы сил закрыты'
        : `по ${deficitEvents} ${deficitEvents === 1 ? 'мероприятию' : 'мероприятиям'}`,
    )
    await expect(kpiCard(page, 'Активные ОМ')).toContainText(String(active.length))

    // Средняя готовность — подпись ленты, считается по тем же активным ОМ
    const avg = Math.round(
      active.reduce((sum, e) => sum + e.readinessPercent, 0) / active.length,
    )
    await expect(page.getByText(`средняя готовность активных — ${avg}%`)).toBeVisible()

    // Свежесть — от последнего ответа, а не из разметки
    await expect(page.getByText(/данные на \d{2}:\d{2}/)).toBeVisible()
  })

  test('без status.view численность — прочерк с причиной, а не ноль', async ({ page }) => {
    // Персоны «event.view без status.view» на стенде нет (у observer нет и
    // event.view — командный центр он не открыл бы вовсе), поэтому набор прав
    // подменяется ответом сервера: такой список бэк вернуть МОЖЕТ, выдуманного
    // состояния здесь нет.
    await signIn(page)
    await page.route(
      (url) => url.pathname.includes('/api/operations/my-permissions/'),
      (route) => route.fulfill({ json: { permissions: ['event.view'] } }),
    )
    await page.goto(`${APP}/security-ops/command-center/`)

    const personnelCard = kpiCard(page, 'Личный состав')
    await expect(personnelCard).toBeVisible({ timeout: 15_000 })
    await expect(personnelCard).toContainText('нужно право «Статусы: просмотр»')
    await expect(personnelCard).toContainText('—')
    await expect(personnelCard).not.toContainText('по списку')
    // Реестр ОМ правом не закрыт — показатели мероприятий на месте
    await expect(kpiCard(page, 'Активные ОМ')).toBeVisible()
    // Тот же гейт («Статусы: просмотр») закрывает и карточку светофора —
    // её не должно быть в дереве вовсе, не «пусто», не «загрузка».
    await expect(
      page.getByRole('region', { name: 'Расход дня', exact: true }),
    ).toHaveCount(0)
  })

  test('«Расход дня»: счётчики сходятся со светофором, кнопка ждёт бэк-этапа', async ({
    page,
  }) => {
    const token = await apiToken()
    const tree = await trafficLightTree(token)
    expect(tree.nodes.length, 'на стенде пустое дерево светофора — проба вакуумна').toBeGreaterThan(0)

    const { submitted, late, missing, leaves } = countSubmission(tree)
    expect(leaves.length, 'на стенде дерево без листьев — проба вакуумна').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}/security-ops/command-center/`)

    const card = page.getByRole('region', { name: 'Расход дня', exact: true })
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Каждый счётчик — отдельным ассертом против значения, посчитанного из
    // ответа ручки: стенд сейчас вырожденный (все листья RED, late=false —
    // см. отчёт задачи), «не все счётчики нулевые» здесь было бы вакуумно.
    await expect(
      card.locator('[data-metric="submitted"] [data-slot="stat-value"]'),
    ).toHaveText(String(submitted))
    await expect(
      card.locator('[data-metric="missing"] [data-slot="stat-value"]'),
    ).toHaveText(String(missing))
    await expect(
      card.locator('[data-metric="late"] [data-slot="stat-value"]'),
    ).toHaveText(String(late))

    await expect(
      card.locator('[data-metric="submitted"] [data-slot="stat-label"]'),
    ).toHaveText('Сдано')
    await expect(
      card.locator('[data-metric="missing"] [data-slot="stat-label"]'),
    ).toHaveText('Не сдано')
    await expect(
      card.locator('[data-metric="late"] [data-slot="stat-label"]'),
    ).toHaveText('Просрочено')

    // Контрольный час словами — та же формулировка, что у аналитики
    const hour = /^\d{2}:\d{2}/.test(tree.control_hour) ? tree.control_hour.slice(0, 5) : tree.control_hour
    await expect(
      card.getByText(`Контрольный час ${hour} — сдача после него считается опозданием.`, {
        exact: true,
      }),
    ).toBeVisible()

    // Ссылка на аналитику — детальный светофор живёт там
    await expect(card.getByRole('link', { name: 'Открыть светофор в аналитике', exact: true })).toHaveAttribute(
      'href',
      '/security-ops/analytics/',
    )

    // Кнопка — заглушка бэк-этапа: disabled и пояснение рядом, не молча
    const remindButton = card.getByRole('button', { name: 'Напомнить департаментам', exact: true })
    await expect(remindButton).toBeVisible()
    await expect(remindButton).toBeDisabled()
    await expect(
      card.getByText('Рассылка идёт автоматически к контрольному часу; ручная — бэк-этапом.', {
        exact: true,
      }),
    ).toBeVisible()
  })

  test('«Расход дня» на синтетическом дереве: все статусы, late и UNKNOWN — наблюдаемый факт', async ({
    page,
  }) => {
    // Числа считаются ТОЙ ЖЕ функцией, что и в живом тесте выше — не
    // хардкод. Разница только в источнике тела: здесь это перехваченная
    // фикстура, а не живой ответ бэка.
    const { submitted, late, missing, leaves } = countSubmission(SYNTHETIC_TREE)
    expect(leaves.length, 'фикстура должна быть плоской (все узлы — листья)').toBe(
      SYNTHETIC_TREE.nodes.length,
    )
    // НЕвырожденность: в отличие от живого стенда сегодня, три разных
    // статуса дают три разных ненулевых счётчика — и «Сдано» ≠ «Просрочено»
    // числом (2 ≠ 1), см. докстринг фикстуры про красную пробу.
    expect(submitted, '2 узла GREEN(late:false) — «Сдано»').toBe(2)
    expect(late, '1 узел YELLOW(late:true) — «Просрочено»').toBe(1)
    // «Не сдано» = RED(1) + UNKNOWN(1) = 2: если бы UNKNOWN не учитывался
    // (вывод из бэкового _PRECEDENCE перестал бы быть фактом), здесь было
    // бы 1, и ассерт ниже (сравнение с рендером) поймал бы расхождение.
    expect(missing, 'RED(1) + UNKNOWN(1) — обе ветки «Не сдано»').toBe(2)

    await signIn(page)
    await mockTrafficLightTree(page, SYNTHETIC_TREE)
    await page.goto(`${APP}/security-ops/command-center/`)

    const card = page.getByRole('region', { name: 'Расход дня', exact: true })
    await expect(card).toBeVisible({ timeout: 15_000 })

    await expect(
      card.locator('[data-metric="submitted"] [data-slot="stat-value"]'),
    ).toHaveText(String(submitted))
    await expect(
      card.locator('[data-metric="missing"] [data-slot="stat-value"]'),
    ).toHaveText(String(missing))
    await expect(
      card.locator('[data-metric="late"] [data-slot="stat-value"]'),
    ).toHaveText(String(late))

    // Контрольный час — взят из подменённого тела (09:30), а не из живого
    // стенда (17:00) и не зашит строкой в компоненте.
    await expect(
      card.getByText('Контрольный час 09:30 — сдача после него считается опозданием.', {
        exact: true,
      }),
    ).toBeVisible()

    // Отстающие верхнего уровня — РОВНО красный и жёлтый, ни зелёного, ни
    // сломанного (UNKNOWN в список не входит по брифу — только red/yellow),
    // ни нейтрального: список не должен подтащить сдавших.
    const laggingRows = card.locator('ul li')
    await expect(laggingRows).toHaveCount(2)

    const yellowRow = laggingRows.nth(0)
    await expect(yellowRow.locator('span').nth(0)).toHaveText('Синт. департамент жёлтый просроченный')
    await expect(yellowRow.locator('span').nth(1)).toHaveText('сдан, данные разошлись')
    await expect(yellowRow.locator('span').nth(2)).toHaveText('с опозданием')

    const redRow = laggingRows.nth(1)
    await expect(redRow.locator('span').nth(0)).toHaveText('Синт. департамент красный')
    await expect(redRow.locator('span').nth(1)).toHaveText('не сдан')
    await expect(redRow.locator('span')).toHaveCount(2) // нет тега «с опозданием» — late: false

    // Явное отрицание: сдавший, сломанный и нейтральный узлы в список не
    // попали (двух строк выше уже достаточно, но проверка по имени —
    // прямое доказательство, а не вывод из count()).
    await expect(card.getByText('Синт. департамент зелёный', { exact: true })).toHaveCount(0)
    await expect(card.getByText('Синт. департамент зелёный-2', { exact: true })).toHaveCount(0)
    await expect(card.getByText('Синт. департамент сломанный', { exact: true })).toHaveCount(0)
    await expect(card.getByText('Синт. департамент нейтральный', { exact: true })).toHaveCount(0)
  })
})

/** Плитка показателя по её подписи. */
function kpiCard(page: Page, label: string) {
  return page.locator('[data-slot="card"]', { hasText: label }).first()
}
