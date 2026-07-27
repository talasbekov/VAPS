// Smart Josparlau E2E (§33, Этап 34): правка и отмена заведённой смены (§21.31).
//
// До этого среза создание было односторонним: ошибку в сотруднике или посте
// исправить было нечем. Спека проходит оба пути на живом DOM, включая эффекты
// отмены на СОСЕДНИХ экранах (месячный план, аналитика) — отменённая смена
// обязана выбыть из показателей, оставшись в данных.
//
// Даты — КОНСТАНТЫ фикстур (DemoClock стартует с 2026-07-20T08:00+05:00).
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { seedCredential } from './testUtils'

/** Сагинова А. — единственная PLANNED-смена бизнес-даты, «Дом Министерств». */
async function openSaginovaCard(page: Page): Promise<void> {
  await page.goto('/duties')
  await expect(page.getByRole('heading', { name: 'План дежурств' })).toBeVisible()
  await page.locator('tr', { hasText: 'Сагинова А.' }).getByRole('link').click()
  await expect(page.getByRole('heading', { name: 'Дом Министерств', level: 1 })).toBeVisible()
}

test.describe('Правка и отмена дежурства (§21.31, mock-режим)', () => {
  test('отмена: причина обязательна, смена остаётся в плане и выбывает из показателей', async ({
    page,
  }) => {
    // Снимок «до»: месячный план считает эту смену.
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Месяц' }).click()
    const shiftsKpi = page.getByRole('group', { name: 'Дежурств' })
    await expect(shiftsKpi).toBeVisible()
    const shiftsBefore = Number((await shiftsKpi.innerText()).replace(/\D/g, ''))
    expect(shiftsBefore).toBeGreaterThan(0)

    await openSaginovaCard(page)
    await page.getByRole('button', { name: 'Отменить дежурство' }).click()
    const cancelForm = page.getByRole('group', { name: 'Отмена дежурства' })
    await expect(cancelForm.getByRole('button', { name: 'Подтвердить отмену' })).toBeDisabled()
    await cancelForm.getByLabel('Причина отмены').fill('Объект снят с охраны')
    await cancelForm.getByRole('button', { name: 'Подтвердить отмену' }).click()

    await expect(page.getByText('Отменено', { exact: true })).toBeVisible()
    await expect(page.getByText('Объект снят с охраны')).toBeVisible()
    // Отменённая смена не предлагает ни действий, ни повторной правки.
    await expect(page.getByRole('button', { name: 'Ознакомиться' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Изменить' })).toHaveCount(0)

    // Смена ОСТАЛАСЬ в плане, с причиной — след планирования не стёрт.
    await page.goto('/duties')
    const row = page.locator('tr', { hasText: 'Сагинова А.' })
    await expect(row.getByText('Отменено: Объект снят с охраны')).toBeVisible()

    // …но выбыла из показателей месяца — и попала в отдельный счётчик отмен,
    // а не растворилась.
    await page.getByRole('button', { name: 'Месяц' }).click()
    await expect(page.getByRole('group', { name: 'Дежурств' })).toContainText(
      String(shiftsBefore - 1),
    )
    await expect(page.getByRole('group', { name: 'Отменено' })).toContainText('1')

    // Персистентность через reload.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'План дежурств' })).toBeVisible()
    await expect(
      page.locator('tr', { hasText: 'Сагинова А.' }).getByText('Отменено: Объект снят с охраны'),
    ).toBeVisible()
  })

  test('отменённая смена освобождает сотрудника: тот же день перестаёт быть занят', async ({
    page,
  }) => {
    await openSaginovaCard(page)
    await page.getByRole('button', { name: 'Отменить дежурство' }).click()
    const cancelForm = page.getByRole('group', { name: 'Отмена дежурства' })
    await cancelForm.getByLabel('Причина отмены').fill('Объект снят с охраны')
    await cancelForm.getByRole('button', { name: 'Подтвердить отмену' }).click()
    await expect(page.getByText('Отменено', { exact: true })).toBeVisible()

    // §21.33: подбор кандидатов перечитан — Сагинова А. больше не «уже назначена».
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Создать дежурство' }).click()
    const form = page.getByRole('group', { name: 'Форма нового дежурства' })
    await expect(
      form.getByRole('option', { name: /Сагинова А\..*уже назначен на эту дату/ }),
    ).toHaveCount(0)
  })

  test('правка: переназначение поста и сотрудника; ознакомление снимается', async ({ page }) => {
    // Ерланов Д. — ACKNOWLEDGED-смена на «Дворце Независимости» с постами в паспорте.
    await page.goto('/duties')
    await page.locator('tr', { hasText: 'Ерланов Д.' }).getByRole('link').click()
    await expect(
      page.getByRole('heading', { name: 'Дворец Независимости', level: 1 }),
    ).toBeVisible()
    await expect(page.getByText('Ознакомлен', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Изменить' }).click()
    const form = page.getByRole('group', { name: 'Правка дежурства' })
    await expect(form.getByLabel('Пост')).toBeVisible()

    // Смена сотрудника предупреждает о снятии ознакомления ДО сохранения.
    await form.getByLabel('Сотрудник').selectOption('Абишев Н.')
    await expect(form.getByText(/Ознакомление будет снято/)).toBeVisible()

    await form.getByLabel('Пост').selectOption({ label: 'Сектор A · Пост 2' })
    await form.getByLabel('Примечание').fill('Перевод на периметр')
    await form.getByRole('button', { name: 'Сохранить изменения' }).click()

    // Пост и исполнитель новые, состояние откатилось в «Запланировано».
    await expect(page.getByText('Сектор A · Пост 2')).toBeVisible()
    await expect(page.getByText('Абишев Н.')).toBeVisible()
    await expect(page.getByText('Запланировано')).toBeVisible()
    await expect(page.getByText('Перевод на периметр')).toBeVisible()

    await page.reload()
    await expect(page.getByText('Сектор A · Пост 2')).toBeVisible()
  })

  test('§21.34: правка, создающая пересечение, отклоняется без обхода', async ({ page }) => {
    // Ерланов Д. 2026-07-20 → назначить Ахметова Б., который в этот день уже дежурит.
    await page.goto('/duties')
    await page.locator('tr', { hasText: 'Ерланов Д.' }).getByRole('link').click()
    await expect(
      page.getByRole('heading', { name: 'Дворец Независимости', level: 1 }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Изменить' }).click()
    const form = page.getByRole('group', { name: 'Правка дежурства' })
    await expect(form.getByLabel('Пост')).toBeVisible()
    await form.getByLabel('Сотрудник').selectOption('Ахметов Б.')
    await form.getByRole('button', { name: 'Сохранить изменения' }).click()

    await expect(form.getByText(/2 дежурства в один день/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Подтвердить оверрайд' })).toHaveCount(0)
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
