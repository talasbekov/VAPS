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
})

/** Плитка показателя по её подписи. */
function kpiCard(page: Page, label: string) {
  return page.locator('[data-slot="card"]', { hasText: label }).first()
}
