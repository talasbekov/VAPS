// Smart Josparlau E2E (§33, Этап 29): §9.6 «Объект, паспорт и посты» —
// планирование опирается на КОНКРЕТНУЮ опубликованную версию паспорта, а
// расстановка обязана ссылаться на objectId/passportVersionId/sectorId/postId.
//
// Demo-seed даёт все три исхода привязки (см. security-events/mocks/fixtures.ts):
//  • «Культурный форум приграничных регионов» — OBJ-001, версия 1 действует
//    (стадия RECON — единственная, где посты можно перенести из паспорта);
//  • «Рабочее совещание акимата» — OBJ-002 есть в реестре, паспорт не публиковали;
//  • «Официальный визит делегации» — объекта «Резиденция» в реестре нет вовсе.
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

test.describe('ОМ: привязка к версии паспорта объекта (§9.6, mock-режим)', () => {
  test('привязанный ОМ показывает версию паспорта, а непривязанные — причину словами', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/security-events')

    await page.getByRole('link', { name: /Культурный форум приграничных регионов/ }).click()
    await expect(page.getByText('Паспорт: версия 1')).toBeVisible()

    await page.getByRole('link', { name: '← Назад к реестру' }).click()
    await page.getByRole('link', { name: /Рабочее совещание акимата/ }).click()
    await expect(
      page.getByText(/нет опубликованной версии паспорта объекта/),
    ).toBeVisible()

    await page.getByRole('link', { name: '← Назад к реестру' }).click()
    await page.getByRole('link', { name: /Официальный визит делегации/ }).click()
    await expect(page.getByText(/не привязано к объекту реестра/)).toBeVisible()
  })

  test('импорт постов из паспорта доводит цепочку до расстановки и переживает правку и перезагрузку', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/security-events')
    await page.getByRole('link', { name: /Культурный форум приграничных регионов/ }).click()
    await expect(page.getByRole('heading', { name: 'Рекогносцировка объекта' })).toBeVisible()

    // В сиде — один РУЧНОЙ пост; из паспорта «Дворца Независимости» доступны три.
    const importButton = page.getByRole('button', {
      name: /Импортировать посты из паспорта \(3\)/,
    })
    await expect(importButton).toBeEnabled()
    await importButton.click()

    // Импорт ДОБАВЛЯЕТ: ручной пост остаётся, к нему приходят посты паспорта.
    // Счёт СТРОГО внутри таблицы расчёта: подпись кнопки «Импортировать посты
    // из паспорта» содержит ту же подстроку и завысила бы счётчик до 4.
    const sourceMarks = page.locator('table').getByText('из паспорта')
    await expect(sourceMarks).toHaveCount(3)

    // Повторный импорт нечего переносить — кнопка гаснет, а не плодит дубли.
    await expect(
      page.getByRole('button', { name: 'Импортировать посты из паспорта' }),
    ).toBeDisabled()

    // Правка импортированной строки не рвёт связь с постом паспорта: после
    // «Сохранить расчёт» и полной перезагрузки метка источника на месте.
    const kppRow = page.locator('tr', { has: page.locator('input[value="КПП-1"]') })
    await kppRow.locator('input[value="КПП-1"]').fill('КПП-1 (уточнён)')
    await page.getByRole('button', { name: 'Сохранить расчёт' }).click()
    await expect(page.getByRole('button', { name: 'Сохранить расчёт' })).toBeEnabled()

    await page.reload()
    await expect(page.locator('input[value="КПП-1 (уточнён)"]')).toBeVisible()
    await expect(page.locator('table').getByText('из паспорта')).toHaveCount(3)

    // Довести до расстановки — там пост, пришедший из паспорта, помечен как
    // таковой: §9.6-цепочка «назначение → пост версии паспорта» видима в UI.
    const checkboxes = page.getByRole('checkbox')
    for (let i = 0; i < (await checkboxes.count()); i += 1) {
      const box = checkboxes.nth(i)
      if (!(await box.isChecked())) await box.check()
    }
    await page.getByRole('button', { name: 'Сохранить расчёт' }).click()
    await page.getByRole('button', { name: 'Завершить этап и перейти далее' }).click()

    await expect(page.getByRole('heading', { name: 'Потребность и выделение сил' })).toBeVisible()
    await page.getByRole('button', { name: '+ Добавить потребность' }).click()
    const demandRow = page.locator('table tbody tr').first()
    await demandRow.locator('input').first().fill('Сектор A')
    await demandRow.locator('input').nth(1).fill('Контроль въезда')
    await page.getByRole('button', { name: 'Сохранить и утвердить потребность' }).click()

    await expect(page.getByText('2 · Выделение сил')).toBeVisible()
    await page.locator('input[type="number"]').fill('1')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await page.getByRole('button', { name: 'Завершить этап и перейти далее' }).click()

    await expect(page.getByRole('heading', { name: 'Расстановка' })).toBeVisible()
    await expect(
      page.getByRole('button', { name: /КПП-1 \(уточнён\)[\s\S]*из паспорта/ }),
    ).toBeVisible()
    // Привязка видна и на стадии расстановки — версия не «потерялась» по пути.
    await expect(page.getByText('Паспорт: версия 1')).toBeVisible()
  })
})
