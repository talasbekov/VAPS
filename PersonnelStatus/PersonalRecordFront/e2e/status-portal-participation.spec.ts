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

  test('«Участие в ОМ» тоже спрашивает мероприятие, а не одни даты', async ({
    page,
  }) => {
    /**
     * Plane №378 (найдено ручным тестированием №377).
     *
     * Заказчик в №365 писал про «Участие на ОМ», а блок привлечения включался
     * только у двух других кодов — «Привлечён на мероприятие (наряд)» и
     * «(боевая группа)». То есть он нажимал тип, для которого не сделано
     * ничего: окно предлагало только даты и комментарий, а разрезы сбора сил
     * считали такого человека В СТРОЮ и предлагали на новое привлечение.
     *
     * Проба стережёт мутацию: убрать `IN_EVENT` из общего списка кодов
     * участия — блок снова исчезнет.
     */
    const label = await labelOfStatus('IN_EVENT')

    await signIn(page)
    await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 })

    // 🔴 БЕРЁМ ПОСЛЕДНЮЮ СТРОКУ, А НЕ ПЕРВУЮ. Соседняя проба этого же файла
    // работает с первой и ЗАПИСЫВАЕТ статус; когда обе брали одного человека,
    // в общем прогоне вторая падала на состоянии, оставленном первой (в
    // одиночку каждая была зелёной). Разные строки — разные подопытные.
    const actions = page.getByRole('button', { name: /^Действия: / })
    await actions.last().click()
    await page.getByRole('menuitem', { name: 'Запланировать статус' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Статусы сотрудника')).toBeVisible({ timeout: 20_000 })

    // До выбора блока нет — иначе проверка «блок появился» ничего не значит.
    await expect(dialog.getByText('Мероприятия', { exact: true })).toHaveCount(0)

    await dialog.locator('#status').click()
    await expect(page.getByRole('listbox')).toBeVisible()
    const option = page.getByRole('option', { name: label, exact: true })
    await option.scrollIntoViewIfNeeded()
    await option.click()

    await expect(
      dialog.locator('#status'),
      'в поле статуса встал не тот тип, который выбран',
    ).toContainText(label)
    await expect(
      dialog.getByText('Мероприятия', { exact: true }),
      'у «Участия в ОМ» блок мероприятий обязан появиться — иначе статус ' +
        'заводится «неизвестно на что», а расход считает человека свободным',
    ).toBeVisible()
  })

  test('окно спрашивает мероприятие и физнаряд, а пишет в учёт раздела ОМ', async ({
    page,
  }) => {
    const squadLabel = await labelOfStatus(SQUAD_STATUS_CODE)

    await signIn(page)
    await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 })

    // Имя сотрудника первой строки нужно ПОСЛЕ сохранения: карточку статусов
    // придётся открыть у него же, а порядок строк меняют соседние пробы.
    const firstRow = page.locator('table tbody tr').first()
    const employeeName = (await firstRow.locator('td').nth(2).innerText()).trim()

    // 🔴 КАРТОЧКА ОТКРЫВАЕТСЯ ДО ЗАПИСИ — И ЭТО НЕ ЛИШНИЙ ШАГ. Так список
    // учёта раздела попадает в кэш клиента, и дальше проба стережёт не только
    // «раздел есть», но и то, что после записи он ОСВЕЖАЕТСЯ. Без сброса ключа
    // повторно открытая карточка показала бы прежний список из кэша — человек
    // не нашёл бы своё привлечение и поставил бы его второй раз.
    const beforeRow = page.locator('table tbody tr', { hasText: employeeName }).first()
    await beforeRow.getByTitle('Открыть статусы сотрудника').click()
    const before = page.getByRole('dialog')
    await expect(before.getByText('Учёт раздела ОМ')).toBeVisible({ timeout: 20_000 })
    await expect(
      before.getByText('Загружаем учёт раздела…'),
      'список учёта раздела дождался ответа',
    ).toHaveCount(0, { timeout: 20_000 })
    const participationsBefore = await before
      .locator('li')
      .filter({ hasText: /ОМ-/ })
      .count()
    await before.getByRole('button', { name: 'Закрыть' }).click()
    await expect(before).toHaveCount(0)

    await page.getByRole('button', { name: /^Действия: / }).first().click()
    await page.getByRole('menuitem', { name: 'Запланировать статус' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Статусы сотрудника')).toBeVisible({ timeout: 20_000 })

    // (1) У статуса НЕ ПРО ОМ блока мероприятий нет вовсе.
    //
    // 🔴 СНАЧАЛА СТАВИМ ЗАВЕДОМО НЕ-ОМ ТИП, а не смотрим на умолчание
    // (Plane №378): с добавлением `IN_EVENT` в список кодов участия окно у
    // человека, чей текущий статус — «Участие в ОМ», законно открывается с
    // блоком мероприятий, и проверка «блока нет» падала на правильном
    // поведении. Предмет проверки — что блок ЗАВИСИТ ОТ ТИПА, а не то, каким
    // статусом сейчас живёт первый попавшийся сотрудник.
    await dialog.locator('#status').click()
    await expect(page.getByRole('listbox')).toBeVisible()
    const plainOption = page
      .getByRole('option')
      .filter({ hasNotText: 'ОМ' })
      .filter({ hasNotText: 'мероприяти' })
      .first()
    await plainOption.scrollIntoViewIfNeeded()
    await plainOption.click()
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
    // Код выбранного ОМ держим строкой: по нему проба потом ищет привлечение
    // в карточке сотрудника.
    const eventCode = (
      (await dialog.getByLabel('Мероприятие 1', { exact: true }).innerText()).match(
        /ОМ-[\d-]+/,
      ) ?? ['']
    )[0]
    expect(eventCode, 'код мероприятия не разобрался из поля').not.toBe('')

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

    // (5) 🔴 СТАТУС ВИДЕН ЧЕЛОВЕКУ, А НЕ ТОЛЬКО СЕРВЕРУ (Plane №368, Ш-3).
    // Ш-2 сам по себе заводил строку в учёте раздела и не показывал её нигде:
    // карточка статусов сотрудника читала только кадровые строки, а ключ
    // списка раздела после записи не сбрасывался — до перезагрузки страницы
    // человек не находил своё привлечение и ставил его второй раз.
    const row = page.locator('table tbody tr', { hasText: employeeName }).first()
    await row.getByTitle('Открыть статусы сотрудника').click()
    const card = page.getByRole('dialog')
    await expect(card.getByText('Учёт раздела ОМ')).toBeVisible({ timeout: 20_000 })
    await expect(
      // `.first()`: у сотрудника может быть НЕСКОЛЬКО строк учёта с этим же
      // мероприятием — проба ставит одну, а стенд накапливает их от прогона к
      // прогону (снять статус расхода нельзя по устройству модели).
      card.getByText(eventCode, { exact: false }).first(),
      'привлечение записано, но в карточке сотрудника его не видно',
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      card.locator('li').filter({ hasText: /ОМ-/ }),
      'список учёта раздела не освежился после записи — карточка показывает кэш',
    ).toHaveCount(participationsBefore + 1, { timeout: 20_000 })
  })
})
