// Smart Josparlau E2E (§33, Этап 53): §22.5 «Не хардкодь ... срок хранения
// отчёта» — пределы периодов и хранения принадлежат «Настройкам» (§29).
//
// Проверяется то, чего не видит ни один unit-тест: раздел настроек, аналитика
// службы и отчётный реестр — ТРИ разные фичи, связанные только общим
// demo-снапшотом. Правка числа в одном экране обязана изменить ИСХОД операции
// в двух других, а не окраску их вёрстки.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { seedCredential } from './testUtils'

const ANALYTICS_LIMIT_ROW = 'Предел произвольного периода аналитики'
const REPORT_PERIOD_ROW = 'Предел периода отчёта «Расход личного состава»'
const RETENTION_ROW = 'Срок хранения сформированного файла'

async function setNumber(page: Page, rowLabel: string, value: string, reason: string) {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible()
  const row = page.locator('tr', { hasText: rowLabel })
  await row.getByRole('button', { name: 'Изменить' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Значение/).fill(value)
  await dialog.getByLabel(/Причина изменения/).fill(reason)
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden()
}

test.describe('Пределы периодов и хранения §29/§22.5 (mock-режим)', () => {
  test('правка предела МЕНЯЕТ исход запроса аналитики, а не только подпись', async ({ page }) => {
    await page.goto('/analytics')
    // Экран печатает ДЕЙСТВУЮЩЕЕ число политики, а не своё представление о нём.
    await expect(page.getByText(/Предел произвольного периода — 62 дней/)).toBeVisible()

    // Период в 20 дней при пределе 62 принимается.
    await page.getByLabel('Начало периода').fill('2026-07-01')
    await page.getByLabel('Конец периода').fill('2026-07-20')
    await page.getByRole('button', { name: 'Произвольный период' }).click()
    await expect(page.getByText('2026-07-01 — 2026-07-20')).toBeVisible()

    await setNumber(page, ANALYTICS_LIMIT_ROW, '9', 'Сокращение глубины произвольного периода')

    await page.goto('/analytics')
    await expect(page.getByText(/Предел произвольного периода — 9 дней/)).toBeVisible()
    await page.getByLabel('Начало периода').fill('2026-07-01')
    await page.getByLabel('Конец периода').fill('2026-07-20')
    await page.getByRole('button', { name: 'Произвольный период' }).click()
    // Тот же самый период теперь отвергнут СЕРВЕРОМ — и он называет новое число.
    // Таймаут увеличен осознанно: снимок читается QUERY, а у query по умолчанию
    // три ретрая с backoff — отказ доезжает до экрана позже стандартных 5 с.
    // Причина печатается ДВАЖДЫ (снимок и блок «Требует внимания» — оба читают
    // один период), поэтому локатор сужен: дубль подписи, уже знакомый класс.
    await expect(page.getByText(/не может превышать 9 дней/).first()).toBeVisible({
      timeout: 20_000,
    })
  })

  test('правка предела отчёта меняет исход запуска выгрузки', async ({ page }) => {
    await page.goto('/service-reports')
    await expect(page.getByText(/Период — не длиннее 92 дней/)).toBeVisible()

    await setNumber(page, REPORT_PERIOD_ROW, '10', 'Сокращение глубины отчёта по приказу')

    await page.goto('/service-reports')
    await expect(page.getByText(/Период — не длиннее 10 дней/)).toBeVisible()
    await page.getByLabel('Начало периода').fill('2026-07-01')
    await page.getByLabel('Конец периода').fill('2026-07-31')
    await page.getByRole('button', { name: 'Сформировать отчёт' }).click()
    await expect(page.getByText(/не может превышать 10 дней/)).toBeVisible()
  })

  test('срок хранения замораживается в момент сборки файла', async ({ page }) => {
    await page.goto('/service-reports')
    await page.getByLabel('Начало периода').fill('2026-07-01')
    await page.getByLabel('Конец периода').fill('2026-07-10')
    await page.getByRole('button', { name: 'Сформировать отчёт' }).click()
    // Работа доходит до готового артефакта (сервер продвигает её на чтении).
    await expect(page.getByText('Готов', { exact: true }).first()).toBeVisible()
    const expiry = await page.getByText(/Доступен до/).first().textContent()
    expect(expiry).not.toBeNull()

    await setNumber(page, RETENTION_ROW, '3', 'Сокращение срока хранения выгрузок')

    await page.goto('/service-reports')
    // Уже выданный файл срок не потерял: сокращение политики не отнимает
    // задним числом то, что человек уже получил.
    await expect(page.getByText(/Доступен до/).first()).toHaveText(expiry ?? '')
  })

  test('аналитик видит пределы, но не правит их — они ограничивают его самого', async ({
    page,
  }) => {
    await page.goto('/settings')
    await expect(
      page.locator('tr', { hasText: ANALYTICS_LIMIT_ROW }).getByRole('button', { name: 'Изменить' }),
    ).toBeVisible()

    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-analyst' }),
      )
    })
    await page.goto('/settings')
    const analyticsRow = page.locator('tr', { hasText: ANALYTICS_LIMIT_ROW })
    await expect(analyticsRow.getByRole('button', { name: 'Изменить' })).toHaveCount(0)
    await expect(analyticsRow).toContainText('пределов аналитики не выдано')
    await expect(page.locator('tr', { hasText: RETENTION_ROW })).toContainText(
      'пределов отчётности не выдано',
    )
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
