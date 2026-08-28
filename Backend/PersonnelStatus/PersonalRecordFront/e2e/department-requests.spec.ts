/**
 * «Заявки департаменту» на `/employees?view=forces` (Plane №272, Ш-3).
 *
 * ОБРАТНЫЙ РАЗРЕЗ ЦЕПОЧКИ. Выше на том же экране живёт лента ШТАБА
 * («кому я раздал»), здесь — вид ДЕПАРТАМЕНТА («что просят у меня»). Это не
 * то же представление под фильтром: колонки, порядок и вопрос другие.
 *
 * Стережёт три вещи, каждая из которых уже была сломана и починена по
 * снимку экрана:
 *
 * 1. блок вообще отрисован и получил данные (а не молча пуст на 404 ручки);
 * 2. департамент НАЗВАН в строке — у одного мероприятия заявок столько,
 *    между сколькими департаментами штаб разделил потребность, и без имени
 *    две строки читаются как дубль (так и выглядело на первом снимке);
 * 3. перебор виден ЧИСЛОМ, а не только цветом полосы: «5 из 2» и «2 из 2»
 *    рисуют одинаково полную полосу, то есть «всё в порядке».
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface RequestRow {
  code: string
  departmentName: string
  need: number
  assigned: number
}

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

test.describe('заявки департаменту', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('таблица собрана из ручки заявок и называет департамент каждой строки', async ({
    page,
  }) => {
    const token = await apiToken()
    const server = (await (
      await fetch(`${API}/api/ops/security-events/forces/requests/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: RequestRow[] }
    expect(
      server.results.length,
      'на стенде нет ни одной заявки департаменту — таблице нечего показать',
    ).toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}/employees?view=forces`)
    // Заявки живут ВКЛАДКОЙ (эталон заказчика), а не блоком над экраном:
    // блок сверху делал свою таблицу первой на странице и ронял шесть проб
    // кадрового реестра, ищущих колонку по первой таблице.
    const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
    await expect(tab).toBeVisible({ timeout: 30_000 })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')

    const section = page.locator('section[aria-labelledby="department-requests-heading"]')
    await expect(section.getByRole('heading', { name: 'Заявки департаменту' })).toBeVisible({
      timeout: 30_000,
    })
    const rows = section.locator('tbody tr')
    await expect(rows, 'строк столько же, сколько отдала ручка').toHaveCount(
      server.results.length,
      { timeout: 20_000 },
    )

    // Департамент назван — иначе две заявки одного ОМ неотличимы.
    for (const row of server.results) {
      await expect(
        section.getByText(row.departmentName, { exact: false }).first(),
        `департамент «${row.departmentName}» не назван в таблице`,
      ).toBeVisible()
    }

    // Прогресс читается ЧИСЛОМ, а не только полосой.
    const first = server.results[0]
    await expect(
      section.getByText(`${first.assigned} из ${first.need}`, { exact: false }).first(),
      'прогресс не назван числом',
    ).toBeVisible()

    // Полоса объявлена вспомогательным технологиям, а не нарисована деревом.
    const bar = section.locator('[role="progressbar"]').first()
    await expect(bar).toHaveAttribute('aria-valuemax', String(first.need))
    await expect(bar).toHaveAttribute('aria-valuenow', String(first.assigned))
  })

  test('перебор назван числом, а не спрятан за полной полосой', async ({ page }) => {
    const token = await apiToken()
    const server = (await (
      await fetch(`${API}/api/ops/security-events/forces/requests/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: RequestRow[] }
    const over = server.results.find((row) => row.need > 0 && row.assigned > row.need)
    test.skip(
      over === undefined,
      'на стенде нет заявки с перебором — проверять нечего (проба не мутирует стенд)',
    )

    await signIn(page)
    await page.goto(`${APP}/employees?view=forces`)
    const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
    await expect(tab).toBeVisible({ timeout: 30_000 })
    await tab.click()
    const section = page.locator('section[aria-labelledby="department-requests-heading"]')
    await expect(section.getByRole('heading', { name: 'Заявки департаменту' })).toBeVisible({
      timeout: 30_000,
    })

    await expect(
      section.getByText(`перебор ${over!.assigned - over!.need}`, { exact: false }),
      'перебор не назван числом — полная полоса читается как «всё в порядке»',
    ).toBeVisible()
  })
})
