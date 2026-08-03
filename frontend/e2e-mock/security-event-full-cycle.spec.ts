// Smart Josparlau E2E (Этап 72): ПОЛНЫЙ цикл нового ОМ — от «Создать ОМ» до
// «Закрыто» БЕЗ сеяных подпорок. Ручное тестирование провалилось ровно здесь:
// перехода BULLETIN → RECON не существовало вовсе, свежесозданное мероприятие
// навсегда застревало на этапе 1 — а ни одна e2e-спека этого не видела,
// потому что все стартовали с СЕЯНЫХ мероприятий, уже стоящих на поздних
// стадиях. Эта спека закрывает дыру: каждый переход проходится живьём.
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

test.describe('ОМ: полный цикл нового мероприятия (mock-режим)', () => {
  test('создать → бюллетень → рекогносцировка → потребность → силы → расстановка → согласование → ознакомление → проведение → закрыто', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/security-events')
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible()

    // ЭТАП 0: создание.
    await page.getByRole('button', { name: '+ Создать ОМ' }).click()
    const dialog = page.getByRole('dialog')
    const title = `Полный цикл E2E ${Date.now()}`
    await dialog.getByLabel('Название').fill(title)
    await dialog.getByLabel('Объект').selectOption({ label: 'OBJ-001 · Дворец Независимости' })
    await dialog.getByLabel('Дата проведения').fill('2026-07-27')
    await dialog.getByRole('button', { name: 'Создать' }).click()
    await expect(page.getByRole('heading', { name: title })).toBeVisible()

    // ЭТАП 1: бюллетень. Пустой не завершается — сервер отвечает словами.
    await page
      .getByRole('button', { name: 'Завершить этап и начать рекогносцировку' })
      .click()
    await expect(
      page.getByText(/Заполните и сохраните описание и первичные задачи/),
    ).toBeVisible()

    await page.locator('textarea').first().fill('Полный цикл: краткое описание')
    await page.locator('textarea').nth(1).fill('Полный цикл: первичные задачи')
    await page.getByRole('button', { name: 'Сохранить бюллетень' }).click()
    await expect(page.getByRole('button', { name: 'Сохранить бюллетень' })).toBeDisabled()

    await page
      .getByRole('button', { name: 'Завершить этап и начать рекогносцировку' })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Рекогносцировка объекта' }),
    ).toBeVisible()

    // ЭТАП 2: рекогносцировка — чек-лист целиком + один пост расчёта.
    const checkboxes = page.getByRole('checkbox')
    const count = await checkboxes.count()
    for (let i = 0; i < count; i += 1) {
      const box = checkboxes.nth(i)
      if (!(await box.isChecked())) await box.check()
    }
    await page.getByRole('button', { name: '+ Добавить пост' }).click()
    const postRow = page.locator('table tbody tr').first()
    await postRow.locator('input').first().fill('A')
    await postRow.locator('input').nth(1).fill('Главный вход')
    await page.getByRole('button', { name: 'Сохранить расчёт' }).click()
    const completeRecon = page.getByRole('button', { name: 'Завершить этап и перейти далее' })
    await expect(completeRecon).toBeEnabled()
    await completeRecon.click()

    // ЭТАП 3: потребность.
    await expect(
      page.getByRole('heading', { name: 'Потребность и выделение сил' }),
    ).toBeVisible()
    await page.getByRole('button', { name: '+ Добавить потребность' }).click()
    const demandRow = page.locator('table tbody tr').first()
    await demandRow.locator('input').first().fill('A')
    await demandRow.locator('input').nth(1).fill('Досмотр')
    await page.getByRole('button', { name: 'Сохранить и утвердить потребность' }).click()

    // ЭТАП 4: запрос сил — выделить полностью.
    await expect(page.getByText('2 · Выделение сил')).toBeVisible()
    await page.locator('input[type="number"]').fill('1')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Выделено')).toBeVisible()
    await page.getByRole('button', { name: 'Завершить этап и перейти далее' }).click()

    // ЭТАП 5: расстановка — назначить сотрудника на пост.
    await expect(page.getByRole('heading', { name: 'Расстановка' })).toBeVisible()
    await page.getByRole('button', { name: /A · Главный вход/ }).click()
    // Ерланов Д. (employee-1): рейтинг 8,6 — назначение без конфликта.
    await page.getByRole('combobox').selectOption({ value: 'employee-1' })
    await page.getByRole('button', { name: 'Назначить' }).click()
    const postPanel = page.getByRole('region', { name: 'Назначения поста' })
    await expect(postPanel.getByText('Ерланов Д.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Завершить этап и перейти далее' }).click()

    // ЭТАП 6: согласование → утверждение открывает Ознакомление.
    await expect(
      page.getByRole('heading', { name: 'Согласование расстановки' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Утвердить расстановку' }).click()

    // ЭТАП 7: ознакомление.
    await expect(page.getByRole('heading', { name: 'Ознакомление' })).toBeVisible()
    await page.getByRole('button', { name: 'Отметить ознакомление' }).click()
    await expect(page.getByText('Ознакомлено: 1/1')).toBeVisible()
    await page.getByRole('button', { name: 'Начать проведение' }).click()

    // ЭТАП 8: проведение → закрытие с обязательным итогом направления.
    await expect(page.getByRole('heading', { name: 'Проведение' })).toBeVisible()
    await page.getByRole('button', { name: 'Закрыть мероприятие' }).click()
    await expect(page.getByText('Итоги по направлениям (обязательны все)')).toBeVisible()
    await page.getByLabel('A *').fill('Полный цикл: направление A отработано, замечаний нет.')
    await page.getByRole('button', { name: 'Подтвердить закрытие' }).click()

    // ЭТАП 9: закрыто — терминальная стадия переживает перезагрузку.
    await expect(page.getByRole('heading', { name: 'Закрыто' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Закрыто' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Архив дела' })).toBeVisible()
  })
})
