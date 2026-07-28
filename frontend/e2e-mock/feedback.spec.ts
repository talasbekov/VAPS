// Smart Josparlau E2E (§33, Этап 47): обратная связь — реестр обращений
// (§28 list), создание и черновик (§28 create), конфиденциальность и область
// поиска.
//
// Что проверяется живым прогоном:
//   1) обращение заводится через форму и появляется в реестре;
//   2) черновик отправляется отдельным действием и меняет статус;
//   3) содержание ЧУЖОГО конфиденциального обращения не приезжает в браузер
//      вовсе — проверяется по телам сетевых ответов, а не по разметке;
//   4) поиск не находит по вырезанному содержанию;
//   5) чужой черновик не виден даже под wildcard-персоной.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { seedCredential } from './testUtils'

/** Слово живёт ТОЛЬКО в описании конфиденциального обращения сида — ни в
 * теме, ни в других записях. См. `features/feedback/mocks/fixtures.ts`. */
const SECRET_WORD = 'журавль'
const CONFIDENTIAL_SUBJECT = 'Обращение по доступу'
const FOREIGN_DRAFT_SUBJECT = 'Черновик обращения аналитика'

/** Смена persona — ВТОРЫМ addInitScript: `seedCredential` тоже init-скрипт и
 * переустанавливает demo-admin на КАЖДОЙ навигации, поэтому `evaluate`+reload
 * молча вернул бы прежние права (урок Этапа 41). */
async function usePersona(page: Page, userId: string): Promise<void> {
  await page.addInitScript((id) => {
    sessionStorage.setItem('vaps.credential', JSON.stringify({ kind: 'dev', userId: id }))
  }, userId)
}

async function openFeedback(page: Page) {
  await page.goto('/feedback')
  await expect(page.getByRole('heading', { name: 'Обратная связь' })).toBeVisible()
  return page.getByRole('group', { name: 'Форма обращения' })
}

test.describe('Обратная связь (§28, mock-режим)', () => {
  test('обращение заводится формой и появляется в реестре', async ({ page }) => {
    await seedCredential(page)
    await usePersona(page, 'demo-event-planner')
    const form = await openFeedback(page)

    const subject = 'Не сохраняется примечание к смене'
    await form.getByLabel('Тема обращения').fill(subject)
    await form
      .getByLabel('Описание обращения')
      .fill('Примечание пропадает после перезагрузки страницы.')
    await form.getByLabel('Тип обращения').selectOption({ label: 'Ошибка' })
    await form.getByLabel('Приоритет обращения').selectOption({ label: 'Высокий' })
    await form.getByLabel('Модуль обращения').selectOption({ label: 'План дежурств' })
    await form.getByRole('button', { name: 'Создать обращение' }).click()

    const row = page.locator('li', { hasText: subject }).first()
    await expect(row).toBeVisible()
    // Статусная подпись — ТОЧНАЯ: «Новое» иначе поймалось бы подстрокой в
    // «Новое обращение» (заголовок формы) — тот же класс, что уже ловили.
    await expect(row.getByText('Новое', { exact: true })).toBeVisible()
    // Форма очистилась — иначе следующее обращение уехало бы с тем же текстом.
    await expect(form.getByLabel('Тема обращения')).toHaveValue('')
  })

  test('черновик отправляется отдельным действием', async ({ page }) => {
    await seedCredential(page)
    await usePersona(page, 'demo-event-planner')
    const form = await openFeedback(page)

    const subject = 'Недописанное обращение про календарь'
    await form.getByLabel('Тема обращения').fill(subject)
    await form.getByLabel('Описание обращения').fill('Дополню позже.')
    await form.getByRole('button', { name: 'Сохранить без отправки' }).click()

    const row = page.locator('li', { hasText: subject }).first()
    await expect(row.getByText('Черновик', { exact: true })).toBeVisible()

    await row.getByRole('button', { name: 'Отправить в работу' }).click()
    await expect(row.getByText('Новое', { exact: true })).toBeVisible()
    // Действие исчезает вместе с черновиком: второй отправки у обращения нет.
    await expect(row.getByRole('button', { name: 'Отправить в работу' })).toHaveCount(0)
  })

  test('содержание чужого конфиденциального обращения не приезжает в браузер', async ({
    page,
  }) => {
    const bodies: string[] = []
    page.on('response', async (response) => {
      if (!response.url().includes('/api/ops/feedback-requests')) return
      bodies.push(await response.text().catch(() => ''))
    })

    await seedCredential(page)
    // Аналитик — контролёр: `ops.feedback.view_all` у него есть,
    // `ops.feedback.view_confidential` — нет, и автор обращения не он. Это
    // единственная persona, на которой признак «конфиденциально» вообще
    // наблюдаем: строка обязана быть видна, содержание — нет.
    await usePersona(page, 'demo-analyst')
    await page.goto('/feedback')
    await expect(page.getByRole('heading', { name: 'Обратная связь' })).toBeVisible()

    // Сеяное обращение лежит не на первой странице — сужаем фильтром, иначе
    // «строки нет» означало бы всего лишь «она на другой странице».
    await page.getByLabel('Фильтр по типу').selectOption({ label: 'Доступ' })

    // Строка ЕСТЬ — иначе проверка «содержания нет» была бы пустой.
    const row = page.locator('li', { hasText: CONFIDENTIAL_SUBJECT }).first()
    await expect(row).toBeVisible()
    await expect(row.getByText('Конфиденциально', { exact: true })).toBeVisible()
    await expect(row.getByText(/помечено автором как конфиденциальное/)).toBeVisible()

    // Главное: содержание не приехало в браузер ВООБЩЕ — проверяем ТЕЛА
    // ответов, а не разметку. Спрятать текст вёрсткой значило бы всё равно
    // отдать его вкладке и положить в кэш запросов.
    expect(bodies.length).toBeGreaterThan(0)
    expect(bodies.join('\n')).not.toContain(SECRET_WORD)

    // И поиск по вырезанному слову ничего не находит: совпадение само по себе
    // выдало бы его содержимое.
    await page.getByLabel('Поиск по обращениям').fill(SECRET_WORD)
    await expect(page.getByText(/ничего не нашлось/)).toBeVisible()
  })

  test('чужой черновик не виден даже wildcard-персоне', async ({ page }) => {
    await seedCredential(page)
    await page.goto('/feedback')
    await expect(page.getByRole('heading', { name: 'Обратная связь' })).toBeVisible()

    // Администратор видит и чужие обращения, и закрытое содержание — но не
    // ЧУЖОЙ ЧЕРНОВИК: он не отправлен, и никакое право этого не меняет.
    // Поиском, а не глазами по первой странице: реестр разбит на страницы, и
    // «строки не видно» само по себе ничего не доказывает.
    const search = page.getByLabel('Поиск по обращениям')
    await search.fill(CONFIDENTIAL_SUBJECT)
    await expect(page.getByText(CONFIDENTIAL_SUBJECT)).toHaveCount(1)

    await search.fill(FOREIGN_DRAFT_SUBJECT)
    await expect(page.getByText(FOREIGN_DRAFT_SUBJECT)).toHaveCount(0)
    await expect(page.getByText(/ничего не нашлось/)).toBeVisible()
  })

  test('поиск и страницы считает сервер', async ({ page }) => {
    await seedCredential(page)
    await page.goto('/feedback')
    await expect(page.getByRole('heading', { name: 'Обратная связь' })).toBeVisible()

    // Администратору видны восемь сеяных обращений из девяти (девятое —
    // чужой черновик), страница — четыре строки: ровно две страницы.
    await expect(page.getByText(/Страница 1 из 2/)).toBeVisible()

    await page.getByRole('button', { name: 'Вперёд' }).click()
    await expect(page.getByText(/Страница 2 из 2/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Вперёд' })).toBeDisabled()

    // Поиск возвращает на первую страницу и сужает выдачу.
    await page.getByLabel('Поиск по обращениям').fill('паспорт')
    await expect(page.getByText(/Страница 1 из 1/)).toBeVisible()
    await expect(page.getByText('Неверный пост в снимке паспорта')).toBeVisible()
  })
})
