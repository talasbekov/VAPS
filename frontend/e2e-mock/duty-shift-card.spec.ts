// Smart Josparlau E2E (§33, Этап 33): §21.32 «Карточка дежурства».
//
// Demo-сид даёт все нужные исходы без ручной подготовки:
//  • «Ерланов Д.» 2026-07-20 — привязан к версии 1 паспорта «Дворца», ACKNOWLEDGED;
//  • «Жумабаев Р.» 2026-07-22 — ДВА дежурства в один день ⇒ жёсткий конфликт;
//  • «Сейтказы М.» 2026-07-25 — дежурство накануне ⇒ конфликт отдыха.
//
// Даты — КОНСТАНТЫ фикстур (DemoClock стартует с 2026-07-20T08:00+05:00).
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Карточка дежурства (§21.32, mock-режим)', () => {
  test('вход со строки плана; шапка, пост из паспорта и недоступные блоки с причиной', async ({
    page,
  }) => {
    await page.goto('/duties')
    await expect(page.getByRole('heading', { name: 'План дежурств' })).toBeVisible()

    // Вход — ссылка с даты в строке плана («роут без входа — мёртвый продукт»).
    await page.locator('tr', { hasText: 'Ерланов Д.' }).getByRole('link').click()

    await expect(
      page.getByRole('heading', { name: 'Дворец Независимости', level: 1 }),
    ).toBeVisible()
    await expect(page.getByText('Суточное дежурство на охраняемом объекте · 24 ч')).toBeVisible()
    await expect(page.getByText('Сектор A · КПП-1')).toBeVisible()
    await expect(page.getByText(/ред\. 1 от /)).toBeVisible()
    await expect(page.getByText('Ознакомлен', { exact: true })).toBeVisible()

    // §35: блоки §21.32 без данных названы С ПРИЧИНОЙ, а не пропущены молча.
    await expect(page.getByText('Блоки, которых нет в модели дежурства')).toBeVisible()
    await expect(page.getByText(/своего журнала нет/)).toBeVisible()
    await expect(page.getByText(/Резерв заведён только у боевых групп/)).toBeVisible()

    // Возврат к плану работает — карточка не тупик.
    await page.getByRole('link', { name: '← К плану дежурств' }).click()
    await expect(page.getByRole('heading', { name: 'План дежурств' })).toBeVisible()
  })

  test('§21.34: жёсткий и мягкий конфликты приходят с серверной severity', async ({ page }) => {
    // Пересечение: у Жумабаева Р. два дежурства 2026-07-22.
    await page.goto('/duties')
    await page
      .locator('tr', { hasText: 'Жумабаев Р.' })
      .first()
      .getByRole('link')
      .click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText('Жёсткий')).toBeVisible()
    await expect(page.getByText(/2 дежурства в один день \(2026-07-22\)/)).toBeVisible()

    // Мягкий: у Нурланова Е. смены 2026-07-27 и 2026-07-28 на ОХРАНЯЕМОМ
    // объекте, чья политика отдыха — SOFT_OVERRIDE. Тот же класс конфликта
    // (нарушение отдыха), но другая severity — и берётся она из политики ВИДА
    // дежурства, а не выводится карточкой (§21.34/§21.35).
    await page.goto('/duties')
    await page.locator('tr', { hasText: 'Нурланов Е.' }).nth(1).getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(/до конца обязательного отдыха/)).toBeVisible()
    await expect(page.getByText('Мягкий')).toBeVisible()
    await expect(page.getByText('Жёсткий')).toHaveCount(0)

    // Жёсткий отдых на СОБСТВЕННОМ объекте (HARD_BLOCK) — тот же класс,
    // противоположная severity: у Сейтказы М. смены 2026-07-24 и 2026-07-25.
    await page.goto('/duties')
    await page.locator('tr', { hasText: 'Сейтказы М.' }).nth(1).getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText(/до конца обязательного отдыха/)).toBeVisible()
    await expect(page.getByText('Жёсткий')).toBeVisible()
  })

  test('карточка ведёт смену по состояниям и переживает reload', async ({ page }) => {
    // Сагинова А. 2026-07-20 — PLANNED, полный путь до завершения.
    await page.goto('/duties')
    await page.locator('tr', { hasText: 'Сагинова А.' }).getByRole('link').click()
    // Ждать ЗАГОЛОВОК карточки, а не статус: «Запланировано» есть и в плане,
    // поэтому ассерт на статус зазеленел бы на ещё не сменившейся странице.
    await expect(page.getByRole('heading', { name: 'Дом Министерств', level: 1 })).toBeVisible()
    await expect(page.getByText('Запланировано')).toBeVisible()

    await page.getByRole('button', { name: 'Ознакомиться' }).click()
    await expect(page.getByRole('button', { name: 'Заступить' })).toBeVisible()
    await page.getByRole('button', { name: 'Заступить' }).click()
    await expect(page.getByRole('button', { name: 'Завершить' })).toBeVisible()

    // Факт заступления появился — до этого он был словами, а не нулём.
    await expect(page.getByText('Ещё не заступал')).toHaveCount(0)
    await expect(page.getByText('Ещё не сдавал')).toBeVisible()

    await page.getByRole('button', { name: 'Завершить' }).click()
    await expect(page.getByText('Завершено')).toBeVisible()
    // Завершённая смена действий не предлагает вовсе.
    await expect(page.getByRole('button', { name: 'Завершить' })).toHaveCount(0)

    // Состояние в IndexedDB, а не в state страницы.
    await page.reload()
    await expect(page.getByText('Завершено')).toBeVisible()
    await expect(page.getByText('Ещё не сдавал')).toHaveCount(0)
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
