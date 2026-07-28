// Smart Josparlau E2E (§33) — вторая половина жизненного цикла ОМ (Этап 3):
// Согласование → Ознакомление → Проведение → Закрыто. До этой спеки цепочка
// была проверена ТОЛЬКО вручную через preview-инструмент (см. FRONTEND_TEST_
// MATRIX «Ручная браузерная проверка полного цикла ОМ»). Использует СЕЯНОЕ
// (не создаваемое в спеке) мероприятие «Городской спортивный форум» —
// единственный seed-объект в стадии APPROVAL (fixtures.ts), с ровно 1
// назначением на 1 пост, чтобы не дублировать Расстановку/Рекогносцировку.
// Проведение также включает замену выбывшего (§9.11, FRONTEND_DECISIONS
// A56, добавлено по запросу «продолжай разрабатывать») — seed-назначение
// «Ахметов Б.» (PERSONNEL_ROSTER[0], i=0 в assignedPostIndexes) заменяется
// на «Бекова А.».
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

test.describe('ОМ: Согласование → Ознакомление → Проведение → Закрыто (mock-режим)', () => {
  test('утверждение расстановки автоматически открывает Ознакомление, полный цикл до Закрыто', async ({
    page,
  }) => {
    await seedCredential(page)
    // Журнал штаба + итоги закрытия физически перекрывались бы DemoToolbar
    // (fixed bottom-4 right-4) на этой странице — см. testUtils.ts.
    await hideDemoToolbar(page)
    await page.goto('/security-events')
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible()

    await page
      .getByRole('row', { name: /Городской спортивный форум/ })
      .getByRole('link')
      .first()
      .click()

    await expect(
      page.getByRole('heading', { name: 'Согласование расстановки' }),
    ).toBeVisible()

    // Утверждение — ОДНА мутация, сразу переводит стадию в Ознакомление
    // (Epic 16.4→16.6, FRONTEND_DECISIONS A19) — без промежуточного клика.
    await page.getByRole('button', { name: 'Утвердить расстановку' }).click()
    await expect(page.getByRole('heading', { name: 'Ознакомление' })).toBeVisible()
    await expect(page.getByText('Ознакомлено: 0/1')).toBeVisible()

    await page.getByRole('button', { name: 'Отметить ознакомление' }).click()
    await expect(page.getByText('Ознакомлено: 1/1')).toBeVisible()

    const startConductButton = page.getByRole('button', { name: 'Начать проведение' })
    await expect(startConductButton).toBeEnabled()
    await startConductButton.click()

    await expect(page.getByRole('heading', { name: 'Проведение' })).toBeVisible()

    // Журнал штаба: одна запись типа «Инструктаж» (append-only, FRONTEND_
    // DECISIONS A22 — нет edit/delete)
    await page.getByLabel('Заголовок *').fill('E2E инструктаж')
    await page.getByLabel('Описание *').fill('Проведён инструктаж всех постов, замечаний нет.')
    await page.getByRole('button', { name: 'Добавить запись' }).click()
    await expect(page.getByText('Инструктаж перед началом').or(page.getByText('E2E инструктаж'))).toBeVisible()

    // §9.11 «Замена выбывшего сотрудника», сокращённо (A56) — ручной выбор,
    // атомарная замена + автоматическая запись в журнал типа «Замена».
    const replacementPanel = page.locator('section', { hasText: 'Замена выбывшего сотрудника' })
    await expect(replacementPanel.getByText('Ахметов Б.', { exact: false })).toBeVisible()
    await replacementPanel.getByRole('button', { name: 'Заменить' }).click()
    await replacementPanel.getByLabel('Кем заменить').selectOption('emp-2')
    await replacementPanel.getByLabel('Причина замены').fill('Заболел (E2E)')
    await replacementPanel.getByRole('button', { name: 'Подтвердить замену' }).click()
    await expect(replacementPanel.getByText('Бекова А.', { exact: false })).toBeVisible()
    await expect(replacementPanel.getByText('Ахметов Б.', { exact: false })).toHaveCount(0)
    await expect(page.getByText('Ахметов Б. → Бекова А.', { exact: false })).toBeVisible()

    await page.getByRole('button', { name: 'Закрыть мероприятие' }).click()
    await expect(page.getByText('Итоги по направлениям (обязательны все)')).toBeVisible()

    // Итог обязателен ПО КАЖДОМУ направлению (Epic 18.1 FR-30) — у seed-события
    // ровно один сектор «A»; getByLabel — точный локатор (label htmlFor=
    // closure-direction-A), а не позиционный `.last()` среди ВСЕХ textarea.
    await page.getByLabel('A *').fill('Направление A отработано штатно, инцидентов нет (E2E).')
    await page.getByRole('button', { name: 'Подтвердить закрытие' }).click()

    await expect(page.getByRole('heading', { name: 'Закрыто' })).toBeVisible()
    await expect(page.getByText(/Мероприятие закрыто/)).toBeVisible()

    // Persist-through-reload: закрытая стадия — терминальная, должна пережить перезагрузку.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Закрыто' })).toBeVisible()
    await expect(
      page.getByText('Направление A отработано штатно, инцидентов нет (E2E).'),
    ).toBeVisible()

    // Реестр отражает Закрыто сразу после закрытия (без ручного refetch).
    await page.goto('/security-events')
    await expect(
      page.getByRole('row', { name: /Городской спортивный форум/ }).getByText('Закрыто'),
    ).toBeVisible()

    // «Архив дела» (прототип Smart Josparlau.dc.html:1459): вход появляется в
    // шапке ТОЛЬКО у закрытого ОМ, дело собрано из накопленных стадиями фактов
    // и открыто строго read-only.
    await page
      .getByRole('row', { name: /Городской спортивный форум/ })
      .getByRole('link')
      .first()
      .click()
    await page.getByRole('link', { name: 'Архив дела' }).click()

    await expect(
      page.getByRole('heading', { name: /Архив дела · ОМ-/ }),
    ).toBeVisible()
    await expect(page.getByText('read-only')).toBeVisible()
    // Итог закрытия, запись журнала и замена состава — три разных раздела дела.
    await expect(
      page.getByText('Направление A отработано штатно, инцидентов нет (E2E).'),
    ).toBeVisible()
    await expect(page.getByText('E2E инструктаж')).toBeVisible()
    await expect(page.getByText('Ахметов Б. → Бекова А.', { exact: false })).toBeVisible()
    // Read-only как свойство экрана, а не пожелание: ни одной кнопки/поля.
    // Локатор сужен до `<main>` СОЗНАТЕЛЬНО: кнопки каркаса AppLayout (шапка
    // портала) к делу не относятся, а `page.getByRole('button')` их считает —
    // ассерт был бы про каркас, а не про архив.
    const caseBody = page.locator('main')
    await expect(caseBody.getByRole('button')).toHaveCount(0)
    await expect(caseBody.getByRole('textbox')).toHaveCount(0)
    await expect(caseBody.getByRole('combobox')).toHaveCount(0)
  })

  test('незакрытое ОМ: дело не открывается, причина названа', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)
    await page.goto('/security-events')

    // «Международный экономический форум» — seed-событие в стадии Расстановка.
    await page
      .getByRole('row', { name: /Международный экономический форум/ })
      .getByRole('link')
      .first()
      .click()
    await expect(page.getByRole('heading', { name: /Расстановка/ }).first()).toBeVisible()
    // Входа в архив в шапке нет — до закрытия дела не существует.
    await expect(page.getByRole('link', { name: 'Архив дела' })).toHaveCount(0)

    // Прямой переход по URL тоже не показывает дело — отказ с причиной.
    await page.goto(`${page.url()}/archive`)
    await expect(
      page.getByText(/Дело откроется после закрытия мероприятия/),
    ).toBeVisible()
    await expect(page.getByText('Итоги закрытия')).toHaveCount(0)
  })
})
