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

  test('публикация версии паспорта: снимок неизменяем и открывается по своему deep link', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    // «Дом Министерств» — объект без сеяных версий (у «Дворца Независимости»
    // версия v1 есть из сида, здесь важно пройти публикацию с нуля).
    await page.goto('/objects')
    await page.getByRole('link', { name: /Дом Министерств/ }).click()
    await expect(page.getByRole('heading', { name: 'Дом Министерств' })).toBeVisible()

    const versionsPanel = page.locator('section', { hasText: 'Версии паспорта' }).last()
    await expect(versionsPanel.getByText('Паспорт ещё не публиковался.')).toBeVisible()

    // Фиксируем название поста, который попадёт в снимок.
    const publishedPostName = `Пост до публикации ${Date.now()}`
    await page.getByPlaceholder('Название поста').first().fill(publishedPostName)
    await page.getByRole('button', { name: 'Сохранить паспорт' }).click()
    await expect(page.getByRole('button', { name: 'Сохранить паспорт' })).toBeDisabled()

    await page.getByLabel('Действует с *').fill('2026-08-01')
    await page.getByLabel('Примечание к публикации').fill('E2E публикация')
    await page.getByRole('button', { name: 'Опубликовать версию' }).click()
    await expect(page.getByRole('link', { name: 'Версия 1' })).toBeVisible()

    // §8.10 «не более одной версии на дату» — повтор на ту же дату отклоняется.
    // Ассерт на `alert` ниже неваккуумен только если до повтора его НЕ было.
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByLabel('Действует с *').fill('2026-08-01')
    await page.getByRole('button', { name: 'Опубликовать версию' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Версия 2' })).toHaveCount(0)

    // Правим ДЕЙСТВУЮЩУЮ редакцию после публикации.
    const draftPostName = `Пост после публикации ${Date.now()}`
    await page.getByPlaceholder('Название поста').first().fill(draftPostName)
    await page.getByRole('button', { name: 'Сохранить паспорт' }).click()
    await expect(page.getByRole('button', { name: 'Сохранить паспорт' })).toBeDisabled()

    // Снимок версии правку НЕ подхватил (§8.10) и открылся по deep link.
    await page.getByRole('link', { name: 'Версия 1' }).click()
    await expect(page).toHaveURL(/\/objects\/[^/]+\/passports\/[^/]+$/)
    await expect(page.getByText(publishedPostName)).toBeVisible()
    await expect(page.getByText(draftPostName)).toHaveCount(0)
    await expect(page.getByText('E2E публикация')).toBeVisible()
    // Read-only: страница версии ничего не редактирует.
    const versionBody = page.locator('main')
    await expect(versionBody.getByRole('button')).toHaveCount(0)
    await expect(versionBody.getByRole('textbox')).toHaveCount(0)

    // Deep link переживает перезагрузку (собственный URL, а не состояние в памяти).
    await page.reload()
    await expect(page.getByText(publishedPostName)).toBeVisible()
  })
})
