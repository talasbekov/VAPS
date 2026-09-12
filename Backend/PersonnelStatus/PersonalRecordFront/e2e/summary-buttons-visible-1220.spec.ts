/**
 * Кнопки «Собрать свод» / «Отправить дежурному» на экране ответственного
 * ВИДНЫ (Plane №1220, 12.09.2026).
 *
 * Дефект: CSS-модуль экрана `responsible-daily.module.css` объявил на
 * `.screen` свой `--primary:#2563eb` (hex), а тема shadcn ждёт в `--primary`
 * HSL-тройку. Любая кнопка `bg-primary` внутри экрана получала
 * `hsl(#2563eb)` — невалидный цвет — и рисовалась белым по прозрачному.
 * Шесть соседних спек кликали такую кнопку и оставались зелёными: Playwright
 * цвет не проверяет. Поэтому здесь две пробы:
 *
 *  1. СТАТИЧЕСКАЯ (без стенда): ни один CSS-модуль (`features/`, `app/`,
 *     `components/`) не объявляет токен, объявленный в `app/globals.css`
 *     (`--primary`, `--muted`, `--background`, …) — падает на мутации
 *     «вернуть `--primary` в модуль» ещё до сборки. Модуль читает токены
 *     темы через `var(...)`, а свои называет с префиксом (`--rd-primary`).
 *  2. ЖИВАЯ (`SMOKE_LIVE=1`): у главной кнопки блока «Суточный свод» фон
 *     непрозрачный и отличается от цвета текста.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
const OFFICER = 'role_forces_gathering_officer'

/**
 * Токены темы — ЧИТАЮТСЯ из `app/globals.css`, а не перечисляются руками:
 * список в пробе устарел бы при первом новом токене. Модуль экрана вправе
 * читать их (`var(--primary)`), но не объявлять (`--primary:`).
 */
function themeTokens(): string[] {
  const globals = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
  return [...new Set([...globals.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]))]
}

function declaredTokens(css: string, tokens: string[]): string[] {
  return tokens.filter((token) => new RegExp(`(^|[{;\\s])${token.replace(/[-]/g, '\\-')}\\s*:`, 'm').test(css))
}

function cssModules(): string[] {
  const roots = ['features', 'app', 'components']
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.module.css')) found.push(full)
    }
  }
  for (const root of roots) if (fs.existsSync(root)) walk(root)
  return found
}

async function signIn(page: Page, username: string): Promise<void> {
  const csrf = await page.request.get(`${APP}/api/auth/csrf/`)
  const csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken
  const response = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken, username, password: ROLE_PASSWORD, json: 'true' },
  })
  expect(((await response.json()) as { url: string }).url, `вход ${username}`).not.toContain('error=')
}

function parseRgba(value: string): { r: number; g: number; b: number; a: number } {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(value)
  expect(match, `цвет не разобран: ${value}`).not.toBeNull()
  const [, r, g, b, a] = match as RegExpExecArray
  return { r: Number(r), g: Number(g), b: Number(b), a: a === undefined ? 1 : Number(a) }
}

test.describe('№1220 — кнопки свода видны на экране ответственного', () => {
  test('ни один CSS-модуль не объявляет токены темы из globals.css', () => {
    const tokens = themeTokens()
    expect(tokens.length, 'globals.css без токенов — проба читает не тот файл').toBeGreaterThan(10)
    const offenders = cssModules()
      .map((file) => ({ file: path.relative(process.cwd(), file), declared: declaredTokens(fs.readFileSync(file, 'utf8'), tokens) }))
      .filter((entry) => entry.declared.length > 0)
    expect(offenders, 'модуль тенит токены темы shadcn — кнопки bg-primary/bg-muted внутри экрана ломаются').toEqual([])
  })

  test('главная кнопка блока «Суточный свод» — непрозрачный фон, текст отличим', async ({ page }) => {
    test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
    test.skip(ROLE_PASSWORD === '', 'нет пароля ролевых учёток')
    test.setTimeout(120_000)

    await signIn(page, OFFICER)
    await page.goto(`${APP}/employees?view=daily`, { waitUntil: 'networkidle' })
    const region = page.getByRole('region', { name: 'Суточный свод' })
    await expect(region).toBeVisible({ timeout: 60_000 })

    // Какая из ступеней сейчас на экране — зависит от состояния свода на дату
    // (не собран / собран / отправлен). Проверяем ту, что отрисована; если
    // свод уже отправлен, кнопки нет по праву — тогда пробе нечего мерить.
    const button = region.getByRole('button', { name: /^(Собрать свод|Отправить дежурному|Подтвердить отправку)$/ })
    const count = await button.count()
    const sent = await region.getByText(/^Отправлено /).count()
    test.skip(count === 0 && sent > 0, 'свод на дату уже отправлен — кнопки нет по праву')
    expect(count, 'в блоке «Суточный свод» нет ни одной кнопки ступени').toBeGreaterThan(0)

    const first = button.first()
    await expect(first).toBeVisible()
    const styles = await first.evaluate((element) => {
      const computed = getComputedStyle(element)
      return { background: computed.backgroundColor, color: computed.color }
    })
    const background = parseRgba(styles.background)
    const color = parseRgba(styles.color)
    expect(background.a, `фон кнопки прозрачный: ${styles.background}`).toBeGreaterThan(0.9)
    const distance = Math.abs(background.r - color.r) + Math.abs(background.g - color.g) + Math.abs(background.b - color.b)
    expect(distance, `текст ${styles.color} сливается с фоном ${styles.background}`).toBeGreaterThan(200)
  })
})
