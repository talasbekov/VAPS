// Smart Josparlau E2E: «Боевые группы и Трассы» — формирование потребности
// на смену (§24.1, продолжение combat-duty-groups.spec.ts). Проверяет
// реальный путь: создать новую смену на будущую дату → она появляется в
// очереди «Требует подачи» с указанной требуемой численностью → состав
// подаётся на неё как на любую другую смену.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Боевые группы и Трассы: формирование потребности на смену (mock-режим)', () => {
  test('создать смену, она появляется как «Требует подачи», состав подаётся на неё', async ({
    page,
  }) => {
    await seedCredential(page)
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Боевые группы и Трассы' }).click()

    await page.getByRole('button', { name: 'Сформировать потребность' }).click()

    await page.locator('#req-business-date').fill('2026-07-27')
    await page
      .locator('#req-duty-type')
      .selectOption('COMBAT_GROUP_SINGLE_ROUTE')
    await page.locator('#req-coverage-mode').selectOption('RESERVE')
    await page.locator('#req-required-employees').fill('2')
    await page.getByRole('group', { name: 'Трассы' }).getByLabel(/Трасса №1/).check()
    await page.getByRole('button', { name: 'Создать' }).click()

    const newCard = page.locator('section', { hasText: '2026-07-27' })
    await expect(newCard.getByText('Требует подачи')).toBeVisible()
    await expect(newCard.getByText('Требуется: 2 чел.')).toBeVisible()

    await newCard.getByLabel('Старший группы').selectOption('Байжанов С.')
    await newCard.getByRole('group', { name: 'Основной состав' }).getByLabel('Дюсенов М.').check()
    await newCard.getByRole('button', { name: 'Подать состав' }).click()
    await expect(newCard.getByText('Подано, ожидает рассмотрения')).toBeVisible()

    await page.reload()
    await page.getByRole('button', { name: 'Боевые группы и Трассы' }).click()
    const reloadedCard = page.locator('section', { hasText: '2026-07-27' })
    await expect(reloadedCard.getByText('Подано, ожидает рассмотрения')).toBeVisible()
  })
})
