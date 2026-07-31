// Smart Josparlau E2E (§33, Этап 57): §19.7-19.14 рабочее пространство
// оценивания — очередь заданий, форма и отправка.
//
// Проверяется то, чего не видит ни один unit-тест: очередь, форма, отправка и
// СВОДКА рейтинга — разные экраны и разные фичи, связанные только общим
// demo-снапшотом; отправленная оценка обязана изменить агрегат в другом
// разделе, а закрытые поля не должны появиться в ответах по дороге.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

/** Организатор ОМ: оценивает, но агрегата НЕ видит (§19.22). */
async function asEvaluator(page: import('@playwright/test').Page) {
  // Вторым addInitScript, а не evaluate+reload: сид credential сам является
  // init-скриптом и переустанавливал бы demo-admin на каждой навигации.
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'vaps.credential',
      JSON.stringify({ kind: 'dev', userId: 'demo-event-planner' }),
    )
  })
}

test.describe('Оценивание участников §19.14 (mock-режим)', () => {
  test('очередь заданий приходит с сервера и не несёт оценщика', async ({ page }) => {
    const payloads: string[] = []
    page.on('response', async (response) => {
      if (response.url().includes('/api/ops/evaluation-workspace/')) {
        payloads.push(await response.text())
      }
    })
    await asEvaluator(page)
    await page.goto('/ratings/workspace')
    await expect(page.getByRole('heading', { name: 'Оценивание участников' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Оценить: Ерланов Д.' })).toBeVisible()

    expect(payloads.length).toBeGreaterThan(0)
    for (const body of payloads) {
      // Оценщик не едет наружу ни одним полем (§19.7), и чужой комментарий —
      // тоже: закрытость обеспечивается API, а не вёрсткой.
      expect(body).not.toContain('evaluatorUserId')
      expect(body).not.toContain('demo-recon-officer')
    }
  })

  test('оценка ниже 8 без комментария не уходит на сервер (§19.9)', async ({ page }) => {
    const submissions: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/submit/')) submissions.push(request.url())
    })
    await asEvaluator(page)
    await page.goto('/ratings/workspace')
    await page.getByRole('button', { name: 'Оценить: Ерланов Д.' }).click()
    await page.getByLabel('Оценка').selectOption('6')
    await page.getByLabel('Основание').selectOption('DISCIPLINE')
    await page.getByRole('button', { name: 'Отправить оценку' }).click()
    await expect(
      page.getByText('Оценка ниже 8 требует комментария с конкретной причиной.'),
    ).toBeVisible()
    // Главное: запроса НЕ БЫЛО. Без этой проверки тест утверждал бы лишь то,
    // что надпись появилась, — а форма могла уже уехать на сервер.
    expect(submissions).toHaveLength(0)
  })

  test('отправленная оценка закрывает задание и входит в агрегат другого раздела', async ({
    page,
  }) => {
    // Здесь persona НЕ переключается: агрегат виден только тому, у кого есть
    // право сводки, и связь «оценка → агрегат» иначе была бы непроверяема
    // одним сеансом. Задание администратора-эталона адресовано Нурланову Е. —
    // участнику, у которого в периоде НЕТ ни одной оценки.
    await page.goto('/ratings')
    const before = page.getByRole('row', { name: /Нурланов/ })
    await expect(before.getByRole('cell').nth(2)).toHaveText('0')

    await page.goto('/ratings/workspace')
    await page.getByRole('button', { name: 'Оценить: Нурланов Е.' }).click()
    await page.getByLabel('Оценка').selectOption('4')
    await page.getByLabel('Основание').selectOption('OTHER')
    // «Другое» требует пояснения по policy — поле появляется только под него.
    await page.getByLabel('Пояснение к основанию').fill('Разбор нестандартной ситуации')
    await page.getByLabel(/Комментарий/).fill('Оставил пост до смены')
    await page.getByRole('button', { name: 'Отправить оценку' }).click()

    // Задание ушло из очереди — это состояние сервера, а не скрытая строка.
    await expect(page.getByRole('button', { name: 'Оценить: Нурланов Е.' })).toHaveCount(0)
    await page.getByRole('tab', { name: 'Отправленные мной' }).click()
    const submitted = page.getByRole('region', { name: 'Отправленные мной' })
    await expect(submitted).toContainText('Оценка: 4 · Основание: Другое')
    await expect(submitted).toContainText('Комментарий: Оставил пост до смены')

    // Другой раздел: сводка учла новую оценку — счёт ведёт СЕРВЕР, а не экран.
    await page.goto('/ratings')
    const after = page.getByRole('row', { name: /Нурланов/ })
    await expect(after.getByRole('cell').nth(2)).toHaveText('1')
    // Одной оценки меньше минимума — состояние, а не ноль (§19.2).
    await expect(after).toContainText('Недостаточно данных')
    await expect(after).not.toContainText('0,0')
  })

  test('вкладка «Сводка мероприятия» есть только у того, кому выдан агрегат', async ({ page }) => {
    await asEvaluator(page)
    await page.goto('/ratings/workspace')
    await expect(page.getByRole('tab', { name: 'Мне нужно оценить' })).toBeVisible()
    // §19.14: сводка мероприятия — работа ДРУГИХ людей, и организатору она не
    // выдана. Отказ положительный: остальные вкладки на месте.
    await expect(page.getByRole('tab', { name: 'Сводка мероприятия' })).toHaveCount(0)
  })

  test('администратору сводка мероприятия доступна и не содержит значений оценок', async ({
    page,
  }) => {
    await page.goto('/ratings/workspace')
    await page.getByRole('tab', { name: 'Сводка мероприятия' }).click()
    const panel = page.getByRole('region', { name: 'Сводка мероприятия' })
    await expect(panel).toContainText('Заданий: 8')
    await expect(panel).toContainText('Старший → сотрудник')
    // Прогресс — не содержание: ни одной оценки и ни одного комментария.
    await expect(panel).not.toContainText('Задержка на инструктаже')
  })

  test('без права оценивания раздел не открывается и в меню не показан', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-objects-admin' }),
      )
    })
    await page.goto('/ratings/workspace')
    await expect(page.getByText('Доступ запрещён')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Оценивание участников' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Оценивание участников' })).toHaveCount(0)
  })
})

test.describe('Исправление оценки §19.17-19.18 (mock-режим)', () => {
  test('карточка показывает историю записи, а исправление создаёт НОВУЮ запись', async ({
    page,
  }) => {
    await asEvaluator(page)
    await page.goto('/ratings/workspace')
    await page.getByRole('tab', { name: 'Отправленные мной' }).click()
    await page.getByRole('button', { name: 'Открыть отправленную оценку: Ерланов Д.' }).click()

    const card = page.getByRole('region', { name: 'Отправленная оценка' })
    // Сеяная цепочка: тройка была заменена девяткой, и старое значение видно
    // вместе с причиной (§19.18 «нельзя скрыть старое значение»).
    await expect(card).toContainText('оценка 3')
    await expect(card).toContainText('Оценка выставлена по ошибке не тому участнику')

    await card.getByRole('button', { name: 'Исправить оценку' }).click()
    await card.getByLabel('Новая оценка').selectOption('10')
    await card.getByLabel(/Причина исправления/).fill('Учтён рапорт старшего смены')
    await card.getByRole('button', { name: 'Показать изменения' }).click()
    // Шаг 8: diff показан ДО подтверждения.
    const preview = page.getByLabel('Подтверждение исправления')
    await expect(preview).toContainText('Оценка: 9 → 10')
    await preview.getByRole('button', { name: 'Подтвердить исправление' }).click()

    // Цепочка удлинилась, вытесненная запись осталась в истории.
    await expect(card).toContainText('оценка 9')
    await expect(card).toContainText('Учтён рапорт старшего смены')
  })

  test('оценщику без права исправления кнопка не показывается', async ({ page }) => {
    // Офицер рекогносцировки оценивает, но не исправляет и цепочки не видит:
    // без persona БЕЗ этих прав закрытое состояние недостижимо.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-recon-officer' }),
      )
    })
    await page.goto('/ratings/workspace')
    await page.getByRole('tab', { name: 'Отправленные мной' }).click()
    await page.getByRole('button', { name: /Открыть отправленную оценку/ }).click()
    const card = page.getByRole('region', { name: 'Отправленная оценка' })
    await expect(card).toContainText('право на исправление оценки не выдано')
    await expect(card).toContainText('право на просмотр цепочки исправлений не выдано')
    await expect(card.getByRole('button', { name: 'Исправить оценку' })).toHaveCount(0)
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
