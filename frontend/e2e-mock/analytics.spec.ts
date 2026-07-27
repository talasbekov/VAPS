// Smart Josparlau E2E (§33, NEXT ACTION Этап 12): «Аналитика службы» (§22)
// не была покрыта E2E — только ручная browser-QA (FRONTEND_PROGRESS Этап 7).
// Проверяет честные агрегаты, вычисленные из РЕАЛЬНЫХ read model
// (useSecurityEventsList/useObjectsList/useDutyShifts/useCombatDutyShifts),
// не выдуманные показатели — demo-seed содержит 5 ОМ (по одному на каждой
// из стадий BULLETIN/RECON/DEMAND/PLACEMENT/APPROVAL), 3 объекта (по одному
// на GREEN/YELLOW/RED), 4 индивидуальных дежурства (по одному на PLANNED/
// ACKNOWLEDGED/ACTIVE/COMPLETED) и 3 боевые группы (1 «Требует подачи», 1
// SUBMITTED, 1 ACCEPTED/PENDING_ACKNOWLEDGEMENT — добавлено по запросу
// «продолжай разрабатывать»).
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
    await expect(page.getByText('Объекты по состоянию паспорта (5)')).toBeVisible()

    const stageRowClass = '[class*="140px_1fr_50px"]'
    for (const label of ['Бюллетень', 'Рекогносцировка', 'Потребность', 'Расстановка', 'Согласование']) {
      await expect(page.locator(stageRowClass, { hasText: label })).toContainText('1')
    }
    for (const label of ['Запрос сил', 'Ознакомление', 'Проведение', 'Закрыто']) {
      await expect(page.locator(stageRowClass, { hasText: label })).toContainText('0')
    }

    // Счётчики сверены с demo-сидом (Этап 37 добавил два объекта с
    // датированными публикациями — «Резиденция» GREEN и «Казмедиа» YELLOW).
    for (const [label, count] of [
      ['Актуален', '2'],
      ['Требует проверки', '2'],
      ['Требует внимания', '1'],
    ] as const) {
      await expect(page.locator(stageRowClass, { hasText: label })).toContainText(count)
    }

    // «Ознакомлен» — substring подстрока «Ознакомление» (стадия ОМ выше) —
    // hasText делает подстроковый матч, поэтому здесь нужен ТОЧНЫЙ regex
    // (инцидент feedback_vaps_label_substring_vacuous_assert, тот же класс бага).
    // 10 индивидуальных дежурств: четвёрка «по одному на состояние» на
    // бизнес-дату плюс шесть смен месячного плана на соседних днях
    // (§21.27-21.30, Этап 31 — 4 PLANNED и 2 COMPLETED).
    await expect(page.getByText('Дежурства по состоянию (10)')).toBeVisible()
    for (const [label, count] of [
      ['Запланировано', '5'],
      [/^Ознакомлен\d/, '1'],
      ['На посту', '1'],
      ['Завершено', '3'],
    ] as const) {
      await expect(page.locator(stageRowClass, { hasText: label })).toContainText(count)
    }

    // §24.5-24.10: 3 боевые группы — «Требует подачи»/SUBMITTED/ACCEPTED
    // (PENDING_ACKNOWLEDGEMENT), см. features/duties/mocks/fixtures.ts.
    // Свой row-класс (200px, не 140px) — не пересекается с рядами выше.
    await expect(page.getByText('Боевые группы по состоянию (3)')).toBeVisible()
    const combatRowClass = '[class*="200px_1fr_50px"]'
    for (const label of ['Требует подачи', 'Подано', 'Принято, ожидает ознакомления']) {
      await expect(page.locator(combatRowClass, { hasText: label })).toContainText('1')
    }
    for (const label of ['Возвращено на доработку', 'Готовы к заступлению', 'На посту', 'Завершено']) {
      await expect(page.locator(combatRowClass, { hasText: label })).toContainText('0')
    }
  })
})
