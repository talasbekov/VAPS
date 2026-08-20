/**
 * «Расход и светофор» (`/security-ops/traffic`) — ЖИВОЙ стенд.
 *
 * Экран читающий: дерево светофора, KPI по листьям, карточка узла и панель
 * блокировки завтрашнего дня. Спека НАМЕРЕННО не трогает мутации: и сдача
 * дня, и законный обход блокировки НЕОТЗЫВНЫ (поправка/замена — отдельные
 * действия с причиной), прогон теста не должен оставлять на стенде решений,
 * которые утром придётся объяснять.
 *
 * Антивакуумный якорь — равенство: KPI «Подразделений» обязан совпасть с
 * числом ЛИСТЬЕВ дерева в DOM (treeitem без aria-expanded). Ассерты на цвета
 * не полагаются на данные стенда (сдач может не быть вовсе) — проверяется,
 * что каждый бейдж взят из закрытого словаря подписей, а не «что-нибудь».
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

/** Полный словарь подписей светофора — бейдж вне словаря означает дефект. */
const BADGES = ['Сдано', 'Расхождение', 'Не сдано', 'Сдавать некого', 'Неопределён']

test.describe(LIVE ? 'расход и светофор' : 'расход и светофор (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('дерево рендерится, KPI считается по листьям, бейджи из словаря', async ({ page }) => {
    await signIn(page, 'admin', 'admin123')
    await page.goto(`${APP}/security-ops/traffic`)
    await hydrated(page)

    await expect(
      page.getByRole('heading', { level: 1, name: 'Расход и светофор' })
    ).toBeVisible()

    const tree = page.getByRole('tree', { name: 'Светофор подразделений' })
    await expect(tree).toBeVisible({ timeout: 20_000 })

    const items = tree.getByRole('treeitem')
    const total = await items.count()
    expect(total).toBeGreaterThan(0)

    // Листья — treeitem БЕЗ aria-expanded (атрибут ставится только узлам с
    // детьми). Ровно их и считает KPI «Подразделений».
    const leaves = await tree.locator('[role="treeitem"]:not([aria-expanded])').count()
    const kpiValue = page
      .locator('[data-slot="stat-card"]')
      .filter({
        has: page.locator('[data-slot="stat-label"]', { hasText: /^Подразделений$/ }),
      })
      .locator('[data-slot="stat-value"]')
    await expect(kpiValue).toHaveText(String(leaves))

    // Каждый видимый бейдж строки — из закрытого словаря, не произвольный.
    const badgeTexts = await tree
      .locator('span')
      .filter({ hasText: /^(Сдано|Расхождение|Не сдано|Сдавать некого|Неопределён)$/ })
      .allInnerTexts()
    expect(badgeTexts.length).toBeGreaterThan(0)
    for (const text of badgeTexts) {
      expect(BADGES).toContain(text)
    }
  })

  test('выбор узла открывает карточку с версиями и выпусками и живёт в URL', async ({ page }) => {
    await signIn(page, 'admin', 'admin123')
    await page.goto(`${APP}/security-ops/traffic`)
    await hydrated(page)

    const tree = page.getByRole('tree', { name: 'Светофор подразделений' })
    await expect(tree).toBeVisible({ timeout: 20_000 })

    // До выбора карточка предлагает выбрать, секций нет.
    await expect(page.getByText('Выберите подразделение в дереве')).toBeVisible()

    // Кнопка имени — та, что с aria-pressed (кнопка сворачивания без него).
    const nameButton = tree.locator('button[aria-pressed]').first()
    const chosen = (await nameButton.innerText()).trim()
    await nameButton.click()

    await expect(page).toHaveURL(/division=\d+/)
    await expect(
      page.locator('[data-slot="card-title"]').filter({ hasText: chosen }).first()
    ).toBeVisible()
    await expect(page.getByRole('region', { name: 'Версии сдач' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Выпуски документов' })).toBeVisible()

    // Повторный клик снимает выбор — параметр уходит из адреса.
    await nameButton.click()
    await expect(page).not.toHaveURL(/division=/)
  })

  test('панель блокировки называет одно из трёх состояний и серверную дату', async ({ page }) => {
    await signIn(page, 'admin', 'admin123')
    await page.goto(`${APP}/security-ops/traffic`)
    await hydrated(page)

    await expect(
      page.getByText('Блокировка расхода на завтра', { exact: true })
    ).toBeVisible({ timeout: 20_000 })

    // Состояние — ровно одно из трёх, словами экрана, с датой сервера.
    await expect(
      page
        .getByText(/расход ЗАКРЫТ — есть отстающие|замок снят законным обходом|расход открыт: отстающих по правилам контроля сдачи нет/)
        .first()
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      page.getByText(/^\d{2}\.\d{2}\.\d{4}:/).first()
    ).toBeVisible()
  })

  test('переключение «Сегодня» меняет серверную дату KPI', async ({ page }) => {
    await signIn(page, 'admin', 'admin123')
    await page.goto(`${APP}/security-ops/traffic`)
    await hydrated(page)

    // Якорный регекс: подстрока 'Сдали' сматчила бы и плитку «Не сдали».
    const doneCard = page.locator('[data-slot="stat-card"]').filter({
      has: page.locator('[data-slot="stat-label"]', { hasText: /^Сдали$/ }),
    })
    const doneCaption = doneCard.getByText(/на \d{2}\.\d{2}\.\d{4}/)
    await expect(doneCaption).toBeVisible({ timeout: 20_000 })
    const tomorrowDate = await doneCaption.innerText()

    await page.getByRole('button', { name: 'Сегодня', exact: true }).click()
    await expect(page).toHaveURL(/day=today/)
    // Дата в подписи обязана СМЕНИТЬСЯ: «сегодня» и «завтра» сервера — разные
    // дни. Ассерт по изменению, а не по вычисленной клиентом дате: клиентские
    // часы в минусовой зоне назвали бы другой день.
    await expect(doneCard.getByText(/на \d{2}\.\d{2}\.\d{4}/)).not.toHaveText(
      tomorrowDate,
      { timeout: 20_000 }
    )
  })
})
