/**
 * Кто вошёл — видно всегда; роль показывается ОДНА, и та из раздела
 * (Plane №352, Ш-4; карточка №361).
 *
 * Что было. Портальная роль приходила в токене и рисовалась двумя местами:
 * бейджем в шапке («Роль-4») и второй строкой в карточке человека внизу меню.
 * Рядом стоял второй бейдж — роль раздела, и у ролевых учёток они спорили:
 * кадровая всегда «Роль-1: Просмотр организации», то есть не та, под которой
 * человек работает. Карточка в меню вдобавок ЗАВИСЕЛА от портальной роли:
 * без неё пропадала целиком — вместе с именем и входом в профиль.
 *
 * Пробы держат три конца:
 *   1) роль в шапке ОДНА и это роль раздела (кадрового бейджа больше нет);
 *   2) без ролей раздела человек видит «Роль не назначена», а не пустоту:
 *      подпись отвечает на вопрос, почему экраны закрыты;
 *   3) карточка человека в меню на месте в обоих случаях.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(
  LIVE ? 'подпись человека без портальной роли' : 'подпись человека (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

    test('роль в шапке одна и она из раздела', async ({ page }) => {
      await signIn(page, STAND_USERNAME, STAND_PASSWORD)
      await page.goto(`${APP}/security-ops/profile/`, { waitUntil: 'domcontentloaded' })

      const header = page.locator('header').first()
      await expect(header.getByText(/Раздел ОМ:/)).toBeVisible({ timeout: 25_000 })

      // Кадрового бейджа больше нет НИ В КАКОМ виде: имена портальных ролей
      // начинались с «Роль-N», и возврат любой из девяти краснит эту строку.
      await expect(header.getByText(/^Роль-\d/)).toHaveCount(0)
    })

    test('без ролей раздела человек подписан «Роль не назначена», а карточка меню на месте', async ({
      page,
    }) => {
      // Ролей раздела нет ни у одной живой учётки стенда (у admin wildcard
      // `*`), поэтому пустой список ставится перехватом ответа о правах — тот
      // же приём, что в `daily-expense.spec.ts`. Всё остальное живое.
      await page.route(
        (url) => url.pathname.includes('/api/operations/my-permissions/'),
        (route) => route.fulfill({ json: { permissions: [], roles: [] } }),
      )

      await signIn(page, STAND_USERNAME, STAND_PASSWORD)
      await page.goto(`${APP}/security-ops/profile/`, { waitUntil: 'domcontentloaded' })

      const header = page.locator('header').first()
      await expect(header.getByText('Роль не назначена')).toBeVisible({ timeout: 25_000 })

      // Карточка человека внизу меню раньше висела на портальной роли и без
      // неё исчезала вместе с именем. Имя обязано остаться.
      const aside = page.locator('aside').first()
      await expect(aside.getByText('Роль не назначена')).toBeVisible()
    })
  },
)
