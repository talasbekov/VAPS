/**
 * Реестр ОМ на ЖИВОМ стенде: фильтры периода и ответственного, и карточка ОМ
 * как хаб — перекрёстные переходы к объекту, сводке ГВО и «Сбору сил на ОМ».
 *
 * Проба фильтров отвечает на один вопрос: фильтры сужают выборку НА СЕРВЕРЕ, а
 * не по загруженной странице. Разница принципиальна — фильтр по странице
 * отвечал бы «ничего не найдено» там, где записи есть на следующей.
 *
 * Пробы ссылок отвечают на другой вопрос: ссылка ведёт на ТУ запись, которую
 * реально несёт карточка, а не на первую попавшуюся. Для объекта поэтому
 * берётся ОМ, чей objectId отличается от самого частого в выборке —
 * иначе баг «ссылка всегда на первый/самый частый объект» остался бы
 * незамеченным (событие с частым объектом привело бы туда же по случайности).
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

// Подписи месяцев — как на экране (`MONTH_NAME` реестра): проба листает
// календарь по его же заголовку, и расхождение регистра увело бы её в
// бесконечную прокрутку.
const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

interface EventRow {
  id: string
  code: string
  stage: string
  businessDate: string
  businessDateEnd?: string | null
  objectId: string | null
  objectName: string
  visitObjects?: {
    id: string
    objectName: string
    deputies: { id: string; employeeName: string; canEditPlacement: boolean }[]
  }[]
}

async function events(token: string, stage = ''): Promise<EventRow[]> {
  const query = `page_size=200${stage === '' ? '' : `&stage=${stage}`}`
  const res = await fetch(`${API}/api/ops/security-events/?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

/** ОМ, чей объект НЕ самый частый в выборке — см. заголовок файла. */
function pickDistinctObjectEvent(rows: EventRow[]): EventRow | undefined {
  const withObject = rows.filter((r) => r.objectId !== null)
  const counts = new Map<string, number>()
  for (const r of withObject) {
    counts.set(r.objectId as string, (counts.get(r.objectId as string) ?? 0) + 1)
  }
  const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  return withObject.find((r) => r.objectId !== mode) ?? withObject[0]
}

async function objectName(token: string, objectId: string): Promise<string> {
  const res = await fetch(`${API}/api/ops/objects/${objectId}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { name: string }).name
}

/** Выбрать первый объект реестра в поповере окна создания ОМ. */
async function pickFirstObject(page: Page, dialog: ReturnType<Page['getByRole']>): Promise<void> {
  const picker = dialog.getByRole('combobox', { name: 'Объект' })
  await expect(picker).toBeEnabled({ timeout: 20_000 })
  await picker.click()
  // Первый пункт списка — «объект не выбран»; берём следующий за ним.
  // Поповер живёт в ПОРТАЛЕ — вне узла окна, поэтому ищем его от страницы.
  const options = page.locator('[data-slot="popover-content"] li button')
  await expect(options.nth(1)).toBeVisible({ timeout: 20_000 })
  await options.nth(1).click()
  await expect(picker).not.toHaveText(/объект не выбран/)
}

test.describe(LIVE ? 'реестр ОМ' : 'реестр ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('период и ответственный фильтруют на сервере', async ({ page }) => {
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}` }
    const all = (await (
      await fetch(`${API}/api/ops/security-events/?page_size=200`, { headers })
    ).json()) as { count: number; owners: string[]; results: { businessDate: string }[] }
    expect(all.owners.length, 'нужен хотя бы один ответственный').toBeGreaterThan(0)

    const dates = [...new Set(all.results.map((e) => e.businessDate))].sort()
    const cut = dates[dates.length - 1]
    const expected = (await (
      await fetch(`${API}/api/ops/security-events/?from=${cut}&page_size=200`, { headers })
    ).json()) as { count: number }
    expect(expected.count, 'фикстура не различает период').toBeLessThan(all.count)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible({
      timeout: 15_000,
    })

    // Полоса готовности из прототипа
    await expect(page.getByRole('progressbar').first()).toBeVisible()

    // Фильтр периода: число строк совпадает с ответом сервера на тот же запрос
    await page.getByLabel('Период с').fill(cut)
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 15_000 })
      .toBe(Math.min(expected.count, 20))

    // Фильтр по ответственному предлагает значения, посчитанные сервером
    const owner = all.owners[0]
    const select = page.getByLabel('Ответственный')
    await expect(select.locator('option', { hasText: owner })).toHaveCount(1)
  })

  test('карточка ОМ: ссылка на объект ведёт на его паспорт', async ({ page }) => {
    const token = await apiToken()
    const rows = await events(token)
    const target = pickDistinctObjectEvent(rows)
    expect(target, 'на стенде нет ни одного ОМ с привязанным объектом').toBeDefined()
    const expectedName = await objectName(token, target!.objectId as string)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    // Скоуп — контент, а не боковое меню: там уже есть пункт «Объекты и
    // паспорта», и без скоупа локатор ловит оба. Имя ссылки ТОЧНОЕ: с
    // 24.08.2026 в шапке карточки рядом стоит вторая ссылка на тот же объект
    // («карточка объекта →» в контексте объекта посещения), и подстрочный
    // матчер /объект/i ловил обе.
    const escaped = expectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const link = page
      .getByRole('main')
      .getByRole('link', { name: new RegExp(`^Объект: ${escaped} →$`) })
    await expect(link).toBeVisible({ timeout: 15_000 })
    await link.click()

    await expect(page).toHaveURL(/\/security-ops\/objects\//)
    await expect(page).toHaveURL(new RegExp(`/security-ops/objects/${target!.objectId}/?$`))
    await expect(
      page.getByRole('heading', { name: expectedName }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('карточка ОМ: ссылка на сводку ГВО открывает сводку этого ОМ', async ({ page }) => {
    const token = await apiToken()
    const rows = await events(token)
    // Стадия НЕ «Бюллетень» намеренно: там своя ссылка на сводку уже стоит
    // внутри блока «Сведения об ОМ» с 21.08 — эта проба стережёт ссылку,
    // видимую на карточке ОБЩО, вне зависимости от активного этапа.
    const target = rows.find((r) => r.stage !== 'BULLETIN')
    expect(target, 'на стенде нет ни одного ОМ вне стадии «Бюллетень»').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    // Имя ТОЧНОЕ, а не подстрокой: с 25.08 панель бюллетеня раскрывается и на
    // стадиях после «Бюллетеня», когда он пуст (Plane «Реестр ОМ-5»), и внутри
    // неё стоит вторая ссылка на ту же сводку («сводки ГВО» в поясняющей
    // строке). Подстрочный матчер ловил обе и падал строгим режимом. Предмет
    // этой пробы — ссылка ШАПКИ карточки, видимая на любом этапе.
    const link = page.getByRole('main').getByRole('link', { name: 'Сводка ГВО →' })
    await expect(link).toBeVisible({ timeout: 15_000 })
    await link.click()

    await expect(page).toHaveURL(new RegExp(`/security-ops/gvo/${target!.id}/?$`))
    await expect(
      page.getByRole('heading', { name: 'Сводные данные' }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(target!.code)).toBeVisible()
  })

  test('колонки таблицы и календарь — по прототипу', async ({ page }) => {
    const token = await apiToken()
    const rows = await events(token)
    expect(rows.length, 'реестр пуст — проба вакуумна').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible({
      timeout: 20_000,
    })

    // Состав и ПОРЯДОК колонок пинятся литерально: перестановка — это другая
    // таблица, а не другой стиль. «Конфликтов» отдельной колонкой быть не
    // должно — сигнал переехал бейджем в «Этап и готовность».
    // Ждём саму таблицу: до ответа сервера на экране стоит «Загрузка реестра…»,
    // и снимок заголовков дал бы пустой список — ассерт прошёл бы мимо.
    // Локатор по разметке, а не по роли: снимок страницы показывает, что
    // Playwright читает эти <th> как cell, и getByRole('columnheader') их не
    // находит вовсе — ассерт был бы вечнозелёным на пустом массиве.
    const headCells = page.locator('thead th')
    await expect(headCells.first()).toBeVisible({ timeout: 20_000 })
    const headers = await headCells.allInnerTexts()
    expect(headers.map((h) => h.trim()).filter((h) => h !== '')).toEqual([
      // Первая колонка — раскрыватель объектов посещения; заголовок скрыт
      // визуально, но подписан для скринридера (как «Действия» в конце).
      'Объекты посещения',
      'ОМ',
      'Даты',
      'Локация',
      'Этап и готовность',
      'Потребность',
      'Ответственный',
      // Последняя колонка — стрелка перехода; её заголовок скрыт визуально,
      // но для скринридера подписан, и в текстовом снимке он есть.
      'Действия',
    ])

    // Календарь мероприятий: второй режим экрана из прототипа. Открывается на
    // месяце, где мероприятия ЕСТЬ, — пустая сетка вместо отобранных записей
    // была бы худшим исходом, чем отсутствие режима.
    await page.getByRole('button', { name: 'Календарь' }).click()
    const calendar = page.getByText(/^Календарь мероприятий · /)
    await expect(calendar).toBeVisible({ timeout: 15_000 })
    const marks = page.locator('button[aria-label*="мероприятий"]:not([disabled])')
    expect(
      await marks.count(),
      'календарь открылся на месяце без единой отметки',
    ).toBeGreaterThan(0)

    // День с отметкой открывает СВОЙ список: у первой отметки берём число из
    // подписи и сверяем со счётчиком карточки справа.
    const label = (await marks.first().getAttribute('aria-label')) ?? ''
    const expected = Number(label.replace(/^.*мероприятий /, ''))
    expect(expected, 'подпись дня не несёт числа').toBeGreaterThan(0)
    await marks.first().click()
    // Ассерт по САМОМУ счётчику и ТОЧНЫМ текстом. Первая версия искала число
    // подстрокой во всей карточке — и была вакуумной: «1» находилась в коде
    // ОМ и в дате, красная проба с константой 999 оставалась зелёной.
    await expect(page.locator('[data-slot="events-day-count"]')).toHaveText(
      String(expected),
    )

    // Повторный клик по выбранному дню СНИМАЕТ отбор и возвращает обзор
    // месяца — как в эталоне. Без этого вернуться к «показать всё» было бы
    // нечем: панель отвечала бы на вопрос про день навсегда.
    await marks.first().click()
    // Заголовок панели — `CardTitle`, а не заголовок документа: ищем текстом.
    await expect(page.getByText('Все мероприятия месяца')).toBeVisible()
  })

  test('календарь отмечает ВЕСЬ период мероприятия, а не день начала', async ({
    page,
  }) => {
    // Задача заказчика «Реестр ОМ-22». До правки трёхдневное ОМ ставило
    // отметку на первый день, и на второй-третий календарь показывал пустой
    // день — врал ровно там, где его открывают.
    const token = await apiToken()
    const rows = await events(token)
    const multi = rows.find(
      (r) =>
        r.businessDateEnd !== null &&
        r.businessDateEnd !== undefined &&
        r.businessDateEnd > r.businessDate &&
        r.businessDate.slice(0, 7) === r.businessDateEnd.slice(0, 7),
    )
    test.skip(
      multi === undefined,
      'на стенде нет многодневного ОМ в пределах одного месяца',
    )
    const lastDay = Number(multi!.businessDateEnd!.slice(8, 10))
    const firstDay = Number(multi!.businessDate.slice(8, 10))

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await page.getByRole('button', { name: 'Календарь' }).click()
    await expect(page.getByText(/^Календарь мероприятий · /)).toBeVisible({
      timeout: 15_000,
    })

    // Календарь открывается на месяце с данными — доводим его до месяца
    // фикстуры кнопками листания, а не надеждой на совпадение.
    const monthOf = async (): Promise<string> => {
      const text = (await page.getByText(/^Календарь мероприятий · /).innerText()).trim()
      return text.replace('Календарь мероприятий · ', '')
    }
    const wanted = new Date(`${multi!.businessDate}T00:00:00Z`)
    const wantedLabel = `${MONTHS[wanted.getUTCMonth()]} ${wanted.getUTCFullYear()}`
    for (let step = 0; step < 24 && (await monthOf()) !== wantedLabel; step += 1) {
      const current = await monthOf()
      const [, yearText] = current.split(' ')
      const forward =
        Number(yearText) < wanted.getUTCFullYear() ||
        (Number(yearText) === wanted.getUTCFullYear() &&
          MONTHS.indexOf(current.split(' ')[0]) < wanted.getUTCMonth())
      await page
        .getByRole('button', { name: forward ? 'Следующий месяц' : 'Предыдущий месяц' })
        .click()
    }
    expect(await monthOf(), 'не удалось долистать до месяца фикстуры').toBe(
      wantedLabel,
    )

    // ПОСЛЕДНИЙ день периода тоже кликабелен: у пустого дня кнопка выключена,
    // и «отметка есть» проверяется именно этим, а не наличием точки в разметке.
    const last = page.locator(
      `button[aria-label^="${lastDay} "][aria-label*="мероприятий"]`,
    )
    await expect(last).toBeEnabled()
    await last.click()
    // И это ТО САМОЕ мероприятие, а не соседнее того же дня.
    await expect(page.getByText(multi!.code).last()).toBeVisible()
    expect(lastDay, 'фикстура однодневная — проба вакуумна').toBeGreaterThan(
      firstDay,
    )
  })

  test('период мероприятия вводится в форме и доезжает до карточки', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible({
      timeout: 20_000,
    })

    // Многодневное ОМ: до 23.08.2026 поля «Дата окончания» в форме не было
    // вовсе, и каждое созданное вручную мероприятие выходило однодневным —
    // бэк принимал `business_date_end`, вводить его было негде.
    const title = `Проба периода (e2e) ${Date.now()}`
    await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
    const dialog = page.getByRole('dialog')
    // Кнопка окна и кнопка реестра называются одинаково — скоуп обязателен,
    // иначе строгий режим Playwright падает на двух совпадениях.
    const submit = dialog.getByRole('button', { name: 'Создать бюллетень' })
    await dialog.getByLabel('Название ОМ').fill(title)
    await dialog.getByRole('button', { name: 'Внутреннее' }).click()
    // Объект выбирается ПОПОВЕРОМ с поиском, а не <select> (24.08): в родном
    // списке искать было нечем, а реестр объектов растёт.
    await pickFirstObject(page, dialog)
    await dialog.getByLabel('Дата начала').fill('2026-09-10')
    await dialog.getByLabel('Дата окончания').fill('2026-09-12')

    // Сводка периода читает ОБЕ даты: до неё человек проверял ввод по двум
    // машинным полям и не видел ни дней недели, ни числа дней.
    await expect(dialog.getByText('10 сентября 2026', { exact: false })).toContainText(
      '3 дня',
    )

    // Перевёрнутый период форма отбивает САМА. Доказывается не текстом
    // ошибки — тот же текст возвращает и сервер, и ассерт на него проходил бы
    // со снятой клиентской проверкой (красная проба это показала), — а тем,
    // что запрос на создание НЕ УХОДИТ.
    let postsSent = 0
    // Слушатель, а не route: перехват маршрутом не видит запросов, ушедших
    // через service worker, и молча считал ноль — красная проба со снятой
    // клиентской проверкой оставалась зелёной.
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/api/ops/security-events')
      ) {
        postsSent += 1
      }
    })
    await dialog.getByLabel('Дата окончания').fill('2026-09-01')
    await submit.click()
    await expect(page.getByText('Дата окончания раньше даты начала.')).toBeVisible()
    expect(postsSent, 'форма отправила заведомо неверный период на сервер').toBe(0)

    await dialog.getByLabel('Дата окончания').fill('2026-09-12')
    await submit.click()
    await expect(page).toHaveURL(/\/security-ops\/events\/\d+/, { timeout: 30_000 })

    // В карточке — ПЕРИОД, а не одна дата: до правки трёхдневное ОМ читалось
    // как однодневное.
    await expect(
      page.getByText('10.09.2026 — 12.09.2026', { exact: false }).first(),
    ).toBeVisible({ timeout: 20_000 })

    // И в реестре продолжительность считается по тому же полю.
    await page.goto(`${APP}/security-ops/events/?search=${encodeURIComponent(title)}`)
    const row = page.locator('tbody tr').first()
    await expect(row).toContainText('10.09.2026', { timeout: 20_000 })
    await expect(row).toContainText('по 12.09.2026')
  })

  test('поля бюллетеня из окна создания доезжают до карточки', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible({
      timeout: 20_000,
    })

    // До 23.08.2026 окно создания знало только название, объект и даты: тип
    // мероприятия, время, охраняемое лицо, локацию и старшего в форме
    // прототипа человек видел, а хранить их было негде.
    const title = `Проба бюллетеня (e2e) ${Date.now()}`
    await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Название ОМ').fill(title)

    // Тип меняет подпись поля старшего ПРЯМО В ФОРМЕ — до выбора человек
    // должен знать, кого он назначает.
    // Сверяем ПОДПИСЬ поля (getByLabel), а не текст на экране: подсказка под
    // полем содержит те же слова строчными, и getByText нашёл бы два узла.
    await expect(dialog.getByLabel('Старший наряда')).toBeVisible()
    await dialog.getByRole('button', { name: 'С участием иностранцев' }).click()
    await expect(dialog.getByLabel('Старший ГВО')).toBeVisible()

    // Объект выбирается ПОПОВЕРОМ с поиском, а не <select> (24.08): в родном
    // списке искать было нечем, а реестр объектов растёт.
    await pickFirstObject(page, dialog)
    await dialog.getByLabel('Дата начала').fill('2026-09-14')
    await dialog.getByLabel('Время').fill('09:30')
    await dialog.getByLabel('Локация').fill('г. Алматы')

    const personSelect = dialog.getByLabel('Охраняемое лицо')
    await expect(personSelect.locator('option').nth(1)).toBeAttached({ timeout: 20_000 })
    const personName = (await personSelect.locator('option').nth(1).textContent()) ?? ''
    await personSelect.selectOption({ index: 1 })

    const chiefSelect = dialog.getByLabel('Старший ГВО')
    await expect(chiefSelect.locator('option').nth(1)).toBeAttached({ timeout: 20_000 })
    const chiefLabel = (await chiefSelect.locator('option').nth(1).textContent()) ?? ''
    await chiefSelect.selectOption({ index: 1 })

    await dialog.getByRole('button', { name: 'Создать бюллетень' }).click()
    await expect(page).toHaveURL(/\/security-ops\/events\/\d+/, { timeout: 30_000 })

    // Ассерты по «Сведениям об ОМ» карточки: введённое обязано вернуться с
    // сервера, а не остаться в форме.
    const facts = page.getByRole('main')
    await expect(facts).toContainText('С участием иностранцев', { timeout: 20_000 })
    await expect(facts).toContainText('09:30')
    await expect(facts).toContainText('г. Алматы')
    // Подписи выпадающих списков несут разделитель « · » — на карточке
    // стоит только имя, поэтому сверяем по первой части подписи.
    await expect(facts).toContainText(personName.split(' · ')[0]!.trim())
    await expect(facts).toContainText(chiefLabel.split(' · ')[0]!.trim())
  })

  test('строка бюллетени раскрывается в объекты посещения', async ({ page }) => {
    // Проба отвечает на два вопроса сразу: раскрытие ПОКАЗЫВАЕТ объекты
    // посещения этого ОМ (а не «на экране где-то есть имя объекта» — оно и
    // так стоит в колонке локации), и нажатие раскрывателя НЕ уводит в
    // карточку, хотя строка кликабельна целиком.
    const token = await apiToken()
    const res = await fetch(`${API}/api/ops/security-events/?page_size=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    // Берём первое ОМ С ОБЪЕКТАМИ, а не просто первое: с 24.08 бюллетень
    // заводится и без объекта, и такая строка может оказаться первой — проба
    // тогда падала бы на состоянии реестра, а не на предмете.
    const first = ((await res.json()) as {
      results: (EventRow & {
        visitObjects: { objectName: string; placementNeed: number | null }[]
      })[]
    }).results.find((e) => e.visitObjects.length > 0)
    expect(first, 'на первой странице реестра нет ОМ с объектами посещения').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    const toggle = page.getByRole('button', {
      name: `Развернуть объекты посещения ${first!.code}`,
    })
    await expect(toggle).toBeVisible({ timeout: 15_000 })

    // Панель объектов адресуется по aria-controls — так ассерт смотрит именно
    // в раскрытие своей строки, а не в любое совпадение текста на странице.
    const detailsId = await toggle.getAttribute('aria-controls')
    const details = page.locator(`#${detailsId}`)
    await expect(details).toBeHidden()

    await toggle.click()
    await expect(details).toBeVisible()
    await expect(page).toHaveURL(/\/security-ops\/events\/?$/)
    for (const visit of first!.visitObjects) {
      await expect(details).toContainText(visit.objectName)
    }
    // Готовность расстановки названа словами: доля — когда посты объекта
    // известны, причина — когда расчёт по объектам не разнесён.
    await expect(details).toContainText(
      first!.visitObjects[0].placementNeed === null
        ? /по объекту не разнесена/
        : /расстановка \d+ из \d+|посты не рассчитаны/,
    )

    // Свернуть: у той же кнопки МЕНЯЕТСЯ подпись — «Развернуть» → «Свернуть».
    // Ищем по новой подписи: локатор по старой ждал бы кнопку, которой уже нет.
    await page
      .getByRole('button', { name: `Свернуть объекты посещения ${first!.code}` })
      .click()
    await expect(details).toBeHidden()
  })

  test('объекты посещения добавляются кнопкой у строки и снимаются', async ({ page }) => {
    // Проба ведёт СВОЁ мероприятие, а не первое попавшееся: добавление меняет
    // данные, и чужая строка реестра после прогона осталась бы с лишним
    // объектом. В конце добавленный объект снимается — состояние стенда
    // возвращается к исходному.
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const objects = (await (
      await fetch(`${API}/api/ops/security-events/bindable-objects/`, { headers })
    ).json()) as { results: { id: string; name: string }[] }
    expect(objects.results.length, 'на стенде меньше двух объектов').toBeGreaterThan(1)
    const created = (await (
      await fetch(`${API}/api/ops/security-events/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: `Проба объектов посещения (e2e) ${Date.now()}`,
          objectId: objects.results[0].id,
          businessDate: '2026-09-15',
          kind: 'INTERNAL',
        }),
      })
    ).json()) as { id: string; code: string; visitObjects: { objectName: string }[] }
    expect(created.visitObjects).toHaveLength(1)
    const second = objects.results.find((o) => o.id !== objects.results[0].id)!

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/?search=${encodeURIComponent(created.code)}`)
    const add = page.getByRole('button', {
      name: `Добавить объекты посещения ${created.code}`,
    })
    await expect(add).toBeVisible({ timeout: 15_000 })
    await add.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Уже добавленный объект выбрать нельзя — иначе человек ловил бы отказ
    // сервера там, где ответ известен заранее.
    await expect(
      dialog.getByRole('checkbox', { name: new RegExp(objects.results[0].name) }),
    ).toBeDisabled()

    // Поиск сужает список — иначе на реестре объектов в сотни строк выбирать
    // было бы нечем.
    await dialog.getByLabel('Поиск объекта').fill(second.name)
    await expect(dialog.getByRole('checkbox')).toHaveCount(1)
    await dialog.getByRole('checkbox').check()
    await dialog.getByRole('button', { name: /Добавить \(1\)/ }).click()

    // Добавленное видно В РАСКРЫТИИ строки, а не только в тосте: тост уедет,
    // а реестр обязан показывать новый факт.
    // Имя раскрывателя начинается со «Свернуть/Развернуть»: без этой привязки
    // локатор поймал бы и кнопку «Добавить объекты посещения …» — у неё в
    // подписи те же слова.
    const toggle = page.getByRole('button', {
      name: new RegExp(`^(Свернуть|Развернуть) объекты посещения ${created.code}$`),
    })
    const detailsId = await toggle.getAttribute('aria-controls')
    const details = page.locator(`#${detailsId}`)
    await expect(details).toContainText(second.name, { timeout: 15_000 })
    // Заголовок врезки читается КАПСОМ, но капс делает CSS: в DOM текст
    // обычный, и ассерт по «ОБЪЕКТЫ ПОСЕЩЕНИЯ» был бы вечно красным.
    await expect(details).toContainText('Объекты посещения · 2')

    // Сервер, а не только экран: список приходит из ответа реестра.
    const after = (await (
      await fetch(`${API}/api/ops/security-events/${created.id}/`, { headers })
    ).json()) as { visitObjects: { objectName: string }[] }
    expect(after.visitObjects.map((v) => v.objectName)).toContain(second.name)

    // Снятие возвращает стенд в исходное состояние — и это же проба кнопки.
    await details.getByRole('button', { name: `Снять объект ${second.name} с мероприятия` }).click()
    await expect(details).toContainText('Объекты посещения · 1', { timeout: 15_000 })
    const restored = (await (
      await fetch(`${API}/api/ops/security-events/${created.id}/`, { headers })
    ).json()) as { visitObjects: unknown[] }
    expect(restored.visitObjects).toHaveLength(1)
  })

  test('бюллетень заводится БЕЗ объекта, объект выбирается поиском', async ({ page }) => {
    // Решение заказчика 24.08 (ClickUp 86eyqf7a7) отменяет обратное от 23.08:
    // объект в окне создания необязателен. Проба ведёт оба пути — создание без
    // объекта и выбор объекта поиском — и следит, чтобы пустой объект был
    // НАЗВАН словами, а не оставлял пустую ячейку.
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}` }
    const title = `Проба без объекта (e2e) ${Date.now()}`

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })

    await dialog.getByLabel('Название ОМ').fill(title)
    await dialog.getByRole('button', { name: 'Внутреннее' }).click()
    await dialog.getByLabel('Дата начала').fill('2026-09-18')

    // Объект НЕ трогаем вовсе — кнопка обязана сработать.
    await dialog.getByRole('button', { name: 'Создать бюллетень' }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })

    const created = ((await (
      await fetch(`${API}/api/ops/security-events/?search=${encodeURIComponent(title)}`, {
        headers,
      })
    ).json()) as { results: { id: string; code: string; objectId: string | null; visitObjects: unknown[] }[] })
      .results[0]
    expect(created, 'ОМ без объекта не завелось').toBeDefined()
    expect(created.objectId).toBeNull()
    expect(created.visitObjects).toHaveLength(0)

    // В реестре пустой объект НАЗВАН, а не оставлен пустой ячейкой.
    await page.goto(`${APP}/security-ops/events/?search=${encodeURIComponent(created.code)}`)
    const row = page.locator('tbody tr').first()
    await expect(row).toContainText('объект не выбран', { timeout: 15_000 })

    // Второй путь: поиск в списке объектов сужает выбор и выбирает объект.
    await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
    const picker = page.getByRole('combobox', { name: 'Объект' })
    await expect(picker).toHaveText(/объект не выбран/)
    await picker.click()
    const objects = (await (
      await fetch(`${API}/api/ops/security-events/bindable-objects/`, { headers })
    ).json()) as { results: { name: string; code: string }[] }
    const target = objects.results[0]
    await page.getByLabel('Поиск объекта').fill(target.name)
    await page.getByRole('button', { name: new RegExp(`${target.code}`) }).click()
    await expect(picker).toHaveText(new RegExp(target.code))

    // Заведение отсутствующего объекта: проба НЕ создаёт объект (реестр
    // объектов чистить нечем — DELETE у него нет), а проверяет проводку до
    // сервера и показ его отказа на месте, у поля названия.
    await picker.click()
    await page.getByRole('button', { name: /Объекта нет в списке/ }).click()
    await page.getByLabel('Название нового объекта').fill(target.name)
    await page.getByRole('button', { name: 'Завести' }).click()
    await expect(page.getByRole('alert')).toContainText('уже есть в реестре', {
      timeout: 15_000,
    })
  })

  test('этап «Запрос сил» ведёт в «Сбор сил на ОМ»', async ({ page }) => {
    const token = await apiToken()
    const forces = await events(token, 'FORCES')
    const target = forces[0]
    // Не молчаливый skip: причина явно записана в отчёте прогона.
    test.skip(target === undefined, 'на стенде нет ОМ на стадии FORCES («Запрос сил»)')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    // Скоуп — контент: в боковом меню уже есть пункт «Сбор сил на ОМ» с
    // тем же текстом, а строгий режим Playwright не терпит двух совпадений.
    const link = page.getByRole('main').getByRole('link', { name: /сбор сил/i })
    await expect(link).toBeVisible({ timeout: 15_000 })
    await link.click()

    await expect(page).toHaveURL(/\/employees\/?\?view=forces/)
    await expect(
      page.getByRole('heading', { name: 'Сбор сил на ОМ' }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('group', { name: 'Личный состав на сбор' }),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('замещающие назначаются из строки объекта и видны с их правом', async ({
    page,
  }) => {
    // Задача заказчика «Реестр ОМ-24». Проба идёт ЧЕРЕЗ ЭКРАН — раскрытие
    // строки, окно, выбор человека, — а не дёргает ручку: предмет требования
    // это кнопка «рядом со строкой объекта», и ассерт на API её не стережёт.
    const token = await apiToken()
    const rows = await events(token)
    const target = rows.find(
      (r) =>
        (r.visitObjects ?? []).length > 0 &&
        (r.visitObjects ?? []).every((v) => v.deputies.length === 0) &&
        r.stage !== 'CLOSED',
    )
    test.skip(
      target === undefined,
      'на стенде нет ОМ с объектом посещения и без замещающих',
    )
    const visit = target!.visitObjects![0]

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await page
      .getByRole('button', {
        name: new RegExp(`объекты посещения ${target!.code}`, 'i'),
      })
      .first()
      .click()

    // Ищем СТРОКУ ОБЪЕКТА во врезке (`li`), а не `tr`: имя объекта стоит и в
    // колонке самого бюллетеня, и `tr` с ним находится у каждого ОМ на этом
    // объекте — их на стенде десятки.
    const row = page.locator('li').filter({ hasText: visit.objectName }).first()
    // Регистр из РАЗМЕТКИ, а не с экрана: капс делает `uppercase`, а
    // `toContainText` читает textContent и капса не видит.
    await expect(row).toContainText('Замещающие:', { timeout: 15_000 })
    await expect(row).toContainText('не назначены')

    await row
      .getByRole('button', {
        name: `Добавить замещающего на объект ${visit.objectName}`,
      })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Замещающий на объекте')
    // Кнопка заперта, пока человек не выбран: назначать некого.
    const submit = dialog.getByRole('button', { name: 'Назначить' })
    await expect(submit).toBeDisabled()

    const person = dialog.locator('li button').first()
    const personName = (await person.locator('span span').first().innerText()).trim()
    await person.click()
    await expect(submit).toBeEnabled()
    await submit.click()

    // Право названо СЛОВОМ, а не только присутствием в списке: наблюдателя от
    // правящего по одному имени в строке не отличить.
    await expect(row).toContainText(personName, { timeout: 15_000 })
    await expect(row).toContainText('правит расстановку')

    // И это видит сервер, а не только экран.
    const fresh = (await events(token)).find((r) => r.id === target!.id)
    const savedVisit = (fresh?.visitObjects ?? []).find((v) => v.id === visit.id)
    expect(savedVisit?.deputies.map((d) => d.canEditPlacement)).toEqual([true])

    // Снятие уносит право — фикстура не копится между прогонами.
    await row
      .getByRole('button', {
        name: `Снять замещающего ${personName} с объекта ${visit.objectName}`,
      })
      .click()
    await expect(row).toContainText('не назначены', { timeout: 15_000 })
  })


  test('ошибочно заведённый бюллетень удаляется из реестра', async ({ page }) => {
    // Задача заказчика «Реестр ОМ-34»: убрать бюллетень было НЕЧЕМ, и реестр
    // копил мусор. Проба ведёт удаление ЧЕРЕЗ ЭКРАН и сверяет исчезновение с
    // сервером: пропасть из таблицы строка может и от фильтра.
    const token = await apiToken()
    const doomed = await createDoomedEvent(token)

    await signIn(page)
    await page.goto(
      `${APP}/security-ops/events/?search=${encodeURIComponent(DOOMED_TITLE)}`,
    )
    await expect(page.getByText(doomed.code, { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    })

    await page
      .getByRole('button', { name: `Удалить мероприятие ${doomed.code}` })
      .click()
    const dialog = page.getByRole('dialog')
    // Спрашиваем ИМЕНЕМ того, что исчезнет: иначе человек соглашается вслепую.
    await expect(dialog).toContainText(`Удалить ${doomed.code}?`)
    await dialog.getByRole('button', { name: 'Удалить' }).click()

    // Окно закрывается ОТВЕТОМ сервера — сначала дожидаемся этого, иначе код
    // ОМ находится в заголовке ещё открытого окна и счётчик ноля не дождётся.
    await expect(dialog).toHaveCount(0, { timeout: 15_000 })
    // Имя ТОЧНОЕ: «ОМ-2026-12» подстрокой входит в «ОМ-2026-123», и ноль
    // никогда бы не сошёлся — по чужой строке, а не по своей.
    await expect(
      page.getByText(doomed.code, { exact: true }),
    ).toHaveCount(0, { timeout: 15_000 })
    // Сервер, а не только таблица: из списка строка могла бы уйти отбором.
    const rows = await events(token)
    expect(rows.some((row) => row.code === doomed.code)).toBe(false)
  })

})

const DOOMED_TITLE = 'Проба удаления (e2e)'

/** Заводит заведомо удаляемое ОМ: без объекта, без работы — ровно тот случай,
 * ради которого удаление и заведено (опечатка, дубль, ошибка ввода). */
async function createDoomedEvent(
  token: string,
): Promise<{ id: string; code: string }> {
  const res = await fetch(`${API}/api/ops/security-events/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: DOOMED_TITLE,
      businessDate: '2026-08-25',
      kind: 'INTERNAL',
    }),
  })
  const created = (await res.json()) as { id: string; code: string }
  expect(created.code, 'фикстура удаления не завелась').toBeTruthy()
  return created
}

