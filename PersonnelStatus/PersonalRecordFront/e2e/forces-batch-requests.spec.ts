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
    page.on('request', (request) => {
      if (request.url().includes(EMPLOYEES_PATH)) calls.push(request.url())
    })

    await page.goto(`${APP}/employees?view=forces`)
    await expect(page.getByRole('tab', { name: 'Список сотрудников' })).toBeVisible({
      timeout: 30_000,
    })
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})

    // Запрос ДОЛЖЕН БЫТЬ: ноль означал бы, что экран вообще не грузит состав,
    // и проверка «не больше трёх» прошла бы на пустом месте.
    expect(calls.length).toBeGreaterThan(0)
    expect(
      calls.length,
      `состав грузится ${calls.length} запросами — вернулся запрос на каждое подразделение`,
    ).toBeLessThanOrEqual(3)

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
