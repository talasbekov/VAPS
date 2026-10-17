/**
 * Состав подразделений грузится ОДНИМ запросом, а не запросом на каждое
 * (Plane №376).
 *
 * ОТКУДА ВЗЯЛАСЬ. Замер производительности портала по жалобе заказчика («фронт
 * долго думает», №343). На прод-стенде: `/dashboard` — 11 обращений к API,
 * `/statuses` — 16, а `/employees` — 74, из них **51 к одной и той же ручке**
 * `/api/ops/daily/employees/`. Причина — `useQueries` по строкам расхода в
 * `use-forces-gathering`: запрос на каждое подразделение живого дерева.
 *
 * ПОЧЕМУ ПРОБА СЧИТАЕТ ЗАПРОСЫ, А НЕ МИЛЛИСЕКУНДЫ — по той же причине, что и
 * `session-fetch-storm`: время на стенде зависит от машины и соседей, а число
 * запросов — только от кода. Стоимость N+1 линейна по задержке канала: на
 * localhost 51 запрос стоит доли секунды, при задержке 40 мс — две секунды
 * ожидания на каждое открытие экрана.
 *
 * ПОРОГ. Ожидается ОДИН запрос состава на открытие; порог 3 оставлен на
 * повторную загрузку после смены деловой даты и на перезапрос вкладки — но
 * он на порядок ниже прежних 51, то есть возврат к запросу-на-подразделение
 * проба ловит.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const EMPLOYEES_PATH = '/api/ops/daily/employees/'

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: STAND_USERNAME,
      password: STAND_PASSWORD,
      json: 'true',
    },
  })
}

test.describe(LIVE ? 'состав подразделений одним запросом' : 'состав подразделений одним запросом (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('экран сбора сил не бьёт ручку состава по каждому подразделению', async ({ page }) => {
    await signIn(page)

    const calls: string[] = []
    const responseStatuses: number[] = []
    page.on('request', (request) => {
      if (request.url().includes(EMPLOYEES_PATH)) calls.push(request.url())
    })
    page.on('response', (response) => {
      if (response.url().includes(EMPLOYEES_PATH)) responseStatuses.push(response.status())
    })
    const strengthResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/operations/strength-report/',
    )

    await page.goto(`${APP}/employees?view=forces`)
    await expect(page.getByRole('tab', { name: 'Список сотрудников' })).toBeVisible({
      timeout: 30_000,
    })
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    const report = await (await strengthResponse).json() as { rows: Array<{ division_id: number }> }
    const expectedDivisions = new Set(report.rows.map((row) => row.division_id))
    const batches = Math.ceil(expectedDivisions.size / 200)
    await expect.poll(() => responseStatuses.length).toBeGreaterThanOrEqual(batches)
    expect(responseStatuses, 'every personnel batch must load successfully').not.toContain(400)
    expect(responseStatuses.every((status) => status === 200)).toBe(true)
    const requestedDivisions = new Set<number>()
    for (const call of calls) {
      const ids = new URL(call).searchParams.getAll('division_id')
      expect(ids.length, 'the API accepts at most 200 divisions in one batch').toBeLessThanOrEqual(200)
      for (const id of ids) requestedDivisions.add(Number(id))
    }
    expect([...requestedDivisions].sort((a, b) => a - b)).toEqual([...expectedDivisions].sort((a, b) => a - b))

    // Запрос ДОЛЖЕН БЫТЬ: ноль означал бы, что экран вообще не грузит состав,
    // и проверка «не больше трёх» прошла бы на пустом месте.
    expect(calls.length).toBeGreaterThan(0)
    expect(
      calls.length,
      `состав грузится ${calls.length} запросами — вернулся запрос на каждое подразделение`,
    ).toBeLessThanOrEqual(Math.max(3, batches * 3))

    // И это ОДИН запрос про МНОГИЕ подразделения, а не один про одно: адрес
    // несёт несколько `division_id`, иначе экран просто перестал бы показывать
    // остальные управления.
    const batched = calls.filter(
      (url) => (url.match(/division_id=/g) ?? []).length > 1,
    )
    expect(
      batched.length,
      'ни один запрос состава не спрашивает несколько подразделений сразу',
    ).toBeGreaterThan(0)
  })
})
