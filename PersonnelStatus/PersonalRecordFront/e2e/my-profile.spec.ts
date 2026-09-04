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
import { anyChiefId } from './stand-chief'
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

  test('сотрудник БЕЗ права на реестр видит СВОИ назначения и отвечает с карточки (Plane №403, №405)', async ({ page }) => {
    /**
     * `[ОЗН-09]`. До правки вкладка ходила за реестром ОМ, а он открыт только
     * держателю `event.view`: рядовому `acc_employee` профиль отвечал «реестр
     * недоступен — назначения не показаны», хотя назначение у него было.
     * Теперь профиль читает `/security-events/my-assignments/` — свои строки
     * по кадровой привязке, без права на чужие мероприятия.
     *
     * Гвард пробы — реестр под той же учёткой по-прежнему 403: иначе «видит
     * свои» было бы неотличимо от «ему открыли всё».
     */
    const password = process.env.ACCESS_MATRIX_PASSWORD ?? ''
    test.skip(password === '', 'нужен ACCESS_MATRIX_PASSWORD — учётки матрицы доступа')

    const admin = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const employeeToken = await tokenFor('acc_employee', password)
    const me = await get<MyEmployee>(employeeToken, '/api/operations/my-employee/')
    expect(me.employee, 'у acc_employee нет кадровой записи — проба вакуумна').not.toBeNull()
    const employeeId = me.employee!.id

    const registry = await fetch(`${API}/api/ops/security-events/`, {
      headers: { Authorization: `Bearer ${employeeToken}` },
    })
    expect(registry.status, 'реестр открыт сотруднику — гвард пробы не работает').toBe(403)

    // Своё назначение — руками admin, тем же путём, что и человек: ОМ →
    // импорт постов → рекогносцировка закрыта → расстановка.
    const post = async (path: string, body?: unknown) =>
      fetch(`${API}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const objects = await get<{ results: { id: string; publishedVersionCount: number }[] }>(
      admin,
      '/api/ops/security-events/bindable-objects/',
    )
    const object = objects.results.find((o) => o.publishedVersionCount > 0)
    expect(object, 'нет объекта с опубликованным паспортом').toBeDefined()
    const created = (await (
      await post('/api/ops/security-events/', {
        title: `Своё назначение (e2e №403) ${Date.now()}`,
        objectId: object!.id,
        businessDate: '2028-06-06',
        kind: 'INTERNAL',
        chiefEmployeeId: await anyChiefId(admin),
      })
    ).json()) as { id: string; code: string }
    const base = `/api/ops/security-events/${created.id}/`
    try {
      const imported = (await (await post(`${base}recon/import-from-passport/`)).json()) as {
        reconChecklist: { done: boolean }[]
        reconSectorPosts: { id: string; sector: string; post: string }[]
      }
      await fetch(`${API}${base}recon/`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          checklist: imported.reconChecklist.map((i) => ({ ...i, done: true })),
          sectorPosts: imported.reconSectorPosts,
        }),
      })
      await post(`${base}recon/complete/`)
      const target = imported.reconSectorPosts[0]
      const assigned = await post(`${base}placement/assign/`, {
        postId: target.id,
        employeeId: String(employeeId),
      })
      expect(assigned.status, await assigned.text()).toBe(200)
      // До «Ознакомления» карточка «готовится» — без кнопок (`[ПРФ-04]`,
      // Plane №434); ответ сотрудника проверяется на согласованной расстановке.
      // Паспорт объекта несёт несколько постов, назначен один — завершение
      // с недобором подтверждается явно, как это делает человек в окне.
      await post(`${base}placement/complete/`, {
        override: true,
        override_reason: 'проба: один пост из расчёта',
      })
      const route = (await (
        await post(`${base}approval/route/`, {
          name: 'Согласующий пробы', unit: 'Управление ОМ', position: 'полковник',
        })
      ).json()) as { approvalRoute: { id: string }[] }
      await post(`${base}approval/send/`)
      await post(`${base}approval/route/${route.approvalRoute[0]!.id}/decide/`, {
        decision: 'APPROVED', comment: '',
      })
      await post(`${base}approval/approve/`)

      // Сервер: своя ручка отдаёт строку, реестр не нужен.
      const mine = await get<{ results: { eventCode: string; assignmentId: string }[] }>(
        employeeToken,
        '/api/ops/security-events/my-assignments/',
      )
      expect(mine.results.map((r) => r.eventCode)).toContain(created.code)

      // Экран: назначение в «Предстоящих», без «реестр недоступен».
      await signIn(page, 'acc_employee', password)
      await page.goto(`${APP}${SCREEN}`)
      await expect(page.getByRole('heading', { name: me.employee!.full_name })).toBeVisible({
        timeout: 20_000,
      })
      const upcoming = page.locator('div').filter({ hasText: /^Предстоящие назначения/ }).first()
      await expect(upcoming.getByText(created.code, { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(`${target.sector} · ${target.post}`).first()).toBeVisible()
      await expect(page.getByText('назначения не показаны')).toHaveCount(0)

      // Plane №405 `[ПРФ-04]`: ответ с карточки. «Не могу заступить» просит
      // причину (кнопка отправки заперта, пока поле пустое), после отправки
      // бейдж красный с причиной, сервер хранит отказ; «Ознакомлен,
      // заступлю» снимает отказ и ставит подтверждение.
      const assignmentId = (
        await get<{ results: { eventCode: string; assignmentId: string }[] }>(
          employeeToken,
          '/api/ops/security-events/my-assignments/',
        )
      ).results.find((r) => r.eventCode === created.code)!.assignmentId
      const card = page.getByTestId(`my-assignment-${assignmentId}`)
      await card.getByRole('button', { name: 'Не могу заступить' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const send = dialog.getByRole('button', { name: 'Отправить отказ' })
      await expect(send).toBeDisabled()
      await dialog.getByLabel('Причина').fill('Командировка по приказу')
      await send.click()
      await expect(dialog).toBeHidden()
      await expect(card.getByText('Не могу заступить: Командировка по приказу')).toBeVisible({
        timeout: 15_000,
      })
      await expect
        .poll(async () => {
          const rows = await get<{ results: { assignmentId: string; declineReason: string | null }[] }>(
            employeeToken,
            '/api/ops/security-events/my-assignments/',
          )
          return rows.results.find((r) => r.assignmentId === assignmentId)?.declineReason ?? null
        })
        .toBe('Командировка по приказу')

      await card.getByRole('button', { name: 'Ознакомлен, заступлю' }).click()
      await expect(card.getByText(/^Ознакомлен: /)).toBeVisible({ timeout: 15_000 })
      await expect(card.getByText('Не могу заступить: Командировка по приказу')).toHaveCount(0)

      // `[ПРФ-05]` (Plane №449): в календаре день ОМ несёт ПОЛОСКУ
      // «ОМ-код · Пост», а не безымянную точку. ОМ пробы стоит в июне 2028 —
      // листаем месяцы стрелкой до него.
      await page.getByRole('button', { name: 'Календарь' }).click()
      const monthTitle = page.getByText(/^Мой календарь · /)
      await expect(monthTitle).toBeVisible({ timeout: 15_000 })
      for (let i = 0; i < 60 && !(await monthTitle.textContent())?.includes('Июнь 2028'); i += 1) {
        await page.getByRole('button', { name: 'Следующий месяц' }).click()
      }
      await expect(monthTitle).toContainText('Июнь 2028')
      // В ячейке — полоски с подписью «ОМ-код · Пост» (до двух, остальное
      // «+N»: стенд копит назначения соседних проб, и своё может оказаться
      // за счётчиком) — ищем СВОЁ в панели дня, куда попадают все.
      await expect(
        page.locator('[data-slot="day-bars"]').getByText(/· Пост/).first(),
        'полосок «ОМ-код · Пост» в ячейках нет',
      ).toBeVisible()
      await page.getByRole('button', { name: /^6 июня 2028 — / }).click()
      await expect(
        page.locator('[data-slot="day-list"]').getByText(`${created.code} · ${target.post}`),
        'назначение пробы не названо «ОМ-код · Пост» в панели дня',
      ).toBeVisible()

      // `[ПРФ-08]` (Plane №449): администратор открывает профиль ЭТОГО
      // сотрудника только на чтение — те же назначения, без кнопок ответа.
      await signIn(page, STAND_USERNAME, STAND_PASSWORD)
      await page.goto(`${APP}${SCREEN}/${employeeId}`)
      await expect(page.getByRole('heading', { name: me.employee!.full_name })).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.locator('[data-slot="read-only"]')).toHaveText('Только чтение')
      const adminCard = page.getByTestId(`my-assignment-${assignmentId}`)
      await expect(adminCard).toBeVisible({ timeout: 15_000 })
      await expect(adminCard.getByRole('button', { name: 'Ознакомлен, заступлю' })).toHaveCount(0)
      await expect(adminCard.getByRole('button', { name: 'Не могу заступить' })).toHaveCount(0)
    } finally {
      // ОМ с расстановкой не удаляется (422) — сначала снять назначения.
      const current = await get<{ placementAssignments: { id: string }[] }>(admin, base)
      for (const row of current.placementAssignments ?? []) {
        await fetch(`${API}${base}placement/${row.id}/`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${admin}` },
        })
      }
      await fetch(`${API}${base}`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } })
    }
  })

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

    // Спецификация `[ПРФ-01]`/`[ПРФ-07]` (Plane №434): блоков-заглушек и
    // круга «рейтинг из 10» нет; вкладки — ровно три.
    for (const gone of ['Требует внимания', 'Закреплённое имущество', 'Допуски и подготовка', 'Чего в профиле нет', 'Готовность к службе']) {
      await expect(page.getByText(gone)).toHaveCount(0)
    }
    const tabs = page.getByRole('navigation', { name: 'Разделы профиля' })
    expect((await tabs.getByRole('button').allInnerTexts()).map((t) => t.trim())).toEqual([
      'Мои назначения',
      'Календарь',
      'История',
    ])
    // Статус — словами, не «действующих статусов нет».
    await expect(page.getByTestId('profile-status')).not.toHaveText(/действующих статусов нет/)
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

    await page.getByRole('button', { name: 'Календарь' }).click()
    // 🔴 ПИН ПРАВЛЕН ОСОЗНАННО (Plane №381). Раньше карточка звалась «Мои
    // периоды» и печатала ВСЕ строки за все годы разом — заказчик назвал это
    // нечитаемым, и список стал разрезом ПОКАЗАННОГО месяца. Сравнивать его с
    // полным ответом ручки больше нельзя: сравнение считалось бы верным
    // только в месяце, в который попали все статусы стенда.
    const periods = page.locator('[data-slot="card"]', { hasText: 'Ближайшие 30 дней' }).first()
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
    // Список — «Ближайшие 30 дней» (`[ПРФ-05]`, Plane №449): статусы, смены
    // и назначения на посты от сегодня вперёд. Статус привлечения на то же
    // ОМ, что и назначение, строкой не дублируется — считаем как экран.
    const todayIso = new Date().toISOString().slice(0, 10)
    const horizon = new Date()
    horizon.setDate(horizon.getDate() + 30)
    const horizonIso = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, '0')}-${String(horizon.getDate()).padStart(2, '0')}`
    const inWindow = (from: string, to: string | null) => (to ?? from) >= todayIso && from <= horizonIso
    const mineAssignments = await get<{
      results: { eventCode: string; businessDate: string; businessDateEnd: string | null }[]
    }>(otherToken, '/api/ops/security-events/my-assignments/')
    const assignedCodes = new Set(mineAssignments.results.map((row) => row.eventCode))
    const expected =
      (statuses.results as (StatusRow & { date_start: string; date_end: string; participations?: { event_code: string }[] })[])
        .filter((row) => inWindow(row.date_start, row.date_end))
        .filter((row) => {
          const event = row.participations?.[0]
          return event === undefined || !assignedCodes.has(event.event_code)
        }).length +
      mineShifts.results.filter((row) => inWindow(row.businessDate, row.businessDate)).length +
      mineAssignments.results.filter((row) => inWindow(row.businessDate, row.businessDateEnd)).length
    if (expected === 0) {
      await expect(periods.getByText('В ближайшие 30 дней ни назначений, ни статусов, ни смен нет.')).toBeVisible()
    } else {
      await expect(periods.getByRole('listitem')).toHaveCount(expected)
    }
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
    await page.getByRole('button', { name: 'Календарь' }).click()

    const periods = page.locator('[data-slot="card"]', { hasText: 'Ближайшие 30 дней' }).first()
    await expect(periods).toBeVisible({ timeout: 20_000 })

    // Клик по дню: панель перестаёт быть списком месяца и называет день.
    await page.getByRole('button', { name: new RegExp(`^${dayNumber} \\S+ \\d{4} — `) }).click()
    const dayCard = page.locator('[data-slot="card"]', { hasText: 'Что назначено на этот день' })
    await expect(dayCard).toBeVisible()
    const dayRows = await dayCard.getByRole('listitem').count()
    expect(dayRows, 'в выбранном дне пусто, хотя статус его покрывает').toBeGreaterThan(0)

    // Возврат к месяцу — той же кнопкой, что предложена на экране.
    await page.getByRole('button', { name: 'Весь месяц' }).click()
    await expect(page.locator('[data-slot="card"]', { hasText: 'Ближайшие 30 дней' })).toBeVisible()
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

  test('«История» — закрытые ОМ со средним баллом, без формы и вооружения (Plane №434)', async ({
    page,
  }) => {
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
        event.placementAssignments.some((a) => String(a.employeeId) === String(employee.id)),
    )

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto(`${APP}${SCREEN}`)
    const tabs = page.getByRole('navigation', { name: 'Разделы профиля' })
    await expect(tabs).toBeVisible({ timeout: 20_000 })
    await tabs.getByRole('button', { name: 'История' }).click()
    const card = page.locator('[data-slot="card"]', {
      has: page.getByText('История заступлений на ОМ'),
    })
    await expect(card).toBeVisible()
    // Шапка «Участие в ОМ: N мероприятий» — число закрытых ОМ по реестру.
    await expect(card.getByTestId('history-summary')).toContainText(
      `Участие в ОМ: ${closedMine.length}`,
    )
    for (const column of ['Дата', 'Мероприятие', 'Объект', 'Пост', 'Ознакомление', 'Балл']) {
      await expect(card).toContainText(column)
    }
    for (const gone of ['Форма одежды', 'Вооружение']) {
      await expect(card).not.toContainText(gone)
    }
    if (closedMine.length > 0) {
      await expect(card).toContainText(closedMine[0]!.code)
    } else {
      await expect(card).toContainText('Закрытых мероприятий с вашим участием нет.')
    }
  })

})
