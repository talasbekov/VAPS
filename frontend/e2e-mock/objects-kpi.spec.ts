// Smart Josparlau E2E (§33, Этап 37): §21.7 «KPI реестра объектов».
//
// Demo-сид даёт все четыре состояния актуальности намеренно (см. fixtures.ts):
//  • «Дворец Независимости» — публикация сегодня → актуален;
//  • «Резиденция „Ак Орда“» — публикация 110 суток назад при интервале 120 →
//    скоро проверка;
//  • «Комплекс „Казмедиа“» — 200 суток назад → проверка просрочена;
//  • «Дом Министерств» и «Астана Арена» — не публиковались.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('KPI реестра объектов (§21.7, mock-режим)', () => {
  test('серверные агрегаты, срок по политике и четыре состояния актуальности', async ({
    page,
  }) => {
    await page.goto('/objects')
    await expect(page.getByRole('heading', { name: 'Объекты и паспорта' })).toBeVisible()

    await expect(page.getByRole('group', { name: 'Всего объектов' })).toContainText('5')
    // §21.7: период приходит от policy — версия и интервал названы на экране.
    // Версия политики теперь приходит из раздела «Настройки» (§29): владелец
    // сменился, требование §21.7 «срок от policy» осталось.
    await expect(
      page.getByText(/по политике passport-freshness-2026\.07\.1: 120 дней/),
    ).toBeVisible()

    // Четыре состояния актуальности — каждое в своей строке.
    const row = (name: string) => page.locator('tr', { hasText: name })
    // §21.5: состояние паспорта («Актуален») и срок его проверки («Срок
    // соблюдён») — РАЗНЫЕ поля и разные слова, в двух соседних колонках.
    await expect(row('Дворец Независимости').getByText('Актуален', { exact: true })).toBeVisible()
    await expect(row('Дворец Независимости').getByText('Срок соблюдён')).toBeVisible()
    await expect(row('Резиденция «Ак Орда»').getByText('Скоро проверка')).toBeVisible()
    await expect(row('Комплекс «Казмедиа»').getByText('Проверка просрочена')).toBeVisible()
    await expect(row('Дом Министерств').getByText('Не публиковался')).toBeVisible()

    // §35: два KPI прототипа, которых модель не даёт, названы с причиной.
    await expect(page.getByText('Показатели, которых нет в модели')).toBeVisible()
    await expect(page.getByText(/Есть открытые замечания/)).toBeVisible()
    await expect(page.getByText(/Нет обязательной схемы/)).toBeVisible()
  })

  test('§21.7: клик по KPI фильтрует реестр, фильтр живёт в URL и переживает reload', async ({
    page,
  }) => {
    await page.goto('/objects')
    await expect(page.locator('tr', { hasText: 'Дворец Независимости' })).toBeVisible()

    await page.getByRole('button', { name: /Проверка просрочена/ }).click()
    await expect(page.locator('tr', { hasText: 'Комплекс «Казмедиа»' })).toBeVisible()
    await expect(page.locator('tr', { hasText: 'Дворец Независимости' })).toHaveCount(0)
    // Показатели остаются про ВЕСЬ реестр, а не про отфильтрованную таблицу.
    await expect(page.getByRole('group', { name: 'Всего объектов' })).toContainText('5')

    // Состояние экрана — в URL: ссылкой можно поделиться.
    await expect(page).toHaveURL(/filter=overdue/)
    await page.reload()
    await expect(page.locator('tr', { hasText: 'Комплекс «Казмедиа»' })).toBeVisible()
    await expect(page.locator('tr', { hasText: 'Дворец Независимости' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Сбросить фильтр' }).click()
    await expect(page.locator('tr', { hasText: 'Дворец Независимости' })).toBeVisible()
  })

  test('публикация новой версии переводит просроченный паспорт в актуальный', async ({ page }) => {
    await page.goto('/objects')
    await page.getByRole('link', { name: /Комплекс «Казмедиа»/ }).first().click()
    await expect(page.getByRole('heading', { name: /Комплекс «Казмедиа»/ })).toBeVisible()

    await page.getByLabel('Действует с *').fill('2026-07-20')
    await page.getByRole('button', { name: 'Опубликовать версию' }).click()
    await expect(page.getByText(/Версия 2 действует с 2026-07-20/)).toBeVisible()

    // Срок пересчитан от НОВОЙ публикации: 2026-07-20 + 120 дней.
    await page.goto('/objects')
    const row = page.locator('tr', { hasText: 'Комплекс «Казмедиа»' })
    await expect(row.getByText('Срок соблюдён')).toBeVisible()
    await expect(row.getByText('до 2026-11-17')).toBeVisible()
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
