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
 * стартует не с «Черновика»: проба была бы красной по чужой причине. Разделы
 * перечислены все, а не только правимые ниже: остаток любого из них держит
 * статус «Заполнена».
 */
async function resetSummary(omCode: string): Promise<void> {
  const token = await apiToken()
  for (const section of [
    'head',
    'persons',
    'arrival',
    'departure',
    'org',
    'groups',
    'resp',
    'transport',
  ]) {
    await fetch(
      `${API}/api/ops/gvo-summaries/${encodeURIComponent(omCode)}/reset/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ section }),
      },
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
    // Строка вкладки ведёт в карточку с РАСКРЫТОЙ панелью (`?gvo=1`).
    await eventRow.locator('a').first().click()
    await expect(page.getByText('Сводные данные ГВО')).toBeVisible({
      timeout: 15_000,
    })

    // Охраняемое лицо: «параметр = значение» построчно
    await page.getByRole('button', { name: '＋ Добавить лицо' }).click()
    await page.getByRole('textbox', { name: 'ФИО' }).fill('Яков Милатович')
    await page.getByRole('textbox', { name: 'Должность' }).fill('Президент Черногории')
    await page
      .getByRole('textbox', { name: 'Данные' })
      .fill('Группа крови = А (II) Rh +\nРост = 185 см')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    const main = page.locator('main')
    // `.first()`: панель стоит в карточке ОМ, и то же имя выводится ещё и в
    // «Сведениях об ОМ» бюллетеня (факты ГВО) — строгий режим ловил обе.
    await expect(main.getByText('Яков Милатович').first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(main.getByText('А (II) Rh +').first()).toBeVisible()
    await expect(main.getByText('185 см').first()).toBeVisible()

    // Группа ГВО: «Фамилия | позывной | роль»; счётчик состава пересчитывается
    await page.getByRole('button', { name: '＋ Группа' }).click()
    await page.getByRole('textbox', { name: 'Название группы' }).fill('ГВО «Черногория»')
    await page
      .getByRole('textbox', { name: 'Состав группы' })
      .fill('Булатаев | 2-27 | старший ГВО\nБайболов | 7-41 | прикреплённый')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(main.getByText('2-27').first()).toBeVisible({ timeout: 10_000 })
    await expect(main.getByText('старший ГВО').first()).toBeVisible()
    await expect(main.getByText('2 чел.').first()).toBeVisible()

    // Транспорт: «код | марка | примечание»
    await page.getByRole('button', { name: 'Изменить транспорт' }).click()
    await page
      .getByRole('textbox', { name: 'Транспорт' })
      .fill('VIP | Mercedes-Benz Pullman S600 W222, 2019 г.в. | бронь, гостевой парк')
    await page.getByRole('button', { name: 'Сохранить' }).click()
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
    await expect(row).toContainText('Заполнена', { timeout: 10_000 })
    await expect(row).toContainText('Булатаев · 2-27')
    await expect(row).toContainText('Яков Милатович')

    // Удаление ЭЛЕМЕНТА списка возвращает раздел в пустое состояние.
    //
    // Перед этим список сводится к ОДНОМУ лицу разделом целиком: база сводки
    // уже несёт охраняемое лицо из бюллетеня, если оно там названо, и «удалить
    // первое и ждать пустоту» держалось лишь на том, что у выбранного ОМ лица
    // не было. Цикл «удалять, пока есть» здесь не годится: панель после
    // каждого ответа пересобирается, и клик по едущей карточке не доходит.
    await row.locator('a').first().click()
    await expect(
      page.getByRole('button', { name: 'Изменить список охраняемых лиц' }),
    ).toBeVisible({ timeout: 15_000 })
    await page
      .getByRole('button', { name: 'Изменить список охраняемых лиц' })
      .click()
    await page
      .getByRole('textbox', { name: 'Список охраняемых лиц' })
      .fill('Яков Милатович | Президент Черногории')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 })
    await expect(
      page.getByRole('button', { name: 'Изменить данные лица 2' }),
    ).toHaveCount(0, { timeout: 10_000 })

    await page.getByRole('button', { name: 'Изменить данные лица 1' }).click()
    await page.getByRole('button', { name: 'Удалить лицо' }).click()
    await expect(
      main.getByText('Охраняемые лица не указаны в бюллетене'),
    ).toBeVisible({ timeout: 10_000 })

    // «Вернуть исходные» по КАЖДОМУ правленому разделу возвращает сводку в
    // черновик: пустой патч не хранится. Удаление элемента списка сюда не
    // считается — пустой список это тоже ручная правка, и статус остаётся
    // «Заполнена», пока раздел не сброшен явно.
    await expect(main.getByText('Сводка заполнена')).toBeVisible()
    // «Изменить объекты посещения» из этого списка ВЫНУТ: объекты живут
    // таблицей мероприятия, их день и примечание патчем сводки не считаются, и
    // статус «Заполнена» от них не зависит («Реестр ОМ-35.1»).
    for (const button of [
      'Изменить транспорт',
      'Изменить список охраняемых лиц',
      'Изменить состав ГВО',
    ]) {
      await page.getByRole('button', { name: button }).click()
      await page.getByRole('button', { name: 'Вернуть исходные' }).click()
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })
    }
    await expect(main.getByText('Черновик сводки')).toBeVisible({ timeout: 10_000 })

    // День и примечание объектов патчем не считаются, поэтому в цикле сброса
    // выше их нет — снимаем отдельно, иначе следующий прогон начнётся с
    // проставленного дня, а «Сохранить» заперта, пока ничего не менялось.
    await page.getByRole('button', { name: 'Изменить объекты посещения' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Вернуть исходные' }).click()
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })

    // CLIENT_FETCH_ERROR — обрыв навигации NextAuth, не дефект экрана
    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })

  test('сводка ГВО раскрывается панелью в карточке мероприятия', async ({
    page,
  }) => {
    // Задача заказчика «Реестр ОМ-35.4»: функционал модуля «Реестр ГВО»
    // переходит мероприятию — кнопка справа в шапке карточки, панель
    // раскрывается НА МЕСТЕ. Проба ведёт именно кнопку: уход на другой экран
    // вернул бы разрыв контекста, из-за которого модуль и убирают.
    // Тип НЕ внутренний: у внутреннего ОМ кнопки нет по правилу «ОМ-35.5», и
    // «первое в реестре» упиралось бы в её отсутствие.
    const target = (await registryEvents()).find((r) => r.kind !== 'INTERNAL')
    expect(
      target,
      'в реестре нет ОМ с иностранным ОЛ — панель не на чем открыть',
    ).toBeTruthy()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}`)
    const open = page.getByRole('button', { name: 'Информация по ГВО' })
    await expect(open).toBeVisible({ timeout: 20_000 })

    // Панели нет, пока не нажали: разделы сводки не должны висеть на карточке
    // всегда — они отодвинули бы этапы за сгиб.
    await expect(page.getByRole('heading', { name: 'Состав ГВО СГО РК' })).toHaveCount(0)
    await expect(page.getByText('Сводные данные ГВО')).toHaveCount(0)

    const codesBeforeOpen = await page
      .getByText(target!.code, { exact: true })
      .count()

    await open.click()
    // Адрес НЕ сменился — панель раскрылась на месте, а не увела на экран.
    expect(page.url()).toContain(`/security-ops/events/${target!.id}`)
    await expect(page.getByText('Сводные данные ГВО')).toBeVisible({
      timeout: 15_000,
    })
    // Разделы приехали целиком, а не одна шапка.
    await expect(page.getByRole('heading', { name: 'Охраняемые лица' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Объекты посещения' })).toBeVisible()
    const codesAfterOpen = await page
      .getByText(target!.code, { exact: true })
      .count()
    // Код ОМ панель НЕ добавляет: он уже стоит в шапке карточки, и второй раз
    // тем же текстом ловил бы substring-пробы других экранов в
    // неоднозначность. Сравниваем с числом ДО раскрытия, а не с единицей: на
    // карточке код встречается и в шапке, и в подписи выбранного объекта.
    expect(codesAfterOpen).toEqual(codesBeforeOpen)

    // Повторное нажатие закрывает — кнопка меняет и подпись, и состояние.
    await page.getByRole('button', { name: 'Скрыть информацию по ГВО' }).click()
    await expect(page.getByText('Сводные данные ГВО')).toHaveCount(0)
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
    await page.goto(`${APP}/security-ops/events/${target!.id}?gvo=1`)
    await expect(page.getByText('Сводные данные ГВО')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Изменить организацию' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Канал р/связи' }).fill('')
    await dialog.getByRole('checkbox', { name: 'Уточняется: Канал р/связи' }).check()
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })

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

  test('у внутреннего мероприятия кнопки «Информация по ГВО» нет', async ({
    page,
  }) => {
    // Задача заказчика «Реестр ОМ-35.5»: сводка ГВО — про выездную охрану
    // иностранного ОЛ. У внутреннего ОМ её нет, и кнопка обещала бы пустоту.
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
        page.getByRole('button', { name: 'Информация по ГВО' }),
      ).toHaveCount(0)

      // Контроль: у мероприятия НЕ внутреннего типа кнопка на месте — иначе
      // проба выше зеленела бы и от того, что кнопку сняли совсем. Тип берём
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
        page.getByRole('button', { name: 'Информация по ГВО' }),
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
      await page.goto(`${APP}/security-ops/events/${target!.id}?gvo=1`)
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
      const target = rows[0]
      expect(target, 'на стенде нет ни одного ОМ').toBeDefined()

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target!.id}?gvo=1`)
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
      const target = rows[0]
      expect(target, 'на стенде нет ни одного ОМ').toBeDefined()

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target!.id}?gvo=1`)
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
