// Smart Josparlau E2E (§33, NEXT ACTION Этап 11): «середина цикла ОМ» —
// Рекогносцировка→Потребность→Запрос сил — не была покрыта ни одной E2E-спекой
// (security-event-lifecycle.spec.ts идёт BULLETIN→BULLETIN,
// security-event-approval-to-closure.spec.ts — APPROVAL→CLOSED,
// security-event-placement.spec.ts — только внутри уже готовой стадии
// PLACEMENT). Использует фикстуру «Культурный форум приграничных регионов»
// (стадия RECON в demo-seed: 2/6 пунктов чек-листа уже отмечены, 1 пост уже
// рассчитан, demandRows/forceRequests ещё пусты — см.
// security-events/mocks/fixtures.ts).
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

test.describe('ОМ: Рекогносцировка → Потребность → Запрос сил → Расстановка (mock-режим)', () => {
  test('завершить чек-лист рекогносцировки, утвердить потребность, выделить силы — дойти до Расстановки', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/security-events')

    await page
      .getByRole('link', { name: /Культурный форум приграничных регионов/ })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Рекогносцировка объекта' }),
    ).toBeVisible()

    // 2/6 пунктов чек-листа уже отмечены в demo-seed — довести до 6/6.
    const checkboxes = page.getByRole('checkbox')
    const checkboxCount = await checkboxes.count()
    for (let i = 0; i < checkboxCount; i += 1) {
      const box = checkboxes.nth(i)
      if (!(await box.isChecked())) {
        await box.check()
      }
    }

    await page.getByRole('button', { name: 'Сохранить расчёт' }).click()
    const completeReconButton = page.getByRole('button', {
      name: 'Завершить этап и перейти далее',
    })
    await expect(completeReconButton).toBeEnabled()
    await completeReconButton.click()

    // RECON → DEMAND: тот же экран, react-query перечитывает event.stage.
    await expect(
      page.getByRole('heading', { name: 'Потребность и выделение сил' }),
    ).toBeVisible()
    await expect(page.getByText('Строк потребности пока нет')).toBeVisible()

    await page.getByRole('button', { name: '+ Добавить потребность' }).click()
    const demandRow = page.locator('table tbody tr').first()
    await demandRow.locator('input').first().fill('A')
    await demandRow.locator('input').nth(1).fill('Досмотр')
    await page.getByRole('button', { name: 'Сохранить и утвердить потребность' }).click()

    // approveDemand переводит стадию DEMAND→FORCES сразу (без промежуточного
    // «заблокированного» вида DEMAND) — см. repository.ts approveDemand.
    // Заголовок стадии у DEMAND и FORCES совпадает («Потребность и выделение
    // сил»), различает их только содержимое (2 · Выделение сил вместо
    // 1 · Потребность в силах).
    await expect(page.getByText('2 · Выделение сил')).toBeVisible()
    await expect(page.getByText('Группа досмотра')).toBeVisible()

    await page.locator('input[type="number"]').fill('1')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Выделено')).toBeVisible()

    const completeForcesButton = page.getByRole('button', {
      name: 'Завершить этап и перейти далее',
    })
    await expect(completeForcesButton).toBeEnabled()
    await completeForcesButton.click()

    // FORCES → PLACEMENT.
    await expect(page.getByRole('heading', { name: 'Расстановка' })).toBeVisible()
    await expect(page.getByRole('button', { name: /A · Главный вход/ })).toBeVisible()
  })
})
