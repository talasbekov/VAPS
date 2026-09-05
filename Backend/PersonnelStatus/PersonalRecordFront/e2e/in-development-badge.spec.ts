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
import { inDevelopmentOfStage } from '../shared/config/in-development'
import type { SecurityEventStage } from '../entities/security-event'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SHOTS = path.join(__dirname, '..', '..', '..', '..', 'docs', 'audit', 'om-2026-09-03')

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

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
    /**
     * ⚠️ ПРОБА БОЛЬШЕ НЕ БЕРЁТ «ПЕРВОЕ ПОПАВШЕЕСЯ» ОМ, и это поправлено
     * ОСОЗНАННО (Plane №540/№597). Раньше она открывала первую строку реестра и
     * требовала метку у ЛЮБОГО этапа — то есть молча полагала, что открытая
     * работа есть на каждом. С закрытием №446 у этапа «Согласование» её не
     * осталось, запись опустела, и метка стала пустой («В разработке: » без
     * пунктов). Проба этого не поймала: пустая метка ВИДНА, а `title` она не
     * сверяла с содержимым.
     *
     * Теперь мероприятие выбирается по этапу, у которого запись ЕСТЬ, — а то,
     * что пустых записей не бывает вовсе, стережёт чистая проба
     * `in-development-registry.spec.ts`. Вместе они проверяют оба утверждения:
     * «где работа есть — метка есть» и «где её нет — метки нет».
     */
    const token = await apiToken()
    const rows = (await (
      await fetch(`${API}/api/ops/security-events/?page_size=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: { id: string; stage: SecurityEventStage }[] }
    const target = rows.results.find((row) => inDevelopmentOfStage(row.stage) !== null)
    expect(target, 'в реестре нет ОМ на этапе с открытой работой').toBeTruthy()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)

    const stage = page.locator('[data-slot="stage-heading"] [data-slot="in-development"]')
    await expect(stage).toBeVisible({ timeout: 20_000 })
    await expect(stage).toHaveAttribute('title', /№4\d\d/)
    await page.screenshot({ path: path.join(SHOTS, 'in-development-stage.png'), fullPage: false })
  })

  test('«Ежедневный расход» без метки, «Сбор сил» с меткой (Plane №598)', async ({ page }) => {
    /**
     * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. По `/employees` живут ДВА модуля, и выбирает между
     * ними `?view=`: без него — «Ежедневный расход организации», с
     * `?view=forces` — «Сбор сил на ОМ». Все три пункта записи `/employees` —
     * недоделки сбора сил (№425, №426, №444), а реестр сопоставляет только
     * `pathname`, поэтому метка объявлялась и на расходе, у которого открытых
     * карточек нет вовсе. Читателю сообщали неправду о готовности — ровно
     * наоборот тому, ради чего метка заведена.
     *
     * Мутация, на которой проба обязана краснеть: вернуть `PageHeader` без
     * `inDevelopment={view === "forces"}` — метка появится на расходе.
     */
    await signIn(page)

    await page.goto(`${APP}/employees`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('main [data-slot="in-development"]')).toHaveCount(0)

    await page.goto(`${APP}/employees?view=forces`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 })
    const badge = page.locator('main [data-slot="in-development"]').first()
    await expect(badge).toBeVisible({ timeout: 20_000 })
    // Подпись называет карточки сбора сил, а не пустоту.
    await expect(badge).toHaveAttribute('title', /№4\d\d/)
  })

  test('обзор: метки нет — открытой работы по нему нет', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('main [data-slot="in-development"]')).toHaveCount(0)
  })
})
