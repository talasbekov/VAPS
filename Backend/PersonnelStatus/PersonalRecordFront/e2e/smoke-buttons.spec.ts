/**
 * Смоук-обход портала СТАРОГО стека: все маршруты × все интерактивные элементы,
 * с записью трафика фронт↔бэк. Диагностический инструмент, а НЕ регрессионный
 * тест — он ничего не чинит и почти ничего не заваливает: находки копятся в
 * `smoke-results/*.json`, отчёт собирает `scripts/smoke-report.mjs`.
 *
 * Порт обхода, снятого вместе с vite-SPA (коммит 1a8c34e7 → c3fdc293). Логика
 * судейства сохранена дословно; переписано ровно то, что различает стеки:
 *
 *   1. ВХОД. У SPA был JWT в sessionStorage — здесь NextAuth-сессия в cookie.
 *      Логинимся программно (csrf + callback/credentials) ОДИН РАЗ НА ПЕРСОНУ и
 *      раздаём контекстам сохранённое состояние (`storageState`). Пароли берём
 *      живым POST /api/token/ только для резолвера id, а не для входа в UI.
 *   2. МАРШРУТЫ. Роутинг файловый (app/**\/page.tsx), поэтому карта сверяется с
 *      ФАЙЛОВОЙ СИСТЕМОЙ, а не с shared/routes.ts, которого здесь нет.
 *   3. `trailingSlash: true` в next.config.js: /dashboard отдаёт 308 на
 *      /dashboard/. Пути сравниваем нормализованными — иначе КАЖДЫЙ маршрут
 *      отчитывался бы «ушли со страницы» сразу после goto.
 *   4. КАРКАС. У SPA был #main-content; здесь контент в <main>, сайдбар <aside>,
 *      шапка <header> (components/dashboard-layout.tsx).
 *   5. КОРЕНЬ «/» — это ЭКРАН ВХОДА, а не дашборд, и залогиненного он никуда не
 *      уводит (app/page.tsx: router.push('/dashboard') только после submit).
 *      Поэтому «выкинуло на /» = middleware отбил, и судим так же, как SPA
 *      судила «выкинуло на /login».
 *
 * 🔴 Живёт в `e2e/`, но без `SMOKE_LIVE=1` весь describe скипается: обходу
 * нужен ЖИВОЙ стек, поднятый снаружи —
 *   Django :8100 (Personnel-Records, DJANGO_SETTINGS_MODULE=...local_postgres)
 *   Next   :3106 (PersonalRecordFront, `npm run dev -- -p 3106`)
 * Запуск: `SMOKE_LIVE=1 npx playwright test --config playwright.smoke.config.ts`
 */
import fs from 'node:fs'
import path from 'node:path'
import { request as apiRequest, test, type Page, type Request } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { ROUTES } from './portal-routes'

const LIVE = process.env.SMOKE_LIVE === '1'
const API_ORIGIN = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
/**
 * Тот же адрес, что и `baseURL` в playwright.smoke.config.ts. Дублируется
 * намеренно: вход теперь делается ВНЕ страницы, собственным
 * `request.newContext()`, а тот про `use.baseURL` конфига ничего не знает.
 */
const APP_ORIGIN = process.env.SMOKE_BASE_URL ?? 'http://localhost:3106'
/**
 * 🔴 НЕ под `test-results/`: Playwright сносит свой outputDir перед КАЖДЫМ
 * прогоном. Отчёт по одной персоне, лежавший там, стирался стартом обхода по
 * следующей — и «отчёт пустой» выглядело как «обход ничего не нашёл».
 */
// 🔴 `__dirname`, а НЕ `import.meta.url`: package.json без `"type": "module"`,
// Playwright компилирует спеку в CJS — `import.meta` там запрещён, файл падает
// ещё до сборки тестов. Заодно снимается ловушка кириллицы в пути репозитория:
// `__dirname` — обычный путь ФС, процентного кодирования в нём не бывает.
const OUT_DIR = path.join(__dirname, '..', 'smoke-results')

/** Селектор «интерактивного». Один на весь файл: индексы дескрипторов и
 *  локаторов обязаны считаться по ОДНОМУ И ТОМУ ЖЕ списку. */
const INTERACTIVE =
  'button, [role="button"], a[href], input[type="submit"], [role="tab"], [role="switch"], summary'

/** Пауза после клика: столько ждём запрос/перерисовку, прежде чем судить. */
const SETTLE_MS = Number(process.env.SMOKE_SETTLE ?? 1200)
/** Потолок элементов на страницу. Отсечённое ПЕЧАТАЕТСЯ в отчёт (не молча). */
const MAX_ELEMENTS = Number(process.env.SMOKE_MAX_ELEMENTS ?? 60)
/**
 * Потолок ВРЕМЕНИ на страницу. Счётчика элементов мало: цена элемента не
 * постоянна — клик, открывший модалку, тянет за собой ещё до восьми кликов
 * внутри неё, а неклика́бельный стоит перезагрузки страницы и второй попытки.
 * Когда `/employees` и `/statuses` доросли до четырёх десятков элементов с
 * модалками, обход перестал укладываться в лимит теста и падал по таймауту —
 * а падение по таймауту не оставляет ОТЧЁТА ВОВСЕ, хотя обход к тому моменту
 * уже нашёл всё, что успел. Бюджет обрывает обход штатно и печатает, что
 * осталось непройденным: усечение — находка, а не отказ.
 */
const PAGE_BUDGET_MS = Number(process.env.SMOKE_PAGE_BUDGET ?? 170_000)
/** Лимит теста считается ОТ бюджета: разъехавшись, они вернут тот же таймаут.
 *  Запас — на загрузку страницы и на элемент, начатый до истечения бюджета
 *  (худший: 5 с клик + перезагрузка + 5 с вторая попытка + отстой). */
const TEST_TIMEOUT_MS = PAGE_BUDGET_MS + 70_000

/**
 * Модалка/шторка. `[aria-modal]` — не украшение: у SPA форма «Создать ОМ» не
 * несла `role="dialog"`, обход её не распознал, Escape не нажал — и следующие
 * ЧЕТЫРЕ элемента страницы отчитались «не кликается», потому что их перекрывал
 * незакрытый оверлей. Ложное обвинение кнопок; здесь тот же Radix.
 */
const MODAL = '[role="dialog"], [aria-modal="true"]'

/**
 * ВСПЛЫВАЮЩИЙ СЛОЙ поверх страницы или модалки: раскрытый Select (`listbox`),
 * меню строки (`menu`), календарь в поповере (обёртка Radix). Ровно та же
 * ловушка, что описана выше для модалки, но этажом ниже — и она стоила обходу
 * половины покрытия: первый же клик по «Выберите статус» раскрывал список, а
 * дальше КАЖДЫЙ элемент модалки отчитывался «не кликается», потому что его
 * перекрывал незакрытый список. Двадцать ложных обвинений на `/employees`, по
 * пять секунд ожидания каждое.
 *
 * Escape закрывает верхний слой, НЕ трогая модалку под ним, — но нажимать его
 * вслепую нельзя: без раскрытого слоя он закроет саму модалку, и обход пойдёт
 * её переоткрывать.
 */
const POPUP = '[data-radix-popper-content-wrapper], [role="listbox"], [role="menu"]'

async function dismissPopup(page: Page): Promise<void> {
  if ((await page.locator(POPUP).count()) === 0) return
  await page.keyboard.press('Escape').catch(() => undefined)
  await page.waitForTimeout(150)
}

// ─────────────────────────── персоны ───────────────────────────
// Учётки стенда (сид RBAC + ручные пользователи). Пароли стендовые,
// секретами не являются: контур локальный.
interface Persona {
  key: string
  username: string
  password: string
  role: string
}

const ALL_PERSONAS: readonly Persona[] = [
  { key: STAND_USERNAME, username: STAND_USERNAME, password: STAND_PASSWORD, role: 'ADMIN → `*`' },
  {
    key: 'observer',
    username: 'observer',
    password: 'observer123',
    role: 'OPS_READER (object.view + duty.view)',
  },
  {
    key: 'erda',
    username: 'erda',
    password: 'erda123',
    role: 'DIVISION_OPERATOR (ОМ-прав нет)',
  },
]

const PERSONAS = ALL_PERSONAS.filter((p) =>
  (process.env.SMOKE_PERSONAS ?? 'admin,observer,erda').split(',').includes(p.key),
)

// ─────────────────────── запись трафика ───────────────────────
interface NetEvent {
  method: string
  url: string
  status: number | null
  ms: number
  failure: string | null
}

interface LogEvent {
  kind: 'console' | 'pageerror'
  text: string
}

/**
 * Только API-трафик к БЭКЕНДУ: бандл, HMR и статика к связи фронт↔бэк отношения
 * не имеют. Два адреса, а не один, — в этом стеке запрос уходит ДВУМЯ путями:
 *   • тем же origin `/api/...` → rewrites next.config.js проксируют на Django;
 *   • напрямую `http://localhost:8100/api/...` — клиентский BACKEND_URL
 *     (shared/config/env.ts) в dev не относительный, а полный, и `BACKEND_URL`
 *     из .env.local в браузер не инлайнится (не NEXT_PUBLIC_) → работает
 *     зашитый дефолт. Ловим оба, иначе половина трафика была бы невидима.
 *
 * `/api/auth/*` ИСКЛЮЧЁН намеренно: это внутренний обмен NextAuth с самим собой
 * (session/csrf дёргаются на каждой смене фокуса), к связи фронт↔бэк он не
 * относится и утопил бы настоящие запросы в шуме. Отказ авторизации всё равно
 * виден — вердиктом страницы «выкинуло на /».
 */
function isApi(url: string): boolean {
  try {
    const u = new URL(url)
    if (!u.pathname.startsWith('/api/')) return false
    if (u.pathname.startsWith('/api/auth/')) return false
    return true
  } catch {
    return false
  }
}

/** Кросс-ориджинный адрес оставляем узнаваемым: `:8100/api/ops/...` против
 *  `/api/ops/...` — это разные маршруты доставки, и в отчёте их надо различать. */
function strip(url: string): string {
  try {
    const u = new URL(url)
    const sameOrigin = u.port === '3106' || u.port === ''
    return (sameOrigin ? '' : `:${u.port}`) + u.pathname + u.search
  } catch {
    return url
  }
}

class Recorder {
  net: NetEvent[] = []
  logs: LogEvent[] = []
  /** Ключ — сам объект Request: единственная надёжная связь запрос↔ответ
   *  (по URL склеивать нельзя — одинаковые адреса летят пачками). */
  private rows = new Map<Request, { row: NetEvent; at: number }>()

  attach(page: Page): void {
    page.on('request', (r) => {
      if (!isApi(r.url())) return
      const row: NetEvent = {
        method: r.method(),
        url: strip(r.url()),
        status: null,
        ms: -1,
        failure: null,
      }
      this.net.push(row)
      this.rows.set(r, { row, at: Date.now() })
    })
    page.on('response', (res) => {
      const entry = this.rows.get(res.request())
      if (entry === undefined) return
      entry.row.status = res.status()
      entry.row.ms = Date.now() - entry.at
    })
    page.on('requestfailed', (r) => {
      const entry = this.rows.get(r)
      if (entry === undefined) return
      entry.row.failure = r.failure()?.errorText ?? 'failed'
      entry.row.ms = Date.now() - entry.at
    })
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return
      this.logs.push({ kind: 'console', text: `${m.type()}: ${m.text()}`.slice(0, 400) })
    })
    page.on('pageerror', (e) => {
      this.logs.push({ kind: 'pageerror', text: String(e.message).slice(0, 400) })
    })
  }

  mark(): { net: number; logs: number } {
    return { net: this.net.length, logs: this.logs.length }
  }

  /**
   * Дожидается ответов по запросам, начатым после `m`. Без этого «без ответа»
   * получал бы КАЖДЫЙ запрос, не уложившийся в SETTLE_MS, — и настоящий висяк
   * (единственная находка, которую нельзя пропустить) утонул бы среди
   * медленных, но живых ручек.
   */
  async drain(m: { net: number }, page: Page, budgetMs = 6000): Promise<void> {
    const deadline = Date.now() + budgetMs
    while (Date.now() < deadline) {
      const pending = this.net
        .slice(m.net)
        .filter((n) => n.status === null && n.failure === null)
      if (pending.length === 0) return
      await page.waitForTimeout(200)
    }
  }

  since(m: { net: number; logs: number }): { net: NetEvent[]; logs: LogEvent[] } {
    return { net: this.net.slice(m.net), logs: this.logs.slice(m.logs) }
  }
}

function fmt(n: NetEvent): string {
  return `${n.method} ${n.url} → ${n.failure ?? n.status ?? 'НЕТ ОТВЕТА'} (${n.ms < 0 ? '—' : `${n.ms}ms`})`
}

// ────────────────────── классификация элементов ──────────────────────
/**
 * Деструктивное — в самую последнюю очередь (требование обхода). Список по
 * ГЛАГОЛУ действия: «Закрыть» сюда не входит (закрытие модалки), «Закрыть
 * мероприятие» — входит.
 */
const DESTRUCTIVE =
  /удал|снят|отзыв|отозв|аннул|очист|сброс|отмен|delete|remove|reset|выйти|выход|logout|закрыть меропри|заверш|расформир|архивир/i

/** Скачивание: клик уводит браузер в загрузку и вешает обход. */
const DOWNLOAD = /скача|выгруз|экспорт|download|печат|\.csv|\.xlsx/i

interface Descriptor {
  index: number
  tag: string
  name: string
  href: string | null
  key: string
}

/**
 * Дескрипторы интерактивных элементов внутри контейнера. `index` — позиция в
 * списке `container.querySelectorAll(INTERACTIVE)`, и ровно тем же списком
 * адресует клик (`page.locator(container).locator(INTERACTIVE).nth(index)`):
 * два разных списка дали бы клик мимо цели.
 */
async function collect(page: Page, container: string): Promise<Descriptor[]> {
  return page.evaluate(
    ([sel, cont]) => {
      const root = document.querySelector(cont) ?? document.body
      return [...root.querySelectorAll(sel)]
        .map((node, index) => ({ el: node as HTMLElement, index }))
        .filter(({ el }) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
        })
        .map(({ el, index }) => {
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80)
          const href = el.getAttribute('href')
          return {
            index,
            tag: el.tagName.toLowerCase(),
            name: name === '' ? '(без подписи)' : name,
            href,
            key: `${el.tagName.toLowerCase()}|${name}|${href ?? ''}`,
          }
        })
    },
    [INTERACTIVE, container] as const,
  )
}

const SIGNATURE_JS = () =>
  `${location.pathname}${location.search}|${document.body.innerText.length}|${document.querySelectorAll('*').length}|${document.querySelectorAll('[role="dialog"],[aria-modal="true"]').length}`

/**
 * Сигнатура экрана — по ней судим «клик что-то поменял».
 *
 * 🔴 Клик, уводящий на другой маршрут, сносит контекст исполнения ПРЯМО в
 * момент замера: `page.evaluate` падает с «Execution context was destroyed».
 * Это не дефект портала, а гонка самого обхода — и она роняла ВЕСЬ прогон
 * (`115 did not run` на `/security-ops/duties/combat` 17.08). Ждём, пока
 * навигация уляжется, и снимаем сигнатуру уже нового экрана: она заведомо
 * отличается от прежней, то есть вердикт честно станет «навигация».
 */
async function signature(page: Page): Promise<string> {
  try {
    return await page.evaluate(SIGNATURE_JS)
  } catch (e) {
    if (!/Execution context was destroyed|navigating and changing/i.test(String(e))) throw e
    await page.waitForLoadState('domcontentloaded').catch(() => {})
    return page.evaluate(SIGNATURE_JS)
  }
}

// ────────────────────────── находки ──────────────────────────
interface Finding {
  page: string
  element: string
  action: string
  api: string
  status: string
  verdict: string
  details: string
}

function netApi(net: NetEvent[]): string {
  return net.map((n) => `${n.method} ${n.url}`).join('; ') || '—'
}

function netStatus(net: NetEvent[]): string {
  return net.map((n) => String(n.failure ?? n.status ?? 'НЕТ ОТВЕТА')).join('; ') || '—'
}

function verdictOf(
  net: NetEvent[],
  logs: LogEvent[],
  changed: boolean,
  navigated: boolean,
): { verdict: string; details: string } {
  const failed = net.filter((n) => n.failure !== null)
  const pending = net.filter((n) => n.status === null && n.failure === null)
  const server = net.filter((n) => n.status !== null && n.status >= 500)
  const client = net.filter((n) => n.status !== null && n.status >= 400 && n.status < 500)
  const errors = logs.filter((l) => l.kind === 'pageerror')

  if (server.length > 0) return { verdict: '🔴 5xx', details: server.map(fmt).join('; ') }
  if (failed.length > 0) return { verdict: '🔴 requestfailed', details: failed.map(fmt).join('; ') }
  if (pending.length > 0) return { verdict: '🔴 без ответа', details: pending.map(fmt).join('; ') }
  if (errors.length > 0)
    return { verdict: '🔴 pageerror', details: errors.map((e) => e.text).join('; ') }
  if (client.length > 0) return { verdict: '🟡 4xx', details: client.map(fmt).join('; ') }
  if (net.length > 0) return { verdict: '✅ запрос ушёл', details: '' }
  if (navigated) return { verdict: '✅ навигация', details: '' }
  if (changed) return { verdict: '✅ UI-реакция', details: '' }
  return { verdict: '⚪ без реакции', details: 'ни запроса, ни навигации, ни изменения DOM' }
}

// ────────────────────────── обход ──────────────────────────
interface SweepCtx {
  page: Page
  rec: Recorder
  url: string
  label: string
  findings: Finding[]
  /** Момент, после которого обход этой страницы обрывается штатно. */
  deadline: number
}

function outOfBudget(ctx: SweepCtx): boolean {
  return Date.now() > ctx.deadline
}

/**
 * `trailingSlash: true` — Next отвечает 308 на путь без слэша. Сравнивать
 * «где мы» с «куда шли» без нормализации нельзя: /dashboard vs /dashboard/
 * читалось бы как уход со страницы, и обход перезагружал бы её перед КАЖДЫМ
 * кликом — часовой прогон вместо минутного и ни одной модалки в отчёте.
 */
function norm(p: string): string {
  const [pathname, search = ''] = p.split('?')
  const trimmed = pathname.replace(/\/+$/, '')
  return (trimmed === '' ? '/' : trimmed) + (search === '' ? '' : `?${search}`)
}

/** Ждёт стенд, если он перезапускается прямо сейчас (полный прогон 26.08.2026).
 *
 * Обход длиннее часа; за это время `next dev` упирается в потолок памяти, и
 * сторож перезапускает его НЕ ДОЖИДАЯСЬ затишья — по жёсткому потолку. Замер
 * того же дня: за один обход это случилось четырежды, последний раз на
 * 4008 МБ. Проба, попавшая в окно перезапуска, получает
 * `ERR_CONNECTION_REFUSED` — это факт о стенде, а не находка о портале, и
 * падать на нём значит красить прогон по чужой причине.
 *
 * Повтора самой пробы (`retries`) мало: перезапуск занимает секунды, а повтор
 * идёт сразу. Поэтому ЖДЁМ подъёма и повторяем переход — но не бесконечно:
 * стенд, не поднявшийся за минуту, это уже находка.
 */
async function gotoWaitingForStand(page: Page, url: string): Promise<void> {
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      return
    } catch (error) {
      const text = String(error)
      const restarting =
        text.includes('ERR_CONNECTION_REFUSED') || text.includes('ECONNREFUSED')
      if (!restarting || Date.now() > deadline) throw error
      console.log(`[обход] стенд перезапускается — жду и повторяю: ${url}`)
      await page.waitForTimeout(3_000)
    }
  }
}

async function open(page: Page, url: string): Promise<void> {
  await gotoWaitingForStand(page, url)
  // networkidle недостижим при поллинге/сокете — таймаут здесь не отказ.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
  await page.waitForTimeout(300)
}

async function openAndDrain(page: Page, rec: Recorder, url: string): Promise<void> {
  await open(page, url)
  await rec.drain({ net: 0 }, page)
}

function currentPath(page: Page): string {
  const u = new URL(page.url())
  return norm(u.pathname + u.search)
}

/**
 * Один клик с записью: возвращает готовую строку отчёта. Общая для страницы,
 * каркаса и модалки — три копии этой логики разъехались бы на первой правке.
 */
async function clickAndJudge(
  ctx: SweepCtx,
  container: string,
  d: Descriptor,
  label: string,
  /** Внутри модалки перезагрузка запрещена: она снесла бы саму модалку. */
  allowReload = true,
): Promise<Finding | null> {
  const target = (): ReturnType<Page['locator']> =>
    ctx.page.locator(container).first().locator(INTERACTIVE).nth(d.index)
  const before = await signature(ctx.page)
  const urlBefore = ctx.page.url()
  const mark = ctx.rec.mark()
  let clicked = await target()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false)
  if (!clicked && allowReload) {
    // Вторая попытка С ЧИСТОГО ЛИСТА. «Не кликается» почти всегда означает
    // наследство предыдущего клика (оставшийся оверлей, всплывашка, съехавший
    // скролл), а не дефект самой кнопки — первый прогон обхода SPA записал так
    // четыре живые строки реестра ОМ. Обвинение элемента должно переживать
    // перезагрузку страницы, иначе это обвинение обхода.
    await open(ctx.page, ctx.url)
    clicked = await target()
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false)
  }
  if (!clicked) {
    return {
      page: ctx.label,
      element: label,
      action: 'клик',
      api: '—',
      status: '—',
      verdict: '⚠️ не кликается',
      details: 'перекрыт / disabled / вне вьюпорта — и после перезагрузки страницы тоже',
    }
  }
  await ctx.page.waitForTimeout(SETTLE_MS)
  await ctx.rec.drain(mark, ctx.page)
  const { net, logs } = ctx.rec.since(mark)
  const after = await signature(ctx.page)
  const v = verdictOf(net, logs, before !== after, ctx.page.url() !== urlBefore)
  return {
    page: ctx.label,
    element: label,
    action: d.tag === 'a' ? `ссылка → ${d.href ?? ''}` : 'клик',
    api: netApi(net),
    status: netStatus(net),
    verdict: v.verdict,
    details: v.details,
  }
}

/**
 * Модалка: инвентаризуем кнопки внутри и кликаем безопасные. Каждый клик может
 * закрыть диалог — тогда переоткрываем его тем же опенером, иначе вторая и
 * последующие кнопки не проверялись бы вовсе (вакуумный обход: «все кнопки
 * модалки нажаты» при одной реально нажатой).
 */
async function sweepDialog(ctx: SweepCtx, reopen: () => Promise<void>): Promise<void> {
  const DIALOG = MODAL
  const inner = (await collect(ctx.page, DIALOG)).filter(
    (d) => !DESTRUCTIVE.test(d.name) && !DOWNLOAD.test(d.name),
  )
  for (let i = 0; i < Math.min(inner.length, 8); i += 1) {
    // Бюджет страницы общий: модалка — самая дорогая её часть, и обрывать
    // обход только на внешнем цикле значило бы проскочить лимит теста внутри.
    if (outOfBudget(ctx)) break
    if ((await ctx.page.locator(DIALOG).count()) === 0) {
      await reopen()
      if ((await ctx.page.locator(DIALOG).count()) === 0) return
    }
    const fresh = await collect(ctx.page, DIALOG)
    const match = fresh.find((f) => f.key === inner[i].key)
    if (match === undefined) continue
    const row = await clickAndJudge(ctx, DIALOG, match, `модалка → ${match.name}`, false)
    if (row !== null) ctx.findings.push(row)
    // Раскрытый список/календарь снимаем ДО следующего элемента: иначе он
    // перекроет весь остаток модалки (см. POPUP).
    await dismissPopup(ctx.page)
  }
  await ctx.page.keyboard.press('Escape').catch(() => undefined)
}

function pageVerdict(
  rec: Recorder,
  gated: boolean,
  landed: string,
  requested: string,
): { verdict: string; details: string } {
  // «Выкинуло на /» — только если ПРОСИЛИ не «/». Иначе сама страница входа
  // отчитывалась бы как отказ авторизации (первый прогон обхода SPA так и
  // сделал). Корень здесь — экран входа: middleware.ts отбивает на него
  // неаутентифицированных.
  if (landed === '/' && norm(requested) !== '/') {
    return { verdict: '🔴 выкинуло на / (вход)', details: 'сессия не принята — middleware отбил' }
  }
  if (gated) return { verdict: '🔒 гвард закрыл', details: 'недостаточно прав' }
  return verdictOf(rec.net, rec.logs, false, false)
}

async function sweepPage(ctx: SweepCtx, chromeless: boolean): Promise<void> {
  await openAndDrain(ctx.page, ctx.rec, ctx.url)

  // Гвард страницы (нет прав) — обходить нечего, но это ФАКТ, а не пропуск:
  // под персоной без права экран ОБЯЗАН быть закрыт. Формулировки — из
  // страниц раздела ОМ (`app/security-ops/*/page.tsx`).
  const body = await ctx.page.locator('body').innerText()
  const gated = /Недостаточно прав|Нет прав на просмотр|Доступ запрещ/.test(body)
  const v = pageVerdict(ctx.rec, gated, currentPath(ctx.page).split('?')[0], ctx.url)
  ctx.findings.push({
    page: ctx.label,
    element: '(загрузка страницы)',
    action: 'goto',
    api: netApi(ctx.rec.net),
    status: netStatus(ctx.rec.net),
    verdict: v.verdict,
    details: v.details,
  })
  if (gated) return

  // <main> — контейнер контента в DashboardLayout. Его отсутствие означает,
  // что каркас не отрисовался (страница входа, редирект, падение) — тогда
  // обходим всё тело, но НЕ молчим об этом.
  const hasMain = (await ctx.page.locator('main').count()) > 0
  const container = chromeless || !hasMain ? 'body' : 'main'

  const all = await collect(ctx.page, container)
  const safe = all.filter((d) => !DESTRUCTIVE.test(d.name) && !DOWNLOAD.test(d.name))
  const deferred = all.filter((d) => DESTRUCTIVE.test(d.name) || DOWNLOAD.test(d.name))

  if (safe.length > MAX_ELEMENTS) {
    ctx.findings.push({
      page: ctx.label,
      element: '(потолок обхода)',
      action: '—',
      api: '—',
      status: '—',
      verdict: '⚠️ обход усечён',
      details: `безопасных элементов ${safe.length}, пройдено ${MAX_ELEMENTS} — остальные НЕ проверены`,
    })
  }
  for (const d of deferred) {
    ctx.findings.push({
      page: ctx.label,
      element: d.name,
      action: 'отложен',
      api: '—',
      status: '—',
      verdict: '⏭ не нажат',
      details: DESTRUCTIVE.test(d.name) ? 'деструктивное действие' : 'скачивание файла',
    })
  }

  const ceiling = Math.min(safe.length, MAX_ELEMENTS)
  for (let i = 0; i < ceiling; i += 1) {
    if (outOfBudget(ctx)) {
      ctx.findings.push({
        page: ctx.label,
        element: '(бюджет времени)',
        action: '—',
        api: '—',
        status: '—',
        verdict: '⚠️ обход усечён',
        details:
          `бюджет ${Math.round(PAGE_BUDGET_MS / 1000)} с исчерпан, ` +
          `пройдено ${i} из ${ceiling} — остальные НЕ проверены`,
      })
      break
    }
    const d = safe[i]
    // Перед каждым кликом — исходная страница (требование обхода: после
    // навигации возвращаемся). Элемент ищется по КЛЮЧУ, не по индексу:
    // асинхронная догрузка сдвигает DOM между заходами.
    if (currentPath(ctx.page) !== norm(ctx.url)) await open(ctx.page, ctx.url)
    let fresh = await collect(ctx.page, container)
    let match = fresh.find((f) => f.key === d.key)
    if (match === undefined) {
      // Второй заход С ЧИСТОГО ЛИСТА — тот же довод, что и для «не кликается»:
      // элемент чаще всего унесён ПРЕДЫДУЩИМ кликом обхода, а не пропал сам.
      // На `/employees` переключатель «Карточки» прячет таблицу целиком, и
      // тридцать одна строка отчиталась «элемент исчез», хотя все они на месте
      // в исходном виде страницы. После перезагрузки такой заход дешёвый:
      // вид сбрасывается, и остальные элементы находятся сразу.
      await open(ctx.page, ctx.url)
      fresh = await collect(ctx.page, container)
      match = fresh.find((f) => f.key === d.key)
    }
    if (match === undefined) {
      ctx.findings.push({
        page: ctx.label,
        element: d.name,
        action: 'клик',
        api: '—',
        status: '—',
        verdict: '⚠️ элемент исчез',
        details: 'до клика не дожил — и после перезагрузки страницы тоже',
      })
      continue
    }
    const row = await clickAndJudge(ctx, container, match, d.name)
    if (row !== null) ctx.findings.push(row)

    if ((await ctx.page.locator(MODAL).count()) > 0) {
      await sweepDialog(ctx, async () => {
        await ctx.page
          .locator(container)
          .first()
          .locator(INTERACTIVE)
          .nth(match.index)
          .click({ timeout: 4000 })
          .catch(() => undefined)
        await ctx.page.waitForTimeout(SETTLE_MS)
      })
    }
    // Меню строки или раскрытый список, оставшийся от клика, перекрыл бы
    // следующие элементы страницы — и они отчитались бы «не кликается».
    await dismissPopup(ctx.page)
  }
}

// ─────────────────────── резолвер id со стенда ───────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any -- ответы стенда читаются
   вслепую: смоук не обязан знать форму каждого реестра, ему нужен первый id. */
async function resolveIds(token: string): Promise<Record<string, string>> {
  const headers = { Authorization: `Bearer ${token}` }
  const get = async (p: string): Promise<any> => {
    const res = await fetch(`${API_ORIGIN}${p}`, { headers })
    if (!res.ok) return null
    return res.json().catch(() => null)
  }
  const ids: Record<string, string> = {}
  const put = (k: string, v: unknown): void => {
    if (typeof v === 'string' && v !== '') ids[k] = v
    else if (typeof v === 'number') ids[k] = String(v)
  }

  put('eventId', (await get('/api/ops/security-events/'))?.results?.[0]?.id)
  const objects = await get('/api/ops/objects/')
  put('objectId', objects?.results?.[0]?.id)
  if (ids.objectId !== undefined) {
    const detail = await get(`/api/ops/objects/${ids.objectId}/`)
    put('passportVersionId', detail?.passportVersions?.[0]?.id)
  }
  put('ratingEmployeeId', (await get('/api/ops/evaluation-registry/'))?.results?.[0]?.employeeId)
  put('employeeId', (await get('/api/core/employees/?page_size=1'))?.results?.[0]?.id)
  put('reportJobId', (await get('/api/ops/service-report-jobs/'))?.results?.[0]?.reportJobId)
  put('dictionaryCode', (await get('/api/ops/dictionaries/'))?.results?.[0]?.code)
  // КОНСТАНТА, а не выборка из API, и это не срез угла: набор видов справочника
  // штата закрыт и живёт в КОДЕ (`STAFF_DICTIONARIES` — positions и ranks), а
  // не в базе. Спрашивать его у сервера значило бы делать вид, что он может
  // прийти оттуда, и молча потерять маршрут в день, когда ручка ответит пусто.
  put('staffDictionaryKind', 'positions')
  put('feedbackId', (await get('/api/ops/feedback-requests/'))?.results?.[0]?.feedbackId)
  return ids
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Токен нужен РЕЗОЛВЕРУ, не входу в UI: id мы берём напрямую с Django. */
async function apiToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${API_ORIGIN}/api/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error(`login ${username}: HTTP ${res.status}`)
  const body = (await res.json()) as { access?: string }
  if (typeof body.access !== 'string') throw new Error(`login ${username}: нет access`)
  return body.access
}

/**
 * Файл с сохранённой сессией персоны. Лежит ПОДКАТАЛОГОМ в `smoke-results/`:
 * каталог уже в .gitignore (снимок конкретного стенда), а сборщик отчёта
 * (`scripts/smoke-report.mjs`) читает только `*.json` ВЕРХНЕГО уровня — вложенный
 * `.auth/` в отчёт не попадёт.
 */
function statePath(persona: Persona): string {
  return path.join(OUT_DIR, '.auth', `${persona.key}.json`)
}

/**
 * Вход в UI — NextAuth-сессия в cookie. Идём тем же путём, что и форма входа
 * (`signIn('credentials')`): csrf → callback.
 *
 * 🔴 ОДИН РАЗ НА ПЕРСОНУ, а не на каждый маршрут. Раньше вход висел в
 * `beforeEach` и стоил трёх запросов к `/api/auth/*` перед каждым из ~46 тестов
 * персоны. Прогон 19.08.2026 показал цену: ВСЕ ТРИ падения обхода случились
 * ровно здесь — у разных персон, на разных маршрутах, с разными подписями
 * (`read ECONNRESET`, `TimeoutError 10000ms`), и каждое при повторе зеленело.
 * Падал не экран, а вход; а так как describe персоны идёт `mode: 'serial'`,
 * одно такое падение снимало ВЕСЬ её хвост — 52 проверки из прогона.
 *
 * Сессия переиспользуется через `storageState`: контекст у каждого теста
 * по-прежнему СВОЙ (изоляция персон и «выхода из системы» не тронута), но
 * поднимается уже с куками, а не логинится заново. Django выдаёт access на 8
 * часов (SIMPLE_JWT, base.py) — на прогон в десятки минут одного входа хватает
 * с запасом.
 *
 * Слэши в адресах обязательны: `trailingSlash: true` отвечает 308 на путь без
 * него, а 308 на POST сохраняет метод, но обход всё равно упёрся бы в лишний
 * редирект.
 */
async function signInPersona(persona: Persona): Promise<void> {
  // 🔴 `storageState: undefined` — не украшение. `request.newContext()` из
  // `@playwright/test` подмешивает `use`-опции текущей области
  // (`playwright._defaultContextOptions`), а там лежит НАШ ЖЕ `storageState` с
  // путём к файлу, которого ещё нет: первый прогон падал с ENOENT прямо здесь,
  // в том самом вызове, который этот файл и создаёт. Явное `undefined`
  // перебивает унаследованное (опции склеиваются спредом) и рвёт круг.
  const api = await apiRequest.newContext({ baseURL: APP_ORIGIN, storageState: undefined })
  try {
    const csrfRes = await api.get('/api/auth/csrf/')
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
    const res = await api.post('/api/auth/callback/credentials/', {
      form: {
        csrfToken,
        username: persona.username,
        password: persona.password,
        json: 'true',
        redirect: 'false',
      },
    })
    if (!res.ok()) throw new Error(`signIn ${persona.key}: HTTP ${res.status()}`)
    // Сессия ДОЛЖНА появиться: без неё весь обход прошёл бы анонимом и отчитался
    // сорока строками «выкинуло на /» — сорок ложных дефектов вместо одного
    // честного «вход не работает».
    const session = await (await api.get('/api/auth/session/')).json()
    if (session?.user?.name === undefined) {
      throw new Error(`signIn ${persona.key}: сессия пуста — ${JSON.stringify(session)}`)
    }
    fs.mkdirSync(path.dirname(statePath(persona)), { recursive: true })
    const state = await api.storageState({ path: statePath(persona) })
    // Живая сессия в API-контексте ещё не значит, что в файл легла КУКА, а без
    // куки контексты тестов поднялись бы анонимами — и мы вернулись бы к сорока
    // ложным «выкинуло на /» вместо одного честного отказа. Проверяем ровно то,
    // что дальше раздаётся браузеру.
    //
    // 🔴 Хвост `.0`/`.1` обязателен в шаблоне: у `admin` сессионный JWT не лезет
    // в 4 КБ (в токене едет весь `userData` с ролью и её скоупом), и NextAuth
    // режет куку на куски `next-auth.session-token.0/.1`. Точное имя без
    // суффикса ловило только мелкие сессии — observer проходил, admin падал.
    if (!state.cookies.some((c) => /next-auth\.session-token(\.\d+)?$/.test(c.name))) {
      throw new Error(
        `signIn ${persona.key}: в состоянии нет куки сессии — ${state.cookies
          .map((c) => c.name)
          .join(', ')}`,
      )
    }
  } finally {
    await api.dispose()
  }
}

/**
 * Имя файла из метки страницы. Кириллицу НЕ выбрасываем: `[^a-zA-Z0-9]+`
 * схлопывал «(выход)» и «(каркас)» в пустую строку → оба уезжали в `root.json`
 * и затирали отчёт по «/». Молчаливая потеря целой страницы обхода.
 */
function slug(s: string): string {
  return s.replace(/[/\\?%*:|"<>\s]+/g, '_').replace(/^_|_$/g, '') || 'root'
}

function dump(persona: Persona, label: string, findings: Finding[]): void {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(OUT_DIR, `${persona.key}__${slug(label)}.json`),
    JSON.stringify({ persona: persona.key, role: persona.role, page: label, findings }, null, 2),
    'utf8',
  )
}

// ─────────────────────────── тесты ───────────────────────────
test.describe('смоук-обход портала', () => {
  test.skip(!LIVE, 'нужен живой стек — SMOKE_LIVE=1 + Django :8100 + Next :3106')
  test.describe.configure({ mode: 'serial' })

  // Сверка «карта маршрутов покрыта обходом» ПЕРЕЕХАЛА в
  // `route-map-coverage.spec.ts` (Plane №319). Она стояла здесь, вне персон, и
  // потому не попадала ни в один блок `-g "persona ..."` — а обход гоняется
  // только блоками. Её не запускали ни разу за полный прогон, и всё это время
  // она была красной.
  //
  // Ей и не место в обходе: она никуда не ходит и живого стенда не требует —
  // сверяет список `ROUTES` со списком `app/**/page.tsx`. Это вопрос «код себе
  // не противоречит», а не «портал работает».

  for (const persona of PERSONAS) {
    test.describe(`persona ${persona.key}`, () => {
      let ids: Record<string, string> = {}

      // Состояние своё на КАЖДУЮ персону: контексты соседних describe его не
      // видят, поэтому переиспользование сессии не смешивает права.
      // `storageState` читается при создании контекста теста, то есть уже ПОСЛЕ
      // beforeAll, который этот файл и пишет.
      test.use({ storageState: statePath(persona) })

      test.beforeAll(async () => {
        await signInPersona(persona)
        ids = await resolveIds(await apiToken(persona.username, persona.password))
      })

      for (const route of ROUTES) {
        test(`${persona.key} ${route.template}`, async ({ page }) => {
          test.setTimeout(TEST_TIMEOUT_MS)
          const unresolved = (route.needs ?? []).filter((k) => ids[k] === undefined)
          if (unresolved.length > 0) {
            dump(persona, route.template, [
              {
                page: route.template,
                element: '(маршрут)',
                action: '—',
                api: '—',
                status: '—',
                verdict: '⚠️ не пройден',
                details: `на стенде нет данных для ${unresolved.join(', ')}`,
              },
            ])
            return
          }
          const url = route.template.replace(/\{([^}]+)\}/g, (_, k: string) =>
            encodeURIComponent(ids[k]),
          )
          const rec = new Recorder()
          rec.attach(page)
          const ctx: SweepCtx = {
            page,
            rec,
            url,
            label: route.template,
            findings: [],
            deadline: Date.now() + PAGE_BUDGET_MS,
          }
          await sweepPage(ctx, route.chromeless === true)
          dump(persona, route.template, ctx.findings)
        })
      }

      // Каркас (сайдбар + шапка) — ОДИН раз, а не на каждой странице: он
      // одинаков везде, и обход по нему на 40 страницах дал бы сотни строк об
      // одних и тех же ссылках. Стартуем с /dashboard, а не с «/»: корень —
      // экран входа, каркаса на нём нет.
      for (const chrome of ['aside', 'header'] as const) {
        test(`${persona.key} каркас: ${chrome}`, async ({ page }) => {
          test.setTimeout(TEST_TIMEOUT_MS)
          const rec = new Recorder()
          rec.attach(page)
          const HOME = '/dashboard'
          const ctx: SweepCtx = {
            page,
            rec,
            url: HOME,
            label: `(каркас ${chrome})`,
            findings: [],
            deadline: Date.now() + PAGE_BUDGET_MS,
          }
          await open(page, HOME)
          if ((await page.locator(chrome).count()) === 0) {
            dump(persona, `(каркас ${chrome})`, [
              {
                page: ctx.label,
                element: `(${chrome})`,
                action: '—',
                api: '—',
                status: '—',
                verdict: '⚠️ каркаса нет',
                details: `${HOME} отрендерился без DashboardLayout (или отбит на вход)`,
              },
            ])
            return
          }
          const items = (await collect(page, chrome)).filter((d) => !DESTRUCTIVE.test(d.name))
          for (const d of items) {
            if (currentPath(page) !== norm(HOME)) await open(page, HOME)
            const match = (await collect(page, chrome)).find((f) => f.key === d.key)
            if (match === undefined) continue
            const row = await clickAndJudge(ctx, chrome, match, d.name)
            if (row !== null) ctx.findings.push(row)
            if ((await page.locator(MODAL).count()) > 0) {
              await sweepDialog(ctx, async () => {
                await page
                  .locator(chrome)
                  .first()
                  .locator(INTERACTIVE)
                  .nth(match.index)
                  .click({ timeout: 4000 })
                  .catch(() => undefined)
              })
            }
          }
          dump(persona, `(каркас ${chrome})`, ctx.findings)
        })
      }

      // САМЫМ ПОСЛЕДНИМ (serial держит порядок объявления): выход рвёт сессию —
      // всё, что после него, шло бы на экран входа.
      test(`${persona.key} выход из системы`, async ({ page }) => {
        const rec = new Recorder()
        rec.attach(page)
        await open(page, '/dashboard')
        // Выход спрятан в меню пользователя (header.tsx: DropdownMenu), а его
        // содержимое Radix рендерит В ПОРТАЛЕ — вне <header>. Обход SPA на этом
        // споткнулся: искал кнопку внутри каркаса и отчитался «кнопки выхода
        // нет». Сначала открываем меню (триггер — аватар, последняя кнопка
        // шапки: подписи у него нет), потом ищем пункт от КОРНЯ страницы.
        await page
          .locator('header button')
          .last()
          .click({ timeout: 5000 })
          .catch(() => undefined)
        await page.waitForTimeout(400)
        const logout = page.getByRole('menuitem', { name: /выйти|выход|logout/i })
        const findings: Finding[] = []
        if ((await logout.count()) === 0) {
          findings.push({
            page: '(каркас)',
            element: 'выход',
            action: '—',
            api: '—',
            status: '—',
            verdict: '⚠️ не найден',
            details: 'ни меню пользователя в шапке, ни пункта «Выйти» в нём',
          })
        } else {
          const mark = rec.mark()
          await logout.first().click()
          await page.waitForTimeout(SETTLE_MS)
          const { net, logs } = rec.since(mark)
          // ПОЛНЫЙ адрес, а не путь: выход уводил на `http://localhost:3000/`
          // (пустой порт — NextAuth резолвил относительный callbackUrl от
          // NEXTAUTH_URL), и проверка по одному `pathname` видела там «/» —
          // вердикт был «✅ увело на экран входа» поверх мёртвой страницы.
          const landedUrl = new URL(page.url())
          const sameOrigin = landedUrl.origin === new URL(APP_ORIGIN).origin
          const landed = `${sameOrigin ? '' : landedUrl.origin}${currentPath(page).split('?')[0]}`
          findings.push({
            page: '(каркас)',
            element: 'выход',
            action: 'клик',
            api: netApi(net),
            status: netStatus(net),
            verdict:
              landed === '/'
                ? '✅ увело на экран входа'
                : sameOrigin
                  ? '🔴 остались на месте'
                  : '🔴 увело на ЧУЖОЙ origin',
            details: `приземлились на ${landed}; ${logs.map((l) => l.text).join('; ')}`,
          })
        }
        dump(persona, '(выход)', findings)
      })
    })
  }
})
