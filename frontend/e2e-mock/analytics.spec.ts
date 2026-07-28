// Smart Josparlau E2E (§33): «Аналитика службы» (§22.3-22.7, §22.12).
//
// ⚠️ Спека переписана в Этапе 43. Прежняя редакция проверяла распределения,
// которые экран считал В БРАУЗЕРЕ из постраничных списков трёх фич и честно
// подписывал «по видимым записям». Подпись была правдой, но §22.3 запрещает сам
// приём — расчёт переехал на сервер, и проверять теперь надо другое:
//
//   1) показатели приходят готовыми, с состоянием и версией расчёта;
//   2) строки НЕ приезжают вместе с показателями и запрашиваются отдельно
//      (§22.12), со `snapshotId` в запросе;
//   3) персональная детализация вырезана СЕРВЕРОМ у persona без права;
//   4) период живёт в URL и переживает перезагрузку.
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

test.describe('Аналитика службы (§22.3-22.12, mock-режим)', () => {
  test('снимок приходит с сервера: период, актуальность, версия расчёта и состояния', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/analytics')

    await expect(page.getByRole('heading', { name: 'Аналитика службы' })).toBeVisible()
    const header = page.getByRole('group', { name: 'Шапка аналитики' })
    // §22.4: шапка обязана называть период, бизнес-дату, scope и актуальность.
    await expect(header.getByText('Business date')).toBeVisible()
    await expect(header.getByText('Данные актуальны')).toBeVisible()
    await expect(header.getByText('Данные полные')).toBeVisible()
    await expect(header.getByText('service-analytics-')).toBeVisible()

    // Показатели §22.7, под которыми есть реальные данные.
    await expect(page.getByText('Запланировано смен')).toBeVisible()
    await expect(page.getByText('Жёсткие конфликты')).toBeVisible()
    // §35: то, чего в срезе нет, названо с причиной, а не показано нулём.
    await expect(page.getByText('Перегрузка по серверной политике')).toBeVisible()
  })

  test('§22.12: строки запрашиваются отдельно и по snapshotId', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)

    const snapshotBodies: string[] = []
    const drilldownUrls: string[] = []
    page.on('response', async (response) => {
      const url = response.url()
      if (url.includes('/api/ops/service-analytics-drilldown/')) drilldownUrls.push(url)
      else if (url.includes('/api/ops/service-analytics/')) {
        snapshotBodies.push(await response.text().catch(() => ''))
      }
    })

    await page.goto('/analytics')
    // Период с запасом: показателю нужны строки, а смены сида лежат вокруг
    // бизнес-даты (см. features/duties/mocks/fixtures.ts).
    await page.getByRole('button', { name: 'Текущий месяц' }).click()
    await expect(page.getByText('Запланировано смен')).toBeVisible()

    // Ответ KPI не несёт ни одной строки выборки — это и есть требование
    // §22.12 «не передавай весь набор скрытых строк вместе с KPI-ответом».
    expect(snapshotBodies.length).toBeGreaterThan(0)
    for (const body of snapshotBodies) {
      expect(body).not.toContain('Жумабаев')
      expect(body).not.toContain('rowId')
    }
    expect(drilldownUrls).toHaveLength(0)

    await page
      .getByRole('group', { name: 'Запланировано смен' })
      .getByRole('button', { name: 'Показать строки' })
      .click()

    await expect(page.getByRole('region', { name: 'Строки показателя' })).toBeVisible()
    expect(drilldownUrls.length).toBeGreaterThan(0)
    // Запрос выборки несёт идентификатор снимка: строки обязаны принадлежать
    // тому же мгновению, что и число над ними.
    const requested = new URL(drilldownUrls[0])
    expect(requested.searchParams.get('snapshot_id')).toMatch(/^snap-/)
    expect(requested.searchParams.get('metric_code')).toBe('DUTY_PLANNED')
  })

  test('без права на персональную детализацию сотрудник вырезан сервером', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)

    // Смена persona — вторым init-скриптом: `seedCredential` тоже init-скрипт и
    // переустанавливал бы demo-admin на каждой навигации.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-analyst' }),
      )
    })

    const bodies: string[] = []
    page.on('response', async (response) => {
      if (response.url().includes('/api/ops/service-analytics-drilldown/')) {
        bodies.push(await response.text().catch(() => ''))
      }
    })

    await page.goto('/analytics?period=CURRENT_MONTH')
    await expect(page.getByText('Запланировано смен')).toBeVisible()
    await page
      .getByRole('group', { name: 'Запланировано смен' })
      .getByRole('button', { name: 'Показать строки' })
      .click()

    const rows = page.getByRole('region', { name: 'Строки показателя' }).locator('tbody tr')
    await expect(rows.first()).toBeVisible()
    // Объект и состояние на месте — вырезан сотрудник, а не строка целиком.
    await expect(rows.first()).toContainText('скрыт')
    await expect(page.getByText(/нет права на персональную детализацию/)).toBeVisible()

    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) {
      expect(body).not.toContain('Жумабаев')
      expect(body).not.toContain('Сейтказы')
    }
  })

  test('период живёт в URL и переживает перезагрузку', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/analytics')

    await page.getByRole('button', { name: 'Текущая неделя' }).click()
    await expect(page).toHaveURL(/period=CURRENT_WEEK/)
    await expect(page.getByText('Фильтры активны')).toBeVisible()

    await page.reload()
    await expect(page).toHaveURL(/period=CURRENT_WEEK/)
    await expect(page.getByText('Фильтры активны')).toBeVisible()

    await page.getByRole('button', { name: 'Сбросить' }).click()
    await expect(page).not.toHaveURL(/period=/)
    // §22.6: после сброса действует пресет ПО УМОЛЧАНИЮ с сервера.
    await expect(page.getByText('Фильтры активны')).toBeHidden()
    await expect(page.getByText('Запланировано смен')).toBeVisible()
  })
})
