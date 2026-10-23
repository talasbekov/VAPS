/**
 * «Сборы» на `/employees?view=forces` — вид ШТАБА (Plane №271, Ш-1).
 *
 * ЗЕРКАЛО «ЗАЯВОК». Департамент спрашивает «что просят у меня», штаб —
 * «сколько я раздал и сколько мне вернули»; вкладки соседние и обе видны
 * тому, у кого оба права (администратор). Проба стережёт, что они НЕ
 * подменяют друг друга.
 *
 * Стережёт также: числа приходят с сервера, а не считаются на клиенте
 * (второй счёт разошёлся бы с первым), и полоса объявлена вспомогательным
 * технологиям.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
// Подготовка ОМ до посчитанной потребности — общий модуль, а не копия:
// две реализации одной подготовки разошлись бы при первой правке цепочки
// стадий (см. шапку `prepare-events.ts`).
import { prepareDemandEvent } from './prepare-events'
import { assertStep } from './fixture-step'
import { uniqueBusinessDate } from './business-date'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface CollectionRow {
  code: string
  need: number
  gathered: number
  // `[СБС-10]` (Plane №426): выделяют / прислано / статус словами / срочно / новая.
  allocating: number
  sent: number
  boardStatus: { code: string; label: string }
  urgent: boolean
  isNew: boolean
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  if (!res.ok) throw new Error(`[фикстура] вход стенда: ${res.status} ${(await res.text()).slice(0, 600)}`)
  const body = await res.json() as { access?: string }
  expect(typeof body.access, 'вход стенда не вернул access').toBe('string')
  expect(body.access!.length, 'вход стенда вернул пустой access').toBeGreaterThan(0)
  return body.access!
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe('сборы сил (вид штаба)', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('над вкладками нет бокса «Запрос сил по мероприятиям» (Plane №928)', async ({ page }) => {
    /**
     * Слово заказчика: «зачем этот бокс нужен, если он ничего не делает —
     * убери его». №928 бокс сняла, но саму просьбу ни одна проба не стерегла
     * (ревью №825, 08.09.2026): возврат блока случайным мержем прошёл бы
     * зелёным. Проверяется отсутствие ЗАГОЛОВКА снятого бокса при живых
     * вкладках — чтобы «нет» не было «страница не отрисовалась».
     */
    await signIn(page)
    await page.goto(`${APP}/employees?view=forces`)
    await expect(page.getByRole('tab', { name: 'Сборы', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Запрос сил по мероприятиям', { exact: true })).toHaveCount(0)
  })

  test('таблица собрана из ручки сборов и не подменяет вкладку заявок', async ({ page }) => {
    const token = await apiToken()
    const server = (await (
      await fetch(`${API}/api/ops/security-events/forces/collections/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: CollectionRow[] }
    expect(
      server.results.length,
      'на стенде нет ни одного сбора — таблице нечего показать',
    ).toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}/employees?view=forces`)

    // ОБЕ вкладки на месте: у администратора есть оба права, и одна не должна
    // прятать другую.
    const collections = page.getByRole('tab', { name: 'Сборы', exact: true })
    await expect(collections).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('tab', { name: 'Заявки', exact: true })).toBeVisible()

    await collections.click()
    const section = page.locator('section[aria-labelledby="force-collections-heading"]')
    await expect(section.getByRole('heading', { name: 'Сборы сил' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(section.locator('tbody tr'), 'строк столько же, сколько отдала ручка').toHaveCount(
      server.results.length,
      { timeout: 20_000 },
    )

    const first = server.results[0]
    await expect(section.getByText(first.code, { exact: false }).first()).toBeVisible()
    await expect(
      section.getByText(`${first.gathered} из ${first.need}`, { exact: false }).first(),
      'прогресс не назван числом',
    ).toBeVisible()
    // Статус — подпись сервера по спецификации `[СБС-10]` (Новая / Запросы
    // отправлены / Ответы получены K из M / Распределено), не словарь клиента.
    const firstRow = section.locator('[data-slot="force-collection-row"]').first()
    await expect(firstRow.locator('[data-slot="collection-status"]')).toHaveText(first.boardStatus.label)
    await expect(firstRow.locator('[data-slot="collection-allocating"]')).toHaveText(String(first.allocating))
    await expect(firstRow.locator('[data-slot="collection-urgent"]')).toHaveCount(first.urgent ? 1 : 0)
    await expect(firstRow.locator('[data-slot="collection-new"]')).toHaveCount(first.isNew ? 1 : 0)
    // Порядок — с сервера: срочные, потом новые, потом по дате.
    const codes = await section.locator('[data-slot="force-collection-row"] .font-mono').allInnerTexts()
    expect(codes.slice(0, server.results.length)).toEqual(server.results.map((r) => r.code))

    const bar = section.locator('[role="progressbar"]').first()
    await expect(bar).toHaveAttribute('aria-valuemax', String(first.need))
    await expect(bar).toHaveAttribute('aria-valuenow', String(first.gathered))
  })

  test('карточка сбора открывается на месте списка и раскрывает департамент', async ({
    page,
  }) => {
    /**
     * Plane №271, Ш-2. Карточка открывается НА МЕСТЕ списка («← Назад к
     * списку сборов»), как на эталоне и как у департамента в №272.
     *
     * 🔴 ПРОБА ЗАВОДИТ СВОЁ МЕРОПРИЯТИЕ, а не берёт стендовое. Первая версия
     * выбирала первый сбор без раскладки — а это фикстура смоука, с которой
     * работают соседние спеки. В одиночку проба была зелёной, в ПОЛНОМ
     * прогоне падала: сосед успевал разослать по той же заявке разнарядку, и
     * замена раскладки отбивалась `ALLOCATION_LOCKED`. Драться за общую
     * фикстуру нельзя — своё мероприятие ничего ни у кого не отнимает.
     */
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const own = await prepareDemandEvent(token, '2026-09-15')
    const list = (await (
      await fetch(`${API}/api/ops/security-events/forces/collections/`, { headers })
    ).json()) as { results: (CollectionRow & { eventId: string; departments: number })[] }
    const target = list.results.find((row) => row.code === own.code)
    expect(target, 'своё мероприятие не попало в список сборов').toBeDefined()

    const divisions = (await (
      await fetch(`${API}/api/ops/daily/divisions/?page_size=100`, { headers })
    ).json()) as {
      results: {
        id: string
        name: string
        ancestors?: string[]
        division_type?: string
      }[]
    }
    // Департамент опознаётся ПО ТИПУ, а не по «нет предков» (Plane №307).
    // Прежний признак был неверен и просто везло: у корневой ОРГАНИЗАЦИИ
    // предков тоже нет (`ancestors_of` выбрасывает её из пути осознанно), и
    // пока список шёл по алфавиту, первой без предков случайно оказывался
    // настоящий департамент. С переходом на обход дерева (Plane №296) первой
    // встала организация, и POST раскладки стал получать её id — 400 «Такого
    // департамента нет в справочнике».
    // Значение — как его хранит модель (`TextChoices`: 'organization',
    // 'department', 'directorate', 'division'), строчными. Верхний регистр
    // молча не нашёл бы ничего и упал бы на `toBeDefined` — то есть врал бы
    // про «в справочнике нет департаментов».
    const department = divisions.results.find(
      (row) => row.division_type === 'department',
    )
    expect(
      department,
      'в справочнике нет ни одного узла типа department — раскладку слать некому',
    ).toBeDefined()

    const created = await fetch(
      `${API}/api/ops/security-events/${target!.eventId}/forces/allocation/`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ rows: [{ departmentId: String(department!.id), need: 3 }] }),
      },
    )
    expect(created.status, await created.text()).toBe(200)

    try {
      await signIn(page)
      await page.goto(`${APP}/employees?view=forces`)
      const tab = page.getByRole('tab', { name: 'Сборы', exact: true })
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()

      await page.getByRole('button', { name: `Открыть сбор ${target!.code}` }).click()

      // 🔴 ЖДЁМ КАРТОЧКУ ПЕРВОЙ (Plane №683). Проверки состава стояли ВЫШЕ
      // этого ожидания и шли с таймаутом по умолчанию (5 с), тогда как само
      // ожидание получило 20 с намеренно: на живом стенде карточка
      // открывается медленно. На нагруженном стенде проба краснела на
      // `[data-slot="collection-need"]` — то есть жаловалась на состав
      // карточки, которой ещё нет, вместо того, что стережёт. Отступ у тех
      // строк вдобавок выпадал из окружающего `try`, и порядок не читался
      // глазами.
      await expect(
        page.getByRole('button', { name: 'Назад к списку сборов' }),
        'карточка открылась на месте списка',
      ).toBeVisible({ timeout: 20_000 })

      // `[СБС-11]`/`[СБС-12]` (Plane №426): потребность по объектам с «Итого»,
      // итог «потребность · выделяют · прислано · недобор», колонки департаментов.
      await expect(page.locator('[data-slot="collection-need"]')).toBeVisible()
      await expect(page.locator('[data-slot="need-total"]')).toContainText('Итого')
      await expect(page.locator('[data-slot="collection-totals"]')).toContainText(/потребность \d+ · выделяют \d+ · прислано \d+ · недобор \d+/)
      for (const header of ['Запрошено', 'Выделяют', 'Прислано', 'Комментарий', 'Статус', 'Ответственный']) {
        await expect(page.getByRole('columnheader', { name: header, exact: true }).first()).toBeVisible()
      }

      // Четыре плитки эталона.
      for (const label of [
        'Требуется по рекогносцировке',
        'Распределено квотами',
        'Собрано',
        'Осталось собрать',
      ]) {
        await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
      }

      // Раскрытие строки департамента — то, ради чего карточка и нужна.
      const split = page.locator('section[aria-labelledby="collection-split-heading"]')
      const row = split.locator('button[aria-expanded]').first()
      await expect(row).toHaveAttribute('aria-expanded', 'false')
      await row.click()
      await expect(row).toHaveAttribute('aria-expanded', 'true')
      await expect(
        split.getByText('Выделенные сотрудники', { exact: false }),
        'раскрытая строка не показала список выделенных',
      ).toBeVisible()

      // Возврат работает: человек не заперт в карточке.
      await page.getByRole('button', { name: 'Назад к списку сборов' }).click()
      await expect(page.getByRole('heading', { name: 'Сборы сил' })).toBeVisible()
    } finally {
      await fetch(`${API}/api/ops/security-events/${target!.eventId}/forces/allocation/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ rows: [] }),
      }).catch(() => undefined)
    }
  })

  /**
   * У доски сбора сил есть АДРЕС: вкладка и открытый сбор переживают
   * перезагрузку и пересылаются ссылкой (Plane №779).
   *
   * Оба состояния жили в `useState`, и уведомление штабу («Первый департамент
   * выделяет 2 из 3») вести было некуда — ссылку у него выставили `null`
   * осознанно. Теперь `?tab=collections&collection=<id>` открывает карточку
   * сразу, как `?forcesRequest=` у запроса управлению с №392.
   *
   * 🔴 ПРОБА ХОДИТ ПО АДРЕСУ, А НЕ КЛИКАЕТ. Клик проверил бы, что кнопка
   * работает (это уже стережёт соседняя проба); предмет здесь — что состояние
   * ДОЕХАЛО ДО URL и читается обратно. Поэтому карточка открывается
   * переходом по ссылке, а «Назад к списку сборов» проверяется тем, что
   * параметр из адреса ушёл.
   */
  test('адрес открывает вкладку сборов и сам сбор (Plane №779)', async ({ page }) => {
    const token = await apiToken()
    const server = (await (
      await fetch(`${API}/api/ops/security-events/forces/collections/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: (CollectionRow & { eventId: string })[] }
    const target = server.results[0]
    expect(target, 'на стенде нет ни одного сбора — открывать нечего').toBeDefined()

    await signIn(page)
    await page.goto(
      `${APP}/employees?view=forces&tab=collections&collection=${encodeURIComponent(
        target!.eventId,
      )}`,
    )

    // Карточка сбора открыта СРАЗУ: ни вкладку, ни строку выбирать не нужно.
    //
    // 🔴 «КНОПКА ВИДНА» — НЕ ДОКАЗАТЕЛЬСТВО (найдено ревью №825). «Назад к
    // списку сборов» рисуется И В ВЕТКЕ ОТКАЗА (`ForceCollectionCard`,
    // `collection.isError`), поэтому проба проходила бы и на карточке,
    // ответившей «Сбор не открылся», — то есть ровно в том сценарии, ради
    // которого карточка №779 и заведена. Соседний ассерт по коду ОМ не
    // спасал: он ищет по всей странице, а тот же код печатался в блоке
    // входящих штаба НАД вкладками, и `.first()` брал верхнее вхождение.
    // (Блока с Plane №928 больше нет, но доказательство остаётся прежним:
    // «Назад к списку сборов» рисуется и в ветке отказа.)
    //
    // Поэтому доказательство — состояние сбора, которое есть ТОЛЬКО в
    // успешной ветке, и явное отсутствие тревоги на экране.
    await expect(
      page.getByRole('button', { name: 'Назад к списку сборов' }),
      'адрес не открыл карточку сбора — уведомлению штаба вести некуда',
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      page.locator('[data-slot="collection-status"]'),
      'карточка сбора ответила отказом, а не данными',
    ).toBeVisible({ timeout: 20_000 })
    // Тревога ИМЕННО карточки сбора: на экране есть и посторонние `role=alert`
    // (баннеры раздела), и общая проверка ловила бы их.
    await expect(
      page.locator('p[role="alert"]', { hasText: /Сбор не открылся|Доступ|Ошибка/ }),
    ).toHaveCount(0)

    // Возврат к списку убирает сбор из адреса — иначе ссылка «на список»
    // снова открывала бы карточку.
    await page.getByRole('button', { name: 'Назад к списку сборов' }).click()
    await expect(page.locator('section[aria-labelledby="force-collections-heading"]')).toBeVisible({
      timeout: 15_000,
    })
    await expect
      .poll(() => new URL(page.url()).searchParams.get('collection'), { timeout: 10_000 })
      .toBeNull()
    // А вкладка в адресе осталась: человек вернулся к списку СБОРОВ, а не на
    // первую вкладку экрана.
    expect(new URL(page.url()).searchParams.get('tab')).toBe('collections')
  })

  test('каждая вкладка экрана открывается своим адресом, мусорный — списком (Plane №779)', async ({
    page,
  }) => {
    /**
     * 🔴 БЕЛЫЙ СПИСОК ВКЛАДОК ВЕДЁТСЯ РУКАМИ (найдено ревью №825). С переездом
     * вкладки в адрес неизвестное значение перестало совпадать с каким-либо
     * `TabsContent` — человек получал пустую область под шапкой без единого
     * слова. Значение сводится к «Списку сотрудников»; цена этого решения —
     * список, который обязан совпадать с разметкой, и ЗАБЫТОЕ значение
     * молча уводит на список ровно ту ссылку, ради которой вкладка и
     * переехала в адрес. Первая же проверка снимком нашла два забытых.
     */
    await signIn(page)
    // Первый заход — с ожиданием шапки вкладок: сразу после входа страница
    // ещё может стоять на редиректе, и локатор не нашёл бы ничего.
    await page.goto(`${APP}/employees?view=forces&tab=collections`)
    await expect(page.getByRole('tab', { name: 'Сборы', exact: true })).toBeVisible({
      timeout: 30_000,
    })

    for (const [tab, name] of [
      ['collections', 'Сборы'],
      ['requests', 'Заявки'],
      ['table', 'Список сотрудников'],
      ['cards', 'Карточки'],
    ] as const) {
      await page.goto(`${APP}/employees?view=forces&tab=${tab}`)
      await expect(
        page.getByRole('tab', { name, exact: true }),
        `вкладка ?tab=${tab} не открылась своим адресом`,
      ).toHaveAttribute('data-state', 'active', { timeout: 20_000 })
    }

    // А мусорное значение — на «Список сотрудников», а не в пустоту.
    await page.goto(`${APP}/employees?view=forces&tab=zzz`)
    await expect(
      page.getByRole('tab', { name: 'Список сотрудников', exact: true }),
    ).toHaveAttribute('data-state', 'active', { timeout: 20_000 })
  })

  test('на вкладке сборов нет чужих управлений — поиска по людям и выгрузки', async ({
    page,
  }) => {
    /**
     * Отбор по ФИО и «Экспорт CSV» — про СПИСОК ЛЮДЕЙ. На вкладке сборов они
     * не делают ничего, а пустой элемент управления не нейтрален: человек
     * пробует им пользоваться. Ровно это уже чинили на вкладке заявок
     * (Plane №272, Ш-3), и проба закрепляет правило для обеих.
     */
    await signIn(page)
    await page.goto(`${APP}/employees?view=forces`)
    const collections = page.getByRole('tab', { name: 'Сборы', exact: true })
    await expect(collections).toBeVisible({ timeout: 30_000 })
    await collections.click()
    await expect(
      page.getByRole('heading', { name: 'Сборы сил' }),
    ).toBeVisible({ timeout: 20_000 })

    await expect(page.getByPlaceholder('Поиск по ФИО, должности, отделу...')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Экспорт CSV/ })).toHaveCount(0)
  })
  test('собранные отдаются объектам, «Передать на расстановку» с недобором просит комментарий (Plane №390)', async ({
    page,
  }) => {
    /**
     * `[СБС-13]`: блок «Собранные сотрудники → объекты» на карточке штаба:
     * люди состава с чекбоксами, объекты с ёмкостью «потребность N /
     * назначено M», «На объект…», «Передать на расстановку» — при недоборе
     * подтверждение с комментарием. До правки «Принять в мероприятие» сыпал
     * весь список в общий пул, и у ОМ с двумя объектами люди одного объекта
     * предлагались на посты другого.
     *
     * Фикстура доводит заявку до «принято штабом» по API (квота департамента
     * → раскладка управлению → оповещение → выделение своего сотрудника
     * → отправка → приём), дальше —
     * экран: отметить человека → «Отдать объекту» → ёмкость «назначено 1» →
     * «Передать на расстановку» → недобор → комментарий → передано.
     */
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const call = async (method: string, path: string, body?: unknown): Promise<any> => {
      const res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      await assertStep(res, method, path)
      if (!res.ok) throw new Error(`[фикстура] ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 600)}`)
      return res.status === 204 ? {} : res.json()
    }
    // 🔴 БЫЛ Ш-3 №567 (доводка №881 по ревью №825): `Math.floor(Date.now() /
    // 1000) % 300` цикличен ровно с периодом 300 с (5 мин) реального времени
    // — та же болезнь, которую №881 закрыла в `business-date.ts`, но не
    // заметила здесь. `uniqueBusinessDate()` не повторяется в пределах
    // процесса и разведена по воркерам (Plane №893).
    const businessDate = uniqueBusinessDate()
    const own = await prepareDemandEvent(token, businessDate)
    const eventId = own.id
    try {
      expect(own.total, 'для диалога недобора требуется больше одного сотрудника').toBeGreaterThan(1)
      const list = (await call('GET', '/api/ops/security-events/forces/collections/')) as {
        results: { code: string; eventId: string }[]
      }
      const target = list.results.find((row) => row.code === own.code)
      expect(target, 'своё мероприятие не попало в список сборов').toBeDefined()
      expect(target!.eventId).toBe(eventId)
      type Division = { id: number; name: string; type_code: string; parent: number | null }
      const divisions: Division[] = []
      let divisionPath: string | null = '/api/core/divisions/?page_size=200'
      const visited = new Set<string>()
      while (divisionPath !== null) {
        expect(visited.has(divisionPath), 'справочник подразделений вернул кольцо пагинации').toBe(false)
        visited.add(divisionPath)
        const response = await call('GET', divisionPath) as { results: Division[]; next: string | null }
        divisions.push(...response.results)
        const next: URL | null = response.next === null ? null : new URL(response.next, API)
        divisionPath = next === null ? null : `${next.pathname}${next.search}`
      }
      const directorate = divisions.find(row => row.type_code === 'directorate' && divisions.some(parent => parent.id === row.parent && parent.type_code === 'department'))
      expect(directorate, 'в справочнике нет управления своего департамента').toBeDefined()
      const department = divisions.find(row => row.id === directorate!.parent && row.type_code === 'department')!
      const roster = await call('GET', `/api/ops/personnel/?division_id=${directorate!.id}&business_date=${businessDate}&page_size=1`)
      expect(roster.results, 'в выбранном управлении нет своего сотрудника').toHaveLength(1)
      const person = roster.results[0]
      const base = `/api/ops/security-events/${eventId}/forces/allocation`
      const split = await call('POST', `${base}/`, {
        rows: [{ departmentId: String(department.id), need: 1 }],
      })
      expect(split.forceAllocation).toHaveLength(1)
      expect(split.forceAllocation[0]).toMatchObject({ departmentId: String(department.id), need: 1 })
      const allocationId = split.forceAllocation[0].id as string
      const allocationBase = `${base}/${encodeURIComponent(allocationId)}`
      const directorateSplit = await call('POST', `${allocationBase}/split/`, {
        rows: [{ divisionId: String(directorate!.id), need: 1 }],
      })
      expect(directorateSplit.forceAllocation.find((row: any) => row.id === allocationId)?.directorates.filter((row: any) => row.need > 0))
        .toEqual([expect.objectContaining({ divisionId: String(directorate!.id), need: 1 })])
      const notified = await call('POST', `${allocationBase}/notify/`)
      const notifiedAllocation = notified.forceAllocation.find((row: any) => row.id === allocationId)
      expect(notifiedAllocation?.status, 'заявка не дошла до NOTIFIED').toBe('NOTIFIED')
      expect(notifiedAllocation.directorates.find((row: any) => row.divisionId === String(directorate!.id))?.notifiedAt,
        'управлению не отправлен запрос').toBeTruthy()
      const added = await call('POST', `${allocationBase}/members/`, { employeeId: person.id })
      expect(added.forceAllocation.find((row: any) => row.id === allocationId)?.members.map((member: any) => member.employeeId))
        .toEqual([String(person.id)])
      const submitted = await call('POST', `${allocationBase}/submit/`)
      expect(submitted.forceAllocation.find((row: any) => row.id === allocationId)?.status, 'список не отправлен штабу').toBe('SUBMITTED')
      expect(submitted.forceRoster.map((member: any) => member.employeeId)).toEqual([String(person.id)])
      const accepted = await call('POST', `${allocationBase}/accept/`)
      expect(accepted.forceAllocation.find((row: any) => row.id === allocationId)?.status, 'штаб не принял список').toBe('ACCEPTED')
      expect(accepted.forceRoster.map((member: any) => member.employeeId)).toEqual([String(person.id)])

      await signIn(page)
      await page.goto(`${APP}/employees?view=forces`)
      await page.getByRole('tab', { name: 'Сборы', exact: true }).click()
      await page.getByRole('button', { name: `Открыть сбор ${own.code}` }).click()

      const block = page.locator('section[aria-labelledby="roster-objects-heading"]')
      await expect(block).toBeVisible({ timeout: 20_000 })
      await expect(block.getByText('не распределены: 1', { exact: false })).toBeVisible()
      const objectId = (await call('GET', `/api/ops/security-events/${eventId}/`)).visitObjects[0].id as string
      const capacity = block.locator(`[data-testid="object-capacity-${objectId}"]`)
      await expect(capacity).toContainText('назначено 0')

      await block.getByRole('checkbox', { name: /Отметить/ }).first().check()
      await block.locator('#roster-target').selectOption(objectId)
      await block.getByRole('button', { name: 'Отдать объекту: 1' }).click()
      await expect(capacity).toContainText('назначено 1', { timeout: 15_000 })
      await expect(block.getByText('не распределены', { exact: false })).toHaveCount(0)

      // Недобор: потребность объекта больше одного человека — диалог с
      // обязательным комментарием.
      await block.getByRole('button', { name: 'Передать на расстановку' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Передать с недобором' })).toBeDisabled()
      await dialog.getByLabel('Комментарий к передаче с недобором').fill('Остальных доберём к среде')
      await dialog.getByRole('button', { name: 'Передать с недобором' }).click()
      await expect(block.getByText('Передано на расстановку', { exact: false })).toBeVisible({ timeout: 15_000 })

      const fresh = await call('GET', `/api/ops/security-events/${eventId}/force-collection/`)
      expect(fresh.handover.comment).toBe('Остальных доберём к среде')
      expect(fresh.roster[0].visitObjectId).toBe(objectId)
    } finally {
      await call('DELETE', `/api/ops/security-events/${eventId}/`)
    }
  })
})

const campaign978Fixture = {
  id: '978',
  code: 'РМ-2026-0978',
  title: 'Распределение на два визита',
  status: 'DISTRIBUTING',
  events: [
    {
      eventId: '201', code: 'ОМ-2026-0201', title: 'Первый визит',
      businessDate: '2026-09-12', businessDateEnd: null, eventTime: null, visitObjects: [], demandRows: [],
    },
    {
      eventId: '202', code: 'ОМ-2026-0202', title: 'Второй визит',
      businessDate: '2026-09-13', businessDateEnd: null, eventTime: null,
      visitObjects: [{ visitObjectId: '302', objectName: 'Резиденция' }],
      demandRows: [{ id: 'demand-gate', visitObjectId: '302', kindCode: 'PHYSICAL_SQUAD', place: 'Главный вход', need: 2 }],
    },
  ],
  pool: [
    { employeeId: '401', employeeName: 'Абенов Серик', kindCode: 'PHYSICAL_SQUAD', sourceEventIds: ['201'] },
    { employeeId: '402', employeeName: 'Беков Марат', kindCode: 'PHYSICAL_SQUAD', sourceEventIds: ['202'] },
  ],
  assignments: [],
  warnings: [],
}

test.describe('общее распределение сил по мероприятиям (Plane №978)', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('завершённые распределения раскрываются отдельно, а активные и довыделение остаются видимыми', async ({ page }) => {
    const handedOver = { ...campaign978Fixture, id: '979', code: 'РМ-2026-0979', title: 'Переданное распределение', status: 'HANDED_OVER' }
    const closed = { ...campaign978Fixture, id: '980', code: 'РМ-2026-0980', title: 'Закрытое распределение', status: 'CLOSED' }
    const unknown = { ...campaign978Fixture, id: '981', code: 'РМ-2026-0981', title: 'Распределение с новым статусом', status: 'RETURNED' }
    await signIn(page)
    await page.route(
      (url) => url.pathname.endsWith('/forces/campaigns/'),
      (route) => route.fulfill({ json: { results: [handedOver, campaign978Fixture, closed, unknown] } }),
    )
    await page.route(
      (url) => url.pathname.endsWith('/forces/campaigns/979/'),
      (route) => route.fulfill({ json: handedOver }),
    )
    await page.route(
      (url) => /\/security-events\/(201|202)\/force-collection\/$/.test(url.pathname),
      (route) => route.fulfill({ json: { allocations: [], totals: { allocating: 0, sent: 0, shortage: 0 } } }),
    )
    await page.route(
      (url) => url.pathname.endsWith('/forces/collections/'),
      (route) => route.fulfill({ json: { results: [{
        eventId: '201', code: 'ОМ-201', title: 'Сбор с довыделением', businessDate: '2026-10-23',
        requested: 3, allocating: 2, sent: 1, shortage: 2, need: 3, allocated: 3, gathered: 1,
        boardStatus: { code: 'DISTRIBUTED', label: 'Распределено', answered: 1, total: 1 },
        urgent: true, isNew: false, eventTime: null, location: '', visitObjects: [], stage: 'PLACEMENT',
        departments: 1, collectionStatus: 'IN_PROGRESS', overdueCount: 1,
      }] } }),
    )

    await page.goto(`${APP}/employees?view=forces&tab=collections&businessDate=2026-10-23`)
    const panel = page.locator('section[aria-labelledby="force-campaigns-heading"]')
    const disclosure = panel.locator('details')
    await expect(disclosure.locator('summary')).toHaveText('Завершённые в этом списке · 2')
    await expect(disclosure).toHaveJSProperty('open', false)
    await expect(panel.getByRole('button', { name: 'Открыть распределение РМ-2026-0978' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Открыть распределение РМ-2026-0981' })).toBeVisible()
    await expect(panel.getByText('Статус уточняется', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Открыть распределение РМ-2026-0979', includeHidden: true })).toBeHidden()
    const collection = page.locator('[data-slot="force-collection-row"]')
    await expect(collection.getByRole('button', { name: 'Открыть сбор ОМ-201' })).toBeVisible()
    await expect(collection.getByText('просрочено заявок: 1')).toBeVisible()

    await disclosure.locator('summary').focus()
    await disclosure.locator('summary').press('Enter')
    await expect(disclosure).toHaveJSProperty('open', true)
    await expect(disclosure.getByRole('button', { name: 'Открыть распределение РМ-2026-0980' })).toBeVisible()
    await disclosure.getByRole('button', { name: 'Открыть распределение РМ-2026-0979' }).click()
    await expect(page).toHaveURL(/campaign=979/)
    await expect(page.getByRole('heading', { name: 'Переданное распределение', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Переданное распределение', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Открыть сбор ОМ-2026-0201', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Назад к распределениям' }).click()
    await expect(disclosure).toHaveJSProperty('open', false)
    expect(new URL(page.url()).searchParams.get('businessDate')).toBe('2026-10-23')
    expect(new URL(page.url()).searchParams.get('campaign')).toBeNull()
    await expect(collection.getByRole('button', { name: 'Открыть сбор ОМ-201' })).toBeVisible()
  })

  test('штаб видит кампанию и открывает рабочее место общего пула', async ({ page }) => {
    await signIn(page)
    await page.route(
      (url) => url.pathname.endsWith('/forces/campaigns/'),
      (route) => route.fulfill({ json: { results: [campaign978Fixture] } }),
    )
    await page.route(
      (url) => url.pathname.endsWith('/forces/campaigns/978/'),
      (route) => route.fulfill({ json: campaign978Fixture }),
    )
    await page.route(
      (url) => url.pathname.endsWith('/forces/collections/'),
      (route) => route.fulfill({ json: { results: [] } }),
    )

    await page.goto(`${APP}/employees?view=forces`)
    await page.getByRole('tab', { name: 'Сборы', exact: true }).click()
    const panel = page.locator('section[aria-labelledby="force-campaigns-heading"]')
    await expect(panel.getByRole('heading', { name: 'Распределения по мероприятиям' })).toBeVisible()
    await expect(panel.getByText('Распределение на два визита', { exact: true })).toBeVisible()
    await expect(panel.getByText('Общий пул: 2')).toBeVisible()
    await panel.getByRole('button', { name: 'Открыть распределение РМ-2026-0978' }).click()
    await expect(page.getByRole('heading', { name: 'Распределение на два визита' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Общий пул' })).toBeVisible()
    await expect(page.getByText('Физнаряд · резерв', { exact: true })).toHaveCount(2)
    await expect(page.getByRole('heading', { name: 'Назначения' })).toBeVisible()
    await expect(page.getByLabel('Сотрудник', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Мероприятие', { exact: true })).toBeVisible()
  })
})
