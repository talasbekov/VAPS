/**
 * «Напоминания об отставших» на ЖИВОМ стенде — лента уведомлений раздела
 * рядом со светофором сдачи.
 *
 * Что стережёт проба:
 *
 * 1. на экране ровно то, что вернула ручка `/api/operations/notifications/` —
 *    ни выдуманных строк, ни своего счёта отставших (владелец витрины сдачи —
 *    светофор выше);
 * 2. имя подразделения ДОКЛЕИВАЕТСЯ из дерева светофора: уведомление хранит
 *    только идентификаторы, и узел, которого в дереве нет, показывается
 *    номером, а не пропадает;
 * 3. срок рассылки назван контрольным часом ИЗ ОТВЕТА, а не зашит числом;
 * 4. пустая лента сказана словами.
 *
 * Данные на стенде не гарантированы (лента наполняется фоновым догоном после
 * контрольного часа), поэтому живой ответ проверяется как есть, а сценарии с
 * содержимым ставятся ПЕРЕХВАТОМ — иначе проба молчала бы на пустой ленте.
 *
 * 🔴 Service worker MSW блокируется на весь файл: без этого `page.route` не
 * перехватывает запросы приложения, и подмены ниже не применились бы.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SCREEN = '/security-ops/analytics'

/**
 * Фикстура «непрочитанное напоминание» для теста отметки прочтения — СВОЯ, а
 * не позаимствованная у стенда: отметка прочтения необратима (write-once
 * `read_at`, ручки «снять отметку» в API нет вовсе — см. отчёт задачи), и
 * брать «первое попавшееся непрочитанное» значило бы рисковать съесть боевую
 * запись на любом стенде, где очередь не пуста ровно нашей пробой. Сеется и
 * убирается штатным инструментом бэка (`seed_lagging_probe` +
 * `check_lagging_submissions` — это ФИКСТУРА, а не прод-код, докстринг
 * команды говорит об этом прямо), запущенным как подпроцесс из САМОГО теста —
 * не руками между прогонами.
 */
const BACKEND_DIR = path.resolve(__dirname, '../../Personnel-Records')
const PYTHON = path.join(BACKEND_DIR, '.venv/bin/python')
const DJANGO_ENV = {
  DJANGO_SETTINGS_MODULE: 'organization_management.config.settings.local_postgres',
}
// Маркер СВОЕЙ записи: PROBE_DIVISION_ID сида
// (organization_management/apps/operations/management/commands/seed_lagging_probe.py)
// — синтетический id БЕЗ внешнего ключа на реальное подразделение (в дереве
// светофора его нет и быть не может), поэтому строка ленты с этим маркером
// заведомо не может быть боевым уведомлением.
const FIXTURE_DIVISION_ID = 999_000_001
const FIXTURE_RECIPIENT = '1' // = actor_id админа, под которым ходит вся спека

function manage(args: string[], extraEnv: Record<string, string> = {}): string {
  return execFileSync(PYTHON, ['manage.py', ...args], {
    cwd: BACKEND_DIR,
    env: { ...process.env, ...DJANGO_ENV, ...extraEnv },
    // stderr — DEBUG SQL-лог раздела (шумный и не нужен); наружу берём
    // только stdout, куда управляющие команды печатают свой результат.
    stdio: ['ignore', 'pipe', 'ignore'],
    encoding: 'utf-8',
  })
}

interface ControlSettingsSnapshot {
  control_hour: string
  required_division_ids: number[]
  default_notify_recipient: string
}

/** Сеет ОДНУ непрочитанную запись с маркером `FIXTURE_DIVISION_ID` для
 * `FIXTURE_RECIPIENT`, снеся прежние уведомления этого получателя (так
 * устроен сам `seed_lagging_probe`) — после сеева в ленте получателя ровно
 * одна строка, наша. */
function seedLaggingNotification(): void {
  manage(['seed_lagging_probe', `--recipient=${FIXTURE_RECIPIENT}`])
  manage(['check_lagging_submissions'])
}

/** Настройки контроля сдачи ДО сеева — `seed_lagging_probe` перезаписывает
 * `control_hour`/`required_division_ids`/`default_notify_recipient` синглтона
 * (нужно ему для ровно одного дня в плане), и это тот самый глобальный
 * стенд-эффект, который другие спеки (например `service-analytics.spec.ts`)
 * читают по умолчанию. Снимается ДО сеева, а не хардкодится — восстановлены
 * будут РОВНО те значения, что были. */
function readControlSettings(): ControlSettingsSnapshot {
  const script = [
    'import json',
    'from organization_management.apps.operations.models_submission import OpsSubmissionControlSettings',
    's = OpsSubmissionControlSettings.objects.filter(singleton_key=1).first()',
    'print("FIXTURE_JSON=" + json.dumps({',
    '    "control_hour": s.control_hour.isoformat() if s else "17:00:00",',
    '    "required_division_ids": s.required_division_ids if s else [],',
    '    "default_notify_recipient": s.default_notify_recipient if s else "",',
    '}))',
  ].join('\n')
  const out = manage(['shell', '-c', script])
  const line = out.split('\n').find((entry) => entry.startsWith('FIXTURE_JSON='))
  if (!line) {
    throw new Error(`не удалось прочитать настройки контроля сдачи: ${out}`)
  }
  return JSON.parse(line.slice('FIXTURE_JSON='.length)) as ControlSettingsSnapshot
}

/** Возвращает синглтон настроек контроля сдачи РОВНО к снимку, снятому
 * `readControlSettings()` до сеева, — вызывается из `finally`, а не «по
 * памяти». */
function writeControlSettings(snapshot: ControlSettingsSnapshot): void {
  const script = [
    'import json, os',
    'from datetime import time',
    'from organization_management.apps.operations.models_submission import OpsSubmissionControlSettings',
    'data = json.loads(os.environ["FIXTURE_SNAPSHOT"])',
    'h, m, sec = (int(part) for part in data["control_hour"].split(":"))',
    'OpsSubmissionControlSettings.objects.update_or_create(',
    '    singleton_key=1,',
    '    defaults={',
    '        "control_hour": time(h, m, sec),',
    '        "required_division_ids": data["required_division_ids"],',
    '        "default_notify_recipient": data["default_notify_recipient"],',
    '    },',
    ')',
    'print("FIXTURE_RESTORED=ok")',
  ].join('\n')
  const out = manage(['shell', '-c', script], { FIXTURE_SNAPSHOT: JSON.stringify(snapshot) })
  if (!out.includes('FIXTURE_RESTORED=ok')) {
    throw new Error(`не удалось восстановить настройки контроля сдачи: ${out}`)
  }
}

interface TrafficNode {
  division_id: number
  name: string
  parent_id: number | null
  status: string
  late: boolean
}

interface TrafficTree {
  business_date: string
  control_hour: string
  nodes: TrafficNode[]
}

interface OpsNotification {
  id: number
  recipient: string
  kind: string
  business_date: string
  payload: { laggard_division_ids?: number[] }
  read_at: string | null
  created_at: string
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as T
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

function feed(page: Page) {
  return page.getByRole('group', { name: 'Напоминания об отставших' })
}

/** Подменить ленту уведомлений. Такой ответ бэк вернуть МОЖЕТ: строки ленты —
 * ровно эта форма (вид, деловая дата, плоские идентификаторы отставших). */
async function routeFeed(page: Page, rows: OpsNotification[]): Promise<void> {
  await page.route(
    (url) => url.pathname.endsWith('/api/operations/notifications/'),
    (route) =>
      route.fulfill({
        json: { count: rows.length, next: null, previous: null, results: rows },
      }),
  )
}

function notification(over: Partial<OpsNotification> = {}): OpsNotification {
  return {
    id: 1,
    recipient: '1',
    kind: 'SUBMISSION_LAGGING',
    business_date: '2026-08-20',
    payload: { laggard_division_ids: [] },
    read_at: null,
    created_at: '2026-08-20T18:00:00+05:00',
    ...over,
  }
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'напоминания об отставших' : 'напоминания об отставших (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('на экране ровно те строки, что вернула ручка ленты', async ({ page }) => {
    const token = await apiToken()
    const live = await get<{ results: OpsNotification[] }>(
      token,
      '/api/operations/notifications/',
    )

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page)).toBeVisible({ timeout: 20_000 })
    await expect(feed(page)).not.toContainText('Загрузка напоминаний', { timeout: 20_000 })

    if (live.results.length === 0) {
      await expect(feed(page)).toContainText('Напоминаний нет')
      await expect(feed(page).getByRole('listitem')).toHaveCount(0)
    } else {
      await expect(feed(page).getByRole('listitem')).toHaveCount(live.results.length)
    }
  })

  test('имя подразделения берётся из дерева светофора, чужой id — номером', async ({ page }) => {
    const token = await apiToken()
    const tree = await get<TrafficTree>(token, '/api/operations/traffic-light/tree/')
    const known = tree.nodes[0]
    expect(known, 'светофор пуст — доклеивать имя не из чего').toBeDefined()

    // Идентификатор, которого в дереве заведомо НЕТ: обязанность сдавать
    // держит плоский список id, и подразделения за ним может уже не быть.
    const missing = Math.max(0, ...tree.nodes.map((node) => node.division_id)) + 1_000

    await signIn(page)
    await routeFeed(page, [
      notification({
        id: 77,
        payload: { laggard_division_ids: [known!.division_id, missing] },
      }),
    ])
    await page.goto(`${APP}${SCREEN}`)

    const row = feed(page).getByRole('listitem').first()
    await expect(row).toBeVisible({ timeout: 20_000 })
    // Имя — из дерева. Показать здесь номер известного узла значило бы, что
    // доклейки нет вовсе.
    await expect(row).toContainText(known!.name)
    await expect(row).not.toContainText(`№${known!.division_id}`)
    // А неизвестный узел назван номером — молча пропав, он скрыл бы отставшего.
    await expect(row).toContainText(`№${missing}`)
    // Деловая дата у строки СВОЯ: догон проходит пропущенные дни, и общая дата
    // экрана соврала бы про день, за который ушло напоминание.
    await expect(row).toContainText('20.08')
    await expect(row).toContainText('не прочитано')
  })

  test('срок рассылки назван контрольным часом из ответа', async ({ page }) => {
    await signIn(page)
    await routeFeed(page, [notification()])
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page)).toBeVisible({ timeout: 20_000 })

    const token = await apiToken()
    const tree = await get<TrafficTree>(token, '/api/operations/traffic-light/tree/')
    await expect(feed(page)).toContainText(
      `после контрольного часа ${tree.control_hour.slice(0, 5)}`,
    )

    // 🔴 Ассерта выше мало: час стенда мог совпасть с зашитой строкой. Порог
    // подменяется в ОТВЕТЕ — подпись обязана поехать за сервером.
    await page.route(
      (url) => url.pathname.endsWith('/api/operations/traffic-light/tree/'),
      (route) => route.fulfill({ json: { ...tree, control_hour: '09:30:00' } }),
    )
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page)).toContainText('после контрольного часа 09:30', { timeout: 20_000 })
  })

  test('пустая лента и напоминание без отставших сказаны словами', async ({ page }) => {
    await signIn(page)
    await routeFeed(page, [])
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page)).toContainText('Напоминаний нет', { timeout: 20_000 })

    // Уведомление без идентификаторов — не пустая строка на экране: молчание
    // здесь неотличимо от «отставших не было».
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    await routeFeed(page, [notification({ id: 91, payload: {} })])
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page).getByRole('listitem').first()).toContainText(
      'Отставшие в напоминании не названы',
      { timeout: 20_000 },
    )
  })

  test('второго счёта сдачи блок не заводит', async ({ page }) => {
    await signIn(page)
    await routeFeed(page, [notification({ id: 55, payload: { laggard_division_ids: [1, 2, 3] } })])
    await page.goto(`${APP}${SCREEN}`)
    await expect(feed(page)).toBeVisible({ timeout: 20_000 })
    // Счётчик блока — число НАПОМИНАНИЙ, а не отставших: сложив отставших, он
    // спорил бы со светофором, который считает по листьям дерева.
    await expect(feed(page)).not.toContainText('не сдали')
    await expect(feed(page)).not.toContainText('подразделений 3')
  })

  test('отметка прочтения ставит read_at на СЕРВЕРЕ — не только гасит строку', async ({ page }) => {
    // Настройки контроля сдачи — на память, до сеева: seed_lagging_probe их
    // перезапишет, finally обязан вернуть РОВНО эти значения.
    const originalSettings = readControlSettings()
    try {
      // Тест сеет СВОЮ фикстуру, а не берёт первую попавшуюся непрочитанную
      // запись ленты: на любом стенде, где очередь не пуста ровно этой
      // пробой, «первое непрочитанное» рискует необратимо съесть боевое
      // уведомление (read_at — write-once, снять отметку в API нечем).
      seedLaggingNotification()

      // ЖИВАЯ лента, без routeFeed: кнопка обязана бить по РЕАЛЬНОЙ строке —
      // перехват здесь доказал бы только разметку, не контракт ручки.
      const token = await apiToken()
      const before = await get<{ results: OpsNotification[] }>(
        token,
        '/api/operations/notifications/',
      )
      // Цель ищется ТОЛЬКО по маркеру СВОЕЙ фикстуры (см. FIXTURE_DIVISION_ID
      // выше) — «первое непрочитанное» здесь намеренно не участвует.
      const target = before.results.find(
        (row) =>
          row.read_at === null &&
          (row.payload.laggard_division_ids ?? []).includes(FIXTURE_DIVISION_ID),
      )
      expect(
        target,
        `сид не создал непрочитанную запись с маркером №${FIXTURE_DIVISION_ID} — пробе нечего отмечать`,
      ).toBeDefined()

      await signIn(page)
      await page.goto(`${APP}${SCREEN}`)
      await expect(feed(page)).toBeVisible({ timeout: 20_000 })
      await expect(feed(page)).not.toContainText('Загрузка напоминаний', { timeout: 20_000 })

      // Строка адресуется ТЕКСТОМ маркера, а не индексом/порядком: соседний
      // тест выше по файлу держит инвариантом только СЧЁТ строк
      // (`toHaveCount(live.results.length)`), не их порядок — индекс ответа
      // ручки как локатор был бы ненадёжен. Маркер виден на экране буквально:
      // FIXTURE_DIVISION_ID — синтетический id без узла в дереве светофора,
      // поэтому доклейка имени показывает его номером (`№999000001`).
      const row = feed(page).getByRole('listitem').filter({ hasText: `№${FIXTURE_DIVISION_ID}` })
      await expect(row).toHaveCount(1)
      await expect(row).toContainText('не прочитано')

      // ГВАРД БЕЗОПАСНОСТИ: последняя проверка ПЕРЕД мутацией, не зависящая
      // от фильтра выше. Даже если фильтр цели сломают правкой (вернутся к
      // «первому непрочитанному»), этот ассерт не даст кликнуть по чужой
      // записи — красная проба гварда записана в отчёте задачи.
      expect(
        target!.payload.laggard_division_ids ?? [],
        `запись pk=${target!.id} не несёт маркер фикстуры №${FIXTURE_DIVISION_ID} — отмена, чтобы не отметить чужое`,
      ).toContain(FIXTURE_DIVISION_ID)

      const markButton = row.getByRole('button', { name: 'Прочитано', exact: true })
      await markButton.click()

      // UI-признак — гаснущая строка без кнопки. Он ПОДСКАЗЫВАЕТ, но не
      // доказывает: доказательство — перечитка ручкой ниже.
      await expect(row).not.toContainText('не прочитано', { timeout: 20_000 })
      await expect(
        row.getByRole('button', { name: 'Прочитано', exact: true }),
      ).toHaveCount(0)

      // Источник истины — СЕРВЕР: перечитываем ленту той же ручкой и смотрим
      // на flag КОНКРЕТНОГО pk, не на счёт строк (счёт не меняется — уведомление
      // остаётся в ленте прочитанным, а не пропадает).
      const after = await get<{ results: OpsNotification[] }>(
        token,
        '/api/operations/notifications/',
      )
      const updated = after.results.find((row) => row.id === target!.id)
      expect(updated, `уведомление pk=${target!.id} пропало из ленты после отметки`).toBeDefined()
      expect(
        updated!.read_at,
        `read_at уведомления pk=${target!.id} обязан выставиться сервером`,
      ).not.toBeNull()
    } finally {
      // Восстановление — в коде, а не «руками между прогонами»: выполняется
      // и на зелёном, и на красном пути (assert внутри try бросает раньше).
      writeControlSettings(originalSettings)
    }
  })
})
