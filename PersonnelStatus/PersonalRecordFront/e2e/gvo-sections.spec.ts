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

// Пин дословно совпадает с константой на экране (app/security-ops/gvo/[id]/page.tsx)
// — проба ловит расхождение текста, а не только факт наличия какой-то строки.
const PERSONS_REGISTRY_GAP_LINE =
  'С реестром «Охраняемые лица» эти карточки не связаны — модель ГВО хранит только текст бюллетеня, без ссылки на запись каталога; появится бэк-этапом.'

interface EventRow {
  id: string
  code: string
  /** `null` — ОМ заведено до появления типа: тип не назван. */
  kind?: 'INTERNAL' | 'FOREIGN' | null
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

async function registryEvents(): Promise<EventRow[]> {
  const token = await apiToken()
  const res = await fetch(`${API}/api/ops/security-events/?page_size=200`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
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
    await page.goto(`${APP}/security-ops/gvo/`)
    await expect(page.getByRole('heading', { name: 'Реестр ГВО' })).toBeVisible()

    // Мероприятие берётся не «первое в реестре», а первое С ОБЪЕКТОМ
    // ПОСЕЩЕНИЯ: с «Реестр ОМ-35.1» раздел «Объекты посещения» читает таблицу
    // объектов, и у ОМ без объекта окно правки честно пусто — проба на таком
    // мероприятии молча проверяла бы пустоту.
    const registry = await registryEvents()
    const target = registry.find((row) => (row.visitObjects ?? []).length > 0)
    expect(target, 'на стенде нет ОМ с объектом посещения — проба вакуумна').toBeTruthy()
    const omCode = (target as EventRow).code
    const eventRow = page.locator('tbody tr', { hasText: omCode })
    await expect(eventRow).toContainText('Черновик')
    await eventRow.locator('a').first().click()
    await expect(page.getByRole('heading', { name: 'Сводные данные' })).toBeVisible()

    // Охраняемое лицо: «параметр = значение» построчно
    await page.getByRole('button', { name: '＋ Добавить лицо' }).click()
    await page.getByRole('textbox', { name: 'ФИО' }).fill('Яков Милатович')
    await page.getByRole('textbox', { name: 'Должность' }).fill('Президент Черногории')
    await page
      .getByRole('textbox', { name: 'Данные' })
      .fill('Группа крови = А (II) Rh +\nРост = 185 см')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    const main = page.locator('main')
    await expect(main.getByText('Яков Милатович')).toBeVisible({ timeout: 10_000 })
    await expect(main.getByText('А (II) Rh +')).toBeVisible()
    await expect(main.getByText('185 см')).toBeVisible()

    // Группа ГВО: «Фамилия | позывной | роль»; счётчик состава пересчитывается
    await page.getByRole('button', { name: '＋ Группа' }).click()
    await page.getByRole('textbox', { name: 'Название группы' }).fill('ГВО «Черногория»')
    await page
      .getByRole('textbox', { name: 'Состав группы' })
      .fill('Булатаев | 2-27 | старший ГВО\nБайболов | 7-41 | прикреплённый')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(main.getByText('2-27')).toBeVisible({ timeout: 10_000 })
    await expect(main.getByText('старший ГВО')).toBeVisible()
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
    await expect(main.getByText(visitObjectName as string)).toBeVisible()

    // Реестр читает ту же сводку: статус, старший ГВО и охраняемые лица
    await page.getByRole('link', { name: '← Назад к реестру ГВО' }).click()
    const row = page.locator('tbody tr', { hasText: omCode })
    await expect(row).toContainText('Заполнена', { timeout: 10_000 })
    await expect(row).toContainText('Булатаев · 2-27')
    await expect(row).toContainText('Яков Милатович')

    // Удаление элемента списка возвращает раздел в пустое состояние
    await row.locator('a').first().click()
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
  test('без event.view реестр ГВО закрыт', async ({ page }) => {
    await signIn(page, 'observer', 'observer123')
    await page.goto(`${APP}/security-ops/gvo/`)
    await expect(page.getByText('реестра ГВО')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Реестр ГВО' })).toBeHidden()
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

    test('ссылка со сводки ведёт на карточку СВОЕГО ОМ', async ({ page }) => {
      const rows = await registryEvents()
      // id «1» зарезервирован под красную пробу отчёта — цель теста должна
      // гарантированно от него отличаться.
      const target = rows.find((r) => r.id !== '1') ?? rows[0]
      expect(target, 'на стенде нет ни одного ОМ').toBeDefined()

      await signIn(page)
      await page.goto(`${APP}/security-ops/gvo/${target!.id}/`)
      await expect(page.getByRole('heading', { name: 'Сводные данные' })).toBeVisible({
        timeout: 15_000,
      })

      const link = page.getByRole('main').getByRole('link', { name: /мероприятию/i })
      await expect(link).toBeVisible()
      await link.click()

      await expect(page).toHaveURL(new RegExp(`/security-ops/events/${target!.id}/?$`))
      // Landed-identity: код мероприятия на КАРТОЧКЕ ОМ, а не только форма URL.
      // .first() — на этапе «Бюллетень» код мероприятия дублируется в фактах
      // шага; первый в DOM — код-бейдж шапки карточки, оба варианта верны.
      await expect(
        page.getByRole('main').getByText(target!.code, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 })
    })

    test('сводка честно называет отсутствие связи с реестром лиц', async ({ page }) => {
      const rows = await registryEvents()
      const target = rows[0]
      expect(target, 'на стенде нет ни одного ОМ').toBeDefined()

      await signIn(page)
      await page.goto(`${APP}/security-ops/gvo/${target!.id}/`)
      await expect(page.getByRole('heading', { name: 'Сводные данные' })).toBeVisible({
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
      await page.goto(`${APP}/security-ops/gvo/${target!.id}/`)
      await expect(page.getByRole('heading', { name: 'Сводные данные' })).toBeVisible({
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
