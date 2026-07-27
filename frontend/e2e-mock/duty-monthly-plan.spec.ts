// Smart Josparlau E2E (§33, Этап 31): месячный план дежурств (§21.27-21.30),
// серверные KPI (§21.29) и конфликты с серверной severity (§21.34).
//
// Демо-сценарий детерминирован (DemoClock стартует с 2026-07-20T08:00+05:00),
// поэтому даты — константы фикстур, не вычисляются в рантайме. Сид даёт по
// одному представителю каждого класса конфликта (см. features/duties/mocks/
// fixtures.ts): пересечение (hard), отдых на собственном объекте (hard,
// HARD_BLOCK), отдых на охраняемом (soft, SOFT_OVERRIDE).
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

/** KPI-карточка: подпись и значение лежат в одном блоке. */
function kpiCard(page: import('@playwright/test').Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..')
}

test.describe('Месячный план дежурств: KPI и конфликты от сервера (mock-режим)', () => {
  test('вкладка «Месяц» показывает серверные KPI, обе severity конфликтов и пустой соседний месяц', async ({
    page,
  }) => {
    await seedCredential(page)
    await page.goto('/duties')
    await expect(page.getByRole('heading', { name: 'План дежурств' })).toBeVisible()

    await page.getByRole('button', { name: 'Месяц' }).click()
    await expect(page.getByText('июль 2026', { exact: true })).toBeVisible()

    // §21.29: значения посчитаны сервером по всему месяцу. Демо-сид — 10 смен
    // на трёх объектах, 5 без ознакомления, 3 завершены.
    await expect(kpiCard(page, 'Объектов в плане')).toContainText('3')
    await expect(kpiCard(page, 'Дежурств')).toContainText('10')
    await expect(kpiCard(page, 'Без ознакомления')).toContainText('5')
    await expect(kpiCard(page, 'Завершено')).toContainText('3')
    await expect(kpiCard(page, 'Hard-конфликтов')).toContainText('2')
    await expect(kpiCard(page, 'Soft-конфликтов')).toContainText('1')

    // §21.34: severity назначает сервер — пересечение и отдых на собственном
    // объекте hard, отдых на охраняемом soft.
    const overlap = page.locator('li', {
      hasText: 'Жумабаев Р.: 2 дежурства в один день (2026-07-22).',
    })
    await expect(overlap.getByText('Hard-конфликт')).toBeVisible()

    const ownRest = page.locator('li', {
      hasText:
        'Сейтказы М.: дежурство 2026-07-25 начинается до конца обязательного отдыха (24 ч) после дежурства 2026-07-24.',
    })
    await expect(ownRest.getByText('Hard-конфликт')).toBeVisible()

    const protectedRest = page.locator('li', {
      hasText:
        'Нурланов Е.: дежурство 2026-07-28 начинается до конца обязательного отдыха (24 ч) после дежурства 2026-07-27.',
    })
    await expect(protectedRest.getByText('Soft-конфликт')).toBeVisible()

    // §35: показатели прототипа, которых нет в модели, названы с причиной.
    await expect(page.getByText('Показатели, которых нет в модели')).toBeVisible()
    await expect(
      page.getByText('Укомплектовано / частично / не укомплектовано'),
    ).toBeVisible()

    // Соседний месяц пуст — и сказано об этом словами, а не пустой таблицей.
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await expect(page.getByText('август 2026', { exact: true })).toBeVisible()
    await expect(page.getByText('В этом месяце дежурств не запланировано')).toBeVisible()
    await expect(kpiCard(page, 'Дежурств')).toContainText('0')

    await page.getByRole('button', { name: 'Предыдущий месяц' }).click()
    await expect(page.getByText('июль 2026', { exact: true })).toBeVisible()
    await expect(kpiCard(page, 'Дежурств')).toContainText('10')
  })
})
