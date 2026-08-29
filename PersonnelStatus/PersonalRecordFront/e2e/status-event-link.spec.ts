/**
 * Экран статусов называет МЕРОПРИЯТИЕ, на которое человек привлечён (Plane №281).
 *
 * До правки строка со статусом «Участие в ОМ» вела на ОБЩИЙ разрез «Сбор сил»:
 * система знала связь с конкретным ОМ с Ш-3 (`ops_status_participations`), но
 * наружу её не отдавала, и человек, увидев «участвует», шёл искать себя в
 * списках другого раздела.
 *
 * Проба заводит СВОЁ мероприятие и СВОЙ статус с участием — брать стендовое
 * нельзя: участий на стенде под девятьсот, и почти все ведут на ОМ, снесённые
 * уборкой проб (у таких имя пустое по построению — это отдельный, проверенный
 * в pytest случай).
 *
 * Держит две вещи, и каждая падает на своей мутации:
 *   1) в строке таблицы стоит ссылка на КАРТОЧКУ этого ОМ, подписанная его
 *      кодом (мутация «вернуть общую ссылку на /employees?view=forces» —
 *      красная);
 *   2) карточка сотрудника показывает блок «Привлечён на ОМ» с той же ссылкой
 *      (мутация «убрать блок» — красная).
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const EVENT_ASSIGNMENT = 'EVENT_ASSIGNMENT'

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: STAND_USERNAME,
      password: STAND_PASSWORD,
      json: 'true',
    },
  })
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /тему|theme/i }).first()).toBeEnabled({
    timeout: 20_000,
  })
}

interface Fixture {
  eventId: number
  eventCode: string
  employeeId: number
  employeeName: string
  /** Только фамилия: серверный поиск таблицы ищет ПО ОДНОМУ полю и на
   *  «Фамилия Имя» не находит ничего (проверено вручную: `?search=Абаев` — 1
   *  строка, `?search=Абаев Абай` — 0). Это отдельный дефект экрана, заведён
   *  карточкой; проба не вправе на нём падать, поэтому ищет фамилией. */
  employeeLastName: string
}

async function seed(token: string): Promise<Fixture> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload = await res.json().catch(() => ({}))
    return { status: res.status, payload }
  }

  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.payload.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  expect(object, 'на стенде нет объекта с опубликованным паспортом').toBeDefined()

  const report = (await call('GET', '/api/operations/strength-report/')).payload
  const businessDate: string = report.business_date
  const nextDay = new Date(`${businessDate}T00:00:00Z`)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)

  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба ссылки на ОМ (e2e)',
    objectId: object.id,
    businessDate,
    kind: 'INTERNAL',
  })
  expect(created.status, JSON.stringify(created.payload)).toBe(201)

  // Сотрудник берётся СВОБОДНЫЙ: на занятом сервер отобьёт пересечение
  // интервалов, и фикстура молча не завелась бы.
  const busyRows = await call(
    'GET',
    `/api/operations/statuses/?business_date=${businessDate}&page_size=500`,
  )
  const busy = new Set(
    (busyRows.payload.results ?? []).map((row: { employee_id: number }) => row.employee_id),
  )
  const people = await call('GET', '/api/core/employees/?page_size=200')
  const free = (people.payload.results ?? [])
    .map(
      (person: {
        id: string | number
        first_name?: string
        last_name?: string
      }) => ({
        id: Number(person.id),
        // ИМЕННО «Фамилия Имя», а не `full_name`: в справочнике полное имя
        // идёт с отчеством («Абенов Канат Ерланович»), а таблица печатает две
        // части — проба по `full_name` не находила строку, которая на экране
        // есть.
        name: `${person.last_name ?? ''} ${person.first_name ?? ''}`.trim(),
        lastName: person.last_name ?? '',
      }),
    )
    .find((person: { id: number }) => !busy.has(person.id))
  expect(free, 'на стенде нет сотрудника без статуса на день — привлекать некого').toBeDefined()

  const status = await call('POST', '/api/operations/statuses/', {
    employee_id: free.id,
    status_type_code: EVENT_ASSIGNMENT,
    date_start: businessDate,
    date_end: nextDay.toISOString().slice(0, 10),
    participations: [{ event_id: created.payload.id, kind_code: 'PHYSICAL_SQUAD' }],
  })
  expect(status.status, JSON.stringify(status.payload)).toBe(201)

  return {
    eventId: Number(created.payload.id),
    eventCode: String(created.payload.code),
    employeeId: free.id,
    employeeName: free.name,
    employeeLastName: free.lastName,
  }
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'статусы: адрес мероприятия' : 'статусы/ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('строка и карточка ведут на КОНКРЕТНОЕ мероприятие', async ({ page }) => {
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const fixture = await seed(token)

    await signIn(page)
    await page.goto('/statuses')
    await hydrated(page)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })

    // Строка ищется поиском по фамилии, а адресуется ПО ID: на стенде по
    // несколько полных тёзок («Абенов Канат» — четверо), и локатор по тексту
    // брал бы первого попавшегося, у которого статуса вовсе нет.
    await page.getByPlaceholder(/Поиск по ФИО/).fill(fixture.employeeLastName)
    const row = page.locator(`table tbody tr[data-employee-id="${fixture.employeeId}"]`)
    await expect(row).toBeVisible({ timeout: 20_000 })

    // (1) ССЫЛКА НА КАРТОЧКУ ОМ вместо общего разреза.
    const link = row.getByRole('link', { name: new RegExp(fixture.eventCode) })
    await expect(link, 'в строке нет ссылки на мероприятие с его кодом').toBeVisible()
    // Слэш на конце — дело конфига (`trailingSlash`), а не разметки: ссылка
    // пишется без него, а в DOM приезжает с ним. Проба сверяет АДРЕС, а не
    // способ его записи.
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(`^/security-ops/events/${fixture.eventId}/?$`),
    )

    // (2) КАРТОЧКА СОТРУДНИКА называет то же мероприятие.
    await row.getByRole('button', { name: /^Действия:/ }).click()
    await page.getByRole('menuitem', { name: 'Просмотр профиля' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Привлечён на ОМ')).toBeVisible({ timeout: 20_000 })
    await expect(
      dialog.getByRole('link', { name: new RegExp(fixture.eventCode) }),
    ).toHaveAttribute(
      'href',
      new RegExp(`^/security-ops/events/${fixture.eventId}/?$`),
    )
  })
})
