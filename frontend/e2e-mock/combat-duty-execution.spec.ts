// Smart Josparlau E2E: «Боевые группы и Трассы» — пост-акцептный lifecycle
// (§24.19-24.23, продолжение combat-duty-groups.spec.ts): ознакомление
// каждого члена состава → заступление → сдача смены (§24.22, checkpoint,
// FRONTEND_DECISIONS A55) → факт несения службы, отдельный от планового
// состава. Использует demo-фикстуру «Трасса №2 (принятый состав)» — уже
// ACCEPTED с execution=PENDING_ACKNOWLEDGEMENT (см. mocks/fixtures.ts),
// чтобы не дублировать подачу/рассмотрение.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Боевые группы и Трассы: ознакомление → заступление → факт (mock-режим)', () => {
  test('полный execution-цикл принятой группы', async ({ page }) => {
    await seedCredential(page)
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Боевые группы и Трассы' }).click()

    const card = page.locator('section', { hasText: 'Трасса №2 (принятый состав)' })
    await expect(card.getByText('Ожидает ознакомления состава')).toBeVisible()

    // Заступить нельзя, пока не ознакомлен весь состав (leader+members).
    await expect(card.getByRole('button', { name: 'Заступить' })).toHaveCount(0)

    const acknowledgeButtons = card.getByRole('button', { name: 'Отметить ознакомление' })
    await expect(acknowledgeButtons).toHaveCount(2)

    await acknowledgeButtons.first().click()
    await expect(card.getByText('Ожидает ознакомления состава')).toBeVisible()
    await expect(acknowledgeButtons).toHaveCount(1)
    await expect(card.getByRole('button', { name: 'Заступить' })).toHaveCount(0)

    await acknowledgeButtons.first().click()
    await expect(card.getByText('Ознакомлены, готовы к заступлению')).toBeVisible()

    await card.getByRole('button', { name: 'Заступить' }).click()
    await expect(card.getByText('Заступили, несут службу')).toBeVisible()

    // §24.22: завершить нельзя, пока не оформлена сдача смены. Незакрытые
    // происшествия оставляем пустыми (честное «нет» — не текст-заглушка) —
    // проверяем, что строка в сводке тогда НЕ рисуется.
    await card.getByLabel('Замечания по сдаче смены').fill('Служба прошла штатно')
    await card.getByLabel('Кто сдаёт смену').selectOption('Кенжебаев А.')
    await card.getByRole('button', { name: 'Оформить сдачу смены' }).click()
    await expect(card.getByText('Сдача смены оформлена')).toBeVisible()
    await expect(card.getByText('Замечания: Служба прошла штатно')).toBeVisible()
    await expect(card.getByText('Незакрытые происшествия:', { exact: false })).toHaveCount(0)

    // Факт может отличаться от плана — снимаем одну галочку.
    await card.getByLabel('Тастанова Г.').uncheck()
    await card.getByRole('button', { name: 'Завершить дежурство' }).click()

    await expect(card.getByText('Дежурство завершено')).toBeVisible()
    await expect(card.getByText('Фактически несли службу: Кенжебаев А.', { exact: true })).toBeVisible()

    await page.reload()
    await page.getByRole('button', { name: 'Боевые группы и Трассы' }).click()
    await expect(
      page.locator('section', { hasText: 'Трасса №2 (принятый состав)' }).getByText('Дежурство завершено'),
    ).toBeVisible()
  })
})
