// Smart Josparlau E2E (§33): «Справочники» (§30).
//
// Этап 52 переписал спеку целиком. Прежняя приколачивала ВЫДУМАННЫЙ текст
// («Значение используется в 3 связанных записях») — число приезжало из
// фикстуры и не значило ничего: у типов записей журнала, единственного
// справочника с настоящим потребителем, оно утверждало «связей нет».
//
// Теперь связи считает сервер по общему demo-снимку, и спека проверяет ровно
// то, чего не покажет ни один unit-тест: запись, добавленная в журнал ШТАБА на
// стадии «Проведение» мероприятия, ЗАПИРАЕТ значение справочника в другом
// разделе. Связь идёт через общий снапшот — каждый уровень видит лишь свою
// половину.
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

const JOURNAL_TYPES_LINK = /Типы записей журнала/

test.describe('Справочники: живые связи значений (§30, mock-режим)', () => {
  test('запись журнала ОМ запирает значение справочника: связей нет → удаление проходит; со связью → 409 с зависимостью', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)

    // --- 1. Исходно журнал ОМ пуст, значит связей у типов записей НЕТ ---
    await page.goto('/dictionaries')
    await expect(page.getByRole('heading', { name: 'Справочники' })).toBeVisible()
    await page.getByRole('link', { name: JOURNAL_TYPES_LINK }).click()
    await expect(page.getByRole('heading', { name: 'Типы записей журнала' })).toBeVisible()

    const instructionRow = page.locator('tr', { hasText: 'Инструктаж' })
    await expect(instructionRow.getByText('Связей нет')).toBeVisible()

    // Отслеживаемое значение без связей УДАЛЯЕТСЯ — проверяем на «Замене»,
    // чтобы «Инструктаж» остался для главной части сценария.
    const replacementRow = page.locator('tr', { hasText: 'Замена' })
    await expect(replacementRow.getByText('Связей нет')).toBeVisible()
    await replacementRow.getByRole('button', { name: 'Удалить' }).click()
    await expect(page.locator('tr', { hasText: 'Замена' })).toHaveCount(0)

    // --- 2. Заводим запись журнала на стадии «Проведение» ---
    await page.goto('/security-events')
    await page
      .getByRole('row', { name: /Городской спортивный форум/ })
      .getByRole('link')
      .first()
      .click()

    await page.getByRole('button', { name: 'Утвердить расстановку' }).click()
    await page.getByRole('button', { name: 'Отметить ознакомление' }).click()
    await page.getByRole('button', { name: 'Начать проведение' }).click()
    await expect(page.getByRole('heading', { name: 'Проведение' })).toBeVisible()

    await page.getByLabel('Тип *').selectOption({ label: 'Инструктаж' })
    await page.getByLabel('Заголовок *').fill('E2E инструктаж')
    await page.getByLabel('Описание *').fill('Проведён инструктаж всех постов.')
    await page.getByRole('button', { name: 'Добавить запись' }).click()
    await expect(page.getByText('E2E инструктаж')).toBeVisible()

    // --- 3. Справочник УЖЕ видит связь, и она названа поимённо ---
    await page.goto('/dictionaries/JOURNAL_ENTRY_TYPES')
    const lockedRow = page.locator('tr', { hasText: 'Инструктаж' })
    await expect(lockedRow.getByText('Записи журнала штаба (охранные мероприятия)')).toBeVisible()

    // --- 4. Оба действия отклонены, и отказ называет ЗАВИСИМОСТЬ ---
    await lockedRow.getByRole('button', { name: 'Удалить' }).click()
    const refusal = page.getByRole('alert')
    await expect(refusal).toContainText('Записи журнала штаба')
    await expect(refusal).toContainText('ОМ-2026-3')
    // Отклонённая мутация ничего не удалила.
    await expect(lockedRow).toBeVisible()

    await lockedRow.getByRole('button', { name: 'Деактивировать' }).click()
    await expect(page.getByRole('alert').first()).toContainText('деактивация запрещена')
    await expect(lockedRow.getByText('Активно', { exact: true })).toBeVisible()
  })

  test('неотслеживаемый справочник не удаляется, но деактивируется — и говорит почему', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/dictionaries/RETURN_REASONS')

    const row = page.locator('tr', { hasText: 'Обнаружено двойное назначение' })
    await expect(row.getByText('Не отслеживается')).toBeVisible()

    await row.getByRole('button', { name: 'Удалить' }).click()
    await expect(page.getByRole('alert')).toContainText('Отсутствие связей не доказано')
    await expect(row).toBeVisible()

    // Обратимое действие разрешено — путь для администратора остаётся.
    await row.getByRole('button', { name: 'Деактивировать' }).click()
    await expect(row.getByText('Деактивировано', { exact: true })).toBeVisible()

    await page.reload()
    await expect(
      page
        .locator('tr', { hasText: 'Обнаружено двойное назначение' })
        .getByText('Деактивировано', { exact: true }),
    ).toBeVisible()
  })

  test('создание значения персистентно через reload', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/dictionaries/RETURN_REASONS')

    const code = `E2E_REASON_${Date.now()}`
    await page.getByLabel('Код').fill(code)
    await page.getByLabel('Наименование').fill('E2E причина возврата')
    await page.getByLabel('Описание').fill('Создано автотестом')
    await page.getByRole('button', { name: 'Добавить' }).click()

    await expect(page.getByText(code)).toBeVisible()
    await page.reload()
    await expect(page.getByText(code)).toBeVisible()
  })
})
