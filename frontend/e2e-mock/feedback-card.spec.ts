// Smart Josparlau E2E (§33, Этап 48): карточка обращения — разбор,
// переписка, внутренняя заметка по праву, закрытие с ответом автору, лента.
//
// Что проверяется живым прогоном:
//   1) разбор меняет карточку и дописывает ленту сам, без ручной записи;
//   2) внутренняя заметка НЕ приезжает автору — ни текстом, ни событием, и
//      проверяется это по телам сетевых ответов;
//   3) закрытие обязательно сопровождается ответом, который автор видит;
//   4) закрытое обращение больше не принимает ни разбора, ни комментария.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { seedCredential } from './testUtils'

/** Обращение сида, у которого уже есть и вложение, и переписка (§33). */
const CARD_SUBJECT = 'Не открывается карточка мероприятия по прямой ссылке'
/** Слово живёт ТОЛЬКО во внутренней заметке сида. */
const NOTE_WORD = 'секвойя'

async function usePersona(page: Page, userId: string): Promise<void> {
  await page.addInitScript((id) => {
    sessionStorage.setItem('vaps.credential', JSON.stringify({ kind: 'dev', userId: id }))
  }, userId)
}

/** Открывает карточку ИЗ РЕЕСТРА — ссылкой, а не прямым адресом: вход в
 * раздел должен существовать, иначе маршрут мёртв. */
async function openCard(page: Page): Promise<void> {
  await page.goto('/feedback')
  await expect(page.getByRole('heading', { name: 'Обратная связь' })).toBeVisible()
  await page.getByLabel('Поиск по обращениям').fill('прямой ссылке')
  await page.getByRole('link', { name: CARD_SUBJECT }).click()
  await expect(page.getByRole('heading', { name: CARD_SUBJECT })).toBeVisible()
}

test.describe('Карточка обращения (§28 detail, mock-режим)', () => {
  test('разбор меняет карточку и сам дописывает ленту', async ({ page }) => {
    await seedCredential(page)
    await openCard(page)

    const triage = page.getByRole('group', { name: 'Разбор обращения' })
    await triage.getByLabel('Рабочий приоритет').selectOption({ label: 'Низкий' })
    await expect(page.getByTestId('card-working-priority')).toHaveText('Низкий')

    // Заявленный приоритет НЕ изменился: §28 держит их раздельно.
    await expect(page.getByText('Высокий', { exact: true }).first()).toBeVisible()

    // Событие появилось само — операция о ленте не знает.
    await expect(page.getByText('Рабочий приоритет изменён')).toBeVisible()
    // Аудит §28 «old/new»: у сеяного обращения рабочий приоритет уже был —
    // событие обязано назвать ОБА значения, а не только новое.
    await expect(page.getByText('workingPriorityCode: NORMAL → LOW')).toBeVisible()
  })

  test('внутренняя заметка не приезжает автору ни текстом, ни событием', async ({ page }) => {
    const bodies: string[] = []
    page.on('response', async (response) => {
      if (!response.url().includes('/api/ops/feedback-requests')) return
      bodies.push(await response.text().catch(() => ''))
    })

    await seedCredential(page)
    // Автор обращения `fb-1001` — организатор ОМ.
    await usePersona(page, 'demo-event-planner')
    await openCard(page)

    // Публичный ответ он видит — иначе проверка «заметки нет» была бы пустой.
    await expect(page.getByText('Ответ автору', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Внутренняя заметка', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Добавлена внутренняя заметка')).toHaveCount(0)

    expect(bodies.length).toBeGreaterThan(0)
    expect(bodies.join('\n')).not.toContain(NOTE_WORD)
  })

  test('разбирающему без права заметки её тоже не видно, а разбор доступен', async ({ page }) => {
    const bodies: string[] = []
    page.on('response', async (response) => {
      if (!response.url().includes('/api/ops/feedback-requests')) return
      bodies.push(await response.text().catch(() => ''))
    })

    await seedCredential(page)
    // Аналитик разбирает обращения, но `ops.feedback.internal_note` у него нет.
    await usePersona(page, 'demo-analyst')
    await openCard(page)

    await expect(page.getByRole('group', { name: 'Разбор обращения' })).toBeVisible()
    await expect(page.getByLabel('Внутренняя заметка')).toHaveCount(0)
    expect(bodies.join('\n')).not.toContain(NOTE_WORD)
  })

  test('закрытие требует ответа автору и запирает обращение', async ({ page }) => {
    await seedCredential(page)
    await openCard(page)

    const closing = page.getByRole('group', { name: 'Закрытие обращения' })
    await closing.getByLabel('Исход закрытия').selectOption({ label: 'Отклонено' })
    // Без ответа кнопка выключена: закрыть молча нельзя.
    await expect(closing.getByRole('button', { name: 'Закрыть обращение' })).toBeDisabled()

    await closing
      .getByLabel('Ответ автору при закрытии')
      .fill('Поведение исправлено в следующей сборке.')
    await closing.getByRole('button', { name: 'Закрыть обращение' }).click()

    await expect(page.getByTestId('card-status')).toHaveText('Отклонено')
    // ТОЧНАЯ подпись: текст события «Обращение закрыто» — подстрока причины
    // замка «Обращение закрыто: изменения и комментарии…», и нестрогий локатор
    // поймал бы оба (тот же класс, что уже ловили на статусных подписях).
    await expect(page.getByText('Обращение закрыто', { exact: true })).toBeVisible()
    // Ответ опубликован и виден в переписке.
    await expect(page.getByText('Поведение исправлено в следующей сборке.')).toBeVisible()

    // Замок: ни разбора, ни закрытия больше нет, причина названа.
    await expect(page.getByRole('group', { name: 'Разбор обращения' })).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Закрытие обращения' })).toHaveCount(0)
    await expect(page.getByText(/Обращение закрыто: изменения и комментарии/)).toBeVisible()
  })
})
