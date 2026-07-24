// Smart Josparlau E2E (§33, NEXT ACTION Этап 12): «Аналитика службы» (§22)
// не была покрыта E2E — только ручная browser-QA (FRONTEND_PROGRESS Этап 7).
// Проверяет честные агрегаты, вычисленные из РЕАЛЬНЫХ read model
// (useSecurityEventsList/useObjectsList), не выдуманные показатели — demo-seed
// содержит 5 ОМ (по одному на каждой из стадий BULLETIN/RECON/DEMAND/
// PLACEMENT/APPROVAL) и 3 объекта (по одному на GREEN/YELLOW/RED).
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Аналитика службы: агрегаты ОМ-по-этапам и объектов-по-паспорту (mock-режим)', () => {
  test('честные агрегаты по видимым записям, подписанные как таковые', async ({ page }) => {
    await seedCredential(page)
    await page.goto('/analytics')

    await expect(page.getByRole('heading', { name: 'Аналитика службы' })).toBeVisible()
    await expect(
      page.getByText('Распределение по видимым записям — не заявлено как серверный агрегат'),
    ).toBeVisible()

    await expect(page.getByText('ОМ по этапам (5 из 5)')).toBeVisible()
    await expect(page.getByText('Объекты по состоянию паспорта (3)')).toBeVisible()

    const stageRowClass = '[class*="140px_1fr_50px"]'
    for (const label of ['Бюллетень', 'Рекогносцировка', 'Потребность', 'Расстановка', 'Согласование']) {
      await expect(page.locator(stageRowClass, { hasText: label })).toContainText('1')
    }
    for (const label of ['Запрос сил', 'Ознакомление', 'Проведение', 'Закрыто']) {
      await expect(page.locator(stageRowClass, { hasText: label })).toContainText('0')
    }

    for (const label of ['Актуален', 'Требует проверки', 'Требует внимания']) {
      await expect(page.locator(stageRowClass, { hasText: label })).toContainText('1')
    }
  })
})
