// Smart Josparlau E2E: «Боевые группы и Трассы» (§24.5-24.10, по запросу
// «боевые группы на Трассе») — вкладка `План дежурств` → «Боевые группы и
// Трассы». Проверяет реальный путь: подать состав (старший+участник) на
// «требующую подачи» смену → рассмотрение (вернуть с причиной, ДОСЛОВНО
// показанной) → повторная подача возвращённого состава → принятие.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Боевые группы и Трассы: подача → возврат → повторная подача → принятие (mock-режим)', () => {
  test('полный цикл рассмотрения состава боевой группы', async ({ page }) => {
    await seedCredential(page)
    await page.goto('/duties')

    await page.getByRole('button', { name: 'Боевые группы и Трассы' }).click()
    await expect(page.getByText('Трасса №1', { exact: true })).toBeVisible()

    const singleRouteCard = page.locator('section', { hasText: 'Трасса №1' })
    await expect(singleRouteCard.getByText('Требует подачи')).toBeVisible()

    await singleRouteCard.getByLabel('Старший группы').selectOption('Байжанов С.')
    await singleRouteCard.getByRole('group', { name: 'Основной состав' }).getByLabel('Дюсенов М.').check()
    await singleRouteCard.getByRole('button', { name: 'Подать состав' }).click()

    await expect(singleRouteCard.getByText('Подано, ожидает рассмотрения')).toBeVisible()
    await expect(singleRouteCard.getByText('Байжанов С.')).toBeVisible()

    await singleRouteCard.getByRole('button', { name: 'Вернуть на доработку' }).click()
    await singleRouteCard.getByPlaceholder('Причина возврата…').fill('Недостаточный состав группы')
    await singleRouteCard.getByRole('button', { name: 'Подтвердить возврат' }).click()

    await expect(singleRouteCard.getByText('Возвращено на доработку')).toBeVisible()
    await expect(singleRouteCard.getByText('Причина возврата: Недостаточный состав группы')).toBeVisible()

    // Возвращённый состав снова подаётся — форма подачи открылась заново.
    await singleRouteCard.getByLabel('Старший группы').selectOption('Байжанов С.')
    await singleRouteCard.getByRole('group', { name: 'Основной состав' }).getByLabel('Дюсенов М.').check()
    await singleRouteCard.getByRole('button', { name: 'Подать состав' }).click()
    await expect(singleRouteCard.getByText('Подано, ожидает рассмотрения')).toBeVisible()

    await singleRouteCard.getByRole('button', { name: 'Принять' }).click()
    await expect(singleRouteCard.getByText('Принято', { exact: true })).toBeVisible()

    // §24.17 hard-rule: тот же сотрудник (принятый выше) не может быть
    // подан в другую боевую группу на ту же дату.
    const multiRouteCard = page.locator('section', { hasText: 'Трассы №2-3' })
    await expect(multiRouteCard.getByText('Подано, ожидает рассмотрения')).toBeVisible()
  })

  test('переживает reload — данные персистентны', async ({ page }) => {
    await seedCredential(page)
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Боевые группы и Трассы' }).click()

    const multiRouteCard = page.locator('section', { hasText: 'Трассы №2-3' })
    await expect(multiRouteCard.getByText('Подано, ожидает рассмотрения')).toBeVisible()
    await multiRouteCard.getByRole('button', { name: 'Принять' }).click()
    await expect(multiRouteCard.getByText('Принято', { exact: true })).toBeVisible()

    await page.reload()
    await page.getByRole('button', { name: 'Боевые группы и Трассы' }).click()
    await expect(
      page.locator('section', { hasText: 'Трассы №2-3' }).getByText('Принято', { exact: true }),
    ).toBeVisible()
  })
})
