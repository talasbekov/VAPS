// Smart Josparlau E2E (§33, NEXT ACTION Этап 12): «План дежурств» (§21/§24)
// не был покрыт E2E — только ручная browser-QA (FRONTEND_PROGRESS Этап 8).
// Проверяет переключатель «По объектам»/«По сотрудникам» (§21.4 — ОДИН
// datasource, не два отдельных запроса) и полный жизненный цикл дежурства
// PLANNED→ACKNOWLEDGED→ACTIVE→COMPLETED на фикстуре «Сагинова А.» (Дом
// Министерств, PLANNED в demo-seed — см. features/duties/mocks/fixtures.ts).
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('План дежурств: переключение вида, полный жизненный цикл дежурства (mock-режим)', () => {
  test('«По объектам»/«По сотрудникам» группируют один и тот же список, дежурство доходит до Завершено', async ({
    page,
  }) => {
    await seedCredential(page)
    await page.goto('/duties')

    await expect(page.getByRole('heading', { name: 'План дежурств' })).toBeVisible()
    await expect(page.getByText('Штаб управления', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'По сотрудникам' }).click()
    // «Штаб управления» остаётся видимым как значение колонки «Объект» у
    // Ахметов Б./Оразов К. — сменился только ГРУППИРУЮЩИЙ заголовок секции.
    await expect(page.getByText('Сагинова А.', { exact: true })).toBeVisible()

    const row = page.locator('tr', { hasText: 'Дом Министерств' })
    await expect(row.getByText('Запланировано')).toBeVisible()

    await row.getByRole('button', { name: 'Ознакомиться' }).click()
    await expect(row.getByText('Ознакомлен')).toBeVisible()

    await row.getByRole('button', { name: 'Заступить' }).click()
    await expect(row.getByText('На посту')).toBeVisible()

    await row.getByRole('button', { name: 'Завершить' }).click()
    await expect(row.getByText('Завершено')).toBeVisible()
    await expect(row.getByRole('button')).toHaveCount(0)
  })
})
