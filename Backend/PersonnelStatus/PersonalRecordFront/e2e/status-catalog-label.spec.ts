/**
 * Статус, заведённый заказчиком в справочнике, ПОДПИСЫВАЕТСЯ САМ — ЖИВОЙ стенд
 * (Plane №366, Ш-1 задачи №365).
 *
 * ЖАЛОБА ЗАКАЗЧИКА ДОСЛОВНО: «У сотрудника когда меняешь статус на Участие на
 * ОМ, то потом не показывается как другие статусы».
 *
 * ЧТО ЗА ЭТИМ СТОЯЛО. №354 отдал список типов справочнику: в окне планирования
 * шестнадцать выбираемых типов, и пять из них (`BEFORE_DUTY`, `GEV`,
 * `IN_EVENT`, `EVENT_ASSIGNMENT`, `EVENT_ASSIGNMENT_GROUP`) своего legacy-кода
 * не имеют — в базу они ложатся собственными кодами. А ВЫВОД остался на старой
 * таблице тринадцати кадровых кодов, и `getEmployeeStatusLabel` отвечал на них
 * «Не обновлено»: строка утверждала, что человека не отметили, тогда как его
 * отметили — просто типом, которого клиент не знал.
 *
 * 🔴 ПОЧЕМУ ПОДПИСЬ НЕ ПРИБИТА ЗДЕСЬ СТРОКОЙ. Проба спрашивает подпись у того
 * же справочника, что и экран, и сравнивает экран с НИМ. Прибей я сюда
 * «Участие в ОМ» — проба стерегла бы русский текст, который заказчик вправе
 * переименовать в админке завтра, и краснела бы на переименовании вместо
 * поломки. Стережётся правило: «на экране то, что в справочнике», — и
 * отдельно то, что это НЕ «Не обновлено».
 *
 * МУТАЦИЯ, КОТОРУЮ ПРОБА ЛОВИТ: вернуть `naming.labelOf` на таблицу
 * `EMPLOYEE_STATUS_LABELS` (или снять `useStatusNaming` из `status-table.tsx`)
 * — бейдж снова читается «Не обновлено», и падает второй ассерт.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { probeComment } from './probe-statuses'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

/** Код каталога БЕЗ legacy-пары — ровно тот случай, на который жаловались. */
const CATALOG_ONLY_CODE = 'IN_EVENT'

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

const iso = (date: Date): string => date.toISOString().slice(0, 10)

const shifted = (days: number): Date => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date
}

interface StaffRow {
  id: number
  employee: { id: number; last_name: string; first_name: string } | null
}

/** Строки статусов сотрудника, суженные серверным фильтром (Plane №289). */
async function statusesOf(
  token: string,
  employeeId: number,
  state: 'active' | 'planned',
): Promise<{ count: number; results: Array<{ status_type: string }> }> {
  const res = await fetch(
    `${API}/api/statuses/statuses/?employee=${employeeId}&state=${state}&page_size=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  expect(res.status, 'список статусов не отвечает — без него подопытного не выбрать').toBe(200)
  return (await res.json()) as { count: number; results: Array<{ status_type: string }> }
}

/** Подпись кода ПО СПРАВОЧНИКУ — тот же источник, что и у экрана. */
async function catalogLabel(token: string, code: string): Promise<string> {
  const res = await fetch(`${API}/api/statuses/types/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status, 'справочник типов не отвечает — сверять экран не с чем').toBe(200)
  const rows = (await res.json()) as Array<{ code: string; label: string }>
  const row = rows.find((item) => item.code === code)
  expect(
    row,
    `в справочнике нет кода ${code} — либо его выключили, либо каталог подменили; ` +
      `проба обязана упасть здесь, а не показать зелень на пустом месте`,
  ).toBeTruthy()
  return row!.label
}

/**
 * Сотрудник, которому проба заводит статус типом ИЗ СПРАВОЧНИКА.
 *
 * Подопытный ПРИВОДИТСЯ в нужное состояние, а не ищется среди подходящих:
 * человек с запланированными или чужими действующими статусами получит отказ
 * по пересечению, и «сервер не дал» читалось бы как дефект вывода. Условие
 * отбора ровно то, что нужно вставке: запланированных нет, среди действующих —
 * только «В строю» (этот тип уступает место сам).
 */
async function seedCatalogStatus(
  token: string,
): Promise<{ fullName: string }> {
  const raw = await fetch(`${API}/api/staff_unit/staff-units/directorate/?page=1&page_size=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await raw.json()) as { staff_units: StaffRow[] }
  const rows = body.staff_units.filter((row) => row.employee !== null)
  expect(rows.length, 'на стенде нет ни одного занятого места — фикстуру некому завести').toBeGreaterThan(0)

  const rejected: string[] = []
  for (const row of rows) {
    const employee = row.employee!
    // Два запроса, а не один с разбором `state` на клиенте: фильтр `state`
    // серверный и проверен соседней пробой (№255), а «занятость» человека —
    // это ровно два разных вопроса, планы и действующее.
    const planned = await statusesOf(token, employee.id, 'planned')
    if (planned.count > 0) {
      rejected.push(`${employee.id}: запланированных ${planned.count}`)
      continue
    }
    const active = await statusesOf(token, employee.id, 'active')
    const foreign = active.results.filter((item) => item.status_type !== 'in_service')
    if (foreign.length > 0) {
      rejected.push(`${employee.id}: действует ${foreign.map((s) => s.status_type).join(', ')}`)
      continue
    }

    const res = await fetch(`${API}/api/statuses/statuses/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        employee: employee.id,
        status_type: CATALOG_ONLY_CODE,
        start_date: iso(new Date()),
        end_date: iso(shifted(3)),
        comment: probeComment('Проба №366'),
      }),
    })
    const payload = await res.text()
    // Отказ на ОТОБРАННОМ человеке — расхождение правила отбора с правилом
    // сервера, и молчать о нём нельзя: проба снова начала бы перебирать людей
    // и зависеть от того, кто попался.
    expect(
      res.status,
      `сотруднику ${employee.id} без чужих статусов сервер отказал завести ` +
        `${CATALOG_ONLY_CODE}: ${payload}`,
    ).toBe(201)
    return { fullName: `${employee.last_name} ${employee.first_name}` }
  }

  throw new Error(
    `свободного сотрудника не нашлось, все заняты: ${rejected.slice(0, 10).join('; ')}`,
  )
}

test.describe(
  LIVE ? 'статусы: подпись из справочника' : 'статусы: подпись из справочника (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

    test('статус типом из справочника подписан справочником, а не «Не обновлено»', async ({
      page,
    }) => {
      const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
      const expected = await catalogLabel(token, CATALOG_ONLY_CODE)
      const seeded = await seedCatalogStatus(token)

      await signIn(page, STAND_USERNAME, STAND_PASSWORD)
      await page.goto('/statuses')
      await hydrated(page)
      await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })

      // Поиск по фамилии: порядок строк меняют соседние пробы, и «первая
      // страница» — не адрес.
      await page.getByPlaceholder('Поиск по ФИО, отделу, должности...').fill(seeded.fullName)
      const row = page.locator('table tbody tr', { hasText: seeded.fullName }).first()
      await expect(row, `сотрудника ${seeded.fullName} не нашлось поиском`).toBeVisible({
        timeout: 20_000,
      })

      await expect(
        row.getByText(expected, { exact: true }).first(),
        `в строке нет подписи «${expected}» из справочника — вывод снова читает ` +
          `собственную таблицу кодов вместо каталога`,
      ).toBeVisible({ timeout: 20_000 })

      await expect(
        row.getByText('Не обновлено', { exact: true }),
        'статус ЕСТЬ, а строка утверждает, что человека не отметили — это и есть дефект №365',
      ).toHaveCount(0)
    })
  },
)
