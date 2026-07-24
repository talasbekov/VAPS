// Smart Josparlau E2E (§33) — вторая половина жизненного цикла ОМ (Этап 3):
// Согласование → Ознакомление → Проведение → Закрыто. До этой спеки цепочка
// была проверена ТОЛЬКО вручную через preview-инструмент (см. FRONTEND_TEST_
// MATRIX «Ручная браузерная проверка полного цикла ОМ»). Использует СЕЯНОЕ
// (не создаваемое в спеке) мероприятие «Городской спортивный форум» —
// единственный seed-объект в стадии APPROVAL (fixtures.ts), с ровно 1
// назначением на 1 пост, чтобы не дублировать Расстановку/Рекогносцировку.
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

test.describe('ОМ: Согласование → Ознакомление → Проведение → Закрыто (mock-режим)', () => {
  test('утверждение расстановки автоматически открывает Ознакомление, полный цикл до Закрыто', async ({
    page,
  }) => {
    await seedCredential(page)
    // Журнал штаба + итоги закрытия физически перекрывались бы DemoToolbar
    // (fixed bottom-4 right-4) на этой странице — см. testUtils.ts.
    await hideDemoToolbar(page)
    await page.goto('/security-events')
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible()

    await page
      .getByRole('row', { name: /Городской спортивный форум/ })
      .getByRole('link')
      .first()
      .click()

    await expect(
      page.getByRole('heading', { name: 'Согласование расстановки' }),
    ).toBeVisible()

    // Утверждение — ОДНА мутация, сразу переводит стадию в Ознакомление
    // (Epic 16.4→16.6, FRONTEND_DECISIONS A19) — без промежуточного клика.
    await page.getByRole('button', { name: 'Утвердить расстановку' }).click()
    await expect(page.getByRole('heading', { name: 'Ознакомление' })).toBeVisible()
    await expect(page.getByText('Ознакомлено: 0/1')).toBeVisible()

    await page.getByRole('button', { name: 'Отметить ознакомление' }).click()
    await expect(page.getByText('Ознакомлено: 1/1')).toBeVisible()

    const startConductButton = page.getByRole('button', { name: 'Начать проведение' })
    await expect(startConductButton).toBeEnabled()
    await startConductButton.click()

    await expect(page.getByRole('heading', { name: 'Проведение' })).toBeVisible()

    // Журнал штаба: одна запись типа «Инструктаж» (append-only, FRONTEND_
    // DECISIONS A22 — нет edit/delete)
    await page.getByLabel('Заголовок *').fill('E2E инструктаж')
    await page.getByLabel('Описание *').fill('Проведён инструктаж всех постов, замечаний нет.')
    await page.getByRole('button', { name: 'Добавить запись' }).click()
    await expect(page.getByText('Инструктаж перед началом').or(page.getByText('E2E инструктаж'))).toBeVisible()

    await page.getByRole('button', { name: 'Закрыть мероприятие' }).click()
    await expect(page.getByText('Итоги по направлениям (обязательны все)')).toBeVisible()

    // Итог обязателен ПО КАЖДОМУ направлению (Epic 18.1 FR-30) — у seed-события
    // ровно один сектор «A»; getByLabel — точный локатор (label htmlFor=
    // closure-direction-A), а не позиционный `.last()` среди ВСЕХ textarea.
    await page.getByLabel('A *').fill('Направление A отработано штатно, инцидентов нет (E2E).')
    await page.getByRole('button', { name: 'Подтвердить закрытие' }).click()

    await expect(page.getByRole('heading', { name: 'Закрыто' })).toBeVisible()
    await expect(page.getByText(/Мероприятие закрыто/)).toBeVisible()

    // Persist-through-reload: закрытая стадия — терминальная, должна пережить перезагрузку.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Закрыто' })).toBeVisible()
    await expect(
      page.getByText('Направление A отработано штатно, инцидентов нет (E2E).'),
    ).toBeVisible()

    // Реестр отражает Закрыто сразу после закрытия (без ручного refetch).
    await page.goto('/security-events')
    await expect(
      page.getByRole('row', { name: /Городской спортивный форум/ }).getByText('Закрыто'),
    ).toBeVisible()
  })
})
