// Smart Josparlau E2E (§33, Этап 63): §19.29 выгрузка рейтинга — состояния
// приходят с сервера, файл выдаётся отдельной операцией, а закрытых величин в
// нём нет ни одной.
import { expect, test } from '@playwright/test'

test.describe('Выгрузка рейтинга §19.29 (mock-режим)', () => {
  test('заказ проходит очередь до готовности, файл выдаёт сервер и он без закрытых величин', async ({
    page,
  }) => {
    // Все тела ответов раздела — по ним и проверяется, что закрытое не уехало:
    // ассерт по знакомым ключам пропустил бы производное поле.
    const payloads: string[] = []
    page.on('response', async (response) => {
      if (response.url().includes('/api/ops/rating-export')) {
        payloads.push(await response.text())
      }
    })
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-analyst' }),
      )
    })
    await page.goto('/ratings/export')

    await expect(page.getByText('Выгрузок пока нет.')).toBeVisible()
    await page.getByRole('button', { name: 'Заказать CSV' }).click()

    // Состояние доходит до READY само: работу продвигает СЕРВЕР при чтении, а
    // экран лишь опрашивает — «готовится» на клиенте состоянием не является.
    const row = page.getByRole('row', { name: /Агрегированная сводка/ })
    await expect(row.getByRole('cell', { name: 'Готов', exact: true })).toBeVisible()
    await expect(row).toContainText('operational-rating-aggregate')

    const download = page.waitForEvent('download')
    await row.getByRole('button', { name: 'Скачать' }).click()
    const file = await download
    expect(file.suggestedFilename()).toContain('.csv')

    expect(payloads.length).toBeGreaterThan(0)
    for (const body of payloads) {
      // §19.29 перечисляет запрещённое списком: оценщик, комментарий,
      // отдельная оценка, персональное основание.
      expect(body).not.toContain('demo-event-planner')
      expect(body).not.toContain('Задержка на инструктаже')
      expect(body).not.toContain('TIMELY_ARRIVAL')
      expect(body).not.toContain('evaluation-1')
    }
  })

  test('отмена уводит работу в CANCELLED и файла не оставляет', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-analyst' }),
      )
    })
    // Экран без автозаказа: работа создаётся кликом, и отмена успевает застать
    // её в очереди только потому, что ступень идёт на СЛЕДУЮЩЕМ чтении.
    await page.route('**/api/ops/rating-exports/', async (route) => {
      if (route.request().method() === 'GET') {
        // Ответ отдаём как есть, но с задержкой: без неё опрос доводит работу
        // до готовности раньше, чем человек успевает нажать «Отменить», и
        // сценарий проверял бы не отмену, а скорость теста.
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
      await route.continue()
    })
    await page.goto('/ratings/export')
    await page.getByRole('button', { name: 'Заказать CSV' }).click()
    const row = page.getByRole('row', { name: /Агрегированная сводка/ })
    await row.getByRole('button', { name: 'Отменить' }).click()
    await expect(row.getByRole('cell', { name: 'Отменён', exact: true })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Скачать' })).toHaveCount(0)
  })

  test('маршрут выгрузки требует СВОЕГО права: оценщику он закрыт', async ({ page }) => {
    // У организатора ОМ есть `ops.rating.evaluate`, но не `ops.rating.export`:
    // без persona БЕЗ права закрытое состояние было бы недостижимо.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-event-planner' }),
      )
    })
    await page.goto('/ratings/export')
    await expect(page.getByText('Доступ запрещён')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Заказать CSV' })).toHaveCount(0)
  })
})
