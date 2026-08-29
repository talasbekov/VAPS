/**
 * Проход ПО КАЖДОЙ роли раздела ОМ: вход в портал и ключевые экраны.
 *
 * Зачем. Прав в разделе 52, ролей 28, а обход портала ходит ТРЕМЯ персонами
 * (Plane №308) — остальные роли не проверялись под интерфейсом никогда.
 * Учётки заводит `manage.py seed_role_accounts` (по одной на роль).
 *
 * Что проверяется. Не «что видно» (это решает карта прав и она проверяется
 * матрицей на бэке), а что экран НЕ ЛОМАЕТСЯ ни под одной ролью: нет
 * пятисоток, нет границы ошибок, каркас отрисован. Роль без права должна
 * увидеть внятный отказ, а не белый экран и не стек.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3108'
const PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''

/** Роли берутся из переменной: список в коде разошёлся бы со справочником. */
const ROLES = (process.env.ROLE_ACCOUNTS_LIST ?? '').split(',').filter(Boolean)

const SCREENS = ['/dashboard', '/statuses', '/security-ops/events', '/employees?view=forces']

/**
 * Экран ↔ право, которым он открывается. Проверяется НЕ «что видно», а
 * СОВПАДЕНИЕ: есть право — открывается содержимое, нет права — внятный отказ
 * («Недостаточно прав для просмотра …»), а не пустая страница и не стек.
 *
 * Список короткий намеренно: он стережёт СВЯЗЬ права и экрана, а полную карту
 * прав проверяет матрица на бэке (57 списочных ручек × 28 ролей). Дублировать
 * её интерфейсом значило бы гонять час ради того же ответа.
 */
const GATED: Array<{ screen: string; permission: string; deniedText: RegExp }> = [
  {
    screen: '/security-ops/events',
    permission: 'event.view',
    deniedText: /Недостаточно прав для просмотра реестра ОМ/i,
  },
]

/**
 * Права роли — с БЭКЕНДА по токену, как это делают соседние спеки (`tokenFor`).
 *
 * Два способа уже подвели, и оба одинаково: они спрашивали не там.
 *   • `page.context().request` мимо страницы — пустой набор;
 *   • голый `fetch` ИЗ страницы — 403, потому что портал ходит в бэкенд своим
 *     клиентом с токеном, а `fetch` куки несёт, а токен нет. Под `admin` с
 *     правом `*` он тоже отвечает 403 — то есть дело было в способе, а не в
 *     правах, и проба дважды обвиняла исправный экран.
 */
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function permissionsOf(username: string): Promise<Set<string>> {
  const tokenRes = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  })
  expect(tokenRes.status, `учётка ${username} не получила токен`).toBe(200)
  const { access } = (await tokenRes.json()) as { access: string }
  const res = await fetch(`${API}/api/operations/my-permissions/`, {
    headers: { Authorization: `Bearer ${access}` },
  })
  expect(res.status, `права роли не отдаются: ${username}`).toBe(200)
  const body = (await res.json()) as { permissions?: string[] }
  return new Set(body.permissions ?? [])
}

async function signIn(page: Page, username: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'роли: проход по учёткам' : 'роли (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(PASSWORD === '', 'нужен ROLE_ACCOUNTS_PASSWORD')
  test.skip(ROLES.length === 0, 'нужен ROLE_ACCOUNTS_LIST — список ролей из справочника')

  for (const role of ROLES) {
    test(`роль ${role}: экраны не ломаются`, async ({ page }) => {
      const failures: string[] = []
      const serverErrors: string[] = []
      page.on('response', (res) => {
        if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url().slice(0, 80)}`)
      })
      page.on('pageerror', (err) => failures.push(`pageerror: ${String(err).slice(0, 120)}`))

      await signIn(page, `role_${role.toLowerCase()}`)
      for (const screen of SCREENS) {
        await page.goto(`${APP}${screen}`, { waitUntil: 'domcontentloaded' })
        // 🔴 ЖДЁМ КАРКАС, а не читаем сразу. `domcontentloaded` наступает до
        // гидратации, и первая редакция этой пробы объявила «пустой экран» у
        // ВСЕХ 28 ролей — то есть обвинила портал целиком, читая его раньше,
        // чем он отрисовался. Тот же дефект, что в пробе аватарок (Plane
        // №293): проверка, спешащая с чтением, врёт убедительнее всего.
        //
        // Каркас обязан отрисоваться под ЛЮБОЙ ролью: отказ показывают ВНУТРИ
        // него, а не вместо него.
        await expect(
          page.locator('header, aside, main').first(),
          `${screen}: каркас не отрисован`,
        ).toBeVisible({ timeout: 25_000 })
        const text = (await page.locator('body').innerText()).slice(0, 4000)
        if (/Application error|Unhandled Runtime Error|Internal Server Error/i.test(text)) {
          failures.push(`${screen}: граница ошибок`)
        }
        if (text.trim().length < 40) failures.push(`${screen}: пустой экран`)
      }
      // Совпадение права и экрана: обещание интерфейса не должно расходиться
      // с тем, что разрешает сервер (класс дефекта Plane №255).
      const perms = await permissionsOf(`role_${role.toLowerCase()}`)
      for (const gate of GATED) {
        // 🔴 ЖДЁМ ИМЕННО ТОТ ЗАПРОС, ОТ КОТОРОГО ЗАВИСИТ ГЕЙТ. Экран решает,
        // показать содержимое или отказ, по ответу `my-permissions`; до него
        // он не показывает ни того, ни другого. Проба, читавшая сразу после
        // каркаса, объявляла «отказа не показано» и обвиняла исправный экран —
        // тот же спех, что в пробе аватарок (Plane №293) и в проверке
        // привлечений (№314). Каркас — не признак готовности.
        const permsAnswered = page.waitForResponse(
          (res) => res.url().includes('/api/operations/my-permissions/'),
          { timeout: 25_000 },
        )
        await page.goto(`${APP}${gate.screen}`, { waitUntil: 'domcontentloaded' })
        await expect(page.locator('header, aside, main').first()).toBeVisible({ timeout: 25_000 })
        await permsAnswered.catch(() => null)
        await expect
          .poll(async () => (await page.locator('main').innerText()).length, { timeout: 15_000 })
          .toBeGreaterThan(20)
        const denied = await page.getByText(gate.deniedText).count()
        const allowed = perms.has(gate.permission) || perms.has('*')
        if (allowed && denied > 0) {
          failures.push(`${gate.screen}: право ${gate.permission} есть, а экран отказывает`)
        }
        if (!allowed && denied === 0) {
          failures.push(
            `${gate.screen}: права ${gate.permission} нет, а отказа не показано — ` +
              'экран обещает то, чего сервер не даст',
          )
        }
      }

      expect(
        [...failures, ...serverErrors],
        `роль ${role}: экраны сломались`,
      ).toEqual([])
    })
  }
})
