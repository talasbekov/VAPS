/**
 * «Сбор сил на ОМ» (`/employees`) — ЖИВОЙ стенд. С 21.08 экран СЛИТ с
 * реестром личного состава: реестр — первая вкладка, разрез сбора — соседние.
 *
 * Экран сводит три источника, и проба стережёт ровно стыки между ними:
 *
 * 1. знаменатели (штат, список, «в строю») взяты у РАСХОДА — владельца этих
 *    чисел; своего счёта личного состава экран не заводит;
 * 2. «Участие в ОМ» посчитано ПОИМЁННО по статусам, потому что расход этого
 *    не даёт: справочник кладёт `EVENT_ASSIGNMENT` в колонку `IN_SERVICE`;
 * 3. «Осталось в строю» = колонка расхода МИНУС привлечённые — без вычитания
 *    одни и те же люди считались бы дважды;
 * 4. статусы берутся НА ДЕЛОВУЮ ДАТУ: без неё ручка отдаёт все дни подряд, и
 *    завершённое дежружство недельной давности выбивало живого человека из
 *    строя (так и было — поймано живой сверкой 12 против 10).
 *
 * 🔴 Service worker MSW блокируется: иначе `page.route` не перехватывает
 * запросы приложения, и подмены ниже молча не применились бы.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { createOwnEvent, prepareDemandEvent, standCall } from './prepare-events'
import { assertStep } from './fixture-step'
import { uniqueBusinessDate } from './business-date'
import { probeComment } from './probe-statuses'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
// 🔴 `?view=forces` ЯВНО (Plane №273): вид по умолчанию сменился на расход
// организации — решение заказчика о порядке вкладок. Без параметра разрез
// сбора сил не отрисовался бы вовсе.
const SCREEN = '/employees?view=forces'

/**
 * 🔴 ПИН ИЗМЕНЁН ОСОЗНАННО (Plane №486, решение заказчика 04.09.2026).
 * Обоих «Привлечён на мероприятие» больше нет: они слиты в единственный
 * `IN_EVENT`, а различие «наряд / боевая группа» переехало в
 * `participations[].kind_code`. Старые два кода оставлены здесь ЧИТАТЕЛЯМИ —
 * ради строк, не прошедших миграцию на чужом стенде: считать их надо
 * по-прежнему, иначе проба зеленела бы по пустоте.
 */
const IN_EVENT = 'IN_EVENT'
const EVENT_ASSIGNMENT = 'EVENT_ASSIGNMENT'
/** Второй вид участия: специфическая группа (Plane №274, Ш-2/Ш-4). */
const EVENT_ASSIGNMENT_GROUP = 'EVENT_ASSIGNMENT_GROUP'
/** Вид участия боевой группой — теперь он и есть признак «группы». */
const SCREENING_GROUP_KIND = 'SCREENING_GROUP'
const IN_SERVICE_COLUMN = 'IN_SERVICE'

interface StrengthReport {
  business_date: string
  rows: { division_id: number; name: string; list_total: number; columns: Record<string, number> }[]
  totals: {
    staff_total: number
    list_total: number
    columns: Record<string, number>
    event: { total: number; group: number; squad: number }
  }
}

interface StatusRow {
  id: number
  employee_id: number
  status_type_code: string
  state: string
  /** Виды участия строки (Plane №486): «наряд» или «боевая группа». */
  participations?: { event_id: number; kind_code: string; role_code?: string }[]
}

interface DivisionRow {
  id: number
  name: string
  type_code: string
  parent: number | null
}

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
  if (!res.ok) throw new Error(`[фикстура] GET ${path}: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

/** Статусы и справочники ядра отдают ссылки next; большой limit не заменяет обход. */
async function allPages<T>(token: string, path: string): Promise<T[]> {
  const rows: T[] = []
  const visited = new Set<string>()
  let next: string | null = path
  let count = 0
  while (next !== null) {
    expect(visited.has(next), `[фикстура] кольцо пагинации: ${next}`).toBe(false)
    visited.add(next)
    const page: { count: number; next: string | null; results: T[] } = await get(token, next)
    count = page.count
    rows.push(...page.results)
    const url: URL | null = page.next === null ? null : new URL(page.next, API)
    next = url === null ? null : `${url.pathname}${url.search}`
  }
  expect(rows.length, `[фикстура] неполная выдача ${path}`).toBe(count)
  return rows
}

/** Запись через API теми же ручками, что и человек с экрана. Соседка `get`:
 * пробам этого файла нужны обе, а локальные `call` внутри фикстур свои. */
async function send<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`[фикстура] ${method} ${path}: ${res.status} ${await res.text()}`)
  return (await res.json().catch(() => ({}))) as T
}

/** Сначала сохраняется реальная квота управления, затем ему отправляется запрос. */
async function notifyDirectorate(token: string, eventId: string, allocationId: string, divisionId: number) {
  const base = `/api/ops/security-events/${eventId}/forces/allocation/${encodeURIComponent(allocationId)}`
  await send(token, 'POST', `${base}/split/`, {
    rows: [{ divisionId: String(divisionId), need: 1 }],
  })
  const notified = await send<{
    forceAllocation: {
      id: string
      status: string
      directorates: { divisionId: string; need: number; notifiedAt: string | null }[]
    }[]
  }>(token, 'POST', `${base}/notify/`)
  const allocation = notified.forceAllocation.find((row) => row.id === allocationId)
  expect(allocation?.status, '[фикстура] заявка не перешла в NOTIFIED').toBe('NOTIFIED')
  const directorate = allocation!.directorates.find((row) => row.divisionId === String(divisionId))
  expect(directorate?.need).toBe(1)
  expect(directorate?.notifiedAt, '[фикстура] управлению не отправлен запрос').toBeTruthy()
}

/**
 * Привлечённых на дату — ОБА кода участия (Plane №274, Ш-5).
 *
 * 🔴 ПИН ИЗМЕНЁН ОСОЗНАННО. Раньше здесь стоял один `EVENT_ASSIGNMENT`, и это
 * повторяло ошибку экрана, а не проверяло его: разрез «Сбор сил» тоже знал
 * один код, поэтому проба и экран были согласованно неправы. Человек,
 * привлечённый специфической группой, у обоих оказывался «в строю» — то есть
 * свободным для нового привлечения. Считать надо оба кода; сама проба того,
 * что групповое участие доезжает до вкладки, живёт ниже отдельно и САМА
 * сажает такого человека, а не надеется найти его на стенде.
 */
async function assignedCount(
  token: string,
  businessDate: string,
  reportDivisionIds: Set<string>,
): Promise<number> {
  // 🔴 СЧИТАЕМ В ОБЛАСТИ РАСХОДА, а не по всем статусам стенда: расход
  // строится из штатных слотов подразделений, и участие сотрудника, чьё
  // подразделение в расходе не стоит (на стенде — служебная запись без
  // штатного слота), плитка не считает и считать не должна. Раньше помощник
  // складывал все статусы подряд и расходился с плиткой на единицу.
  const assigned = new Set<number>()
  for (const code of [IN_EVENT, EVENT_ASSIGNMENT, EVENT_ASSIGNMENT_GROUP]) {
    const rows = await allPages<StatusRow>(
      token,
      `/api/operations/statuses/?business_date=${businessDate}&status_type_code=${code}&limit=500`,
    )
    for (const row of rows) {
      if (row.state !== 'ACTIVE') continue
      const employee = await get<{ division: number | null }>(token, `/api/core/employees/${row.employee_id}/`)
      if (employee.division !== null && reportDivisionIds.has(String(employee.division))) assigned.add(row.employee_id)
    }
  }
  return assigned.size
}
function reportDivisions(report: StrengthReport): Set<string> {
  return new Set(report.rows.map((row) => String(row.division_id)))
}

/** Свободный сотрудник на серверную дату; next кадровой ручки — номер страницы. */
async function currentParticipationCandidate(token: string, report: StrengthReport) {
  const divisions = await allPages<DivisionRow>(token, '/api/core/divisions/?page_size=200')
  const inScope = reportDivisions(report)
  for (const directorate of divisions.filter((row) => row.type_code === 'directorate')) {
    const department = divisions.find((row) => row.id === directorate.parent && row.type_code === 'department')
    if (department === undefined) continue
    let next: string | null = '1'
    const visited = new Set<string>()
    while (next !== null) {
      expect(visited.has(next), '[фикстура] кольцо страниц сотрудников').toBe(false)
      visited.add(next)
      const people: {
        next: string | null
        results: { id: string; statusCode: string | null }[]
      } = await get(
        token,
        `/api/ops/personnel/?division_id=${directorate.id}&business_date=${report.business_date}&page_size=100&page=${next}`,
      )
      for (const person of people.results) {
        if (person.statusCode !== null) continue
        const employee = await get<{
          division: number | null
          employment_status: string
          hire_date: string | null
          dismissal_date: string | null
        }>(token, `/api/core/employees/${person.id}/`)
        if (employee.division === null || !inScope.has(String(employee.division))) continue
        if (employee.employment_status !== 'working') continue
        if (employee.hire_date !== null && employee.hire_date > report.business_date) continue
        if (employee.dismissal_date !== null && employee.dismissal_date <= report.business_date) continue
        return { employeeId: Number(person.id), department, directorate }
      }
      next = people.next
      if (next !== null) expect(next, '[фикстура] next кадровой ручки — номер страницы').toMatch(/^\d+$/)
    }
  }
  throw new Error('[фикстура] нет свободного на серверную дату сотрудника управления в области расхода')
}

/** Текущее участие принадлежит одной пробе. Общие сиды и старые статусы не меняются. */
async function withCurrentParticipation(
  token: string,
  kindCode: 'PHYSICAL_SQUAD' | 'SCREENING_GROUP',
  check: (own: { employeeId: number; businessDate: string; dateEnd: string }) => Promise<void>,
): Promise<void> {
  const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
  const candidate = await currentParticipationCandidate(token, report)
  const end = new Date(`${report.business_date}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  const dateEnd = end.toISOString().slice(0, 10)
  const comment = probeComment(`Текущее участие сбора сил ${kindCode} ${Date.now()}`)
  let eventId: string | undefined
  let eventTitle: string | undefined
  let allocationId: string | undefined
  let statusId: number | undefined
  let cancelledState: string | undefined
  let roleCode: string | undefined
  try {
    // Физнаряд допускает отложенное ОМ (id=0). Группа требует реального
    // мероприятия, по которому управлению уже отправлен запрос сил.
    if (kindCode === SCREENING_GROUP_KIND) {
      const roles = await get<{
        results: { code: string; groupCode: string | null; isActive: boolean }[]
      }>(token, '/api/ops/dictionaries/EVENT_GROUP_ROLES/entries/')
      const role = roles.results.find((row) => row.isActive && row.groupCode === kindCode)
      expect(role, '[фикстура] нет действующей специальности SCREENING_GROUP в EVENT_GROUP_ROLES').toBeDefined()
      roleCode = role!.code
      expect(roleCode, '[фикстура] у специальности группы пустой код').not.toBe('')
      const call = standCall(token)
      const created = await createOwnEvent(call, token, {
        name: `Текущее групповое участие ${Date.now()}`,
        businessDate: report.business_date,
      })
      eventId = String(created.id)
      eventTitle = created.title
      expect(typeof eventTitle, '[фикстура] собственный ОМ ответил без названия').toBe('string')
      expect(eventTitle).toContain('(e2e)')
      const base = `/api/ops/security-events/${eventId}`
      await call('POST', `${base}/recon/import-from-passport/`)
      const imported = await get<{
        reconChecklist: Record<string, unknown>[]
        reconSectorPosts: Record<string, unknown>[]
      }>(token, `${base}/`)
      expect(imported.reconSectorPosts.length, '[фикстура] паспорт не дал постов').toBeGreaterThan(0)
      await call('PATCH', `${base}/recon/`, {
        checklist: imported.reconChecklist.map((item) => ({
          ...item, state: 'NORMAL', done: true, result: 'MATCHES',
        })),
        sectorPosts: imported.reconSectorPosts.map((post, index) => index === 0 ? { ...post, need: 1 } : post),
      })
      const demand = await call('POST', `${base}/recon/complete/`)
      expect(demand.forceDemandTotal, '[фикстура] нет потребности для запроса сил').toBeGreaterThan(0)
      const allocated = await send<{
        forceAllocation: { id: string; departmentId: string }[]
      }>(token, 'POST', `${base}/forces/allocation/`, {
        rows: [{ departmentId: String(candidate.department.id), need: 1 }],
      })
      const allocation = allocated.forceAllocation.find((row) => row.departmentId === String(candidate.department.id))
      expect(allocation?.id, '[фикстура] собственная заявка не сохранена').toBeTruthy()
      allocationId = allocation!.id
      await notifyDirectorate(token, eventId, allocationId, candidate.directorate.id)
    }
    const expectedParticipation = { event_id: Number(eventId ?? 0), kind_code: kindCode }
    const participation = {
      ...expectedParticipation,
      ...(roleCode === undefined ? {} : { role_code: roleCode }),
    }
    const created = await send<StatusRow & { date_start: string; date_end: string }>(
      token, 'POST', '/api/operations/statuses/', {
        employee_id: candidate.employeeId,
        status_type_code: IN_EVENT,
        date_start: report.business_date,
        date_end: dateEnd,
        comment,
        amendment_reason: comment,
        participations: [participation],
      },
    )
    statusId = created.id
    expect(statusId, '[фикстура] собственный статус ответил без ID').toBeGreaterThan(0)
    expect(created.employee_id).toBe(candidate.employeeId)
    expect(created.date_start).toBe(report.business_date)
    expect(created.date_end).toBe(dateEnd)
    expect(created.state, '[фикстура] участие не действует на текущую серверную дату').toBe('ACTIVE')
    expect(created.participations?.map(({ event_id, kind_code }) => ({ event_id, kind_code }))).toEqual([expectedParticipation])
    expect(created.participations?.[0]?.role_code).toBe(roleCode ?? '')
    const saved = await get<StatusRow>(token, `/api/operations/statuses/${statusId}/`)
    expect(saved.state).toBe('ACTIVE')
    expect(saved.participations?.map(({ event_id, kind_code }) => ({ event_id, kind_code }))).toEqual([expectedParticipation])
    expect(saved.participations?.[0]?.role_code).toBe(roleCode ?? '')
    await check({ employeeId: candidate.employeeId, businessDate: report.business_date, dateEnd })
  } finally {
    const failures: string[] = []
    if (statusId !== undefined) {
      try {
        const cancelled = await send<StatusRow>(token, 'POST', `/api/operations/statuses/${statusId}/cancel/`, {
          reason: comment,
        })
        cancelledState = cancelled.state
        expect(cancelled.state, '[фикстура] собственное участие не отменено').toBe('CANCELLED')
      } catch (error) {
        failures.push(`[фикстура] очистка собственного статуса ${statusId}: ${String(error)}`)
      }
    }
    // DELETE ОМ сохраняет историю оповещений. Оставляем живую ссылку до
    // установленной probe-уборки, которая проверяет ID/название и метку.
    const resources = {
      businessDate: report.business_date, employeeId: candidate.employeeId,
      kindCode, roleCode, comment, statusId, cancelledState, eventId, eventTitle, allocationId,
      eventCleanup: eventId === undefined ? null : 'purge_probe_events by recorded ID/title',
    }
    console.info('[фикстура текущего участия] ' + JSON.stringify(resources))
    await test.info().attach('current-participation-fixture', {
      body: Buffer.from(JSON.stringify(resources, null, 2)),
      contentType: 'application/json',
    })
    if (failures.length > 0) throw new Error(failures.join('\n'))
  }
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

function metric(page: Page, label: string) {
  return page
    .getByRole('group', { name: 'Личный состав на сбор' })
    .locator('[data-slot="stat-card"]')
    .filter({ hasText: label })
    .first()
}


/** ОМ, доведённое до «Потребности»: расчёт постов ушёл штабу числом.
 *
 * Строится ПОД пробу, а не ищется на стенде: лента входящих показывает те ОМ,
 * что кто-то уже мог разложить, и проба «сохранилось» на чужой строке ничего
 * бы не доказала.
 */
/** ОМ на «Расстановке», прошедшее цепочку сбора сил: в составе один человек. */
async function prepareEventOnPlacement(
  token: string,
  options?: { firstPostShift?: string },
): Promise<{
  id: string
  roster: string[]
  employeeId: string
  postId: string
}> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    await assertStep(res, method, path)
    if (!res.ok) throw new Error(`[фикстура] ${method} ${path}: ${res.status} ${await res.text()}`)
    return res.json().catch(() => ({}))
  }
  const businessDate = uniqueBusinessDate()
  const { id, total } = await prepareDemandEvent(token, businessDate, options)
  const base = `/api/ops/security-events/${id}`

  const divisions = await allPages<DivisionRow>(token, '/api/core/divisions/?page_size=200')
  const department = divisions.find((row) => row.type_code === 'department')
  expect(department, '[фикстура] нет департамента').toBeDefined()
  const directorate = divisions.find((row) => row.type_code === 'directorate' && row.parent === department!.id)
  expect(directorate, '[фикстура] у выбранного департамента нет управления').toBeDefined()
  const roster = await call('GET', `/api/ops/personnel/?division_id=${directorate!.id}&business_date=${businessDate}&page_size=1`)
  expect(roster.results.length, '[фикстура] в управлении нет сотрудника').toBe(1)
  const person = roster.results[0]

  const split = await call('POST', `${base}/forces/allocation/`, {
    rows: [{ departmentId: String(department!.id), need: 1 }],
  })
  const allocationId = split.forceAllocation[0].id as string
  await notifyDirectorate(token, id, allocationId, directorate!.id)
  const added = await call('POST', `${base}/forces/allocation/${encodeURIComponent(allocationId)}/members/`, {
    employeeId: person.id,
  })
  expect(added.forceAllocation.find((row: any) => row.id === allocationId)?.members.map((member: any) => member.employeeId))
    .toEqual([String(person.id)])
  const submitted = await call('POST', `${base}/forces/allocation/${encodeURIComponent(allocationId)}/submit/`)
  expect(submitted.forceAllocation.find((row: any) => row.id === allocationId)?.status).toBe('SUBMITTED')
  expect(submitted.forceRoster.map((member: any) => member.employeeId)).toEqual([String(person.id)])
  const accepted = await call('POST', `${base}/forces/allocation/${encodeURIComponent(allocationId)}/accept/`)
  expect(accepted.forceAllocation.find((row: any) => row.id === allocationId)?.status).toBe('ACCEPTED')

  // Стадию никто больше не двигает руками (Plane №110): «Потребность» и
  // «Запрос сил» прошёл сервер на завершении рекогносцировки, и весь сбор
  // выше шёл, пока ОМ уже стояло на «Расстановке». Ручные `demand/approve/`
  // и `forces/complete/` здесь стояли до задачи — теперь они отбились бы
  // «не на этом этапе».
  const placement = await call('GET', `${base}/`)
  if (placement.stage !== 'PLACEMENT') {
    throw new Error(`фикстура не дошла до расстановки: ${JSON.stringify(placement)}`)
  }
  expect(total).toBeGreaterThan(0)
  expect(placement.forceRoster.map((member: any) => member.employeeId)).toEqual([String(person.id)])
  expect(typeof placement.forceRoster[0].name, '[фикстура] состав не несёт имени').toBe('string')
  expect(placement.forceRoster[0].name, '[фикстура] имя в составе пусто').not.toBe('')
  return {
    id,
    roster: placement.forceRoster.map((member: any) => member.name),
    employeeId: String(person.id),
    postId: placement.reconSectorPosts[0].id as string,
  }
}

/**
 * Открыть КАРТОЧКУ СБОРА и вернуть секцию «Разбивка по департаментам»
 * (`[СБС-12]`, Plane №944).
 *
 * Редактор раскладки живёт СТРОКАМИ ТОЙ ЖЕ ТАБЛИЦЫ, что и отправленные
 * запросы (черновые строки с полем «Запрошено», строка кнопок
 * `[data-slot="split-editor"]`): отдельной панели «Правка раскладки» больше
 * нет. Ходим ПО АДРЕСУ (`?tab=collections&collection=<id>`, №779), а не
 * кликами: что вкладка и строка открываются нажатием, стережёт
 * `force-collections.spec.ts`.
 *
 * Доказательство, что карточка ОТКРЫЛАСЬ, а не показывает скелет или отказ, —
 * строка кнопок редактора: у ветки ошибки её нет.
 */
async function openSplitEditor(page: Page, eventId: string) {
  await page.goto(
    `${APP}${SCREEN}&tab=collections&collection=${encodeURIComponent(eventId)}`,
  )
  const section = page.locator('section[aria-labelledby="collection-split-heading"]')
  await expect(
    section.locator('[data-slot="split-editor"]'),
    'карточка сбора не открылась — редактора раскладки на экране нет',
  ).toBeVisible({ timeout: 25_000 })
  return section
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'сбор сил на ОМ' : 'сбор сил на ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('знаменатели взяты у расхода, привлечённые посчитаны по статусам', async ({ page }) => {
    const token = await apiToken()
    await withCurrentParticipation(token, 'PHYSICAL_SQUAD', async ({ businessDate }) => {
      const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
      expect(report.business_date, 'серверная дата изменилась во время подготовки').toBe(businessDate)
      // Плитка считает людей со статусом участия. Расход выбирает одну
      // колонку на человека и при пересечении статусов может считать меньше.
      const assigned = await assignedCount(token, report.business_date, reportDivisions(report))
      expect(
        assigned,
        'статусов участия меньше, чем насчитал расход',
      ).toBeGreaterThanOrEqual(report.totals.event.total)
      const inServiceColumn = report.totals.columns[IN_SERVICE_COLUMN] ?? 0

      expect(report.totals.list_total, 'расход пуст — проба вакуумна').toBeGreaterThan(0)
      expect(assigned, 'на стенде никого не выставили на ОМ — разделение колонки не проверяется').toBeGreaterThan(0)
      // Фикстура обязана РАЗВОДИТЬ штат и список: пока они равны, плитка,
      // взявшая не то поле, показывала бы то же число.
      expect(
        report.totals.staff_total,
        'штат равен списку — плитки «По штату» и «По списку» неотличимы',
      ).not.toBe(report.totals.list_total)

      await signIn(page)
      await page.goto(`${APP}${SCREEN}`)
      // 🔴 ЖДЁМ ЧИСЛО, А НЕ ВИДИМОСТЬ (Plane №582). Плитка появляется в разметке
      // С НУЛЁМ — значение считается из ещё не пришедшего расхода — и становится
      // `visible` РАНЬШЕ данных. Ассерт с умолчанием читал ноль и краснел; на
      // прогретом стенде данные успевали, на холодном нет, отсюда «краснеет
      // через раз». Замерено 04.09.2026: «ожидалось По штату 442, плитка
      // показывала 0», повтор той же пробы — passed за 2,3 с, а API в тот же
      // момент отдавал 442. Сервер был прав, проба спросила экран слишком рано.
      //
      // Своё ожидание у КАЖДОЙ плитки, а не одно на первую: они наполняются из
      // одного запроса, но проверка «первая дождалась — значит все» держится на
      // порядке отрисовки, а он не обещан ничем.
      const shown = (name: string, value: number) =>
        expect(metric(page, name)).toContainText(String(value), { timeout: 25_000 })

      await shown('По штату', report.totals.staff_total)
      await shown('По списку', report.totals.list_total)
      await shown('В строю', inServiceColumn)
      await shown('Участие в ОМ', assigned)
      // Ключевая арифметика экрана: остаток — это колонка МИНУС привлечённые.
      await shown('Осталось в строю', inServiceColumn - assigned)
    })
  })

  test('люди разложены по управлениям, вкладки не пересекаются', async ({ page }) => {
    const token = await apiToken()
    await withCurrentParticipation(token, 'PHYSICAL_SQUAD', async ({ businessDate, employeeId }) => {
      const report = await get<StrengthReport>(token, '/api/operations/strength-report/')
      expect(report.business_date, 'серверная дата изменилась во время подготовки').toBe(businessDate)
      const assigned = await assignedCount(token, report.business_date, reportDivisions(report))
      expect(
        assigned,
        'статусов участия меньше, чем насчитал расход',
      ).toBeGreaterThanOrEqual(report.totals.event.total)
      expect(assigned, 'на стенде нет привлечённых — вкладка пуста, проба вакуумна').toBeGreaterThan(0)

      await signIn(page)
      await page.goto(`${APP}${SCREEN}`)

      // Слитый экран открывается реестром; разрез сбора — за вкладкой с ТЕМ ЖЕ
      // списком, суженным по статусу. Счётчик вкладки — люди из ручки статусов,
      // найденные в реестре: под admin без фильтров сужать список нечему.
      const assignedTab = page.getByRole('tab', { name: /Участие в ОМ/ })
      await expect(assignedTab).toBeVisible({ timeout: 25_000 })
      await expect(assignedTab).toContainText(`(${assigned})`)
      await assignedTab.click()
      await expect(assignedTab).toHaveAttribute('aria-selected', 'true')

      // Люди во вкладке — те же, что вернула ручка статусов, по числу строк:
      // вкладки сбора переиспользуют таблицу реестра, своей разметки нет.
      const panel = page.getByRole('tabpanel')
      const rows = panel.locator('tbody tr')
      await expect(rows).toHaveCount(assigned)

      // Список разложен ПО УПРАВЛЕНИЯМ: хотя бы одно подразделение расхода
      // обязано быть названо на экране.
      const divisionNames = report.rows.map((row) => row.name)
      const shown = await panel.innerText()
      expect(
        divisionNames.some((name) => shown.includes(name)),
        `ни одно подразделение расхода не названо в списке: ${divisionNames.join(', ')}`,
      ).toBe(true)

      // Вторая вкладка — ОСТАЛЬНЫЕ: привлечённый не может стоять в обеих, иначе
      // «осталось» и «отдано» описывали бы одних людей. ФИО берём из aria-label
      // кнопки действий — единственного места в строке, где оно стоит целиком.
      const assignedNames = await panel
        .locator('button[aria-label^="Действия: "]')
        .evaluateAll((buttons) =>
          buttons.map((button) => (button.getAttribute('aria-label') ?? '').replace('Действия: ', '')),
        )
      expect(assignedNames.length, 'ФИО из вкладки не прочитаны — сравнивать нечего').toBe(assigned)
      // 🔴 СВЕРКА ПО ИДЕНТИФИКАТОРУ, а не по ФИО (Plane №251). На стенде в 440
      // человек полные тёзки неизбежны, и сравнение по тексту объявляло «один
      // человек в обеих вкладках» там, где это два разных человека. ФИО
      // остаётся только в сообщении об ошибке — чтобы читать его глазами.
      const assignedIds = await page
        .locator('table tbody tr[data-employee-id]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-employee-id') ?? ''))
      expect(assignedIds.length, 'идентификаторы строк не прочитаны').toBe(assigned)
      expect(assignedIds, 'собственное текущее участие не попало во вкладку').toContain(String(employeeId))
      const inServiceTab = page.getByRole('tab', { name: /В строю/ })
      await inServiceTab.click()
      // 🔴 Ждать ОБЯЗАТЕЛЬНО: без этого innerText читается с ещё не сменившейся
      // панели, и проба сравнивает список привлечённых сам с собой — она падала
      // именно так, показывая «человек в обеих вкладках» там, где его не было.
      // Адрес вкладку больше не хранит (в URL живёт только отбор) — достаточно
      // aria-selected: Radix меняет его и содержимое панели одним коммитом.
      await expect(inServiceTab).toHaveAttribute('aria-selected', 'true')
      const inServiceIds = new Set(
        await page
          .locator('table tbody tr[data-employee-id]')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-employee-id') ?? '')),
      )
      for (const [index, id] of assignedIds.entries()) {
        expect(
          inServiceIds.has(id),
          `${assignedNames[index] ?? id} стоит и в «Участии в ОМ», и в «В строю» — ` +
            'один человек посчитан дважды',
        ).toBe(false)
      }
    })
  })

  test('привлечённый ГРУППОЙ считается выделенным, а не оставшимся в строю', async ({
    page,
  }) => {
    /**
     * Plane №274, Ш-5. Участий в ОМ два — физический наряд и специфическая
     * группа, — а разрез знал только первый. Человек с
     * `EVENT_ASSIGNMENT_GROUP` не попадал в «Участие в ОМ» и попадал в «В
     * строю»: экран показывал его свободным, и его можно было привлечь
     * второй раз.
     *
     * Проба САМА сажает такого человека, а не ищет его на стенде: пока
     * групповых статусов там нет, любая проверка «найди и посмотри» зелена
     * по пустоте. Это ровно тот случай, из-за которого Ш-3 переписывал
     * вакуумную пробу.
     *
     * Ручной ввод с участием разрешён (Plane №737). Собственный запрос сил
     * делает ОМ доступным управлению, а статус начинается на серверную дату.
     * После пробы отменяется только созданная сегодня строка (Plane №322).
     */
    const token = await apiToken()
    await withCurrentParticipation(token, SCREENING_GROUP_KIND, async ({ employeeId, businessDate, dateEnd }) => {
      const refused = await fetch(`${API}/api/operations/statuses/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          // Слитый код (Plane №486): отказ стережётся именно на нём — старый
          // тип погашен и отбился бы раньше, другой ошибкой, и проба перестала
          // бы отвечать на свой вопрос.
          status_type_code: IN_EVENT,
          date_start: businessDate,
          date_end: dateEnd,
        }),
      })
      // 🔴 ЗАПРЕТ СМЕНИЛСЯ ТРЕБОВАНИЕМ (Plane №737, решение заказчика). Ручная
      // постановка участия РАЗРЕШЕНА начальнику управления, но мероприятие
      // назвать обязан: тело без `participations` — по-прежнему 422, только
      // другим кодом. Пин поднят осознанно, а не подогнан: старый код снят
      // вместе со своим raise-сайтом.
      expect(refused.status, 'участие без мероприятия должно отбиваться (Plane №737)').toBe(422)
      expect((await refused.json()).error_code).toBe('PARTICIPATION_EVENT_REQUIRED')

      await signIn(page)
      await page.goto(`${APP}${SCREEN}`)
      const assignedTab = page.getByRole('tab', { name: /Участие в ОМ/ })
      await expect(assignedTab).toBeVisible({ timeout: 25_000 })
      await assignedTab.click()
      await expect(assignedTab).toHaveAttribute('aria-selected', 'true')
      await expect(
        page.locator(`table tbody tr[data-employee-id="${employeeId}"]`),
        'привлечённый группой обязан стоять в «Участии в ОМ»',
      ).toHaveCount(1)

      const inServiceTab = page.getByRole('tab', { name: /В строю/ })
      await inServiceTab.click()
      await expect(inServiceTab).toHaveAttribute('aria-selected', 'true')
      await expect(
        page.locator(`table tbody tr[data-employee-id="${employeeId}"]`),
        'он же не может числиться свободным — иначе его привлекут дважды',
      ).toHaveCount(0)
    })
  })

  test('статусы спрашиваются на деловую дату, а не за все дни', async ({ page }) => {
    // 🔴 Регресс, пойманный живой сверкой: без business_date ручка отдаёт все
    // строки подряд, и ЗАВЕРШЁННЫЙ статус прошлой недели перетирал живое
    // состояние. Проба ловит это со стороны сети — запрос обязан нести дату.
    const token = await apiToken()
    const report = await get<StrengthReport>(token, '/api/operations/strength-report/')

    await signIn(page)
    const asked: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.endsWith('/api/operations/statuses/')) asked.push(url.search)
    })
    await page.goto(`${APP}${SCREEN}`)
    await expect(metric(page, 'По штату')).toBeVisible({ timeout: 25_000 })
    await expect
      .poll(() => asked.length, { timeout: 15_000 })
      .toBeGreaterThan(0)
    expect(
      asked.every((search) => search.includes(`business_date=${report.business_date}`)),
      `запрос статусов ушёл без деловой даты: ${asked.join(' | ')}`,
    ).toBe(true)
  })

  /**
   * 🔴 ПРОБА «НЕДОБОР ПО ЗАЯВКЕ НАЗВАН ПОИМЁННО» СНЯТА ВМЕСТЕ С ТЕМ, ЧТО ОНА
   * СТЕРЕГЛА (Plane №928, решение заказчика).
   *
   * Она подменяла ответ реестра ОМ и искала в ленте штаба строку
   * «По расчёту рекогносцировки · 0 из 5 · не отдано 5». Эти строки рисовались
   * из `event.forceRequests` и жили ТОЛЬКО в снятом блоке «Запрос сил по
   * мероприятиям» — вместе с ним они и ушли с экрана.
   *
   * Инвариант, ради которого проба заводилась («сумма отвечает „сколько не
   * хватает“, строка — „с кого недобрали“»), НЕ осиротел: в карточке сбора его
   * держит `force-collections.spec.ts` — там колонки `[СБС-12]` проверяются у
   * КАЖДОЙ строки департамента (`Запрошено · Выделяют · Прислано`), а сумма —
   * отдельным ассертом по `[data-slot="collection-totals"]`.
   *
   * Переписывать пробу под новый экран значило бы завести второй сторож того
   * же инварианта; оставлять её на старом — сторожить разметку, которой нет.
   */


  test('раскладка: черновик правится, отправка запирает цифру, сумма сверх потребности не отбивается', async ({ page }) => {
    /**
     * `[СБС-12]` (Plane №944): «Запрошено [ввод]» в строке таблицы; «Блокировки
     * на сумму нет» — перебор называется словами, а не отбивается; после
     * «Отправить запросы» цифры заперты, недобор довыделяется НОВОЙ строкой,
     * и довыделение в редактор черновика не попадает (№675).
     */
    const token = await apiToken()
    const { id, total } = await prepareDemandEvent(token)
    expect(total, 'у пробного ОМ потребность меньше двух — делить нечего').toBeGreaterThan(1)
    const departments = await allPages<DivisionRow>(
      token,
      '/api/core/divisions/?page_size=200',
    )
    const department = departments.find((row) => row.type_code === 'department')
    expect(department, 'в справочнике стенда нет департамента — выбирать нечего').toBeTruthy()

    await signIn(page)
    const section = await openSplitEditor(page, id)

    await section.getByRole('button', { name: 'Департамент', exact: true }).click()
    await section.getByLabel('Департамент, строка 1', { exact: true }).selectOption(String(department!.id))
    await section.getByLabel('Сколько человек, строка 1', { exact: true }).fill(String(total + 1))
    // Сверх потребности — факт на экране, не ошибка.
    await expect(section.locator('[data-slot="forces-split-total"]')).toContainText(
      `сверх потребности 1`,
    )
    await section.getByRole('button', { name: 'Сохранить черновик' }).click()
    await expect(section.getByText('Черновик сохранён')).toBeVisible({ timeout: 20_000 })

    // Черновик живёт НА СЕРВЕРЕ и правится: после перезагрузки поле на месте
    // с той же цифрой — значит, департаменту он ещё не ушёл.
    await page.reload()
    const saved = await openSplitEditor(page, id)
    await expect(saved.getByLabel('Сколько человек, строка 1', { exact: true })).toHaveValue(
      String(total + 1),
      { timeout: 25_000 },
    )
    await saved.getByLabel('Сколько человек, строка 1', { exact: true }).fill(String(total - 1))
    await saved.getByRole('button', { name: 'Отправить запросы' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(`Запрошено ${total - 1} при потребности ${total}`)
    await dialog.getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(saved.getByText('Запросы отправлены департаментам')).toBeVisible({ timeout: 20_000 })

    // Отправленная строка — ТОЛЬКО ДЛЯ ЧТЕНИЯ: поля ввода у неё нет.
    await expect(saved.getByLabel('Сколько человек, строка 1', { exact: true })).toHaveCount(0)
    await expect(saved.locator('[data-slot="department-status"]').first()).toContainText(
      'Запрос отправлен',
    )

    // Довыделение (`[СБС-12]`) — новая строка; в редактор черновика она не
    // попадает (Plane №675).
    const state = await get<{ forceAllocation: { id: string }[] }>(
      token,
      `/api/ops/security-events/${id}/`,
    )
    const allocationId = state.forceAllocation[0]!.id
    const directorate = departments.find((row) => row.type_code === 'directorate' && row.parent === department!.id)
    expect(directorate, 'у департамента нет управления — оповещать некого').toBeDefined()
    await notifyDirectorate(token, id, allocationId, directorate!.id)
    const topped = await send<{ forceAllocation: { id: string; topUpOf?: string | null }[] }>(
      token,
      'POST',
      `/api/ops/security-events/${id}/forces/allocation/${allocationId}/top-up/`,
      { count: 1 },
    )
    expect(
      topped.forceAllocation.filter((row) => row.topUpOf).length,
      'довыделенная строка не завелась — проверять нечего',
    ).toBe(1)

    await page.reload()
    const afterTopUp = await openSplitEditor(page, id)
    await expect(afterTopUp.locator('[data-slot="department-row"]')).toHaveCount(2, { timeout: 25_000 })
    await expect(afterTopUp.getByText('довыделение', { exact: false })).toBeVisible()
    await expect(
      afterTopUp.getByLabel('Департамент, строка 1', { exact: true }),
      'довыделенная строка попала в редактор черновика',
    ).toHaveCount(0)
  })

  // Проба «оповещение управлений видно у заявки» СНЯТА (Plane №944): по
  // спецификации `[СБС-22]` управления оповещает ОТВЕТСТВЕННЫЙ ДЕПАРТАМЕНТА со
  // своей карточки, и на экране штаба этой кнопки больше нет. Правило №557
  // («момент только у управления с квотой») стережёт
  // `department-requests.spec.ts` и `test_ops_forces_gathering.py`.

  test('неполная строка раскладки не даёт открыть диалог отправки', async ({ page }) => {
    /**
     * Ревью №825 по №944 (08.09.2026): строка «+ Департамент» без выбранного
     * департамента попадала в диалог «Отправить запросы?» как «— департамент
     * не выбран —» с активной «Отправить»; сервер отвечал ошибкой формы по
     * позиции, а она рисовалась ПОД таблицей — за диалогом. Человек видел
     * диалог без реакции. Теперь кнопка «Отправить запросы» гаснет, пока у
     * строки нет департамента или число меньше единицы, и называет причину.
     *
     * КРАСНАЯ ПРОБА: убери `incompleteRow` из `disabled` — кнопка активна.
     */
    const token = await apiToken()
    const { id } = await prepareDemandEvent(token, '2027-06-01')
    await signIn(page)
    const section = await openSplitEditor(page, id)
    await section.getByRole('button', { name: 'Департамент', exact: true }).click()

    const send = section.getByRole('button', { name: 'Отправить запросы' })
    await expect(send, 'строка без департамента, а «Отправить запросы» активна').toBeDisabled()
    await expect(send).toHaveAttribute('title', /департамент/)
    await page.screenshot({ path: 'smoke-results/split-incomplete-row.png', fullPage: true })

    await section.getByLabel('Департамент, строка 1', { exact: true }).selectOption({ index: 1 })
    await section.getByLabel('Сколько человек, строка 1', { exact: true }).fill('0')
    await expect(send, 'число меньше единицы, а кнопка активна').toBeDisabled()
    await section.getByLabel('Сколько человек, строка 1', { exact: true }).fill('1')
    await expect(send).toBeEnabled()
  })

  test('цепочка сбора сил доходит до состава мероприятия', async ({
    page,
  }) => {
    /**
     * `[СБС-01]`/`[СБС-13]` (Plane №944): штаб отправляет запросы с экрана,
     * департамент отвечает и присылает список (здесь — ручками API, его экран
     * стережёт `department-requests.spec.ts`), и присланные люди появляются в
     * блоке «Собранные сотрудники → объекты» БЕЗ отдельного «Принять в
     * мероприятие». Возврат списка с причиной — с экрана штаба — забирает
     * людей из состава.
     */
    const token = await apiToken()
    // Мероприятие БУДУЩЕЙ датой: статус привлечения тогда ещё не начался.
    const businessDate = uniqueBusinessDate()
    const { id } = await prepareDemandEvent(token, businessDate)
    const departments = await allPages<DivisionRow>(
      token,
      '/api/core/divisions/?page_size=200',
    )
    const department = departments.find((row) => row.type_code === 'department')
    expect(department, 'в справочнике стенда нет департамента').toBeDefined()
    const directorate = departments.find(
      (row) => row.type_code === 'directorate' && row.parent === department!.id,
    )
    expect(directorate, 'у департамента стенда нет управления — выделять некому').toBeTruthy()
    const people = await get<{ count: number; results: { id: string; name: string; statusCode: string | null }[] }>(
      token,
      `/api/ops/personnel/?division_id=${directorate!.id}&business_date=${businessDate}&page_size=8`,
    )
    expect(people.count, 'в управлении стенда нет людей — выделять некого').toBeGreaterThan(0)

    await signIn(page)
    const section = await openSplitEditor(page, id)
    await section.getByRole('button', { name: 'Департамент', exact: true }).click()
    await section.getByLabel('Департамент, строка 1', { exact: true }).selectOption(String(department!.id))
    await section.getByRole('button', { name: 'Отправить запросы' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click()
    await expect(section.getByText('Запросы отправлены департаментам')).toBeVisible({ timeout: 20_000 })

    // Департамент (по API): оповестить управления, выделить одного, отправить.
    const state = await get<{ forceAllocation: { id: string }[] }>(token, `/api/ops/security-events/${id}/`)
    const allocationId = state.forceAllocation[0]!.id
    await notifyDirectorate(token, id, allocationId, directorate!.id)
    const candidate = people.results.find((person) => person.statusCode === null)
    expect(candidate, 'не нашлось ни одного свободного на свою дату ОМ').toBeDefined()
    const added = await send<{ forceAllocation: { id: string; members: { employeeId: string }[] }[] }>(
      token,
      'POST',
      `/api/ops/security-events/${id}/forces/allocation/${encodeURIComponent(allocationId)}/members/`,
      { employeeId: candidate!.id },
    )
    expect(added.forceAllocation.find((row) => row.id === allocationId)?.members.map((member) => member.employeeId))
      .toEqual([String(candidate!.id)])

    // Человек получил СТАТУС, а не только строку в списке.
    const statuses = await allPages<StatusRow>(
      token,
      `/api/operations/statuses/?business_date=${businessDate}&employee_id=${candidate!.id}&status_type_code=${IN_EVENT}&limit=200`,
    )
    expect(
      statuses.some((row) => (row.participations ?? []).some((participation) => participation.event_id === Number(id))),
      'у выбранного сотрудника нет статуса участия в своём ОМ на его дату',
    ).toBe(true)

    const submitted = await send<{
      error_code?: string
      forceAllocation: { id: string; status: string }[]
      forceRoster: { employeeId: string }[]
    }>(
      token,
      'POST',
      `/api/ops/security-events/${id}/forces/allocation/${encodeURIComponent(allocationId)}/submit/`,
    )
    expect(submitted.error_code, 'отправка списка не прошла').toBeUndefined()
    expect(submitted.forceAllocation.find((row) => row.id === allocationId)?.status).toBe('SUBMITTED')
    expect(submitted.forceRoster.map((m) => m.employeeId), 'присланный не попал в состав').toEqual([
      String(candidate!.id),
    ])

    // Блок 3 появился с первым присланным списком — без «Принять».
    await page.reload()
    const card = await openSplitEditor(page, id)
    const block = page.locator('section[aria-labelledby="roster-objects-heading"]')
    await expect(block).toBeVisible({ timeout: 25_000 })
    await expect(block).toContainText('Прислано 1 из')
    await expect(card.locator('[data-slot="department-status"]').first()).toContainText('Список прислан')

    // Возврат с причиной — с экрана штаба; люди уходят из состава.
    await card.getByRole('button', { name: 'Вернуть департаменту' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Вернуть', exact: true })).toBeDisabled()
    await dialog.getByLabel('Причина возврата').fill('Нужны люди с допуском')
    await dialog.getByRole('button', { name: 'Вернуть', exact: true }).click()
    await expect(card.getByText('Возвращено: Нужны люди с допуском')).toBeVisible({ timeout: 20_000 })
    await expect(block).toHaveCount(0)

    // Повторная отправка возвращает людей в состав.
    const again = await send<{
      error_code?: string
      forceAllocation: { id: string; status: string }[]
      forceRoster: { employeeId: string }[]
    }>(
      token,
      'POST',
      `/api/ops/security-events/${id}/forces/allocation/${encodeURIComponent(allocationId)}/submit/`,
    )
    expect(again.error_code).toBeUndefined()
    expect(again.forceAllocation.find((row) => row.id === allocationId)?.status).toBe('SUBMITTED')
    expect(again.forceRoster.map((member) => member.employeeId)).toEqual([String(candidate!.id)])
  })

  test('расстановка предлагает СОСТАВ мероприятия, а не весь кадровый список', async ({
    page,
  }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    expect(prepared.roster.length, 'состав пуст — предлагать нечего').toBe(1)
    // Сторож: в кадрах людей БОЛЬШЕ, чем в составе, иначе «панель показывает
    // только состав» неотличимо от «показывает всех».
    const all = await get<{ count: number }>(token, '/api/ops/personnel/?page_size=1')
    expect(all.count, 'в кадрах не больше одного человека — проба вакуумна').toBeGreaterThan(1)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Расстановка', { timeout: 25_000 })
    await expect(main).toContainText(`Состав мероприятия: ${prepared.roster.length} чел.`)
    await expect(main).toContainText('Кандидаты — люди, принятые штабом')
    // Ни одного постороннего: имена в панели подбора — ровно состав.
    await expect(main).toContainText(prepared.roster[0])
  })

  test('назначенный на пост назван подразделением и статусом дня', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const assigned = await fetch(
      `${API}/api/ops/security-events/${prepared.id}/placement/assign/`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
      },
    )
    expect(assigned.status, 'человек из состава не встал на пост').toBe(200)
    const row = ((await assigned.json()) as any).placementAssignments[0]
    // Сторож фикстуры СТРОГИЙ по типу: `not.toBe('')` и `not.toBeNull()`
    // проходят на `undefined`, то есть на ответе сервера, который этих полей
    // не отдаёт вовсе, — так проба и зеленела против стенда, поднятого до
    // правки сериализатора.
    expect(typeof row.divisionName, 'сервер не отдал divisionName').toBe('string')
    expect(row.divisionName, 'подразделение пустое — проверять нечего').not.toBe('')
    expect(typeof row.statusLabel, 'сервер не отдал statusLabel').toBe('string')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Расстановка', { timeout: 25_000 })
    // Подразделение спрашивается У ОТВЕТА, а не у управления фикстуры: человек
    // числится в ОТДЕЛЕ внутри управления, и совпадение имён было бы случайным.
    await expect(main).toContainText(row.divisionName as string)
    await expect(main).toContainText(row.statusLabel as string)
  })

  test('кандидат в подборе назван статусом дня, а занятый — занятым', async ({
    page,
  }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    // Сторож: состав отдаёт статус, иначе бейдж внизу проверял бы подпись
    // «в строю», которую клиент печатает и на пустом ответе.
    const card = await get<any>(token, `/api/ops/security-events/${prepared.id}/`)
    const member = card.forceRoster[0]
    expect(typeof member.statusLabel, 'состав не несёт статуса дня').toBe('string')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Расстановка', { timeout: 25_000 })
    await expect(main).toContainText(member.statusLabel as string)
    // Занятость подписывается только ПОСЛЕ назначения — иначе строка была бы
    // на экране всегда и ничего не значила.
    await expect(main).not.toContainText('уже назначен на пост этого мероприятия')

    // Шаг-переход: отбитое назначение оставило бы человека НЕ на посту, и всё
    // ниже проверяло бы не то, что написано (Plane №812).
    await assertStep(
      await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
      }),
      'POST',
      `/api/ops/security-events/${prepared.id}/placement/assign/`,
    )
    await page.reload()
    await expect(main).toContainText('уже назначен на пост этого мероприятия', {
      timeout: 25_000,
    })
  })

  test('дерево постов называет назначенного и считает сектор', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const name = prepared.roster[0]

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    // 🔴 ПИН ПРАВЛЕН ОСОЗНАННО (Plane №410): подпись дерева теперь называет
    // объект посещения («Посты объекта «…»»), и ловить его по строке
    // «Объекты и посты» стало нельзя. У области появилось ИМЯ — по нему и
    // ищем: оно не зависит от того, чей расчёт сейчас показан.
    const tree = page.getByRole('complementary', { name: 'Дерево постов' })
    await expect(tree).toContainText('Периметр', { timeout: 25_000 })
    // До назначения имени в дереве НЕТ — иначе ассерт ниже проходил бы всегда.
    await expect(tree).not.toContainText(name)
    // Счётчик СЕКТОРА, а не поста: у них разные знаменатели, и ассерт по
    // «0/» ловил бы любой из них — то есть не проверял бы ничего.
    const card = await get<any>(token, `/api/ops/security-events/${prepared.id}/`)
    const post = card.reconSectorPosts.find((row: any) => row.id === prepared.postId)
    const sectorNeed = card.reconSectorPosts
      .filter((row: any) => row.sector === post.sector)
      .reduce((sum: number, row: any) => sum + row.need, 0)
    expect(sectorNeed, 'сектор из одного поста — счётчики сектора и поста совпадут').toBeGreaterThan(
      post.need,
    )
    await expect(tree).toContainText(`0/${sectorNeed}`)

    // Шаг-переход: отбитое назначение оставило бы человека НЕ на посту, и всё
    // ниже проверяло бы не то, что написано (Plane №812).
    await assertStep(
      await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
      }),
      'POST',
      `/api/ops/security-events/${prepared.id}/placement/assign/`,
    )
    await page.reload()
    await expect(tree).toContainText(name, { timeout: 25_000 })
    await expect(tree).toContainText(`1/${sectorNeed}`)
  })

  test('старший поста назначается кнопкой и виден в дереве вместе со своим постом', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const name = prepared.roster[0]
    // Шаг-переход: отбитое назначение оставило бы человека НЕ на посту, и всё
    // ниже проверяло бы не то, что написано (Plane №812).
    await assertStep(
      await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
      }),
      'POST',
      `/api/ops/security-events/${prepared.id}/placement/assign/`,
    )

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Задача поста', { timeout: 25_000 })
    // 🔴 ПИН ПОДПИСИ ПОДНЯТ ОСОЗНАННО (Plane №705). Здесь стояло «Старший:» —
    // единственное число, доставшееся от старших СЕКТОРА. Старший теперь на
    // ПОСТ (`[РАС-03]`, Plane №445), и у сектора с двумя постами их двое:
    // подпись назвала бы обоих одним старшим сектора, а чьи это посты —
    // умолчала бы. Проба сверяет не только новую подпись, но и то, что рядом
    // с именем назван ПОСТ: без этого правка свелась бы к переименованию.
    await expect(main).toContainText('Старший поста: не назначен')

    // Чип «Старший поста» (`[РАС-03]`, Plane №445): состояние — aria-pressed.
    await main.getByRole('button', { name: /^Старший поста: / }).first().click()

    await expect(main).toContainText(`Старший поста: ${name} (`, { timeout: 15_000 })
    await expect(main.getByRole('button', { name: /^Старший поста: / }).first()).toHaveAttribute('aria-pressed', 'true')
    // Бейдж строки зовётся ТАК ЖЕ, как переключатель: «Старший сектора» на нём
    // обещал должность, которой после перехода на посты не существует.
    await expect(main).toContainText('Старший поста')
    await expect(main).not.toContainText('Старший сектора')

    await main.getByRole('button', { name: /^Старший поста: / }).first().click()
    await expect(main).toContainText('Старший поста: не назначен', { timeout: 15_000 })
  })

  test('бейдж рейтинга открывает краткую информацию о рейтинге', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const name = prepared.roster[0]
    // Шаг-переход: отбитое назначение оставило бы человека НЕ на посту, и всё
    // ниже проверяло бы не то, что написано (Plane №812).
    await assertStep(
      await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
      }),
      'POST',
      `/api/ops/security-events/${prepared.id}/placement/assign/`,
    )
    // Проба стережёт ПОВЕДЕНИЕ модалки: бейдж нажали — открылась карточка про
    // ТОГО человека, с его агрегатом и блоком оценок.
    //
    // Откуда берётся агрегат — зависит от того, есть ли он у человека НА САМОМ
    // ДЕЛЕ. Раньше проба безусловно подставляла 8.4 перехватом и сторожила
    // подмену ассертом «настоящего рейтинга у него нет». Сторож сработал
    // 26.08.2026 и был ПРАВ: после РЙ-1 и РЙ-3 сеяные участники рейтинга
    // связаны с кадровыми записями 1…8 — теми, которых проба берёт первой
    // строкой управления, — и у выбранного появился настоящий агрегат.
    // Подмена с этого момента прятала бы живое значение, то есть проба
    // сверяла бы подмену с подменой.
    //
    // Поэтому: есть настоящий агрегат — идём на нём, перехвата НЕТ, модалка
    // проверяется на живых данных; нет — подставляем, как раньше (SW в этой
    // спеке заблокирован, иначе перехват молча промахнулся бы).
    const real = await get<any>(token, '/api/ops/operational-ratings/')
    const mine = (real.results ?? []).find(
      (r: any) => String(r.personnelId ?? '') === prepared.employeeId,
    )
    const realRating: number | null = mine?.aggregateRating ?? null
    const expectedRating = realRating === null ? 8.4 : realRating
    if (realRating === null) {
      await page.route(
      (url) => url.pathname === '/api/ops/operational-ratings/',
      async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              {
                employeeId: `employee-${prepared.employeeId}`,
                personnelId: prepared.employeeId,
                safeLabel: name,
                aggregateRating: 8.4,
                evaluationsCount: 5,
                periodStartsAt: '2026-05-01',
                periodEndsAt: '2026-08-01',
                calculationPolicyVersion: 'OPERATIONAL-RATING-2026.07.1',
                calculatedAt: '2026-08-01T00:00:00+00:00',
                dataState: 'READY',
              },
            ],
            unavailableViews: [],
          }),
        }),
      )
    }

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Задача поста', { timeout: 25_000 })
    // Модалки НЕТ, пока бейдж не нажат.
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await main
      .getByRole('button', { name: `Открыть краткую информацию о рейтинге: ${name}` })
      .first()
      .click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Краткая информация о рейтинге')
    await expect(dialog).toContainText('изменение недоступно на этапе')
    // Модалка про ТОГО человека, чей бейдж нажали.
    await expect(dialog).toContainText(name)
    // Ассертится то, что модалка показывает ВСЕГДА: агрегат (настоящий либо
    // подставленный — см. выше) и заголовок блока оценок. «Методика» живёт в
    // блоке фактов, который исчезает при ошибке ручки подробностей, — ассерт
    // по ней был бы нестабильным.
    await expect(dialog).toContainText(String(expectedRating))
    await expect(dialog).toContainText('Последние 3 оценки')

    await dialog.getByRole('button', { name: 'Закрыть' }).first().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('«Последние оценки» не выдают агрегат участника за отдельный балл (доводка №658 по ревью №825)', async ({
    page,
  }) => {
    /**
     * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. `aggregateRating` в строке реестра — агрегат
     * УЧАСТНИКА за период, один и тот же во ВСЕХ его строках (тот же факт,
     * которым №658 чинила колонку «Балл» в профиле). Модалка «Краткая
     * информация о рейтинге» печатала это число в бейдже КАЖДОЙ строки
     * «Последние N оценки» — то есть напротив трёх РАЗНЫХ мероприятий стояло
     * одно и то же число, читавшееся как «балл именно за это мероприятие».
     * Перехватываются оба источника: подробности (агрегат в шапке) и реестр
     * (список строк), иначе проба зависела бы от того, что реально накопил
     * сеяный участник, и не гарантировала бы больше одной строки.
     */
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)
    const name = prepared.roster[0]
    await assertStep(
      await fetch(`${API}/api/ops/security-events/${prepared.id}/placement/assign/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ postId: prepared.postId, employeeId: prepared.employeeId }),
      }),
      'POST',
      `/api/ops/security-events/${prepared.id}/placement/assign/`,
    )

    const SAME_AGGREGATE = 7.2
    await page.route(
      (url) => url.pathname === '/api/ops/operational-ratings/',
      async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              {
                employeeId: `employee-${prepared.employeeId}`,
                personnelId: prepared.employeeId,
                safeLabel: name,
                aggregateRating: SAME_AGGREGATE,
                evaluationsCount: 2,
                periodStartsAt: '2026-05-01',
                periodEndsAt: '2026-08-01',
                calculationPolicyVersion: 'OPERATIONAL-RATING-2026.07.1',
                calculatedAt: '2026-08-01T00:00:00+00:00',
                dataState: 'READY',
              },
            ],
            unavailableViews: [],
          }),
        }),
    )
    await page.route(
      (url) => url.pathname === '/api/ops/evaluation-registry/',
      async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            results: [
              {
                rowId: 'row-probe-658-1',
                employeeId: `employee-${prepared.employeeId}`,
                personnelId: prepared.employeeId,
                employeeSafeLabel: name,
                unitSafeLabel: '',
                eventNumber: '1',
                eventTitle: 'Первое мероприятие пробы',
                objectLabel: 'Объект А',
                postLabel: null,
                participated: true,
                evaluationDirection: 'MANAGER',
                method: 'MANUAL',
                evaluatedAt: '2026-06-01T00:00:00+00:00',
                corrected: false,
                aggregateRating: SAME_AGGREGATE,
                aggregateState: 'READY',
              },
              {
                rowId: 'row-probe-658-2',
                employeeId: `employee-${prepared.employeeId}`,
                personnelId: prepared.employeeId,
                employeeSafeLabel: name,
                unitSafeLabel: '',
                eventNumber: '2',
                eventTitle: 'Второе мероприятие пробы',
                objectLabel: 'Объект Б',
                postLabel: null,
                participated: true,
                evaluationDirection: 'PEER',
                method: 'MANUAL',
                evaluatedAt: '2026-07-01T00:00:00+00:00',
                corrected: false,
                aggregateRating: SAME_AGGREGATE,
                aggregateState: 'READY',
              },
            ],
            total: 2,
            page: 1,
            pageCount: 1,
            options: { units: [], events: [] },
            policy: null,
            capabilities: { operationalRatings: true },
            columns: { sensitiveDetails: true },
            unavailableViews: [],
          }),
        }),
    )

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Задача поста', { timeout: 25_000 })
    await main
      .getByRole('button', { name: `Открыть краткую информацию о рейтинге: ${name}` })
      .first()
      .click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Последние 3 оценки')
    // Обе строки на месте — иначе ассерт «нет числа» ниже был бы вакуумным.
    await expect(dialog).toContainText('Первое мероприятие пробы')
    await expect(dialog).toContainText('Второе мероприятие пробы')
    // Метка строки — качественная («оценено»), а не голое число агрегата:
    // сравнение через дату («…7.2026») дало бы ложное срабатывание на
    // подстроке, поэтому смотрим именно на бейдж строки, а не на весь текст.
    const marks = dialog.locator('[data-slot="recent-row-mark"]')
    await expect(marks).toHaveCount(2)
    for (const mark of await marks.all()) {
      await expect(mark, 'строка печатает число вместо качественной метки').toHaveText('оценено')
    }
  })

  test('предупреждение этапа и объяснение автоподбора', async ({ page }) => {
    const token = await apiToken()
    const prepared = await prepareEventOnPlacement(token)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Задача поста', { timeout: 25_000 })
    // Посты пусты — предупреждение называет ЧИСЛО незаполненных.
    const card = await get<any>(token, `/api/ops/security-events/${prepared.id}/`)
    const unfilled = card.reconSectorPosts.length
    expect(unfilled, 'постов нет — предупреждать не о чем').toBeGreaterThan(0)
    await expect(main).toContainText(`не укомплектовано постов: ${unfilled}`)
    // Объяснения автоподбора ДО нажатия нет — иначе ассерт ниже вечнозелёный.
    await expect(main).not.toContainText('Рекомендация автоподбора')

    await main.getByRole('button', { name: 'Распределить автоматически' }).click()
    const preview = page.getByRole('dialog', { name: 'Предпросмотр автоматической расстановки' })
    await expect(preview).toBeVisible()
    await expect(preview).toContainText(prepared.roster[0]!)
    await expect(preview).toContainText('совпадение')
    const confirm = preview.getByRole('button', { name: 'Подтвердить распределение' })
    await expect(confirm).toBeEnabled()
    await confirm.click()
    await expect(preview).toBeHidden({ timeout: 20_000 })

    await expect(main).toContainText('Рекомендация автоподбора', { timeout: 20_000 })
    await expect(main).toContainText('совпадение')
    // Предупреждение НЕ исчезло: в составе один человек, а первый пост
    // просит четверых — ровно то, ради чего плашка и нужна. Число то же,
    // и это факт о данных, а не о вёрстке.
    await expect(main).toContainText(`не укомплектовано постов: ${unfilled}`)
  })

  test('смена, заданная на посту, видна на расстановке', async ({ page }) => {
    // История пробы: она сторожила смену из строки ПОТРЕБНОСТИ и была снята
    // вместе с боксом потребности (Plane №110) — заводить смену стало негде.
    // Возвращена по Plane №123, но целится теперь в ПОСТ: смена — свойство
    // поста, как в эталоне («Сектор A · смена 07:00–15:00»).
    //
    // 🔴 СМЕНА ЗАДАЁТСЯ ДО РАССТАНОВКИ, А НЕ ПОСЛЕ (Plane №1058). Прежняя
    // версия пробы доводила ОМ до «Расстановки» и ТОЛЬКО ТАМ слала
    // PATCH .../recon/ сырым `send()`, который код ответа не проверяет.
    // `can_manage_recon` намеренно замораживает объект, как только тот уходит
    // с этапа RECON (Plane №424/№634, «закрытый или уже прошедший этап
    // неизменяем»), — сервер честно отбивал правку 403, `send()` отказ
    // проглатывал, и «прочитано пусто» было не потерей данных, а верно
    // отбитой попыткой задним числом. Смена теперь задаётся ДО перехода —
    // как это делает человек на экране рекогносцировки, — общей фикстурой
    // (`firstPostShift`), которая ходит через `standCall` и падает на первом
    // же отбитом шаге.
    const token = await apiToken()
    const shift = '07:00–15:00'
    const prepared = await prepareEventOnPlacement(token, { firstPostShift: shift })
    const card = await get<any>(token, `/api/ops/security-events/${prepared.id}/`)
    const post = card.reconSectorPosts.find((row: any) => row.id === prepared.postId)

    expect(post.shift, 'смена не сохранилась на посту').toBe(shift)

    // 🔴 `demandRows` — ПРОЕКЦИЯ расчёта постов (`_demand_rows_of`), а не
    // отдельный источник (найдено при исправлении №1058). Старый бокс
    // потребности, куда смену когда-то вводили независимо от поста (Plane
    // №110/№123), снят вместе со своим полем ввода, и писать в `demandRows`
    // эндпоинтов в API нет вовсе — прежняя версия сторожа ждала там ПУСТУЮ
    // смену, но с исправленным (реальным) источником строка потребности
    // ТОЖЕ несёт смену — ровно ту же, копией. Сторож здесь — что копия не
    // разошлась с постом, а не что её не должно быть.
    const demandRow = (card.demandRows ?? []).find(
      (row: any) => row.sourcePostId === prepared.postId,
    )
    expect(demandRow?.shift, 'строка потребности разошлась со сменой поста').toBe(shift)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${prepared.id}/`)
    const main = page.getByRole('main')
    await expect(main).toContainText('Задача поста', { timeout: 25_000 })
    await expect(main).toContainText(`${post.sector} · ${shift}`)
  })


  test('без права штаба редактор раскладки закрыт и причина названа словами', async ({
    page,
  }) => {
    /**
     * Права подменяются ОТВЕТОМ ручки: заводить на стенде роль без прав ради
     * пробы значило бы менять данные стенда ради проверки интерфейса. Набор —
     * «отвечает за департамент, но не штаб» (`forces.allocate` без
     * `forces.command`): экран открыт, вкладка «Сборы» закрыта СЛОВАМИ, чьё
     * это действие, а не «недостаточно прав» (Plane №74, Р-7; №944).
     */
    const token = await apiToken()
    const { id } = await prepareDemandEvent(token)
    await page.route(
      (url) => url.pathname.includes('/api/operations/my-permissions/'),
      async (route) =>
        route.fulfill({
          json: {
            permissions: ['event.view', 'status.view', 'personnel.view', 'forces.allocate'],
          },
        }),
    )
    await signIn(page)
    await page.goto(`${APP}${SCREEN}&tab=collections&collection=${encodeURIComponent(id)}`)
    await expect(
      page.getByText('Делит потребность и решает по спискам штаб').first(),
    ).toBeVisible({ timeout: 25_000 })
    await expect(page.getByRole('button', { name: 'Отправить запросы' })).toHaveCount(0)
  })

  test('со своим правом редактор раскладки доступен', async ({ page }) => {
    // Контрольная проба: без неё «закрыто» выше не отличалось бы от «закрыто
    // всегда», и гейт мог бы просто не работать.
    const token = await apiToken()
    const { id } = await prepareDemandEvent(token)
    await signIn(page)
    const section = await openSplitEditor(page, id)
    await expect(section.getByRole('button', { name: 'Отправить запросы' })).toBeVisible({
      timeout: 25_000,
    })
    await expect(
      page.getByText('Делит потребность и решает по спискам штаб'),
    ).toHaveCount(0)
  })

  test('реестр личного состава остался достижим', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    // Слияние 21.08: реестр больше не отдельный маршрут — он ПЕРВАЯ вкладка
    // самого экрана, и открывается именно он, а не разрез сбора.
    await expect(page.getByRole('heading', { name: 'Сбор сил на ОМ' })).toBeVisible({
      timeout: 25_000,
    })
    const tableTab = page.getByRole('tab', { name: 'Список сотрудников' })
    await expect(tableTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel').locator('tbody tr').first()).toBeVisible({
      timeout: 25_000,
    })
    // Старый адрес мёртв по-настоящему: живой значил бы, что реестр раздвоён.
    const response = await page.goto(`${APP}/employees/registry/`)
    expect(response?.status()).toBe(404)
  })
})
