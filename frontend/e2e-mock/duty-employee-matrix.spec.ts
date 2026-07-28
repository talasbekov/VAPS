// Smart Josparlau E2E (§33, Этап 35): §21.30 «По сотрудникам — матрица
// доступности» на вкладке «Месяц».
//
// Demo-сид даёт все четыре выводимых слоя без ручной подготовки:
//  • Сейтказы М. 2026-07-24 и 2026-07-25 — дежурство, хвост отдыха и жёсткий
//    конфликт нарушения отдыха (собственный объект, HARD_BLOCK);
//  • Ахметов Б. — смена на «Штабе управления», которого НЕТ в реестре объектов,
//    значит привязки к паспорту нет → слой «неполные данные».
//
// Даты — КОНСТАНТЫ фикстур (DemoClock стартует с 2026-07-20T08:00+05:00).
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Матрица доступности по сотрудникам (§21.30, mock-режим)', () => {
  test('четыре выводимых слоя видны, два невыводимых названы с причиной', async ({ page }) => {
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Месяц' }).click()
    await expect(page.getByRole('group', { name: 'Дежурств' })).toBeVisible()

    await page.getByRole('button', { name: 'Сотрудники × дни' }).click()

    const row = page.locator('tr', { hasText: 'Сейтказы М.' })
    await expect(row).toBeVisible()
    // Слои СКЛАДЫВАЮТСЯ в одной клетке, а не вытесняют друг друга: смены
    // Сейтказы М. стоят на «Штабе управления», которого нет в реестре
    // объектов, поэтому к слою «дежурство» добавляется «неполные данные».
    await expect(
      row.getByText('2026-07-24, дежурство, неполные данные: нет привязки к версии паспорта'),
    ).toBeVisible()
    // 25-го у него ВТОРОЕ дежурство подряд: дежурство доминирует над отдыхом,
    // а нарушение отдыха названо конфликтом — сервером, не матрицей.
    await expect(row.getByText(/^2026-07-25, дежурство,.*жёстких конфликтов: 1$/)).toBeVisible()
    // Хвост обязательного отдыха — уже после последней смены.
    await expect(row.getByText('2026-07-26, обязательный отдых после дежурства')).toBeVisible()
    await expect(row.getByText('2026-07-23, дежурств нет')).toBeVisible()

    // §35: два слоя §21.30, которых модель не даёт, названы с причиной.
    // Локатор сужен до САМОГО блока слоёв: отсутствие Employee Status
    // Repository — общая причина, и её называет ещё и шапка плана (§21.28,
    // поле «Состояние доступности»). Поиск по всей странице цеплял бы обе.
    const layers = page.locator('section', { hasText: 'Слои, которых нет в модели' }).last()
    await expect(layers).toBeVisible()
    await expect(layers.getByText(/Занятость охранным мероприятием/)).toBeVisible()
    await expect(layers.getByText(/Employee Status Repository/)).toBeVisible()
  })

  test('отменённая смена исчезает из матрицы вместе со своим хвостом отдыха', async ({ page }) => {
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Месяц' }).click()
    await page.getByRole('button', { name: 'Сотрудники × дни' }).click()
    const before = page.locator('tr', { hasText: 'Сагинова А.' })
    await expect(before).toBeVisible()

    // Отменяем единственную смену Сагиновой А. через карточку.
    await page.goto('/duties')
    await page.locator('tr', { hasText: 'Сагинова А.' }).getByRole('link').click()
    await expect(page.getByRole('heading', { name: 'Дом Министерств', level: 1 })).toBeVisible()
    await page.getByRole('button', { name: 'Отменить дежурство' }).click()
    const cancelForm = page.getByRole('group', { name: 'Отмена дежурства' })
    await cancelForm.getByLabel('Причина отмены').fill('Объект снят с охраны')
    await cancelForm.getByRole('button', { name: 'Подтвердить отмену' }).click()
    await expect(page.getByText('Отменено', { exact: true })).toBeVisible()

    await page.goto('/duties')
    await page.getByRole('button', { name: 'Месяц' }).click()
    await page.getByRole('button', { name: 'Сотрудники × дни' }).click()
    await expect(page.getByRole('group', { name: 'Отменено' })).toContainText('1')
    // Строки не осталось: у сотрудника в этом месяце больше нет ни дежурства,
    // ни отдыха — пустая строка ничего бы не сообщала.
    await expect(page.locator('tr', { hasText: 'Сагинова А.' })).toHaveCount(0)
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
