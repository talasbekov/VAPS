// Smart Josparlau E2E (§33, NEXT ACTION Этап 10): стадия «Расстановка»
// (назначение/снятие сотрудников на посты) не была покрыта E2E — существующие
// спеки идут BULLETIN→BULLETIN и APPROVAL→CLOSED, минуя PLACEMENT целиком.
// Использует фикстуру «Международный экономический форум» (стадия PLACEMENT
// в demo-seed, см. security-events/mocks/fixtures.ts): пост «Главный вход»
// уже укомплектован (Ахметов Б.), «Пресс-зона» — свободен и несёт требование
// к рейтингу «не ниже 8,0» (§19.24).
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

/** Смена persona — ВТОРЫМ addInitScript (evaluate+reload сбрасывается сидом). */
async function usePersona(page: Page, userId: string): Promise<void> {
  await page.addInitScript((id) => {
    sessionStorage.setItem('vaps.credential', JSON.stringify({ kind: 'dev', userId: id }))
  }, userId)
}

/** Правая панель выбранного поста — назначенные и форма назначения. */
function postPanel(page: Page) {
  return page.getByRole('region', { name: 'Назначения поста' })
}

async function openPlacementEvent(page: Page): Promise<void> {
  await page.goto('/security-events')
  await page.getByRole('link', { name: /Международный экономический форум/ }).click()
  await expect(
    page.getByRole('heading', { name: 'Международный экономический форум' }),
  ).toBeVisible()
}

test.describe('ОМ: стадия «Расстановка» — назначение/снятие, hard-rule двойного назначения (mock-режим)', () => {
  test('назначить свободный пост, hard-rule блокирует занятого сотрудника, снять назначение', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await openPlacementEvent(page)

    await page.getByRole('button', { name: /A · Главный вход/ }).click()
    // Ахметов назначен и виден в списке назначенных поста. Локатор сужен до
    // панели поста: то же имя стоит и в сводке «Рейтинг назначенных» §19.24.
    await expect(postPanel(page).getByText('Ахметов Б.', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /B · Пресс-зона/ }).click()
    await expect(page.getByText('Никто не назначен')).toBeVisible()

    const select = page.getByRole('combobox')
    // Ахметов Б. (emp-1) уже назначен на «Главный вход» — hard-rule двойного
    // назначения должен отключить его в списке даже на другом посту.
    await expect(select.locator('option', { hasText: 'Ахметов Б.' })).toBeDisabled()

    // Ерланов Д. (employee-1): последний закрытый период 8,6 — требование
    // «не ниже 8,0» выполнено, назначение проходит БЕЗ диалога конфликта.
    await select.selectOption({ value: 'employee-1' })
    await page.getByRole('button', { name: 'Назначить' }).click()

    await expect(postPanel(page).getByText('Ерланов Д.', { exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).not.toBeVisible()

    await postPanel(page).getByRole('button', { name: 'Снять' }).click()
    await expect(page.getByText('Никто не назначен')).toBeVisible()
  })
})

test.describe('ОМ: рейтинг при расстановке §19.24 (mock-режим)', () => {
  test('рейтинг ниже требования поста — мягкий конфликт, обход с причиной, след в сводке', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await openPlacementEvent(page)

    await page.getByRole('button', { name: /B · Пресс-зона/ }).click()
    // Абишев Н. (employee-2): последний закрытый период 7,9 < 8,0.
    await page.getByRole('combobox').selectOption({ value: 'employee-2' })
    await page.getByRole('button', { name: 'Назначить' }).click()

    // §19.24: НЕ отказ — мягкий конфликт через общий ConflictDialog.
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading')).toContainText(
      'Рейтинг сотрудника ниже требования поста (8,0)',
    )
    // Отмена не назначает.
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(page.getByText('Никто не назначен')).toBeVisible()

    // Повтор: теперь с обоснованием через диалог.
    await page.getByRole('combobox').selectOption({ value: 'employee-2' })
    await page.getByRole('button', { name: 'Назначить' }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Причина (10–500 символов)').fill('Замены нет, решение старшего')
    await dialog.getByRole('button', { name: 'Подтвердить оверрайд' }).click()

    await expect(postPanel(page).getByText('Абишев Н.', { exact: true })).toBeVisible()

    // Сводка §19.24: соответствие, значение агрегата (у admin право есть),
    // версия методики и след обхода.
    const summary = page.getByRole('region', { name: 'Рейтинг назначенных' })
    const row = summary.getByRole('row').filter({ hasText: 'Абишев Н.' })
    await expect(row).toContainText('Ниже требования')
    await expect(row).toContainText('не ниже 8,0')
    await expect(row).toContainText('7,9')
    await expect(row).toContainText('методика OPERATIONAL-RATING-')
    await expect(row).toContainText('Обход подтверждён: Замены нет, решение старшего')
  })

  test('без данных рейтинга — отдельное предупреждение об отсутствии данных, не молчаливый допуск', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await openPlacementEvent(page)

    await page.getByRole('button', { name: /B · Пресс-зона/ }).click()
    // Бекова А. (emp-2 в ростере): в оцениваемый набор не входит — записанных
    // агрегатов у неё нет вовсе.
    await page.getByRole('combobox').selectOption({ value: 'emp-2' })
    await page.getByRole('button', { name: 'Назначить' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading')).toContainText(
      'Данных рейтинга для проверки требования поста нет',
    )
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(page.getByText('Никто не назначен')).toBeVisible()
  })

  test('без права на агрегат сводка закрыта СЕРВЕРОМ: соответствие видно, значения — нет', async ({
    page,
  }) => {
    await seedCredential(page)
    await usePersona(page, 'demo-event-planner') // placement.manage есть, view_aggregate НЕТ
    await hideDemoToolbar(page)

    // Закрытость проверяется по ТЕЛАМ ответов, а не только по DOM (§19.21).
    const responseBodies: string[] = []
    page.on('response', (response) => {
      if (response.url().includes('/placement/ratings/')) {
        void response.text().then((body) => responseBodies.push(body))
      }
    })

    await openPlacementEvent(page)

    // Назначенный на «Главный вход» Ахметов есть — сводка отрисована.
    const summary = page.getByRole('region', { name: 'Рейтинг назначенных' })
    await expect(summary).toBeVisible()
    await expect(summary.getByText('Сводка закрыта политикой доступа').first()).toBeVisible()

    // Значения не пришли НИ ОДНИМ полем ответа: и агрегат, и состояние данных
    // (без права «оценок недостаточно» — тоже сведение о рейтинге человека).
    expect(responseBodies.length).toBeGreaterThan(0)
    for (const body of responseBodies) {
      expect(body).toContain('"aggregateVisible":false')
      expect(body).not.toContain('"dataState":"')
      expect(body).not.toContain('OPERATIONAL-RATING-')
    }
  })
})
