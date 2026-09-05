/**
 * Правка сводных данных ГВО на ЖИВОМ стенде.
 *
 * Проба отвечает на один вопрос: разделы сводки действительно разбираются из
 * текстового формата прототипа («Фамилия | позывной | роль», блоки по дням) и
 * доходят до экрана, а не сохраняются в никуда. Поэтому каждый шаг ассертит
 * РАЗОБРАННОЕ значение в карточке, а не факт закрытия модалки.
 *
 * Мероприятие берётся первым из реестра, а не по зашитому id: id стенда живут
 * в БД и меняются с пересидом.
 *
 * Без SMOKE_LIVE=1 скипается, как и смоук-обход рядом: нужен поднятый стек
 * Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

// Пин дословно совпадает с константой виджета (widgets/gvo-summary)
// — проба ловит расхождение текста, а не только факт наличия какой-то строки.
const PERSONS_REGISTRY_GAP_LINE =
  'С реестром «Охраняемые лица» эти карточки не связаны — модель ГВО хранит только текст бюллетеня, без ссылки на запись каталога; появится бэк-этапом.'

interface EventRow {
  id: string
  code: string
  /** `null` — ОМ заведено до появления типа: тип не назван. */
  kind?: 'INTERNAL' | 'FOREIGN' | null
  /** Стадия: закрытому ОМ объекты посещения не правят (правило сервера). */
  stage?: string
  visitObjects?: { id: string; objectName: string }[]
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return (await res.json()) as T
}

async function registryEvents(): Promise<EventRow[]> {
  const token = await apiToken()
  const res = await fetch(`${API}/api/ops/security-events/?page_size=200`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

/**
 * Сброс сводки ОМ к черновику ЧЕРЕЗ API — предусловие пробы, а не проверка.
 *
 * Прерванный прогон (упавший на любом шаге) оставляет патч, и следующий
 * стартует не с «Черновика»: проба была бы красной по чужой причине. Сбрасывать
 * надо ВСЮ сводку, а не только правимые ниже разделы: остаток любого из них
 * держит статус «Заполнена». Сервер это и делает сам по запросу без раздела —
 * перечислять их здесь больше не нужно (Plane №774).
 */
async function resetSummary(omCode: string): Promise<void> {
  const token = await apiToken()
  // ОДИН запрос без раздела, а не цикл по восьми (Plane №774). С №765 ручка
  // `/reset/` принимает тело БЕЗ `section` и возвращает исходной ВСЮ сводку;
  // список разделов в помощнике был вторым ответом на тот же вопрос и
  // расходился бы с сервером МОЛЧА: появись девятый раздел — предусловие
  // перестало бы его сбрасывать, а проба осталась бы зелёной по неверной
  // причине (то же семейство, что №689).
  const reset = await fetch(
    `${API}/api/ops/gvo-summaries/${encodeURIComponent(omCode)}/reset/`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  )
  // Ответ ПРОВЕРЯЕТСЯ, а прежний цикл его не смотрел вовсе. Предусловие,
  // которое молча не выполнилось, — самый дорогой вид зелени: проба проверяет
  // не то состояние, о котором говорит её название.
  if (!reset.ok) {
    throw new Error(
      `предусловие не выполнено: сброс сводки ${omCode} ответил ${reset.status} ${await reset.text()}`,
    )
  }
}

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username,
      password,
      json: 'true',
    },
  })
}

test.describe(LIVE ? 'сводные данные ГВО' : 'сводные данные ГВО (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('разделы сохраняются разобранными и видны в реестре', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    await signIn(page)
    // Модуля «Реестр ГВО» больше нет (Plane «Реестр ОМ-35.8»): сводный взгляд
    // живёт вкладкой реестра ОМ, сводка — панелью карточки.
    await page.goto(`${APP}/security-ops/events/?view=gvo`)
    await expect(page.getByRole('tab', { name: 'Визиты иностранных ОЛ' })).toHaveAttribute(
      'aria-selected',
      'true',
    )

    // Мероприятие берётся не «первое в реестре», а первое С ОБЪЕКТОМ
    // ПОСЕЩЕНИЯ: с «Реестр ОМ-35.1» раздел «Объекты посещения» читает таблицу
    // объектов, и у ОМ без объекта окно правки честно пусто — проба на таком
    // мероприятии молча проверяла бы пустоту.
    // Тип НЕ внутренний: вкладка показывает визиты иностранных ОЛ («ОМ-35.5»),
    // и внутреннего мероприятия в ней нет.
    const registry = await registryEvents()
    // ЗАКРЫТОЕ мероприятие сюда не годится, и это правило сервера, а не
    // придирка: у закрытого объекты посещения не меняются вовсе («Мероприятие
    // закрыто — объекты посещения не меняются», 422). Проба ПРАВИТ день и
    // примечание, то есть ей нужен живой ОМ.
    //
    // Отбор держался на порядке реестра и сломался, как только на стенде
    // появилась закрытая фикстура с двумя объектами посещения: она встала
    // первой, окно после «Сохранить» честно осталось открытым с отказом, а
    // проба читала это как «экран не закрыл окно».
    const target = registry.find(
      (row) =>
        (row.visitObjects ?? []).length > 0 &&
        row.kind !== 'INTERNAL' &&
        row.stage !== 'CLOSED',
    )
    expect(
      target,
      'на стенде нет НЕЗАКРЫТОГО ОМ с иностранным ОЛ и объектом посещения — проба вакуумна',
    ).toBeTruthy()
    const omCode = (target as EventRow).code
    await resetSummary(omCode)
    await page.reload()

    // Ждём ЖИВУЮ таблицу вкладки: она собирается из двух запросов (реестр и
    // патчи), и ассерт по строке до их прихода падал бы «строки нет».
    await expect(page.locator('tbody tr').first()).toBeVisible({
      timeout: 20_000,
    })
    const eventRow = page.locator('tbody tr', { hasText: omCode })
    await expect(eventRow).toContainText('Черновик', { timeout: 15_000 })
    // Строка вкладки ведёт на СТРАНИЦУ ВИЗИТА (`[ГВО-01]`, Plane №436):
    // «Сводные данные →» — ссылка строки (`[РЕЕ-07]`, №441).
    await eventRow.getByRole('link', { name: /^Сводные данные / }).click()
    await expect(page.getByRole('tab', { name: 'Сводные данные ГВО' })).toBeVisible({
      timeout: 15_000,
    })
    const main = page.locator('main')

    // ЕДИНЫЙ РЕЖИМ ПРАВКИ (`[ГВО-05]`, Plane №441): одна кнопка
    // «Редактировать», все блоки инпутами, одно «Сохранить». Окон по
    // разделам и кнопок «Изменить» у блоков больше нет.
    await main.getByRole('button', { name: 'Редактировать' }).click()
    const form = page.locator('[data-slot="gvo-edit-form"]')
    await expect(form).toBeVisible()

    // Охраняемое лицо: «параметр = значение» построчно. `.last()` — база
    // сводки может нести лицо из бюллетеня, и новое лицо встаёт последним.
    await form.getByRole('button', { name: '＋ Добавить лицо' }).click()
    await form.getByRole('textbox', { name: 'ФИО' }).last().fill('Яков Милатович')
    await form.getByRole('textbox', { name: 'Должность' }).last().fill('Президент Черногории')
    await form
      .getByRole('textbox', { name: 'Данные' })
      .last()
      .fill('Группа крови = А (II) Rh +\nРост = 185 см')

    // Группа ГВО: «Фамилия | позывной | роль»; счётчик состава пересчитывается
    await form.getByRole('button', { name: '＋ Группа' }).click()
    await form.getByRole('textbox', { name: 'Название группы' }).last().fill('ГВО «Черногория»')
    await form
      .getByRole('textbox', { name: 'Состав группы' })
      .last()
      .fill('Булатаев | 2-27 | старший ГВО\nБайболов | 7-41 | прикреплённый')

    // Транспорт: «код | марка | примечание»
    await form
      .getByRole('textbox', { name: 'Транспорт' })
      .fill('VIP | Mercedes-Benz Pullman S600 W222, 2019 г.в. | бронь, гостевой парк')

    // Одно «Сохранить» на всё: разделы уезжают по очереди, форма закрывается
    // после последнего ответа.
    await form.getByRole('button', { name: 'Сохранить' }).click()
    await expect(form).toBeHidden({ timeout: 20_000 })

    await expect(main.getByText('Яков Милатович').first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(main.getByText('А (II) Rh +').first()).toBeVisible()
    await expect(main.getByText('185 см').first()).toBeVisible()
    await expect(main.getByText('2-27').first()).toBeVisible({ timeout: 10_000 })
    await expect(main.getByText('старший ГВО').first()).toBeVisible()
    await expect(main.getByText('2 чел.').first()).toBeVisible()
    await expect(
      main.getByText('Mercedes-Benz Pullman S600 W222, 2019 г.в.'),
    ).toBeVisible({ timeout: 10_000 })
    await expect(main.getByText('бронь, гостевой парк')).toBeVisible()

    // Объекты посещения: НЕ текст патча, а строки объектов мероприятия
    // («Реестр ОМ-35.1»). Правятся день и примечание КОНКРЕТНОГО объекта —
    // поля подписаны его именем, потому что объектов у ОМ может быть много.
    await page.getByRole('button', { name: 'Изменить объекты посещения' }).click()
    const visitsDialog = page.getByRole('dialog')
    // getByLabel, а не getByRole('textbox'): у input[type=date] роли textbox
    // нет, и запрос по роли молча не нашёл бы поле дня.
    const dayField = visitsDialog.getByLabel(/^День посещения — /)
    const noteField = visitsDialog.getByLabel(/^Примечание — /)
    // Имя объекта в подписи — то же, что в карточке: список ОДИН.
    const visitObjectName = (await dayField.first().getAttribute('aria-label'))
      ?.replace('День посещения — ', '')
      .trim()
    expect(visitObjectName ?? '').not.toEqual('')
    // Значения берутся ОТ ТЕКУЩИХ, а не литералами: «Сохранить» заперта, пока
    // ничего не изменилось, и прогон по уже проставленному дню упирался бы в
    // недоступную кнопку — проба один раз зелёная, дальше вечно красная.
    const wasDay = await dayField.first().inputValue()
    const nextDay = wasDay === '2026-06-19' ? '2026-06-20' : '2026-06-19'
    const nextNote = `Мухамадиев, позывной 2-13 · проба ${Date.now()}`
    await dayField.first().fill(nextDay)
    await noteField.first().fill(nextNote)
    await visitsDialog.getByRole('button', { name: 'Сохранить' }).click()
    await expect(visitsDialog).toBeHidden({ timeout: 10_000 })
    // День строки виден в карточке в русском виде, примечание — рядом с
    // объектом. Ассерт на ДАННЫЕ строки, а не на факт закрытия окна.
    const [year, month, day] = nextDay.split('-')
    await expect(main.getByText(`${day}.${month}.${year}`)).toBeVisible({
      timeout: 10_000,
    })
    await expect(main.getByText(nextNote)).toBeVisible()
    // `.first()`: имя объекта на карточке ОМ встречается ещё и в шапке, и в
    // подписи выбранного объекта посещения — предмет ассерта в том, что оно
    // ВООБЩЕ доехало в панель, а не в единственности вхождения.
    await expect(main.getByText(visitObjectName as string).first()).toBeVisible()

    // Вкладка читает ту же сводку: статус, старший ГВО и охраняемые лица.
    // Возврат — адресом вкладки: ссылки «← Назад к реестру ГВО» больше нет,
    // экран снят вместе с модулем.
    await page.goto(`${APP}/security-ops/events/?view=gvo`)
    const row = page.locator('tbody tr', { hasText: omCode })
    // `[РЕЕ-07]` (Plane №441): статус — «Черновик · заполнено K из N» по
    // сущности визита и счёту обязательных (или «Утверждено»), а не
    // «Заполнена» по факту непустого патча.
    await expect(row).toContainText(/Черновик · заполнено \d+ из \d+|Утверждено/, {
      timeout: 10_000,
    })
    await expect(row).toContainText('Булатаев · 2-27')
    await expect(row).toContainText('Яков Милатович')

    // Удаление ЭЛЕМЕНТА списка возвращает раздел в пустое состояние.
    //
    // Перед этим список сводится к ОДНОМУ лицу разделом целиком: база сводки
    // уже несёт охраняемое лицо из бюллетеня, если оно там названо, и «удалить
    // первое и ждать пустоту» держалось лишь на том, что у выбранного ОМ лица
    // не было. Цикл «удалять, пока есть» здесь не годится: панель после
    // каждого ответа пересобирается, и клик по едущей карточке не доходит.
    await row.getByRole('link', { name: /^Сводные данные / }).click()
    await expect(main.getByRole('button', { name: 'Редактировать' })).toBeVisible({
      timeout: 15_000,
    })
    await main.getByRole('button', { name: 'Редактировать' }).click()
    // Снимаются ВСЕ лица: «Удалить лицо N» у каждого, пока список не пуст.
    while ((await form.getByRole('button', { name: /^Удалить лицо \d+$/ }).count()) > 0) {
      await form.getByRole('button', { name: /^Удалить лицо \d+$/ }).first().click()
    }
    await form.getByRole('button', { name: 'Сохранить' }).click()
    await expect(form).toBeHidden({ timeout: 20_000 })
    await expect(
      main.getByText('Охраняемые лица не указаны в бюллетене'),
    ).toBeVisible({ timeout: 10_000 })

    // «Вернуть исходные» возвращает сводку в черновик: пустой патч не
    // хранится. Удаление элемента списка сюда не считается — пустой список
    // это тоже ручная правка, и статус остаётся «заполнена», пока разделы не
    // сброшены явно. С №441 кнопка одна на всю сводку — в режиме правки.
    await expect(main.getByText('Сводка заполнена')).toBeVisible()
    await main.getByRole('button', { name: 'Редактировать' }).click()
    await form.getByRole('button', { name: 'Вернуть исходные' }).click()
    await expect(form).toBeHidden({ timeout: 20_000 })
    await expect(main.getByText('Черновик сводки')).toBeVisible({ timeout: 10_000 })

    // День и примечание объектов патчем не считаются, поэтому «Вернуть
    // исходные» выше их не снимает (с Plane №765 это ОДИН запрос без раздела,
    // а не цикл по разделам, но область та же — ключи патча). Снимаем
    // отдельно, иначе следующий прогон начнётся с проставленного дня, а
    // «Сохранить» заперта, пока ничего не менялось.
    await page.getByRole('button', { name: 'Изменить объекты посещения' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Вернуть исходные' }).click()
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })

    // CLIENT_FETCH_ERROR — обрыв навигации NextAuth, не дефект экрана
    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })

  test('сводка ГВО на карточке ОМ — только ссылкой на страницу визита', async ({
    page,
  }) => {
    // `[ГВО-03]` (Plane №441): на этапах сводка НЕ разворачивается — в шапке
    // бюллетеня стоит ссылка «Карточка визита →», кнопки «Информация по
    // ГВО» и панели на месте больше нет. Прежде (Plane «Реестр ОМ-35.4»)
    // панель раскрывалась на карточке; канон визита увёл её на свою страницу
    // (`[ГВО-01]`, №436).
    const target = (await registryEvents()).find((r) => r.kind !== 'INTERNAL')
    expect(
      target,
      'в реестре нет ОМ с иностранным ОЛ — ссылку не на чем проверить',
    ).toBeTruthy()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}`)
    const link = page.getByRole('main').getByRole('link', { name: 'Карточка визита →' })
    await expect(link).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Информация по ГВО' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Состав ГВО СГО РК' })).toHaveCount(0)

    await link.click()
    await expect(page).toHaveURL(new RegExp(`/security-ops/visits/${target!.id}/?$`))
    await expect(page.getByRole('tab', { name: 'Сводные данные ГВО' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByRole('tab', { name: /Объекты посещения/ })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Бюллетень' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Транспорт' })).toBeVisible()
    // Разделы приехали целиком, а не одна шапка.
    await expect(page.getByRole('heading', { name: 'Охраняемые лица' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Объекты посещения' })).toBeVisible()
  })

  test('«уточняется» — флаг поля, не значение; визит хранит его и версию (Plane №435)', async ({
    page,
  }) => {
    /**
     * `[ГВО-06]`/`[МД-05]`: пустое поле остаётся пустым, слово «уточняется»
     * ставится чекбоксом и хранится списком у визита; правка сводки растит
     * версию визита. У внутреннего ОМ визита нет.
     */
    const target = (await registryEvents()).find((r) => r.kind !== 'INTERNAL')
    expect(target, 'в реестре нет ОМ с иностранным ОЛ').toBeTruthy()
    const token = await apiToken()
    const before = await apiGet<{ visit: { version: number } | null; unspecified: string[] }>(
      `/api/ops/gvo-summaries/${encodeURIComponent(target!.code)}/`,
      token,
    )
    expect(before.visit, 'у мероприятия с иностранцами обязан быть визит').not.toBeNull()

    await signIn(page)
    await page.goto(`${APP}/security-ops/visits/${target!.id}/`)
    await page.getByRole('main').getByRole('button', { name: 'Редактировать' }).click()
    const form = page.locator('[data-slot="gvo-edit-form"]')
    await form.getByRole('textbox', { name: 'Канал р/связи' }).fill('')
    await form.getByRole('checkbox', { name: 'Уточняется: Канал р/связи' }).check()
    await form.getByRole('button', { name: 'Сохранить' }).click()
    await expect(form).toBeHidden({ timeout: 15_000 })

    const after = await apiGet<{
      visit: { version: number; status: string } | null
      unspecified: string[]
      summary: { radio: string }
    }>(`/api/ops/gvo-summaries/${encodeURIComponent(target!.code)}/`, token)
    expect(after.unspecified).toContain('radio')
    expect(after.summary.radio, 'пустое остаётся пустым — слово не значение').toBe('')
    expect(after.visit!.version).toBeGreaterThan(before.visit!.version)

    // Внутреннему ОМ сводка не пишется вовсе.
    const internal = (await registryEvents()).find((r) => r.kind === 'INTERNAL')
    if (internal !== undefined) {
      const refused = await fetch(
        `${API}/api/ops/gvo-summaries/${encodeURIComponent(internal.code)}/`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ section: 'head', values: { country: 'X' } }),
        },
      )
      expect(refused.status).toBe(422)
    }
    // Уборка: снять флаг, чтобы соседние пробы читали чистую сводку.
    await fetch(`${API}/api/ops/gvo-summaries/${encodeURIComponent(target!.code)}/`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ section: 'org', values: {}, unspecified: [] }),
    })
  })

  test('флаги «уточняется» у Прибытия и Убытия РАЗНЫЕ, а Ответственный вообще получил флаг', async ({
    page,
  }) => {
    /**
     * ОДНА СХЕМА КЛЮЧЕЙ (Plane №686/№687). Флаги «уточняется» хранятся одним
     * списком у визита и читаются сервером как ПУТИ в сводке
     * (`arrival.date`), а форма писала голое имя поля (`date`). Отсюда две
     * беды сразу: «Прибытие» и «Убытие» делят имя `date`, и галочка ставилась
     * в обоих; сервер же не узнавал ни одного флага, кроме `country`, — то
     * есть «уточняется» было недостижимо для четырёх из пяти обязательных
     * полей, и «Утвердить» не разблокировался ничем, кроме ручного PATCH.
     *
     * Красная проверка — вернуть в `Fields` ключ `field.key` вместо
     * `field.path`: первый же `expect` увидит в списке голое `date`, а
     * галочка у убытия окажется отмеченной заодно с прибытием.
     */
    const target = (await registryEvents()).find((r) => r.kind !== 'INTERNAL')
    expect(target, 'в реестре нет ОМ с иностранным ОЛ').toBeTruthy()
    const token = await apiToken()

    await signIn(page)
    await page.goto(`${APP}/security-ops/visits/${target!.id}/`)
    await page.getByRole('main').getByRole('button', { name: 'Редактировать' }).click()
    const form = page.locator('[data-slot="gvo-edit-form"]')

    // Секции «Прибытие» и «Убытие» стоят рядом, и поле «Дата» в них одно и то
    // же по имени — берём их ПО СВОЕЙ СЕКЦИИ, а не первое попавшееся.
    const arrival = form.getByRole('region', { name: 'Прибытие / тип борта' })
    const departure = form.getByRole('region', { name: 'Убытие / тип борта' })
    const arrivalFlag = arrival.getByRole('checkbox', { name: 'Уточняется: Дата' })
    const departureFlag = departure.getByRole('checkbox', { name: 'Уточняется: Дата' })

    await arrival.getByRole('textbox', { name: 'Дата' }).fill('')
    await arrivalFlag.check()
    // 🔴 СЕРДЦЕ ПРОБЫ: галочка у соседа НЕ должна была шевельнуться.
    await expect(
      departureFlag,
      'флаг «Прибытия» поставился заодно и «Убытию» — ключ у них общий',
    ).not.toBeChecked()

    // «Ответственный» — обязательное поле, и галочка у него была выключена
    // вовсе (`noFlags`), то есть пометить его было нечем.
    const respFlag = form.getByRole('checkbox', { name: 'Уточняется: Ответственный' })
    await expect(respFlag, 'у «Ответственного» нет галочки «уточняется»').toBeVisible()
    await form.getByRole('textbox', { name: 'Ответственный' }).fill('')
    await respFlag.check()

    // «Охраняемые лица» правятся карточками, и своего поля у списка нет —
    // флаг у него на БЛОКЕ.
    const personsFlag = form.getByRole('checkbox', { name: 'Уточняется: Охраняемые лица' })
    await expect(personsFlag, 'у списка лиц нет галочки «уточняется»').toBeVisible()

    await form.getByRole('button', { name: 'Сохранить' }).click()
    await expect(form).toBeHidden({ timeout: 15_000 })

    const after = await apiGet<{ unspecified: string[]; missingRequired: string[] }>(
      `/api/ops/gvo-summaries/${encodeURIComponent(target!.code)}/`,
      token,
    )
    // Ключи — ПУТИ, и сервер их узнаёт: «Дата прибытия» и «Старший ГВО» ушли
    // из списка недостающих, «Дата убытия» осталась нетронутой.
    expect(after.unspecified).toContain('arrival.date')
    expect(after.unspecified).toContain('responsible')
    expect(after.unspecified, 'флаг убытия поставился сам').not.toContain('departure.date')
    expect(after.unspecified, 'в списке осталось голое имя поля формы').not.toContain('date')
    expect(after.missingRequired).not.toContain('Дата прибытия')
    expect(after.missingRequired).not.toContain('Старший ГВО')

    // Уборка: снимаем флаги, чтобы соседние пробы читали чистую сводку.
    await fetch(`${API}/api/ops/gvo-summaries/${encodeURIComponent(target!.code)}/`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ section: 'org', values: {}, unspecified: [] }),
    })
  })

  test('черновик правки переживает переключение вкладок, а ярлык говорит о нём', async ({
    page,
  }) => {
    /**
     * ЧЕРНОВИК НЕ ГИБНЕТ ОТ ВКЛАДКИ (Plane №693). Форма правки жила внутри
     * `TabsContent`, а Radix размонтирует неактивную вкладку: человек жал
     * «Редактировать», заполнял поля, уходил на «Объекты посещения»
     * свериться — и, вернувшись, находил пустоту. Без предупреждения, без
     * следа. Ровно тот класс потери, ради которого на карточке ОМ заведён
     * `bulletinDirty`.
     *
     * Красная проверка — убрать `forceMount` у вкладки «Сводные данные»:
     * набранное «Черногория-проба» после возврата исчезнет.
     */
    const target = (await registryEvents()).find((r) => r.kind !== 'INTERNAL')
    expect(target, 'в реестре нет ОМ с иностранным ОЛ').toBeTruthy()

    await signIn(page)
    await page.goto(`${APP}/security-ops/visits/${target!.id}/`)
    await page.getByRole('main').getByRole('button', { name: 'Редактировать' }).click()
    const form = page.locator('[data-slot="gvo-edit-form"]')
    const country = form.getByRole('textbox', { name: 'Страна' })
    await country.fill('Черногория-проба')

    // Ярлык вкладки говорит о несохранённом — иначе черновик, переживший
    // переключение, остался бы незаметным.
    const summaryTab = page.getByRole('tab', { name: /Сводные данные ГВО/ })
    await expect(summaryTab).toContainText('есть несохранённые правки')

    await page.getByRole('tab', { name: /Объекты посещения/ }).click()
    await page.getByRole('tab', { name: /Сводные данные ГВО/ }).click()

    await expect(
      country,
      'черновик правки исчез при переключении вкладки — набранное потеряно молча',
    ).toHaveValue('Черногория-проба')

    // Уходим без сохранения: проба ничего не меняет на стенде.
    await form.getByRole('button', { name: 'Отмена' }).click()
  })

  test('у внутреннего мероприятия ссылки «Карточка визита →» нет', async ({
    page,
  }) => {
    // Задача заказчика «Реестр ОМ-35.5»: сводка ГВО — про выездную охрану
    // иностранного ОЛ. У внутреннего ОМ её нет, и ссылка обещала бы пустоту
    // (с №441 в шапке бюллетеня ссылка, а не кнопка-разворот).
    //
    // Мероприятие заводится ПРОБОЙ и снимается в конце: искать внутреннее ОМ в
    // реестре значит зависеть от того, что кто-то его там оставил, — молчаливый
    // скип вместо проверки.
    const token = await apiToken()
    const created = (await (
      await fetch(`${API}/api/ops/security-events/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: `Внутреннее ОМ (e2e) ${Date.now()}`,
          businessDate: '2026-09-01',
          kind: 'INTERNAL',
        }),
      })
    ).json()) as { id: string; code: string }
    expect(created.code, 'фикстура внутреннего ОМ не завелась').toBeTruthy()

    try {
      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${created.id}`)
      // Ждём ЖИВУЮ карточку, а не таймаут: иначе «кнопки нет» сойдётся и на
      // незагруженной странице.
      await expect(
        page.getByText(created.code, { exact: true }).first(),
      ).toBeVisible({ timeout: 20_000 })
      await expect(
        page.getByRole('main').getByRole('link', { name: 'Карточка визита →' }),
      ).toHaveCount(0)

      // Контроль: у мероприятия НЕ внутреннего типа ссылка на месте — иначе
      // проба выше зеленела бы и от того, что ссылку сняли совсем. Тип берём
      // из ответа сервера: на стенде внутренних ОМ больше половины, и «второе
      // в списке» оказалось бы таким же внутренним.
      const foreign = (await registryEvents()).find(
        (r) => r.id !== created.id && r.kind !== 'INTERNAL',
      )
      expect(
        foreign,
        'в реестре нет ОМ с иностранным ОЛ (или без типа) для контроля',
      ).toBeTruthy()
      await page.goto(`${APP}/security-ops/events/${foreign!.id}`)
      await expect(
        page.getByRole('main').getByRole('link', { name: 'Карточка визита →' }),
      ).toBeVisible({ timeout: 20_000 })
    } finally {
      await fetch(`${API}/api/ops/security-events/${created.id}/`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    }
  })

  // Гейт раздела показывается персоной, у которой права НЕТ: под админом
  // (`*`) закрытое состояние недостижимо в принципе.
  test('без event.view вкладка визитов закрыта вместе с реестром ОМ', async ({
    page,
  }) => {
    await signIn(page, 'observer', 'observer123')
    // Своего гейта у вкладки нет и быть не должно: она часть реестра ОМ, и
    // право на неё то же — `event.view`. Отдельный гейт означал бы второе
    // правило доступа к одним данным.
    await page.goto(`${APP}/security-ops/events/?view=gvo`)
    await expect(page.getByText('реестра ОМ')).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('tab', { name: 'Визиты иностранных ОЛ' }),
    ).toHaveCount(0)
  })
})

/**
 * Обратный переход «сводка → своё ОМ» (Task 9). Своей записи у сводки нет —
 * её id это id мероприятия (Task 8, entities/gvo-summary), поэтому ссылка
 * назад обязана вести на карточку С ТЕМ ЖЕ id, с которого сводка открыта.
 *
 * Ассерт на URL один не ловит подмену «ссылка ведёт на ДРУГОЕ, но валидное
 * ОМ» — форма адреса совпадёт, а запись под ней будет чужая. Поэтому после
 * перехода дополнительно проверяется код мероприятия НА ЛАНДЕД-СТРАНИЦЕ —
 * это и есть красная проба из отчёта (id захардкожен на «1» — он гарантированно
 * существует на стенде и гарантированно НЕ совпадает с целью теста).
 */
test.describe(
  LIVE ? 'сводка ГВО ↔ карточка ОМ' : 'сводка ГВО ↔ карточка ОМ (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

    test('панель показывает сводку СВОЕГО ОМ, а не соседнего', async ({ page }) => {
      // Раньше это стерегла ссылка «К мероприятию →» на отдельном экране
      // сводки: своей записи у сводки нет, и ссылка обязана была вести на ТОТ
      // ЖЕ id. Экран снят («ОМ-35.8»), но вопрос остался: панель в карточке
      // обязана показывать сводку ЭТОГО мероприятия. Ассерт на адрес его не
      // ловит — форма адреса совпала бы и с чужой записью под ней.
      const rows = await registryEvents()
      const target = rows.find((r) => r.kind !== 'INTERNAL')
      const other = rows.find((r) => r.id !== target?.id)
      expect(target, 'на стенде нет ОМ с иностранным ОЛ').toBeDefined()
      expect(other, 'на стенде одно ОМ — подмену не с чем спутать').toBeDefined()

      await signIn(page)
      await page.goto(`${APP}/security-ops/visits/${target!.id}/`)
      await expect(page.getByText('Сводные данные ГВО')).toBeVisible({
        timeout: 15_000,
      })

      const main = page.getByRole('main')
      await expect(main.getByText(target!.code, { exact: true }).first()).toBeVisible()
      // Код СОСЕДНЕГО ОМ на странице не появляется: панель не подмешивает
      // чужую сводку.
      await expect(main.getByText(other!.code, { exact: true })).toHaveCount(0)
    })

    test('сводка честно называет отсутствие связи с реестром лиц', async ({ page }) => {
      const rows = await registryEvents()
      // Страница визита есть только у ОМ с иностранным ОЛ (`[ГВО-01]`):
      // «первое в реестре» упиралось бы во внутреннее.
      const target = rows.find((r) => r.kind !== 'INTERNAL')
      expect(target, 'на стенде нет ОМ с иностранным ОЛ').toBeDefined()

      await signIn(page)
      await page.goto(`${APP}/security-ops/visits/${target!.id}/`)
      await expect(page.getByText('Сводные данные ГВО')).toBeVisible({
        timeout: 15_000,
      })
      await expect(
        page.getByText(PERSONS_REGISTRY_GAP_LINE, { exact: true }),
      ).toBeVisible()
    })
  },
)

/**
 * Регресс тёмной темы (Task 9, fix round 1). Плашка аббревиатуры страны в
 * шапке сводки красилась хардкодным hsl(210 40% 96.1%) без override под
 * тёмную тему: фон оставался почти белым, а текст (без явного цвета — значит
 * text-foreground, в тёмной теме тоже почти белый) читался белым по белому
 * («gvo-summary-dark.png» в отчёте — плашка выглядела пустым белым квадратом).
 *
 * Проверка не сравнивает цвета на «не равны» буквально: в баг-состоянии фон
 * (~96% светлоты) и текст (~98%) дают РАЗНЫЕ RGB побитово, но неразличимые
 * глазом — строгое неравенство было бы вакуумным и прошло бы даже на баге.
 * Поэтому считается WCAG relative-luminance контраст и требуется порог,
 * который заведомо проваливает «два почти одинаково светлых» и заведомо
 * проходит «тёмный фон / светлый текст».
 */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function parseRgb(css: string): [number, number, number] {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) throw new Error(`не удалось разобрать цвет: ${css}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function contrastRatio(colorA: string, colorB: string): number {
  const la = relativeLuminance(parseRgb(colorA))
  const lb = relativeLuminance(parseRgb(colorB))
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

test.describe(
  LIVE
    ? 'тёмная тема — плашка страны в сводке ГВО'
    : 'тёмная тема — плашка страны в сводке ГВО (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

    test('фон и текст плашки различимы в тёмной теме', async ({ page }) => {
      const rows = await registryEvents()
      // Страница визита есть только у ОМ с иностранным ОЛ (`[ГВО-01]`):
      // «первое в реестре» упиралось бы во внутреннее.
      const target = rows.find((r) => r.kind !== 'INTERNAL')
      expect(target, 'на стенде нет ОМ с иностранным ОЛ').toBeDefined()

      await signIn(page)
      await page.goto(`${APP}/security-ops/visits/${target!.id}/`)
      await expect(page.getByText('Сводные данные ГВО')).toBeVisible({
        timeout: 15_000,
      })

      // Настоящий тумблер темы приложения, а не подмена data-theme мимо него.
      await page.getByRole('button', { name: 'Переключить на тёмную тему' }).click()
      await expect(page.locator('html')).toHaveClass(/dark/)

      const abbrBox = page.getByTestId('gvo-country-abbr')
      // toBeVisible проверяет РЕАЛЬНУЮ видимость (размер, opacity, display) —
      // getComputedStyle отдаёт значения и у скрытого узла, само по себе это
      // не страховка от вакуумной пробы.
      await expect(abbrBox).toBeVisible()

      const [bg, fg] = await abbrBox.evaluate((el) => {
        const style = getComputedStyle(el)
        return [style.backgroundColor, style.color]
      })

      const ratio = contrastRatio(bg, fg)
      // Порог 2.5: баг-состояние (два почти-белых оттенка, ~96.1% и ~98%
      // светлоты) даёт ratio ~1.0-1.1; исправленное (тёмный bg-muted и
      // светлый text-foreground) — на порядок больше.
      expect(ratio, `фон ${bg} и текст ${fg} почти неразличимы`).toBeGreaterThan(2.5)
    })
  },
)
