// Story 11.4 (QA-добор, workflow qa-generate-e2e-tests) — центр уведомлений в
// РЕАЛЬНОМ chromium против прод-сборки харнеса (порт 4174, dist-e2e).
//
// Зачем это поверх 24 плотных vitest-тестов стори. Дев-сюита сильная и
// мутационно проверенная (красная проба 12/12, причём мутация №9 её честно
// усилила). Повторять её здесь незачем — взяты РОВНО те места, где QA-проба
// показала, что правку прод-кода не краснит НИ ОДИН из 527 тестов:
//
//   1) ВРЕЗКА В ШАПКУ (Task 3 стори). `<NotificationBell />` можно ЦЕЛИКОМ
//      выдернуть из AppLayout, заменив мёртвой кнопкой с тем же aria-label, —
//      527/527 остаются зелёными. NotificationBell.test.tsx судит компонент в
//      изоляции, а три app-теста проверяют лишь «кнопка не disabled». Здесь
//      смонтирован настоящий AppLayout, поэтому подмена краснит всё.
//   2) БЕЙДЖ. jsdom не применяет CSS вообще — он сверяет имена классов. Снять с
//      бейджа `bg-destructive` можно бесследно: счётчик останется «видимым» для
//      всех тестов и невидимым для оператора. Ассерт — по ВЫЧИСЛЕННОМУ стилю.
//   3) ПАНЕЛЬ КАК ОВЕРЛЕЙ. `absolute … z-50` можно снять бесследно. В потоке
//      панель раздвинула бы шапку и уехала бы под контент. Геометрии в jsdom
//      нет вовсе.
//   4) НАСТОЯЩИЙ WebSocket. `new WebSocket(...)` (notificationsSocket.ts:99) не
//      исполняется НИ РАЗУ во всём проекте: общий vitest.setup.ts подменяет
//      фабрику инертной для ВСЕХ юнит-тестов — осознанно (юнит-тест не должен
//      ходить в сеть), но ядро стори AC-6 «событие → мутация кэша» из-за этого
//      всюду ездит на фейке. Здесь кадр проезжает боевой браузерный WebSocket.
//
// Чего здесь НЕТ и почему:
//   • Живого бэкенда — это стори 10.10 (compose-контур). Сеть перехвачена
//     page.route/page.routeWebSocket, то есть НА УРОВНЕ БРАУЗЕРА: fetch
//     настоящий, JSON настоящий, у границы работает боевой parseErrorResponse.
//   • Отдельного теста «время без таймзонной конверсии» (AC-8). Дев-сюита
//     проверяет его двумя строками с одинаковым настенным временем и разными
//     смещениями — ассерт TZ-независим и мутационно доказан (проба №10).
//     Дублировать нечего; вместо этого ВЕСЬ файл гоняется в чужой таймзоне
//     (см. test.use ниже), и рендер строки проверяется попутно в AC-6.
//   • Реконнекта с backoff — предмет стори 11.3, её сюита это пинит.
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'

// Абсолютный URL: глобальный baseURL (4173) принадлежит print-спекам 8.8.
const HARNESS = 'http://localhost:4174/e2e-harness/notifications.html'

// 🔴 Браузер живёт в таймзоне, максимально далёкой от Asia/Qyzylorda (+05:00),
// в котором бэкенд рендерит created_at. Любой рендер через `new Date(...)`
// покажет здесь ДРУГОЙ день и ДРУГОЙ час, чем строка на проводе, — то есть
// AC-8 проверяется всем файлом бесплатно, а не отдельным тестом.
test.use({ timezoneId: 'America/Anchorage' })

interface Row {
  id: number
  recipient: string
  kind: string
  business_date: string
  payload: unknown
  read_at: string | null
  created_at: string
}

/** Кириллица в телах фикстур — урок E9: латиница даёт зелёный тест на сломанном. */
function row(over: Partial<Row> & { id: number }): Row {
  return {
    recipient: 'Ким Оператор Сергеевич',
    kind: 'SUBMISSION_LAGGING',
    business_date: '2026-07-19',
    payload: { laggard_division_ids: [] },
    read_at: null,
    created_at: '2026-07-19T09:00:00+05:00',
    ...over,
  }
}

interface Traffic {
  /** Запросы ЛЕНТЫ (?limit=50) — то, что считает Решение №4. */
  feedGets: number
  /** Дочитка транспорта (?limit=1 на seed) — отдельно, иначе не отличить. */
  seedGets: number
}

/**
 * Перехват HTTP на уровне браузера. Ветка по `limit` обязательна: по одному
 * пути ходят ДВА потребителя — лента хука (?limit=50) и дочитка транспорта
 * 11.3 (?limit=1 на seed). Без разделения спека не отличила бы рефетч ленты от
 * дочитки, и ассерт «ушёл ровно один запрос» потерял бы смысл.
 *
 * 🔴 `seedRows` отделён от `rows` НЕ для красоты — на этом споткнулась первая
 * редакция спеки. SEED кладёт id ответа в кольцо дедупа транспорта
 * (notificationsSocket.ts:180-193), поэтому WS-кадр с тем же id транспорт
 * ГЛУШИТ ещё до подписчиков — молча и совершенно правильно (Ловушка 7 стори).
 * Фикстура, где сеяли и присылали одну и ту же строку, давала «кадр не дошёл»
 * и выглядела как баг прод-кода. Реальность моделируется честно: на загрузке
 * сервер отдаёт свою последнюю строку, а по WS приезжает НОВАЯ, с новым id.
 */
async function stubApi(
  page: Page,
  opts: {
    rows: Row[]
    seedRows?: Row[]
    count?: number
    feedResponses?: Array<'ok' | 'fail'>
  },
): Promise<Traffic> {
  const traffic: Traffic = { feedGets: 0, seedGets: 0 }
  const queue = [...(opts.feedResponses ?? [])]
  const seedRows = opts.seedRows ?? opts.rows.slice(0, 1)

  await page.route('**/api/operations/my-permissions/', (route) =>
    route.fulfill({ json: { permissions: ['status.view'] } }),
  )

  await page.route('**/api/notifications/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('limit') !== '50') {
      traffic.seedGets += 1
      await route.fulfill({
        json: {
          count: seedRows.length,
          next: null,
          previous: null,
          results: seedRows,
        },
      })
      return
    }
    traffic.feedGets += 1
    if (queue.shift() === 'fail') {
      await route.fulfill({ status: 500, json: { detail: 'сбой' } })
      return
    }
    await route.fulfill({
      json: {
        count: opts.count ?? opts.rows.length,
        next: null,
        previous: null,
        results: opts.rows,
      },
    })
  })

  return traffic
}

interface Channel {
  /** URL, которые собрал и открыл НАСТОЯЩИЙ браузерный WebSocket. */
  urls: string[]
  send(frame: unknown): Promise<void>
}

/**
 * Перехват WS. connectToServer() НЕ вызывается — Playwright держит соединение
 * сам, реального сервера за ним нет. Клиентская сторона при этом целиком
 * настоящая: адрес собрал buildSocketUrl из location, сокет открыл
 * `new WebSocket(...)`, кадр приедет боевым MessageEvent в handleFrame.
 */
async function stubSocket(page: Page): Promise<Channel> {
  const urls: string[] = []
  let live: WebSocketRoute | null = null

  await page.routeWebSocket(/\/ws\/notifications\//, (ws) => {
    urls.push(ws.url())
    live = ws
  })

  return {
    urls,
    async send(frame: unknown) {
      await expect
        .poll(() => urls.length, { message: 'браузер не открыл WebSocket' })
        .toBeGreaterThan(0)
      // Конверт 11.2: {type: <kind>, payload: <проекция NotificationSerializer>}
      ;(live as WebSocketRoute | null)?.send(JSON.stringify(frame))
    },
  }
}

function bellOf(page: Page) {
  return page.getByRole('button', { name: /^Уведомления/ })
}

function panelOf(page: Page) {
  return page.getByRole('region', { name: 'Уведомления' })
}

test('AC-1/AC-3: колокольчик ЖИВОЙ в настоящей шапке, бейдж доехал до прод-CSS', async ({
  page,
}) => {
  await stubSocket(page)
  await stubApi(page, {
    rows: [
      row({ id: 1 }),
      row({ id: 2, read_at: '2026-07-19T10:00:00+05:00' }),
      row({ id: 3 }),
    ],
  })
  await page.goto(HARNESS)

  const bell = bellOf(page)
  await expect(bell).toBeEnabled()
  // Считается read_at === null, а не длина списка — и это ЖИВОЙ колокольчик из
  // AppLayout, а не изолированный компонент.
  await expect(bell).toHaveAccessibleName('Уведомления, непрочитанных: 2')

  // Бейдж — единственный <span> внутри кнопки (второй ребёнок — svg Bell).
  const badge = bell.locator('span')
  await expect(badge).toHaveText('2')
  await expect(badge).toBeVisible()

  const paint = await badge.evaluate((el) => {
    const style = getComputedStyle(el)
    return { bg: style.backgroundColor, fg: style.color }
  })
  // Прозрачный фон = bg-destructive до бейджа не доехал. Для jsdom это
  // невидимо: он сверяет имена классов, не применяя ни одного правила CSS.
  expect(
    paint.bg,
    'фон бейджа прозрачен — bg-destructive не доехал до dist-CSS',
  ).not.toBe('rgba(0, 0, 0, 0)')
  // Число обязано быть ЧИТАЕМЫМ: цифра в цвет фона означала бы, что видимым
  // сигналом остаётся только цвет пятна (EXPERIENCE.md#L238).
  expect(paint.fg, 'текст бейджа слился с фоном').not.toBe(paint.bg)

  // Бейдж РЕАЛЬНО нарисован поверх колокольчика, а не обрезан родителем.
  const box = (await badge.boundingBox())!
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)
  const topmost = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.tagName ?? 'null',
    [box.x + box.width / 2, box.y + box.height / 2],
  )
  expect(
    topmost,
    'в центре бейджа лежит не бейдж — он обрезан или перекрыт',
  ).toBe('SPAN')
})

test('AC-4: панель ПЕРЕКРЫВАЕТ рабочую область и не сдвигает шапку', async ({
  page,
}) => {
  await stubSocket(page)
  await stubApi(page, { rows: [row({ id: 1 })] })
  await page.goto(HARNESS)

  const bell = bellOf(page)
  const panel = panelOf(page)
  const header = page.locator('header')

  await expect(bell).toHaveAccessibleName('Уведомления, непрочитанных: 1')
  const bellBefore = (await bell.boundingBox())!
  const headerBefore = (await header.boundingBox())!

  await bell.click()
  await expect(panel).toBeVisible()
  await expect(bell).toHaveAttribute('aria-expanded', 'true')

  // 🔴 ЯДРО: раскрытие — ОВЕРЛЕЙ, а не элемент потока. Потеряв `absolute`,
  // панель встала бы внутрь flex-элемента шапки, и `items-center` сдвинул бы
  // сам колокольчик вверх. Геометрии в jsdom нет — регрессия там невидима.
  expect(
    await bell.boundingBox(),
    'колокольчик сдвинулся при раскрытии — панель встала в поток',
  ).toEqual(bellBefore)
  expect(
    await header.boundingBox(),
    'шапка изменила геометрию при раскрытии',
  ).toEqual(headerBefore)

  // Панель свисает НИЖЕ шапки, иначе это полоска в шапке, а не центр.
  const panelBox = (await panel.boundingBox())!
  expect(panelBox.y + panelBox.height).toBeGreaterThan(
    headerBefore.y + headerBefore.height,
  )

  // …и она ТОПМОСТ над рабочей областью: z-50 доехал до CSS.
  const overlaps = await page.evaluate(
    ([x, y]) => {
      const hit = document.elementFromPoint(x, y)
      const panelEl = document.getElementById('notifications-panel')
      return panelEl !== null && hit !== null && panelEl.contains(hit)
    },
    [panelBox.x + panelBox.width / 2, headerBefore.y + headerBefore.height + 20],
  )
  expect(
    overlaps,
    'под шапкой в точке панели лежит не панель — z-index не доехал',
  ).toBe(true)

  // Повторный клик закрывает (disclosure, а не меню).
  await bell.click()
  await expect(panel).not.toBeVisible()
})

test('AC-6: кадр из НАСТОЯЩЕГО WebSocket долетает до бейджа и до строки', async ({
  page,
}) => {
  const channel = await stubSocket(page)
  await stubApi(page, {
    rows: [row({ id: 1, created_at: '2026-07-19T08:00:00+05:00' })],
  })
  await page.goto(HARNESS)

  const bell = bellOf(page)
  await expect(bell).toHaveAccessibleName('Уведомления, непрочитанных: 1')

  // Адрес собрал БРАУЗЕР из своего location, и сокет открыл боевой
  // `new WebSocket(...)`. В юнит-тестах эта ветка не исполняется никогда —
  // фабрика подменена инертной на уровне общего setup.
  await expect
    .poll(() => channel.urls.length, { message: 'браузер не открыл WebSocket' })
    .toBe(1)
  const wsUrl = new URL(channel.urls[0])
  expect(wsUrl.protocol).toBe('ws:')
  expect(wsUrl.pathname).toBe('/ws/notifications/') // трейлинг-слеш значим
  expect(wsUrl.searchParams.get('user_id')).toBe('operator-42')

  await bell.click()
  await expect(page.getByRole('listitem')).toHaveCount(1)

  await channel.send({
    type: 'SUBMISSION_LAGGING',
    payload: row({ id: 2, created_at: '2026-07-19T23:30:00+05:00' }),
  })

  // Кадр → setQueryData → бейдж. Ни перезагрузки, ни повторного запроса.
  await expect(bell).toHaveAccessibleName('Уведомления, непрочитанных: 2')
  const items = page.getByRole('listitem')
  await expect(items).toHaveCount(2)

  // Порядок — серверный (created_at DESC): свежая строка первой.
  const first = items.first()
  await expect(first).toContainText('Отставание по сдаче')
  await expect(first).toContainText('Не прочитано')
  // 🔴 Время и дата — ИЗ СТРОКИ. Браузер живёт в America/Anchorage (см.
  // test.use): `new Date('2026-07-19T23:30:00+05:00')` дало бы здесь 10:30, а
  // `new Date('2026-07-19')` — 18.07.2026. Обе подмены краснят этот ассерт.
  await expect(first).toContainText('23:30')
  await expect(first).toContainText('19.07.2026')
})

test('AC-7/Решение №4: настоящий 500 не ретраится, а первый WS-кадр чинит ленту', async ({
  page,
}) => {
  const channel = await stubSocket(page)
  const traffic = await stubApi(page, {
    // На загрузке у сервера есть строка 5; по WS приезжает НОВАЯ строка 9, и
    // успешный рефетч честно отдаёт обе (сервер — истина, WS — сигнал).
    seedRows: [row({ id: 5 })],
    rows: [row({ id: 9, created_at: '2026-07-19T23:30:00+05:00' }), row({ id: 5 })],
    feedResponses: ['fail'], // первый запрос ленты — 500, второй уже успешный
  })
  await page.goto(HARNESS)

  const bell = bellOf(page)
  await bell.click()

  // Боевой parseErrorResponse на настоящем не-2xx.
  await expect(page.getByRole('alert')).toHaveText(
    'Не удалось загрузить уведомления',
  )
  // Шапка и колокольчик ЖИВЫ — регресс, который иначе увидит только оператор.
  await expect(bell).toBeEnabled()
  // Бейджа нет: числа, которого не знаем, не показываем.
  await expect(bell).toHaveAccessibleName('Уведомления')

  // 🔴 retry: false живёт В ХУКЕ (Решение №4), а QueryClient харнеса намеренно
  // оставлен с дефолтами — потеря retry:false дала бы здесь четыре запроса.
  await expect.poll(() => traffic.feedGets).toBe(1)

  await channel.send({
    type: 'SUBMISSION_LAGGING',
    payload: row({ id: 9, created_at: '2026-07-19T23:30:00+05:00' }),
  })

  // Дельта пустой кэш НЕ засеивает, но инвалидейт шлёт повторный запрос —
  // провалившаяся первая загрузка чинится сама (истина в REST, WS — сигнал).
  await expect.poll(() => traffic.feedGets).toBe(2)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('listitem')).toHaveCount(2)
  await expect(bell).toHaveAccessibleName('Уведомления, непрочитанных: 2')
})

test('AC-5: настоящий Escape закрывает панель и ВОЗВРАЩАЕТ фокус на колокольчик', async ({
  page,
}) => {
  await stubSocket(page)
  await stubApi(page, { rows: [row({ id: 1 })] })
  await page.goto(HARNESS)

  const bell = bellOf(page)
  const panel = panelOf(page)

  await expect(bell).toHaveAccessibleName('Уведомления, непрочитанных: 1')
  await bell.click()
  await expect(panel).toBeVisible()

  // 🔴 Уводим фокус НАСТОЯЩИМ Tab. Без этого шага ассерт вакуумен: клик уже
  // оставил фокус на кнопке, и «возврат» проверял бы то, что и так на месте —
  // ровно этот вакуум красная проба дев-прохода поймала в jsdom-сюите
  // (мутация №9 осталась зелёной). Здесь Tab настоящий, а не имитация
  // userEvent по собственному списку кандидатов.
  //
  // Два Tab, не один (11.4b, найдено живым прогоном 11.6a): строка теперь
  // несёт кнопку «прочитано» (read_at: null по умолчанию у row()) — первый
  // Tab уходит на неё, второй — на «Меню пользователя». Тот же фикс, что уже
  // применён к jsdom-двойнику этого теста (NotificationBell.test.tsx).
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: 'Отметить прочитанным' }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Меню пользователя' })).toBeFocused()

  await page.keyboard.press('Escape')

  await expect(panel).not.toBeVisible()
  await expect(bell).toBeFocused()
  await expect(bell).toHaveAttribute('aria-expanded', 'false')
})
