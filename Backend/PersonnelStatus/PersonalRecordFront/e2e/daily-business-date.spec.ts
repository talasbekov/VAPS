/**
 * «Ежедневный расход» (`/employees?view=daily`) — ЕДИНАЯ деловая дата
 * (Plane №988). ЖИВОЙ стенд.
 *
 * До этой карточки борд молчаливо просил расход и светофор БЕЗ даты —
 * сервер отвечал про СЕГОДНЯ, хотя весь смысл экрана — планировать на
 * ЗАВТРА (сдача дня вперёд). `businessDate` считался «сколько уже дала
 * последняя строка», а не наоборот: источник — здесь, а расход/светофор его
 * лишь получают явным параметром.
 *
 * Пробы стерегут ровно контракт:
 *
 * 1. без выбора в адресе борд запрашивает расход И светофор ИМЕННО за
 *    завтра сервера (`GET /tomorrow-block/` без параметра) — не за
 *    браузерное «сегодня» и не за собственное умолчание ручки расхода;
 * 2. `?businessDate=` в адресе переопределяет умолчание, и запрос уходит
 *    именно за выбранную дату — проверено ПЕРЕХВАТОМ реального запроса
 *    (`route.continue`), а не только надписью на экране;
 * 3. кнопка «Вернуть «завтра»» видна ТОЛЬКО при переопределённой дате и
 *    убирает параметр из адреса.
 */
import { expect, test, type Page } from '@playwright/test'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return (await res.json()) as T
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

function dateLabel(iso: string): string {
  return format(new Date(`${iso}T00:00:00`), 'dd MMMM yyyy', { locale: ru })
}

test.describe(LIVE ? 'ежедневный расход: единая деловая дата' : 'ежедневный расход: единая деловая дата (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('по умолчанию борд просит расход и светофор ЗА ЗАВТРА сервера, а не за своё "сегодня"', async ({ page }) => {
    const token = await apiToken()
    const tomorrowState = await get<{ business_date: string }>(token, '/api/operations/tomorrow-block/')

    const strengthUrls: string[] = []
    const treeUrls: string[] = []
    await page.route(
      (url) => url.pathname === '/api/operations/strength-report/',
      async (route) => {
        strengthUrls.push(route.request().url())
        await route.continue()
      }
    )
    await page.route(
      (url) => url.pathname === '/api/operations/traffic-light/tree/',
      async (route) => {
        treeUrls.push(route.request().url())
        await route.continue()
      }
    )

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })
    // «Суточный свод» монтирует дерево светофора своим хуком — дождаться,
    // что он тоже успел уйти, а не только расход.
    await expect(board.getByRole('region', { name: 'Суточный свод' })).toBeVisible()

    await expect.poll(() => strengthUrls.length, 'запрос расхода не ушёл вовсе').toBeGreaterThan(0)
    await expect.poll(() => treeUrls.length, 'запрос светофора не ушёл вовсе').toBeGreaterThan(0)
    // Проверяется НАЛИЧИЕ запроса за завтра, а не то, что ВСЕ запросы за
    // завтра: `/employees` безусловно держит ещё и `useForcesGathering`
    // (вкладка «Сбор сил», Task 2) — её собственный запрос того же расхода
    // БЕЗ даты (её знаменатель — «сейчас», borд её не касается) фонит на
    // ЛЮБОЙ вкладке, даже `view=daily`. Различает форма: у чужого запроса
    // `business_date` нет ВООБЩЕ (не «другая дата» — параметра нет), поэтому
    // `.some()` по точному совпадению не спутает его с борда.
    expect(
      strengthUrls.some((url) => new URL(url).searchParams.get('business_date') === tomorrowState.business_date),
      `среди запросов расхода нет ни одного за завтра (${tomorrowState.business_date}): ${strengthUrls.join(', ')}`
    ).toBe(true)
    expect(
      treeUrls.some((url) => new URL(url).searchParams.get('business_date') === tomorrowState.business_date),
      `среди запросов светофора нет ни одного за завтра (${tomorrowState.business_date}): ${treeUrls.join(', ')}`
    ).toBe(true)

    // Подпись выбранной даты на кнопке — та же дата словами, не «сегодня».
    await expect(
      board.getByRole('button').filter({ hasText: dateLabel(tomorrowState.business_date) })
    ).toBeVisible()
    // Кнопка возврата к умолчанию не показана — умолчание и так активно.
    await expect(board.getByRole('button', { name: 'Вернуть «завтра»' })).toHaveCount(0)
  })

  test('?businessDate= в адресе переопределяет умолчание — оба запроса уходят именно за выбранную дату', async ({ page }) => {
    const token = await apiToken()
    // «Сегодня» сервера — гарантированно НЕ заблокированная дата (гейт
    // блокировки стоит только на будущем) и заведомо отличная от умолчания
    // борда («завтра»): удобный контраст для пробы.
    const today = (
      await get<{ business_date: string }>(token, '/api/operations/strength-report/')
    ).business_date

    const strengthUrls: string[] = []
    const treeUrls: string[] = []
    await page.route(
      (url) => url.pathname === '/api/operations/strength-report/',
      async (route) => {
        strengthUrls.push(route.request().url())
        await route.continue()
      }
    )
    await page.route(
      (url) => url.pathname === '/api/operations/traffic-light/tree/',
      async (route) => {
        treeUrls.push(route.request().url())
        await route.continue()
      }
    )

    await signIn(page)
    await page.goto(`${APP}/employees?view=daily&businessDate=${today}`)
    const board = page.getByRole('region', { name: 'Ежедневный расход' })
    await expect(board).toBeVisible({ timeout: 25_000 })
    await expect(board.getByRole('region', { name: 'Суточный свод' })).toBeVisible()

    await expect.poll(() => strengthUrls.length).toBeGreaterThan(0)
    await expect.poll(() => treeUrls.length).toBeGreaterThan(0)
    // `.some()`, а не «последний запрос»: та же безусловная `useForcesGathering`
    // (см. предыдущий тест) фонит и здесь СВОИМ запросом БЕЗ параметра — у
    // него `business_date` нет вовсе (`null`), и он никогда не совпадёт со
    // строкой `today`, поэтому спутать его с запросом борда `.some()` не может.
    expect(
      strengthUrls.some((url) => new URL(url).searchParams.get('business_date') === today),
      `запрос расхода не подхватил дату из адреса: ${strengthUrls.join(', ')}`
    ).toBe(true)
    expect(
      treeUrls.some((url) => new URL(url).searchParams.get('business_date') === today),
      `запрос светофора не подхватил дату из адреса: ${treeUrls.join(', ')}`
    ).toBe(true)

    await expect(board.getByRole('button').filter({ hasText: dateLabel(today) })).toBeVisible()

    // Кнопка возврата — видна ТОЛЬКО при переопределённой дате, и убирает
    // параметр из адреса обратно к умолчанию («завтра»).
    const resetButton = board.getByRole('button', { name: 'Вернуть «завтра»' })
    await expect(resetButton).toBeVisible()
    await resetButton.click()
    // `/employees/` — со слешем: Next.js нормализует путь маршрута, и
    // литерал без него никогда не совпал бы (см. `daily-expense.spec.ts`,
    // где по этой же причине переходят по `${APP}/employees?view=daily` —
    // редиректом на слеш до перехода, а не после клика в самом приложении).
    await expect(page).toHaveURL(`${APP}/employees/?view=daily`)
    await expect(board.getByRole('button', { name: 'Вернуть «завтра»' })).toHaveCount(0)
  })
})
