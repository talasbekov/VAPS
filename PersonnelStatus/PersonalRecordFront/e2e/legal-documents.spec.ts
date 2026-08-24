/**
 * Нормативная база ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на один вопрос: поиск и фильтр по виду действительно сужают
 * выборку (и переживают перезагрузку, потому что живут в URL), а не украшают
 * экран. Каждый шаг проверяет и попадание, и ОТСЕВ — фильтр, который ничего
 * не фильтрует, прошёл бы проверку «нужный документ виден».
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'законы об ОМ' : 'законы об ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('поиск и вид сужают выборку и держатся в URL', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    await signIn(page)
    await page.goto(`${APP}/security-ops/laws/`)
    await expect(page.getByRole('heading', { name: 'Законы об ОМ' })).toBeVisible()

    const cards = page.locator('main article')
    await expect(cards).toHaveCount(8)

    // Фильтр по виду: приказов ровно два, законы при этом уходят
    await page.getByRole('button', { name: 'Приказ', exact: true }).click()
    await expect(cards).toHaveCount(2)
    await expect(page.getByRole('heading', { name: 'О нормах расстановки постов' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'О государственной охране' })).toBeHidden()

    // Поиск ищет и по содержанию, не только по названию. Возврат к «Все»
    // ассертится ОТДЕЛЬНО: обе выборки едут в один URL, и без ожидания
    // подтверждённого сброса вида поиск лёг бы поверх ещё не снятого фильтра.
    await page.getByRole('button', { name: 'Все', exact: true }).click()
    await expect(cards).toHaveCount(8)
    await page.getByRole('textbox', { name: 'Поиск по нормативной базе' }).fill('журнала штаба')
    await expect(cards).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Регламент работы штаба при ОМ' })).toBeVisible()

    // Выборка живёт в URL и переживает перезагрузку
    expect(page.url()).toContain('search=')
    await page.reload()
    await expect(cards).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'Регламент работы штаба при ОМ' })).toBeVisible()

    // Пустая выборка названа, а не показана пустотой
    await page.getByRole('textbox', { name: 'Поиск по нормативной базе' }).fill('такого документа нет')
    await expect(page.getByText('Документы не найдены')).toBeVisible()

    // Статус «На пересмотре» отличается от «Действует» — плашка не декоративная
    await page.getByRole('textbox', { name: 'Поиск по нормативной базе' }).fill('Инструктаж')
    const card = page.locator('main article').first()
    await expect(card).toContainText('На пересмотре')
    // Файла у документа нет — кнопки скачивания быть не должно
    await expect(card).toContainText('Файл документа в системе не хранится')
    await expect(card.getByRole('button', { name: 'Скачать PDF' })).toHaveCount(0)

    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })

  test('без event.view нормативная база закрыта', async ({ page }) => {
    await signIn(page, 'observer', 'observer123')
    await page.goto(`${APP}/security-ops/laws/`)
    await expect(page.getByText('нормативной базы ОМ')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Законы об ОМ' })).toBeHidden()
  })
})
