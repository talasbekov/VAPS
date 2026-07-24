// Smart Josparlau E2E (§33, Этап 7 hardening — FRONTEND_TEST_MATRIX NEXT
// ACTION): «создать ОМ → сохранить бюллетень → reload → данные на месте».
// До этой спеки цепочка была проверена ТОЛЬКО вручную через preview-инструмент
// в каждой сессии — ни одного автотеста, доказывающего persist-through-reload
// в РЕАЛЬНОМ браузере (IndexedDB, не in-memory adapter юнит-тестов).
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Реестр ОМ: создание → бюллетень → reload (mock-режим)', () => {
  test('создать ОМ, сохранить бюллетень, обновить страницу — данные на месте', async ({
    page,
  }) => {
    await seedCredential(page)
    await page.goto('/security-events')

    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible()

    await page.getByRole('button', { name: '+ Создать ОМ' }).click()

    const dialog = page.getByRole('dialog')
    const title = `E2E мероприятие ${Date.now()}`
    await dialog.getByLabel('Название').fill(title)
    await dialog.getByLabel('Объект').fill('E2E Объект')
    await dialog.getByLabel('Дата проведения').fill('2026-08-01')
    await dialog.getByRole('button', { name: 'Создать' }).click()

    // Успешное создание уводит на карточку мероприятия (BULLETIN — первая стадия)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Информационный бюллетень' }),
    ).toBeVisible()

    const briefDescription = `Краткое описание ${Date.now()}`
    const initialTasks = 'Первичные задачи направлениям (E2E)'
    await page.locator('textarea').first().fill(briefDescription)
    await page.locator('textarea').nth(1).fill(initialTasks)
    await page.getByRole('button', { name: 'Сохранить бюллетень' }).click()

    // Кнопка возвращается в disabled-состояние (isDirty=false) только после
    // успешного reset() из onSuccess — сам факт "не в состоянии Сохранение…"
    // недостаточен, дожидаемся именно этого.
    await expect(
      page.getByRole('button', { name: 'Сохранить бюллетень' }),
    ).toBeDisabled()

    await page.reload()

    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.locator('textarea').first()).toHaveValue(briefDescription)
    await expect(page.locator('textarea').nth(1)).toHaveValue(initialTasks)
  })
})
