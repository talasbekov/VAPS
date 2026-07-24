// Smart Josparlau E2E (§33, NEXT ACTION Этап 10): «Справочники» (§30) не были
// покрыты E2E — только ручная browser-QA (см. FRONTEND_PROGRESS Этап 8/10).
// Проверяет реестр → детальная страница → 409-конфликт на деактивации
// используемого значения (дословный текст причины) → успешная деактивация
// неиспользуемого значения → создание нового значения, persist через reload.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Справочники: реестр → значения → конфликт деактивации → создание (mock-режим)', () => {
  test('деактивация используемого значения даёт 409 дословно, неиспользуемое — деактивируется, новое значение персистентно', async ({
    page,
  }) => {
    await seedCredential(page)
    await page.goto('/dictionaries')

    await expect(page.getByRole('heading', { name: 'Справочники' })).toBeVisible()
    await page.getByRole('link', { name: /Причины возврата на доработку/ }).click()

    await expect(
      page.getByRole('heading', { name: 'Причины возврата на доработку' }),
    ).toBeVisible()

    const usedRow = page.locator('tr', { hasText: 'Недостаточная укомплектованность постов' })
    await usedRow.getByRole('button', { name: 'Деактивировать' }).click()
    await expect(
      page.getByText('Значение используется в 3 связанных записях — деактивация запрещена.'),
    ).toBeVisible()
    // Отклонённая мутация не меняет статус строки.
    await expect(usedRow.getByText('Активно')).toBeVisible()

    const unusedRow = page.locator('tr', { hasText: 'Обнаружено двойное назначение' })
    await unusedRow.getByRole('button', { name: 'Деактивировать' }).click()
    await expect(unusedRow.getByText('Деактивировано')).toBeVisible()
    await expect(unusedRow.getByRole('button', { name: 'Активировать' })).toBeVisible()

    const code = `E2E_REASON_${Date.now()}`
    await page.getByLabel('Код').fill(code)
    await page.getByLabel('Наименование').fill('E2E причина возврата')
    await page.getByLabel('Описание').fill('Создано автотестом')
    await page.getByRole('button', { name: 'Добавить' }).click()

    await expect(page.getByText(code)).toBeVisible()

    await page.reload()

    await expect(page.getByText(code)).toBeVisible()
    await expect(unusedRow.getByText('Деактивировано')).toBeVisible()
  })
})
