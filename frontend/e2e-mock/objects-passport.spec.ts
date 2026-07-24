// Smart Josparlau E2E (§33, NEXT ACTION Этап 10): «Объекты и паспорта»
// (§21.6/§21.2) не были покрыты E2E — только ручная browser-QA. Проверяет
// реестр → поиск → паспорт объекта → добавление сектора+поста → сохранение
// → reload (persist-through-reload в РЕАЛЬНОМ IndexedDB, тот же принцип, что
// security-event-lifecycle.spec.ts).
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

test.describe('Объекты: реестр → паспорт → редактирование секторов/постов (mock-режим)', () => {
  test('добавить сектор и пост в паспорт, сохранить, обновить страницу — данные на месте', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/objects')

    await expect(page.getByRole('heading', { name: 'Объекты и паспорта' })).toBeVisible()

    await page.getByPlaceholder('Поиск по наименованию, коду, адресу, типу…').fill('Дом Министерств')
    await expect(page.locator('table tbody tr')).toHaveCount(1)

    await page.getByRole('link', { name: /Дом Министерств/ }).click()
    await expect(page.getByRole('heading', { name: 'Дом Министерств' })).toBeVisible()

    await page.getByRole('button', { name: '+ Сектор' }).click()
    const sectorName = `E2E Сектор ${Date.now()}`
    await page.getByPlaceholder('Название сектора').last().fill(sectorName)

    await page.getByRole('button', { name: '+ Пост' }).last().click()
    const postName = `E2E Пост ${Date.now()}`
    await page.getByPlaceholder('Название поста').last().fill(postName)
    await page.getByPlaceholder('Задача').last().fill('E2E задача поста')

    await page.getByRole('button', { name: 'Сохранить паспорт' }).click()
    await expect(page.getByRole('button', { name: 'Сохранить паспорт' })).toBeDisabled()

    await page.reload()

    await expect(page.getByPlaceholder('Название сектора').last()).toHaveValue(sectorName)
    await expect(page.getByPlaceholder('Название поста').last()).toHaveValue(postName)
  })
})
