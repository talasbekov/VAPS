// Smart Josparlau E2E (§33, NEXT ACTION Этап 10): «Календарь смен» (§25.12)
// не был покрыт E2E — только ручная browser-QA (FRONTEND_PROGRESS Этап 9).
// Демо-сценарий детерминирован (DemoClock всегда стартует с
// DEFAULT_SCENARIO_START_ISO = 2026-07-20T08:00+05:00, см. demo-clock.ts) —
// дежурства И боевые группы сидированы на businessDate() старта (2026-07-20),
// расстановка ОМ «Международный экономический форум» — на daysFromStart=2
// (2026-07-22). Проверяет: дефолтный день показывает дежурства И боевые
// группы (продолжение работы над §24, добавлено по запросу «продолжай
// разрабатывать»), навигация вперёд на 2 дня показывает расстановку ОМ со
// ссылкой на карточку мероприятия.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Календарь смен: день по умолчанию → навигация → переход к источнику (mock-режим)', () => {
  test('дежурства на дефолтный день, расстановка ОМ на +2 дня со ссылкой на карточку', async ({
    page,
  }) => {
    await seedCredential(page)
    await page.goto('/calendar')

    await expect(page.getByRole('heading', { name: 'Календарь смен' })).toBeVisible()
    await expect(page.locator('input[type="date"]')).toHaveValue('2026-07-20')
    await expect(page.getByText(/2026-07-20 \(\d+\)/)).toBeVisible()
    await expect(page.getByText('Дежурство ·').first()).toBeVisible()

    // §24.5-24.10: боевая группа «Трасса №2 (принятый состав)» (ACCEPTED,
    // execution PENDING_ACKNOWLEDGEMENT) даёт по строке на leader+member.
    const combatRow = page.locator('tr', { hasText: 'Боевая группа · Трасса №2 (принятый состав)' })
    await expect(combatRow.filter({ hasText: 'Кенжебаев А.' })).toBeVisible()
    await expect(combatRow.filter({ hasText: 'Ожидает ознакомления' }).first()).toBeVisible()

    await page.locator('input[type="date"]').fill('2026-07-22')

    await expect(page.getByText(/2026-07-22 \(\d+\)/)).toBeVisible()
    const eventRow = page.locator('tr', { hasText: 'Международный экономический форум' })
    await expect(eventRow).toBeVisible()
    await expect(eventRow.getByText('Ахметов Б.')).toBeVisible()

    await eventRow.getByRole('link', { name: 'Открыть источник' }).click()
    await expect(
      page.getByRole('heading', { name: 'Международный экономический форум' }),
    ).toBeVisible()
  })
})
