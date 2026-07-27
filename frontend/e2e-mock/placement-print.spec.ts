// Smart Josparlau E2E (§9.15): печатная форма расстановки — вход с карточки ОМ,
// документ вне AppLayout, маркер demo НА БУМАГЕ (@media print), UI-слой в
// документ не протекает.
//
// Фикстура — «Международный экономический форум» (стадия PLACEMENT в demo-seed,
// пост «Главный вход» укомплектован Ахметовым Б.): ссылка на печать
// показывается ТОЛЬКО когда есть хотя бы одно назначение.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

/**
 * Адрес печатной формы берётся ИЗ ССЫЛКИ на карточке, а не пишется литералом:
 * идентификаторы demo-seed генерируются `IdGenerator`-ом по сценарию
 * (`security-event-<scenario>-N`), и захардкоженный id ломался бы при смене
 * сценария — тест краснел бы «пустым документом» вместо честной причины.
 */
async function printUrlFromCard(page: Page): Promise<string> {
  await page.goto('/security-events')
  await page
    .getByRole('link', { name: /Международный экономический форум/ })
    .click()
  const href = await page
    .getByRole('link', { name: 'Печатная форма расстановки' })
    .getAttribute('href')
  expect(href).not.toBeNull()
  return href as string
}

test.describe('ОМ: печатная форма расстановки (mock-режим)', () => {
  test('ссылка с карточки открывает документ вне каркаса портала', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/security-events')

    await page
      .getByRole('link', { name: /Международный экономический форум/ })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Международный экономический форум' }),
    ).toBeVisible()

    const printLink = page.getByRole('link', {
      name: 'Печатная форма расстановки',
    })
    await expect(printLink).toBeVisible()

    // Переход В ТОЙ ЖЕ вкладке — не вкус, а условие работоспособности:
    // credential живёт в sessionStorage, и новая вкладка (implicit noopener в
    // Chromium ≥88) открылась бы на экране входа. Ассерт закрепляет это:
    // вернувшийся `target="_blank"` покрасит тест.
    await expect(printLink).not.toHaveAttribute('target', '_blank')
    await printLink.click()
    const printPage = page

    await expect(
      printPage.getByRole('heading', { name: 'РАССТАНОВКА СИЛ И СРЕДСТВ' }),
    ).toBeVisible()
    // Каркас портала на бумагу не попадает — роут разведён СИБЛИНГОМ.
    await expect(printPage.getByRole('navigation')).toHaveCount(0)
    await expect(printPage.locator('main.print-root')).toBeVisible()

    // Реальные данные фикстуры в документе, а не заглушка.
    await expect(printPage.getByRole('table')).toBeVisible()
    await expect(
      printPage.getByRole('cell', { name: 'Ахметов Б.', exact: true }),
    ).toBeVisible()

    // Стадия печатается русской подписью, а не машинным кодом.
    const note = printPage.locator('.print-note')
    await expect(note).toContainText('Расстановка')
    await expect(note).not.toContainText('PLACEMENT')
  })

  test('маркер demo печатается на бумаге, экранная подсказка — нет (§9.15)', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto(await printUrlFromCard(page))

    const demoMark = page.locator('.print-demo')
    const screenHint = page.locator('.print-screen-hint')
    await expect(demoMark).toBeVisible()
    await expect(screenHint).toBeVisible()

    // Эмуляция печатного носителя — единственный способ проверить @media print
    // в реальном браузере (jsdom CSS не парсит, Ловушка 11 стори 8.8).
    await page.emulateMedia({ media: 'print' })
    await expect(screenHint).toBeHidden()
    // Ключевой ассерт §9.15: распечатанный лист ОБЯЗАН нести маркер demo,
    // иначе он неотличим от официального артефакта.
    await expect(demoMark).toBeVisible()
    await expect(demoMark).toContainText('ДЕМОНСТРАЦИОННЫЙ ПРЕДПРОСМОТР')
    await page.emulateMedia({ media: 'screen' })
  })

  test('печатный канон: в документе только print-*-классы и PT Serif', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto(await printUrlFromCard(page))
    await expect(page.getByRole('table')).toBeVisible()

    const foreignClasses = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[class]'))
        .flatMap((node) => Array.from(node.classList))
        .filter((token) => !token.startsWith('print-')),
    )
    expect(foreignClasses).toEqual([])

    // Печатная типографика задана полностью (Tailwind preflight не должен
    // подменить шрифт документа).
    const fontFamily = await page
      .locator('main.print-root')
      .evaluate((node) => getComputedStyle(node).fontFamily)
    expect(fontFamily).toContain('PT Serif')
  })

  test('без параметра — объясняющий текст, а не пустой бланк', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/print/placement')

    await expect(
      page.getByText(/Не хватает параметра печати/),
    ).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByRole('heading')).toHaveCount(0)
  })
})
