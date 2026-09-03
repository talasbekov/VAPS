/**
 * Метка «В разработке» на незавершённых частях портала (Plane №450).
 *
 * Заказчик: «если работа не закончена и эта часть ещё полноценно не
 * работает, проставь везде … метку, что в разработке». Проба читает три места,
 * где метка живёт, и одно, где её быть НЕ должно:
 *
 *  1) шапка экрана «Реестр ОМ» — капсула «В разработке» с полным списком
 *     недоделок в `title`/`aria-label` (номера карточек Plane);
 *  2) пункт меню «Реестр ОМ» — капсула внутри ссылки, а ИМЯ ссылки не
 *     изменилось (в нём только название и прежний счётчик), список идёт
 *     описанием (`aria-describedby`);
 *  3) шапка этапа карточки ОМ — своя метка про ЭТОТ этап;
 *  4) «Обзор» (`/dashboard`) — открытых карточек нет, метки нет.
 *
 * КРАСНОТА НА МУТАЦИИ: убери запись `/security-ops/events` из
 * `shared/config/in-development.ts` — (1) и (2) красны; добавь запись
 * `/dashboard` — красна (4).
 */
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const SHOTS = path.join(__dirname, '..', '..', '..', '..', 'docs', 'audit', 'om-2026-09-03')

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'метка «в разработке»' : 'метка «в разработке» (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('реестр ОМ: метка в шапке и в меню, имя пункта не изменилось', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const header = page.locator('main [data-slot="in-development"]').first()
    await expect(header).toBeVisible()
    await expect(header).toHaveText(/В разработке/)
    await expect(header).toHaveAttribute('title', /№4\d\d/)
    await expect(header).toHaveAttribute('aria-label', /^В разработке: /)

    const aside = page.locator('aside')
    // Имя ссылки начинается с названия пункта: счётчик «Мероприятий в
    // реестре: N» в имени уже был, метка — нет (она `aria-hidden`).
    const link = aside.getByRole('link', { name: /^Реестр ОМ( Мероприятий в реестре: \d+)?$/ })
    await expect(link).toBeVisible()
    await expect(link.locator('[data-slot="in-development"]')).toBeVisible()
    await expect(link).toHaveAttribute('aria-describedby', /.+/)
    // Пункт без открытых карточек метки не несёт.
    const overview = aside.getByRole('link', { name: 'Обзор', exact: true })
    await expect(overview.locator('[data-slot="in-development"]')).toHaveCount(0)
    await page.screenshot({ path: path.join(SHOTS, 'in-development-events.png'), fullPage: false })
  })

  test('карточка ОМ: у шапки этапа своя метка', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    const first = page.locator('main').getByRole('link', { name: /Открыть этапы мероприятия/ }).first()
    await expect(first, 'в реестре нет ни одного ОМ').toBeVisible()
    await first.click()
    await expect(page).toHaveURL(/\/security-ops\/events\/[^/]+\/?/)

    const stage = page.locator('[data-slot="stage-heading"] [data-slot="in-development"]')
    await expect(stage).toBeVisible()
    await expect(stage).toHaveAttribute('title', /№4\d\d/)
    await page.screenshot({ path: path.join(SHOTS, 'in-development-stage.png'), fullPage: false })
  })

  test('обзор: метки нет — открытой работы по нему нет', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('main [data-slot="in-development"]')).toHaveCount(0)
  })
})
