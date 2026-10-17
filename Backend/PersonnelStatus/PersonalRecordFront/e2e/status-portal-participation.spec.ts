/**
 * Привлечение на ОМ из ПОРТАЛЬНОГО окна статуса — ЖИВОЙ стенд
 * (Plane №367 Ш-2 задачи №365; правило ручного ввода переписано решением
 * заказчика по №737).
 *
 * ЗАКАЗЧИК ДОСЛОВНО (№737): «Пользователь с ролью у кого есть доступ к
 * редактированию модуля Статусы сотрудников должен иметь возможность давать
 * своим сотрудникам статус На участие ОМ, сейчас это невозможно. Этим
 * занимается начальник управления, а не ответственный за сбор сил на ОМ».
 * До правки окно при выборе типа показывало красный отказ и запирало
 * «Сохранить» (решение №427) — на него заказчик и указал.
 *
 * 🔴 ГЛАВНОЕ, ЧТО СТЕРЕЖЁТ ЭТА ПРОБА, — КУДА УХОДИТ ЗАПИСЬ. Портальное окно
 * пишет в КАДРОВУЮ модель (`/api/statuses/statuses/`), где полей мероприятия,
 * вида участия и роли нет вовсе. Привлечение обязано уйти в модель РАСХОДА
 * (`/api/operations/statuses/`) — только там живёт `OpsStatusParticipation`, и
 * только по ней считаются расход и сводки департамента (решение заказчика
 * 31.08.2026). Упади ветка отправки в кадровую ручку — статус сохранится
 * «успешно», а привлечения не увидит никто, кроме поставившего.
 *
 * Стережёт ещё четыре вещи, у каждой своя мутация:
 *   1) блока мероприятий нет у статуса, который не про ОМ (иначе он вылезет у
 *      отпуска);
 *   2) в списке мероприятий — ЗАЯВКИ СВОЕГО УПРАВЛЕНИЯ, а не реестр ОМ: на
 *      реестр у начальника управления нет права `event.view` (№348), и проба
 *      сверяет список окна с ручкой `forces/directorate-requests/`;
 *   3) вид участия доезжает до сервера, а пустое мероприятие физнаря
 *      возвращается маркером отложенного распределения;
 *   4) сервер держит своё правило сам: тело без `participations` — 422
 *      `PARTICIPATION_EVENT_REQUIRED`, чужое мероприятие — 422
 *      `PARTICIPATION_EVENT_NOT_REQUESTED`.
 *
 * 🔴 ПРОБА ОСТАВЛЯЕТ СТАТУС РАСХОДА И НЕ УБИРАЕТ ЕГО — как и соседняя
 * `status-set-dialog.spec.ts`, и по той же причине: статус расхода в этой
 * модели ФАКТ, а не черновик, ручки удаления у него нет вовсе. Ограничение
 * накопления ограничено зарезервированным уникальным полуинтервалом в один
 * день, выбранным через настоящий календарь. Перед записью проверяются
 * действующие сдачи на этот день; причины поправки тест не подставляет.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { uniqueBusinessDate } from './business-date'
import { prepareDemandEvent, standCall } from './prepare-events'
import { clickRowMenuItem, staffedRow } from './row-menu'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

/** Код участия. После слияния №486 он ОДИН на наряд и на группу — вид живёт
 *  в строке участия, а не в коде статуса. */
const IN_EVENT_STATUS_CODE = 'IN_EVENT'
/** Физнаряд: у него ролей внутри нет — на этом стоит третий ассерт окна. */
const SQUAD_KIND = 'PHYSICAL_SQUAD'

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  const response = await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: STAND_USERNAME,
      password: STAND_PASSWORD,
      json: 'true',
    },
  })
  expect(response.status(), 'вход для живого портального окна').toBe(200)
}

async function tokenFor(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  expect(res.status, 'API вход для живого портального окна').toBe(200)
  return ((await res.json()) as { access: string }).access
}

/**
 * Подпись статуса берётся ИЗ СПРАВОЧНИКА, а не вписывается строкой: заказчик
 * правит названия типов в админке, и пин на русском тексте краснел бы на
 * переименовании вместо поломки.
 */
async function labelOfStatus(code: string): Promise<string> {
  const token = await tokenFor()
  const res = await fetch(`${API}/api/statuses/types/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status, 'справочник типов не отвечает — выбирать нечего').toBe(200)
  const rows = (await res.json()) as Array<{ code: string; label: string }>
  const row = rows.find((item) => item.code === code)
  expect(row, `в справочнике нет кода ${code} — проба обязана упасть здесь`).toBeTruthy()
  return row!.label
}

/** Actual calendar navigation: react-day-picker supports a year per
 * Shift+PageDown/PageUp and a month per PageDown/PageUp. No clock/DOM/state
 * injection is used. ISO data-day belongs to the actual calendar gridcell. */
async function pickOwnedDate(page: Page, isoDate: string): Promise<void> {
  expect(isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  const popover = page.locator('[data-radix-popper-content-wrapper]').last()
  await expect(popover).toBeVisible()
  const calendar = popover.locator('[data-slot="calendar"]')
  const dayButtons = calendar.locator('[role="gridcell"]:not([data-outside="true"]) button:not([disabled])')
  await expect(dayButtons.first()).toBeVisible()
  await dayButtons.first().focus()
  const focused = calendar.locator('[role="gridcell"][data-focused="true"]')
  await expect(focused).toHaveCount(1)
  const initial = await focused.getAttribute('data-day')
  expect(initial).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  let [year, month] = initial!.split('-').map(Number)
  const [targetYear, targetMonth] = isoDate.split('-').map(Number)
  for (const direction of [1, -1] as const) {
    while ((targetYear - year) * direction > 0) {
      year += direction
      await page.keyboard.press(direction === 1 ? 'Shift+PageDown' : 'Shift+PageUp')
      await expect(focused).toHaveAttribute('data-day', new RegExp(`^${year}-${String(month).padStart(2, '0')}-`))
    }
  }
  while (month !== targetMonth) {
    const direction = targetMonth > month ? 1 : -1
    month += direction
    await page.keyboard.press(direction === 1 ? 'PageDown' : 'PageUp')
    await expect(focused).toHaveAttribute('data-day', new RegExp(`^${year}-${String(month).padStart(2, '0')}-`))
  }
  const target = calendar.locator(`[role="gridcell"][data-day="${isoDate}"]:not([data-outside="true"])`).getByRole('button')
  await expect(target).toHaveCount(1)
  await target.click()
  // Selection updates the field; this Popover closes through its real Escape handler.
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
}

test.describe('статусы: привлечение на ОМ из портального окна', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('«Участие в ОМ» ставится с модуля: мероприятие берётся из заявок своего управления (Plane №737)', async ({
    page,
  }) => {
    const label = await labelOfStatus(IN_EVENT_STATUS_CODE)
    const token = await tokenFor()
    // Заявка принадлежит этой пробе, а не предыдущему сидеру или соседнему
    // сценарию. Сохранённая квота управления обязательна до оповещения.
    const dateStart = uniqueBusinessDate()
    const dateEnd = uniqueBusinessDate()
    expect(Date.parse(`${dateEnd}T00:00:00Z`) - Date.parse(`${dateStart}T00:00:00Z`)).toBe(86_400_000)
    const ownEvent = await prepareDemandEvent(token, dateStart)
    const call = standCall(token)
    const divisions = await call('GET', '/api/core/divisions/?page_size=200')
    const directorate = divisions.results.find((row: { type_code: string }) => row.type_code === 'directorate')
    expect(directorate, 'в стенде есть управление для собственной заявки').toBeTruthy()
    const base = `/api/ops/security-events/${ownEvent.id}/forces/allocation`
    const allocated = await call('POST', `${base}/`, {
      rows: [{ departmentId: String(directorate.parent), need: ownEvent.total }],
    })
    const allocationId = allocated.forceAllocation[0].id
    await call('POST', `${base}/${allocationId}/split/`, {
      rows: [{ divisionId: String(directorate.id), need: ownEvent.total }],
    })
    await call('POST', `${base}/${allocationId}/notify/`)
    // Список, который окно ОБЯЗАНО показать. Пусто — фикстуры стенда нет, и
    // проба говорит об этом прямо, а не молча зеленеет на пустом выборе.
    const requests = (await (
      await fetch(`${API}/api/ops/security-events/forces/directorate-requests/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: { eventId: string; code: string }[] }
    expect(
      requests.results.length,
      'на стенде нет ни одного разосланного запроса сил — привлекать не на что: ' +
        'manage.py seed_smoke_fixtures',
    ).toBeGreaterThan(0)
    expect(requests.results.map((row) => row.eventId), 'собственная оповещённая заявка видна серверу').toContain(ownEvent.id)
    const expectedCodes = [...new Set(requests.results.map((row) => row.code))]

    await signIn(page)
    await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 })
    const row = staffedRow(page)
    const employeeId = Number(await row.getAttribute('data-employee-id'))
    expect(Number.isSafeInteger(employeeId) && employeeId > 0).toBe(true)
    // This checked real list sees all current submissions under the actor’s
    // actual rights. No covered day is erased or amended to prepare the test.
    const submissions = await call('GET', `/api/operations/daily-submissions/?business_date=${dateStart}&limit=1`)
    expect(submissions.count, 'reserved own status day must have no current submitted report').toBe(0)
    // This fixture owns a future period, so enter the scheduling action.
    await clickRowMenuItem(page, row, 'Запланированные статусы')
    await page.getByRole('dialog').getByRole('button', { name: /^Запланировать статус/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Статусы сотрудника')).toBeVisible({ timeout: 20_000 })

    // До выбора ОМ-статуса блока мероприятий быть не должно.
    await expect(dialog.getByTestId('participation-fields')).toHaveCount(0)

    await dialog.locator('#status').click()
    await expect(page.getByRole('listbox')).toBeVisible()
    const option = page.getByRole('option', { name: label, exact: true })
    await option.scrollIntoViewIfNeeded()
    await option.click()

    // Красный отказ №427 снят, блок на его месте, «Сохранить» не заперта.
    await expect(dialog.getByTestId('participation-refusal')).toHaveCount(0)
    await expect(dialog.getByTestId('participation-fields')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeEnabled()

    // Список мероприятий — РОВНО заявки своего управления, без повторов:
    // на одно ОМ заявок бывает несколько, и дубль читался бы как второе ОМ.
    //
    // Строка открыта сразу: вид участия обязателен. Конкретное мероприятие
    // можно оставить пустым для физнаря до распределения штабом.
    await dialog.getByLabel('Мероприятие 1', { exact: true }).click()
    await expect(
      page.getByText('Загружаем мероприятия…'),
      'состояние загрузки списка заявок сменяется списком',
    ).toHaveCount(0, { timeout: 30_000 })
    await expect(
      page.getByText('Запросов сил вашему управлению нет — привлекать не на что'),
      'ручка отдала заявки, а окно показало пустоту — списки разошлись',
    ).toHaveCount(0)
    await expect(page.getByRole('listbox')).toBeVisible()
    const shown = await page.getByRole('option').allInnerTexts()
    expect(shown.length, 'мероприятие обязано быть по одному на ОМ').toBe(expectedCodes.length)
    for (const code of expectedCodes) {
      expect(shown.some((text) => text.includes(code)), `в списке нет ${code}`).toBe(true)
    }
    await page.keyboard.press('Escape')
    await dialog.getByRole('button', { name: 'Физнаряд', exact: true }).click()
    await expect(
      dialog.getByLabel('Мероприятие 1', { exact: true }),
      'для физнаря мероприятие можно не выбирать',
    ).toContainText('Мероприятие (необязательно)')
    await expect(
      dialog.getByText('Для физнаряда мероприятие можно определить позже штабом.'),
    ).toBeVisible()
    // У физнаряда ролей внутри нет — третьего списка быть не должно.
    await expect(
      dialog.getByLabel('Специальность', { exact: true }),
      'физнаряду предложена роль, которой у него не бывает',
    ).toHaveCount(0)

    // Период: у привлечения есть начало и конец, бессрочным оно не бывает.
    // Exactly one reserved day, selected with real keyboard/calendar actions.
    await dialog.locator('#startDate').click()
    await pickOwnedDate(page, dateStart)
    await dialog.locator('#endDate').click()
    // The picker shows the last included day; one-day participation uses
    // the same day in both controls and the next day in the operations API.
    await pickOwnedDate(page, dateStart)

    // 🔴 АДРЕС РУЧКИ — ГЛАВНЫЙ АССЕРТ ПРОБЫ (см. шапку файла). Попади запись
    // в кадровую ручку — ответ пришёл бы с другого адреса и ожидание истекло.
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/operations/statuses/') && r.request().method() === 'POST',
        { timeout: 20_000 },
      ),
      dialog.getByRole('button', { name: 'Сохранить' }).click(),
    ])
    expect(response.status(), await response.text()).toBe(201)
    const sent = response.request().postDataJSON() as { employee_id: number; date_start: string; date_end: string }
    expect(sent).toMatchObject({ employee_id: employeeId, date_start: dateStart, date_end: dateEnd })
    const saved = (await response.json()) as {
      employee_id: number
      date_start: string
      date_end: string
      status_type_code: string
      participations: { event_id: number; kind_code: string }[]
    }
    expect(saved).toMatchObject({ employee_id: employeeId, date_start: dateStart, date_end: dateEnd })
    expect(saved.status_type_code).toBe(IN_EVENT_STATUS_CODE)
    expect(saved.participations, 'строка физнаря доехала до сервера').toHaveLength(1)
    expect(saved.participations[0]!.event_id).toBe(0)
    expect(saved.participations[0]!.kind_code).toBe(SQUAD_KIND)
  })

  test('сервер держит правило сам: без вида, физнарь без ОМ и чужое ОМ', async () => {
    const token = await tokenFor()
    const businessDate = uniqueBusinessDate()
    const dateAt = (days: number) => new Date(Date.parse(`${businessDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
    const employees = (await (
      await fetch(`${API}/api/core/employees/?page_size=1`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: { id: number }[] }
    const employeeId = employees.results[0]!.id

    // Без строки участия — вид тоже неизвестен, это по-прежнему ошибка.
    const bare = await fetch(`${API}/api/operations/statuses/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        employee_id: employeeId,
        status_type_code: IN_EVENT_STATUS_CODE,
        date_start: dateAt(0),
        date_end: dateAt(1),
      }),
    })
    expect(bare.status).toBe(422)
    expect(((await bare.json()) as { error_code: string }).error_code).toBe(
      'PARTICIPATION_EVENT_REQUIRED',
    )

    const physical = await fetch(`${API}/api/operations/statuses/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        employee_id: employeeId,
        status_type_code: IN_EVENT_STATUS_CODE,
        date_start: dateAt(1),
        date_end: dateAt(2),
        participations: [{ kind_code: SQUAD_KIND }],
      }),
    })
    const physicalBody = (await physical.json()) as {
      participations: { event_id: number }[]
    }
    expect(physical.status, JSON.stringify(physicalBody)).toBe(201)
    expect(physicalBody.participations[0]!.event_id).toBe(0)

    // Мероприятие, по которому запроса управлению не было. Несуществующий
    // идентификатор — заведомо не запрошенный, и заводить лишнее ОМ ради
    // этого ассерта не нужно (проба своего на стенде не оставляет).
    const stranger = await fetch(`${API}/api/operations/statuses/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        employee_id: employeeId,
        status_type_code: IN_EVENT_STATUS_CODE,
        date_start: dateAt(2),
        date_end: dateAt(3),
        participations: [{ event_id: 999999999, kind_code: SQUAD_KIND }],
      }),
    })
    expect(stranger.status).toBe(422)
    expect(((await stranger.json()) as { error_code: string }).error_code).toBe(
      'PARTICIPATION_EVENT_NOT_REQUESTED',
    )
  })
})
