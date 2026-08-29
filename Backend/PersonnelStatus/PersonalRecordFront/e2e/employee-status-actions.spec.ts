/**
 * Действующий статус сотрудника: что окно ОБЕЩАЕТ и что система ПОЗВОЛЯЕТ —
 * ЖИВОЙ стенд (Plane №255).
 *
 * Заказчик: «когда даёшь статусы сотрудникам, окошко не даёт сохранять или в
 * бэке что-то не так». Причина оказалась именно в расхождении обещания и
 * правила: окно «Запланированные статусы» держало у ДЕЙСТВУЮЩЕГО статуса
 * карандаш правки, а сервер отказывает любому PATCH активного статуса
 * («Активный статус можно только продлить (extend) или завершить досрочно
 * (terminate)») — и диалог подменял эту причину своим «Не удалось обновить
 * статус». Сохранить было нельзя НИКОГДА, и выглядело это как поломка бэка.
 *
 * 🔴 Проба стережёт ТРИ вещи, и каждая падает на своей мутации:
 *   1) карандаша правки у действующего статуса нет — вернётся, и первый ассерт
 *      красный;
 *   2) продление доезжает до сервера и меняет дату окончания в карточке;
 *   3) досрочное завершение требует причину У ПОЛЯ и закрывает статус, после
 *      чего человек снова «В строю».
 *
 * Фикстура заводится САМОЙ пробой через API, а не берётся из данных стенда:
 * действующий СРОЧНЫЙ статус (с датой окончания) там есть не всегда, а без
 * него проверять нечего — и «нет фикстуры» читалось бы как зелень.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { probeComment } from './probe-statuses'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

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

/** Строки статусов сотрудника, суженные фильтром `?employee=` (Plane №289). */
async function statusesOf(
  token: string,
  employeeId: number,
  state: 'active' | 'planned',
): Promise<{ count: number; results: Array<{ status_type: string }> }> {
  const res = await fetch(
    `${API}/api/statuses/statuses/?employee=${employeeId}&state=${state}&page_size=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  expect(
    res.status,
    'список статусов не отвечает — без него подопытного не выбрать',
  ).toBe(200)
  return (await res.json()) as { count: number; results: Array<{ status_type: string }> }
}

/**
 * Сотрудник стенда, которому проба заводит СРОЧНЫЙ действующий статус.
 *
 * ПОДОПЫТНЫЙ ПРИВОДИТСЯ В НУЖНОЕ СОСТОЯНИЕ, А НЕ ИЩЕТСЯ СРЕДИ ПОДХОДЯЩИХ
 * (Plane №288). Прежняя версия брала первого, кому удавалось завести статус
 * (201), и молча рассчитывала, что дальше всё сложится. Не складывалось: у
 * человека с запланированными статусами досрочное завершение не могло завести
 * взамен бессрочное «В строю» (оно открыто вправо и пересекается с
 * обещанным), и последний ассерт краснел — но только на тех прогонах, где
 * такой человек оказывался первым. Проба зависела от данных стенда и меняла
 * ответ от суток к суткам: 28.08 зелёная, 29.08 красная, код тот же.
 *
 * Условие отбора ровно из того, что проба потом утверждает:
 *   • ЗАПЛАНИРОВАННЫХ статусов нет вовсе — иначе автоматическое «В строю»
 *     после завершения упрётся в пересечение;
 *   • среди ДЕЙСТВУЮЩИХ — только «В строю» (или их нет): этот тип уступает
 *     место сам (`_close_active_statuses`), поэтому новый срочный статус
 *     встанет ДЕЙСТВУЮЩИМ, а не запланированным, и его можно будет завершить
 *     досрочно.
 *
 * Отбор идёт фильтром `?employee=`, который до Plane №289 молча игнорировался
 * и отдавал все строки стенда. Пока он врал, этой проверки нельзя было
 * написать вовсе — отсюда и прежний перебор «вдруг повезёт».
 */
async function seedTimedStatus(
  token: string,
): Promise<{ rowKey: string; fullName: string; endDate: string }> {
  const raw = await fetch(`${API}/api/staff_unit/staff-units/directorate/?page=1&page_size=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await raw.json()) as { staff_units: StaffRow[] }
  const rows = body.staff_units.filter((row) => row.employee !== null)
  expect(rows.length, 'на стенде нет ни одного занятого места — фикстуру некому завести').toBeGreaterThan(0)

  const endDate = iso(shifted(5))
  const rejected: string[] = []
  for (const row of rows) {
    const employee = row.employee!
    const planned = await statusesOf(token, employee.id, 'planned')
    if (planned.count > 0) {
      rejected.push(`${employee.id}: запланированных ${planned.count}`)
      continue
    }
    const active = await statusesOf(token, employee.id, 'active')
    const foreign = active.results.filter((s) => s.status_type !== 'in_service')
    if (foreign.length > 0) {
      rejected.push(`${employee.id}: действует ${foreign.map((s) => s.status_type).join(', ')}`)
      continue
    }

    const res = await fetch(`${API}/api/statuses/statuses/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        employee: employee.id,
        status_type: 'business_trip',
        start_date: iso(new Date()),
        end_date: endDate,
        comment: probeComment('Проба №255'),
      }),
    })
    // Тело читается ОДИН раз и держится строкой: `await res.text()` прямо в
    // сообщении ассерта вычисляется до сравнения и съедает поток — следующий
    // `res.json()` падает «Body is unusable», и проба врёт про причину.
    const payload = await res.text()
    // Отказ на ОТОБРАННОМ сотруднике — это уже не «занят», а расхождение
    // правила отбора с правилом сервера, и молчать о нём нельзя: проба снова
    // начала бы перебирать людей и снова зависела бы от того, кто попался.
    expect(
      res.status,
      `сотруднику ${employee.id} без запланированных статусов и с одним лишь ` +
        `«В строю» сервер отказал завести срочный статус: ${payload}`,
    ).toBe(201)
    const created = JSON.parse(payload) as { state?: string }
    expect(
      created.state,
      'заведённый сегодняшним днём статус обязан быть ДЕЙСТВУЮЩИМ: ' +
        'запланированный нельзя ни продлить, ни завершить досрочно',
    ).toBe('active')

    return {
      rowKey: `${row.id}-${employee.id}`,
      fullName: `${employee.last_name} ${employee.first_name}`,
      endDate,
    }
  }
  throw new Error(
    'ни один сотрудник страницы не подошёл под условия пробы (нет запланированных ' +
      `статусов, из действующих только «В строю»). Отсеяны: ${rejected.join('; ')}. ` +
      'Это не повод для скипа — проверьте данные стенда.',
  )
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'статусы: действия над действующим' : 'статусы (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('действующий статус продлевается и завершается досрочно, правки у него нет', async ({
    page,
  }) => {
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const seeded = await seedTimedStatus(token)

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })

    // Ищем строку сотрудника по фамилии — порядок строк меняют соседние пробы.
    const row = page.locator('table tbody tr', { hasText: seeded.fullName }).first()
    await expect(row, `сотрудника ${seeded.fullName} нет на первой странице таблицы`).toBeVisible()
    await row.getByTitle('Открыть статусы сотрудника').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Текущий статус')).toBeVisible({ timeout: 20_000 })
    await expect(dialog.getByText('Командировка').first()).toBeVisible()

    // (1) КАРАНДАША НЕТ. Правку активного статуса сервер запрещает всегда —
    // кнопка, которая её обещает, и есть дефект №255.
    await expect(
      dialog.getByLabel('Изменить текущий статус'),
      'у действующего статуса снова появился карандаш правки — сервер её отвергнет, ' +
        'и окно опять не даст сохранить',
    ).toHaveCount(0)

    // (2) ПРОДЛЕНИЕ доезжает до сервера.
    await dialog.getByRole('button', { name: 'Продлить' }).click()
    await dialog.locator('#extend-date').click()
    const popover = page.locator('[data-radix-popper-content-wrapper]')
    // На следующий месяц и на 28-е — заведомо позже текущей даты окончания
    // (фикстура кончается через 5 дней).
    await popover.locator('button').nth(1).click()
    await popover.getByText('28', { exact: true }).first().click()
    const extended = page.waitForResponse(
      (res) => res.url().includes('/extend/') && res.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: 'Продлить', exact: true }).last().click()
    expect((await extended).status(), 'продление не принято сервером').toBe(200)
    await expect(
      dialog.getByText(seeded.endDate.split('-').reverse().join('.')),
      'дата окончания в карточке осталась прежней — продление не доехало до экрана',
    ).toHaveCount(0)

    // (3) ДОСРОЧНОЕ ЗАВЕРШЕНИЕ: причина обязательна, и её отсутствие — ошибка
    // ПОЛЯ, а не отказ сервера.
    await dialog.getByRole('button', { name: 'Завершить досрочно' }).click()
    await dialog.getByRole('button', { name: 'Завершить', exact: true }).click()
    await expect(
      dialog.getByText('Укажите причину досрочного завершения.'),
      'пустая причина ушла на сервер вместо того, чтобы краснеть у поля',
    ).toBeVisible()

    await dialog.locator('#terminate-reason').fill('Проба №255: вышел раньше срока')
    const terminated = page.waitForResponse(
      (res) => res.url().includes('/terminate/') && res.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: 'Завершить', exact: true }).click()
    expect((await terminated).status(), 'досрочное завершение не принято сервером').toBe(200)

    // Завершение заводит взамен «В строю» — карточка обязана это показать.
    await expect(
      dialog.getByText('В строю').first(),
      'после досрочного завершения сотрудник остался без действующего статуса',
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      dialog.getByText(/Бессрочный статус/),
      'у бессрочного «В строю» не должно быть ни продления, ни завершения — только подсказка',
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Продлить' })).toHaveCount(0)
  })
})
