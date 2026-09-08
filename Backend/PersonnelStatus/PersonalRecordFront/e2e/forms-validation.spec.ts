/**
 * Формы на react-hook-form + zod — ЖИВОЙ стенд.
 *
 * До спринта 4 эти формы держали значения в `useState` и проверяли их
 * рукописным `validateForm()`: правила лежали в трёх копиях, проверка была
 * только на сабмите, а ошибка показывалась сводкой внизу формы. У крупных
 * форм не было ни одной пробы — сюда и уехала регрессионная сеть. Форм
 * здесь ТРИ (наряд, статусы, командировка): четвёртая — «Добавить
 * сотрудника» — снята вместе со своей пробой (Plane №940), и с ней ушли
 * проверка `aria-describedby` через `errorTextOf` и правило «у ИИН из 11
 * цифр своё сообщение» (ИИН вводился только там).
 *
 * Проба стережёт то, что даёт именно смена механизма:
 *
 * 1. ошибка находится на УХОДЕ ФОКУСА, а не после нажатия «Сохранить»;
 * 2. текст ошибки лежит ПОД полем (`#…-error`), а не сводкой в конце формы;
 * 3. неудачный сабмит переводит фокус на ВЕРХНЕЕ неверное поле, включая
 *    Radix-триггеры без ref (штатный `shouldFocusError` их не умеет).
 *
 * 🔴 `serviceWorkers: 'block'` — иначе MSW перехватывает запросы живого стенда.
 */
import { expect, test, type Page } from '@playwright/test'
import { clickRowMenuItem, staffedRow } from './row-menu'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

/** Токен для чтения справочника напрямую — как в соседних живых пробах. */
async function tokenFor(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
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

/**
 * Дождаться гидратации: клик и сабмит ДО неё уходят браузерной отправкой —
 * форма не проверяется вовсе, и проба ловит не то, что проверяет.
 * Признак готовности клиента — включившийся переключатель темы.
 */
async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /тему|theme/i }).first()).toBeEnabled({
    timeout: 20_000,
  })
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'формы: RHF + zod' : 'формы: RHF + zod (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  // Проба «добавление сотрудника» снята вместе с окном заведения (Plane
  // №940, слово заказчика 07.09.2026): формы на экране больше нет.

  test('статусы сотрудника: наряд проверяется по полям, «В строю» дат не требует', async ({
    page,
  }) => {
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)

    // 🔴 Запись на стенд не уходит: модалка засеяна текущим статусом
    // сотрудника, и удачный сабмит создал бы ему настоящий статус. Проба
    // проверяет отказ валидации — до сети дело дойти не должно, а перехват
    // страхует от того, что дойдёт.
    let posted = 0
    await page.route(
      (url) => url.pathname.includes('/api/statuses/statuses'),
      (route) => {
        posted += 1
        return route.abort()
      },
    )

    // Модалка открывается из меню действий строки. Через помощника: строка
    // доводится до окна ДО открытия меню, иначе в полном прогоне пункт
    // оказывается «вне области просмотра» (Plane №820).
    await clickRowMenuItem(page, staffedRow(page), 'Запланировать статус')

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Статусы сотрудника')).toBeVisible()

    // «На дежурстве» дописывает к статусу наряд — его поля пусты.
    await dialog.locator('#status').click()
    await page.getByRole('option', { name: 'На дежурстве', exact: true }).click()
    await dialog.getByRole('button', { name: 'Сохранить' }).click()

    // Раньше ошибки наряда уезжали общей сводкой списком строк: «Выберите
    // объект» не показывал, какое из четырёх полей блока пустое.
    await expect(dialog.locator('[id="duty.dutyKind-error"]')).toHaveText(
      'Выберите тип дежурства.',
    )
    await expect(dialog.locator('[id="duty.objectId-error"]')).toHaveText('Выберите объект.')
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('duty.dutyKind')
    expect(posted, 'форма не должна была дойти до сети').toBe(0)

    // «В строю» бессрочен — дат у него нет вовсе.
    await dialog.locator('#status').click()
    await page.getByRole('option', { name: 'В строю', exact: true }).click()
    await expect(dialog.locator('#startDate')).toHaveCount(0)
    await expect(
      dialog.getByText('бессрочный статус, даты не указываются', { exact: false }),
    ).toBeVisible()
  })

  test('откомандирование: фокус идёт к ВЕРХНЕМУ пустому полю, а не к третьему', async ({
    page,
  }) => {
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)

    await clickRowMenuItem(page, staffedRow(page), 'Откомандировать сотрудника')

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Откомандировать сотрудника')).toBeVisible()

    await dialog.getByRole('button', { name: 'Откомандировать' }).click()

    // Все четыре поля названы — сводка внизу формы больше не нужна.
    await expect(dialog.locator('#startDate-error')).toHaveText('Укажите дату начала.')
    await expect(dialog.locator('#endDate-error')).toHaveText('Укажите дату окончания.')
    await expect(dialog.locator('#divisionId-error')).toHaveText('Выберите подразделение.')
    await expect(dialog.locator('#comment-error')).toHaveText(
      'Укажите причину откомандирования.',
    )

    // 🔴 Ключевой ассерт спринта: обязательность дат объявлена на самих полях,
    // а не в `superRefine` — иначе zod положил бы их нарушения В КОНЕЦ списка
    // и фокус уехал бы на «Подразделение», третье поле сверху.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('startDate')
  })

  test('массовое обновление: период обязателен у срочного статуса, как в одиночной модалке', async ({
    page,
  }) => {
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)

    // Кнопка «Применить изменения» погашена, пока никто не отмечен, — сначала
    // отмечаем строку в таблице, иначе форма недостижима.
    await page.getByRole('row').nth(1).getByRole('checkbox').click()
    await page.getByRole('tab', { name: 'Массовое обновление' }).click()

    const form = page.locator('form').filter({ has: page.locator('#status') })
    await expect(form.locator('#status')).toBeVisible()

    // 🔴 Запись на стенд не уходит: удачный сабмит сменил бы статус реальным
    // людям. Проба проверяет отказ валидации — до сети дело дойти не должно.
    let posted = 0
    await page.route(
      (url) => url.pathname.includes('/api/staff_unit/'),
      (route) => {
        if (route.request().method() === 'GET') return route.continue()
        posted += 1
        return route.abort()
      },
    )

    // 🔴 ПИН ПОДПИСИ СНЯТ ОСОЗНАННО (Plane №367). Здесь стояло «Отпуск» —
    // подпись из старой таблицы тринадцати кодов. После №354 список собран из
    // СПРАВОЧНИКА, где тот же тип назван «В отпуске», и проба искала пункт,
    // которого в списке нет вовсе. Вписать новое слово значило бы ждать
    // следующего переименования в админке: пробе нужен ЛЮБОЙ срочный статус —
    // тот, у которого есть даты, то есть любой, кроме «В строю».
    const token = await tokenFor()
    const catalog = (await (
      await fetch(`${API}/api/statuses/types/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as Array<{ code: string; label: string }>
    const timed = catalog.find((item) => item.code !== 'in_service')
    expect(timed, 'в справочнике нет ни одного срочного типа — проверять нечего').toBeTruthy()

    await form.locator('#status').click()
    const option = page.getByRole('option', { name: timed!.label, exact: true })
    await option.scrollIntoViewIfNeeded()
    await option.click()
    await form.getByRole('button', { name: 'Применить изменения' }).click()

    // Правило то же, что в одиночной модалке: срочный статус требует период
    // целиком. Прежний список был перечислением трёх статусов из тринадцати.
    await expect(form.locator('#startDate-error')).toHaveText('Укажите дату начала.')
    await expect(form.locator('#endDate-error')).toHaveText('Укажите дату окончания.')
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('startDate')
    expect(posted, 'форма не должна была дойти до сети').toBe(0)
  })

  test('«Участие в ОМ» в массовой простановке не предлагается (Plane №757)', async ({
    page,
  }) => {
    // 🔴 Статус привлечения живёт по своим правилам раздела ОМ: мероприятие
    // обязательно и обязано быть тем, о котором управление просили. Это окно
    // мероприятия не спрашивает ВООБЩЕ и шлёт статус кадровой ручкой — мимо
    // всех правил разом, и человек получал «привлечён неизвестно куда».
    //
    // Красная проверка — вернуть в список все типы справочника: пункт
    // «Участие в ОМ» снова появится, и `toHaveCount(0)` упадёт.
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await page.getByRole('row').nth(1).getByRole('checkbox').click()
    await page.getByRole('tab', { name: 'Массовое обновление' }).click()

    const form = page.locator('form').filter({ has: page.locator('#status') })
    await expect(form.locator('#status')).toBeVisible()

    // Подпись берётся ИЗ СПРАВОЧНИКА, а не пинится словом: тип переименуют в
    // админке — проба должна проверять тот же код, а не вчерашнее слово.
    const token = await tokenFor()
    const catalog = (await (
      await fetch(`${API}/api/statuses/types/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as Array<{ code: string; label: string }>
    const participation = catalog.find((item) =>
      ['IN_EVENT', 'EVENT_ASSIGNMENT', 'EVENT_ASSIGNMENT_GROUP'].includes(item.code),
    )
    expect(
      participation,
      'в справочнике нет типа «Участие в ОМ» — проверять нечего',
    ).toBeTruthy()

    await form.locator('#status').click()
    await expect(
      page.getByRole('option', { name: participation!.label, exact: true }),
      'массовая простановка предлагает «Участие в ОМ» — статус уйдёт мимо правил раздела ОМ',
    ).toHaveCount(0)
    // Список при этом не пуст: отбор убрал один тип, а не все.
    expect(await page.getByRole('option').count()).toBeGreaterThan(1)
  })
})
