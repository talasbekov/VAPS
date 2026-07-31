// Smart Josparlau E2E (§33, Этап 59): §19.15-19.17 сводный экран «Итоговые
// оценки участников» — отбор в URL, безопасные колонки, возврат из карточки.
//
// Проверяется то, чего не видит ни один unit-тест: URL переживает переход в
// карточку и обратно в реальном роутере, а закрытые величины не приходят в
// браузер ни одним ответом по всему пути.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Итоговые оценки участников §19.15 (mock-режим)', () => {
  test('реестр приходит с сервера, а закрытых величин нет ни в одном ответе', async ({ page }) => {
    const payloads: string[] = []
    page.on('response', async (response) => {
      if (response.url().includes('/api/ops/evaluation-registry/')) {
        payloads.push(await response.text())
      }
    })
    await page.goto('/ratings/evaluations')
    await expect(page.getByRole('heading', { name: 'Итоговые оценки участников' })).toBeVisible()
    const line = page.getByRole('row', { name: /Ерланов/ }).first()
    await expect(line).toContainText('Детали оценки закрыты')

    expect(payloads.length).toBeGreaterThan(0)
    for (const body of payloads) {
      expect(body).not.toContain('demo-event-planner')
      expect(body).not.toContain('Задержка на инструктаже')
      expect(body).not.toContain('basisCode')
    }
  })

  test('отбор живёт в URL и уходит запросом на сервер', async ({ page }) => {
    const urls: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/ops/evaluation-registry/')) urls.push(request.url())
    })
    await page.goto('/ratings/evaluations')
    // Локатор сужен до панели фильтров: подпись «Сотрудник» встречается и в
    // навигации портала — поиск по всей странице был бы неоднозначным.
    const filters = page.getByRole('region', { name: 'Фильтры' })
    await filters.getByLabel('Сотрудник').selectOption('employee-2')
    await expect(page).toHaveURL(/employee=employee-2/)
    // Отбор выполняет СЕРВЕР: параметр уехал в запрос, а не отфильтровал
    // полученные строки в браузере.
    await expect.poll(() => urls.some((url) => url.includes('employee=employee-2'))).toBe(true)
    await expect(page.getByRole('row', { name: /Ерланов/ })).toHaveCount(0)
    await expect(page.getByRole('row', { name: /Абишев/ }).first()).toBeVisible()
  })

  test('возврат из карточки восстанавливает отбор и страницу (§19.15)', async ({ page }) => {
    await page.goto('/ratings/evaluations')
    await page.getByRole('region', { name: 'Фильтры' })
      .getByLabel('Подразделение')
      .selectOption('Второе управление')
    await expect(page).toHaveURL(/unit=/)

    await page.getByRole('link', { name: 'Открыть агрегат' }).first().click()
    await expect(page.getByRole('heading', { name: 'Агрегированный рейтинг участника' })).toBeVisible()
    // Карточка §19.17 показывает агрегат и не показывает ни одной оценки.
    await expect(page.getByLabel('Агрегат участника')).toContainText('Учтено оценок')

    await page.getByRole('link', { name: 'Вернуться к отбору' }).click()
    await expect(page).toHaveURL(/unit=/)
    // Именно ТОТ же отбор: селект восстановлен из URL, а не сброшен.
    await expect(
      page.getByRole('region', { name: 'Фильтры' }).getByLabel('Подразделение'),
    ).toHaveValue('Второе управление')
  })

  test('без права раздел не открывается и в меню не показан', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-objects-admin' }),
      )
    })
    await page.goto('/ratings/evaluations')
    await expect(page.getByText('Доступ запрещён')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Итоговые оценки участников' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Итоговые оценки' })).toHaveCount(0)
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
