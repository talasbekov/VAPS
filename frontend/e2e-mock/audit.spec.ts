// Smart Josparlau E2E (§33, NEXT ACTION Этап 12): «Аудит» (§29) не был
// покрыт E2E — только ручная browser-QA (FRONTEND_PROGRESS Этап 6). Проверяет
// реестр журнала действий (read-only, поверх РЕАЛЬНОЙ donor-схемы
// `/api/audit/logs/`) и клиентскую фильтрацию по действию/сущности/пользователю.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Аудит: журнал действий → поиск по действию/пользователю (mock-режим)', () => {
  test('поиск по действию и по пользователю независимо сужают журнал', async ({ page }) => {
    await seedCredential(page)
    await page.goto('/audit')

    await expect(page.getByRole('heading', { name: 'Аудит' })).toBeVisible()

    const rowsLocator = page.locator('table tbody tr')
    await expect(rowsLocator.first()).toBeVisible()
    const totalCount = await rowsLocator.count()
    expect(totalCount).toBeGreaterThan(1)

    const search = page.getByPlaceholder('Поиск по действию, сущности, пользователю…')

    await search.fill('security_event.create')
    await expect(rowsLocator).toHaveCount(1)
    await expect(page.getByText('security_event.create')).toBeVisible()

    await search.fill('')
    await expect(rowsLocator).toHaveCount(totalCount)

    await search.fill('demo-objects-admin')
    const filteredCount = await rowsLocator.count()
    expect(filteredCount).toBeGreaterThanOrEqual(1)
    expect(filteredCount).toBeLessThan(totalCount)
    await expect(page.getByText('object.passport.update')).toBeVisible()
  })
})
