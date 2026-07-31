// Smart Josparlau E2E (§33, Этап 61): §19.27 журнал оценивания — след действия
// доезжает из одного раздела в другой, а значения оценок в него не попадают.
//
// Проверяется то, чего не видит ни один unit-тест: отправка оценки и журнал —
// разные экраны с РАЗНЫМИ правами, связанные только общим demo-снапшотом.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Журнал оценивания §19.27 (mock-режим)', () => {
  test('отправка оценки оставляет след, а закрытые значения в журнал не едут', async ({
    page,
  }) => {
    const payloads: string[] = []
    page.on('response', async (response) => {
      if (response.url().includes('/api/ops/rating-audit/')) payloads.push(await response.text())
    })

    // Оценивает организатор ОМ: журнала он не видит — контроль над своими
    // действиями не является их частью.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-event-planner' }),
      )
    })
    await page.goto('/ratings/workspace')
    await page.getByRole('button', { name: 'Оценить: Ерланов Д.' }).click()
    await page.getByLabel('Оценка').selectOption('4')
    await page.getByLabel('Основание').selectOption('DISCIPLINE')
    await page.getByLabel(/Комментарий/).fill('Оставил пост до смены')
    await page.getByRole('button', { name: 'Отправить оценку' }).click()
    await expect(page.getByRole('button', { name: 'Оценить: Ерланов Д.' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Журнал оценивания' })).toHaveCount(0)

    // Журнал читает администратор-эталон (wildcard): событие уже там.
    const auditor = await page.context().newPage()
    await seedCredential(auditor)
    await auditor.goto('/ratings/audit')
    await expect(auditor.getByRole('heading', { name: 'Журнал оценивания' })).toBeVisible()
    await expect(
      auditor.getByRole('row', { name: /Значение изменено относительно начального/ }).first(),
    ).toBeVisible()

    auditor.on('response', async (response) => {
      if (response.url().includes('/api/ops/rating-audit/')) payloads.push(await response.text())
    })
    await auditor.reload()
    await expect(auditor.getByRole('row', { name: /Оценка отправлена/ }).first()).toBeVisible()
    expect(payloads.length).toBeGreaterThan(0)
    for (const body of payloads) {
      // Комментарий и значение оценки в журнал не едут (§19.27/§19.21).
      expect(body).not.toContain('Оставил пост до смены')
      expect(body).not.toContain('"score"')
    }
    await auditor.close()
  })

  test('без своего права журнал не открывается и в меню не показан', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-event-planner' }),
      )
    })
    await page.goto('/ratings/audit')
    await expect(page.getByText('Доступ запрещён')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Журнал оценивания' })).toHaveCount(0)
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
