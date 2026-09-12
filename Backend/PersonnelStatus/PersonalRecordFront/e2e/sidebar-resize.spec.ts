/**
 * Изменяемая ширина бокового меню (Plane №1263, поручение заказчика
 * 12.09.2026: «меню модулей сделай расширяемой по ширине, а то сейчас
 * фиксировано»).
 *
 * Стережётся четыре вещи: (1) свежий профиль по-прежнему 256 px — этот пин
 * держит и `prototype-skin.spec.ts`, здесь он повторён как исходная точка;
 * (2) край тянется мышью и содержимое сдвигается вместе с ним — иначе меню
 * наезжает на экран; (3) ширина переживает перезагрузку — «расширяемое»
 * меню, забывающее ширину на каждом переходе, заказчику не нужно;
 * (4) у перетаскивания есть клавиатура и сброс — WCAG 2.2 «Dragging
 * Movements» требует альтернативу без мыши.
 *
 * Красная проба: снять `onPointerMove` с рукоятки — падает (2); снять
 * запись в `localStorage` — падает (3); снять `onKeyDown` — падает (4).
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

async function asideWidth(page: Page): Promise<number> {
  return page.locator('aside').first().evaluate((el) => el.getBoundingClientRect().width)
}

async function mainLeft(page: Page): Promise<number> {
  return page.locator('#main-content').evaluate((el) => el.getBoundingClientRect().left)
}

test.describe(LIVE ? 'ширина бокового меню' : 'ширина бокового меню (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'живой стенд не запрошен')
  test.use({ viewport: { width: 1600, height: 900 } })

  test('край тянется мышью, содержимое сдвигается, ширина переживает перезагрузку', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard`)
    const handle = page.getByRole('separator', { name: 'Ширина бокового меню' })
    await expect(handle).toBeVisible()
    expect(await asideWidth(page)).toBe(256)
    const mainBefore = await mainLeft(page)

    // Тянем край на 80 px вправо. Движение — несколькими шагами: захват
    // указателя и первое `pointermove` на одном пикселе — это ещё не
    // перетаскивание.
    const box = (await handle.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + 300
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 40, y, { steps: 4 })
    await page.mouse.move(x + 80, y, { steps: 4 })
    await page.mouse.up()

    await expect.poll(() => asideWidth(page)).toBe(336)
    // Содержимое уехало РОВНО на столько же: меню не наезжает на экран и не
    // оставляет щели.
    expect((await mainLeft(page)) - mainBefore).toBe(80)
    await expect(handle).toHaveAttribute('aria-valuenow', '336')

    // Перезагрузка — другой экран — ширина та же.
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible()
    await expect.poll(() => asideWidth(page)).toBe(336)
  })

  test('границы держатся: уже 224 и шире 440 не утянуть', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard`)
    const handle = page.getByRole('separator', { name: 'Ширина бокового меню' })
    await expect(handle).toBeVisible()
    const box = (await handle.boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + 300

    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(700, y, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => asideWidth(page)).toBe(440)

    const wide = (await handle.boundingBox())!
    await page.mouse.move(wide.x + wide.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(60, y, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => asideWidth(page)).toBe(224)
  })

  test('клавиатура и сброс: стрелки меняют ширину шагом, двойной клик возвращает 256', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard`)
    const handle = page.getByRole('separator', { name: 'Ширина бокового меню' })
    await expect(handle).toBeVisible()

    await handle.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => asideWidth(page)).toBe(288)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => asideWidth(page)).toBe(272)
    await page.keyboard.press('End')
    await expect.poll(() => asideWidth(page)).toBe(440)
    await page.keyboard.press('Home')
    await expect.poll(() => asideWidth(page)).toBe(224)

    await handle.dblclick()
    await expect.poll(() => asideWidth(page)).toBe(256)
  })
})
