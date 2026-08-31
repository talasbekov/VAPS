/**
 * Экран не спрашивает сессию перед каждым запросом к бэку (Plane №343).
 *
 * ОТКУДА ВЗЯЛАСЬ. Заказчик: «Нажимаешь на какой то модуль он долго думая через
 * пару секунд отвечает». Причина оказалась не в объёме данных и не в бандле
 * (общий First Load JS 101 КБ, самый тяжёлый маршрут 324 КБ — нормальный вес),
 * а в лишнем round-trip'е: оба API-клиента звали `getSession()` из
 * `next-auth/react` ПЕРЕД КАЖДЫМ обращением к бэку, а он ничего не кэширует —
 * в `node_modules/next-auth/client/_utils.js` это голый `fetch` к
 * `/api/auth/session`.
 *
 * ЗАМЕР ДО ПРАВКИ (прод-сборка, обход семи модулей кликами по сайдбару):
 * 158 запросов `/api/auth/session` против 84 обращений к данным. Один экран
 * «Сбор сил на ОМ» — 120 против 60: он бьёт `/api/ops/daily/employees/` по
 * каждому подразделению, и каждый запрос тащил свой поход за сессией.
 * ПОСЛЕ правки — 6 против тех же 84.
 *
 * ПОЧЕМУ ЭТО НЕВИДИМО НА МАШИНЕ РАЗРАБОТЧИКА. Это не время счёта, а СУММА
 * ЗАДЕРЖЕК СЕТИ, линейная по числу запросов: на localhost round-trip 3-15 мс
 * и 120 запросов дают полсекунды, при задержке канала 30-50 мс — 3,6-6 секунд.
 * Поэтому проба считает ЗАПРОСЫ, а не миллисекунды: время на стенде зависит от
 * машины и соседних процессов, а число запросов — только от кода.
 *
 * ЧТО ИМЕННО СТЕРЕЖЁТ. Не «экран открылся быстро», а отношение «запросов за
 * сессией» к «запросам за данными». Порог взят с запасом: один-два похода за
 * сессией на экран — это нормальная работа кэша (первый запрос и, возможно,
 * протухание срока годности), полтора десятка — возврат болезни.
 *
 * МУТАЦИЯ, НА КОТОРОЙ ОБЯЗАНА ПАДАТЬ: вернуть в `lib/api.ts` или
 * `lib/ops-api.ts` собственный `getAccessToken()` с прямым вызовом
 * `getSession()` вместо `@/lib/access-token` — на «Сборе сил» станет 120
 * запросов сессии вместо нуля. Проверено замером до и после правки.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

/** Экран веерных запросов: он бьёт по каждому подразделению, поэтому именно на
 *  нём болезнь была видна крупнее всего. */
const HEAVY_MODULE = '/employees/'

/** Потолок походов за сессией на ОДИН экран. До правки здесь было 120. */
const MAX_SESSION_CALLS = 15

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: STAND_USERNAME,
      password: STAND_PASSWORD,
      json: 'true',
    },
  })
}

test.describe('производительность: сессия не спрашивается на каждый запрос', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('открытие модуля не поднимает бурю запросов за сессией', async ({ page }) => {
    let session = 0
    let backend = 0
    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/api/auth/session')) session += 1
      else if (url.includes('/api/')) backend += 1
    })

    await signIn(page)
    await page.goto(`${APP}/dashboard/`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside')).toBeVisible({ timeout: 120_000 })
    await page.waitForTimeout(2_000)

    // Счёт ведётся ТОЛЬКО с момента перехода: вход и дашборд имеют право на
    // свои запросы, и мешать их в один счёт значило бы мерить не то.
    session = 0
    backend = 0

    const link = page.locator(`aside a[href="${HEAVY_MODULE}"]`).first()
    await expect(link, 'в сайдбаре нет ссылки на модуль — проверять нечего').toBeVisible()
    await link.click()
    await page.locator('h1').first().waitFor({ state: 'visible', timeout: 120_000 })
    // Экрану дано время догрузить данные: считать запросы раньше — значит
    // поймать половину и объявить её победой.
    await page.waitForTimeout(6_000)

    expect(backend, 'экран не сходил за данными вовсе — проба вакуумна').toBeGreaterThan(5)
    expect(
      session,
      `на ${backend} запросов к данным пришлось ${session} походов за сессией: ` +
        'клиент снова спрашивает токен на каждый запрос вместо общего кэша ' +
        '(`lib/access-token.ts`)',
    ).toBeLessThanOrEqual(MAX_SESSION_CALLS)
  })
})
