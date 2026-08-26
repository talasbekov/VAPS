/**
 * Экран «Пользователи» в настройках на ЖИВОМ стенде (Plane №36, шаг «П-8»).
 *
 * Проба отвечает на два вопроса: поиск СУЖАЕТ реестр учёток (проверяется и
 * отсев), и роль выдаётся С ОБЛАСТЬЮ — выданная появляется в списке ролей
 * человека с подписью области, снятая исчезает после подтверждения.
 *
 * Проба меняет состояние стенда и убирает за собой: выданная роль снимается
 * тем же экраном.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'
import { confirmInDialog } from './dialog'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
/** Роль пробы заведена спекой ролей; здесь она только выдаётся и снимается —
 * своя роль нужна, чтобы проба не трогала настоящие назначения стенда. */
const PROBE_ROLE = 'E2E_PROBE_ROLE'

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'пользователи в настройках' : 'пользователи в настройках (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('поиск сужает реестр, роль выдаётся с областью и снимается', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    await signIn(page)

    // Роль пробы заводится через API, а не экраном: этот экран про раздачу
    // ролей, и заведение здесь было бы чужой проверкой.
    await page.request.post(`${APP}/api/operations/roles/`, {
      data: { code: PROBE_ROLE, name: 'Роль пробы' },
      failOnStatusCode: false,
    })

    await page.goto(`${APP}/settings/users/`)
    await expect(page.getByRole('heading', { name: 'Пользователи', exact: true })).toBeVisible()

    const registry = page.getByRole('table')
    await expect.poll(async () => registry.getByRole('row').count()).toBeGreaterThan(1)
    const everything = await registry.getByRole('row').count()

    await page.getByLabel('Поиск по учётным записям').fill('admin')
    await expect(registry.getByRole('button', { name: 'admin', exact: true })).toBeVisible()
    // ОТСЕВ: поиск, который ничего не отсеивает, прошёл бы проверку «admin виден».
    await expect.poll(async () => registry.getByRole('row').count()).toBeLessThan(everything)

    await registry.getByRole('button', { name: 'admin', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Выдать роль' })).toBeVisible()

    // Роли человека приезжают своим запросом: смотреть на список сразу после
    // выбора значит смотреть на ещё пустой (первый прогон так и соврал —
    // «ролей было ноль», хотя роль ADMIN уже была).
    await expect(page.getByText('Загрузка ролей человека…')).toHaveCount(0)
    await expect.poll(async () => page.getByRole('button', { name: 'Снять' }).count()).toBeGreaterThan(0)

    // Проба судит по СВОЕЙ строке, а не по числу строк: повторная выдача той
    // же роли в той же области второго назначения не заводит (так решено на
    // сервере), и счётный ассерт после неубранного прогона падал бы на ровном
    // месте — так и случилось на втором прогоне.
    // Локатор по CSS, а НЕ по роли: пока диалог открывается и закрывается,
    // Radix прячет фон от дерева доступности, и `getByRole('listitem')`
    // возвращает ноль независимо от того, что на самом деле в списке. Проба на
    // ролях по такому локатору была ВАКУУМНОЙ — зеленела и с показом снятых
    // назначений (проверено красной пробой).
    const probeRow = page
      .locator('ul[aria-label="Роли человека"] li')
      .filter({ hasText: PROBE_ROLE })
    if ((await probeRow.count()) > 0) {
      await probeRow.getByRole('button', { name: 'Снять' }).click()
      await confirmInDialog(page, { title: 'Снять роль?', button: 'Снять' })
      await expect(probeRow).toHaveCount(0)
    }
    await page.getByLabel('Роль', { exact: true }).selectOption(PROBE_ROLE)
    // Область выбирается из СПРАВОЧНИКА подразделений, а не только «вся
    // служба»: без живого справочника выдать роль на департамент было бы
    // нечем, и экран молча предлагал бы одну строку.
    const scopeOptions = page.getByLabel('Область', { exact: true }).locator('option')
    await expect.poll(async () => scopeOptions.count()).toBeGreaterThan(1)
    // Область по умолчанию — «вся служба»: подпись должна прийти словами,
    // числового id области на экране быть не должно.
    await page.getByRole('button', { name: 'Выдать' }).click()
    await expect(probeRow).toHaveCount(1)
    // Область названа СЛОВАМИ: числового id подразделения на экране быть не
    // должно, а безобластное назначение подписывает клиент.
    await expect(probeRow).toContainText('Вся служба')

    await page.screenshot({ path: 'smoke-results/access-users.png', fullPage: true })

    // Уборка тем же экраном — заодно проверка снятия с подтверждением.
    await probeRow.getByRole('button', { name: 'Снять' }).click()
    // Подтверждение — ВНУТРИ окна, и управление вернётся только когда окно
    // ушло: ассерт по фону при открытом окне проходит всегда (Plane №109).
    await confirmInDialog(page, { title: 'Снять роль?', button: 'Снять' })
    await expect(probeRow).toHaveCount(0)

    expect(errors).toEqual([])
  })
})
