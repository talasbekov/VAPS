// Smart Josparlau E2E (§33, Этап 36): §21.30 «Список дежурств» и «История».
//
// Demo-сид: бизнес-дата 2026-07-20, все смены лежат НА ней или ПОСЛЕ (Этап 31
// зафиксировал это намеренно). Значит история пуста по построению — и это её
// честный, а не сломанный вид. Наполняем историю через UI: доводим смену до
// завершения нельзя «в прошлом», поэтому проверяем пустое состояние словами и
// отдельным сценарием — что завершённая СЕГОДНЯ смена в историю не попадает.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Список дежурств и история (§21.30, mock-режим)', () => {
  test('список несёт выводимые колонки и называет невыводимые с причиной', async ({ page }) => {
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Список' }).click()

    const list = page.getByRole('region', { name: 'Список дежурств' })
    await expect(list).toBeVisible()
    await expect(list.getByText('Бизнес-дата: 2026-07-20')).toBeVisible()

    // Строка «Ерланова Д.» — привязка к паспорту есть, ознакомление подтверждено.
    const row = list.locator('tr', { hasText: 'Ерланов Д.' })
    await expect(row.getByText('Сектор A · КПП-1')).toBeVisible()
    await expect(row.getByText('Ознакомлен')).toBeVisible()

    // §9.6: смена на объекте вне реестра — «Пост вне паспорта», а не пустая ячейка.
    await expect(
      list.locator('tr', { hasText: 'Ахметов Б.' }).getByText('Пост вне паспорта'),
    ).toBeVisible()

    // §21.34: счётчик конфликтов серверный — у Жумабаева Р. пересечение.
    await expect(
      list.locator('tr', { hasText: 'Жумабаев Р.' }).first().getByText(/Жёстких: 1/),
    ).toBeVisible()

    // §35: четыре колонки промпта, которых нет в модели, названы с причиной.
    await expect(list.getByText('Колонки, которых нет в модели')).toBeVisible()
    await expect(list.getByText(/Интервал \(время начала и окончания\)/)).toBeVisible()
    await expect(list.getByText(/Открытые посты/)).toBeVisible()

    // Строка ведёт в карточку — список не тупик.
    await row.getByRole('link').click()
    await expect(
      page.getByRole('heading', { name: 'Дворец Независимости', level: 1 }),
    ).toBeVisible()
  })

  test('История пуста честно: завершённая СЕГОДНЯ смена в неё не попадает', async ({ page }) => {
    // Доводим смену Сагиновой А. (2026-07-20 = бизнес-дата) до завершения.
    await page.goto('/duties')
    await page.locator('tr', { hasText: 'Сагинова А.' }).getByRole('link').click()
    await expect(page.getByRole('heading', { name: 'Дом Министерств', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Ознакомиться' }).click()
    await page.getByRole('button', { name: 'Заступить' }).click()
    await page.getByRole('button', { name: 'Завершить' }).click()
    await expect(page.getByText('Завершено')).toBeVisible()

    await page.goto('/duties')
    await page.getByRole('button', { name: 'Список' }).click()
    const list = page.getByRole('region', { name: 'Список дежурств' })
    // В общем списке она есть и завершена.
    await expect(list.locator('tr', { hasText: 'Сагинова А.' }).getByText('Завершено')).toBeVisible()

    await list.getByRole('button', { name: 'История' }).click()
    await expect(list.getByText('Завершённые дежурства до 2026-07-20')).toBeVisible()
    // Факт есть, но день ещё не прошёл — история требует ОБА признака.
    await expect(list.getByText('Завершённых дежурств за прошедшие дни нет')).toBeVisible()
    await expect(list.locator('tr', { hasText: 'Сагинова А.' })).toHaveCount(0)
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
