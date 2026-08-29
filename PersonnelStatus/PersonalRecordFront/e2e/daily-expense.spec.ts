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
 * 4. блок «Суточный свод» — версии СВОДНОГО заявления департамента. У
 *    вьюсета `daily-summaries` (задуманного брифом источника) НЕТ действия
 *    чтения списка версий вовсе (только create/rebuild/freshness/export) —
 *    свод физически ХРАНИТСЯ в ТОЙ ЖЕ таблице/сериализаторе, что обычная
 *    сдача (см. докстринг `DailySummaryViewSet` на бэке), и версии читаются
 *    ЧЕРЕЗ УЖЕ ИЗВЕСТНУЮ `daily-submissions` с точным (не поддеревным)
 *    фильтром `division_id`. Узел свода — НЕ зашитый id, а выведенный из
 *    `GET /api/operations/traffic-light/tree/` (`parent_id` на узел):
 *    кандидат — узел, чей родитель сам корневой; победитель — кандидат с
 *    максимальным ненулевым покрытием управлений борда в своём поддереве
 *    (см. `resolveSummaryDivisionId` ниже, зеркало правила из
 *    `SummaryVersions.tsx`). На живом стенде (21.08.2026) свода ЗА ЛЮБУЮ
 *    дату ещё ни разу не собирали (`count: 0`) — вакуумный гвард честно
 *    уходит в пустое состояние; строчный рендер и ветка «узел не определён»
 *    отдельно проверены перехватом.
 *
 * 🔴 Service worker MSW блокируется: иначе `page.route` (в будущих пробах
 * этого файла) не перехватывал бы запросы приложения.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface EventInvolvement {
  total: number
  group: number
  squad: number
}

interface StrengthReport {
  business_date: string
  rows: {
    division_id: number
    name: string
    list_total: number
    columns: Record<string, number>
    /** Занятость мероприятиями — справочно, вне суммы колонок (Plane №243). */
    event: EventInvolvement
  }[]
  totals: {
    staff_total: number
    list_total: number
    columns: Record<string, number>
    event: EventInvolvement
  }
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
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
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
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

// 🔴 Название управления — не литерал теста: на живом стенде среди них есть
// «Управление (стенд)», и голые скобки в `new RegExp(row.name)` читались бы
// как группа захвата, а не как символы — regex искал бы «Управление» сразу
// перед «стенд» без скобок между ними и не находил бы ничего. Имя экранируем.
function nameRegExp(name: string): RegExp {
  return new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

/**
 * Подпись группы подразделения на борде: «имя · путь» (Plane №235).
 *
 * 🔴 ИМЕНИ НЕ ХВАТАЕТ. Имена подразделений уникальны только внутри родителя,
 * и на структуре из трёх департаментов «Второе сквозное управление» есть в
 * каждом — отбор по имени находил ТРИ элемента и падал строгим режимом. Экран
 * с тех пор печатает путь, и проба адресует строку так же, как её читает
 * человек.
 */
async function divisionLabels(token: string): Promise<Map<string, string>> {
  const rows = await get<{ results: { id: string; name: string; ancestors?: string[] }[] }>(
    token, '/api/ops/daily/divisions/')
  const labels = new Map<string, string>()
  for (const row of rows.results) {
    const path = row.ancestors ?? []
    labels.set(String(row.id), path.length > 0 ? `${row.name} · ${path.join(' › ')}` : row.name)
  }
  return labels
}

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

interface TreeNode {
  division_id: number
  name: string
  parent_id: number | null
}

// Дублируем правило, а не импортируем `features/daily-expense`: та же
// причина, что у `LEADERSHIP_MAX_LEVEL` выше — «use client» React-компонент,
// сборка вне Next.js рискованна и без прецедента в этом файле. Логика
// ОБЯЗАНА зеркалить `resolveSummaryDivisionId` в `SummaryVersions.tsx`:
// кандидат — узел, чей родитель сам корневой (`parent_id === null`);
// победитель — ЕДИНСТВЕННЫЙ кандидат с максимальным ненулевым покрытием
// `boardDivisionIds` в своём поддереве. `null` — «не определён», нарочно
// без угадывания.
function resolveSummaryDivisionId(nodes: TreeNode[], boardDivisionIds: number[]): number | null {
  const rootIds = new Set(nodes.filter((n) => n.parent_id === null).map((n) => n.division_id))
  const candidates = nodes.filter((n) => n.parent_id !== null && rootIds.has(n.parent_id as number))
  if (candidates.length === 0) return null

  const childrenOf = new Map<number, number[]>()
  for (const n of nodes) {
    if (n.parent_id === null) continue
    const list = childrenOf.get(n.parent_id) ?? []
    list.push(n.division_id)
    childrenOf.set(n.parent_id, list)
  }
  function subtreeIds(rootId: number): Set<number> {
    const seen = new Set<number>([rootId])
    const stack = [rootId]
    while (stack.length > 0) {
      const current = stack.pop() as number
      for (const child of childrenOf.get(current) ?? []) {
        if (!seen.has(child)) {
          seen.add(child)
          stack.push(child)
        }
      }
    }
    return seen
  }

  const boardSet = new Set(boardDivisionIds)
  const coverage = candidates.map((c) => {
    const subtree = subtreeIds(c.division_id)
    let count = 0
    for (const id of boardSet) if (subtree.has(id)) count += 1
    return { id: c.division_id, count }
  })
  const maxCoverage = Math.max(...coverage.map((e) => e.count))
  if (maxCoverage === 0) return null
  const winners = coverage.filter((e) => e.count === maxCoverage)
  if (winners.length !== 1) return null
  return winners[0].id
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
    // Каждое управление расхода названо строкой со своим списочным числом.
    // Строка адресуется группой «имя · путь»: одноимённых управлений на
    // стенде трое (Plane №235).
    const labels = await divisionLabels(token)
    for (const row of report.rows) {
      const label = labels.get(String(row.division_id)) ?? row.name
      const group = board.getByRole('group', { name: label, exact: true })
      await expect(group, `группы «${label}» нет на борде`).toHaveCount(1)
      await expect(group.getByRole('button').first()).toContainText(String(row.list_total))
    }
    // Раскрытие первой группы грузит ПОИМЁННЫЙ список этого управления
    const first = report.rows[0]
    const firstLabel = labels.get(String(first.division_id)) ?? first.name
    const employees = await get<{ results: { id: number }[] }>(
      token, `/api/ops/daily/employees/?division_id=${first.division_id}`)
    expect(employees.results.length, 'в управлении нет людей — проба вакуумна').toBeGreaterThan(0)
    const firstGroup = board.getByRole('group', { name: firstLabel, exact: true })
    await firstGroup.getByRole('button').first().click()
    await expect(
      firstGroup.getByRole('region', { name: firstLabel, exact: true }).locator('tbody tr')
    ).toHaveCount(employees.results.length)

    // Честная подпись под списком — verbatim, не подстрокой. Соседний вид
    // того же экрана («Сбор сил») пилюли статусов КРАСИТ, этот — нет, и
    // причина названа вслух, а не оставлена читателю на догадку (ревью ветки
    // 22.08). Ниже — та же практика, что у «Руководства департамента».
    await expect(board.getByText(
      'Статусы в списке показаны одной пилюлей без цвета: коды статусов раздела и колонки расхода — разные пространства кодов, и раскраска между ними была бы придуманным на фронте словарём; появится бэк-этапом.',
      { exact: true }
    )).toBeVisible()
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
    const labels = await divisionLabels(token)
    const firstLabel = labels.get(String(report.rows[0].division_id)) ?? report.rows[0].name
    const firstDivisionButton = board
      .getByRole('group', { name: firstLabel, exact: true })
      .getByRole('button')
      .first()
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
      `/api/operations/statuses/?business_date=${report.business_date}&division_id=${first.division.id}&limit=500`
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

  test('«Суточный свод» — узел выводится СЕРВЕРНЫМ деревом (родитель-корень + макс. покрытие), версии сходятся с живой ручкой', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const businessDate = report.business_date
    const tree = await get<{ nodes: TreeNode[] }>(token, '/api/operations/traffic-light/tree/')
    const boardDivisionIds = report.rows.map((row) => row.division_id)
    const expectedDivisionId = resolveSummaryDivisionId(tree.nodes, boardDivisionIds)

    // Пассивный перехват (route.continue — БЕЗ fulfill): читаем, какой
    // division_id реально ушёл в запросе версий, не подменяя ответ сервера.
    // Предикат по форме запроса (путь + business_date + отсутствие limit)
    // отличает ИМЕННО запрос `SummaryVersions` от сводки борда (несёт
    // limit=200, без business_date-фильтра тут не участвует) и от истории
    // `DaySubmissionPanel` (несёт limit=200, без business_date).
    let capturedUrl: string | null = null
    await page.route(
      (url) =>
        url.pathname === '/api/ops/daily/daily-submissions/' &&
        url.searchParams.get('business_date') === businessDate &&
        url.searchParams.get('limit') === null,
      async (route) => {
        capturedUrl = route.request().url()
        await route.continue()
      }
    )

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })
    const summary = board.getByRole('region', { name: 'Суточный свод' })
    await expect(summary).toBeVisible()

    if (expectedDivisionId === null) {
      // На этом дереве правило не даёт однозначного узла — честная ветка, а
      // не отдельная угадайка теста: запрос версий не должен был уйти вовсе.
      await expect(summary.getByText(
        'Узел суточного свода не определён по структуре подразделений', { exact: true }
      )).toBeVisible()
      await expect(summary.getByRole('listitem')).toHaveCount(0)
      expect(capturedUrl, 'запрос версий ушёл, хотя правило не дало узла').toBeNull()
      return
    }

    await expect.poll(() => capturedUrl).not.toBeNull()
    if (capturedUrl === null) throw new Error('unreachable: expect.poll подтвердил не-null строкой выше')
    const capturedDivisionId = new URL(capturedUrl).searchParams.get('division_id')
    expect(capturedDivisionId, 'запрос версий ушёл не с тем division_id, что вывело правило').toBe(
      String(expectedDivisionId)
    )

    const live = await get<{ results: DailySubmissionRow[] }>(
      token,
      `/api/ops/daily/daily-submissions/?division_id=${expectedDivisionId}&business_date=${businessDate}`
    )
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

  test('«Суточный свод» — строки версии и снимок рендерятся по перехваченному дереву+ответу (2 версии, одна текущая)', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const businessDate = report.business_date
    const realBoardIds = report.rows.map((row) => row.division_id)
    expect(realBoardIds.length, 'на борде нет ни одного управления — пробе не с чем сравнить покрытие').toBeGreaterThan(0)

    // Синтетическое дерево: узел 99 — кандидат (родитель 1, корень) БЕЗ
    // покрытия управлений борда (нулевое покрытие — заведомо НЕ победитель).
    // Узел 42 — тоже кандидат, но его поддерево содержит РЕАЛЬНОЕ первое
    // управление борда — единственный правильный победитель по правилу
    // максимального покрытия. Узел 99 стоит ПЕРВЫМ в массиве специально:
    // ошибка «взять первого кандидата вместо покрытия» выбрала бы 99, и
    // красная проба ниже это ловит.
    const realFirstDivisionId = realBoardIds[0]
    const fakeTree: { nodes: TreeNode[] } = {
      nodes: [
        { division_id: 1, name: 'Служба (проба)', parent_id: null },
        { division_id: 99, name: 'Пустой кандидат (проба)', parent_id: 1 },
        { division_id: 42, name: 'Синтетический департамент (проба)', parent_id: 1 },
        { division_id: realFirstDivisionId, name: report.rows[0].name, parent_id: 42 },
      ],
    }
    const expectedDivisionId = resolveSummaryDivisionId(fakeTree.nodes, realBoardIds)
    expect(expectedDivisionId, 'синтетическое дерево пробы вырождено — проверь фикстуру').toBe(42)
    if (expectedDivisionId === null) throw new Error('unreachable: проверено expect() строкой выше')

    const fakeRows: DailySubmissionRow[] = [
      {
        id: 90001,
        division_id: String(expectedDivisionId),
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
        division_id: String(expectedDivisionId),
        business_date: businessDate,
        version: 1,
        is_current: false,
        event: 'CHANGED',
        submitted_by: 'проба',
        submitted_at: `${businessDate}T09:00:00+05:00`,
        late: false,
      },
    ]

    await page.route(
      (url) => url.pathname === '/api/operations/traffic-light/tree/',
      async (route) => {
        await route.fulfill({
          json: { business_date: businessDate, control_hour: '17:00:00', nodes: fakeTree.nodes },
        })
      }
    )

    // Предикат по ТОЧНОМУ division_id, а не общий: если компонент (из-за
    // сломанного выбора кандидата) отправит ЛЮБОЙ другой id (например, 99),
    // запрос НЕ попадёт под этот роут, уйдёт на живой бэк без синтетических
    // данных — и ассерты на 2 строки/снимок провалятся детерминированно.
    await page.route(
      (url) =>
        url.pathname === '/api/ops/daily/daily-submissions/' &&
        url.searchParams.get('division_id') === String(expectedDivisionId) &&
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
            division_id: expectedDivisionId,
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

  test('«Суточный свод» — узел не определён по дереву (нет кандидатов) — честная строка, запрос версий не уходит', async ({ page }) => {
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
    const businessDate = report.business_date

    // Дерево из ОДНОГО корня без единого ребёнка: кандидатов по правилу
    // (родитель сам корневой) не существует вовсе.
    await page.route(
      (url) => url.pathname === '/api/operations/traffic-light/tree/',
      async (route) => {
        await route.fulfill({
          json: {
            business_date: businessDate,
            control_hour: '17:00:00',
            nodes: [{ division_id: 1, name: 'Служба (проба, без детей)', parent_id: null }],
          },
        })
      }
    )

    let summariesRequested = false
    await page.route(
      (url) =>
        url.pathname === '/api/ops/daily/daily-submissions/' &&
        url.searchParams.get('business_date') === businessDate &&
        url.searchParams.get('limit') === null,
      async (route) => {
        summariesRequested = true
        await route.continue()
      }
    )

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })
    const summary = board.getByRole('region', { name: 'Суточный свод' })
    await expect(summary.getByText(
      'Узел суточного свода не определён по структуре подразделений', { exact: true }
    )).toBeVisible()
    await expect(summary.getByRole('listitem')).toHaveCount(0)

    // Даём сети шанс уйти, если бы компонент ошибочно её отправил, прежде
    // чем читать флаг.
    await page.waitForTimeout(500)
    expect(summariesRequested, 'запрос версий ушёл, хотя узел не определён по дереву').toBe(false)
  })

  test('без status.view борд назван закрытым правом, а не «расход не ответил» — и своих запросов не шлёт', async ({
    page,
  }) => {
    // Персоны «есть вход, но нет status.view» на стенде нет (у admin wildcard
    // `*`), поэтому право снимается перехватом ответа о правах — тот же приём,
    // что в `command-center.spec.ts`. Подменяется ТОЛЬКО список прав; всё
    // остальное живое.
    await page.route(
      (url) => url.pathname.includes('/api/operations/my-permissions/'),
      (route) => route.fulfill({ json: { permissions: ['event.view'] } }),
    )

    // Гейт проверяется НЕ ТОЛЬКО текстом: считаем реальные запросы. Без этого
    // проба прошла бы и на «текст показали, а запросы всё равно ушли и вернули
    // 403» — то есть ровно на том, что чинится.
    //
    // Считаются ручки, которые на этом экране заводит ТОЛЬКО борд:
    // списочная сдача дня и дерево светофора (узел «Суточного свода»).
    // `strength-report` и `staff-units/directorate/` сюда НЕ входят намеренно:
    // их безусловно, вне зависимости от вида экрана, дёргает соседний «Сбор
    // сил» (`hooks/use-forces-gathering.ts`, тот же ключ кэша) — их гейт это
    // отдельный разговор о ДРУГОМ виде, и ассерт на них был бы ассертом не о
    // борде. Именно поэтому текстовая ветка выше проверяется отдельно: даже
    // когда чужой запрос за расходом всё-таки ушёл и вернул 403, борд обязан
    // назвать причиной ПРАВО, а не молчание сервера.
    const closedEndpointCalls: string[] = []
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (
        path === '/api/ops/daily/daily-submissions/' ||
        path === '/api/operations/traffic-light/tree/'
      ) {
        closedEndpointCalls.push(path)
      }
    })

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })

    // Причина названа правом — дословно, тем же оборотом, что у светофора в
    // аналитике («… закрыт правом «Статусы: просмотр».»).
    await expect(
      board.getByText('Ежедневный расход закрыт правом «Статусы: просмотр».', { exact: true }),
    ).toBeVisible()

    // И НЕ названа отказом сервера: до правки 22.08 гейта здесь не было вовсе,
    // 403 приходил в `strength.isError`, и экран печатал «не ответил» —
    // обвинял сервер в нехватке права у читателя.
    await expect(
      board.getByText('Ежедневный расход не ответил — управления показать нечем.', {
        exact: true,
      }),
    ).toHaveCount(0)

    // Даём сети шанс уйти, если бы запросы всё-таки отправились.
    await page.waitForTimeout(1000)
    expect(closedEndpointCalls, 'запрос ушёл в закрытую правом ручку').toEqual([])
  })
})

test.describe(LIVE ? 'расход: занятость ОМ' : 'расход: занятость ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('колонка «На ОМ» показывает занятость мероприятиями и её деление', async ({
    page,
  }) => {
    // Сценарий заказчика (Plane №243): ответственный сводит расход «для
    // участия в ОМ» и отправляет цифру штабу. До этой правки цифры не было
    // вовсе — привлечённые растворялись в «В строю».
    const token = await apiToken()
    const report = await get<StrengthReport>(
      token,
      '/api/operations/strength-report/',
    )
    // Сторож вакуумности: на расходе без единого привлечённого колонка
    // показывает прочерки, и проверять в ней нечего.
    const busy = report.rows.find((row) => row.event.total > 0)
    test.skip(
      busy === undefined,
      'на стенде никто не привлечён на ОМ — колонку проверять не на чем ' +
        '(проставьте статус EVENT_ASSIGNMENT или EVENT_ASSIGNMENT_GROUP)',
    )

    await signIn(page)
    await page.goto(`${APP}/reports/`)
    // Расход на этом экране показывается ПО КНОПКЕ, а не сразу: страница
    // спрашивает дату, и таблицы до нажатия нет вовсе.
    await page.getByRole('button', { name: 'Показать расход' }).click()
    // Ищем по `th`, а не по роли `columnheader`: примитив таблицы задаёт
    // ячейкам блочную раскладку, и неявная роль таблицы при этом теряется —
    // `getByRole('columnheader')` не находит на этом экране НИ ОДНОГО
    // заголовка, включая «Подразделение» (проверено).
    await expect(page.locator('th', { hasText: 'На ОМ' })).toBeVisible({
      timeout: 20_000,
    })

    const row = page.locator('tbody tr').filter({ hasText: busy!.name }).first()
    // Число И его расшифровка: сумма без деления не отвечает на вопрос
    // «группами или нарядом», ради которого счётчик и заводился.
    await expect(row).toContainText(String(busy!.event.total))
    await expect(row).toContainText(`${busy!.event.group} гр.`)
    await expect(row).toContainText(`${busy!.event.squad} нар.`)

    // Занятость НЕ вычтена из «В строю»: человек на мероприятии остаётся в
    // строю, и колонка справочная (Plane №169 и №243).
    expect(busy!.columns.IN_SERVICE).toBeGreaterThanOrEqual(busy!.event.total)
  })
})

test.describe(
  LIVE
    ? 'расход: раскрытие только после сдачи'
    : 'расход: раскрытие только после сдачи (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

    test('несданное управление не раскрывается и говорит дату последней сдачи, сданное раскрывается (Plane №295)', async ({
      page,
    }) => {
      // Требование заказчика: «Список какого-то управления появляется тогда,
      // когда начальник управления обновил свой список и отправил. Рядом
      // управления должна быть дата обновления.»
      //
      // 🔴 ПОЧЕМУ ПЕРЕХВАТ, А НЕ ЖИВЫЕ ДАННЫЕ. Учётка стенда — администратор
      // с «*», а область права сдачи у неё поэтому «всё дерево»: `can_submit`
      // на живом ответе приходит true у КАЖДОГО управления, и запрет
      // раскрытия администратору не показывается никогда (и правильно: своё
      // управление начальник обязан открыть до сдачи). Состояние, которое
      // стережёт эта проба, живёт у ДРУГОЙ роли — сводящего за департамент, —
      // и достижимо только подменой двух ответов: списка подразделений
      // (`can_submit`) и списка сдач дня.
      const token = await apiToken()
      const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
      expect(
        report.rows.length,
        'на борде меньше двух управлений — сданное от несданного не отличить',
      ).toBeGreaterThan(1)
      const submitted = report.rows[0]
      const pending = report.rows[1]
      const businessDate = report.business_date
      const lastMoment = '2026-08-27T18:12:00+05:00'

      // Подразделения: настоящий ответ, у которого сняты права сдачи. Живой
      // ответ берём целиком (`route.fetch`), а не сочиняем: имена и пути в
      // нём — те же, по которым проба адресует группы ниже.
      await page.route(
        (url) => url.pathname === '/api/ops/daily/divisions/',
        async (route) => {
          const real = await route.fetch()
          const body = (await real.json()) as {
            results: { id: string; name: string; ancestors?: string[] }[]
          }
          await route.fulfill({
            json: {
              ...body,
              results: body.results.map((row) => ({
                ...row,
                can_submit: false,
                // Дата последней сдачи — только у одного управления: вторая
                // половина требования («не сдавали ни разу» — это другое
                // состояние, и оно проверяется ниже отдельной строкой).
                last_submitted_at:
                  row.id === String(pending.division_id) ? lastMoment : null,
              })),
            },
          })
        },
      )

      // Сдачи дня: сдано РОВНО одно управление. Предикат — списочный запрос
      // борда (без `division_id`): внутренний запрос панели истории ходит с
      // ним и подменяться не должен.
      const submittedRow: DailySubmissionRow = {
        id: 95001,
        division_id: String(submitted.division_id),
        business_date: businessDate,
        version: 1,
        is_current: true,
        // Событие — из каталога контракта (`DaySubmissionEvent`): выдуманный
        // код парсер списка молча отбрасывает, и сданное управление читалось
        // бы как несданное (поймано на первом прогоне пробы).
        event: 'CHANGED',
        submitted_by: 'проба',
        submitted_at: `${businessDate}T09:30:00+05:00`,
        late: false,
      }
      await page.route(
        (url) =>
          url.pathname === '/api/ops/daily/daily-submissions/' &&
          url.searchParams.get('division_id') === null,
        async (route) => {
          await route.fulfill({
            json: { count: 1, next: null, previous: null, results: [submittedRow] },
          })
        },
      )

      await signIn(page)
      await page.goto(`${APP}/employees?view=daily`)
      const board = page.getByRole('region', { name: 'Ежедневный расход' })
      await expect(board).toBeVisible({ timeout: 25_000 })

      const labels = await divisionLabels(token)
      const pendingLabel = labels.get(String(pending.division_id)) ?? pending.name
      const submittedLabel = labels.get(String(submitted.division_id)) ?? submitted.name

      // ── Несданное ────────────────────────────────────────────────────────
      const pendingGroup = board.getByRole('group', { name: pendingLabel, exact: true })
      const pendingHeader = pendingGroup.getByRole('button').first()
      await expect(pendingHeader).toHaveAttribute('aria-disabled', 'true')
      // `aria-expanded` у нераскрываемой шапки быть НЕ должно: оно обещало бы
      // «свёрнуто, нажми» — и обещало бы ложно.
      await expect(pendingHeader).not.toHaveAttribute('aria-expanded', /.*/)
      await expect(pendingGroup).toContainText('День не сдан')
      await expect(pendingGroup).toContainText('последняя сдача 27.08.2026, 18:12')
      await expect(pendingGroup).toContainText('список раскроется после сдачи')

      // Клик по нераскрываемой шапке НИЧЕГО не открывает: ни области списка,
      // ни строк таблицы. Счётчик запросов `/daily/employees/` тут негоден —
      // соседний вид того же экрана («Сбор сил», `use-forces-gathering`)
      // грузит людей ВСЕХ управлений безусловно, и его запросы неотличимы от
      // запроса борда по одному адресу (замерено: 51 вызов на загрузку).
      await pendingHeader.click({ force: true })
      await expect(
        pendingGroup.getByRole('region', { name: pendingLabel, exact: true }),
      ).toHaveCount(0)
      await expect(pendingGroup.locator('tbody tr')).toHaveCount(0)

      // ── Сданное ──────────────────────────────────────────────────────────
      const submittedGroup = board.getByRole('group', { name: submittedLabel, exact: true })
      const submittedHeader = submittedGroup.getByRole('button').first()
      await expect(submittedHeader).toHaveAttribute('aria-expanded', 'false')
      // Дата обновления — рядом с управлением, как просил заказчик.
      await expect(submittedGroup).toContainText('Обновлено')
      await submittedHeader.click()
      await expect(
        submittedGroup.getByRole('region', { name: submittedLabel, exact: true }),
      ).toBeVisible()
      await expect(
        submittedGroup.locator('tbody tr').first(),
        'сданное управление раскрылось пустым — списка нет',
      ).toBeVisible()
    })
  },
)

test.describe(
  LIVE ? 'расход: порядок категорий' : 'расход: порядок категорий (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

    test('«Руководство департамента» — первой категорией, управления следом и в порядке дерева (Plane №296)', async ({
      page,
    }) => {
      // Требование заказчика: «Список разделен по категориям, сперва
      // Руководство, потом по очерёдно управления со списками.»
      const token = await apiToken()
      const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
      const divisions = await get<{ results: { id: string; name: string; ancestors?: string[] }[] }>(
        token,
        '/api/ops/daily/divisions/',
      )
      const boardIds = new Set(report.rows.map((row) => String(row.division_id)))
      // Ожидаемая очередь — порядок СЕРВЕРНОГО списка подразделений (обход
      // дерева), суженный до управлений борда. Ждать конкретных имён нельзя:
      // структура стенда меняется, а правило — нет.
      const expected = divisions.results
        .filter((row) => boardIds.has(String(row.id)))
        .map((row) => {
          const path = row.ancestors ?? []
          return path.length > 0 ? `${row.name} · ${path.join(' › ')}` : row.name
        })
      expect(
        expected.length,
        'список подразделений не пересёкся с бордом — очередь проверять не на чем',
      ).toBeGreaterThan(1)

      // Сторож вакуумности сравнивает очередь дерева НЕ с алфавитом, а с
      // порядком РАСХОДА — именно его борд показал бы, не наводя очередь
      // сам. Сравнение с алфавитом было бы обманом: расход сортирует по
      // ИМЕНИ, а метка строки — «имя · путь», и алфавит меток от него
      // отличается, из-за чего сторож зеленел при сломанной сортировке
      // (поймано мутацией: снятие сортировки пробу не роняло).
      const labelOf = (divisionId: number): string => {
        const meta = divisions.results.find((row) => String(row.id) === String(divisionId))
        const path = meta?.ancestors ?? []
        const name = meta?.name ?? String(divisionId)
        return path.length > 0 ? `${name} · ${path.join(' › ')}` : name
      }
      const reportOrder = report.rows.map((row) => labelOf(row.division_id))
      expect(
        expected.join('|'),
        'очередь дерева совпала с порядком расхода — проба не отличает одно от другого',
      ).not.toBe(reportOrder.join('|'))

      await signIn(page)
      await page.goto(`${APP}/employees?view=daily`)
      const board = page.getByRole('region', { name: 'Ежедневный расход' })
      await expect(board).toBeVisible({ timeout: 25_000 })
      // «Руководство» — область (`role="region"`), управления — группы:
      // роли разные, и обход разметки берёт обе разом.
      await expect(
        board.getByRole('region', { name: 'Руководство департамента' }),
      ).toBeVisible()

      // Порядок читается ОДНИМ обходом разметки: сравнивать координаты
      // отдельных элементов хрупко, а порядок блоков в DOM — это ровно то,
      // что видит человек сверху вниз.
      const order = await board.evaluate((root) => {
        const blocks = Array.from(
          root.querySelectorAll('[role="group"], [role="region"]'),
        )
        return blocks.map((node) => node.getAttribute('aria-label') ?? '')
      })
      const leadershipAt = order.indexOf('Руководство департамента')
      const firstDivisionAt = order.findIndex((label) => expected.includes(label))
      expect(leadershipAt, 'блока «Руководство департамента» нет в разметке').toBeGreaterThan(-1)
      expect(
        leadershipAt,
        '«Руководство» стоит ПОСЛЕ управлений — порядок категорий нарушен',
      ).toBeLessThan(firstDivisionAt)

      const actual = order.filter((label) => expected.includes(label))
      expect(actual).toEqual(expected)
    })
  },
)

test.describe(
  LIVE
    ? 'расход: отправка свода за департамент'
    : 'расход: отправка свода за департамент (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

    test('кнопка собирает свод, отказ «не все сдали» называет отставших по именам (Plane №297)', async ({
      page,
    }) => {
      // Требование заказчика: «Далее он нажимает на кнопку и отправляет
      // Оперативному дежурному, который сводит за Организацию».
      //
      // 🔴 ПОЧЕМУ ПЕРЕХВАТ ДЕРЕВА. На живом стенде узел свода по правилу не
      // определяется вовсе («Узел суточного свода не определён» — состояние
      // проверено соседней пробой этого файла), а без узла кнопки нет по
      // построению. Дерево подменяется тем же приёмом и тем же правилом, что
      // в пробе версий свода выше.
      //
      // 🔴 ПОЧЕМУ ПЕРЕХВАТ ОТВЕТА НА СБОРКУ. Сборка ПИШЕТ в живой стенд:
      // настоящее нажатие оставило бы за собой версию свода за сегодня,
      // которую следующая проба этого же файла увидела бы как чужое
      // состояние. Проверяется РАЗБОР ответа — то, что делает экран, — а
      // правила сборки покрыты пробами бэка.
      const token = await apiToken()
      const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
      const businessDate = report.business_date
      const realBoardIds = report.rows.map((row) => row.division_id)
      expect(realBoardIds.length, 'на борде нет управлений — свод собирать не из чего').toBeGreaterThan(0)

      const laggard = report.rows[0]
      // Путь в СКОБКАХ — формат ПЕРЕЧИСЛЕНИЯ (как строка «Не сдали» выше), а
      // не шапки группы: «·» внутри списка через запятую читался бы как ещё
      // один элемент (Plane №249).
      const laggardMeta = (
        await get<{ results: { id: string; name: string; ancestors?: string[] }[] }>(
          token,
          '/api/ops/daily/divisions/',
        )
      ).results.find((row) => String(row.id) === String(laggard.division_id))
      const laggardPath = laggardMeta?.ancestors ?? []
      const laggardLabel =
        laggardPath.length > 0
          ? `${laggardMeta?.name} (${laggardPath.join(' › ')})`
          : laggardMeta?.name ?? laggard.name

      const fakeTree: TreeNode[] = [
        { division_id: 1, name: 'Служба (проба)', parent_id: null },
        { division_id: 42, name: 'Синтетический департамент (проба)', parent_id: 1 },
        ...realBoardIds.map((id, index) => ({
          division_id: id,
          name: report.rows[index].name,
          parent_id: 42,
        })),
      ]
      const expectedDivisionId = resolveSummaryDivisionId(fakeTree, realBoardIds)
      expect(expectedDivisionId, 'синтетическое дерево вырождено — проверь фикстуру').toBe(42)

      await page.route(
        (url) => url.pathname === '/api/operations/traffic-light/tree/',
        async (route) => {
          await route.fulfill({
            json: { business_date: businessDate, control_hour: '17:00:00', nodes: fakeTree },
          })
        },
      )
      // Версий свода нет — блок в состоянии «свод ещё не собирался», то самое,
      // из которого кнопку и нажимают.
      await page.route(
        (url) =>
          url.pathname === '/api/ops/daily/daily-submissions/' &&
          url.searchParams.get('division_id') === String(expectedDivisionId),
        async (route) => {
          await route.fulfill({ json: { count: 0, next: null, previous: null, results: [] } })
        },
      )

      // Первое нажатие — отказ «сдали не все», второе — успех. Один роут с
      // счётчиком, а не два: порядок ответов и есть предмет проверки.
      let assembleCalls = 0
      const assembleBodies: unknown[] = []
      await page.route(
        (url) => url.pathname === '/api/operations/daily-summaries/',
        async (route) => {
          assembleCalls += 1
          assembleBodies.push(route.request().postDataJSON())
          if (assembleCalls === 1) {
            await route.fulfill({
              status: 422,
              json: {
                error_code: 'SUMMARY_CHILDREN_NOT_SUBMITTED',
                message: 'Не все подчинённые подразделения сдали день.',
                details: { laggards: [laggard.division_id] },
                request_id: null,
                timestamp: `${businessDate}T10:00:00+05:00`,
              },
            })
            return
          }
          await route.fulfill({
            status: 201,
            json: {
              id: 97001,
              division_id: String(expectedDivisionId),
              business_date: businessDate,
              version: 1,
              is_current: true,
              event: 'CHANGED',
              submitted_by: 'проба',
              submitted_at: `${businessDate}T11:00:00+05:00`,
              late: false,
            },
          })
        },
      )

      await signIn(page)
      await page.goto(`${APP}/employees?view=daily`)
      const board = page.getByRole('region', { name: 'Ежедневный расход' })
      await expect(board).toBeVisible({ timeout: 25_000 })
      const summary = board.getByRole('region', { name: 'Суточный свод' })
      // Адресат назван вслух: «отправить» без адресата не отвечает на вопрос,
      // что случится по нажатию.
      await expect(summary).toContainText('оперативному дежурному')

      const assembleButton = summary.getByRole('button', { name: 'Собрать и отправить свод' })
      await expect(assembleButton).toBeVisible()

      // ── Отказ: отставшие названы ИМЕНАМИ, а не числами ───────────────────
      await assembleButton.click()
      await expect(summary.getByRole('alert')).toContainText(`не сдали ${laggardLabel}`)
      expect(
        assembleBodies[0],
        'тело сборки не совпало с узлом свода и деловым днём',
      ).toEqual({ division_id: expectedDivisionId, business_date: businessDate })

      // ── Успех ─────────────────────────────────────────────────────────────
      await assembleButton.click()
      await expect(summary.getByRole('status')).toContainText('Свод собран и отправлен')
      expect(assembleCalls).toBe(2)
    })

    test('без права «Суточный отчёт: генерация» кнопки нет, а причина названа словами (Plane №297)', async ({
      page,
    }) => {
      // Право сборки свода — СВОЁ (`daily_report.generate`), не то же, что
      // сдача дня управлением: консолидировать эшелон и отмечать статусы у
      // себя разные полномочия. Персоны без него на стенде нет (у admin
      // wildcard `*`), поэтому право снимается перехватом ответа о правах —
      // тот же приём, что у пробы гейта борда выше.
      //
      // Без этой пробы гейт не стережёт никто: основная проба №297 ходит
      // администратором, и мутация «убрать проверку права» её не роняет
      // (проверено — зелёная).
      const token = await apiToken()
      const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
      const realBoardIds = report.rows.map((row) => row.division_id)
      const fakeTree: TreeNode[] = [
        { division_id: 1, name: 'Служба (проба)', parent_id: null },
        { division_id: 42, name: 'Синтетический департамент (проба)', parent_id: 1 },
        ...realBoardIds.map((id, index) => ({
          division_id: id,
          name: report.rows[index].name,
          parent_id: 42,
        })),
      ]
      expect(resolveSummaryDivisionId(fakeTree, realBoardIds)).toBe(42)

      // Права снимаются ТОЛЬКО у сборки свода: `status.view` оставлен, иначе
      // закрылся бы весь борд и блока свода не было бы вовсе — проба
      // проверяла бы пустой экран.
      await page.route(
        (url) => url.pathname.includes('/api/operations/my-permissions/'),
        (route) => route.fulfill({ json: { permissions: ['status.view'] } }),
      )
      await page.route(
        (url) => url.pathname === '/api/operations/traffic-light/tree/',
        async (route) => {
          await route.fulfill({
            json: {
              business_date: report.business_date,
              control_hour: '17:00:00',
              nodes: fakeTree,
            },
          })
        },
      )

      const assembleCalls: string[] = []
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname
        if (path === '/api/operations/daily-summaries/') assembleCalls.push(path)
      })

      await signIn(page)
      await page.goto(`${APP}/employees?view=daily`)
      const board = page.getByRole('region', { name: 'Ежедневный расход' })
      await expect(board).toBeVisible({ timeout: 25_000 })
      const summary = board.getByRole('region', { name: 'Суточный свод' })
      await expect(summary).toBeVisible()

      await expect(
        summary.getByRole('button', { name: 'Собрать и отправить свод' }),
      ).toHaveCount(0)
      await expect(summary).toContainText(
        'Сборка свода закрыта правом «Суточный отчёт: генерация»',
      )
      expect(assembleCalls, 'запрос сборки ушёл без права').toEqual([])
    })
  },
)
