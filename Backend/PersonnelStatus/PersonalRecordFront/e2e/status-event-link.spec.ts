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
  /** Заведённый пробой статус: снимается в `afterEach`. */
  statusId: number | null
  eventId: number
  eventCode: string
  employeeId: number
  employeeName: string
  /** Табельный номер: он уникален, и отбор по нему даёт РОВНО ОДНУ строку.
   *  Поиск фамилией зависел бы от числа тёзок и от размера страницы. */
  employeePersonnelNumber: string
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

  // СОТРУДНИК ПОДБИРАЕТСЯ ПЕРЕБОРОМ, а не вычисляется списком занятых.
  // Список статусов на день отвечает про раздел ОМ, но пересечение сервер
  // считает шире (сюда попадают и «мягкие» конфликты, и соседние интервалы),
  // и «свободный по списку» получал 409 STATUS_OVERLAP_WARNING. Спрашиваем у
  // сервера, а не гадаем: первый, кого он принял, и есть свободный.
  const people = await call('GET', '/api/core/employees/?page_size=200')
  const candidates = (people.payload.results ?? []).map(
    (person: {
      id: string | number
      first_name?: string
      last_name?: string
      personnel_number?: string
    }) => ({
      id: Number(person.id),
      // ИМЕННО «Фамилия Имя», а не `full_name`: в справочнике полное имя идёт
      // с отчеством («Абенов Канат Ерланович»), а таблица печатает две части.
      name: `${person.last_name ?? ''} ${person.first_name ?? ''}`.trim(),
      // Поиск идёт по ТАБЕЛЬНОМУ НОМЕРУ, а не по фамилии: фамилия на стенде
      // не уникальна (полных тёзок по четверо), и отбор по ней даёт больше
      // строк, чем помещается на страницу — нужный человек оказывался на
      // второй, и проба падала «через раз».
      personnelNumber: person.personnel_number ?? '',
    }),
  )
  expect(candidates.length, 'справочник сотрудников пуст').toBeGreaterThan(0)

  let free: { id: number; name: string; personnelNumber: string } | undefined
  let statusId: number | null = null
  for (const candidate of candidates) {
    const status = await call('POST', '/api/operations/statuses/', {
      employee_id: candidate.id,
      status_type_code: EVENT_ASSIGNMENT,
      date_start: businessDate,
      date_end: nextDay.toISOString().slice(0, 10),
      participations: [
        { event_id: created.payload.id, kind_code: 'PHYSICAL_SQUAD' },
      ],
    })
    if (status.status === 201) {
      free = candidate
      statusId = Number(status.payload.id)
      break
    }
  }
  expect(
    free,
    'ни один сотрудник страницы не свободен на этот день — привлекать некого',
  ).toBeDefined()

  return {
    statusId,
    eventId: Number(created.payload.id),
    eventCode: String(created.payload.code),
    employeeId: free!.id,
    employeeName: free!.name,
    employeePersonnelNumber: free!.personnelNumber,
  }
}

/** Ссылки, подписанные «ОМ снят» — их не должно существовать вовсе. */
function section_removed_links(page: Page) {
  return page.getByRole('link', { name: /ОМ снят/ })
}

/** 🔴 ПРОБА УБИРАЕТ ЗА СОБОЙ. Заведённый статус участия живёт на стенде и
 *  после прогона: уборка `purge_probe_events` сносит пробные МЕРОПРИЯТИЯ, а
 *  статусы — нет. За полдня таких строк накопилось 42, и соседняя проба
 *  (`forces-gathering`, «Участие в ОМ») покраснела на расхождении счёта — не
 *  на дефекте кода, а на мусоре, оставленном пробами. Отмена, а не удаление:
 *  в разделе строки не удаляются, а отменяются, и отменённая для читателя —
 *  «записи нет». */
let seededStatusId: number | null = null

test.afterEach(async () => {
  if (seededStatusId === null) return
  const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
  await fetch(`${API}/api/operations/statuses/${seededStatusId}/cancel/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'Уборка пробы №281' }),
  })
  seededStatusId = null
})

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'статусы: адрес мероприятия' : 'статусы/ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('строка и карточка ведут на КОНКРЕТНОЕ мероприятие', async ({ page }) => {
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const fixture = await seed(token)
    seededStatusId = fixture.statusId

    await signIn(page)
    await page.goto('/statuses')
    await hydrated(page)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })

    // Строка ищется по ТАБЕЛЬНОМУ НОМЕРУ (он уникален), а адресуется по id:
    // на стенде по несколько полных тёзок, и локатор по тексту брал бы
    // первого попавшегося, у которого статуса вовсе нет.
    await page.getByPlaceholder(/Поиск по ФИО/).fill(fixture.employeePersonnelNumber)
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

    // (1б) У СНЯТОГО ОМ ССЫЛКИ НЕТ. Участие переживает удаление мероприятия
    // (ссылка в модели плоская), и переход на его карточку вёл бы в 404 —
    // интерфейс обещал бы то, чего нет. Проверяется по всей таблице: такие
    // строки на стенде есть всегда (уборка проб сносит ОМ, оставляя участия).
    const removed = section_removed_links(page)
    await expect(
      removed,
      'у снятого мероприятия строка сделана ссылкой — она ведёт в 404',
    ).toHaveCount(0)

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
