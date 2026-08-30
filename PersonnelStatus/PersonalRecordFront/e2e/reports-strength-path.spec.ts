/**
 * Строевая записка различает одноимённые подразделения (Plane №327).
 *
 * Что было. На /reports → «Показать расход» подряд шли «Второе сквозное
 * управление» ×3, «Второе управление» ×3, «Второй отдел» ×5 — с одинаковыми
 * числами и без указания, чьи они. Имена уникальны только внутри родителя, и
 * совпадающие числа рядом с одинаковым именем читаются как дубль выгрузки, то
 * есть как ошибка там, где ошибки нет.
 *
 * Что стережёт проба. Не «путь напечатан вообще», а РАЗЛИЧИМОСТЬ: берётся имя,
 * которое на стенде встречается больше одного раза, и проверяется, что у его
 * строк разные подписи. Мутация «убрать путь из ячейки» её краснит.
 */
import { expect, test } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

test.describe(LIVE ? 'строевая записка' : 'строевая записка (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('одноимённые подразделения различаются путём', async ({ page }) => {
    // Имя-двойник берётся ИЗ ОТВЕТА сервера, а не задаётся литералом: состав
    // стенда меняется, а вот то, что имена повторяются, — свойство структуры.
    const tokenRes = await fetch(`${API}/api/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
    })
    expect(tokenRes.status).toBe(200)
    const { access } = (await tokenRes.json()) as { access: string }
    const reportRes = await fetch(`${API}/api/operations/strength-report/`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    expect(reportRes.status).toBe(200)
    const report = (await reportRes.json()) as {
      rows: { division_id: number; name: string; ancestors?: string[] }[]
    }
    const byName = new Map<string, { division_id: number; ancestors?: string[] }[]>()
    for (const row of report.rows) {
      byName.set(row.name, [...(byName.get(row.name) ?? []), row])
    }
    const twins = [...byName.entries()].find(([, rows]) => rows.length > 1)
    test.skip(twins === undefined, 'на стенде нет одноимённых подразделений — проверять нечего')
    const [twinName, twinRows] = twins!

    // Сервер обязан отдать РАЗНЫЕ пути — иначе экрану нечем их различить.
    const paths = twinRows.map((row) => (row.ancestors ?? []).join(' › '))
    expect(new Set(paths).size, `«${twinName}»: сервер отдал одинаковые пути ${paths}`)
      .toBe(twinRows.length)

    const csrf = (await (await page.context().request.get(`${APP}/api/auth/csrf/`)).json()) as {
      csrfToken: string
    }
    await page.context().request.post(`${APP}/api/auth/callback/credentials/`, {
      form: {
        csrfToken: csrf.csrfToken,
        username: STAND_USERNAME,
        password: STAND_PASSWORD,
        json: 'true',
      },
    })
    await page.goto(`${APP}/reports`, { waitUntil: 'domcontentloaded' })
    // 🔴 ЖДЁМ ГИДРАТАЦИЮ. `domcontentloaded` наступает до неё, и нажатие
    // уходит в разметку без обработчика: кнопка «нажата», состояние не
    // менялось, таблицы нет — проба обвиняла бы исправный экран (класс Plane
    // №293). Признак готовности — ответ сессии, за которым экран становится
    // рабочим.
    await page.waitForLoadState('networkidle')
    const load = page.waitForResponse(
      (res) => res.url().includes('/api/operations/strength-report/'),
      { timeout: 60_000 },
    )
    await page.getByRole('button', { name: 'Показать расход' }).click()
    await load
    const table = page.getByRole('table')
    await expect(table).toBeVisible({ timeout: 60_000 })

    // Ячейки с этим именем — их ровно столько же, сколько строк у двойника,
    // и текст у каждой СВОЙ.
    const cells = table.getByRole('cell').filter({ hasText: twinName })
    await expect(cells).toHaveCount(twinRows.length)
    const texts = (await cells.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim())
    expect(
      new Set(texts).size,
      `«${twinName}»: строки записки неразличимы — ${JSON.stringify(texts)}`,
    ).toBe(twinRows.length)
  })
})
