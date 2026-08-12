/**
 * Смоук-обход портала: все маршруты × все интерактивные элементы, с записью
 * трафика фронт↔бэк. Диагностический инструмент, а НЕ регрессионный тест —
 * он ничего не чинит и почти ничего не заваливает: находки копятся в
 * `smoke-results/*.json`, отчёт собирает `scripts/smoke-report.mjs`.
 *
 * 🔴 Живёт в `e2e/`, но в офлайн-контур `npm run test:e2e` НЕ входит: без
 * `SMOKE_LIVE=1` весь describe скипается. Причина — `playwright.config.ts`
 * умышленно backend-free (стори 8.8 Д4), а этой спеке нужен ЖИВОЙ стек:
 *   Django  :8100  (Personnel-Records — единственный бэк, где смонтированы
 *                   `/api/ops/*`; в Backend/VAPS их в config/urls.py нет)
 *   vite    :5180  (`npx vite --mode live`, прокси /api → :8100)
 * Запуск: `SMOKE_LIVE=1 npx playwright test --config playwright.smoke.config.ts`
 *
 * Вход — JWT: страница /login кладёт credential в sessionStorage, тот же ключ
 * сеется здесь через addInitScript. Токен берётся живым POST /api/token/, а не
 * хардкодом, — иначе смена пароля на стенде читается как «всё сломалось».
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Request } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const API_ORIGIN = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
/**
 * 🔴 НЕ под `test-results/`: Playwright сносит свой outputDir перед КАЖДЫМ
 * прогоном. Отчёт по одной персоне, лежавший там, стирался стартом обхода по
 * следующей — и «отчёт пустой» выглядело как «обход ничего не нашёл».
 */
const OUT_DIR = fileURLToPath(new URL('../smoke-results', import.meta.url))
const SRC_ROUTES = fileURLToPath(new URL('../src/shared/routes.ts', import.meta.url))

/** Селектор «интерактивного». Один на весь файл: индексы дескрипторов и
 *  локаторов обязаны считаться по ОДНОМУ И ТОМУ ЖЕ списку. */
const INTERACTIVE =
  'button, [role="button"], a[href], input[type="submit"], [role="tab"], [role="switch"], summary'

/** Пауза после клика: столько ждём запрос/перерисовку, прежде чем судить. */
const SETTLE_MS = Number(process.env.SMOKE_SETTLE ?? 1200)
/** Потолок элементов на страницу. Отсечённое ПЕЧАТАЕТСЯ в отчёт (не молча). */
const MAX_ELEMENTS = Number(process.env.SMOKE_MAX_ELEMENTS ?? 60)

/**
 * Модалка/шторка. `[aria-modal]` — не украшение: первый прогон поймал, что
 * форма «Создать ОМ» не несёт `role="dialog"`, обход её не распознал, Escape не
 * нажал — и следующие ЧЕТЫРЕ элемента страницы отчитались «не кликается»,
 * потому что их перекрывал незакрытый оверлей. Ложное обвинение кнопок.
 */
const MODAL = '[role="dialog"], [aria-modal="true"]'

// ─────────────────────────── персоны ───────────────────────────
// Учётки стенда (сид RBAC + scripts/create_users.py). Пароли стендовые,
// секретами не являются: контур локальный.
interface Persona {
  key: string
  username: string
  password: string
  role: string
}

const ALL_PERSONAS: readonly Persona[] = [
  { key: 'admin', username: 'admin', password: 'admin123', role: 'ADMIN → `*`' },
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

// ─────────────────────────── маршруты ───────────────────────────
// Параметрические сегменты подставляет РЕЗОЛВЕР из живого API (`{key}`), а не
// константа: id стенда живут в БД и меняются с пересидом.
interface RouteSpec {
  template: string
  needs?: readonly string[]
  /** Маршрут вне AppLayout (печать/логин) — скоуп обхода = вся страница. */
  chromeless?: boolean
}

const ROUTES: readonly RouteSpec[] = [
  { template: '/' },
  { template: '/command-center' },
  { template: '/security-events' },
  { template: '/security-events/{eventId}', needs: ['eventId'] },
  { template: '/security-events/{closedEventId}/archive', needs: ['closedEventId'] },
  { template: '/employees' },
  { template: '/employees/{employeeId}', needs: ['employeeId'] },
  { template: '/objects' },
  { template: '/objects/{objectId}', needs: ['objectId'] },
  {
    template: '/objects/{objectId}/passports/{passportVersionId}',
    needs: ['objectId', 'passportVersionId'],
  },
  { template: '/duties' },
  { template: '/duties/{dutyShiftId}', needs: ['dutyShiftId'] },
  { template: '/daily-expense' },
  { template: '/organization' },
  { template: '/reports' },
  { template: '/analytics' },
  { template: '/analytics/operations' },
  { template: '/ratings' },
  { template: '/ratings/workspace' },
  { template: '/ratings/evaluations' },
  { template: '/ratings/employees/{ratingEmployeeId}', needs: ['ratingEmployeeId'] },
  { template: '/ratings/audit' },
  { template: '/ratings/export' },
  { template: '/ratings/analytics' },
  { template: '/service-reports' },
  { template: '/service-reports/history' },
  { template: '/service-reports/{reportJobId}', needs: ['reportJobId'] },
  { template: '/audit' },
  { template: '/dictionaries' },
  { template: '/dictionaries/{dictionaryCode}', needs: ['dictionaryCode'] },
  { template: '/calendar' },
  { template: '/feedback' },
  { template: '/feedback/{feedbackId}', needs: ['feedbackId'] },
  { template: '/settings' },
  { template: '/changelog' },
  { template: '/print/test', chromeless: true },
  {
    template: '/print/expense?division_id={divisionId}&business_date={businessDate}',
    needs: ['divisionId', 'businessDate'],
    chromeless: true,
  },
  {
    template: '/print/placement?security_event_id={eventId}',
    needs: ['eventId'],
    chromeless: true,
  },
  { template: '/login', chromeless: true },
]

/**
 * Дрейф карты маршрутов ловится ЗДЕСЬ, а не тишиной: новый путь в
 * `shared/routes.ts`, не внесённый в список выше, красит отдельный тест. Без
 * этой сверки обход молча переставал бы покрывать свежие разделы — ровно тот
 * отказ, который смоук обязан ловить.
 */
function declaredPortalRoutes(): string[] {
  const source = fs.readFileSync(SRC_ROUTES, 'utf8')
  return [...source.matchAll(/^ {2}[a-zA-Z]+:\s*'(\/[^']*)'/gm)].map((m) => m[1])
}

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
 * Только API-трафик: бандл, HMR и статика к связи фронт↔бэк отношения не имеют.
 * Проверка по НАЧАЛУ пути, а не по вхождению `/api/`: dev-сервер отдаёт модули
 * адресами вида `/src/features/objects/api/queries.ts` — подстрочный матч
 * записывал бы их в API-трафик и топил настоящие запросы в шуме.
 */
function isApi(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith('/api/')
  } catch {
    return false
  }
}

function strip(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname + u.search
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

/** Сигнатура экрана — по ней судим «клик что-то поменял». */
async function signature(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      `${location.pathname}${location.search}|${document.body.innerText.length}|${document.querySelectorAll('*').length}|${document.querySelectorAll('[role="dialog"],[aria-modal="true"]').length}`,
  )
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
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
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
  return u.pathname + u.search
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
    // скролл), а не дефект самой кнопки — первый прогон записал так четыре
    // живые строки реестра ОМ. Обвинение элемента должно переживать
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
    if ((await ctx.page.locator(DIALOG).count()) === 0) {
      await reopen()
      if ((await ctx.page.locator(DIALOG).count()) === 0) return
    }
    const fresh = await collect(ctx.page, DIALOG)
    const match = fresh.find((f) => f.key === inner[i].key)
    if (match === undefined) continue
    const row = await clickAndJudge(ctx, DIALOG, match, `модалка → ${match.name}`, false)
    if (row !== null) ctx.findings.push(row)
  }
  await ctx.page.keyboard.press('Escape').catch(() => undefined)
}

function pageVerdict(
  rec: Recorder,
  gated: boolean,
  landed: string,
  requested: string,
): { verdict: string; details: string } {
  // «Выкинуло на /login» — только если ПРОСИЛИ не /login. Иначе сама страница
  // входа отчитывалась бы как отказ авторизации (первый прогон так и сделал).
  if (landed === '/login' && !requested.startsWith('/login')) {
    return { verdict: '🔴 выкинуло на /login', details: 'credential не принят' }
  }
  if (gated) return { verdict: '🔒 гвард закрыл', details: 'Доступ запрещён / права не проверены' }
  return verdictOf(rec.net, rec.logs, false, false)
}

async function sweepPage(ctx: SweepCtx, chromeless: boolean): Promise<void> {
  await openAndDrain(ctx.page, ctx.rec, ctx.url)

  // Гвард страницы (нет прав) — обходить нечего, но это ФАКТ, а не пропуск:
  // под персоной без права экран ОБЯЗАН быть закрыт.
  const body = await ctx.page.locator('body').innerText()
  const gated = /Доступ запрещён|Не удалось проверить права/.test(body)
  const v = pageVerdict(ctx.rec, gated, new URL(ctx.page.url()).pathname, ctx.url)
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

  const hasMain = (await ctx.page.locator('#main-content').count()) > 0
  const container = chromeless || !hasMain ? 'body' : '#main-content'

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

  for (let i = 0; i < Math.min(safe.length, MAX_ELEMENTS); i += 1) {
    const d = safe[i]
    // Перед каждым кликом — исходная страница (требование обхода: после
    // навигации возвращаемся). Элемент ищется по КЛЮЧУ, не по индексу:
    // асинхронная догрузка сдвигает DOM между заходами.
    if (currentPath(ctx.page) !== ctx.url) await open(ctx.page, ctx.url)
    const fresh = await collect(ctx.page, container)
    const match = fresh.find((f) => f.key === d.key)
    if (match === undefined) {
      ctx.findings.push({
        page: ctx.label,
        element: d.name,
        action: 'клик',
        api: '—',
        status: '—',
        verdict: '⚠️ элемент исчез',
        details: 'до клика не дожил — динамическая перерисовка',
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

  const events = await get('/api/ops/security-events/')
  put('eventId', events?.results?.[0]?.id)
  const closed = events?.results?.find((e: any) => /CLOSED/i.test(String(e.stateCode ?? '')))
  put('closedEventId', closed?.id ?? events?.results?.[0]?.id)

  put('employeeId', (await get('/api/ops/personnel/'))?.results?.[0]?.id)
  const objects = await get('/api/ops/objects/')
  put('objectId', objects?.results?.[0]?.id)
  if (ids.objectId !== undefined) {
    const detail = await get(`/api/ops/objects/${ids.objectId}/`)
    const versions: any[] =
      detail?.passportVersions ?? detail?.passport?.versions ?? detail?.versions ?? []
    put('passportVersionId', versions?.[0]?.id ?? versions?.[0]?.versionId)
  }
  put('dutyShiftId', (await get('/api/ops/duty-shifts/'))?.results?.[0]?.id)
  put('ratingEmployeeId', (await get('/api/ops/evaluation-registry/'))?.results?.[0]?.employeeId)
  put('reportJobId', (await get('/api/ops/service-report-jobs/'))?.results?.[0]?.reportJobId)
  put('dictionaryCode', (await get('/api/ops/dictionaries/'))?.results?.[0]?.code)
  put('feedbackId', (await get('/api/ops/feedback-requests/'))?.results?.[0]?.feedbackId)
  put('divisionId', (await get('/api/core/divisions/'))?.results?.[0]?.id)
  ids.businessDate = new Date().toISOString().slice(0, 10)
  return ids
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function login(username: string, password: string): Promise<string> {
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
  test.skip(!LIVE, 'нужен живой стек — SMOKE_LIVE=1 + Django :8100 + vite :5180')
  test.describe.configure({ mode: 'serial' })

  test('карта маршрутов покрыта обходом', () => {
    const covered = new Set(
      ROUTES.map((r) => r.template.split('?')[0].replace(/\{[^}]+\}/g, ':x')),
    )
    const missing = declaredPortalRoutes().filter(
      (d) => !covered.has(d.replace(/:[a-zA-Z]+/g, ':x')),
    )
    expect(missing, 'маршруты портала вне обхода').toEqual([])
  })

  for (const persona of PERSONAS) {
    test.describe(`persona ${persona.key}`, () => {
      let token = ''
      let ids: Record<string, string> = {}

      test.beforeAll(async () => {
        token = await login(persona.username, persona.password)
        ids = await resolveIds(token)
      })

      test.beforeEach(async ({ page }) => {
        await page.addInitScript(
          (t) => {
            sessionStorage.setItem('vaps.credential', JSON.stringify({ kind: 'jwt', token: t }))
          },
          token,
        )
      })

      for (const route of ROUTES) {
        test(`${persona.key} ${route.template}`, async ({ page }) => {
          test.setTimeout(240_000)
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
          const ctx: SweepCtx = { page, rec, url, label: route.template, findings: [] }
          await sweepPage(ctx, route.chromeless === true)
          dump(persona, route.template, ctx.findings)
        })
      }

      // Каркас (сайдбар + шапка) — ОДИН раз, а не на каждой странице: он
      // одинаков везде, и обход по нему на 39 страницах дал бы сотни строк об
      // одних и тех же ссылках.
      for (const chrome of ['aside', 'header'] as const) {
        test(`${persona.key} каркас: ${chrome}`, async ({ page }) => {
          test.setTimeout(240_000)
          const rec = new Recorder()
          rec.attach(page)
          const ctx: SweepCtx = { page, rec, url: '/', label: `(каркас ${chrome})`, findings: [] }
          await open(page, '/')
          if ((await page.locator(chrome).count()) === 0) {
            dump(persona, `(каркас ${chrome})`, [
              {
                page: ctx.label,
                element: `(${chrome})`,
                action: '—',
                api: '—',
                status: '—',
                verdict: '⚠️ каркаса нет',
                details: 'страница «/» отрендерилась без AppLayout',
              },
            ])
            return
          }
          const items = (await collect(page, chrome)).filter((d) => !DESTRUCTIVE.test(d.name))
          for (const d of items) {
            if (currentPath(page) !== '/') await open(page, '/')
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

      // САМЫМ ПОСЛЕДНИМ (serial держит порядок объявления): выход рвёт
      // credential — всё, что после него, шло бы на /login.
      test(`${persona.key} выход из системы`, async ({ page }) => {
        const rec = new Recorder()
        rec.attach(page)
        await open(page, '/')
        // Выход спрятан в меню пользователя (AppLayout: DropdownMenu), а его
        // содержимое Radix рендерит В ПОРТАЛЕ — вне <header>. Первый прогон
        // искал кнопку внутри каркаса и отчитался «кнопки выхода нет»: искал
        // не там. Сначала открываем меню, потом ищем пункт от КОРНЯ страницы.
        await page
          .getByRole('button', { name: 'Меню пользователя' })
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
            details: 'ни кнопки «Меню пользователя», ни пункта «Выйти» в нём',
          })
        } else {
          const mark = rec.mark()
          await logout.first().click()
          await page.waitForTimeout(SETTLE_MS)
          const { net, logs } = rec.since(mark)
          const landed = new URL(page.url()).pathname
          findings.push({
            page: '(каркас)',
            element: 'выход',
            action: 'клик',
            api: netApi(net),
            status: netStatus(net),
            verdict: landed === '/login' ? '✅ увело на /login' : '🔴 остались на месте',
            details: `приземлились на ${landed}; ${logs.map((l) => l.text).join('; ')}`,
          })
        }
        dump(persona, '(выход)', findings)
      })
    })
  }
})
