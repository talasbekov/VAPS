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
 *   3) мероприятие и вид участия доезжают до сервера и возвращаются из него;
 *   4) сервер держит своё правило сам: тело без `participations` — 422
 *      `PARTICIPATION_EVENT_REQUIRED`, чужое мероприятие — 422
 *      `PARTICIPATION_EVENT_NOT_REQUESTED`.
 *
 * 🔴 ПРОБА ОСТАВЛЯЕТ СТАТУС РАСХОДА И НЕ УБИРАЕТ ЕГО — как и соседняя
 * `status-set-dialog.spec.ts`, и по той же причине: статус расхода в этой
 * модели ФАКТ, а не черновик, ручки удаления у него нет вовсе. Ограничение
 * накопления то же — берётся сотрудник, у которого на выбранные даты статуса
 * нет, и даты берутся в СЛЕДУЮЩЕМ месяце.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

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
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: STAND_USERNAME,
      password: STAND_PASSWORD,
      json: 'true',
    },
  })
}

async function tokenFor(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
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

/** Число в календаре СЛЕДУЮЩЕГО месяца: прошлые дни бывают заблокированы. */
async function pickNextMonthDay(page: Page, day: string): Promise<void> {
  // `.last()`: прежний календарь остаётся в разметке закрытым, и на втором
  // поле в дереве оказываются ДВА поппера — строгий режим Playwright справедливо
  // отказывается выбирать за нас.
  const popover = page.locator('[data-radix-popper-content-wrapper]').last()
  await expect(popover).toBeVisible()
  // nth(1) — «вперёд» (nth(0) — «назад»); тот же приём, что в пробе №255.
  await popover.locator('button').nth(1).click()
  await popover.getByText(day, { exact: true }).first().click()
}

test.describe('статусы: привлечение на ОМ из портального окна', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('«Участие в ОМ» ставится с модуля: мероприятие берётся из заявок своего управления (Plane №737)', async ({
    page,
  }) => {
    const label = await labelOfStatus(IN_EVENT_STATUS_CODE)
    const token = await tokenFor()
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
    const expectedCodes = [...new Set(requests.results.map((row) => row.code))]

    await signIn(page)
    await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 })
    const actions = page.getByRole('button', { name: /^Действия: / })
    await actions.last().click()
    await page.getByRole('menuitem', { name: 'Запланировать статус' }).click()
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
    // Строка открыта сразу: мероприятие обязательно, и прятать его за кнопкой
    // «+ Мероприятие» значило бы показать форму, которую нельзя сохранить, не
    // догадавшись нажать.
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
    // Выбор С КЛАВИАТУРЫ, а не кликом в «первый по DOM»: Radix открывает
    // список прокрученным к подсвеченному варианту (разобрано в
    // `status-set-dialog.spec.ts`).
    await page.keyboard.press('Enter')
    await expect(
      dialog.getByLabel('Мероприятие 1', { exact: true }),
      'мероприятие выбрано — в поле стоит код ОМ',
    ).toContainText(/ОМ-[\d-]+/)

    await dialog.getByLabel('Вид участия 1', { exact: true }).click()
    await page.getByRole('option', { name: 'Физический наряд' }).click()
    // У физнаряда ролей внутри нет — третьего списка быть не должно.
    await expect(
      dialog.getByLabel('Роль в группе 1', { exact: true }),
      'физнаряду предложена роль, которой у него не бывает',
    ).toHaveCount(0)

    // Период: у привлечения есть начало и конец, бессрочным оно не бывает.
    // Даты — в СЛЕДУЮЩЕМ месяце: у взятого человека там статуса нет.
    await dialog.locator('#startDate').click()
    await pickNextMonthDay(page, '10')
    await dialog.locator('#endDate').click()
    await pickNextMonthDay(page, '20')

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
    const saved = (await response.json()) as {
      status_type_code: string
      participations: { event_id: number; kind_code: string }[]
    }
    expect(saved.status_type_code).toBe(IN_EVENT_STATUS_CODE)
    expect(saved.participations, 'мероприятие доехало до сервера и вернулось').toHaveLength(1)
    expect(saved.participations[0]!.kind_code).toBe(SQUAD_KIND)
  })

  test('сервер держит правило сам: без мероприятия и на чужое ОМ — 422 (Plane №737)', async () => {
    const token = await tokenFor()
    const employees = (await (
      await fetch(`${API}/api/core/employees/?page_size=1`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: { id: number }[] }
    const employeeId = employees.results[0]!.id

    // Без мероприятия — «привлечён неизвестно куда».
    const bare = await fetch(`${API}/api/operations/statuses/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        employee_id: employeeId,
        status_type_code: IN_EVENT_STATUS_CODE,
        date_start: '2030-01-10',
        date_end: '2030-01-11',
      }),
    })
    expect(bare.status).toBe(422)
    expect(((await bare.json()) as { error_code: string }).error_code).toBe(
      'PARTICIPATION_EVENT_REQUIRED',
    )

    // Мероприятие, по которому запроса управлению не было. Несуществующий
    // идентификатор — заведомо не запрошенный, и заводить лишнее ОМ ради
    // этого ассерта не нужно (проба своего на стенде не оставляет).
    const stranger = await fetch(`${API}/api/operations/statuses/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        employee_id: employeeId,
        status_type_code: IN_EVENT_STATUS_CODE,
        date_start: '2030-01-12',
        date_end: '2030-01-13',
        participations: [{ event_id: 999999999, kind_code: SQUAD_KIND }],
      }),
    })
    expect(stranger.status).toBe(422)
    expect(((await stranger.json()) as { error_code: string }).error_code).toBe(
      'PARTICIPATION_EVENT_NOT_REQUESTED',
    )
  })
})
