/**
 * Вкладка «Свод департамента» (Plane №990, `[РАСХ-РШ-03]`) — ЖИВОЙ стенд.
 *
 * Заказчик: «сделать свод у ответственного за сбор сил на ОМ какую то
 * вкладку для отправки». До этой карточки «Собрать свод» и «Отправить
 * дежурному» были ОДНОЙ кнопкой, различить «Собран» и «Отправлен» было
 * нечем, а отдельной вкладки для ответственного не было вовсе.
 *
 * Пробы стерегут три конца:
 * 1) вкладка видна ТОЛЬКО ответственному за сбор сил (по роли, не по праву);
 * 2) полный свод: «Собрать свод» → «Отправить дежурному» проходят БЕЗ
 *    причины и без разрыва во времени между «собран» и «отправлен»;
 * 3) неполный свод: сборка проходит (Plane №989/№990 сняли жёсткий гейт),
 *    отправка требует причину — форма появляется, без неё кнопка неактивна,
 *    с ней проходит и результат помечен «неполный».
 *
 * Даты — далеко в будущем (+5…+59 дней от сегодня, внутри окна №989,
 * `farDate()` ниже) и РАЗНЫЕ при каждом вызове: общий демо-департамент
 * (id=2, «Департамент охраны») может параллельно трогать соседняя сессия
 * или повторный прогон этого же файла, а даты по соседству с «завтра» точно
 * заняты чужими пробами.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''

async function apiToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  expect(res.status, `учётка ${username} не получила токен`).toBe(200)
  return ((await res.json()) as { access: string }).access
}

async function post(token: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

const FGO = 'role_forces_gathering_officer'
// Дочернее управление демо-департамента учётки FGO — заведено
// `seed_role_accounts` + живая структура стенда. Сам департамент узел
// `SummaryVersions` выводит СЕРВЕРНЫМ деревом (см. её докстринг), тестам
// достаточно знать только ребёнка, за которого сдают.
const CHILD_DIVISION_ID = 3

// СВОЙ генератор уникальной даты, а не общий `uniqueBusinessDate` из
// `business-date.ts`: тот метит десятилетний диапазон от 2027-02-01 — далеко
// за окном сдачи `[today, today + MAX_PERIOD_DAYS=62]` (Plane №989), и
// `submit_day`/`assemble_summary` отбили бы такую дату `BUSINESS_DATE_OUT_
// OF_WINDOW`. Диапазон [5, 59] — комфортно внутри окна и далеко от «завтра»
// (там свои пробы). Различие по построению, как в `business-date.ts`:
// случайное начало + счётчик, а не время — иначе повторный прогон в ту же
// секунду завёл бы ту же пару дат и упёрся в `DAY_ALREADY_SUBMITTED`.
const FAR_WINDOW_START = 5
const FAR_WINDOW_DAYS = 55
const farBase = Math.floor(Math.random() * FAR_WINDOW_DAYS)
let farIssued = 0

function farDate(): string {
  const offset = FAR_WINDOW_START + ((farBase + farIssued) % FAR_WINDOW_DAYS)
  farIssued += 1
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

const DEPARTMENT_ID = 2

/** Дата из `farDate()`, ПРОВЕРЕННАЯ по департаменту: 55 слотов конечны, и
 * повторные прогоны ЭТОГО файла за один день (интерактивная отладка, не
 * штатный смоук) исчерпывают их — далёкая дата у соседней проверки не
 * гарантия, а вероятность. Без этой проверки повторный прогон видит ЧУЖУЮ
 * (свою же прошлую) сборку и падает `DAY_ALREADY_SUBMITTED`, а не заново
 * проверяет сценарий. */
async function freshDepartmentDate(adminToken: string): Promise<string> {
  for (let attempt = 0; attempt < FAR_WINDOW_DAYS; attempt += 1) {
    const date = farDate()
    const res = await fetch(
      `${API}/api/ops/daily/daily-submissions/?division_id=${DEPARTMENT_ID}&business_date=${date}`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    )
    const body = (await res.json()) as { count: number }
    if (body.count !== 0) continue
    // A parent with no summary can still have a submitted child from a prior run.
    // Both full (which submits it) and incomplete scenarios require a fresh child.
    const child = await fetch(`${API}/api/ops/daily/daily-submissions/?division_id=${CHILD_DIVISION_ID}&business_date=${date}`, { headers: { Authorization: `Bearer ${adminToken}` } })
    if (((await child.json()) as { count: number }).count === 0) return date
  }
  throw new Error(`не нашлось свободной даты за ${FAR_WINDOW_DAYS} попыток — окно исчерпано`)
}

test.describe(LIVE ? 'вкладка «Свод департамента»' : 'вкладка «Свод департамента» (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нужен ROLE_ACCOUNTS_PASSWORD')

  test('вкладка видна ответственному за сбор сил и не видна оператору подразделения', async ({ page }) => {
    await signIn(page, FGO, ROLE_PASSWORD)
    await page.goto(`${APP}/employees`, { waitUntil: 'domcontentloaded' })
    // Пин поправлен ОСОЗНАННО (Plane №1197, 12.09.2026): навигации «Рабочее
    // место» в коде нет ни в одном экране — пункты рабочего места ответственного
    // («Рабочий стол», «Ежедневный расход», «Сбор сил на ОМ») живут в боковом
    // меню «Основная навигация» (`components/navigation/sidebar.tsx`), и
    // соседняя проба `forces-workspace.spec.ts` прямо требует, чтобы
    // «Рабочее место» отсутствовало. Проба была красной с f466c51c.
    await expect(page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Ежедневный расход', exact: true })).toBeVisible({
      timeout: 30_000,
    })

    await signIn(page, 'role_division_operator', ROLE_PASSWORD)
    await page.goto(`${APP}/employees`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Недостаточно прав для просмотра сбора сил на ОМ.', { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByRole('navigation', { name: 'Рабочее место' })).toHaveCount(0)
  })

  test('полный свод: «Собрать свод» → «Отправить дежурному» без причины', async ({ page }) => {
    const adminToken = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const date = await freshDepartmentDate(adminToken)
    const submitted = await post(adminToken, '/api/operations/daily-submissions/', {
      division_id: CHILD_DIVISION_ID,
      business_date: date,
    })
    expect(submitted.status, await submitted.text()).toBe(201)

    await signIn(page, FGO, ROLE_PASSWORD)
    await page.goto(`${APP}/employees?view=department-summary&businessDate=${date}`, {
      waitUntil: 'domcontentloaded',
    })
    const summary = page.getByRole('region', { name: 'Суточный свод' })
    await expect(summary).toBeVisible({ timeout: 30_000 })

    await summary.getByRole('button', { name: 'Собрать свод' }).click()
    await expect(summary.getByText('Свод собран — новая версия в списке ниже')).toBeVisible({
      timeout: 15_000,
    })

    await summary.getByRole('button', { name: 'Отправить дежурному' }).click()
    await expect(summary.getByText('Свод отправлен дежурному')).toBeVisible({ timeout: 15_000 })
    // Отправлено СРАЗУ, без причины — свод полный (один ребёнок, он сдал).
    await expect(summary.getByText(/неполный свод/)).toHaveCount(0)
  })

  test('неполный свод: отправка требует причину, результат помечен «неполный»', async ({ page }) => {
    const adminToken = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const date = await freshDepartmentDate(adminToken)
    // Ребёнок НЕ сдаёт вовсе — свод соберётся неполным (Plane №989/№990).

    await signIn(page, FGO, ROLE_PASSWORD)
    await page.goto(`${APP}/employees?view=department-summary&businessDate=${date}`, {
      waitUntil: 'domcontentloaded',
    })
    const summary = page.getByRole('region', { name: 'Суточный свод' })
    await expect(summary).toBeVisible({ timeout: 30_000 })

    await summary.getByRole('button', { name: 'Собрать свод' }).click()
    await expect(summary.getByText('Свод собран — новая версия в списке ниже')).toBeVisible({
      timeout: 15_000,
    })

    const sendButton = summary.getByRole('button', { name: 'Отправить дежурному' })
    await sendButton.click()
    await expect(summary.getByText(/Свод неполный — не сдали/)).toBeVisible({ timeout: 15_000 })

    const confirmButton = summary.getByRole('button', { name: 'Подтвердить отправку' })
    await expect(confirmButton).toBeDisabled()
    await summary.getByPlaceholder('Причина неполной отправки — обязательна').fill(
      'ребёнок ещё сдаёт, штаб предупреждён'
    )
    await expect(confirmButton).toBeEnabled()
    await confirmButton.click()

    await expect(summary.getByText('Свод отправлен дежурному')).toBeVisible({ timeout: 15_000 })
    await expect(
      summary.getByText(/неполный свод: «ребёнок ещё сдаёт, штаб предупреждён»/)
    ).toBeVisible()
  })
})
