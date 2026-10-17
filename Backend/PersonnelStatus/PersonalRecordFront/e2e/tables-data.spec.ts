/**
 * Таблицы кадров и статусов — ЖИВОЙ стенд.
 *
 * Проба стережёт то, что обе таблицы ГОВОРЯТ ПРАВДУ, а не то, как они
 * выглядят. До правки:
 *
 * 1. ручка штатки не клала в `current_status` даты, хотя они есть в модели, —
 *    «Обновлён» и «Следующий» (до №331 — «Последнее обновление» и
 *    «Следующее обновление») печатали «Не обновлено» и
 *    «Не указано» во ВСЕХ строках, 362 px на две колонки без единого бита;
 * 2. карточка сотрудника подставляла вместо отсутствующей даты СЕГОДНЯШНЕЕ
 *    число — колонка «Дата найма» показывала одну дату у всех, а «стаж
 *    работы» обнулялся у всякого, кто ушёл в отпуск;
 * 3. подсветка просрочки не срабатывала ни разу: `isOverdue` разбирал обратно
 *    уже отформатированную строку (`new Date("14.08.2026")` → NaN).
 *
 * 🔴 Фикстура обязана содержать И просроченные статусы, И действующие — иначе
 * ассерт «просроченные отмечены» вырождается в «отмечены все» или «никто».
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { businessDateOf, localIsoDate } from './business-date'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { probeComment } from './probe-statuses'
import { probeTitle } from './probe-events'
import { objectWithPassport, standCall } from './prepare-events'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface StatusBrief {
  status_type: string
  state: string
  start_date?: string | null
  end_date?: string | null
}

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /тему|theme/i }).first()).toBeEnabled({
    timeout: 20_000,
  })
}

/**
 * Дождаться СТРОК, а не таблицы: шапка отрисована сразу, и проба, ждущая
 * `table`, читает пустой `tbody` и получает пустую колонку — «нет данных» и
 * «данные одинаковы» при этом выглядят одинаково.
 */
async function tableFilled(page: Page): Promise<void> {
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })
}

/**
 * Значения колонки по её подписи в шапке.
 *
 * Оформительские узлы (`aria-hidden`) выбрасываются: с 27.08.2026 в колонке
 * ФИО стоит аватарка, и её ЗАГЛУШКА-ИНИЦИАЛЫ — тоже текст. Без вычистки
 * «Абенов Санжар» читался бы как «АСАбенов Санжар», и отбор по первому слову
 * искал бы несуществующую фамилию. Берётся ровно то, что читает скринридер.
 */
async function column(page: Page, head: string): Promise<string[]> {
  return page.evaluate((name) => {
    const table = document.querySelector('table')
    if (table === null) return []
    const heads = [...table.querySelectorAll('thead th')]
    const index = heads.findIndex((th) => th.textContent?.trim() === name)
    if (index === -1) return []
    return [...table.querySelectorAll('tbody tr')].map((row) => {
      const cell = row.children[index]
      if (cell === undefined) return ''
      const copy = cell.cloneNode(true) as HTMLElement
      copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove())
      return (copy.textContent ?? '').trim()
    })
  }, head)
}

/** Дата в формате API. */
// Местная дата, не UTC (Plane №373 и №377): ночью `toISOString()` отдаёт
// вчерашнее число, и заведённый статус приходит вчерашним днём.
const iso = (date: Date): string => localIsoDate(date)

interface OwnTablePerson {
  id: number
  first_name: string
  last_name: string
  personnel_number: string
}

interface TableScene {
  people: OwnTablePerson[]
  search: string
  departmentId: number
  directorateId: number
}

interface SectionStatus {
  id: number
  employee_id: number
  status_type_code: string
  date_start: string
  date_end: string
  state: string
  source: string
  source_ref: string | null
  comment: string | null
  participations: { event_id: number; kind_code: string; event_code?: string }[]
}

async function tableApi<T>(token: string, method: string, path: string, data?: unknown, expectedStatus?: number): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  const body = await response.text()
  expect(response.ok, `[фикстура] ${method} ${path}: ${response.status} ${body}`).toBe(true)
  if (expectedStatus !== undefined) expect(response.status, `${method} ${path}: ${body}`).toBe(expectedStatus)
  return JSON.parse(body) as T
}

async function tablePages<T>(token: string, path: string): Promise<T[]> {
  const rows: T[] = []
  const visited = new Set<string>()
  let next: string | null = path
  let count = 0
  while (next !== null) {
    expect(visited.has(next), '[фикстура] кольцо страниц таблицы').toBe(false)
    visited.add(next)
    const page: { results: T[]; next: string | null; count: number } = await tableApi(token, 'GET', next)
    rows.push(...page.results)
    count = page.count
    const url: URL | null = page.next === null ? null : new URL(page.next, API)
    next = url === null ? null : `${url.pathname}${url.search}`
  }
  expect(rows.length, '[фикстура] API вернул не все строки').toBe(count)
  return rows
}

interface TableSubmission {
  id: number
  business_date: string
  version: number
  is_current: boolean
}

/** The amendment selector uses saved roster IDs, even after an employee moves. */
async function tableSubmissionRosters(token: string, businessDate: string): Promise<{
  history: TableSubmission[]
  coveredEmployeeIds: Set<number>
}> {
  const access = await tableApi<{
    permissions: string[]; roles: { code: string; scope_division_id: number | null }[]
  }>(token, 'GET', '/api/operations/my-permissions/')
  const roles = await tablePages<{ code: string; permissions: string[] }>(
    token, '/api/operations/roles/?limit=500',
  )
  // A scoped wildcard also appears in effective permissions. Confirm the
  // actual unscoped grant, or invisible submissions could look absent.
  expect(access.roles.some((grant) => grant.scope_division_id === null && roles.some((role) =>
    role.code === grant.code && (role.permissions.includes('*') || role.permissions.includes('status.view')))),
  '[фикстура] нужны глобальные права чтения всех сдач дня').toBe(true)
  expect(access.permissions.includes('*') || access.permissions.includes('status.view')).toBe(true)
  const history = await tablePages<TableSubmission>(
    token, `/api/operations/daily-submissions/?business_date=${businessDate}&history=true&limit=500`,
  )
  expect(new Set(history.map((row) => row.id)).size).toBe(history.length)
  const coveredEmployeeIds = new Set<number>()
  for (const row of history) {
    expect(row.business_date).toBe(businessDate)
    expect(Number.isInteger(row.id) && row.id > 0).toBe(true)
    expect(Number.isInteger(row.version) && row.version > 0).toBe(true)
    expect(typeof row.is_current).toBe('boolean')
    if (!row.is_current) continue
    const detail = await tableApi<TableSubmission & { snapshot: { roster: { employee_id: number }[] } }>(
      token, 'GET', `/api/operations/daily-submissions/${row.id}/`, undefined, 200,
    )
    expect([detail.id, detail.business_date, detail.version, detail.is_current])
      .toEqual([row.id, businessDate, row.version, true])
    expect(Array.isArray(detail.snapshot?.roster), '[фикстура] сдача должна раскрывать сохранённый состав').toBe(true)
    for (const person of detail.snapshot.roster) {
      expect(Number.isInteger(person.employee_id) && person.employee_id > 0).toBe(true)
      coveredEmployeeIds.add(person.employee_id)
    }
  }
  return { history, coveredEmployeeIds }
}

/** Own USER rows on free stand personnel; no existing employee/status is edited. */
async function withOwnPaginationBackground(
  token: string,
  businessDate: string,
  excludedEmployeeIds: number[],
  check: (background: SectionStatus[]) => Promise<void>,
): Promise<void> {
  expect(LIVE, '[фикстура] массовая проба требует явно включённый живой стенд').toBe(true)
  const submissionsBefore = await tableSubmissionRosters(token, businessDate)
  const before = await tablePages<SectionStatus>(
    token, `/api/operations/statuses/?business_date=${businessDate}&limit=500`,
  )
  const beforeIds = new Set(before.map((row) => row.id))
  const occupied = new Set([
    ...excludedEmployeeIds, ...before.map((row) => row.employee_id), ...submissionsBefore.coveredEmployeeIds,
  ])
  const people = await tablePages<{
    id: number; is_active: boolean; employment_status: string; division: number | null
    hire_date: string | null; dismissal_date: string | null
  }>(token, '/api/core/employees/?status=working&page_size=500')
  const candidates = people.filter((person) => person.is_active && person.employment_status === 'working' &&
    person.division !== null && !occupied.has(person.id) &&
    (person.hire_date === null || person.hire_date <= businessDate) &&
    (person.dismissal_date === null || person.dismissal_date > businessDate)).slice(0, 500)
  expect(candidates, '[фикстура] нужны 500 действующих сотрудников со слотом без текущего Ops-статуса и без покрытия сдачей').toHaveLength(500)
  expect(new Set(candidates.map((person) => person.id)).size).toBe(500)
  const types = await tablePages<{ code: string; is_active: boolean; is_hard_block: boolean }>(
    token, '/api/operations/status-types/?limit=500',
  )
  const type = types.find((row) => row.code === 'IN_SERVICE')
  expect(type?.is_active, '[фикстура] IN_SERVICE должен быть активен').toBe(true)
  expect(type?.is_hard_block).toBe(false)
  const end = new Date(`${businessDate}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  const dateEnd = end.toISOString().slice(0, 10)
  const batchId = randomUUID()
  const comment = probeComment(`Фон пагинации таблицы ${batchId}`)
  const refs = new Map(candidates.map((person) => [person.id, `e2e-table-page:${batchId}:${person.id}`]))
  const statusIds = new Set<number>()
  const statusEmployeeIds = new Map<number, number>()
  let attempted = false
  const discover = async () => {
    const rows = await tablePages<SectionStatus>(
      token, `/api/operations/statuses/?business_date=${businessDate}&include_cancelled=true&limit=500`,
    )
    const owned = rows.filter((row) => !beforeIds.has(row.id) && row.comment === comment &&
      refs.has(row.employee_id) && row.source_ref === refs.get(row.employee_id))
    for (const row of owned) {
      statusIds.add(row.id)
      statusEmployeeIds.set(row.id, row.employee_id)
    }
    return owned
  }
  try {
    const beforeCreate = await tableSubmissionRosters(token, businessDate)
    expect(candidates.filter((person) => beforeCreate.coveredEmployeeIds.has(person.id)),
      '[фикстура] фон не должен менять сотрудника из состава сданного дня').toEqual([])
    expect([...beforeCreate.history].sort((a, b) => a.id - b.id), 'сдачи изменились во время подготовки фона')
      .toEqual([...submissionsBefore.history].sort((a, b) => a.id - b.id))
    attempted = true
    // Bulk is atomic and deliberately has no overlap override. Every subject
    // was free on this exact day; a race/conflict must fail this preparation.
    // No amendment reason: a newly covering submission causes atomic 422,
    // rather than authorizing a foreign submission's next version.
    const created = await tableApi<{ created: number }>(token, 'POST', '/api/operations/statuses/bulk/', {
      business_date: businessDate,
      rows: candidates.map((person) => ({
        employee_id: person.id, status_type_code: type!.code, date_start: businessDate, date_end: dateEnd,
        comment, source_ref: refs.get(person.id),
      })),
    }, 201)
    const background = await discover()
    expect(created.created).toBe(500)
    expect(background).toHaveLength(500)
    expect(statusIds.size).toBe(500)
    expect(background.map((row) => row.employee_id).sort((a, b) => a - b))
      .toEqual(candidates.map((person) => person.id).sort((a, b) => a - b))
    for (const row of background) {
      expect(row.id).toBeGreaterThan(0)
      expect(row.state).toBe('ACTIVE')
      expect(row.source).toBe('USER')
      expect(row.comment).toBe(comment)
      expect(row.source_ref).toBe(refs.get(row.employee_id))
      expect(row.status_type_code).toBe('IN_SERVICE')
      expect(row.date_start).toBe(businessDate)
      expect(row.date_end).toBe(dateEnd)
      expect(row.participations).toEqual([])
    }
    await check(background)
  } finally {
    const failures: unknown[] = []
    // A failed/lost bulk response may still have committed. Rediscover by
    // this unique batch and subjects, never by status type or global (e2e).
    if (attempted) {
      try { await discover() } catch (error) { failures.push(error) }
    }
    const ids = [...statusIds]
    const protectedStatusIds: number[] = []
    let beforeCleanup: Awaited<ReturnType<typeof tableSubmissionRosters>> | undefined
    if (ids.length > 0) {
      try { beforeCleanup = await tableSubmissionRosters(token, businessDate) }
      catch (error) { failures.push(error) }
    }
    const eachOwned = async (action: (id: number) => Promise<void>) => {
      let cursor = 0
      await Promise.all(Array.from({ length: Math.min(8, ids.length) }, async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++]
          try { await action(id) } catch (error) { failures.push(error) }
        }
      }))
    }
    await eachOwned(async (id) => {
      // Cancel requires reason, and the service also uses it as amendment
      // authorization. There is no public amend=false option: fail closed
      // if a submission now covers an own row, or coverage cannot be read.
      const employeeId = statusEmployeeIds.get(id)
      if (beforeCleanup === undefined || employeeId === undefined || beforeCleanup.coveredEmployeeIds.has(employeeId)) {
        protectedStatusIds.push(id)
        throw new Error(`не отменён свой статус ${id}: нельзя исключить поправку чужой сдачи`)
      }
      const cancelled = await tableApi<SectionStatus>(
        token, 'POST', `/api/operations/statuses/${id}/cancel/`, { reason: comment }, 200,
      )
      expect(cancelled.id).toBe(id)
      expect(cancelled.state).toBe('CANCELLED')
    })
    // Verify every stored row independently even when one cancel request failed.
    await eachOwned(async (id) => {
      const stored = await tableApi<SectionStatus>(token, 'GET', `/api/operations/statuses/${id}/`, undefined, 200)
      expect(stored.id).toBe(id)
      expect(stored.state).toBe('CANCELLED')
      expect(stored.comment).toBe(comment)
      expect(stored.source_ref).toBe(refs.get(stored.employee_id))
    })
    try {
      const restored = await tablePages<SectionStatus>(
        token, `/api/operations/statuses/?business_date=${businessDate}&limit=500`,
      )
      expect(restored.sort((a, b) => a.id - b.id), 'пачка изменила существующие текущие статусы')
        .toEqual([...before].sort((a, b) => a.id - b.id))
    } catch (error) { failures.push(error) }
    try {
      const afterCleanup = await tableSubmissionRosters(token, businessDate)
      expect([...afterCleanup.history].sort((a, b) => a.id - b.id), 'фон создал или изменил чужую версию сдачи')
        .toEqual([...submissionsBefore.history].sort((a, b) => a.id - b.id))
    } catch (error) { failures.push(error) }
    await test.info().attach('owned-table-pagination-background', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({
        batchId, comment, employeeIds: [...refs.keys()], statusIds: ids, beforeIds: [...beforeIds],
        submissionIds: submissionsBefore.history.map((row) => row.id), protectedStatusIds,
      })),
    })
    if (failures.length > 0) throw new AggregateError(failures, 'failed to clean up owned pagination background')
  }
}

/** Only these new employees/slots are changed; their inactive cards retain audit history. */
async function withOwnTablePeople(
  token: string,
  count: number,
  check: (scene: TableScene) => Promise<void>,
): Promise<void> {
  const divisions = await tablePages<{ id: number; parent: number | null; type_code: string; is_active: boolean }>(
    token, '/api/core/divisions/?page_size=200',
  )
  const directorate = divisions.find((row) => row.is_active && row.type_code === 'directorate' &&
    divisions.some((parent) => parent.id === row.parent && parent.type_code === 'department' && parent.is_active))
  expect(directorate, '[фикстура] нужно активное управление департамента').toBeDefined()
  const positions = await tablePages<{ id: number; is_active: boolean }>(token, '/api/dictionaries/positions/?page_size=200')
  const position = positions.find((row) => row.is_active)
  expect(position, '[фикстура] нужна активная должность').toBeDefined()
  const search = `ПробаТаблиц${randomUUID().replaceAll('-', '')}`
  const people: OwnTablePerson[] = []
  const slotIds: number[] = []
  try {
    const created = await tableApi<{
      success: boolean; errors: unknown; rolled_back: boolean
      created: { employees: OwnTablePerson[]; staff_units: { id: number }[] }
    }>(token, 'POST', '/api/staff_unit/staff-units/directorate/', {
      atomic: true,
      employees: Array.from({ length: count }, (_, index) => ({
        last_name: search, first_name: index === 0 ? 'Аватар' : `Безфото${index}`,
        callsign: `ТАБ-${index}-${search.slice(-8)}`,
      })),
      staff_units: Array.from({ length: count }, () => ({ division: directorate!.id, position: position!.id })),
    })
    people.push(...created.created.employees)
    slotIds.push(...created.created.staff_units.map((row) => row.id))
    expect(created.success, JSON.stringify(created.errors)).toBe(true)
    expect(created.rolled_back).toBe(false)
    expect(people).toHaveLength(count)
    expect(slotIds).toHaveLength(count)
    await check({ people, search, departmentId: directorate!.parent!, directorateId: directorate!.id })
  } finally {
    const failures: unknown[] = []
    if (people.length > 0) {
      try {
        const blocked = await tableApi<{ success: boolean; updated: { employees: number }; errors?: unknown }>(
          token, 'PATCH', '/api/staff_unit/staff-units/directorate/', {
            atomic: true, employees: people.map((person) => ({ id: person.id, is_active: false })),
          },
        )
        expect(blocked.success, JSON.stringify(blocked.errors)).toBe(true)
        expect(blocked.updated.employees).toBe(people.length)
      } catch (error) { failures.push(error) }
    }
    for (const id of slotIds) {
      try {
        const removed = await fetch(`${API}/api/staff_unit/staff-units/${id}/`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        })
        expect(removed.status, `свой штатный слот ${id} не удалён`).toBe(204)
      } catch (error) { failures.push(error) }
    }
    await test.info().attach('owned-table-people', {
      contentType: 'application/json', body: Buffer.from(JSON.stringify({ people, slotIds, search })),
    })
    if (failures.length > 0) throw new AggregateError(failures, 'failed to clean up owned table people')
  }
}

/** Current named participation with a real requested event, even after midnight/reseeding. */
async function withOwnCurrentParticipations(
  token: string,
  scene: TableScene,
  duplicate: boolean,
  check: (own: { businessDate: string; eventId: number; rows: SectionStatus[] }) => Promise<void>,
): Promise<void> {
  const businessDate = await businessDateOf(API, token)
  const end = new Date(`${businessDate}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 1)
  const dateEnd = end.toISOString().slice(0, 10)
  const comment = probeComment(`Текущее участие таблицы ${scene.search}`)
  const statusIds: number[] = []
  let event: { id: string; title: string } | undefined
  try {
    const call = standCall(token)
    const object = await objectWithPassport(call)
    event = await call('POST', '/api/ops/security-events/', {
      title: probeTitle(`Текущее участие таблицы ${scene.search}`), objectId: object.id,
      businessDate, kind: 'INTERNAL', chiefEmployeeId: String(scene.people[0].id),
    })
    expect(Number(event!.id), '[фикстура] собственный ОМ ответил без ID').toBeGreaterThan(0)
    expect(event!.title).toContain('(e2e)')
    const base = `/api/ops/security-events/${event!.id}`
    await call('POST', `${base}/recon/import-from-passport/`)
    const imported = await call('GET', `${base}/`)
    expect(imported.reconSectorPosts.length, '[фикстура] паспорт не дал постов').toBeGreaterThan(0)
    await call('PATCH', `${base}/recon/`, {
      checklist: imported.reconChecklist.map((row: Record<string, unknown>) => ({ ...row, state: 'NORMAL', done: true, result: 'MATCHES' })),
      sectorPosts: imported.reconSectorPosts.map((row: Record<string, unknown>, index: number) =>
        index === 0 ? { ...row, need: scene.people.length } : row),
    })
    const demand = await call('POST', `${base}/recon/complete/`)
    expect(demand.forceDemandTotal, '[фикстура] нет потребности для запроса сил').toBeGreaterThanOrEqual(scene.people.length)
    const allocated = await call('POST', `${base}/forces/allocation/`, {
      rows: [{ departmentId: String(scene.departmentId), need: scene.people.length }],
    })
    const allocation = allocated.forceAllocation.find((row: { departmentId: string }) => row.departmentId === String(scene.departmentId))
    expect(allocation?.id, '[фикстура] собственная заявка не сохранена').toBeTruthy()
    const allocationBase = `${base}/forces/allocation/${encodeURIComponent(allocation.id)}`
    await call('POST', `${allocationBase}/split/`, { rows: [{ divisionId: String(scene.directorateId), need: scene.people.length }] })
    const notified = await call('POST', `${allocationBase}/notify/`)
    const saved = notified.forceAllocation.find((row: { id: string }) => row.id === allocation.id)
    expect(saved?.status).toBe('NOTIFIED')
    const requested = saved.directorates.find((row: { divisionId: string }) => row.divisionId === String(scene.directorateId))
    expect(requested?.need).toBe(scene.people.length)
    expect(requested?.notifiedAt).toBeTruthy()
    const catalog = await tableApi<{ results: { code: string; groupCode: string | null; isActive: boolean }[] }>(
      token, 'GET', '/api/ops/dictionaries/EVENT_GROUP_ROLES/entries/',
    )
    const role = catalog.results.find((row) => row.isActive && row.groupCode === 'SCREENING_GROUP')
    expect(role, '[фикстура] нужна активная роль SCREENING_GROUP').toBeDefined()
    expect(role?.isActive).toBe(true)
    expect(role?.groupCode).toBe('SCREENING_GROUP')
    expect(role?.code, '[фикстура] роль группы ответила без кода').toEqual(expect.any(String))
    expect(role!.code.trim()).not.toBe('')
    const participation = { event_id: Number(event!.id), kind_code: 'SCREENING_GROUP', role_code: role!.code }
    for (const person of scene.people) {
      for (let index = 0; index < (duplicate ? 2 : 1); index += 1) {
        const created = await tableApi<SectionStatus>(token, 'POST', '/api/operations/statuses/', {
          employee_id: person.id, status_type_code: 'IN_EVENT', date_start: businessDate, date_end: dateEnd,
          comment, amendment_reason: comment, participations: [participation],
          // All possible overlaps are this fixture's new personnel projection or
          // its own first duplicate; no existing employee/status is overwritten.
          override: true, override_reason: comment,
        })
        statusIds.push(created.id)
        expect(created.id).toBeGreaterThan(0)
        expect(created.employee_id).toBe(person.id)
        expect(created.state).toBe('ACTIVE')
        expect(created.date_start).toBe(businessDate)
        expect(created.date_end).toBe(dateEnd)
        expect(created.participations).toEqual([expect.objectContaining(participation)])
      }
    }
    const rows: SectionStatus[] = []
    for (const id of statusIds) rows.push(await tableApi(token, 'GET', `/api/operations/statuses/${id}/`))
    expect(rows).toHaveLength(scene.people.length * (duplicate ? 2 : 1))
    for (const row of rows) {
      expect(row.participations).toEqual([expect.objectContaining(participation)])
      expect(row.date_start).toBe(businessDate)
      expect(row.date_end).toBe(dateEnd)
    }
    expect(rows.every((row) => row.state === 'ACTIVE' && row.participations[0]?.event_code)).toBe(true)
    await check({ businessDate, eventId: Number(event!.id), rows })
  } finally {
    const failures: unknown[] = []
    for (const id of statusIds) {
      try {
        const cancelled = await tableApi<SectionStatus>(token, 'POST', `/api/operations/statuses/${id}/cancel/`, { reason: comment })
        expect(cancelled.state).toBe('CANCELLED')
      } catch (error) { failures.push(error) }
    }
    // Event deletion retains actionable notification history. The established
    // probe purge receives the exact own ID/title instead of a dangling request.
    await test.info().attach('owned-table-participations', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ businessDate, statusIds, event, eventCleanup: 'purge_probe_events by exact ID/title' })),
    })
    if (failures.length > 0) throw new AggregateError(failures, 'failed to cancel owned table participations')
  }
}

/**
 * Завести СРОЧНЫЙ действующий статус (с датой окончания) первому сотруднику
 * первой страницы, у которого период свободен. Возвращает дату окончания.
 *
 * Перебор, а не «первый попавшийся»: сервер запрещает пересекающиеся статусы,
 * и на занятом человеке фикстура молча не завелась бы.
 */
async function seedTimedStatus(token: string): Promise<string> {
  const raw = await fetch(`${API}/api/staff_unit/staff-units/directorate/?page=1&page_size=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await raw.json()) as { staff_units: { employee: { id: number } | null }[] }
  const employees = body.staff_units
    .map((unit) => unit.employee)
    .filter((employee): employee is { id: number } => employee !== null && employee !== undefined)

  const end = new Date()
  end.setDate(end.getDate() + 6)
  const endDate = iso(end)

  for (const employee of employees) {
    const res = await fetch(`${API}/api/statuses/statuses/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        employee: employee.id,
        status_type: 'business_trip',
        start_date: iso(new Date()),
        end_date: endDate,
        comment: probeComment('Фикстура пробы «период статуса»'),
      }),
    })
    if (res.status === 201) return endDate
  }
  throw new Error(
    'не удалось завести срочный статус ни одному сотруднику первой страницы: ' +
      'у всех период пересекается. Это не повод для скипа — проверьте данные стенда.',
  )
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'таблицы: правда в колонках' : 'таблицы (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('период статуса доезжает с бэка до обеих таблиц', async ({ page }) => {
    // Сверяемся с ответом сервера, а не с числами в коде: «сегодня» плавает.
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)

    /**
     * 🔴 СРОЧНЫЙ статус заводится ПРОБОЙ, а не берётся из данных стенда
     * (Plane №255, 28.08.2026).
     *
     * Ассерт ниже требует, чтобы колонка «Следующий» РАЗЛИЧАЛА
     * строки, то есть чтобы хоть у кого-то на первой странице была дата
     * окончания. Фикстуры под это не было: `seed_smoke_fixtures` заводит
     * `OpsEmployeeStatus` (модель ОМ), а колонка читает `EmployeeStatus`
     * (модель кадрового статуса) — разные таблицы. Проба держалась на ОДНОЙ
     * случайной строке стенда, и в тот день, когда этому человеку сменили
     * статус на бессрочный «В строю», все 48 строк стали «Не указано» и проба
     * покраснела, не найдя при этом ни одного дефекта кода.
     *
     * Это тот же урок, что записан ниже у соседней пробы: данные стенда —
     * не фикстура. Отличие лишь в том, что здесь нужен ЖИВОЙ круг (ручка →
     * экран), поэтому перехватом обойтись нельзя — статус заводится по-честному.
     */
    await seedTimedStatus(token)

    const raw = await fetch(`${API}/api/staff_unit/staff-units/directorate/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await raw.json()) as {
      staff_units: { employee: { current_status: StatusBrief | null } | null }[]
    }
    const statuses = body.staff_units
      .map((unit) => unit.employee?.current_status)
      .filter((status): status is StatusBrief => status !== undefined && status !== null)

    expect(statuses.length, 'на стенде нет ни одного статуса — проба вакуумна').toBeGreaterThan(0)
    // Ручка собирает current_status литеральным словарём; даты в него не
    // клали, и обе колонки печатали константу.
    const withStart = statuses.filter((s) => typeof s.start_date === 'string' && s.start_date !== '')
    expect(withStart.length, 'ручка штатки не отдаёт start_date — колонки нечем наполнить').toBe(
      statuses.length,
    )

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    // 🔴 ПИН ПОДПИСЕЙ ПРАВЛЕН ОСОЗНАННО (Plane №331): заголовки колонок дат
    // сокращены до «Обновлён» и «Следующий» — они задавали ширину таблице,
    // а сами даты вдвое уже. Предмет пробы не изменился: колонки обязаны
    // РАЗЛИЧАТЬ строки, а не печатать одно и то же.
    const since = await column(page, 'Обновлён')
    const until = await column(page, 'Следующий')
    expect(since.length).toBeGreaterThan(0)
    // Ключевой ассерт: колонка РАЗЛИЧАЕТ строки. Одно значение на всю таблицу
    // — ровно то состояние, из которого её вытаскивали.
    expect(new Set(since).size, `«Обновлён» одинаково во всех строках: ${since[0]}`)
      .toBeGreaterThan(1)
    expect(new Set(until).size, `«Следующий» одинаково во всех строках: ${until[0]}`)
      .toBeGreaterThan(1)
    // Даты — без времени: `toLocaleString` дописывал «, 00:00:00» у поля,
    // у которого времени нет.
    expect(since.join(' ')).not.toContain('00:00:00')
  })

  test('просроченные статусы отмечены, действующие — нет', async ({ page }) => {
    /**
     * 🔴 Фикстура задаётся ПЕРЕХВАТОМ, а не берётся из данных стенда.
     *
     * Первая версия полагалась на то, что просроченные статусы на стенде есть.
     * Полный смоук-обход это опроверг: он сам кликает по кнопкам `/statuses` и
     * меняет статусы — после него просроченных не осталось ни одного, и проба
     * упала на собственном гварде против вакуума. Поодиночке она при этом была
     * зелёной, то есть падала бы только в общем прогоне.
     *
     * Обе стороны (просроченный и действующий) задаются здесь явно, поэтому
     * проба больше не зависит от того, что стенд успел пережить до неё.
     */
    const YESTERDAY = new Date()
    YESTERDAY.setDate(YESTERDAY.getDate() - 3)
    const TOMORROW = new Date()
    TOMORROW.setDate(TOMORROW.getDate() + 5)
    const iso = (value: Date) => localIsoDate(value)

    await page.route(
      // 🔴 ТОЛЬКО ЗАПРОС СТРАНИЦЫ, не сводки. С 28.08.2026 экран статусов
      // просит у той же ручки ещё и сводку (`with_summary=1&page_size=1`,
      // Plane №231): в её теле одна строка, и перехват, правивший «первых
      // двух со статусом», падал на собственном стороже против вакуума.
      (url) =>
        url.pathname.includes('/api/staff_unit/staff-units/directorate') &&
        url.searchParams.get('with_summary') === null,
      async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as {
          staff_units?: {
            employee?: { current_status?: Record<string, unknown> | null } | null
          }[]
        }
        const withStatus = (body.staff_units ?? []).filter(
          (unit) => unit.employee?.current_status != null,
        )
        expect(
          withStatus.length,
          'на стенде нет сотрудников со статусом — подменять нечего',
        ).toBeGreaterThan(1)

        // Первому — истёкший период, второму — действующий. Остальные как есть.
        withStatus[0].employee!.current_status!.end_date = iso(YESTERDAY)
        withStatus[1].employee!.current_status!.end_date = iso(TOMORROW)
        await route.fulfill({ response, json: body })
      },
    )

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    const marks = await page.evaluate(() => {
      const table = document.querySelector('table')
      if (table === null) return []
      const heads = [...table.querySelectorAll('thead th')]
      const index = heads.findIndex((th) => th.textContent?.trim() === 'Следующий')
      return [...table.querySelectorAll('tbody tr')].map((row) => ({
        text: (row.children[index]?.textContent ?? '').trim(),
        marked: getComputedStyle(row).backgroundColor === 'rgb(254, 242, 242)',
      }))
    })

    const dated = marks.filter((row) => /^\d{2}\.\d{2}\.\d{4}$/.test(row.text))
    expect(dated.length, 'ни одной строки с датой окончания — проба вакуумна').toBeGreaterThan(0)

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const overdue = dated.filter((row) => {
      const [day, month, year] = row.text.split('.').map(Number)
      return new Date(year, month - 1, day) < today
    })
    const actual = dated.filter((row) => !overdue.includes(row))

    // 🔴 Обе стороны обязаны быть непустыми: на одних просроченных ассерт
    // «отмечены просроченные» неотличим от «отмечены все».
    expect(overdue.length, 'нет просроченных статусов — отметку не на чем проверить').toBeGreaterThan(0)
    expect(actual.length, 'нет действующих статусов — отметка неотличима от «всегда»').toBeGreaterThan(0)

    expect(overdue.every((row) => row.marked), 'просроченная строка не отмечена').toBe(true)
    expect(actual.some((row) => row.marked), 'действующая строка отмечена как просроченная').toBe(false)
  })

  test('строка называет, из какого учёта пришло привлечение на ОМ', async ({ page }) => {
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    await withOwnTablePeople(token, 1, async (scene) => {
      await withOwnCurrentParticipations(token, scene, true, async (own) => {
        const employee = scene.people[0]
        // Two real ACTIVE rows carry the same named event. Deduplication cannot
        // pass vacuously when a reseed or midnight removed the old stand data.
        const serverRows = await tablePages<SectionStatus>(
          token,
          `/api/operations/statuses/?employee_id=${employee.id}&business_date=${own.businessDate}&limit=200`,
        )
        const attached = serverRows.filter((row) => own.rows.some((created) => created.id === row.id))
        expect(attached).toHaveLength(2)
        expect(attached.every((row) => row.state === 'ACTIVE')).toBe(true)
        const events = attached.flatMap((row) => row.participations.map((part) => part.event_id))
        expect(events).toEqual([own.eventId, own.eventId])

        await signIn(page, STAND_USERNAME, STAND_PASSWORD)
        await page.goto('/statuses')
        await hydrated(page)
        await tableFilled(page)
        await page.getByPlaceholder('Поиск по ФИО').fill(`${employee.last_name} ${employee.first_name}`)
        const row = page.locator(`table tbody tr[data-employee-id="${employee.id}"]`)
        await expect(row, `сотрудник ${employee.last_name} не нашёлся в таблице`).toBeVisible({ timeout: 15_000 })

        // Address columns by their headings so a layout reorder stays valid.
        const headers = await page.locator('table thead th').allInnerTexts()
        const kadrIndex = headers.findIndex((text) => text.includes('Статус (кадровый)'))
        const opsIndex = headers.findIndex((text) => text.includes('По разделу ОМ'))
        expect(kadrIndex, 'колонки кадрового статуса нет вовсе').toBeGreaterThanOrEqual(0)
        expect(opsIndex, 'колонки «По разделу ОМ» нет вовсе (Plane №314)').toBeGreaterThanOrEqual(0)
        const opsCell = row.locator('td').nth(opsIndex)
        const kadrCell = row.locator('td').nth(kadrIndex)
        const opsLinks = opsCell.getByRole('link', { name: /^→ ОМ-/ })
        await expect(opsLinks.first(), 'ссылка ушла не в колонку раздела').toBeVisible({ timeout: 20_000 })
        await expect(opsCell.locator(
          `a[href="/security-ops/events/${own.eventId}"], a[href="/security-ops/events/${own.eventId}/"]`,
        )).toHaveCount(1)
        const labels = (await opsLinks.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim())
        expect(labels.length - new Set(labels).size, `повторяется подпись: ${labels.join(' | ')}`).toBe(0)

        await expect(kadrCell.getByRole('link', { name: /^→ ОМ-/ }), 'учёты снова в одной ячейке').toHaveCount(0)
        await expect(kadrCell.locator('span,div').first(), 'кадровый бейдж исчез').toBeVisible()
        expect((await kadrCell.innerText()).trim(), 'кадровая колонка пуста').not.toBe('')
      })
    })
  })

  test('привлечения доезжают до таблицы ВСЕ, а не первой страницей', async ({ page }) => {
    test.setTimeout(240_000)
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    await withOwnTablePeople(token, 2, async (scene) => {
      await withOwnCurrentParticipations(token, scene, false, async (own) => {
        const employeeIds = scene.people.map((person) => person.id)
        await withOwnPaginationBackground(token, own.businessDate, employeeIds, async (background) => {
          const serverRows = await tablePages<SectionStatus>(
            token, `/api/operations/statuses/?business_date=${own.businessDate}&limit=500`,
          )
          const attachedIds = new Set(serverRows.filter((row) => row.participations.length > 0).map((row) => row.employee_id))
          expect(employeeIds.every((id) => attachedIds.has(id)), 'сервер не отдал собственные участия').toBe(true)
          const tail = own.rows.map((created) => serverRows.find((row) => row.id === created.id)!)
          expect(tail.every(Boolean), 'собственные статусы отсутствуют в полной выдаче').toBe(true)
          expect(tail).toHaveLength(2)

          // Pagination UI contract: use EVERY real API row and the real count.
          // Only their order changes: 500 owned background rows first, the two
          // owned named participations last. Existing stand statuses stay intact.
          const firstPage = background.map((created) => serverRows.find((row) => row.id === created.id)!)
          expect(firstPage).toHaveLength(500)
          expect(firstPage.every(Boolean), 'API потерял собственные фоновые статусы').toBe(true)
          expect(firstPage.every((row) => !employeeIds.includes(row.employee_id))).toBe(true)
          const firstIds = new Set(firstPage.map((row) => row.id))
          const tailIds = new Set(tail.map((row) => row.id))
          const ordered = [
            ...firstPage,
            ...serverRows.filter((row) => !firstIds.has(row.id) && !tailIds.has(row.id)),
            ...tail,
          ]
          expect(ordered.map((row) => row.id).sort((a, b) => a - b))
            .toEqual(serverRows.map((row) => row.id).sort((a, b) => a - b))
          expect(new Set(ordered.map((row) => row.id)).size).toBe(serverRows.length)
          expect(tail.every((row) => ordered.findIndex((item) => item.id === row.id) >= 500)).toBe(true)
          const expectedOffsets = Array.from({ length: Math.ceil(ordered.length / 500) }, (_, index) => index * 500)
          expect(expectedOffsets.length, 'проба не создала вторую страницу').toBeGreaterThan(1)
          const offsets: number[] = []
          await page.route(
            (url) => url.pathname === '/api/operations/statuses/' &&
              url.searchParams.get('business_date') === own.businessDate,
            async (route) => {
              const url = new URL(route.request().url())
              expect(route.request().method()).toBe('GET')
              expect(url.searchParams.get('limit'), 'клиент должен использовать limit, не page_size').toBe('500')
              const offset = Number(url.searchParams.get('offset') ?? '0')
              expect(expectedOffsets, 'запрошена несуществующая страница').toContain(offset)
              offsets.push(offset)
              const pageUrl = (value: number) => {
                const next = new URL(url)
                next.searchParams.set('offset', String(value))
                return next.toString()
              }
              await route.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({
                  count: ordered.length,
                  next: offset + 500 < ordered.length ? pageUrl(offset + 500) : null,
                  previous: offset === 0 ? null : pageUrl(offset - 500),
                  results: ordered.slice(offset, offset + 500),
                }),
              })
            },
          )

          await signIn(page, STAND_USERNAME, STAND_PASSWORD)
          await page.goto('/statuses')
          await hydrated(page)
          await tableFilled(page)
          await page.getByPlaceholder('Поиск по ФИО').fill(scene.search)
          const ownRows = page.locator('table tbody tr[data-employee-id]')
          await expect(ownRows).toHaveCount(2)
          for (const id of employeeIds) {
            await expect(
              page.locator(`table tbody tr[data-employee-id="${id}"]`).locator(
                `a[href="/security-ops/events/${own.eventId}"], a[href="/security-ops/events/${own.eventId}/"]`,
              ),
              `собственное участие ${id} после первой страницы не доехало`,
            ).toBeVisible({ timeout: 20_000 })
          }
          expect(offsets[0]).toBe(0)
          expect([...offsets].sort((a, b) => a - b), 'клиент запросил не все страницы или продублировал их')
            .toEqual(expectedOffsets)

          const visible = await ownRows.evaluateAll((rows) => rows.map((row) => ({
            id: Number(row.getAttribute('data-employee-id')),
            shown: row.querySelector('a[href^="/security-ops/events/"]') !== null ||
              (row.textContent ?? '').includes('ОМ снят'),
          })))
          expect(visible.map((row) => row.id).sort((a, b) => a - b)).toEqual([...employeeIds].sort((a, b) => a - b))
          const shouldHaveLink = visible.filter((row) => attachedIds.has(row.id))
          expect(shouldHaveLink, 'ассерт о полном покрытии стал вакуумным').toHaveLength(2)
          const missing = shouldHaveLink.filter((row) => !row.shown).map((row) => row.id)
          expect(missing, `сервер знает участия ${missing.join(', ')}, но клиент забрал не все страницы`).toEqual([])
        })
      })
    })
  })

  test('без известного мероприятия «Участие в ОМ» ведёт на общий разрез и говорит об этом', async ({
    page,
  }) => {
    /**
     * 🔴 Фикстура — ПЕРЕХВАТ, не мутация стенда: `EmployeeStatus.StatusType`
     * на бэке `staff_unit/staff-units/directorate/` вообще не знает кода
     * `IN_EVENT` — это код каталога `operations` (раздел «Сбор сил на
     * ОМ», см. `seed_status_types.py`), другая модель. На живом стенде такой
     * строки быть не может в принципе — только перехватом.
     */
    // 🔴 КОД СЛИТ (Plane №486, починка №754). Здесь стоял `EVENT_ASSIGNMENT` —
    // тип, который миграция 0091 погасила (`is_active=False`), а
    // `/api/statuses/types/` отдаёт только активные. Проба искала его подпись
    // в справочнике, не находила и краснела на КАЖДОМ прогоне смоука — не на
    // своём предмете, а на чужой миграции. Наследник обоих кодов — `IN_EVENT`.
    const IN_EVENT = 'IN_EVENT'
    // 🔴 ПИН ПОДПИСИ ИЗМЕНЁН ОСОЗНАННО ВТОРОЙ РАЗ (Plane №281; первый — №274,
    // Ш-5). Прежний текст — «Мероприятия участия видны в разрезе „Сбор сил“» —
    // описывал состояние, когда мероприятие СИСТЕМЕ ИЗВЕСТНО, а экрану нет:
    // теперь известно и ему, и в строке стоит ссылка на карточку конкретного
    // ОМ. Общий разрез остался ровно для случая, который эта проба и
    // воспроизводит: кадровый статус говорит «участвует», а участий у
    // сотрудника нет — статус проставлен без привязки (так заводили до Ш-3).
    // Подпись теперь называет ИМЕННО ЭТО, а не место, где искать.
    const CAPTION = 'Мероприятие у статуса не указано'

    await page.route(
      // 🔴 ТОЛЬКО ЗАПРОС СТРАНИЦЫ, не сводки. С 28.08.2026 экран статусов
      // просит у той же ручки ещё и сводку (`with_summary=1&page_size=1`,
      // Plane №231): в её теле одна строка, и перехват, правивший «первых
      // двух со статусом», падал на собственном стороже против вакуума.
      (url) =>
        url.pathname.includes('/api/staff_unit/staff-units/directorate') &&
        url.searchParams.get('with_summary') === null,
      async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as {
          staff_units?: {
            employee?: { current_status?: Record<string, unknown> | null } | null
          }[]
        }
        const withStatus = (body.staff_units ?? []).filter(
          (unit) => unit.employee?.current_status != null,
        )
        expect(
          withStatus.length,
          'на стенде меньше двух сотрудников со статусом — вакуумный гвард не на чем проверить',
        ).toBeGreaterThan(1)

        // Только ПЕРВОМУ — «Участие в ОМ»: остальные остаются как есть, иначе
        // гвард «ссылка не у всех» вырождается в «ни у кого».
        withStatus[0].employee!.current_status!.status_type = IN_EVENT
        await route.fulfill({ response, json: body })
      },
    )

    // 🔴 ВТОРОЙ ПЕРЕХВАТ — ПУСТЫЕ УЧАСТИЯ (Plane №281). Без него проба зависела
    // бы от данных стенда: у сотрудника, которому она подменяет кадровый код,
    // в разделе ОМ вполне может быть живое участие, и тогда экран — правильно
    // — покажет ссылку на КОНКРЕТНОЕ мероприятие вместо общего разреза.
    // Проверяется здесь именно запасная ветка, поэтому «мероприятий нет»
    // задаётся явно, а не выпрашивается у стенда.
    await page.route(
      (url) => url.pathname.includes('/api/operations/statuses'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
        })
      },
    )

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    const rows = page.locator('table tbody tr')
    const rowCount = await rows.count()
    expect(rowCount, 'таблица пуста — пробе не на чем стоять').toBeGreaterThan(1)

    const links = page.getByRole('link', { name: '→ Сбор сил' })
    // 🔴 ССЫЛОК МОЖЕТ БЫТЬ БОЛЬШЕ ОДНОЙ (Plane №378). Пин «ровно одна» стоял
    // от времени, когда участием считались два кода из трёх: подменённая
    // строка была единственной. С добавлением `IN_EVENT` в общий список
    // ссылку законно получают и живые строки стенда с «Участием в ОМ» —
    // проба падала на ПРАВИЛЬНОМ поведении. Предмет пробы не в числе ссылок,
    // а в том, что ссылка есть у подменённой строки и НЕ у каждой; оба
    // условия проверены ниже.
    await expect(links.first()).toBeVisible()
    // `next.config.js` несёт `trailingSlash: true` — рендер добавляет слэш
    // перед строкой запроса (как и у соседней ссылки в PlacementStage.tsx,
    // см. `events-registry.spec.ts:170`); адрес назначения от этого не
    // меняется, поэтому слэш здесь необязательный, а не расплывчатый.
    await expect(links.first()).toHaveAttribute('href', /^\/employees\/?\?view=forces$/)

    // 🔴 Вакуумный гвард: если бы ссылка рисовалась у КАЖДОЙ строки, предикат
    // «только у «Участие в ОМ»» был бы сломан и остался незамеченным —
    // «есть ссылка» превратилось бы в «есть таблица».
    expect(
      rowCount - (await links.count()),
      'ссылка есть у каждой строки — предикат статуса её не фильтрует',
    ).toBeGreaterThan(0)

    // Строки без известного мероприятия: подменённая точно есть, а с №378
    // такие же могут стоять и на самом стенде (живой статус «Участие в ОМ»,
    // заведённый без привязки). Проба требует ХОТЯ БЫ одну и проверяет, что у
    // КАЖДОЙ такой строки ссылка ведёт на общий разрез — это и есть предмет.
    const row = rows.filter({ hasText: CAPTION })
    const rowsWithoutEvent = await row.count()
    expect(
      rowsWithoutEvent,
      'подменённая строка не нашлась — перехват не сработал',
    ).toBeGreaterThan(0)
    for (let index = 0; index < rowsWithoutEvent; index += 1) {
      await expect(
        row.nth(index).getByRole('link', { name: '→ Сбор сил' }),
        'у строки без известного мероприятия ссылка ведёт на общий разрез',
      ).toHaveCount(1)
    }
    // 🔴 ПИН ПОДПИСИ ПОДНЯТ ОСОЗНАННО (Plane №366). Здесь стояло «Участие в
    // ОМ» — литерал, который клиент печатал САМ веточкой на два кода
    // (`describeStatus` в `status-table.tsx`), одинаково для наряда и для
    // боевой группы. Веточка снята: подпись приходит из справочника, а он эти
    // два вида различает («…(наряд)» и «…(боевая группа)») — как их различает
    // и сам заказчик, который справочник и правит.
    //
    // Ожидание берётся ИЗ СПРАВОЧНИКА, а не вписывается строкой: заказчик
    // вправе переименовать тип в админке завтра, и пин обязан краснеть на
    // поломке вывода, а не на переименовании. Ссылка «→ Сбор сил» по-прежнему
    // проверена ВЫШЕ и по-прежнему стоит у обоих кодов — «тот же вид работы»
    // держится предикатом по коду, а не совпадением подписей.
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const catalog = (await (
      await fetch(`${API}/api/statuses/types/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as Array<{ code: string; label: string }>
    const assignmentLabel = catalog.find((item) => item.code === IN_EVENT)?.label
    expect(
      assignmentLabel,
      `в справочнике нет кода ${IN_EVENT} — сверять подпись не с чем`,
    ).toBeTruthy()
    // `.first()` — не послабление, а следствие слияния №486: подпись «Участие
    // в ОМ» стоит в строке ДВАЖДЫ (бейдж статуса и колонка «По разделу ОМ»),
    // и до слияния они различались («…(наряд)» против общей). Предмет
    // проверки прежний: подпись пришла ИЗ СПРАВОЧНИКА, а не напечатана
    // клиентом своим литералом.
    await expect(
      row.getByText(assignmentLabel!, { exact: true }).first(),
      'подпись статуса разошлась со справочником — вывод снова печатает свой литерал',
    ).toBeVisible()
  })

  test('кадровая таблица не выдаёт сегодняшнее число за дату у всех', async ({ page }) => {
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    // 🔴 АДРЕС С `?view=forces` ЯВНО (Plane №273). Вид по умолчанию сменился на
    // «Ежедневный расход организации» — решение заказчика о порядке вкладок; без
    // параметра эта проба открывала бы борд расхода, а проверяет она реестр.
    await page.goto('/employees?view=forces')
    await hydrated(page)
    await tableFilled(page)

    const values = await column(page, 'Статус с')
    expect(values.length, 'таблица сотрудников пуста — проба вакуумна').toBeGreaterThan(1)

    // Колонка звалась «Дата найма», а несла начало текущего статуса с
    // фолбэком `new Date()`: у всех строк стояло сегодняшнее число.
    const todayRu = new Date().toLocaleDateString('ru-RU')
    expect(
      values.every((value) => value === todayRu),
      `все строки показывают сегодняшнюю дату (${todayRu}) — вернулся фолбэк «сегодня»`,
    ).toBe(false)
    expect(new Set(values).size, 'колонка одинакова во всех строках').toBeGreaterThan(1)

    // Колонки «Контакты» нет: телефон и почту эта ручка не отдаёт вовсе, а
    // подпись поля с пустым значением читается как «не заполнено».
    const heads = await page.evaluate(() =>
      [...document.querySelectorAll('table thead th')].map((th) => th.textContent?.trim() ?? ''),
    )
    expect(heads).not.toContain('Контакты')
  })

  test('«Дата найма» — своя дата, а не начало статуса', async ({ page }) => {
    /**
     * Колонка прототипа вернулась, но уже со своим источником: ручка штатки
     * теперь кладёт `hire_date` из модели. Раньше под этой подписью ехало
     * начало ТЕКУЩЕГО СТАТУСА — отсюда её и сняли.
     *
     * 🔴 Проба обязана СРАВНИТЬ две колонки между собой. Ассерт «даты найма
     * различаются» зеленел бы и на прежней подмене: начала статусов тоже
     * разные. Отличает подмену только то, что у одного и того же человека
     * «Статус с» и «Дата найма» — РАЗНЫЕ дни.
     */
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const raw = await fetch(`${API}/api/staff_unit/staff-units/directorate/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await raw.json()) as {
      staff_units: {
        employee: {
          hire_date?: string | null
          rank?: string | null
          iin_masked?: string | null
          current_status: StatusBrief | null
        } | null
      }[]
    }
    const people = body.staff_units
      .map((unit) => unit.employee)
      .filter((employee): employee is NonNullable<typeof employee> => employee != null)

    expect(people.length, 'на стенде нет сотрудников — проба вакуумна').toBeGreaterThan(1)
    const hired = people.map((p) => p.hire_date).filter((v): v is string => !!v)
    expect(hired.length, 'ручка не отдаёт hire_date — колонке неоткуда взяться').toBe(people.length)
    expect(new Set(hired).size, 'дата найма одинакова у всех — проба не различает поля')
      .toBeGreaterThan(1)

    // Гвард против вакуума ГЛАВНОГО ассерта: хотя бы у одного человека дата
    // найма обязана отличаться от начала его статуса. Если совпадут все,
    // подмену полей ничем не поймать.
    const differing = people.filter(
      (p) => p.hire_date && p.current_status?.start_date && p.hire_date !== p.current_status.start_date,
    )
    expect(
      differing.length,
      'ни у кого дата найма не отличается от начала статуса — подмену не отличить',
    ).toBeGreaterThan(0)

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    // 🔴 АДРЕС С `?view=forces` ЯВНО (Plane №273). Вид по умолчанию сменился на
    // «Ежедневный расход организации» — решение заказчика о порядке вкладок; без
    // параметра эта проба открывала бы борд расхода, а проверяет она реестр.
    await page.goto('/employees?view=forces')
    await hydrated(page)
    await tableFilled(page)

    const heads = await page.evaluate(() =>
      [...document.querySelectorAll('table thead th')].map((th) => th.textContent?.trim() ?? ''),
    )
    expect(heads).toContain('Дата найма')
    expect(heads).toContain('Статус с')

    const hiredColumn = await column(page, 'Дата найма')
    const sinceColumn = await column(page, 'Статус с')
    expect(hiredColumn.length).toBeGreaterThan(1)
    expect(new Set(hiredColumn).size, 'колонка «Дата найма» одинакова во всех строках')
      .toBeGreaterThan(1)
    // Две колонки не совпадают построчно — значит в правой не копия левой.
    expect(
      hiredColumn.some((value, index) => value !== sinceColumn[index]),
      '«Дата найма» построчно повторяет «Статус с» — вернулась подмена полей',
    ).toBe(true)
  })

  test('под именем стоит звание, а не пустая строка', async ({ page }) => {
    /**
     * Подстрока прототипа. На её месте печаталось поле `manager`, которому
     * ручка штатки не даёт источника: во ВСЕХ строках стояла пустая строка.
     */
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const raw = await fetch(`${API}/api/staff_unit/staff-units/directorate/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await raw.json()) as {
      staff_units: { employee: { last_name: string; rank?: string | null } | null }[]
    }
    const people = body.staff_units
      .map((unit) => unit.employee)
      .filter((employee): employee is NonNullable<typeof employee> => employee != null)

    const ranked = people.filter((p) => !!p.rank)
    expect(ranked.length, 'ни у кого на стенде нет звания — проба вакуумна').toBeGreaterThan(0)
    // Гвард против «звание у всех одинаковое»: тогда ассерт ниже не отличит
    // живое поле от подставленной константы.
    expect(new Set(ranked.map((p) => p.rank)).size, 'звание одинаково у всех — проба вырождена')
      .toBeGreaterThan(1)

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    // 🔴 АДРЕС С `?view=forces` ЯВНО (Plane №273). Вид по умолчанию сменился на
    // «Ежедневный расход организации» — решение заказчика о порядке вкладок; без
    // параметра эта проба открывала бы борд расхода, а проверяет она реестр.
    await page.goto('/employees?view=forces')
    await hydrated(page)
    await tableFilled(page)

    const names = await column(page, 'ФИО')
    expect(names.length).toBeGreaterThan(1)
    // Каждое звание стоит в строке СВОЕГО человека, а не «где-то в таблице».
    for (const person of ranked.slice(0, 3)) {
      const cell = names.find((value) => value.includes(person.last_name))
      expect(cell, `строки ${person.last_name} нет в таблице`).toBeTruthy()
      expect(cell, `под именем ${person.last_name} нет звания «${person.rank}»`).toContain(
        person.rank!,
      )
    }
  })

  test('ИИН печатается хвостом — фикстура перехватом', async ({ page }) => {
    /**
     * 🔴 Фикстура НЕ берётся из данных стенда: у сотрудников подразделения
     * `admin` ИИН не заполнен ни у кого, и проба «хвост напечатан» была бы
     * вакуумной — она молча проверяла бы пустоту.
     *
     * Маскирование как таковое стережёт бэк
     * (`test_directorate_personnel_fields.py`): там и полного ИИН нет во всём
     * теле ответа, и короткое значение скрывается целиком. Здесь проверяется
     * ровно одно — что фронт ПЕЧАТАЕТ пришедший хвост, а не роняет его.
     *
     * Перехват по предикату, а не по глобу: путь заканчивается слэшем, и
     * `/**` его не ловит.
     */
    const TAIL = '•••••• 4216'
    const served = new Set<string>()
    await page.route(
      (url) => url.pathname.endsWith('/staff-units/directorate/'),
      async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as {
          staff_units: { employee: { iin_masked?: string | null } | null }[]
        }
        const first = body.staff_units.find((unit) => unit.employee != null)
        expect(first, 'в ответе нет ни одного сотрудника — перехват нечего править').toBeTruthy()
        first!.employee!.iin_masked = TAIL
        served.clear()
        for (const unit of body.staff_units) {
          const masked = unit.employee?.iin_masked
          if (masked != null && masked !== '') served.add(masked)
        }
        await route.fulfill({ response, json: body })
      },
    )

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    // 🔴 АДРЕС С `?view=forces` ЯВНО (Plane №273). Вид по умолчанию сменился на
    // «Ежедневный расход организации» — решение заказчика о порядке вкладок; без
    // параметра эта проба открывала бы борд расхода, а проверяет она реестр.
    await page.goto('/employees?view=forces')
    await hydrated(page)
    await tableFilled(page)

    const names = await column(page, 'ФИО')
    const withTail = names.filter((cell) => cell.includes(`ИИН ${TAIL}`))
    expect(withTail.length, 'хвост ИИН не напечатан ни в одной строке').toBe(1)

    /**
     * Остальным ИИН не выдуман. Раньше здесь стояло «ни в одной другой строке
     * слова ИИН нет» — и это держалось на том, что на стенде ИИН не заполнен
     * ни у кого (27.08.2026 сид №204 заполнил его у 426 человек, и проба стала
     * красной, ничего не сломав по существу). Проверяется то же самое, но по
     * существу: КАЖДЫЙ напечатанный хвост пришёл из ответа ручки.
     */
    const printed = names
      .filter((cell) => cell.includes('ИИН'))
      .map((cell) => cell.slice(cell.indexOf('ИИН') + 'ИИН'.length).trim())
    expect(printed.length, 'хвостов на экране меньше, чем строк с ИИН в ответе').toBeGreaterThan(0)
    const invented = printed.filter((tail) => !served.has(tail))
    expect(invented, `фронт напечатал хвост, которого не было в ответе: ${invented.join(', ')}`).toEqual(
      [],
    )
  })

  test('«Экспорт CSV» выгружает ВЕСЬ ОТБОР, а не показанную страницу', async ({ page }) => {
    /**
     * Кнопка была без обработчика вовсе; потом собирала файл из загруженного
     * списка. С 27.08.2026 реестр листается по пятьдесят строк (Plane №228), и
     * проба переписана под это:
     *
     * 🔴 «В файле есть строки» вакуумно — зеленеет и на выгрузке страницы.
     * Отличает одно от другого ровно одно: строк в файле СТОЛЬКО ЖЕ, сколько
     * сервер насчитал по отбору («Показано N из M» — берётся M), и это число
     * БОЛЬШЕ страницы. Иначе человек, нажавший «Экспорт» на пяти тысячах
     * сотрудников, получил бы полсотни и не узнал бы об этом.
     */
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    // 🔴 АДРЕС С `?view=forces` ЯВНО (Plane №273). Вид по умолчанию сменился на
    // «Ежедневный расход организации» — решение заказчика о порядке вкладок; без
    // параметра эта проба открывала бы борд расхода, а проверяет она реестр.
    await page.goto('/employees?view=forces')
    await hydrated(page)
    await tableFilled(page)

    const allNames = await column(page, 'ФИО')
    expect(allNames.length, 'таблица пуста — проба вакуумна').toBeGreaterThan(2)

    // Отбор по фамилии первого человека: он обязан отсечь хоть кого-то, иначе
    // «отобранное» неотличимо от «всего».
    const firstSurname = allNames[0].split('\n')[0].trim().split(' ')[0]
    // `view=forces` НЕ ТЕРЯЕТСЯ при переходе с отбором: без него адрес
    // открывает расход организации, и «отобранный реестр» проверять негде.
    await page.goto(
      `/employees?view=forces&search=${encodeURIComponent(firstSurname)}`,
    )
    await hydrated(page)
    await tableFilled(page)

    const counter = await page.locator('text=/Показано \\d+ из \\d+/').first().innerText()
    const [shown, matched] = counter.match(/\d+/g)!.map(Number)
    expect(matched, 'отбор ничего не нашёл').toBeGreaterThan(0)

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Экспорт CSV/ }).click(),
    ]).then(([event]) => event)

    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const csv = Buffer.concat(chunks).toString('utf8')

    const lines = csv.trim().split('\r\n')
    expect(lines[0], 'в файле нет шапки').toContain('Дата найма')
    expect(
      lines.length - 1,
      `в файле ${lines.length - 1} строк, а отбору отвечает ${matched}: выгружена страница, а не отбор`,
    ).toBe(matched)
    expect(csv).toContain(firstSurname)

    // Имя, которого в отборе нет, в файл не попадает. Берём его из полного
    // списка: там есть люди с другими фамилиями.
    const alien = allNames
      .map((cell) => cell.split('\n')[0].trim().split(' ')[0])
      .find((surname) => surname !== firstSurname && !surname.startsWith(firstSurname))
    expect(alien, 'на стенде все однофамильцы — проба вырождена').toBeTruthy()
    expect(csv, `в файл попало отсечённое отбором имя «${alien}»`).not.toContain(alien!)

    // И «показано» на экране — это страница, а не весь отбор: если они равны,
    // страниц нет, и проба ничего не сторожит.
    expect(shown).toBeLessThanOrEqual(matched)
  })

  test('в строке реестра стоит аватарка, а без фотографии — инициалы', async ({ page }) => {
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    await withOwnTablePeople(token, 2, async (scene) => {
      const [photoEmployee, fallbackEmployee] = scene.people
      const mediaPath = `/media/employees/photos/e2e_${photoEmployee.id}_${randomUUID()}.png`
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      )
      const calls = { realPages: 0, overlays: 0, photoGets: 0 }

      // UI contract, not an employee-upload or stand media-serving probe.
      // Fetch the real filtered page and change only photo_url of our record.
      // IDs, names, pagination and the second employee's empty photo stay real.
      await page.route(
        (url) => url.pathname === '/api/staff_unit/staff-units/directorate/' &&
          url.searchParams.get('with_summary') === null &&
          url.searchParams.get('search') === scene.search,
        async (route) => {
          expect(route.request().method()).toBe('GET')
          const response = await route.fetch()
          expect(response.status(), 'реальная страница собственных сотрудников недоступна').toBe(200)
          const body = (await response.json()) as {
            matched_count: number
            staff_units: { employee: OwnTablePerson & { photo_url: string | null; photo?: string | null } }[]
          }
          calls.realPages += 1
          expect(body.matched_count).toBe(2)
          expect(body.staff_units.map((unit) => unit.employee.id).sort((a, b) => a - b))
            .toEqual(scene.people.map((person) => person.id).sort((a, b) => a - b))
          for (const person of scene.people) {
            const employee = body.staff_units.find((unit) => unit.employee.id === person.id)!.employee
            expect(employee.first_name).toBe(person.first_name)
            expect(employee.last_name).toBe(person.last_name)
            expect(employee.photo_url, 'собственная новая запись неожиданно уже с фото').toBeNull()
            expect(employee.photo ?? null).toBeNull()
          }
          body.staff_units.find((unit) => unit.employee.id === photoEmployee.id)!.employee.photo_url = mediaPath
          calls.overlays += 1
          await route.fulfill({ response, json: body })
        },
      )
      await page.route(
        (url) => url.pathname === mediaPath,
        async (route) => {
          expect(route.request().method()).toBe('GET')
          calls.photoGets += 1
          await route.fulfill({ status: 200, contentType: 'image/png', body: png })
        },
      )

      await signIn(page, STAND_USERNAME, STAND_PASSWORD)
      await page.goto(`/employees?view=forces&search=${encodeURIComponent(scene.search)}`)
      await hydrated(page)
      await tableFilled(page)
      const rows = page.locator('table tbody tr[data-employee-id]')
      await expect(rows, 'поиск не вернул две собственные записи').toHaveCount(2)
      for (const employee of scene.people) {
        await expect(page.locator(`table tbody tr[data-employee-id="${employee.id}"]`))
          .toContainText(`${employee.last_name} ${employee.first_name}`)
      }

      const photoRow = page.locator(`table tbody tr[data-employee-id="${photoEmployee.id}"]`)
      const fallbackRow = page.locator(`table tbody tr[data-employee-id="${fallbackEmployee.id}"]`)
      const avatars = rows.locator('img[src*="/media/"]')
      await expect(photoRow.locator('img[src*="/media/"]'), 'собственная аватарка не появилась')
        .toBeVisible({ timeout: 20_000 })
      await expect(avatars).toHaveCount(1)
      const image = await avatars.first().evaluate((img) => ({
        src: (img as HTMLImageElement).src,
        width: (img as HTMLImageElement).naturalWidth,
        alt: (img as HTMLImageElement).alt,
      }))
      expect(new URL(image.src).origin, 'относительный media URL должен идти через origin приложения')
        .toBe(new URL(page.url()).origin)
      expect(new URL(image.src).pathname).toBe(mediaPath)
      expect(image.width, 'аватарка не декодировалась').toBeGreaterThan(0)
      expect(image.alt, 'декоративная аватарка повторяет имя для скринридера').toBe('')
      const broken = await avatars.evaluateAll((images) => images.filter((img) =>
        (img as HTMLImageElement).naturalWidth === 0).length)
      expect(broken, 'реестр содержит битую аватарку').toBe(0)

      await expect(fallbackRow.locator('img')).toHaveCount(0)
      const fallback = fallbackRow.locator('[data-slot="avatar-fallback"]')
      await expect(fallback, 'у сотрудника без фотографии нет инициалов').toBeVisible()
      await expect(fallback).toHaveText('ПБ')
      expect((await fallback.innerText()).trim()).toMatch(/^[А-ЯЁA-Z]{1,2}$/)
      expect(calls, 'реальный GET, проекция фото и отдельный media GET должны быть использованы ровно один раз')
        .toEqual({ realPages: 1, overlays: 1, photoGets: 1 })
    })
  })
})
