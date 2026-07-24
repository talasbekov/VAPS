// Smart Josparlau E2E (§33, NEXT ACTION Этап 10): стадия «Расстановка»
// (назначение/снятие сотрудников на посты) не была покрыта E2E — существующие
// спеки идут BULLETIN→BULLETIN и APPROVAL→CLOSED, минуя PLACEMENT целиком.
// Использует фикстуру «Международный экономический форум» (стадия PLACEMENT
// в demo-seed, см. security-events/mocks/fixtures.ts): пост «Главный вход»
// уже укомплектован (Ахметов Б.), «Пресс-зона» — свободен.
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

test.describe('ОМ: стадия «Расстановка» — назначение/снятие, hard-rule двойного назначения (mock-режим)', () => {
  test('назначить свободный пост, hard-rule блокирует занятого сотрудника, снять назначение', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/security-events')

    await page.getByRole('link', { name: /Международный экономический форум/ }).click()
    await expect(
      page.getByRole('heading', { name: 'Международный экономический форум' }),
    ).toBeVisible()

    await page.getByRole('button', { name: /A · Главный вход/ }).click()
    await expect(page.getByText('Ахметов Б.', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /B · Пресс-зона/ }).click()
    await expect(page.getByText('Никто не назначен')).toBeVisible()

    const select = page.getByRole('combobox')
    // Ахметов Б. (emp-1) уже назначен на «Главный вход» — hard-rule двойного
    // назначения должен отключить его в списке даже на другом посту.
    await expect(select.locator('option', { hasText: 'Ахметов Б.' })).toBeDisabled()

    await select.selectOption({ value: 'emp-2' })
    await page.getByRole('button', { name: 'Назначить' }).click()

    await expect(page.getByText('Бекова А.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Снять' })).toBeVisible()

    await page.getByRole('button', { name: 'Снять' }).click()
    await expect(page.getByText('Никто не назначен')).toBeVisible()
  })
})
