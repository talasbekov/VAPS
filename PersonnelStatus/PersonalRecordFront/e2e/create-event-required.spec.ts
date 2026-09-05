/**
 * Окно «Создать бюллетень»: кнопка по-настоящему неактивна до обязательных
 * полей (`[БЛН-12]`, Plane №439).
 *
 * До правки кнопка гасла только видом (`aria-disabled`) и кликалась — клик
 * уходил в проверку формы. Теперь `disabled`: клик по ней невозможен, запрос
 * на создание не уходит, а строка под кнопкой называет, чего не хватает.
 * Заполнение обязательного делает кнопку активной.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'окно создания ОМ: обязательные поля' : 'окно создания ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('кнопка «Создать бюллетень» disabled до обязательных, запрос не уходит (Plane №439)', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
    const dialog = page.getByRole('dialog')
    const submit = dialog.getByRole('button', { name: 'Создать бюллетень' })
    await expect(submit).toBeDisabled()
    const hint = dialog.getByTestId('missing-required')
    await expect(hint).toContainText('Заполните:')
    await expect(hint).toContainText('тип')
    await expect(hint).toContainText('название')

    // Красная проверка: запрос на создание не уходит даже при попытке клика.
    let posts = 0
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/ops/security-events')) posts += 1
    })
    await submit.click({ force: true, trial: false }).catch(() => undefined)
    await page.waitForTimeout(500)
    expect(posts, 'неактивная кнопка отправила запрос').toBe(0)

    // Заполняем обязательное по одному — подсказка сжимается, кнопка оживает.
    await dialog.getByRole('button', { name: 'Внутреннее' }).click()
    await expect(hint).not.toContainText('тип')
    await dialog.getByLabel('Дата начала').fill('2026-11-11')
    await dialog.getByLabel('Дата окончания').fill('2026-11-11')
    await dialog.getByLabel('Охраняемые лица').click()
    await page.locator('[data-slot="persons-combobox"] li button').first().click()
    await dialog.getByLabel('Название ОМ').fill('Проба обязательных (e2e)')
    // Страна и город подставляются умолчанием (Казахстан → Астана).
    await expect(dialog.getByLabel('Город')).not.toHaveValue('', { timeout: 15_000 })
    await expect(submit).toBeEnabled()
    await expect(hint).toHaveCount(0)
  })

  test('превью локации повторяет правило документа: объект вытесняет адрес (Plane №629)', async ({
    page,
  }) => {
    /**
     * Блок озаглавлен «Так строка ляжет в бюллетень», а собирал «страна, город,
     * объект, адрес» — строку, которой документ не производит НИКОГДА: при
     * наличии объектов посещения он печатает ТОЛЬКО их названия, иначе
     * «страна, город, адрес». Обещание «так и ляжет» — единственное, ради чего
     * блок существует; неверное, оно хуже отсутствия.
     *
     * Мутация, на которой проба обязана краснеть: вернуть склейку всех четырёх
     * значений — в превью появится «Казахстан, Астана, …».
     */
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
    const dialog = page.getByRole('dialog')

    await dialog.getByLabel('Адрес / место').fill('Акорда')
    const preview = dialog.getByTestId('bulletin-row-preview')
    // Объекта нет — «страна, город, адрес», как собирает сервер.
    await expect(preview).toContainText('Акорда', { timeout: 15_000 })
    await expect(preview).toContainText('Казахстан')

    // Объект назван — документ печатает ТОЛЬКО его: ни страны, ни адреса.
    // Выбор объекта — combobox с поиском, а не <select> (реестр растёт).
    const trigger = dialog.getByRole('combobox', { name: 'Объект' })
    await trigger.click()
    // Поповер живёт в ПОРТАЛЕ — вне узла окна, поэтому ищем от страницы;
    // первый пункт списка «объект не выбран», берём следующий (тот же приём,
    // что у `pickFirstObject` в `events-registry.spec.ts`).
    const options = page.locator('[data-slot="popover-content"] li button')
    await expect(options.nth(1)).toBeVisible({ timeout: 20_000 })
    await options.nth(1).click()
    // Триггер печатает «КОД · Название», превью — только название.
    const chosen = (await trigger.innerText()).trim()
    const objectName = chosen.split('·').slice(1).join('·').trim()
    expect(objectName, 'объект не выбрался').not.toBe('')
    await expect(preview).toContainText(objectName, { timeout: 15_000 })
    await expect(preview).not.toContainText('Акорда')
    await expect(preview).not.toContainText('Казахстан')
  })

  test('отказ справочника лиц назван честно и предлагает повтор (Plane №632)', async ({ page }) => {
    /**
     * Текст «лица можно указать позже правкой бюллетеня» написан, когда лицо
     * было НЕОБЯЗАТЕЛЬНЫМ. С `[БЛН-12]` (№439) «хотя бы одно ОЛ» обязательно, и
     * при отказе каталога список вариантов пуст, комбобокс выключен, кнопка
     * отправки выключена — «указать позже» нельзя, потому что бюллетеня не
     * будет вовсе. Успокоительная неправда хуже отказа: человек ждёт, что всё
     * получится, и не зовёт того, кто чинит справочник.
     *
     * Мутация, на которой проба обязана краснеть: вернуть прежний текст.
     */
    await page.route('**/api/ops/protected-persons/**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' })
    )
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
    const dialog = page.getByRole('dialog')

    const alert = dialog.getByRole('alert').filter({ hasText: 'Справочник охраняемых лиц' })
    await expect(alert).toBeVisible({ timeout: 20_000 })
    await expect(alert).toContainText('бюллетень не завести')
    await expect(alert).not.toContainText('позже правкой')
    await expect(alert.getByRole('button', { name: 'Повторить' })).toBeVisible()
    // И кнопка отправки честно выключена — обещать обратное было нечем.
    await expect(dialog.getByRole('button', { name: 'Создать бюллетень' })).toBeDisabled()
  })

})
