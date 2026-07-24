// Smart Josparlau E2E (§33, NEXT ACTION Этап 10 — FRONTEND_PROGRESS.md):
// «Сотрудники» (§20.2) не были покрыты ни одной E2E-спекой — только ручная
// browser-QA. Проверяет реальный путь: реестр (поиск + фильтр по
// подразделению, оба в URL) → карточка сотрудника (кадровые данные из донора,
// честная секция "Not started" для оперативных данных Smart Josparlau).
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Сотрудники: реестр → поиск/фильтр → карточка (mock-режим)', () => {
  test('поиск по ФИО и фильтр по подразделению сужают список, карточка открывается', async ({
    page,
  }) => {
    await seedCredential(page)
    await page.goto('/employees')

    await expect(page.getByRole('heading', { name: 'Сотрудники' })).toBeVisible()

    const rowsLocator = page.locator('table tbody tr')
    await expect(rowsLocator.first()).toBeVisible()
    const totalCount = await rowsLocator.count()
    expect(totalCount).toBeGreaterThan(1)

    await page
      .getByPlaceholder('Поиск по ФИО, должности, подразделению…')
      .fill('Ерланов')
    await expect(rowsLocator).toHaveCount(1)
    await expect(page.getByRole('link', { name: /Ерланов/ })).toBeVisible()

    // URL отражает поиск (переживает переход между страницами — тот же
    // принцип, что security-events).
    expect(page.url()).toContain('search=')

    await page.getByPlaceholder('Поиск по ФИО, должности, подразделению…').fill('')
    await expect(rowsLocator).toHaveCount(totalCount)
    await page.getByLabel('Подразделение').selectOption({ label: 'Штаб охранных мероприятий' })

    const filteredCount = await rowsLocator.count()
    expect(filteredCount).toBeGreaterThanOrEqual(1)
    expect(filteredCount).toBeLessThan(totalCount)

    await page.getByRole('link', { name: /Нуртаев/ }).click()

    await expect(page.getByRole('heading', { name: /Нуртаев/ })).toBeVisible()
    await expect(page.getByText('Кадровая принадлежность')).toBeVisible()
    await expect(
      page.getByText(
        'Дежурства, участие в ОМ, назначения, ознакомление и оперативный рейтинг — Not',
      ),
    ).toBeVisible()

    await page.getByRole('link', { name: '← Назад к списку' }).click()
    await expect(page.getByRole('heading', { name: 'Сотрудники' })).toBeVisible()
  })
})
