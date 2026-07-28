// Smart Josparlau E2E (§33, Этап 40): отчётный реестр — асинхронная генерация
// (§22.21), метаданные артефакта (§22.22), скачивание (§22.23), server-side
// masking (§22.24), sensitive export как отдельная операция (§20.32).
//
// Что проверяется живым прогоном:
//   1) работа проходит очередь → формирование → готов, и до готовности
//      скачивать нечего;
//   2) в сетевых ответах реестра НЕТ ни содержимого файла, ни ссылки на него;
//   3) выгруженный файл не содержит замаскированных полей, а sensitive —
//      содержит;
//   4) persona без права sensitive export не может его включить.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { seedCredential } from './testUtils'

/**
 * ⚠️ Примечание НЕ берётся из сида: там у всех смен `note: null`, и проверка
 * «в выгрузке нет примечания» была бы ВАКУУМНОЙ — нечему быть. Поэтому смена с
 * примечанием заводится этой же спекой через UI, и только потом формируется
 * отчёт: маскирование доказывается на поле, которое в источнике ЕСТЬ.
 */
const MASKED_NOTE = 'Усиление на период визита'
const PERIOD_FROM = '2026-07-01'
const PERIOD_TO = '2026-07-31'

/** Заводит смену с примечанием (шаги те же, что в duty-shift-create.spec.ts). */
async function createShiftWithNote(page: Page) {
  await page.goto('/duties')
  await expect(page.getByRole('heading', { name: 'План дежурств' })).toBeVisible()
  await page.getByRole('button', { name: 'Создать дежурство' }).click()
  const form = page.getByRole('group', { name: 'Форма нового дежурства' })
  await form.getByLabel('Объект').selectOption({ label: 'Дворец Независимости (OBJ-001)' })
  await form.getByLabel('Пост').selectOption({ label: 'Сектор A · КПП-1' })
  await form.getByLabel('Сотрудник').selectOption('Абишев Н.')
  await form.getByLabel(/Примечание/).fill(MASKED_NOTE)
  await form.getByRole('button', { name: 'Создать дежурство' }).click()
  await expect(page.locator('tr', { hasText: 'Абишев Н.' }).getByText(MASKED_NOTE)).toBeVisible()
}

async function openReports(page: Page) {
  await page.goto('/service-reports')
  await expect(page.getByRole('heading', { name: 'Отчёты службы' })).toBeVisible()
  return page.getByRole('group', { name: 'Форма запуска отчёта' })
}

async function runReport(page: Page, sensitive: boolean) {
  const form = await openReports(page)
  await form.getByLabel('Начало периода').fill(PERIOD_FROM)
  await form.getByLabel('Конец периода').fill(PERIOD_TO)
  if (sensitive) await form.getByLabel(/Включить скрытые поля/).check()
  await form.getByRole('button', { name: 'Сформировать отчёт' }).click()
}

test.describe('Отчётный реестр службы (§22.21-22.24, mock-режим)', () => {
  test('работа доходит до готовности, реестр не несёт ни файла, ни ссылки на него', async ({
    page,
  }) => {
    await seedCredential(page)

    const registryBodies: string[] = []
    page.on('response', async (response) => {
      if (
        response.url().includes('/api/ops/service-report-jobs/') &&
        response.request().method() === 'GET'
      ) {
        registryBodies.push(await response.text().catch(() => ''))
      }
    })

    await createShiftWithNote(page)
    await runReport(page, false)

    // §22.21: успех — только после COMPLETED и получения artifactId.
    await expect(page.getByText('Готов')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Скачать CSV' })).toBeEnabled()
    // §22.22: метаданные пришли с сервера, включая версию маскирования.
    await expect(page.getByText(/маскирование masking-/)).toBeVisible()

    // §22.23/§22.24: безопасная проекция — ни содержимого, ни ссылки.
    expect(registryBodies.length).toBeGreaterThan(0)
    for (const body of registryBodies) {
      expect(body).not.toContain(MASKED_NOTE)
      expect(body).not.toContain('"content"')
    }
    // И в разметке страницы отчётов его тоже нет.
    expect(await page.content()).not.toContain(MASKED_NOTE)
  })

  test('обычная выгрузка не содержит замаскированных полей, sensitive — содержит', async ({
    page,
  }) => {
    await seedCredential(page)
    await createShiftWithNote(page)
    await runReport(page, false)
    await expect(page.getByText('Готов')).toBeVisible({ timeout: 10_000 })

    // Содержимое читается из ОТВЕТА операции скачивания — постоянной ссылки на
    // файл в проекте не существует, поэтому и перехватывать нечего, кроме неё.
    const plainResponse = page.waitForResponse((response) =>
      response.url().includes('/download/'),
    )
    await page.getByRole('button', { name: 'Скачать CSV' }).first().click()
    const plain = (await (await plainResponse).json()) as { content: string }
    expect(plain.content).toContain('Расход личного состава за период')
    // Смена в выгрузке ЕСТЬ, а её примечание — нет: маскирование, а не пустой
    // отчёт (проверка не вакуумна).
    expect(plain.content).toContain('Абишев Н.')
    expect(plain.content).not.toContain(MASKED_NOTE)
    expect(plain.content).not.toContain('Примечание')

    // Та же выгрузка со скрытыми полями — отдельная операция (§20.32).
    const form = page.getByRole('group', { name: 'Форма запуска отчёта' })
    await form.getByLabel(/Включить скрытые поля/).check()
    await form.getByRole('button', { name: 'Сформировать отчёт' }).click()
    await expect(page.getByText('Со скрытыми полями')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Скачать CSV' })).toHaveCount(2, {
      timeout: 10_000,
    })

    const sensitiveResponse = page.waitForResponse((response) =>
      response.url().includes('/download/'),
    )
    await page.getByRole('button', { name: 'Скачать CSV' }).first().click()
    const sensitive = (await (await sensitiveResponse).json()) as { content: string }
    expect(sensitive.content).toContain('Примечание')
    expect(sensitive.content).toContain(MASKED_NOTE)
  })

  test('без права sensitive export флажок недоступен, причина названа', async ({ page }) => {
    // §20.32/§22.26: аналитик вправе запускать отчёты, но не выгружать скрытые
    // поля — на этом разделении и держится «sensitive export — отдельная
    // операция».
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-analyst' }),
      )
    })
    const form = await openReports(page)

    await expect(form.getByLabel(/Включить скрытые поля/)).toBeDisabled()
    await expect(form.getByText(/ops\.report\.export_sensitive/)).toBeVisible()
    // §22.23: форматов, которых проект не формирует, на экране нет как кнопок —
    // они названы причиной.
    await expect(page.getByRole('button', { name: 'Скачать XLSX' })).toHaveCount(0)
    await expect(page.getByText('XLSX', { exact: true })).toBeVisible()
  })
})
