// Smart Josparlau E2E (§33, Этап 62): §19.28 уведомления оценивания — deep link
// перепроверяет права, а закрытые данные в уведомление не попадают.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

test.describe('Уведомления оценивания §19.28 (mock-режим)', () => {
  test('уведомление появляется после commit и ведёт по deep link', async ({ page }) => {
    const payloads: string[] = []
    page.on('response', async (response) => {
      if (response.url().includes('/api/ops/rating-notifications/')) {
        payloads.push(await response.text())
      }
    })
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-event-planner' }),
      )
    })
    await page.goto('/ratings/workspace')
    const notifications = page.getByRole('region', { name: 'Уведомления оценивания' })
    await expect(
      notifications.getByRole('link', { name: 'Вам доступно итоговое оценивание мероприятия' }),
    ).toBeVisible()
    await expect(
      notifications.getByRole('link', { name: 'Оценивание успешно отправлено' }),
    ).toHaveCount(0)

    await page.getByRole('button', { name: 'Оценить: Ерланов Д.' }).click()
    await page.getByLabel('Оценка').selectOption('4')
    await page.getByLabel('Основание').selectOption('DISCIPLINE')
    await page.getByLabel(/Комментарий/).fill('Оставил пост до смены')
    await page.getByRole('button', { name: 'Отправить оценку' }).click()

    // Уведомление появилось ПОСЛЕ коммита — и ровно разрешённой формулировкой.
    await expect(
      notifications.getByRole('link', { name: 'Оценивание успешно отправлено' }),
    ).toBeVisible()
    for (const body of payloads) {
      expect(body).not.toContain('Оставил пост до смены')
      expect(body).not.toContain('"score"')
    }

    // Deep link ведёт на рабочее пространство того же мероприятия.
    await notifications.getByRole('link', { name: 'Оценивание успешно отправлено' }).click()
    await expect(page).toHaveURL(/\/ratings\/workspace\?event=event-1/)
  })

  test('deep link ПЕРЕПРОВЕРЯЕТ права: без права маршрут отвечает отказом', async ({ page }) => {
    // Ведущий объекты не имеет `ops.rating.evaluate`: переход по той же ссылке
    // даёт отказ, а не содержимое (§19.28 «deep link повторно проверяет
    // permissions и scope»).
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-objects-admin' }),
      )
    })
    await page.goto('/ratings/workspace?event=event-1')
    await expect(page.getByText('Доступ запрещён')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Уведомления оценивания' })).toHaveCount(0)
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
