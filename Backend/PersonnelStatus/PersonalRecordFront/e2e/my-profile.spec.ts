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

/** Месяц, который календарь показывает при открытии, — текущий, в ISO `YYYY-MM`. */
function monthOfToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** Пересекается ли период с показанным месяцем — тем же сравнением ISO-строк,
 *  каким это считает экран. */
function touchesMonth(from: string, to: string, month: string): boolean {
  const start = `${month}-01`
  const end = `${month}-31`
  return from <= end && (to ?? from) >= start
}

/** Сколько строк расстановки принадлежит сотруднику по ответу реестра. */
function assignmentsOf(events: EventRow[], employeeId: number): Assignment[] {
  return events.flatMap((event) =>
    event.placementAssignments.filter(
      (assignment) => String(assignment.employeeId) === String(employeeId),
    ),
  )
}

/** Назначения в ЖИВЫХ мероприятиях — ровно то, что считает бейдж «Предстоящие
 * назначения». Закрытые ОМ в него не входят: они уехали во вкладку «История»
 * (Plane «Реестр ОМ-40»). Пока в реестре не было закрытых ОМ с назначениями
 * admin, разница не проявлялась — после чистки реестра (Plane «Реестр ОМ-34»)
 * проявилась, и общий счёт стал считать не то. */
function activeAssignmentsOf(
  events: EventRow[],
  employeeId: number,
): Assignment[] {
  return assignmentsOf(
    events.filter((event) => event.stage !== 'CLOSED'),
    employeeId,
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
    const active = activeAssignmentsOf(registry.results, employee.id)
    await expect(
      page.getByText(new RegExp(`^${active.length} назначени[ея]?й?$`)),
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

    const statuses = await get<{
      results: (StatusRow & { date_start: string; date_end: string })[]
      next: string | null
    }>(
      otherToken,
      `/api/operations/statuses/?employee_id=${mineAsOther.employee!.id}&limit=200`,
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
    // 🔴 ПИН ПРАВЛЕН ОСОЗНАННО (Plane №381). Раньше карточка звалась «Мои
    // периоды» и печатала ВСЕ строки за все годы разом — заказчик назвал это
    // нечитаемым, и список стал разрезом ПОКАЗАННОГО месяца. Сравнивать его с
    // полным ответом ручки больше нельзя: сравнение считалось бы верным
    // только в месяце, в который попали все статусы стенда.
    const periods = page.locator('[data-slot="card"]', { hasText: 'Периоды за' }).first()
    // 🔴 `limit`, А НЕ `page_size` (в запросе выше). Списки раздела ОМ
    // пагинируются LimitOffsetPagination: `page_size` она игнорирует и молча
    // отдаёт 50 строк. Проба сравнивала «50 из ручки» с полным списком на
    // экране и краснела на ИСПРАВЛЕННОМ клиенте — тот стал ходить по всем
    // страницам (Plane №281/№287, находка ревью). Сторож ниже держит это
    // явно: если строк окажется больше страницы, сравнение снова станет
    // ложным, и проба скажет об этом сама.
    expect(
      statuses.next,
      'статусы не поместились на страницу — сравнение с экраном стало неполным',
    ).toBeFalsy()
    const mineShifts = await get<{ results: { businessDate: string }[] }>(
      otherToken,
      '/api/ops/duty-shifts/mine/',
    )
    const shown = monthOfToday()
    const expected =
      statuses.results.filter((row) => touchesMonth(row.date_start, row.date_end, shown))
        .length + mineShifts.results.filter((row) => row.businessDate.startsWith(shown)).length
    await expect(periods.getByRole('listitem')).toHaveCount(expected)
  })

  test('день календаря открывает свой состав, а список привязан к месяцу', async ({ page }) => {
    // Жалоба заказчика в №381: «по дню нельзя кликнуть» и «список нечитаем».
    // Проба стережёт оба ответа сразу — выбор дня и разрез месяца.
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const me = await get<MyEmployee>(token, '/api/operations/my-employee/')
    const employee = me.employee as CoreEmployee
    const statuses = await get<{ results: (StatusRow & { date_start: string; date_end: string })[] }>(
      token,
      `/api/operations/statuses/?employee_id=${employee.id}&limit=500`,
    )
    const shown = monthOfToday()
    const inMonth = statuses.results.filter((row) =>
      touchesMonth(row.date_start, row.date_end, shown),
    )
    expect(
      inMonth.length,
      'в показанном месяце у стенда нет статусов — проверять выбор дня нечем',
    ).toBeGreaterThan(0)
    // День, в котором заведомо что-то есть: первый день первого такого статуса
    // (или первое число, если статус начался в прошлом месяце).
    const target = inMonth[0].date_start.startsWith(shown)
      ? inMonth[0].date_start
      : `${shown}-01`
    const dayNumber = Number(target.slice(8))

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto(`${APP}${SCREEN}`)
    await page.getByRole('button', { name: 'Мой календарь' }).click()

    const periods = page.locator('[data-slot="card"]', { hasText: 'Периоды за' }).first()
    await expect(periods).toBeVisible({ timeout: 20_000 })

    // Клик по дню: панель перестаёт быть списком месяца и называет день.
    await page.getByRole('button', { name: new RegExp(`^${dayNumber} \\S+ \\d{4} — `) }).click()
    const dayCard = page.locator('[data-slot="card"]', { hasText: 'Что назначено на этот день' })
    await expect(dayCard).toBeVisible()
    const dayRows = await dayCard.getByRole('listitem').count()
    expect(dayRows, 'в выбранном дне пусто, хотя статус его покрывает').toBeGreaterThan(0)

    // Возврат к месяцу — той же кнопкой, что предложена на экране.
    await page.getByRole('button', { name: 'Весь месяц' }).click()
    await expect(page.locator('[data-slot="card"]', { hasText: 'Периоды за' })).toBeVisible()
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

  test('вкладка «История» стоит после «Моей статистики» и несёт пост, форму и вооружение', async ({
    page,
  }) => {
    // Задача заказчика «Реестр ОМ-40»: бокс истории переехал из вкладки
    // «Охранные мероприятия» в свою вкладку ПОСЛЕ «Моей статистики», и в нём
    // появились форма одежды, вооружение и балл.
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const profile = await get<MyEmployee>(token, '/api/operations/my-employee/')
    const employee = profile.employee as CoreEmployee
    const registry = await get<{ results: EventRow[] }>(
      token,
      '/api/ops/security-events/?page_size=100',
    )
    const closedMine = registry.results.filter(
      (event) =>
        event.stage === 'CLOSED' &&
        event.placementAssignments.some(
          (a) => String(a.employeeId) === String(employee.id),
        ),
    )

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto(`${APP}${SCREEN}`)
    const tabs = page.getByRole('navigation', { name: 'Разделы профиля' })
    await expect(tabs).toBeVisible({ timeout: 20_000 })

    // Порядок вкладок — часть требования: «поставь её после Моей статистики».
    const labels = (await tabs.getByRole('button').allInnerTexts()).map((t) =>
      t.trim(),
    )
    expect(labels.indexOf('История')).toBe(labels.indexOf('Моя статистика') + 1)

    // Со старой вкладки блок УШЁЛ — иначе «перенесли» означало бы «скопировали».
    await tabs.getByRole('button', { name: 'Охранные мероприятия' }).click()
    await expect(page.getByText('История заступлений на ОМ')).toHaveCount(0)

    await tabs.getByRole('button', { name: 'История' }).click()
    const card = page.locator('[data-slot="card"]', {
      has: page.getByText('История заступлений на ОМ'),
    })
    await expect(card).toBeVisible()
    for (const column of ['Форма одежды', 'Вооружение', 'Балл']) {
      await expect(card).toContainText(column)
    }

    test.skip(
      closedMine.length === 0,
      'у admin нет закрытых ОМ с назначением — строки истории не проверить',
    )
    // Строка ТОГО САМОГО закрытого ОМ, а не любая: иначе проба зеленела бы на
    // чужой истории.
    await expect(card).toContainText(closedMine[0].code)
  })

})
