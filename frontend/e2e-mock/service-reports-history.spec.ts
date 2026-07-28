// Smart Josparlau E2E (§33, Этап 41): история отчётов — повтор с теми же
// параметрами и новая редакция (§22.25), фильтры в URL, видимость только
// разрешённых работ (§22.25/§20.32).
//
// Что проверяется живым прогоном:
//   1) повтор при готовом артефакте НЕ создаёт вторую работу, а новая редакция
//      создаёт и получает номер 2;
//   2) фильтр состояния живёт в URL и переживает перезагрузку;
//   3) работа со скрытыми полями невидима persona без права на sensitive
//      export — её нет ни на экране, ни в ответе сервера.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

const PERIOD_FROM = '2026-07-01'
const PERIOD_TO = '2026-07-31'

async function runReport(page: Page, sensitive: boolean) {
  await page.goto('/service-reports')
  await expect(page.getByRole('heading', { name: 'Отчёты службы' })).toBeVisible()
  const form = page.getByRole('group', { name: 'Форма запуска отчёта' })
  await form.getByLabel('Начало периода').fill(PERIOD_FROM)
  await form.getByLabel('Конец периода').fill(PERIOD_TO)
  if (sensitive) await form.getByLabel(/Включить скрытые поля/).check()
  await form.getByRole('button', { name: 'Сформировать отчёт' }).click()
  // §22.21: ждём именно готовности — до неё истории нечего показывать.
  await expect(page.getByText('Готов', { exact: true })).toBeVisible({ timeout: 10_000 })
}

async function openHistory(page: Page) {
  await page.getByRole('link', { name: 'История отчётов →' }).click()
  await expect(page.getByRole('heading', { name: 'История отчётов' })).toBeVisible()
  // Строки таблицы без шапки: подписи состояний повторяются в фильтре, и
  // поиск по всему экрану ловил бы вариант списка (класс дублей подписей).
  return page.getByRole('region', { name: 'История отчётов' }).locator('tbody tr')
}

test.describe('История отчётов (§22.25, mock-режим)', () => {
  test('повтор отдаёт готовый артефакт, новая редакция собирает вторую', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await runReport(page, false)

    const rows = await openHistory(page)
    await expect(rows).toHaveCount(1)

    // §22.25: повтор при пригодном артефакте новой работы НЕ создаёт.
    await rows.first().getByRole('button', { name: 'Повторить' }).click()
    await expect(page.getByText(/новая работа не запускалась/)).toBeVisible()
    await expect(rows).toHaveCount(1)

    // …а новая редакция — создаёт, и она получает следующий номер.
    await rows.first().getByRole('button', { name: 'Новая редакция' }).click()
    await expect(rows).toHaveCount(2)
    await expect(page.getByText('Запущена новая работа с теми же параметрами.')).toBeVisible()
    await expect(rows.first().getByText('2', { exact: true })).toBeVisible({ timeout: 10_000 })

    // Параметры новой работы — те же самые, и это видно из самой строки.
    await rows.first().getByRole('button', { name: 'Открыть параметры' }).click()
    await expect(rows.first().getByText(/границы включительно/)).toBeVisible()
  })

  test('фильтр состояния живёт в URL и переживает перезагрузку', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await runReport(page, false)
    const rows = await openHistory(page)

    await page.getByLabel('Состояние работы').selectOption('FAILED')
    await expect(page).toHaveURL(/state=FAILED/)
    await expect(page.getByText('По выбранным фильтрам работ нет.')).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Состояние работы')).toHaveValue('FAILED')
    await expect(page.getByText('По выбранным фильтрам работ нет.')).toBeVisible()

    await page.getByLabel('Состояние работы').selectOption('COMPLETED')
    await expect(rows).toHaveCount(1)
  })

  test('работа со скрытыми полями невидима persona без права — и на экране, и в ответе', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await runReport(page, true)
    const rows = await openHistory(page)
    await expect(rows).toHaveCount(1)
    await expect(rows.first().getByText('Со скрытыми полями')).toBeVisible()

    // §22.25 «Показывай только разрешённые пользователю jobs и artifacts»:
    // аналитик вправе запускать отчёты, но не выгружать скрытые поля — чужая
    // sensitive-выгрузка не должна ему даже показаться существующей.
    const bodies: string[] = []
    page.on('response', async (response) => {
      if (
        response.url().includes('/api/ops/service-report-jobs/') &&
        response.request().method() === 'GET'
      ) {
        bodies.push(await response.text().catch(() => ''))
      }
    })
    // Именно addInitScript, а не evaluate + reload: `seedCredential` тоже
    // init-скрипт, и он переустанавливал бы demo-admin на каждой навигации,
    // молча возвращая права. Более поздний init-скрипт исполняется последним.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-analyst' }),
      )
    })
    await page.reload()

    await expect(page.getByText('Отчёты ещё не запускались.')).toBeVisible()
    // Не только скрыта в вёрстке — её нет в ответе сервера (§22.24).
    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) {
      expect(body).not.toContain('"sensitive":true')
      expect(body).not.toContain(PERIOD_FROM)
    }
  })
})
