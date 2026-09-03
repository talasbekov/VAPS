/**
 * Привлечение на ОМ из ПОРТАЛЬНОГО окна статуса — ЖИВОЙ стенд
 * (Plane №367, Ш-2 задачи №365).
 *
 * ЗАКАЗЧИК ДОСЛОВНО: «Участие на ОМ должно быть как статус На дежурстве,
 * должен выбираться группы (какие-то группы с возможностью) и Физнаряд».
 *
 * 🔴 ГЛАВНОЕ, ЧТО СТЕРЕЖЁТ ЭТА ПРОБА, — КУДА УХОДИТ ЗАПИСЬ. Портальное окно
 * пишет в КАДРОВУЮ модель (`/api/statuses/statuses/`), где полей мероприятия,
 * вида участия и роли нет вовсе. Привлечение обязано уйти в модель РАСХОДА
 * (`/api/operations/statuses/`) — только там живёт `OpsStatusParticipation`, и
 * только по ней считаются расход и сводки департамента (решение заказчика
 * 31.08.2026). Если ветка отправки once again упадёт в кадровую ручку, статус
 * сохранится «успешно», а привлечения не увидит никто, кроме поставившего, —
 * и ассерт на адрес ручки станет единственным, что об этом скажет.
 *
 * Стережёт ещё три вещи, у каждой своя мутация:
 *   1) блока мероприятий нет у статуса, который не про ОМ (иначе он вылезет у
 *      отпуска);
 *   2) у физнаряда роли не спрашиваются вовсе — ролей внутри у него нет;
 *   3) мероприятие и вид участия доезжают до сервера и возвращаются из него.
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

/** Код наряда — тот, что система понимает как «привлечён физическим нарядом». */
const SQUAD_STATUS_CODE = 'EVENT_ASSIGNMENT'

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

  test('«Участие в ОМ» вручную не ставится: окно отбивает словами, API — 422 (Plane №427)', async ({
    page,
  }) => {
    /**
     * `[СТА-04]`: такой статус заводится только из запроса на сбор сил
     * (чекбоксы начальника управления, №395). Тип в портальном списке
     * остаётся видимым (им подписан текущий статус привлечённых), но
     * отправка отбивается с указанием, куда идти; сервер держит то же
     * правило кодом PARTICIPATION_MANUAL_FORBIDDEN.
     */
    const label = await labelOfStatus('IN_EVENT')
    await signIn(page)
    await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 })
    const actions = page.getByRole('button', { name: /^Действия: / })
    await actions.last().click()
    await page.getByRole('menuitem', { name: 'Запланировать статус' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Статусы сотрудника')).toBeVisible({ timeout: 20_000 })
    await dialog.locator('#status').click()
    await expect(page.getByRole('listbox')).toBeVisible()
    const option = page.getByRole('option', { name: label, exact: true })
    await option.scrollIntoViewIfNeeded()
    await option.click()
    // Блока мероприятий больше нет: выбирать ОМ вручную негде; причина видна
    // сразу, кнопка сохранения заперта.
    await expect(dialog.getByText('Мероприятия', { exact: true })).toHaveCount(0)
    await expect(dialog.getByTestId('participation-refusal')).toContainText(
      'только из запроса на сбор сил',
    )
    await expect(dialog.getByRole('button', { name: 'Сохранить' })).toBeDisabled()

    // Тот же запрет на сервере — прямым вызовом.
    const token = await tokenFor()
    const employees = (await (
      await fetch(`${API}/api/core/employees/?page_size=1`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: { id: number }[] }
    const refused = await fetch(`${API}/api/operations/statuses/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        employee_id: employees.results[0]!.id,
        status_type_code: SQUAD_STATUS_CODE,
        date_start: '2030-01-10',
        date_end: '2030-01-11',
      }),
    })
    expect(refused.status).toBe(422)
    expect(((await refused.json()) as { error_code: string }).error_code).toBe(
      'PARTICIPATION_MANUAL_FORBIDDEN',
    )
  })
})
