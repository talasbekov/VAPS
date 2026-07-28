// Smart Josparlau E2E (§33, Этап 38): lifecycle месячного плана (§21.27) и
// шапка плана с action policy (§21.28).
//
// Что здесь проверяется живым прогоном, а не рассуждением:
//   1) месяц без плана честно назван «черновик не сформирован» — план не
//      заводится сам собой при открытии экрана;
//   2) конвейер черновик → проверка → утверждение проходится ИЗ UI целиком;
//   3) проверка с жёсткими конфликтами НЕ пускает к утверждению, и причина
//      названа числом — июльский demo-сид даёт ровно этот случай;
//   4) утверждённый месяц закрыт для планирования — форма заведения смены
//      получает отказ сервера, а не молча создаёт смену мимо плана;
//   5) новая редакция возвращает месяц в работу, а история не переписывается.
//
// Даты — константы demo-сценария (DemoClock стартует 2026-07-20T08:00+05:00).
// Август выбран для полного пути осознанно: в июле сид даёт 2 жёстких
// конфликта, и утверждение там недостижимо ПО СУЩЕСТВУ, а не по недосмотру.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { seedCredential } from './testUtils'

const PLAN_SECTION_NAME = 'Состояние месячного плана'

async function openMonthTab(page: Page) {
  await page.goto('/duties')
  await expect(page.getByRole('heading', { name: 'План дежурств' })).toBeVisible()
  await page.getByRole('button', { name: 'Месяц' }).click()
  const header = page.getByRole('region', { name: PLAN_SECTION_NAME })
  await expect(header).toBeVisible()
  return header
}

test.describe('Lifecycle месячного плана (§21.27-21.28, mock-режим)', () => {
  test('месяц без плана: черновик не сформирован, действия закрыты С ПРИЧИНОЙ', async ({
    page,
  }) => {
    await seedCredential(page)
    const header = await openMonthTab(page)

    await expect(header.getByText('Черновик не сформирован')).toBeVisible()
    await expect(header.getByRole('group', { name: 'Последняя проверка' })).toHaveText(
      'Последняя проверкаПроверка конфликтов не проводилась',
    )
    // §21.27 «Сформировать план» переименована — на экране именно черновик.
    await expect(header.getByRole('button', { name: 'Сформировать черновик' })).toBeEnabled()
    await expect(header.getByRole('button', { name: 'Сформировать план' })).toHaveCount(0)

    await expect(header.getByRole('button', { name: 'Проверить конфликты' })).toBeDisabled()
    await expect(header.getByRole('button', { name: 'Утвердить план' })).toBeDisabled()
    // Причина названа у КАЖДОГО закрытого действия, а не у одного на всех.
    const noPlanReasons = header.getByRole('listitem').filter({
      hasText: 'Плана на этот месяц нет — сначала сформируйте черновик.',
    })
    await expect(noPlanReasons).toHaveCount(2)

    // §21.28: «Экспортировать» назван недоступным по НЕРЕАЛИЗОВАННОСТИ, а не
    // спрятан — скрытая кнопка не сообщила бы причину.
    await expect(header.getByRole('button', { name: 'Экспортировать' })).toBeDisabled()
    await expect(header.getByText(/Экспорт месячного плана не реализован/)).toBeVisible()

    // §21.28 «источник объектов» — реальный реестр, а не подпись-заглушка.
    await expect(header.getByText(/Реестр объектов \(паспорта, секторы и посты\)/)).toBeVisible()
  })

  test('июль: проверка находит жёсткие конфликты и НЕ пускает к утверждению', async ({ page }) => {
    await seedCredential(page)
    const header = await openMonthTab(page)

    await header.getByRole('button', { name: 'Сформировать черновик' }).click()
    await expect(header.getByText('Черновик', { exact: true })).toBeVisible()
    await expect(header.getByRole('group', { name: 'Редакция' })).toContainText('1')

    await header.getByRole('button', { name: 'Проверить конфликты' }).click()
    // Демо-сид июля: ПЕРЕСЕЧЕНИЕ — единственный жёсткий конфликт. Нарушения
    // отдыха жёсткими не являются, пока действующий режим §21.35 — мягкий:
    // severity задаёт глобальная политика «Настроек» (§29), а не вид дежурства.
    await expect(header.getByText(/не пройдена \(жёстких конфликтов 1\)/)).toBeVisible()
    await expect(header.getByRole('button', { name: 'Утвердить план' })).toBeDisabled()
    await expect(
      header.getByText(/жёстких конфликтов: 1\. Их нельзя обойти обоснованием/),
    ).toBeVisible()

    // Проверка — РЕЗУЛЬТАТ, а не состояние: план остался черновиком (§21.27).
    // Подпись состояния сверяется ТОЧНО: «Утверждён» — подстрока и «Плана
    // утверждён» в истории, и «Утвердить план» на кнопке.
    await expect(header.getByText('Черновик', { exact: true })).toBeVisible()
    await expect(header.getByText('Утверждён', { exact: true })).toHaveCount(0)

    // Персистентность: результат проверки лежит в хранилище, а не в state.
    await page.reload()
    await page.getByRole('button', { name: 'Месяц' }).click()
    await expect(
      page
        .getByRole('region', { name: PLAN_SECTION_NAME })
        .getByText(/не пройдена \(жёстких конфликтов 1\)/),
    ).toBeVisible()
  })

  test('август: черновик → проверка → утверждение → замок → новая редакция', async ({ page }) => {
    await seedCredential(page)
    const header = await openMonthTab(page)
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    await expect(page.getByText('август 2026', { exact: true })).toBeVisible()

    await header.getByRole('button', { name: 'Сформировать черновик' }).click()
    await header.getByRole('button', { name: 'Проверить конфликты' }).click()
    await expect(header.getByRole('group', { name: 'Последняя проверка' })).toContainText(
      '— пройдена',
    )

    await header.getByRole('button', { name: 'Утвердить план' }).click()
    await expect(header.getByText('Утверждён', { exact: true })).toBeVisible()
    await expect(header.getByText(/изменения выполняются через новую редакцию/)).toBeVisible()
    // §21.28: у утверждённого месяца открыта ровно одна дверь.
    await expect(header.getByRole('button', { name: 'Открыть новую редакцию' })).toBeEnabled()
    await expect(header.getByRole('button', { name: 'Добавить дежурство' })).toBeDisabled()
    await expect(header.getByRole('button', { name: 'Проверить конфликты' })).toBeDisabled()

    // §21.27 «план фиксируется»: форма заведения смены на августовскую дату
    // получает отказ СЕРВЕРА. Это и есть проверка, что замок не декоративный.
    await page.getByRole('button', { name: 'По объектам' }).click()
    await page.getByRole('button', { name: 'Создать дежурство' }).click()
    const form = page.getByRole('group', { name: 'Форма нового дежурства' })
    await form.getByLabel('Дата дежурства').fill('2026-08-12')
    await form.getByLabel('Объект').selectOption({ label: 'Дворец Независимости (OBJ-001)' })
    await form.getByLabel('Пост').selectOption({ label: 'Сектор A · КПП-1' })
    await form.getByLabel('Сотрудник').selectOption('Абишев Н.')
    await form.getByRole('button', { name: 'Создать дежурство' }).click()
    await expect(form.getByText(/План месяца утверждён \(редакция 1\)/)).toBeVisible()
    // Смена НЕ создана — отказ настоящий, а не только текст.
    await expect(page.locator('tr', { hasText: '2026-08-12' })).toHaveCount(0)

    // Новая редакция возвращает месяц в работу, история не переписывается.
    await page.getByRole('button', { name: 'Месяц' }).click()
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
    const augustHeader = page.getByRole('region', { name: PLAN_SECTION_NAME })
    await augustHeader.getByRole('button', { name: 'Открыть новую редакцию' }).click()
    await expect(augustHeader.getByText('Черновик', { exact: true })).toBeVisible()
    await expect(augustHeader.getByRole('group', { name: 'Редакция' })).toContainText('2')
    // Новая редакция ещё не проверялась — прежний результат не перенесён.
    await expect(augustHeader.getByRole('group', { name: 'Последняя проверка' })).toHaveText(
      'Последняя проверкаПроверка конфликтов не проводилась',
    )

    await augustHeader.getByText('История плана (4)').click()
    const history = augustHeader.getByRole('listitem')
    await expect(history.filter({ hasText: 'Сформирован черновик' })).toBeVisible()
    await expect(history.filter({ hasText: 'План утверждён' })).toBeVisible()
    await expect(history.filter({ hasText: 'Открыта новая редакция' })).toBeVisible()
  })
})
