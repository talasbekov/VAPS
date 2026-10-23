/**
 * Individual status form on react-hook-form + zod, using a live read fixture.
 * Checks complete duty placement, clearing dependent assignments on kind change,
 * and the indefinite in-service period. Status writes are intercepted.
 */
import { expect, test, type Page } from '@playwright/test'
import { clickRowMenuItem, staffedRow } from './row-menu'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

/**
 * Дождаться гидратации: клик и сабмит ДО неё уходят браузерной отправкой —
 * форма не проверяется вовсе, и проба ловит не то, что проверяет.
 * Признак готовности клиента — включившийся переключатель темы.
 */
async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /тему|theme/i }).first()).toBeEnabled({
    timeout: 20_000,
  })
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'формы: RHF + zod' : 'формы: RHF + zod (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  // Проба «добавление сотрудника» снята вместе с окном заведения (Plane
  // №940, слово заказчика 07.09.2026): формы на экране больше нет.

  test('статусы сотрудника: наряд требует полного назначения, «В строю» дат не требует', async ({
    page,
  }) => {
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)

    // 🔴 Запись на стенд не уходит: модалка засеяна текущим статусом
    // сотрудника, и удачный сабмит создал бы ему настоящий статус. Проба
    // проверяет готовность формы без сабмита — до сети дело дойти не должно, а перехват
    // страхует от того, что дойдёт.
    let posted = 0
    await page.route(
      (url) => url.pathname.includes('/api/statuses/statuses'),
      (route) => {
        // Fresh duty assignment reads are required before validation; guard only writes.
        if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue()
        posted += 1
        return route.abort()
      },
    )
    // Начальное назначение контролируется пробой: текущий реальный наряд
    // сотрудника не должен заполнять поля, чью обязательность проверяем.
    await page.route('**/api/statuses/statuses/duty-assignments/**', route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { results: [] } })
      return route.fallback()
    })

    // Модалка открывается из меню действий строки. Через помощника: строка
    // доводится до окна ДО открытия меню, иначе в полном прогоне пункт
    // оказывается «вне области просмотра» (Plane №820).
    await clickRowMenuItem(page, staffedRow(page), 'Изменить статус')

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Статусы сотрудника')).toBeVisible()

    // Полнота назначения теперь проверяется до сабмита. Отсутствующее
    // назначение блокирует Save, а свежий справочник остаётся настоящим.
    await dialog.locator('#status').click()
    await page.getByRole('option', { name: 'На дежурстве', exact: true }).click()
    const save = dialog.getByRole('button', { name: 'Сохранить', exact: true })
    await expect(dialog.locator('[id="duty.objectId"]')).toBeEnabled()
    await expect(save).toBeDisabled()
    await dialog.locator('[id="duty.dutyKind"]').click()
    await page.getByRole('option', { name: 'Постовое', exact: true }).click()
    await expect(dialog.locator('[id="duty.postId"]')).toBeDisabled()
    await expect(save).toBeDisabled()

    await dialog.locator('[id="duty.objectId"]').click()
    await page.getByRole('option').first().click()
    await expect(save).toBeDisabled() // Объект без поста ещё не назначение.

    await dialog.locator('[id="duty.dutyKind"]').click()
    await page.getByRole('option', { name: 'Групповое', exact: true }).click()
    await expect(dialog.locator('[id="duty.postId"]')).toHaveCount(0)
    await expect(dialog.locator('[id="duty.groupId"]')).toBeEnabled()
    await expect(save).toBeDisabled()
    await dialog.locator('[id="duty.groupId"]').click()
    await page.getByRole('option', { name: 'Группа №1', exact: true }).click()
    await expect(save).toBeEnabled()
    // Смена вида очищает зависимое назначение, не переносит старую группу.
    await dialog.locator('[id="duty.dutyKind"]').click()
    await page.getByRole('option', { name: 'Постовое', exact: true }).click()
    await expect(dialog.locator('[id="duty.groupId"]')).toHaveCount(0)
    await expect(save).toBeDisabled()
    expect(posted, 'форма не должна была дойти до сети').toBe(0)

    // «В строю» бессрочен — дат у него нет вовсе.
    await dialog.locator('#status').click()
    await page.getByRole('option', { name: 'В строю', exact: true }).click()
    await expect(dialog.locator('#startDate')).toHaveCount(0)
    await expect(
      dialog.getByText('бессрочный статус, даты не указываются', { exact: false }),
    ).toBeVisible()
  })
})
