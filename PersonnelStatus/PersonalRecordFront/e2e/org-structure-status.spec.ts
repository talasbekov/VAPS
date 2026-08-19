/**
 * Оргструктура не выдаёт отсутствие статуса за «В строю» — ЖИВОЙ стенд.
 *
 * Фолбэк `current_status?.status_type || "in_service"` стоял в шести местах
 * (`lib/api.ts` дважды, `OrgChart` четырежды, `OrgBoard` дважды) и врал тем
 * заметнее, чем меньше данных:
 *
 * * вакантная должность получала `status: "in_service"` ЛИТЕРАЛОМ и светилась
 *   зелёной точкой наравне с работающим человеком;
 *
 * * сотрудник без статуса подписывался «В строю».
 *
 * Проба смотрит на вакансию: это единственный случай, который на стенде
 * достижим наверняка — у всех живых сотрудников статус теперь есть по
 * инварианту (сигнал + `ensure_employee_statuses`).
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /тему|theme/i }).first()).toBeEnabled({
    timeout: 20_000,
  })
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'оргструктура: статус' : 'оргструктура (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('вакантная должность не подписана «В строю» и не светится зелёным', async ({ page }) => {
    await signIn(page, 'admin', 'admin123')
    await page.goto('/organization')
    await hydrated(page)

    // Ждём отрисовки дерева, а не просто загрузки страницы.
    await expect(page.getByText('Вакантная должность').first()).toBeVisible({ timeout: 25_000 })

    const vacancies = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('*')].filter(
        (element) =>
          element.children.length === 0 &&
          element.textContent?.trim() === 'Вакантная должность',
      )
      return nodes.map((node) => {
        // Карточка узла: поднимаемся, пока не найдём блок с точкой-индикатором.
        let card: Element | null = node
        for (let step = 0; step < 6 && card !== null; step += 1) {
          const dot = card.querySelector('.rounded-full.border-2')
          if (dot !== null) {
            return {
              dotClass: dot.className,
              text: (card.textContent ?? '').replace(/\s+/g, ' ').trim(),
            }
          }
          card = card.parentElement
        }
        return { dotClass: '', text: (node.textContent ?? '').trim() }
      })
    })

    expect(vacancies.length, 'на стенде нет вакансий — проба вакуумна').toBeGreaterThan(0)

    for (const vacancy of vacancies) {
      // 🔴 Ключевое: «В строю» рядом с вакансией — это вернувшийся фолбэк.
      expect(vacancy.text, `вакансия подписана статусом: ${vacancy.text}`).not.toContain(
        'В строю',
      )
      // Зелёная точка — тот же фолбэк, только цветом.
      expect(
        vacancy.dotClass,
        `точка вакансии зелёная (${vacancy.dotClass}) — статус выдуман`,
      ).not.toContain('bg-green')
    }
  })

  test('сотрудник с настоящим статусом по-прежнему им подписан', async ({ page }) => {
    // Обратная сторона: убрав фолбэк, легко потерять и настоящие статусы.
    await signIn(page, 'admin', 'admin123')
    await page.goto('/organization')
    await hydrated(page)
    await expect(page.getByText('Вакантная должность').first()).toBeVisible({ timeout: 25_000 })

    const painted = await page.evaluate(() => {
      const dots = [...document.querySelectorAll('.rounded-full.border-2')]
      return dots.filter((dot) => !dot.className.includes('bg-gray')).length
    })
    expect(painted, 'ни одной цветной точки — статусы потерялись вовсе').toBeGreaterThan(0)
  })
})
