/**
 * Права этапа «Согласование» глазами персон заказчика (`[СОГ-12]`, Plane №401).
 *
 * Проба входит теми же учётками, которыми заказчик проверяет руками
 * (`seed_access_matrix`), и читает то, что увидит он:
 *
 *  - сотрудник второго департамента (`acc_employee_d2`, раздел ОМ на чтение):
 *    «Отправить на согласование» и «Согласовать» ВЫКЛЮЧЕНЫ и подсказка
 *    называет, чьё это действие — кнопка не прячется (правило раздела);
 *  - начальник второго департамента (`acc_dept_head_d2`, `HEAD_OPS_UNIT`):
 *    «Согласовать» ДОСТУПНА у согласующего, которому отправили. До №401 роль
 *    права не имела, и кнопка отвечала 403 без слов.
 *
 * Мероприятие на «Согласовании» с отправленным маршрутом проба берёт живое,
 * а нет такого — заводит сама от админа (см. `prepareSentEvent`). Решения
 * проба не принимает: подпись необратима и сделала бы фикстуру одноразовой.
 *
 * КРАСНОТА НА МУТАЦИИ: сними `!rights.approve` у кнопки «Согласовать» — у
 * сотрудника она станет доступной, и первая проба красна; убери
 * `assignment.approve` у `HEAD_OPS_UNIT` в `seed_operations` — вторая.
 */
import path from 'node:path'
import { anyChiefId } from './stand-chief'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { assertStep } from './fixture-step'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''
// Снимки — рядом со снимками аудита ОМ (каталог `docs/` вне репозитория).
const SHOTS = path.join(__dirname, '..', '..', '..', '..', 'docs', 'audit', 'om-2026-09-03')

interface EventRow {
  id: string
  code: string
  stage: string
  approvalRoute: { id: string; status: string }[]
  visitObjects: { id: string; approvalRoute: { id: string; status: string }[] }[]
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(token: string): Promise<EventRow[]> {
  const res = await fetch(`${API}/api/ops/security-events/?page_size=100`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

/**
 * ОМ на «Согласовании» с ОТПРАВЛЕННЫМ маршрутом — тем же путём, что и проба
 * `approval-stage`: заводится от админа, посты из паспорта, каждый пост
 * укомплектован по потребности, расстановка завершена, согласующий добавлен и
 * расстановка ему отправлена. Уборка стенда снимает такие ОМ по заголовку.
 */
async function prepareSentEvent(token: string): Promise<string> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    await assertStep(res, method, path)
    return res.json().catch(() => ({}))
  }
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба прав согласования (e2e)',
    objectId: object.id,
    businessDate: '2026-09-20',
    kind: 'INTERNAL',
    chiefEmployeeId: await anyChiefId(token),
  })
  const base = `/api/ops/security-events/${created.id}`
  await call('PATCH', `${base}/bulletin/`, { briefDescription: 'Проба прав.', initialTasks: '—' })
  // 🔴 ЗАВЕРШАТЬ БЮЛЛЕТЕНЬ НЕ НУЖНО И НЕЛЬЗЯ (Plane №812, найдено проверкой
  // шагов). ОМ с объектом заводится сразу на рекогносцировке («Реестр ОМ-5»),
  // и `bulletin/complete/` отвечал `INVALID_STAGE_TRANSITION` — «бюллетень
  // можно завершить только на этапе „Бюллетень“». Шаг был мёртв с самого
  // начала: ответ не смотрели, и отказ молчал. Тот же разбор уже стоял в
  // `recon-stage.spec.ts` — здесь его просто никто не повторил.
  await call('POST', `${base}/recon/import-from-passport/`)
  const afterImport = await call('GET', `${base}/`)
  await call('PATCH', `${base}/recon/`, {
    checklist: afterImport.reconChecklist.map((item: Record<string, unknown>) => ({
      ...item,
      state: 'NORMAL',
      done: true,
      result: 'MATCHES',
    })),
    sectorPosts: afterImport.reconSectorPosts,
  })
  await call('POST', `${base}/recon/complete/`)
  const roster = await call('GET', '/api/ops/personnel/?page_size=100')
  let cursor = 0
  for (const post of afterImport.reconSectorPosts as { id: string; need: number }[]) {
    for (let i = 0; i < Math.max(post.need, 1); i += 1) {
      await call('POST', `${base}/placement/assign/`, {
        postId: post.id,
        employeeId: roster.results[cursor % roster.results.length].id,
      })
      cursor += 1
    }
  }
  await call('POST', `${base}/placement/complete/`)
  await call('POST', `${base}/approval/route/`, {
    name: 'Проба: согласующий',
    unit: 'Второй департамент',
    position: 'Начальник',
  })
  await call('POST', `${base}/approval/send/`)
  // id СВОЕЙ фикстуры (Plane №853) — см. разбор у `sentEvent`.
  return String(created.id)
}

/**
 * СВОЙ ОМ на «Согласовании» с неподписанным обходом.
 *
 * 🔴 БЫЛО «ПЕРВОЕ ПОДХОДЯЩЕЕ СО СТЕНДА» (Plane №853): подготовка звалась только
 * если готового не нашлось. Пробы этого файла ПОДПИСЫВАЮТ обход — то есть на
 * живом стенде подписывали чужой ОМ, а соседняя сессия вела его своим путём.
 */
async function sentEvent(): Promise<EventRow | undefined> {
  const token = await apiToken()
  const id = await prepareSentEvent(token)
  const target = (await events(token)).find((e) => e.id === id)
  expect(target, `не удалось подготовить свой ОМ на «Согласовании» (${id})`).toBeDefined()
  expect(
    hasPending(target!),
    'у своей фикстуры нет неподписанного обхода — подписывать нечего',
  ).toBe(true)
  return target
}

function hasPending(row: EventRow): boolean {
  const routes = [row.approvalRoute ?? [], ...row.visitObjects.map((v) => v.approvalRoute ?? [])]
  return routes.some((route) => route.some((a) => a.status === 'PENDING'))
}

async function signIn(page: Page, username: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
}

/**
 * Причина отказа читается ЧЕРЕЗ КНОПКУ, а не поиском строки по странице.
 *
 * Пин через общий локатор `[data-slot="access-note"]` не годится: блок причин
 * шага (`AccessHints`) печатает по строке на КАЖДОЕ право карточки — их пять,
 * и локатор падает строгим режимом ещё до сверки текста. А главное, такой пин
 * не проверял бы того единственного, ради чего правило №801 и заведено: что
 * причина СВЯЗАНА с этой кнопкой и прозвучит вместе с её именем. Поэтому
 * берётся `aria-describedby` кнопки и читается ровно та строка, на которую он
 * указывает.
 */
async function expectReasonReads(
  page: Page,
  button: Locator,
  text: RegExp,
): Promise<void> {
  const describedBy = await button.getAttribute('aria-describedby')
  expect(describedBy, 'у выключенной кнопки нет ссылки на причину').toBeTruthy()
  // Селектор по атрибуту, а не `#id`: `useId` React выдаёт идентификаторы с
  // угловыми кавычками (`«rn»r0`), а `CSS.escape` в Node не существует вовсе.
  await expect(page.locator(`[id="${describedBy!}"]`)).toContainText(text)
}

test.describe(LIVE ? 'права согласования' : 'права согласования (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(PASSWORD === '', 'нужен ACCESS_MATRIX_PASSWORD — тот же, которым заведены учётки')

  test('acc_employee_d2: отправка и подпись выключены и названы по имени роли', async ({ page }) => {
    const target = await sentEvent()
    expect(target, 'не удалось подготовить ОМ на «Согласовании»').toBeDefined()

    await signIn(page, 'acc_employee_d2')
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const card = page.getByRole('region', { name: 'Согласование расстановки' })
    await expect(card).toBeVisible()

    const send = card.getByRole('button', { name: 'Отправить на согласование' })
    await expect(send).toBeDisabled()
    // 🔴 ПИН ПЕРЕВЕДЁН НА ВИДИМУЮ СТРОКУ (правило №801, найдено ревью №825):
    // на выключенной кнопке `title` не показывается ни при каком поведении
    // браузера, и проба пинила подсказку, которой человек не видит.
    await expectReasonReads(page, send, /старший объекта или ведущий мероприятие/)
    // «+ Добавить согласующего» на объекте НЕТ ни у кого (`[СОГ-05]`, Plane
    // №429): маршрут задаётся в настройках. Пин сменился с «выключена» на
    // «отсутствует» осознанно.
    await expect(card.getByRole('button', { name: '+ Добавить согласующего' })).toHaveCount(0)

    const approve = card.getByRole('button', { name: 'Согласовать', exact: true }).first()
    await expect(approve).toBeDisabled()
    await expectReasonReads(page, approve, /утверждающий/)
    await page.screenshot({
      path: path.join(SHOTS, 'approval-rights-employee-d2.png'),
      fullPage: true,
    })
  })

  test('acc_dept_head_d2: «Согласовать» доступна у того, кому отправили', async ({ page }) => {
    const target = await sentEvent()
    expect(target, 'не удалось подготовить ОМ на «Согласовании»').toBeDefined()

    await signIn(page, 'acc_dept_head_d2')
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const card = page.getByRole('region', { name: 'Согласование расстановки' })
    await expect(card).toBeVisible()

    const approve = card.getByRole('button', { name: 'Согласовать', exact: true }).first()
    await expect(approve).toBeEnabled()
    await expect(card.getByRole('button', { name: 'Вернуть', exact: true }).first()).toBeEnabled()
    // Отправка и маршрут остаются у ведущего: подпись — не правка.
    await expect(card.getByRole('button', { name: 'Отправить на согласование' })).toBeDisabled()
    await page.screenshot({
      path: path.join(SHOTS, 'approval-rights-dept-head-d2.png'),
      fullPage: true,
    })
  })
})
