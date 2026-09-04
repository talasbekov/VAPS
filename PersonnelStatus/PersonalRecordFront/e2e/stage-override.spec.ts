/**
 * Проход админа по этапам ОМ на ЖИВОМ стенде (задача «админ проходит все
 * этапы без подтверждений»).
 *
 * Пробы отвечают на три РАЗНЫХ вопроса, и ни один не выводится из остальных:
 *
 * 1. клик по шагу цепочки ПОКАЗЫВАЕТ его панель, но НЕ трогает стадию на
 *    сервере — иначе «посмотреть» и «перевести» слиплись бы в одно действие,
 *    и разбор чужого ОМ менял бы его;
 * 2. форма чужого шага выключена по-настоящему (`inert`), а не «выглядит
 *    бледной»: ассерт на непрохождение клика, а не на класс opacity;
 * 3. «Перевести ОМ сюда» меняет стадию НА СЕРВЕРЕ (проверяется запросом к
 *    API, а не текстом на экране) и снимает режим просмотра.
 *
 * Фикстура ищется по названию и переиспользуется: у ОМ нет удаления, и проба,
 * заводящая мероприятие каждый прогон, за неделю забивает реестр (ровно та
 * беда, которая уже есть на стенде — 188 пробных строк из 194).
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const FIXTURE_TITLE = 'Проба перевода этапов (e2e)'

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

interface EventRow {
  id: string
  code: string
  stage: string
  title: string
}

/** Своё ОМ: ищем по названию, заводим только если его ещё нет. */
async function fixtureEvent(token: string): Promise<EventRow> {
  const headers = { Authorization: `Bearer ${token}` }
  const list = (await (
    await fetch(`${API}/api/ops/security-events/?page_size=300`, { headers })
  ).json()) as { results: EventRow[] }
  const found = list.results.find((row) => row.title === FIXTURE_TITLE)
  if (found !== undefined) return found
  const created = await fetch(`${API}/api/ops/security-events/`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: FIXTURE_TITLE,
      businessDate: '2026-09-01',
      kind: 'INTERNAL',
    }),
  })
  return (await created.json()) as EventRow
}

/** Стадия ОМ по версии СЕРВЕРА — единственный судья того, что перевод был. */
async function serverStage(token: string, id: string): Promise<string> {
  const res = await fetch(`${API}/api/ops/security-events/${id}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { stage: string }).stage
}

async function setStage(token: string, id: string, stage: string): Promise<void> {
  await fetch(`${API}/api/ops/security-events/${id}/stage/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ stage }),
  })
}

test.describe(LIVE ? 'проход по этапам (админ)' : 'проход по этапам (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('клик по шагу показывает его панель и НЕ двигает стадию', async ({ page }) => {
    const token = await apiToken()
    const event = await fixtureEvent(token)
    // Каждый прогон начинается с известной стадии: фикстура переиспользуется,
    // и предыдущий прогон мог оставить её на другом шаге.
    await setStage(token, event.id, 'RECON')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${event.id}/`)

    const approvalStep = page.getByRole('button', { name: '3. Согласование' })
    await expect(approvalStep).toBeVisible({ timeout: 20_000 })
    await approvalStep.click()

    // Заголовок сменился на просматриваемый этап…
    await expect(page.getByRole('heading', { name: 'Согласование расстановки' })).toBeVisible()
    // …режим просмотра назван словами, а не одним оттенком…
    const notice = page.locator('[data-slot="stage-view-notice"]')
    // Баннер одной строкой (`[РЕК-03]`, Plane №442): шаг не открыт, ОМ на шаге 1.
    await expect(notice).toContainText('Этап ещё не открыт')
    await expect(notice).toContainText('мероприятие на шаге 1')
    await page.screenshot({ path: require('node:path').join(__dirname, '..', '..', '..', '..', 'docs', 'audit', 'om-2026-09-03', 'stage-header-banner.png') })
    // …и адрес несёт шаг: такую ссылку пересылают на разборе.
    await expect(page).toHaveURL(/[?&]step=3/)

    // Главное: сервер не тронут.
    expect(await serverStage(token, event.id)).toBe('RECON')
  })

  test('форма чужого шага выключена по-настоящему, а не бледная', async ({ page }) => {
    const token = await apiToken()
    const event = await fixtureEvent(token)
    await setStage(token, event.id, 'RECON')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${event.id}/?step=4`)
    await expect(page.locator('[data-slot="stage-view-notice"]')).toBeVisible({
      timeout: 20_000,
    })

    // Ассерт по ПОВЕДЕНИЮ, а не по классу: `opacity-60` не отличает
    // «выключено» от «покрашено бледным».
    //
    // 🔴 И не через `control.click()` из JS: программный клик проходит даже по
    // inert-поддереву (inert снимает пользовательское взаимодействие и фокус,
    // а не диспетчеризацию событий) — такая проба была бы КРАСНОЙ на рабочем
    // коде. Судим по фокусу: inert исключает поддерево из порядка обхода, и
    // `.focus()` внутрь не проходит — этого `.click()` обойти не может.
    const state = await page.evaluate(() => {
      const notice = document.querySelector('[data-slot="stage-view-notice"]')
      const panel = notice?.nextElementSibling as HTMLElement | null | undefined
      if (panel === null || panel === undefined) return { reason: 'панели нет' }
      const control = panel.querySelector<HTMLElement>(
        'button, input, textarea, select'
      )
      if (control === null) return { reason: 'нет контролов' }
      control.focus()
      return {
        reason: 'ok',
        inert: panel.hasAttribute('inert'),
        // Контрол ЕСТЬ и он видим — без этого «фокус не зашёл» был бы
        // вакуумным: в пустую панель он не зашёл бы и без inert.
        controlVisible: control.getClientRects().length > 0,
        focusEntered: document.activeElement === control,
      }
    })
    expect(state.reason).toBe('ok')
    expect(state.controlVisible).toBe(true)
    expect(state.inert).toBe(true)
    expect(state.focusEntered).toBe(false)
  })

  test('«Перевести ОМ сюда» двигает стадию на сервере и снимает просмотр', async ({
    page,
  }) => {
    const token = await apiToken()
    const event = await fixtureEvent(token)
    await setStage(token, event.id, 'RECON')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${event.id}/?step=4`)
    const notice = page.locator('[data-slot="stage-view-notice"]')
    await expect(notice).toBeVisible({ timeout: 20_000 })

    await notice.getByRole('button', { name: 'Перевести ОМ сюда' }).click()
    // Перевод — с подтверждением (`[РЕК-03]`, Plane №442).
    const confirm = page.locator('[data-slot="stage-override-confirm"]')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Перевести', exact: true }).click()

    // Режим просмотра снялся сам — шаг стал текущим, а не «разблокирован».
    await expect(notice).toBeHidden({ timeout: 15_000 })
    // Судья — сервер, а не надпись на экране.
    expect(await serverStage(token, event.id)).toBe('ACKNOWLEDGEMENT')

    // Возврат фикстуры к известной стадии — следующий прогон начинается с неё.
    await setStage(token, event.id, 'RECON')
  })

  test('без права обхода цепочка только показывает', async ({ page }) => {
    // Персона БЕЗ права — обязательная половина проверки: у стендового admin
    // права приходят одной звёздочкой «*», и на нём закрытое состояние
    // недостижимо, то есть гвард нечем отличить от его отсутствия. Права
    // подменяем ответом ручки, а не выдумываем роль: предмет проверки —
    // поведение экрана на списке прав без `event.stage_override`.
    const token = await apiToken()
    const event = await fixtureEvent(token)
    await setStage(token, event.id, 'RECON')

    await signIn(page)
    await page.route('**/api/operations/my-permissions/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ permissions: ['event.view', 'event.manage'] }),
      })
    })

    // Даже прямая ссылка на чужой шаг не открывает его: параметр адреса без
    // права не действует, иначе он был бы дырой в обход гварда.
    await page.goto(`${APP}/security-ops/events/${event.id}/?step=4`)
    await expect(
      page.getByRole('heading', { name: 'Рекогносцировка объекта' })
    ).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-slot="stage-view-notice"]')).toHaveCount(0)

    // Шаг остаётся статичной меткой: кликабельная на вид, но мёртвая пилюля —
    // обещание действия, которого нет.
    await expect(page.getByRole('button', { name: '3. Согласование' })).toHaveCount(0)
    await expect(page.getByText('3. Согласование')).toBeVisible()
  })
})
