/**
 * Каталог охраняемых лиц на ЖИВОМ стенде.
 *
 * Проба отвечает на два вопроса: вкладка действительно делит каталог (а не
 * показывает один и тот же список), и связь «лицо → мероприятия» настоящая —
 * она появляется РОВНО тогда, когда лицо названо в сводке ГВО, и исчезает,
 * когда его оттуда убрали.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
/** Лицо каталога, которым проверяется связь со сводкой ГВО. */
const PERSON = 'Оспанов Бахыт Дюсенбаевич'

async function signIn(page: Page, username = 'admin', password = 'admin123'): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'охраняемые лица' : 'охраняемые лица (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('вкладки делят каталог, связь с ОМ идёт из сводки ГВО', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    await signIn(page)
    await page.goto(`${APP}/security-ops/persons/`)
    await expect(page.getByRole('heading', { name: 'Охраняемые лица' })).toBeVisible()

    // «Наши» и «Иностранные» — РАЗНЫЕ списки: проверяем оба направления,
    // иначе вкладка, которая ничего не фильтрует, тест бы прошла.
    const ours = page.getByRole('heading', { name: PERSON })
    const foreign = page.getByRole('heading', { name: 'James Miller' })
    await expect(ours).toBeVisible()
    await expect(foreign).toBeHidden()
    await page.getByRole('button', { name: 'Иностранные' }).click()
    await expect(foreign).toBeVisible()
    await expect(ours).toBeHidden()
    await expect(page.getByText('Позывной «Дельта-1»')).toBeVisible()
    await page.getByRole('button', { name: 'Наши' }).click()

    const card = page.locator('article', { hasText: PERSON })

    // До правки сводки связи нет — и экран говорит об этом прямо.
    await card.getByRole('button', { name: 'Все мероприятия с ОЛ' }).click()
    await expect(card).toContainText('не назван ни в одной сводке ГВО', {
      timeout: 10_000,
    })

    // Вносим лицо в сводку ГВО первого ОМ реестра
    await page.goto(`${APP}/security-ops/gvo/`)
    const row = page.locator('tbody tr').first()
    const omCode = (await row.locator('td').first().innerText()).split('\n')[0]
    await row.locator('a').first().click()
    await page.getByRole('button', { name: '＋ Добавить лицо' }).click()
    await page.getByRole('textbox', { name: 'ФИО' }).fill(PERSON)
    await page.getByRole('textbox', { name: 'Должность' }).fill('Куратор визитов')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.locator('main').getByText(PERSON)).toBeVisible({ timeout: 10_000 })

    // Связь появилась: карточка лица ведёт на ту самую сводку и её объект
    await page.goto(`${APP}/security-ops/persons/`)
    const linked = page.locator('article', { hasText: PERSON })
    await linked.getByRole('button', { name: 'Все мероприятия с ОЛ' }).click()
    await expect(linked.getByRole('link', { name: omCode })).toBeVisible({
      timeout: 10_000,
    })
    await linked.getByRole('button', { name: 'Объекты ОЛ' }).click()
    await expect(linked.getByRole('link', { name: omCode })).toBeHidden()
    await expect(linked.locator('li')).toHaveCount(1)

    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })

  test('без event.view каталог закрыт', async ({ page }) => {
    await signIn(page, 'observer', 'observer123')
    await page.goto(`${APP}/security-ops/persons/`)
    await expect(page.getByText('каталога охраняемых лиц')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Охраняемые лица' })).toBeHidden()
  })
})
