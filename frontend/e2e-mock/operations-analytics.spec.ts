// Smart Josparlau E2E (§33): «Аналитика мероприятий» (§22.13, §22.15).
//
// Проверяется не наличие таблицы, а три структурных свойства:
//   1) спуск по иерархии идёт по СТАБИЛЬНЫМ ID и накапливает breadcrumb;
//   2) уровень живёт в URL и переживает перезагрузку (§22.6/§22.27);
//   3) §22.14 воронка не нарисована, а названа с причиной — модель не даёт
//      transition events, и собирать конверсию из текущих стадий запрещено.
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

test.describe('Аналитика мероприятий (§22.13-22.15, mock-режим)', () => {
  test('иерархия §22.15: спуск по уровням и breadcrumb на каждом', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)

    const levelUrls: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/ops/operations-analytics/')) levelUrls.push(request.url())
    })

    await page.goto('/analytics/operations')
    await expect(page.getByRole('heading', { name: 'Аналитика мероприятий' })).toBeVisible()

    const trail = page.getByRole('navigation', { name: 'Путь детализации' })
    await expect(trail.getByRole('button', { name: 'Все ОМ' })).toBeVisible()

    // Уровень объекта: сид кладёт два ОМ на «Дворец Независимости».
    const objectRow = page.locator('tr', { hasText: 'Дворец Независимости' }).first()
    await objectRow.getByRole('button', { name: 'Детализировать' }).click()
    await expect(trail.getByRole('button', { name: 'Дворец Независимости' })).toBeVisible()

    // Уровень мероприятия: появляется карточка §22.15.
    await page.locator('tbody tr').first().getByRole('button', { name: 'Детализировать' }).click()
    await expect(page.getByRole('group', { name: 'Карточка мероприятия' })).toBeVisible()
    await expect(trail.getByRole('button').nth(2)).toBeVisible()

    // Ни один запрос уровня не адресуется подписью — только идентификаторами
    // (§22.15 «связывай по стабильным ID, а не по названию»).
    expect(levelUrls.length).toBeGreaterThan(2)
    for (const url of levelUrls) {
      expect(decodeURIComponent(url)).not.toContain('Дворец')
    }
  })

  test('уровень живёт в URL и переживает перезагрузку', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/analytics/operations')

    await page
      .locator('tr', { hasText: 'Дворец Независимости' })
      .first()
      .getByRole('button', { name: 'Детализировать' })
      .click()
    await expect(page).toHaveURL(/object=/)

    await page.reload()
    const trail = page.getByRole('navigation', { name: 'Путь детализации' })
    await expect(trail.getByRole('button', { name: 'Дворец Независимости' })).toBeVisible()
  })

  test('§22.14 воронка не нарисована, а названа с причиной', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/analytics/operations')

    await expect(page.getByText('Воронка ОМ (§22.14)')).toBeVisible()
    await expect(page.getByText(/transition events/)).toBeVisible()
    // Ни конверсии, ни среднего времени этапа как ПОКАЗАТЕЛЯ на экране нет:
    // собранные из текущих стадий, они были бы посчитаны по запрещённому
    // источнику. Ассерт структурный, по заголовкам колонок: `getByText`
    // ловил бы эти слова в самом тексте причины (§35 объясняет отсутствие
    // воронки именно ими) и был бы неоднозначен.
    await expect(
      page.getByRole('columnheader', { name: /Конверсия|Среднее время|Достигли этапа|Возвраты/ }),
    ).toHaveCount(0)
  })

  test('§22.26/§22.27: без своего права раздел закрыт, данные ОМ не в DOM', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    // Начальник боевого управления: аналитики у него нет ни службы, ни ОМ.
    // Именно вторым addInitScript — seedCredential переустанавливает
    // demo-admin на каждой навигации (урок Этапа 41).
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-combat-department-chief' }),
      )
    })
    await page.goto('/analytics/operations')

    await expect(page.getByRole('heading', { name: 'Аналитика мероприятий' })).toHaveCount(0)
    await expect(page.getByText('Дворец Независимости')).toHaveCount(0)
  })
})
