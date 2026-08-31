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

  test('окно спрашивает мероприятие и физнаряд, а пишет в учёт раздела ОМ', async ({
    page,
  }) => {
    const squadLabel = await labelOfStatus(SQUAD_STATUS_CODE)

    await signIn(page)
    await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /^Действия: / }).first().click()
    await page.getByRole('menuitem', { name: 'Запланировать статус' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Статусы сотрудника')).toBeVisible({ timeout: 20_000 })

    // (1) У статуса не про ОМ блока мероприятий нет вовсе.
    await expect(
      dialog.getByText('Мероприятия', { exact: true }),
      'блок мероприятий показан до того, как выбран статус привлечения',
    ).toHaveCount(0)

    await dialog.locator('#status').click()
    // 🔴 ВЫБОР НАБОРОМ С КЛАВИАТУРЫ, А НЕ КЛИКОМ. В списке шестнадцать типов,
    // и Radix открывает его прокрученным к подсвеченному варианту: нужный
    // оказывается ВЫШЕ видимой области, Playwright честно говорит «element is
    // outside of the viewport» и падает по таймауту. Сам список отрисован
    // верно — ломается проба, а не окно (разобрано в `status-set-dialog.spec.ts`).
    // Печатаем подпись целиком: две подписи привлечения различаются только
    // хвостом «(наряд)» / «(боевая группа)», и короткого префикса не хватит.
    await expect(page.getByRole('listbox')).toBeVisible()
    const squadOption = page.getByRole('option', { name: squadLabel, exact: true })
    await squadOption.scrollIntoViewIfNeeded()
    await squadOption.click()
    await expect(
      dialog.locator('#status'),
      'в поле статуса встал не тот тип, который выбран',
    ).toContainText(squadLabel)
    await expect(
      dialog.getByText('Мероприятия', { exact: true }),
      'у статуса привлечения блок мероприятий обязан появиться',
    ).toBeVisible()

    // (2) Мероприятие и вид участия.
    await dialog.getByRole('button', { name: '+ Мероприятие' }).click()
    await dialog.getByLabel('Мероприятие 1', { exact: true }).click()
    // Ждём НАПОЛНЕНИЯ списка, а не кликаем в пустоту: под нагрузкой реестр ОМ
    // отвечает не сразу, и «первый вариант» истекал бы по таймауту.
    await expect(
      page.getByText('Загружаем мероприятия…'),
      'состояние загрузки списка ОМ сменяется списком',
    ).toHaveCount(0, { timeout: 30_000 })
    await expect(
      page.getByText('Мероприятий нет — привлекать не на что'),
      'на стенде есть хотя бы одно ОМ — иначе проба вакуумна',
    ).toHaveCount(0)
    // Выбор С КЛАВИАТУРЫ, а не кликом в «первый по DOM»: на подросшем реестре
    // Radix открывает список прокрученным, и первый по разметке оказывается
    // выше видимой области (разобрано в `status-set-dialog.spec.ts`).
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(
      dialog.getByLabel('Мероприятие 1', { exact: true }),
      'мероприятие выбрано — в поле стоит код ОМ',
    ).toContainText(/ОМ-\d+/)

    await dialog.getByLabel('Вид участия 1', { exact: true }).click()
    await page.getByRole('option', { name: 'Физический наряд' }).click()

    // (3) У физнаряда ролей внутри нет — поле роли не показывается.
    await expect(
      dialog.getByLabel('Роль в группе 1', { exact: true }),
      'физнаряду предложена роль, которой у него не бывает',
    ).toHaveCount(0)
    await expect(dialog.getByText('ролей внутри нет')).toBeVisible()

    // Период: у привлечения есть начало и конец, бессрочным оно не бывает.
    await dialog.locator('#startDate').click()
    await pickNextMonthDay(page, '10')
    await dialog.locator('#endDate').click()
    await pickNextMonthDay(page, '20')

    // (4) 🔴 АДРЕС РУЧКИ — ГЛАВНЫЙ АССЕРТ. Ждём ИМЕННО ручку расхода: попади
    // запись в кадровую, ответ пришёл бы с другого адреса и ожидание истекло.
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
      participations: { event_id: number; kind_code: string; role_code: string }[]
    }
    expect(
      saved.status_type_code,
      'на сервер ушёл не тот код статуса, который выбрал человек',
    ).toBe(SQUAD_STATUS_CODE)
    expect(
      saved.participations,
      'мероприятие доехало до сервера и вернулось из него',
    ).toHaveLength(1)
    expect(saved.participations[0].kind_code).toBe('PHYSICAL_SQUAD')
    expect(
      saved.participations[0].role_code,
      'физнаряду роль не приписана — ролей внутри у него нет',
    ).toBe('')

    await expect(dialog, 'после успеха окно закрывается').toHaveCount(0)
  })
})
