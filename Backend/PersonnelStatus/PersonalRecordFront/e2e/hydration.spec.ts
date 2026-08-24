/**
 * Гидратация каркаса на ЖИВОМ стенде.
 *
 * Сторож одного класса дефектов: состояние, восстановленное из
 * `localStorage` ПРЯМО В РЕНДЕРЕ, ломает гидратацию. Сервер такого хранилища
 * не видит и всегда рисует умолчание, поэтому у пользователя, свернувшего
 * сайдбар, первый клиентский рендер расходился с серверным — React сообщал
 * «tree hydrated but some attributes … didn't match» и отказывался чинить
 * поддерево (найдено 22.08.2026 обходом стенда).
 *
 * 🔴 Проба обязана идти по СВЁРНУТОМУ состоянию: с развёрнутым (умолчание
 * сервера) расхождения нет вовсе, и тест был бы вакуумным при любом коде.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

/** Экраны разных семейств: общий каркас у них один, но маршруты разные. */
const ROUTES = ['/employees/?view=forces', '/employees/?view=daily', '/security-ops/analytics/'] as const

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'гидратация каркаса' : 'гидратация каркаса (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  for (const route of ROUTES) {
    test(`свёрнутый сайдбар не ломает гидратацию: ${route}`, async ({ page }) => {
      const hydrationErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        const text = message.text()
        if (/hydrat/i.test(text)) hydrationErrors.push(text.slice(0, 400))
      })
      page.on('pageerror', (error) => {
        if (/hydrat/i.test(String(error))) hydrationErrors.push(String(error).slice(0, 400))
      })

      await signIn(page)
      // Значение кладём ДО первой отрисовки экрана: именно оно расходилось с
      // серверным умолчанием. Домен для хранилища даёт лёгкая страница.
      await page.goto(`${APP}/dashboard/`)
      await page.evaluate(() => localStorage.setItem('sidebarOpen', 'false'))

      await page.goto(`${APP}${route}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)

      // Сначала — главное утверждение, иначе гвард ниже упадёт первым и
      // припишет поломке гидратации чужую причину: при расхождении React
      // оставляет серверную разметку, и свёрнутого состояния в ней нет.
      expect(
        hydrationErrors,
        `гидратация ${route} расходится с сервером: ${hydrationErrors.join(' | ')}`,
      ).toEqual([])

      // Свёрнутое состояние ДЕЙСТВИТЕЛЬНО применилось — иначе проба вакуумна:
      // мы бы мерили гидратацию развёрнутого каркаса, где расхождения нет.
      await expect(page.locator('div[inert]').first()).toBeAttached({ timeout: 10_000 })
    })
  }

  /**
   * Расширения браузера дописывают в <body> свои атрибуты (`data-gptw`,
   * Grammarly, ColorZilla) ПОСЛЕ доставки SSR-разметки и ДО гидратации —
   * React видит расхождение и заваливает консоль разработчика шумом, который
   * не воспроизводится ни на чистом профиле, ни здесь. Щит — атрибут
   * `suppressHydrationWarning` на `<body>` в `app/layout.tsx`; сторож нужен,
   * чтобы его не сняли «за ненадобностью».
   *
   * 🔴 Проба обязана ставить атрибут ДО гидратации и проверять, что он дошёл
   * до DOM: с атрибутом, поставленным после, расхождения нет вовсе, и тест был
   * бы зелёным при любом коде.
   */
  test('атрибут расширения в <body> не поднимает шум о гидратации', async ({ page }) => {
    const hydrationErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() !== 'error') return
      const text = message.text()
      if (/hydrat/i.test(text)) hydrationErrors.push(text.slice(0, 400))
    })
    page.on('pageerror', (error) => {
      if (/hydrat/i.test(String(error))) hydrationErrors.push(String(error).slice(0, 400))
    })

    await signIn(page)
    // `setInterval`, а не готовый `document.body`: на момент init-скрипта тело
    // документа ещё не распарсено, и одиночная попытка промахнулась бы.
    await page.addInitScript(() => {
      const stamp = (): void => {
        if (document.body && !document.body.hasAttribute('data-gptw')) {
          document.body.setAttribute('data-gptw', '')
        }
      }
      const timer = setInterval(stamp, 1)
      setTimeout(() => clearInterval(timer), 8_000)
      stamp()
    })

    await page.goto(`${APP}/security-ops/events/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    expect(
      hydrationErrors,
      `атрибут расширения в <body> поднял шум о гидратации: ${hydrationErrors.join(' | ')}`,
    ).toEqual([])

    // Атрибут ДЕЙСТВИТЕЛЬНО дошёл до DOM — иначе проба вакуумна: мы бы мерили
    // гидратацию нетронутой страницы, где расхождения нет по определению.
    await expect(page.locator('body[data-gptw]')).toBeAttached()
  })
})
