/**
 * Аналитика ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на четыре вопроса:
 *
 * 1. показатели шапки, донат и воронка сложены из ТОГО ЖЕ снимка, что и
 *    таблица, а не нарисованы: каждое число сверяется с ответом
 *    `/api/ops/operations-analytics/`;
 * 2. детализация уходит на следующий уровень и берёт КОЛОНКИ этого уровня —
 *    иначе строки поста читались бы под подписями объекта;
 * 3. поиск и порядок применяются к уже полученному снимку и обратимы: порядок
 *    сервера достижим третьим щелчком, а не теряется после первого;
 * 4. отсутствие права `analytics.operations` названо вслух, но НЕзагруженные
 *    права — ещё не отказ (первый кадр не должен быть «недостаточно прав»).
 *
 * 🔴 Service worker MSW блокируется на весь файл: без этого `page.route` не
 * перехватывает запросы приложения (они идут через воркер), и подмена прав
 * ниже молча не применилась бы. Разделу ОМ мок не нужен — он живой.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SCREEN = '/security-ops/analytics/operations'

interface Cell {
  code: string
  value: number | null
}

interface Row {
  rowId: string
  safeLabel: string
  childLevel: string | null
  cells: Cell[]
}

interface Snapshot {
  data: {
    columns: { code: string; safeLabel: string }[]
    rows: Row[]
    lifecycleDistribution: { stateCode: string; safeLabel: string; count: number }[]
    funnel: {
      stages: { stateCode: string; safeLabel: string; values: Record<string, number | null> }[]
      measures: { code: string; safeLabel: string; unit: string }[]
      transitionCount: number
    } | null
    unavailableMeasures: { code: string; label: string; reason: string }[]
  }
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function analytics(token: string, params = ''): Promise<Snapshot> {
  const res = await fetch(`${API}/api/ops/operations-analytics/?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as Snapshot
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

/** Сумма колонки по строкам снимка — тем же правилом, что и на экране. */
function total(rows: Row[], code: string): number {
  return rows.reduce((sum, row) => {
    const cell = row.cells.find((item) => item.code === code)
    return sum + (cell?.value ?? 0)
  }, 0)
}

/**
 * Объект с наибольшим числом мероприятий. Первая строка реестра не годится:
 * на стенде это объект с одним ОМ, и пробы порядка на нём вырождаются в
 * молчаливый skip (тот же приём, что и поиск фикстуры запросом).
 */
function richestObject(rows: Row[]): Row {
  const objects = rows.filter((row) => row.childLevel === 'OBJECT')
  expect(objects.length, 'в снимке нет ни одного объекта').toBeGreaterThan(0)
  return objects.reduce((best, row) =>
    (row.cells.find((c) => c.code === 'EVENTS')?.value ?? 0) >
    (best.cells.find((c) => c.code === 'EVENTS')?.value ?? 0)
      ? row
      : best,
  )
}

/** Плитка показателя по подписи. */
function kpiCard(page: Page, label: string) {
  return page.locator('[data-slot="card"]', { hasText: label }).first()
}

/**
 * Число из плитки БЕЗ пробелов-разделителей. Экран печатает разряды через
 * неразрывный пробел; сравнивать с собственной копией того же форматирования
 * значило бы проверить форматтер самим собой.
 */
async function kpiDigits(page: Page, label: string): Promise<string> {
  const value = kpiCard(page, label).locator('p.text-xl').first()
  return (await value.innerText()).replace(/[\s ]/g, '')
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'аналитика ОМ' : 'аналитика ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('показатели, структура и воронка сходятся со снимком сервера', async ({ page }) => {
    const token = await apiToken()
    const snapshot = await analytics(token, 'level=ALL')
    const { rows, lifecycleDistribution, funnel, unavailableMeasures } = snapshot.data

    const events = total(rows, 'EVENTS')
    expect(events, 'на стенде нет ни одного ОМ — проба вакуумна').toBeGreaterThan(0)
    expect(funnel, 'воронки нет — сверять нечего').not.toBeNull()

    const conduct = lifecycleDistribution.find((b) => b.stateCode === 'CONDUCT')
    const closed = lifecycleDistribution.find((b) => b.stateCode === 'CLOSED')
    expect(conduct, 'в реестре состояний нет «проведения»').toBeDefined()
    expect(closed, 'в реестре состояний нет «закрыто»').toBeDefined()
    const lifecycleTotal = lifecycleDistribution.reduce((sum, b) => sum + b.count, 0)
    const inPreparation = lifecycleTotal - conduct!.count - closed!.count

    const requested = total(rows, 'REQUESTED')
    const allocated = total(rows, 'ALLOCATED')
    expect(requested, 'запросов сил на стенде нет — обеспеченность вакуумна').toBeGreaterThan(0)
    const provision = `${((allocated / requested) * 100).toFixed(1).replace('.', ',')}%`

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    await expect(kpiCard(page, 'Всего мероприятий')).toBeVisible({ timeout: 15_000 })

    expect(await kpiDigits(page, 'Всего мероприятий')).toBe(String(events))
    expect(await kpiDigits(page, 'В подготовке')).toBe(String(inPreparation))
    expect(await kpiDigits(page, 'Проводится')).toBe(String(conduct!.count))
    expect(await kpiDigits(page, 'Закрыто')).toBe(String(closed!.count))
    await expect(kpiCard(page, 'Обеспеченность')).toContainText(provision)
    await expect(kpiCard(page, 'Конфликты')).toBeVisible()

    // Структура — по СОСТОЯНИЯМ: в центре доната стоит их сумма, а не число
    // мероприятий из колонки EVENTS (у одного ОМ состояние ровно одно, но
    // равенство здесь не постулируется — сверяется именно сумма корзин).
    const structure = page.locator('[data-slot="card"]', { hasText: 'Структура мероприятий' }).first()
    await expect(structure.getByRole('img')).toHaveAttribute(
      'aria-label',
      `Всего мероприятий: ${lifecycleTotal}`,
    )
    for (const bucket of lifecycleDistribution) {
      await expect(structure.getByRole('listitem').filter({ hasText: bucket.safeLabel })).toContainText(
        String(bucket.count),
      )
    }

    // Воронка: первый этап и его конверсия — 100% от самого себя.
    const funnelCard = page
      .locator('[data-slot="card"]', { hasText: 'Прохождение этапов подготовки' })
      .first()
    const first = funnel!.stages[0]
    const firstItem = funnelCard.getByRole('listitem').filter({ hasText: first.safeLabel }).first()
    await expect(firstItem).toContainText(String(first.values.REACHED))
    await expect(firstItem).toContainText('конверсия 100,0%')
    await expect(funnelCard).toContainText(`событий — ${funnel!.transitionCount}`)

    // Второй этап конверсией 100% быть НЕ обязан: если бы экран печатал
    // константу, эта проверка её и поймала бы.
    const second = funnel!.stages[1]
    const secondShare = `${(((second.values.REACHED ?? 0) / (first.values.REACHED ?? 1)) * 100)
      .toFixed(1)
      .replace('.', ',')}%`
    await expect(
      funnelCard.getByRole('listitem').filter({ hasText: second.safeLabel }).first(),
    ).toContainText(`конверсия ${secondShare}`)

    // Причины сервера печатаются его же словами, а не пересказом.
    expect(unavailableMeasures.length, 'сервер не назвал ни одного недоступного показателя').toBeGreaterThan(0)
    const missing = page.locator('[data-slot="card"]', { hasText: 'Чего в этой аналитике нет' }).first()
    for (const measure of unavailableMeasures) {
      await expect(missing).toContainText(measure.label)
    }
  })

  test('детализация уходит на уровень ниже и берёт его колонки', async ({ page }) => {
    const token = await apiToken()
    const all = await analytics(token, 'level=ALL')
    const target = richestObject(all.data.rows)
    const objectSnapshot = await analytics(token, `level=OBJECT&object_id=${target.rowId}`)
    const event = objectSnapshot.data.rows.find((row) => row.childLevel === 'EVENT')
    expect(event, 'у объекта нет мероприятий').toBeDefined()
    const eventSnapshot = await analytics(token, `level=EVENT&event_id=${event!.rowId}`)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    const objectsTable = page.locator('[data-slot="card"]', { hasText: 'Аналитика объектов' }).first()
    await expect(objectsTable).toBeVisible({ timeout: 15_000 })

    // Кэш уровня прогревается заранее: на ХОЛОДНОМ переходе снимок уходит в
    // загрузку, таблица размонтируется и поиск сбрасывается сам собой. Дефект
    // виден только на прогретом кэше — там таблица остаётся смонтированной,
    // и сброс обязан делать ключ монтирования.
    await objectsTable
      .getByRole('row')
      .filter({ hasText: target.safeLabel })
      .getByRole('button', { name: 'Детализировать' })
      .click()
    await expect(
      page.locator('[data-slot="card"]', { hasText: 'Мероприятия на объекте' }).first(),
    ).toBeVisible()
    await page.getByRole('navigation', { name: 'Путь детализации' }).getByRole('button', { name: 'Все ОМ' }).click()
    await expect(objectsTable).toBeVisible()

    // Поиск ставится ДО перехода: на следующем уровне он обязан сброситься —
    // иначе фильтр объекта скрыл бы там все мероприятия, и уровень выглядел
    // бы пустым.
    await page.getByRole('textbox', { name: 'Поиск по названию' }).fill(target.safeLabel)
    await expect(objectsTable.locator('tbody tr')).toHaveCount(1)

    await objectsTable
      .getByRole('row')
      .filter({ hasText: target.safeLabel })
      .getByRole('button', { name: 'Детализировать' })
      .click()

    await expect(page).toHaveURL(new RegExp(`object=${target.rowId}(&|$)`))
    await expect(
      page.getByRole('navigation', { name: 'Путь детализации' }).getByRole('button', {
        name: target.safeLabel,
      }),
    ).toBeVisible()
    const eventsTable = page.locator('[data-slot="card"]', { hasText: 'Мероприятия на объекте' }).first()
    await expect(eventsTable.locator('tbody tr')).toHaveCount(objectSnapshot.data.rows.length)

    await eventsTable
      .getByRole('row')
      .filter({ hasText: event!.safeLabel })
      .getByRole('button', { name: 'Детализировать' })
      .click()

    // Уровень мероприятия: свои колонки и карточка ОМ, а не колонки объекта.
    const directionsTable = page
      .locator('[data-slot="card"]', { hasText: 'Направления мероприятия' })
      .first()
    await expect(directionsTable).toBeVisible()
    const headers = directionsTable.locator('thead th')
    for (const column of eventSnapshot.data.columns) {
      await expect(headers.filter({ hasText: column.safeLabel })).toHaveCount(1)
    }
    // Колонок объекта на этом уровне быть не должно: их подписи не совпадают.
    await expect(headers.filter({ hasText: 'Утверждённая потребность' })).toHaveCount(0)
    await expect(page.getByText('Факты мероприятия из его карточки')).toBeVisible()
  })

  test('поиск и порядок правят снимок обратимо', async ({ page }) => {
    const token = await apiToken()
    const all = await analytics(token, 'level=ALL')
    const target = richestObject(all.data.rows)
    const snapshot = await analytics(token, `level=OBJECT&object_id=${target.rowId}`)
    const rows = snapshot.data.rows
    expect(rows.length, 'порядок на двух строках не проверяется').toBeGreaterThan(2)

    const serverFirst = rows[0].safeLabel
    const byAssigned = [...rows].sort(
      (a, b) =>
        (b.cells.find((c) => c.code === 'ASSIGNED')?.value ?? 0) -
        (a.cells.find((c) => c.code === 'ASSIGNED')?.value ?? 0),
    )
    expect(
      byAssigned[0].safeLabel,
      'порядок сервера уже совпал с сортировкой по назначенным — проба вакуумна',
    ).not.toBe(serverFirst)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}?object=${target.rowId}`)
    const table = page.locator('[data-slot="card"]', { hasText: 'Мероприятия на объекте' }).first()
    await expect(table).toBeVisible({ timeout: 15_000 })
    const firstRow = table.locator('tbody tr').first()
    await expect(firstRow).toContainText(serverFirst)

    // Такт сортировки пиним по `aria-sort` самой колонки, а НЕ выводим из
    // порядка строк: строчная проверка между щелчками успевает совпасть на
    // промежуточном кадре, и щелчок, доставленный дважды, проезжал незамеченным
    // (одиночное падение 17.08 — три щелчка, а состояние «убывание»).
    const column = table.locator('th', { hasText: 'Назначено' })
    const header = column.getByRole('button', { name: 'Назначено' })
    await expect(column).toHaveAttribute('aria-sort', 'none')

    await header.click()
    await expect(column).toHaveAttribute('aria-sort', 'descending')
    await expect(firstRow).toContainText(byAssigned[0].safeLabel)

    await header.click()
    await expect(column).toHaveAttribute('aria-sort', 'ascending')
    await expect(firstRow).not.toContainText(byAssigned[0].safeLabel)

    await header.click()
    // Третий щелчок возвращает порядок сервера — иначе «как отдал сервер»
    // становится недостижимым состоянием.
    await expect(column).toHaveAttribute('aria-sort', 'none')
    await expect(firstRow).toContainText(serverFirst)

    // Поиск сужает уже полученные строки, а не перезапрашивает снимок.
    await page.getByRole('textbox', { name: 'Поиск по названию' }).fill(rows[1].safeLabel)
    await expect(table.locator('tbody tr')).toHaveCount(1)
    await expect(table.locator('tbody tr').first()).toContainText(rows[1].safeLabel)
  })

  test('незагруженные права — не отказ, отсутствие права названо вслух', async ({ page }) => {
    await signIn(page)
    // Ответ прав задерживается: пока список не пришёл, экран НЕ имеет права
    // объявлять отказ — иначе первый кадр у любого пользователя «недостаточно
    // прав», а через мгновение экран.
    await page.route(
      (url) => url.pathname.includes('/api/operations/my-permissions/'),
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        await route.fulfill({ json: { permissions: ['event.view'] } })
      },
    )
    await page.goto(`${APP}${SCREEN}`)
    // Сначала — что экран ВООБЩЕ отрисован: пустая страница тоже «скрывает»
    // отказ, и проверка одной лишь скрытости прошла бы на белом экране.
    await expect(page.getByRole('heading', { name: 'Аналитика мероприятий' })).toBeVisible()
    await expect(page.getByText('Недостаточно прав для просмотра аналитики ОМ.')).toBeHidden()
    // А когда права пришли и нужного кода в них нет — отказ назван.
    await expect(page.getByText('Недостаточно прав для просмотра аналитики ОМ.')).toBeVisible({
      timeout: 15_000,
    })
  })
})
