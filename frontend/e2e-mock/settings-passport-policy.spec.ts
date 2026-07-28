// Smart Josparlau E2E (§33, Этап 51): §29 «Настройки» — свежесть паспортов,
// §21.7 «срок актуальности приходит от policy».
//
// Проверяется то, что не видно ни одному unit-тесту: раздел настроек и реестр
// объектов — разные фичи, связанные только общим demo-снапшотом. Правка
// интервала в одном экране обязана изменить состояние строки в другом.
//
// Сид (fixtures.ts): «Резиденция „Ак Орда“» опубликована 110 суток назад при
// интервале 120 — то есть «скоро проверка». Сократив интервал до 100, тот же
// объект становится просроченным, а KPI пересчитывается сервером.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { seedCredential } from './testUtils'

const INTERVAL_ROW = 'Интервал проверки паспорта объекта'
const DUE_SOON_ROW = 'Порог «скоро проверка» — доля интервала'
const AK_ORDA = 'Резиденция «Ак Орда»'

async function setNumber(page: Page, rowLabel: string, value: string, reason: string) {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible()
  const row = page.locator('tr', { hasText: rowLabel })
  await row.getByRole('button', { name: 'Изменить' }).click()
  const dialog = page.getByRole('dialog')
  const input = dialog.getByLabel(/Значение/)
  await input.fill(value)
  await dialog.getByLabel(/Причина изменения/).fill(reason)
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden()
}

test.describe('Политика свежести паспортов §29/§21.7 (mock-режим)', () => {
  test('правка интервала МЕНЯЕТ состояние объекта и KPI в другом разделе', async ({ page }) => {
    await page.goto('/objects')
    const row = page.locator('tr', { hasText: AK_ORDA })
    await expect(row.getByText('Скоро проверка')).toBeVisible()
    // KPI считает СЕРВЕР по всему реестру (§21.7) — карточка-фильтр несёт число.
    const overdueKpi = page.getByRole('button', { name: /Проверка просрочена/ })
    await expect(overdueKpi).toContainText('1')

    await setNumber(page, INTERVAL_ROW, '100', 'Сокращение интервала по приказу')

    await page.goto('/objects')
    // 110 суток при интервале 100 — срок уже прошёл.
    await expect(page.locator('tr', { hasText: AK_ORDA }).getByText('Проверка просрочена')).toBeVisible()
    await expect(page.getByRole('button', { name: /Проверка просрочена/ })).toContainText('2')
    // Экран называет ДЕЙСТВУЮЩУЮ политику, а не ту, с которой стартовал сид.
    await expect(page.getByText(/по политике passport-freshness-2026\.07\.2: 100 дней/)).toBeVisible()
  })

  test('порог «скоро» задан ДОЛЕЙ: правка окна не трогает сам срок', async ({ page }) => {
    await page.goto('/objects')
    await expect(page.locator('tr', { hasText: 'Дворец Независимости' }).getByText('Срок соблюдён')).toBeVisible()

    // 110 суток прошло из 120: остаток — 8% интервала. Порог 5% оставляет
    // «Ак Орду» вне предупреждения, порог 20% (сеяный) возвращает его.
    await setNumber(page, DUE_SOON_ROW, '5', 'Сужение окна предупреждения')

    await page.goto('/objects')
    await expect(page.locator('tr', { hasText: AK_ORDA }).getByText('Срок соблюдён')).toBeVisible()
    // Сам срок проверки при этом не сдвинулся — менялось только окно.
    await expect(page.getByText(/по политике passport-freshness-2026\.07\.2: 120 дней/)).toBeVisible()
  })

  test('раздел закрыт тому, у кого нет своего права, и открыт владельцу объектов', async ({
    page,
  }) => {
    // demo-admin (wildcard) правит всё.
    await page.goto('/settings')
    await expect(
      page.locator('tr', { hasText: INTERVAL_ROW }).getByRole('button', { name: 'Изменить' }),
    ).toBeVisible()

    // Аналитик: политика наблюдений своя, политика паспортов — чужая.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-analyst' }),
      )
    })
    await page.goto('/settings')
    const passportRow = page.locator('tr', { hasText: INTERVAL_ROW })
    await expect(passportRow.getByRole('button', { name: 'Изменить' })).toHaveCount(0)
    await expect(passportRow).toContainText('политики паспортов не выдано')
    // При этом СВОЙ раздел ему открыт — отказ вызван разделением прав, а не
    // отсутствием доступа к экрану.
    await expect(
      page
        .locator('tr', { hasText: 'Срок упреждения по отметке об ознакомлении' })
        .getByRole('button', { name: 'Изменить' }),
    ).toBeVisible()
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
