/**
 * Мой профиль на ЖИВОМ стенде.
 *
 * Экран отвечает на один опасный вопрос — «который сотрудник я», и проба
 * стережёт именно его:
 *
 * 1. карточка собрана вокруг ЗАПИСИ СЕРВЕРА (`/api/operations/my-employee/`),
 *    а коды звания, должности и подразделения расшифрованы справочниками;
 * 2. назначения и статусы отобраны по ИДЕНТИФИКАТОРУ этой записи: в реестре
 *    лежат назначения четырёх разных людей, и чужие в профиль попасть не
 *    должны;
 * 3. у другой учётки — другой профиль: связь не «первая попавшаяся запись»;
 * 4. учётка без кадровой записи получает ПРИЧИНУ словами сервера, а не пустые
 *    плитки: нули читались бы как «ничего не было».
 *
 * 🔴 Service worker MSW блокируется на весь файл: без этого перехват запросов
 * не работает, а раздел живой и мок ему не нужен.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SCREEN = '/security-ops/profile'

interface CoreEmployee {
  id: number
  full_name: string
  rank_code: string | null
  position_code: string | null
  division: number | null
  personnel_number: string | null
  hire_date: string | null
}

interface MyEmployee {
  employee: CoreEmployee | null
  unlinked_reason: string | null
}

interface Assignment {
  employeeId: string
  postId: string
  acknowledgedAt: string | null
}

interface EventRow {
  id: string
  code: string
  stage: string
  placementAssignments: Assignment[]
}

interface StatusRow {
  id: number
  employee_id: number
  status_type_code: string
  state: string
}

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return ((await res.json()) as { access: string }).access
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as T
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

/** Сколько строк расстановки принадлежит сотруднику по ответу реестра. */
function assignmentsOf(events: EventRow[], employeeId: number): Assignment[] {
  return events.flatMap((event) =>
    event.placementAssignments.filter(
      (assignment) => String(assignment.employeeId) === String(employeeId),
    ),
  )
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'мой профиль' : 'мой профиль (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('карточка и назначения собраны вокруг СВОЕЙ кадровой записи', async ({ page }) => {
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const me = await get<MyEmployee>(token, '/api/operations/my-employee/')
    expect(me.employee, 'у admin нет кадровой записи — проба вакуумна').not.toBeNull()
    const employee = me.employee as CoreEmployee

    const registry = await get<{ results: EventRow[] }>(
      token,
      '/api/ops/security-events/?page_size=100',
    )
    const mine = assignmentsOf(registry.results, employee.id)
    const all = registry.results.flatMap((event) => event.placementAssignments)
    expect(mine.length, 'у admin нет ни одного назначения — проба вакуумна').toBeGreaterThan(0)
    // Ключевой гвард: в реестре ЕСТЬ чужие назначения. Без них «отобрано по
    // моему id» неотличимо от «показано всё».
    expect(
      all.length,
      'в реестре только мои назначения — фильтр по сотруднику не проверяется',
    ).toBeGreaterThan(mine.length)

    const ranks = await get<{ results: { code: string; name: string }[] }>(
      token,
      '/api/core/ranks/?page_size=200',
    )
    const positions = await get<{ results: { code: string; name: string }[] }>(
      token,
      '/api/core/positions/?page_size=200',
    )
    const divisions = await get<{ results: { id: number; name: string }[] }>(
      token,
      '/api/core/divisions/?page_size=200',
    )
    const rank = ranks.results.find((item) => item.code === employee.rank_code)
    const position = positions.results.find((item) => item.code === employee.position_code)
    const division = divisions.results.find((item) => item.id === employee.division)
    expect(rank, 'звание не разрешается справочником').toBeDefined()
    expect(position, 'должность не разрешается справочником').toBeDefined()

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto(`${APP}${SCREEN}`)
    await expect(page.getByRole('heading', { name: employee.full_name })).toBeVisible({
      timeout: 20_000,
    })

    // Код в карточке заменён подписью справочника, а не напечатан как есть.
    await expect(page.getByText(`${rank!.name} · ${position!.name}`)).toBeVisible()
    await expect(page.getByText(employee.rank_code as string)).toHaveCount(0)
    if (division !== undefined) {
      await expect(page.getByText(division.name).first()).toBeVisible()
    }
    if (employee.personnel_number !== null) {
      await expect(page.getByText(employee.personnel_number).first()).toBeVisible()
    }

    // Назначения: ровно мои, ни одним больше. Счётчик стоит бейджем в шапке
    // карточки; ассерт ТОЧНЫЙ (не подстрока) — «29 назначений» иначе прошло бы
    // и на «129 назначений».
    await expect(
      page.getByText(new RegExp(`^${mine.length} назначени[ея]?й?$`)),
    ).toBeVisible()

    // «Требует внимания»: карточка правой колонки прототипа, у которой в
    // системе ЕСТЬ источник — назначения без подтверждённого ознакомления.
    // Счётчик сверяется с ответом сервера, а не с самим собой; закрытые ОМ в
    // него не входят — подтверждать ознакомление задним числом уже нечем.
    const pending = registry.results
      .filter((event) => event.stage !== 'CLOSED')
      .flatMap((event) =>
        event.placementAssignments.filter(
          (assignment) =>
            String(assignment.employeeId) === String(employee.id) &&
            assignment.acknowledgedAt === null,
        ),
      ).length
    const attention = page.locator('div').filter({ hasText: /^Требует внимания/ }).first()
    await expect(page.getByText('Личные действия и сроки')).toBeVisible()
    await expect(attention).toContainText(String(pending))

    await page.getByRole('button', { name: 'Моя статистика' }).click()
    const stats = page.getByRole('group', { name: 'Показатели службы' })
    await expect(stats).toContainText(String(mine.length))
    const acknowledged = mine.filter((item) => item.acknowledgedAt !== null).length
    await expect(stats).toContainText(`из ${mine.length} назначений`)
    await expect(stats).toContainText(String(acknowledged))
  })

  test('другая учётка получает ДРУГУЮ запись и свои статусы', async ({ page }) => {
    const adminToken = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const otherToken = await tokenFor('erda', 'erda123')
    const mineAsAdmin = await get<MyEmployee>(adminToken, '/api/operations/my-employee/')
    const mineAsOther = await get<MyEmployee>(otherToken, '/api/operations/my-employee/')
    expect(mineAsOther.employee, 'у erda нет кадровой записи — проба вакуумна').not.toBeNull()
    expect(
      mineAsOther.employee!.id,
      'обе учётки указывают на одну запись — связь не проверяется',
    ).not.toBe(mineAsAdmin.employee!.id)

    const statuses = await get<{ results: StatusRow[] }>(
      otherToken,
      `/api/operations/statuses/?employee_id=${mineAsOther.employee!.id}&page_size=200`,
    )
    expect(statuses.results.length, 'у erda нет статусов — вкладка не проверяется').toBeGreaterThan(0)
    for (const row of statuses.results) {
      expect(row.employee_id, 'сервер вернул чужой статус').toBe(mineAsOther.employee!.id)
    }

    await signIn(page, 'erda', 'erda123')
    await page.goto(`${APP}${SCREEN}`)
    await expect(
      page.getByRole('heading', { name: mineAsOther.employee!.full_name }),
    ).toBeVisible({ timeout: 20_000 })
    // Чужая карточка на этом экране не появляется.
    await expect(page.getByText(mineAsAdmin.employee!.full_name)).toHaveCount(0)

    await page.getByRole('button', { name: 'Мой календарь' }).click()
    const periods = page.locator('[data-slot="card"]', { hasText: 'Мои периоды' }).first()
    await expect(periods.getByRole('listitem')).toHaveCount(statuses.results.length)
  })

  test('учётка без кадровой записи получает причину, а не пустой профиль', async ({ page }) => {
    const token = await tokenFor('observer', 'observer123')
    const me = await get<MyEmployee>(token, '/api/operations/my-employee/')
    expect(me.employee, 'у observer появилась кадровая запись — проба вакуумна').toBeNull()
    expect(me.unlinked_reason, 'сервер не назвал причину').toBeTruthy()

    await signIn(page, 'observer', 'observer123')
    await page.goto(`${APP}${SCREEN}`)
    await expect(page.getByText('Кадровая запись не найдена')).toBeVisible({ timeout: 20_000 })
    // Причина печатается СЛОВАМИ СЕРВЕРА, а не пересказом.
    await expect(page.getByText(me.unlinked_reason as string)).toBeVisible()
    // Ни плиток, ни вкладок: пустой профиль читался бы как «службы не было».
    await expect(page.getByRole('group', { name: 'Показатели службы' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Моя статистика' })).toHaveCount(0)
  })
})
