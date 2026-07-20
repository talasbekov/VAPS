// Story 11.6 — ЕДИНСТВЕННЫЙ тест проекта, в котором уведомление РОЖДАЕТСЯ на
// живом бэкенде и доезжает до браузера. Сценарий №4 из лимита 5
// (architecture.md#L259).
//
// Обе половины пути отлично покрыты по отдельности и НИ РАЗУ не были соединены:
// на слое pytest кадр доезжает до WsCommunicator (11.1/11.2), в e2e/notifications
// .spec.ts кадр ИНЖЕКТИТСЯ в браузер Playwright'ом (11.4). Провод между
// Django-процессом и вкладкой оператора не проверен ничем — его и закрывает этот
// файл.
//
// 🔴 Ни одного page.route / routeWebSocket — в этом весь смысл. Сеть здесь
// настоящая: Postgres, Redis, channels_redis, ASGI-приложение, браузерный
// WebSocket через vite-прокси. Захотелось заглушить — значит стек не поднялся,
// и это находка, а не повод замокать.
//
// Наблюдение (page.on) — не перехват: слушатели ничего не подменяют, они лишь
// считают то, что реально ушло по проводу.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

import { LIVE_ENV } from '../playwright.live.config'

const HARNESS = 'http://localhost:4174/e2e-harness/notifications.html'

// fileURLToPath, не URL.pathname — путь репо содержит кириллицу (ловушка 8.8 №7)
const BACKEND_DIR = fileURLToPath(new URL('../../Backend/VAPS', import.meta.url))
const PYTHON = '.venv/bin/python'

// Браузер живёт максимально далеко от Asia/Qyzylorda (+05:00), в котором бэкенд
// считает бизнес-дату и рендерит created_at. Разрыв 14 часов делает проверку
// TZ-независимости бесплатной — и заодно объясняет, почему день выбирает
// СЕРВЕР, а не спека (Ловушка 19: JS-«вчера» регулярно другой день).
test.use({ timezoneId: 'America/Anchorage' })

function manage(args: string[]): string {
  return execFileSync(PYTHON, ['manage.py', ...args], {
    cwd: BACKEND_DIR,
    encoding: 'utf-8',
    // Тот же env, что у uvicorn в webServer. 🔴 VAPS_REDIS_URL обязана
    // совпадать: разные Redis → group_send уходит в другой брокер, ни ошибки,
    // ни лога, кадр просто не приходит.
    env: { ...process.env, ...LIVE_ENV },
  })
}

/** Сид печатает выбранный день машинно-читаемо — единственный источник даты. */
function seed(recipient: string): string {
  const out = manage(['seed_e2e_lagging', '--recipient', recipient])
  const day = /^E2E_DAY=(\d{4}-\d{2}-\d{2})$/m.exec(out)?.[1]
  if (!day) throw new Error(`сид не напечатал E2E_DAY; stdout:\n${out}`)
  return day
}

/** «Beat» (Решение №3): Celery в VAPS нет вовсе, штатная точка входа задачи —
 *  эта команда, и 12.6 обернёт её в @shared_task, не меняя ни строки здесь.
 *  Отдельным процессом и БЕЗ объемлющей транзакции: per-day atomic обязан быть
 *  настоящим COMMIT'ом, иначе on_commit → _publish не выполнится никогда. */
function runEmitter(day: string): string {
  return manage(['check_lagging_submissions', '--today', day])
}

interface Traffic {
  /** Дочитка транспорта на onopen (?limit=1) — признак ОТКРЫТОГО сокета. */
  seedGets: number
  /** Запросы ленты (?limit=50) — отделяют «пришло кадром» от «пришло рефетчем». */
  feedGets: number
  /** URL, которые открыл настоящий браузерный WebSocket. */
  socketUrls: string[]
  /**
   * Кадры, ПРИНЯТЫЕ сокетом с провода.
   *
   * 🔴 Несущий счётчик, а не украшение. Найдено красной пробой №7: при
   * VAPS_WS_ENABLED=0 consumer делает accept() и сразу close(4503), клиент
   * уходит в backoff, а на каждом реконнекте его дочитка (since=…&limit=200)
   * ЧЕСТНО приносит новую строку — и счётчик в UI становится «1» БЕЗ единого
   * WS-кадра. Ассерт по одному счётчику был бы зелёным на выключенном
   * транспорте, то есть доказывал бы не то, что заявляет стори.
   */
  frames: string[]
  /** Навигации главного фрейма: «без перезагрузки» — проверяемое утверждение. */
  navigations: number
}

function watch(page: Page): Traffic {
  const traffic: Traffic = {
    seedGets: 0,
    feedGets: 0,
    socketUrls: [],
    frames: [],
    navigations: 0,
  }
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.startsWith('/api/notifications')) return
    if (url.searchParams.get('limit') === '50') traffic.feedGets += 1
    else traffic.seedGets += 1
  })
  page.on('websocket', (ws) => {
    traffic.socketUrls.push(ws.url())
    ws.on('framereceived', (frame) => traffic.frames.push(frame.payload.toString()))
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) traffic.navigations += 1
  })
  return traffic
}

test('уведомление, рождённое эмиттером на живом бэке, доезжает до счётчика без перезагрузки', async ({
  page,
}) => {
  const recipient = 'operator-42'

  // ШАГ 1. Сид ДО открытия страницы: чистит прошлые уведомления получателя,
  // ставит watermark на день ДО целевого и обнуляет контрольный час.
  const day = seed(recipient)

  const traffic = watch(page)
  await page.goto(HARNESS)

  const bell = page.getByRole('button', { name: /^Уведомления/ })

  // ШАГ 2. Дождаться, что транспорт ОТКРЫТ. Признак — SEED-дочитка: первый
  // onopen шлёт GET /api/notifications/?limit=1 (notificationsSocket.ts:242-296).
  // Не waitForTimeout: магический таймаут = флейк или вакуум (ревью 9.9 P3).
  // «Отсутствие „Нет связи“» признаком НЕ является — ConnectionIndicator рисует
  // его только в статусе reconnecting, а в connecting он тоже пуст.
  await expect
    .poll(() => traffic.seedGets, {
      message: 'браузер не сделал SEED-дочитку — сокет не открылся',
    })
    .toBeGreaterThan(0)

  // Сокет — настоящий, собран прод-кодом из location и проехал через прокси.
  expect(traffic.socketUrls).toHaveLength(1)
  const wsUrl = new URL(traffic.socketUrls[0])
  expect(wsUrl.protocol).toBe('ws:')
  expect(wsUrl.host).toBe('localhost:4174') // same-origin: адрес собран из страницы
  expect(wsUrl.pathname).toBe('/ws/notifications/') // хвостовой слэш значим
  expect(wsUrl.searchParams.get('user_id')).toBe(recipient)

  // 🔴 ЯДРО ПОРЯДКА (Ловушка 4 + красная проба №2). До эмиттера непрочитанных
  // НЕТ — лента уже загружена и пуста. Без этого ассерта перестановка шагов
  // (строка родилась ДО открытия сокета) дала бы ЗЕЛЁНЫЙ тест по неправильной
  // причине: счётчик приехал бы первичной загрузкой ленты по REST, а не кадром.
  await expect(bell).toHaveAccessibleName('Уведомления')
  const feedGetsBefore = traffic.feedGets
  expect(feedGetsBefore).toBeGreaterThan(0) // лента действительно загружалась

  // ШАГ 3. Только теперь — эмиттер. Настоящая цепочка:
  // check_lagging_submissions → tomorrow_block → notify() → on_commit →
  // group_send → channels_redis → consumer → сокет.
  const emitted = runEmitter(day)
  expect(emitted, `эмиттер не создал уведомление:\n${emitted}`).toContain(
    '1 notice(s)',
  )

  // ШАГ 4. Кадр доехал до счётчика — БЕЗ единой перезагрузки.
  await expect(bell).toHaveAccessibleName('Уведомления, непрочитанных: 1')

  // 🔴 …и приехал он ИМЕННО КАДРОМ ПО WS. Три независимых ассерта, потому что
  // счётчик сам по себе не отличает WS от REST — красная проба №7 показала, что
  // на выключенном транспорте он доезжает дочиткой после реконнекта.
  //
  // (а) кадр физически принят сокетом с провода, и это тот самый вид события;
  await expect
    .poll(() => traffic.frames.length, {
      message: 'сокет не принял ни одного кадра — счётчик приехал не по WS',
    })
    .toBeGreaterThan(0)
  const frame = JSON.parse(traffic.frames[0])
  // Конверт 11.2: {type: <kind>, payload: <проекция NotificationSerializer>}
  expect(frame.type).toBe('SUBMISSION_LAGGING')
  expect(frame.payload.business_date).toBe(day)
  expect(frame.payload.recipient).toBe(recipient)

  // (б) лента не перезапрашивалась — это не рефетч (Ловушка 10);
  expect(
    traffic.feedGets,
    'лента перезапрашивалась — счётчик мог приехать рефетчем, а не WS-кадром',
  ).toBe(feedGetsBefore)

  // (в) сокет тот же самый — реконнекта не было, значит и дочитки на onopen,
  // которая принесла бы строку в обход WS, тоже (проба №7).
  expect(
    traffic.socketUrls,
    'сокет переоткрывался — строка могла приехать дочиткой на реконнекте',
  ).toHaveLength(1)

  // ШАГ 5. Панель — disclosure: в закрытом виде её нет в DOM вовсе.
  await bell.click()
  const panel = page.getByRole('region', { name: 'Уведомления' })
  await expect(panel).toBeVisible()

  const items = page.getByRole('listitem')
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText('Отставание по сдаче')
  await expect(items.first()).toContainText('Не прочитано')
  // Дата строки — та, что выбрал СЕРВЕР (день несдачи), в формате UI.
  const [yyyy, mm, dd] = day.split('-')
  await expect(items.first()).toContainText(`${dd}.${mm}.${yyyy}`)

  // ШАГ 6. Негативный контроль «без перезагрузки страницы»: единственная
  // навигация — первый goto. Без этого ассерта буква epic-AC держалась бы на
  // честном слове автора теста.
  expect(
    traffic.navigations,
    'страница навигировалась — «без перезагрузки» не доказано',
  ).toBe(1)
})
