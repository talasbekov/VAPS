// Smart Josparlau E2E (§33, Этап 54): §19 оперативный рейтинг — сводный экран
// агрегатов и его связь с методикой из «Настроек».
//
// Проверяется то, чего не видит ни один unit-тест: раздел настроек и рейтинг —
// разные фичи, связанные только общим demo-снапшотом, и правка порога методики
// обязана изменить СОСТОЯНИЕ сводки, а не подпись под ней.
import { expect, test } from '@playwright/test'
import { seedCredential } from './testUtils'

const MIN_EVALUATIONS_ROW = 'Минимум оценок для расчёта агрегата'

test.describe('Оперативный рейтинг §19 (mock-режим)', () => {
  test('сводка приходит с сервера: агрегат, методика и состояния', async ({ page }) => {
    await page.goto('/ratings')
    await expect(page.getByRole('heading', { name: 'Оперативный рейтинг' })).toBeVisible()
    // Методика — редакция раздела «Настроек», а не строка в коде экрана.
    // Адресуется ИМЕННО панель методики: ту же редакцию печатает и оговорка
    // динамики §19.20, и поиск по всей странице нашёл бы любую из двух.
    const method = page.getByRole('region', { name: 'Методика расчёта' })
    await expect(method.getByText('OPERATIONAL-RATING-2026.07.1')).toBeVisible()
    await expect(page.getByText('105 сут.')).toBeVisible()

    // 9+8+7+9+10 = 43 при пяти учтённых (шестая вытеснена исправлением) → 8,6.
    const first = page.getByRole('row', { name: /Ерланов/ })
    await expect(first).toContainText('8,6')
    await expect(first).toContainText('Рассчитан')

    // У кого оценок меньше минимума — СОСТОЯНИЕ, а не ноль.
    const few = page.getByRole('row', { name: /Сейтказы/ })
    await expect(few).toContainText('Недостаточно данных')
    await expect(few).not.toContainText('0,0')
  })

  test('правка минимума оценок МЕНЯЕТ состояние сводки в другом разделе', async ({ page }) => {
    await page.goto('/settings')
    const row = page.locator('tr', { hasText: MIN_EVALUATIONS_ROW })
    await row.getByRole('button', { name: 'Изменить' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/Значение/).fill('6')
    await dialog.getByLabel(/Причина изменения/).fill('Повышение требований к выборке оценок')
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    await expect(dialog).toBeHidden()

    await page.goto('/ratings')
    // Пяти учтённых оценок больше не хватает — готовая сводка стала «недостаточно».
    await expect(page.getByRole('row', { name: /Ерланов/ })).toContainText('Недостаточно данных')
    // И методика на экране — уже НОВАЯ редакция: значения по старой и новой
    // несопоставимы, и экран об этом говорит.
    await expect(
      page
        .getByRole('region', { name: 'Методика расчёта' })
        .getByText('OPERATIONAL-RATING-2026.07.2'),
    ).toBeVisible()
  })

  test('закрытые данные не приходят в браузер вовсе (§19.21)', async ({ page }) => {
    const payloads: string[] = []
    page.on('response', async (response) => {
      if (response.url().includes('/api/ops/operational-ratings/')) {
        payloads.push(await response.text())
      }
    })
    await page.goto('/ratings')
    await expect(page.getByRole('row', { name: /Ерланов/ })).toContainText('8,6')
    expect(payloads.length).toBeGreaterThan(0)
    for (const body of payloads) {
      // Оценщик и текст комментария закрыты — их нет в ОТВЕТЕ, а не спрятаны
      // в вёрстке: закрытость обеспечивается API (§19.21).
      expect(body).not.toContain('demo-event-planner')
      expect(body).not.toContain('Задержка на инструктаже')
    }
  })

  test('динамика §19.20: ряд закрытых периодов и граница смены методики', async ({ page }) => {
    const payloads: string[] = []
    page.on('response', async (response) => {
      if (response.url().includes('/api/ops/operational-rating-dynamics/')) {
        payloads.push(await response.text())
      }
    })
    await page.goto('/ratings')
    const dynamics = page.getByRole('region', { name: 'Динамика агрегата' })
    await expect(dynamics.getByRole('row', { name: /2026-03/ })).toContainText('8,1')
    // Граница смены методики нарисована, и точки по разные её стороны НЕ
    // соединены одной линией: два отрезка вместо одного (2026-03+2026-04 под
    // прежней методикой и 2026-06 под нынешней; 2026-05 без агрегата — разрыв).
    await expect(dynamics.getByText('смена методики')).toBeVisible()
    await expect(dynamics.locator('polyline')).toHaveCount(2)
    // Действующая редакция ни одного периода не закрывала — экран говорит это
    // прямо, а не подписывает ею чужие точки.
    await expect(dynamics.getByText(/ещё не закрывала/)).toBeVisible()

    // Переключение сотрудника — ЗАПРОС к серверу, а не фильтр по уже
    // полученному ряду.
    const before = payloads.length
    await dynamics.getByLabel('Сотрудник').selectOption({ label: 'Нурланов Е.' })
    await expect(dynamics.getByText('Закрытых периодов ещё нет')).toHaveCount(0)
    await expect(dynamics.getByRole('row', { name: /2026-03/ })).toContainText(
      'Недостаточно данных',
    )
    await expect.poll(() => payloads.length).toBeGreaterThan(before)
    for (const body of payloads) {
      expect(body).not.toContain('demo-event-planner')
      expect(body).not.toContain('Задержка на инструктаже')
    }
  })

  test('аналитика §22.16: подавление малой группы и своё право раздела', async ({ page }) => {
    const payloads: string[] = []
    page.on('response', async (response) => {
      if (response.url().includes('/api/ops/rating-analytics/')) {
        payloads.push(await response.text())
      }
    })
    await page.goto('/ratings/analytics')
    await expect(page.getByRole('heading', { name: 'Аналитика рейтинга' })).toBeVisible()

    // Малая группа: формулировка §22.17 дословно, значения нет ни на экране,
    // ни в ответе API — подавление обеспечивается сервером, а не вёрсткой.
    const suppressed = page.getByRole('row', { name: /Третье управление/ })
    await expect(suppressed).toContainText('Недостаточно данных для безопасного отображения')
    const rated = page.getByRole('row', { name: /Первое управление/ })
    await expect(rated).not.toContainText('Недостаточно данных')
    expect(payloads.length).toBeGreaterThan(0)
    for (const body of payloads) {
      // Ни одного участника поимённо (§22.16) и ни одной закрытой величины.
      expect(body).not.toContain('Ерланов')
      expect(body).not.toContain('demo-event-planner')
    }
  })

  test('отчёт §22.16 закрыт держателю одной лишь сводки рейтинга', async ({ page }) => {
    // §22.26: отчёт охраняет право РАЗДЕЛА АНАЛИТИКИ. Persona ведущего
    // объекты его не имеет — отказ ПОЛОЖИТЕЛЬНЫЙ («Доступ запрещён»), а не
    // пустой экран по любой другой причине.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-objects-admin' }),
      )
    })
    await page.goto('/ratings/analytics')
    await expect(page.getByText('Доступ запрещён')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Аналитика рейтинга' })).toHaveCount(0)
  })

  test('без своего права раздел не открывается и в меню не показан', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-objects-admin' }),
      )
    })
    await page.goto('/ratings')
    // Отказ ПОЛОЖИТЕЛЬНЫЙ: маршрут ответил «Доступ запрещён», а не остался
    // пустым по любой другой причине — иначе проверка была бы вакуумной.
    await expect(page.getByText('Доступ запрещён')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Оперативный рейтинг' })).toHaveCount(0)
    await expect(
      page.getByRole('link', { name: 'Оперативный рейтинг' }),
    ).toHaveCount(0)
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
