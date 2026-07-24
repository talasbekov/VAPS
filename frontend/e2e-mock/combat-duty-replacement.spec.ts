// Smart Josparlau E2E: «Боевые группы и Трассы» — замена участника ДО
// заступления (§24.21, продолжение combat-duty-execution.spec.ts). Использует
// demo-фикстуру «Трасса №2 (принятый состав)» — ACCEPTED с
// execution=PENDING_ACKNOWLEDGEMENT (см. mocks/fixtures.ts), чтобы не
// дублировать подачу/рассмотрение.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Боевые группы и Трассы: замена участника до заступления (mock-режим)', () => {
  test('заменить участника, история замены появляется, заменённому нужно ознакомиться заново', async ({
    page,
  }) => {
    await seedCredential(page)
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Боевые группы и Трассы' }).click()

    const card = page.locator('section', { hasText: 'Трасса №2 (принятый состав)' })
    await expect(card.getByText('Ожидает ознакомления состава')).toBeVisible()

    await card.getByRole('button', { name: 'Заменить участника' }).click()
    await card.getByLabel('Кого заменить').selectOption({ label: 'Тастанова Г.' })
    await card.getByLabel('Кем заменить').selectOption('Байжанов С.')
    await card.getByPlaceholder('Причина замены…').fill('Болезнь')
    await card.getByRole('button', { name: 'Подтвердить замену' }).click()

    await expect(card.getByText('Байжанов С.', { exact: true }).first()).toBeVisible()
    await expect(card.getByText('Тастанова Г.', { exact: true })).toHaveCount(0)
    await expect(card.getByText('Тастанова Г. → Байжанов С. (Болезнь)')).toBeVisible()

    // Заменённый участник выбывает из ознакомившихся — состав снова ждёт
    // ознакомления обоих (Кенжебаев А. + новый Байжанов С.).
    await expect(card.getByRole('button', { name: 'Отметить ознакомление' })).toHaveCount(2)

    await page.reload()
    await page.getByRole('button', { name: 'Боевые группы и Трассы' }).click()
    const reloadedCard = page.locator('section', { hasText: 'Трасса №2 (принятый состав)' })
    await expect(reloadedCard.getByText('Тастанова Г. → Байжанов С. (Болезнь)')).toBeVisible()
    await expect(reloadedCard.getByRole('button', { name: 'Отметить ознакомление' })).toHaveCount(2)
  })
})
