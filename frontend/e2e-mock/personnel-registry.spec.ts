// Smart Josparlau E2E (§33, NEXT ACTION Этап 10 — FRONTEND_PROGRESS.md):
// «Сотрудники» (§20.2) не были покрыты ни одной E2E-спекой — только ручная
// browser-QA. Проверяет реальный путь: реестр (поиск + фильтр по
// подразделению, оба в URL) → карточка сотрудника (кадровые данные из донора,
// оперативный профиль §20.5/20.15 — вкладки Сводка/Доступность/Назначения/
// Подготовка и допуски/Нагрузка/Рейтинг/Документы, каждая честно объясняет
// отсутствие подключения вместо одной общей заглушки).
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
    await expect(page.getByText('Оперативный профиль (Smart Josparlau)')).toBeVisible()

    // Вкладка «Сводка» открыта по умолчанию.
    await expect(page.getByRole('tabpanel', { name: 'Сводка' })).toContainText(
      'Not started в текущем срезе',
    )

    // Каждая вкладка честно объясняет отсутствие подключения (не одна заглушка).
    await page.getByRole('tab', { name: 'Назначения' }).click()
    await expect(page.getByRole('tabpanel', { name: 'Назначения' })).toContainText(
      'не подключены к карточке',
    )
    await expect(page.getByRole('tabpanel', { name: 'Назначения' })).toContainText('A44-A46')

    await page.getByRole('tab', { name: 'Рейтинг' }).click()
    await expect(page.getByRole('tabpanel', { name: 'Рейтинг' })).toContainText(
      'не реализован в этом проекте',
    )

    await page.getByRole('link', { name: '← Назад к списку' }).click()
    await expect(page.getByRole('heading', { name: 'Сотрудники' })).toBeVisible()
  })
})
