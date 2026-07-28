// Smart Josparlau E2E (§33, Этап 30): §9.6 «дежурство должно ссылаться минимум
// на objectId / passportVersionId / sectorId / postId».
//
// Demo-seed даёт все три исхода привязки (features/duties/mocks/fixtures.ts):
//  • «Дворец Независимости» — объект реестра, версия 1 действует → сектор/пост;
//  • «Дом Министерств» — объект реестра, паспорт не публиковали;
//  • «Штаб управления» — собственный объект, в реестре объектов его нет.
//
// Второй тест — сквозной: публикация НОВОЙ версии паспорта через UI объектов
// обязана пометить привязку дежурства устаревшей, НЕ переписав снимок поста.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Дежурство: привязка к версии паспорта объекта (§9.6, mock-режим)', () => {
  test('в плане дежурств названы все три исхода привязки', async ({ page }) => {
    await seedCredential(page)
    await page.goto('/duties')
    await expect(page.getByRole('heading', { name: 'План дежурств' })).toBeVisible()

    const palaceRow = page.locator('tr', { hasText: 'Ерланов Д.' })
    await expect(palaceRow.getByText('Сектор A · КПП-1')).toBeVisible()
    await expect(palaceRow.getByText(/Паспорт: ред\. 1 от /)).toBeVisible()

    await expect(
      page
        .locator('tr', { hasText: 'Сагинова А.' })
        .getByText(/нет опубликованной версии паспорта объекта/),
    ).toBeVisible()

    await expect(
      page
        .locator('tr', { hasText: 'Ахметов Б.' })
        .getByText(/не заведён в реестре объектов/),
    ).toBeVisible()
  })

  test('публикация новой версии паспорта помечает привязку устаревшей, не трогая снимок поста', async ({
    page,
  }) => {
    await seedCredential(page)

    await page.goto('/objects')
    await page.getByRole('link', { name: /Дворец Независимости/ }).first().click()
    await expect(page.getByRole('heading', { name: /Дворец Независимости/ })).toBeVisible()
    // Дата ЗАВЕДОМО раньше бизнес-даты дежурства и не совпадает с версией 1
    // (§8.10 — на одну дату не больше одной версии).
    await page.getByLabel('Действует с *').fill('2026-07-19')
    await page.getByRole('button', { name: 'Опубликовать версию' }).click()
    await expect(page.getByText(/Версия 2 действует с 2026-07-19/)).toBeVisible()

    await page.goto('/duties')
    const palaceRow = page.locator('tr', { hasText: 'Ерланов Д.' })
    await expect(
      palaceRow.getByText(
        'Действующая редакция паспорта — версия 2, дежурство привязано к версии 1. Пост не переназначается автоматически.',
      ),
    ).toBeVisible()
    // Снимок НЕ переписан: дежурство осталось на версии 1 и на своём посту.
    await expect(palaceRow.getByText('Сектор A · КПП-1')).toBeVisible()
    await expect(palaceRow.getByText(/Паспорт: ред\. 1 от /)).toBeVisible()
  })
})
