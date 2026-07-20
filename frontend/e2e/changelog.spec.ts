// Story 10.9 (QA-добор, workflow qa-generate-e2e-tests) — ФУТЕР КАРКАСА И
// ЖУРНАЛ «сообщено → исправлено» в реальном chromium.
//
// ═══ ЗАЧЕМ ЭТОТ ФАЙЛ ═══
// На момент QA-прохода браузер не видел ни футера, ни журнала НИ РАЗУ: греп по
// `contentinfo|footer|changelog` в `e2e/`, `e2e-live/` и `e2e-harness/` давал
// НОЛЬ строк. Вся врезка в каркас — самое рискованное место стори, по прямому
// признанию её же Решения №1 («11.4 доказала: компонент шапки выдёргивается
// целиком при 527 зелёных тестах») — держалась исключительно на jsdom.
//
// Спека закрыла AC-2 ссылкой на то, что `notifications.spec.ts` не падает при
// монтировании. Это доказательство ОТ ОТСУТСТВИЯ КРАША: удали футер из
// AppLayout — та спека останется зелёной, потому что про футер она не знает
// ничего. Здесь то же требование закрыто ПОЛОЖИТЕЛЬНЫМ ассертом.
//
// ═══ ЧТО ЗДЕСЬ ЕСТЬ ТАКОГО, ЧЕГО НЕТ В VITEST ═══
//   1) ПРОДАКШН-БАНДЛ. `define` в юнит-тестах подставляет vite.config.ts на
//      лету; в браузер едет минифицированный dist, где значение уже вшито
//      текстом. Таблица AC-1 прямо описывает бандлы, где `__BUILD_SHA__` стал
//      голым идентификатором или ЧИСЛОМ при exit 0 сборки. jsdom этого класса
//      не видит по построению — а `page.goto` видит: ReferenceError валит
//      монтирование, а число ломает форму подписи.
//   2) НАСТОЯЩИЙ РОУТЕР И ГЛУБОКАЯ ССЫЛКА. Все vitest-тесты идут через
//      MemoryRouter. `/changelog` прямым заходом (именно так по нему придут из
//      разговора с поддержкой) не проверял никто: SPA-fallback preview/nginx —
//      отдельный слой, которого в jsdom не существует.
//   3) HARNESS dist-e2e (порт 4174) — ВТОРАЯ сборка со своим конфигом.
//      `vite.e2e.config.ts` — единственный файл, забыв define в котором,
//      получаешь зелёными и `npm run gate`, и `npm run build:e2e` (ловушка 0
//      спеки). Гейтовый детектор добавлен в `scripts/build-constants.test.mjs`;
//      здесь — его браузерная пара, судящая уже собранный харнес.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/** Харнес центра уведомлений: монтирует НАСТОЯЩИЙ AppLayout (:32). */
const HARNESS = 'http://localhost:4174/e2e-harness/notifications.html'

/** Подпись версии в футере: `Версия X.Y.Z`, semver из трёх частей. */
const VERSION_LABEL = /^Версия \d+\.\d+\.\d+$/
/** Метка сборки: `сборка <короткий sha>`. */
const BUILD_LABEL = /^сборка [0-9a-f]{7,40}$/

/**
 * Сид credential ДО скриптов страницы (Ловушка 6 стори 8.8): addInitScript
 * исполняется раньше инициализации credential.ts, а page.evaluate после load
 * опоздал бы — RequireAuth уже средиректил бы на /login.
 */
async function seedCredential(page: Page): Promise<void> {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'vaps.credential',
      JSON.stringify({ kind: 'dev', userId: 'e2e-changelog' }),
    )
  })
}

/**
 * Бэкенда нет — перехват на уровне КОНТЕКСТА. Право по умолчанию РОВНО
 * `status.view`: журнал обязан открываться и без него (AC-6), а дашборд с ним.
 */
async function stubBackend(
  context: BrowserContext,
  options: { permissions?: string[]; permissionsStatus?: number } = {},
): Promise<void> {
  const permissions = options.permissions ?? ['status.view']
  const status = options.permissionsStatus ?? 200

  await context.route('**/api/operations/my-permissions/', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body:
        status === 200
          ? JSON.stringify({ permissions })
          : JSON.stringify({
              error_code: 'INTERNAL',
              message: 'boom',
              details: {},
              request_id: 'req-e2e-10-9',
              timestamp: '2026-07-19T08:00:00+05:00',
            }),
    }),
  )

  // лента колокольчика — часть каркаса; без заглушки запрос ушёл бы в
  // SPA-fallback preview и вернул HTML вместо JSON
  await context.route('**/api/notifications/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
    }),
  )
}

test.describe('футер каркаса в прод-сборке (AC-1, AC-2, AC-4)', () => {
  test('(а) версия и метка сборки доехали ДО БРАУЗЕРА и имеют верную форму', async ({
    page,
    context,
  }) => {
    // 🔴 Главный ассерт файла. Он краснеет на КАЖДОЙ строке таблицы AC-1:
    // голый идентификатор → ReferenceError и пустая страница; ЧИСЛО → подпись
    // не совпадёт с semver-формой; снятый define → ReferenceError.
    const crashes: string[] = []
    page.on('pageerror', (error) => crashes.push(String(error)))

    await stubBackend(context)
    await seedCredential(page)
    await page.goto('/')

    const footer = page.getByRole('contentinfo')
    await expect(footer).toBeVisible()

    const version = footer.getByRole('link', { name: /^Версия / })
    await expect(version).toHaveText(VERSION_LABEL)
    // sha в бандле реальный: пустая строка тоже легальна (сборка вне git), но
    // тогда метки не должно быть вовсе — промежуточного состояния нет
    await expect(footer.getByText(/^сборка /)).toHaveText(BUILD_LABEL)

    // ReferenceError на несуществующем define — молчаливый в консоли сборки,
    // но фатальный в браузере; ассертим явно, а не «по тому, что тест прошёл»
    expect(crashes).toEqual([])
  })

  test('(б) футер — на КАЖДОМ разделе портала, ровно один', async ({
    page,
    context,
  }) => {
    await stubBackend(context, {
      permissions: ['status.view', 'audit.view', 'daily_report.generate'],
    })
    await seedCredential(page)

    for (const path of ['/', '/organization', '/audit', '/changelog']) {
      await page.goto(path)
      await expect(page.getByRole('contentinfo')).toHaveCount(1)
      await expect(
        page.getByRole('contentinfo').getByRole('link', { name: /^Версия / }),
      ).toBeVisible()
    }
  })

  test('(в) 🔴 в футере НЕТ списочной разметки — четыре чужих ассерта целы', async ({
    page,
    context,
  }) => {
    // Ограничение AC-4 защищает `listitem`-счётчики notifications.spec.ts
    // (:313, :322-323, :374) и e2e-live/notifications-live.spec.ts (:195-196).
    // Последний живёт в ОТДЕЛЬНОМ конфиге и в `npx playwright test` не
    // прогоняется вовсе — значит запрет обязан держаться по построению, и
    // проверять его надо там, где он может сломаться молча: в реальном DOM.
    await stubBackend(context)
    await seedCredential(page)
    await page.goto('/')

    const footer = page.getByRole('contentinfo')
    await expect(footer).toBeVisible()
    await expect(footer.getByRole('listitem')).toHaveCount(0)
    await expect(footer.getByRole('list')).toHaveCount(0)
  })

  test('(г) на печатном роуте футера НЕТ — бумага не несёт каркас', async ({
    page,
    context,
  }) => {
    await stubBackend(context)
    await seedCredential(page)
    await page.goto('/print/test')

    await expect(page.locator('.print-root')).toBeVisible()
    await expect(page.getByRole('contentinfo')).toHaveCount(0)
  })

  test('(д) 🔴 500 на my-permissions: разделы недоступны — А ВЕРСИЯ ВИДНА', async ({
    page,
    context,
  }) => {
    // Смысл AC-5 (NFR-8): версию называют поддержке ровно тогда, когда всё
    // сломалось. В браузере это идёт через НАСТОЯЩИЕ ретраи TanStack Query и
    // настоящий разбор конверта ошибки, а не через мок хука.
    await stubBackend(context, { permissionsStatus: 500 })
    await seedCredential(page)
    await page.goto('/')

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('navigation', { name: 'Разделы' }).getByRole('link'),
    ).toHaveCount(0)

    const footer = page.getByRole('contentinfo')
    await expect(
      footer.getByRole('link', { name: /^Версия / }),
    ).toHaveText(VERSION_LABEL)
  })
})

test.describe('журнал: вход и глубокая ссылка (AC-4, AC-6, AC-7)', () => {
  test('(е) клик по версии в футере открывает журнал — настоящей навигацией', async ({
    page,
    context,
  }) => {
    // Правило «роут без входа — мёртвый продукт» (10.7 Решение №6). В vitest
    // это идёт через MemoryRouter; здесь — через реальный history API.
    await stubBackend(context)
    await seedCredential(page)
    await page.goto('/')

    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: /^Версия / })
      .click()

    await expect(
      page.getByRole('heading', { level: 1, name: /Журнал/ }),
    ).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/changelog')
    // журнал живёт ВНУТРИ каркаса — футер на месте и после перехода
    await expect(page.getByRole('contentinfo')).toHaveCount(1)
  })

  test('(ж) 🔴 ГЛУБОКАЯ ССЫЛКА /changelog при permissions: [] открывает журнал', async ({
    page,
    context,
  }) => {
    // Два непокрытых слоя разом:
    //   · SPA-fallback — прямой заход на вложенный путь, которого на диске нет.
    //     Ни один vitest-тест этого не проверяет: MemoryRouter отдаёт роут без
    //     участия сервера. Именно так по журналу придут из разговора с поддержкой;
    //   · AC-6 — журнал доступен ЛЮБОМУ авторизованному, в том числе БЕЗ прав.
    await stubBackend(context, { permissions: [] })
    await seedCredential(page)
    await page.goto('/changelog')

    await expect(
      page.getByRole('heading', { level: 1, name: /Журнал/ }),
    ).toBeVisible()
    await expect(page.getByText('Доступ запрещён')).toHaveCount(0)

    // секции на месте — страница настоящая, а не пустая оболочка
    await expect(
      page.getByRole('heading', { name: 'Версия приложения' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Закрытые исправления' }),
    ).toBeVisible()

    // сегодня источник пуст — это НОРМА до 13.4, а не сбой (Решение №5)
    await expect(page.getByText('Исправлений пока нет.')).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
  })

  test('(з) журнала нет в сайдбаре — вход только через футер (AC-7)', async ({
    page,
    context,
  }) => {
    await stubBackend(context, {
      permissions: ['status.view', 'audit.view', 'daily_report.generate', 'daily_report.mark_update'],
    })
    await seedCredential(page)
    await page.goto('/')

    const nav = page.getByRole('navigation', { name: 'Разделы' })
    await expect(nav).toBeVisible()
    await expect(nav.getByRole('link', { name: /Журнал/ })).toHaveCount(0)
    // ссылка на /changelog существует РОВНО одна на странице — та, что в футере
    await expect(page.locator('a[href="/changelog"]')).toHaveCount(1)
  })
})

test.describe('AC-2 положительно: define доехал и во ВТОРУЮ сборку', () => {
  test('(и) 🔴 харнес dist-e2e рендерит футер с настоящей версией', async ({
    page,
  }) => {
    // Это и есть недостающая половина AC-2. Спека доказывала его тем, что
    // notifications.spec.ts «не падает»; но забытый define в vite.e2e.config.ts
    // валит монтирование ReferenceError'ом, а УДАЛЁННЫЙ футер не валит ничего —
    // и оба случая та спека не различает. Здесь харнес судится по тому, что он
    // ПОКАЗЫВАЕТ.
    const crashes: string[] = []
    page.on('pageerror', (error) => crashes.push(String(error)))

    // харнес сам сеет credential и не ходит в сеть за правами (MemoryRouter с
    // единственным маршрутом '/'), поэтому заглушек не требует
    await page.goto(HARNESS)

    const footer = page.getByRole('contentinfo')
    await expect(footer).toBeVisible()
    await expect(footer.getByRole('link', { name: /^Версия / })).toHaveText(
      VERSION_LABEL,
    )
    expect(crashes).toEqual([])
  })
})
