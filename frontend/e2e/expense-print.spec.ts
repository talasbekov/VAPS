// Story 10.7 (QA-добор, workflow qa-generate-e2e-tests) — ПЕЧАТНАЯ ФОРМА
// РАСХОДА в реальном chromium против ПРОДАКШН-сборки SPA (порт 4173).
//
// Почему прод-сборка, а не харнес dist-e2e (как у 10.5/10.6): печатной форме
// нужен именно конкатенированный CSS бандла (Ловушка 8 стори 8.8 — в dev-сборке
// стили инжектятся по-модульно и каскад маскируется), а роут `/print/expense`
// в прод-сборке настоящий. Как следствие, `vite.e2e.config.ts` НЕ трогается —
// он общий со стори 11.6 (предупреждение baseline_commit спеки 10.7).
//
// Зачем это поверх 71 плотного vitest-теста стори. Дев-сюита сильная и
// мутационно проверенная (12 мутаций, все красные). Дублировать её нечем —
// взяты РОВНО те места, где QA-проба показала, что правку прод-кода НЕ краснит
// ни один тест проекта:
//
//   1) ЛОКАЛЬНАЯ ДАТА ДОКУМЕНТА. `formatDocDate` заменён на путь через
//      `new Date(iso).getDate()` (UTC-полночь) → **71/71 vitest-тестов
//      остались зелёными**. Юнит-тест `expensePrint.test.ts:98-102` прямо
//      заявляет, что покрывает «дату, на которой new Date()-путь уехал бы на
//      сутки», но покрыть её не может: системная зона гейта — **+05**, где
//      UTC-полночь попадает в те же сутки. Под `TZ=America/Anchorage` та же
//      мутация даёт 5 красных. То есть гвард держится на часовом поясе машины,
//      а не на коде. Здесь браузер живёт в UTC-9 — расхождение гарантировано на
//      КАЖДОМ прогоне. Это тот же класс, что находка №3 спеки 10.5
//      (`todayLocalIso` → UTC-срез, 622/622 зелёных).
//   2) ЖИРНЫЙ «ИТОГО». AC-6 требует жирность и явно опирается на существующее
//      правило `.print-root tfoot td` — но jsdom CSS не парсит (Ловушка 11), и
//      дев-тест ассертит лишь `tfoot` в документе. Требование «жирным» не
//      проверено НИЧЕМ. Здесь — computed `font-weight`.
//   3) ОТКЛОНЕНИЕ 2 СПЕКИ (`.print-wide` вместо общего `.print-root th/td`).
//      Дев сузил скоуп, чтобы не уронить e2e каркаса 8.8, и нашёл это ЧТЕНИЕМ
//      ассертов, а не прогоном (e2e вне `npm run gate` — инцидент 10.6). Ни
//      применение новых правил к расходу, ни сохранность 12pt у `/print/test`
//      не проверены ни одним автотестом. Здесь проверены обе стороны.
//   4) ВРЕЗКА ССЫЛКИ «ПЕЧАТНАЯ ФОРМА» на `/reports` (Task 6, Решение 6 спеки:
//      «роут без входа — мёртвый продукт»). Грепом по всему `src/` и `e2e/`:
//      ссылку не ассертит НИ ОДИН тест — ни её наличие, ни href, ни
//      `target="_blank"`. Единственное упоминание в тестах — комментарий в
//      `ExpenseReportPage.test.tsx:80` о добавленном ради неё `MemoryRouter`.
//      Вход в фичу мог бы вести куда угодно или не рендериться вовсе.
//
// Чего здесь НЕТ и почему:
//   • Живого бэкенда — сеть перехвачена `context.route`, то есть НА УРОВНЕ
//     БРАУЗЕРА: fetch настоящий, заголовки из `credential.ts` настоящие, у
//     границы работает боевой `parseErrorResponse`. Живой контур — стори 10.10.
//   • Карты отказов AC-9, негативных ассертов AC-10, порядка колонок AC-4 и
//     сходимости AC-7 — их дев-тесты честны и мутационно доказаны (пробы 1–12
//     стори), в браузере они проверяли бы ровно то же самое.
//   • Пиксельной верности на FF100 — Playwright на FF100 невозможен
//     (`architecture.md:260`), это ручной релизный смоук.
import { expect, test, type BrowserContext } from '@playwright/test'

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'

/** Кириллица + казахские глифы ОБОИХ сабсетов PT Serif: Ә — cyrillic-ext,
 *  і — cyrillic. Латиница дала бы зелёный тест на сломанном шрифте (урок E9). */
const DIVISION_NAME = 'Әкімшілік департаменті'

/** 8pt ≈ 10.67px, 12pt = 16px, 16pt ≈ 21.33px (1pt = 96/72 px). */
const PT = 96 / 72

/** Числа РАЗНЫЕ по колонкам: одинаковые сделали бы ассерты вакуумными. */
const COLUMNS = {
  IN_SERVICE: 71,
  ON_DUTY: 13,
  AFTER_DUTY: 9,
  COMMAND: 5,
  TRAINING: 3,
  VACATION: 8,
  SICK: 6,
  DETACHED: 2,
  BEFORE_DUTY: 1,
  OTHER: 4,
  PENDING: 7,
}

function periodBody(businessDate: string) {
  return JSON.stringify({
    pages: [
      {
        business_date: businessDate,
        totals: {
          staff_total: 140,
          list_total: 129,
          vacancies: 11,
          attached: 12,
          columns: COLUMNS,
        },
        rows: [
          {
            division_id: DIVISION_ID,
            name: 'Шығыс басқармасы',
            staff_total: 140,
            list_total: 129,
            vacancies: 11,
            attached: 12,
            columns: COLUMNS,
          },
        ],
      },
    ],
  })
}

/** Конверт §36 — та же форма, что на проводе (exception_handler.py:75-87). */
function envelope(errorCode: string, message: string) {
  return JSON.stringify({
    error_code: errorCode,
    message,
    details: {},
    request_id: 'req-e2e-10-7',
    timestamp: '2026-07-19T08:00:00+05:00',
  })
}

/**
 * Перехват сети НА УРОВНЕ КОНТЕКСТА, а не страницы: ссылка «Печатная форма»
 * открывается в НОВОЙ ВКЛАДКЕ (`target="_blank"`), и `page.route` на неё не
 * распространился бы — попап ушёл бы в реальную сеть и упал.
 *
 * Право — РОВНО `daily_report.generate`, тот же код, что в `_EXPENSE_PERMISSION`
 * бэка (views.py:74): `RequirePermission` проезжает боевым путём, а не потому,
 * что у актора wildcard.
 */
async function stubBackend(
  context: BrowserContext,
  options: { permissions?: string[]; periodStatus?: number } = {},
): Promise<void> {
  const permissions = options.permissions ?? ['daily_report.generate']

  await context.route('**/api/operations/my-permissions/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ permissions }),
    }),
  )

  await context.route('**/api/core/divisions/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        next: null,
        previous: null,
        results: [
          { id: DIVISION_ID, name: DIVISION_NAME, parent: null, is_active: true },
        ],
      }),
    }),
  )

  // Лента колокольчика и сокет 11.3 приезжают с AppLayout на `/reports`.
  // Печатный роут — сиблинг layout-route, там их нет вовсе; здесь только
  // тишина в сети, чтобы реконнект с backoff не шумел.
  await context.route('**/api/notifications/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
    }),
  )

  // ⚠️ Один хендлер на оба роута расхода: `**/expense-reports/**` матчит и
  // `/period/`. Разводка по URL, а не порядком регистрации — порядок в
  // Playwright обратный регистрации, и это ломалось бы молча.
  await context.route('**/api/operations/expense-reports/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/period/')) {
      if (options.periodStatus === 401) {
        return route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: envelope('AUTH_REQUIRED', 'AUTH_REQUIRED'),
        })
      }
      // Дата берётся из запроса: страница-на-дату, `date_from == date_to`.
      const date = url.searchParams.get('date_from') ?? ''
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: periodBody(date),
      })
    }
    // Point-lookup экрана `/reports`: 404 «не выпускался» — ШТАТНЫЙ ответ
    // (views.py:293-301), а не сбой. Ссылка на печать видна и до выпуска.
    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: envelope('ENTITY_NOT_FOUND', 'Расход за эту дату не выпускался.'),
    })
  })

  await context.routeWebSocket(/\/ws\/notifications\//, () => {})

  // Сид credential ДО скриптов страницы (Ловушка 6 стори 8.8): `credential.ts`
  // гидратируется на import модуля — `page.evaluate` после load опоздал бы, и
  // `RequireAuth` уже средиректил бы на /login. На КОНТЕКСТ, а не на страницу:
  // попап печатной формы обязан приехать с тем же credential.
  await context.addInitScript(() => {
    sessionStorage.setItem(
      'vaps.credential',
      JSON.stringify({ kind: 'dev', userId: 'e2e-print-expense' }),
    )
  })
}

function printUrl(businessDate: string): string {
  // Literal-путь легален: файл вне `src/**`, куда скоуплен ARCH-FE-012.
  return `/print/expense?division_id=${DIVISION_ID}&business_date=${businessDate}`
}

// ─────────────────────────────────────────────────────────────────────────────
// (л) ЛОКАЛЬНАЯ ДАТА ДОКУМЕНТА — единственное место, где гвард вообще проверяем
// ─────────────────────────────────────────────────────────────────────────────

test.describe('дата документа в МИНУСОВОЙ зоне', () => {
  // 🔴 UTC-9. Под системной зоной гейта (+05) реализация через
  // `new Date(iso)` даёт ТЕ ЖЕ сутки и все 71 тест остаются зелёными —
  // проверено мутацией. Здесь UTC-полночь 05.12.2026 это 04.12.2026 локально,
  // то есть подмена уводит дату юридического артефакта на сутки назад
  // на КАЖДОМ прогоне, а не «иногда вечером».
  test.use({ timezoneId: 'America/Anchorage' })

  const BUSINESS_DATE = '2026-12-05'

  test('(л) шапка несёт дату запроса, а не UTC-полночь минус сутки', async ({
    page,
    context,
  }) => {
    await stubBackend(context)
    await page.goto(printUrl(BUSINESS_DATE))

    const heading = page.locator('.print-root h1')
    await expect(heading).toBeVisible()
    // Дата документа — ровно та, что спросил оператор
    await expect(heading).toContainText('05.12.2026')
    // ...и НЕ предыдущие сутки: ровно это дал бы new Date().getDate() в UTC-9
    await expect(heading).not.toContainText('04.12.2026')
    // ISO в юридический артефакт не просачивается
    await expect(heading).not.toContainText(BUSINESS_DATE)

    // Примечание внизу документа печатает ту же дату тем же форматтером
    await expect(page.locator('.print-note')).toContainText('05.12.2026')
    await expect(page.locator('.print-note')).not.toContainText('04.12.2026')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Печатный контракт документа в реальном браузере
// ─────────────────────────────────────────────────────────────────────────────

test.describe('печатный контракт /print/expense', () => {
  const BUSINESS_DATE = '2026-07-19'

  test.beforeEach(async ({ context }) => {
    await stubBackend(context)
  })

  test('(м) «ИТОГО» жирный и в печатной гарнитуре — требование AC-6, которое jsdom не судит', async ({
    page,
  }) => {
    await page.goto(printUrl(BUSINESS_DATE))
    await expect(page.locator('.print-root table')).toBeVisible()

    const totals = page.locator('.print-root tfoot td', { hasText: 'ИТОГО' })
    const style = await totals.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { weight: cs.fontWeight, family: cs.fontFamily }
    })
    // Жирность даёт `.print-root tfoot td` — своего класса форма не заводит,
    // и именно поэтому её надо проверить: правило чужое и легко теряемое.
    expect(Number(style.weight)).toBeGreaterThanOrEqual(700)
    expect(style.family).toContain('PT Serif')

    // Контрольный: обычная строка тела жирной НЕ стала (иначе ассерт выше
    // проходил бы от глобальной жирности, а не от правила tfoot)
    const bodyWeight = await page
      .locator('.print-root tbody td')
      .first()
      .evaluate((el) => Number(getComputedStyle(el).fontWeight))
    expect(bodyWeight).toBeLessThan(700)
  })

  test('(н) правила .print-wide применились к расходу и НЕ тронули каркас 8.8 (Отклонение 2)', async ({
    page,
  }) => {
    await page.goto(printUrl(BUSINESS_DATE))
    await expect(page.locator('.print-root table')).toBeVisible()

    // ⚠️ У 8pt ДВА владельца: `.print-root .print-wide` (наследуется в ячейки)
    // и `.print-root .print-wide th/td`. Снятие ОДНОГО из них наблюдаемо ничего
    // не меняет, и красная проба на нём зелёная — это не вакуум ассерта, а
    // дублирующее правило (класс «ищи второй гард», ретро 10.6). Настоящие
    // регрессии, на которых тест краснеет: 8pt снят у обоих владельцев (ячейки
    // падают на 12pt правила `.print-root table`) и расскоуп правила на
    // `.print-root th/td` — тогда краснеет ещё и `print.spec.ts` каркаса 8.8.
    // Дубль объявления стоит убрать отдельной уборкой (владелец — один).

    // 17 колонок на альбомном A4 — 8pt, иначе таблица уходит за поля листа
    const expense = await page
      .locator('.print-root .print-wide tbody td')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(expense).toBeCloseTo(8 * PT, 1)

    const expenseHead = await page
      .locator('.print-root .print-wide thead th')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(expenseHead).toBeCloseTo(8 * PT, 1)

    // Вторая половина Отклонения 2: демо-каркас 8.8 остался 12pt. Дев выбрал
    // скоуп по классу именно чтобы не уронить `print.spec.ts:46-47` — но e2e
    // вне гейта, и проверить это было некому.
    await page.goto('/print/test')
    await expect(page.locator('.print-root table')).toBeVisible()
    const skeleton = await page
      .locator('.print-root tbody td')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(skeleton).toBeCloseTo(12 * PT, 1)
  })

  test('(о) .print-num выравнивает числа вправо, текстовая колонка остаётся влево', async ({
    page,
  }) => {
    await page.goto(printUrl(BUSINESS_DATE))
    await expect(page.locator('.print-root table')).toBeVisible()

    const row = page.locator('.print-root tbody tr').first()
    // «Управление» (индекс 1) — единственная нечисловая колонка строки
    const nameAlign = await row
      .locator('td')
      .nth(1)
      .evaluate((el) => getComputedStyle(el).textAlign)
    expect(nameAlign).toBe('left')

    // «По штату» (2) и «Прикомандирован» (12) — числовые
    for (const index of [2, 12]) {
      const align = await row
        .locator('td')
        .nth(index)
        .evaluate((el) => getComputedStyle(el).textAlign)
      expect(align).toBe('right')
    }
  })

  test('(п) казахская шапка расхода: глифы обоих сабсетов PT Serif реально загружены', async ({
    page,
  }) => {
    await page.goto(printUrl(BUSINESS_DATE))
    const heading = page.locator('.print-root h1')
    await expect(heading).toBeVisible()

    // Шапка — дословное зеркало .docx, и она целиком на казахском:
    // Ұ/Қ/Ң (cyrillic-ext) + І (cyrillic) + Ә из имени подразделения
    await expect(heading).toContainText('ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ')
    await expect(heading).toContainText(DIVISION_NAME)

    const fonts = await page.evaluate(async () => {
      await document.fonts.ready
      return {
        cyrillicExt: document.fonts.check('16pt "PT Serif"', 'Ә'),
        cyrillic: document.fonts.check('16pt "PT Serif"', 'І'),
      }
    })
    // font-display: block (Д2 8.8) — системный фолбэк в юридическом артефакте
    // недопустим, и проверить это может только реальный браузер
    expect(fonts).toEqual({ cyrillicExt: true, cyrillic: true })

    const style = await heading.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { family: cs.fontFamily, size: parseFloat(cs.fontSize) }
    })
    expect(style.family).toContain('PT Serif')
    expect(style.size).toBeCloseTo(16 * PT, 1) // 16pt ≈ 21.33px
  })

  test('(р) print-медиа: подсказка уходит, документ остаётся целиком и не распирает лист', async ({
    page,
  }) => {
    await page.goto(printUrl(BUSINESS_DATE))
    await expect(page.locator('.print-screen-hint')).toBeVisible()

    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.print-screen-hint')).toBeHidden()

    // Юридический артефакт на бумаге целиком: шапка, таблица, ИТОГО, примечание
    await expect(page.locator('.print-root h1')).toBeVisible()
    await expect(page.locator('.print-root table')).toBeVisible()
    await expect(
      page.locator('.print-root tfoot td', { hasText: 'ИТОГО' }),
    ).toBeVisible()
    await expect(page.locator('.print-note')).toBeVisible()

    // 17 колонок помещаются в контентную ширину листа: `table-layout: fixed`
    // + `overflow-wrap: break-word` обязаны перенести «Учёба/соревнования/
    // конференция», а не распереть таблицу за поля (обрезанный документ
    // непригоден как контрольная копия)
    const fits = await page.evaluate(() => {
      const root = document.querySelector('.print-root')!
      const table = document.querySelector('.print-root table')!
      return {
        tableWidth: table.scrollWidth,
        rootWidth: root.clientWidth,
        overflowsPage: document.documentElement.scrollWidth > window.innerWidth,
      }
    })
    expect(fits.tableWidth).toBeLessThanOrEqual(fits.rootWidth)
    expect(fits.overflowsPage).toBe(false)
  })

  test('(с) DOM-скан прод-сборки под НАСТОЯЩИМ роутером: ни одного класса вне print-*', async ({
    page,
  }) => {
    await page.goto(printUrl(BUSINESS_DATE))
    await expect(page.locator('.print-root table')).toBeVisible()

    // Дев-тест сканирует компонент, отрендеренный НАПРЯМУЮ. Здесь в цепочке
    // стоят Providers, RequireAuth и RequirePermission — и это прод-сборка, где
    // CSS всего SPA конкатенирован. Любой UI-класс, подмешанный обёртками,
    // попал бы на бумагу.
    const offenders = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .flatMap((el) => Array.from(el.classList))
        .filter((cls) => !cls.startsWith('print-')),
    )
    expect(offenders).toEqual([])

    // Сиблинг layout-route: сайдбар и шапка портала на бумагу не попадают
    await expect(page.getByRole('navigation')).toHaveCount(0)
    await expect(page.getByRole('banner')).toHaveCount(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (у) ИСТЁКШАЯ СЕССИЯ — единственная ветка AC-9, которую дев-тест проверить
//     не мог: он рендерит страницу БЕЗ гвардов, и «silent» там означает лишь
//     «текста нет». Что происходит с оператором дальше — не проверял никто.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('истёкшая сессия на печатной форме', () => {
  test('(у) 401 не оставляет оператора перед пустым листом — цепочка уводит на /login', async ({
    page,
    context,
  }) => {
    await stubBackend(context, { periodStatus: 401 })
    await page.goto(printUrl('2026-07-19'))

    // `providers.tsx:27-38`: handle401 на queryCache чистит credential, а
    // RequireAuth уводит реактивно. Именно поэтому карта отказов отдаёт 401 в
    // `silent` — текст успел бы только мигнуть поверх редиректа. Но «мигнуть
    // поверх редиректа» имеет смысл, только если редирект РЕАЛЬНО происходит.
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByLabel('Идентификатор (X-User-Id)')).toBeVisible()

    // Пустой печатный лист не остаётся на экране
    await expect(page.locator('.print-root')).toHaveCount(0)
    // Голый код конверта наружу не уходит
    await expect(page.locator('body')).not.toContainText('AUTH_REQUIRED')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (т) ВРЕЗКА: вход в печатную форму с экрана расхода
// ─────────────────────────────────────────────────────────────────────────────

test.describe('вход с /reports', () => {
  // Часы фиксированы: экран расхода подставляет `todayLocalIso()` в поле даты,
  // и без фиксации ассерт href зависел бы от дня прогона.
  const FIXED_UTC = '2026-07-19T06:00:00.000Z'
  const LOCAL_TODAY = '2026-07-19' // то же мгновение в системной зоне гейта (+05)

  test.use({ timezoneId: 'Asia/Almaty' }) // UTC+5 — зона эксплуатации

  test('(т) ссылка «Печатная форма» ведёт в рабочую печатную форму того же контекста', async ({
    page,
    context,
  }) => {
    await stubBackend(context)
    await page.clock.setFixedTime(new Date(FIXED_UTC))
    await page.goto('/reports')

    // Экран расхода доехал до приложения (не заглушка): выбираем подразделение
    await expect(
      page.getByRole('heading', { level: 1 }),
    ).toBeVisible()
    await page.getByLabel('Подразделение').selectOption(DIVISION_ID)

    // Ссылка появляется, когда выбраны ОБА параметра (дата — сегодня по умолчанию)
    const link = page.getByRole('link', { name: 'Печатная форма' })
    await expect(link).toBeVisible()

    // href собран фабрикой ROUTES.printExpenseTo — оба параметра на месте
    const href = await link.getAttribute('href')
    expect(href).toBe(
      `/print/expense?division_id=${DIVISION_ID}&business_date=${LOCAL_TODAY}`,
    )
    // Новая вкладка: экран расхода не теряет выбранный контекст
    await expect(link).toHaveAttribute('target', '_blank')

    // И главное — по ссылке РЕАЛЬНО открывается работающая печатная форма,
    // а не 404 и не пустой лист. Ровно это не проверял ни один тест.
    const popupPromise = context.waitForEvent('page')
    await link.click()
    const printPage = await popupPromise
    await printPage.waitForLoadState()

    await expect(printPage.locator('.print-root table')).toBeVisible()
    await expect(printPage.locator('.print-root h1')).toContainText(
      'ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ',
    )
    // Контекст перенесён без потерь: то же подразделение и та же дата
    await expect(printPage.locator('.print-root h1')).toContainText(DIVISION_NAME)
    await expect(printPage.locator('.print-root h1')).toContainText('19.07.2026')
    await expect(
      printPage.locator('.print-root tfoot td', { hasText: 'ИТОГО' }),
    ).toBeVisible()
  })
})
