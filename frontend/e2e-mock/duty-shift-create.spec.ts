// Smart Josparlau E2E (§33, Этап 32): §21.31 «Создание дежурства», §21.33
// «Подбор кандидатов», §21.34 «Конфликты».
//
// До этого среза индивидуальные смены существовали ТОЛЬКО из demo-сида — ни
// один e2e не проходил через их ЗАВЕДЕНИЕ. Спека закрывает разрыв целиком:
// доступность объекта по паспорту → создание со снимком поста → hard-конфликт
// (отказ) → soft-конфликт (обход через общий ConflictDialog).
//
// Даты — КОНСТАНТЫ фикстур, а не арифметика в рантайме: demo-сценарий стартует
// с фиксированного DEFAULT_SCENARIO_START_ISO = 2026-07-20T08:00+05:00
// (features/duties/mocks/fixtures.ts раскладывает смены на +2/+4/+5/+7/+8).
//
// ⚠️ Все поля ищутся ВНУТРИ группы «Форма нового дежурства»: у панели persona
// (DemoToolbar) есть свои селекты, и поиск по всей странице цепляет их тоже.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { seedCredential } from './testUtils'

/** Нурланов Е. несёт дежурства на охраняемом объекте 2026-07-27 и 2026-07-28 —
 * соседний день даёт нарушение обязательного отдыха с политикой SOFT_OVERRIDE. */
const REST_CONFLICT_DATE = '2026-07-29'

const PROTECTED_TYPE = 'Суточное дежурство на охраняемом объекте'
const OWN_TYPE = 'Суточное дежурство на собственном объекте'

async function openForm(page: Page): Promise<Locator> {
  await page.goto('/duties')
  await expect(page.getByRole('heading', { name: 'План дежурств' })).toBeVisible()
  await page.getByRole('button', { name: 'Создать дежурство' }).click()
  const form = page.getByRole('group', { name: 'Форма нового дежурства' })
  await expect(form).toBeVisible()
  return form
}

test.describe('Создание индивидуального дежурства (§21.31/§21.33/§21.34, mock-режим)', () => {
  test('§21.31: причина недоступности объекта названа и зависит от ВИДА дежурства', async ({
    page,
  }) => {
    const form = await openForm(page)

    // Охраняемый объект требует актуального паспорта (requiresCurrentPassport).
    await form.getByLabel('Вид дежурства').selectOption({ label: PROTECTED_TYPE })
    const objectSelect = form.getByLabel('Объект')
    await expect(objectSelect.getByRole('option', { name: /Астана Арена/ })).toHaveText(
      /недоступен/,
    )
    await objectSelect.selectOption({ label: 'Астана Арена (OBJ-003) — недоступен' })
    await expect(form.getByText(/Паспорт объекта в красном состоянии/)).toBeVisible()
    // Поста нет — выбирать не из чего, создание заблокировано.
    await expect(form.getByLabel('Пост')).toHaveCount(0)
    await expect(form.getByRole('button', { name: 'Создать дежурство' })).toBeDisabled()

    // Тот же объект под видом, НЕ требующим актуального паспорта: правило
    // «красный паспорт» отваливается, и остаётся ДРУГАЯ причина — у «Астана
    // Арена» паспорт вообще не публиковали. Причины не схлопываются в одну.
    await form.getByLabel('Вид дежурства').selectOption({ label: OWN_TYPE })
    await objectSelect.selectOption({ label: 'Астана Арена (OBJ-003) — недоступен' })
    await expect(form.getByText(/нет опубликованной версии паспорта/)).toBeVisible()
    await expect(form.getByText(/Паспорт объекта в красном состоянии/)).toHaveCount(0)
  })

  test('создаёт дежурство со снимком поста, примечанием и занятостью кандидата', async ({
    page,
  }) => {
    const form = await openForm(page)

    // §21.33: занятость приходит из реальных смен, а не выдумана — оба исхода.
    await expect(
      form.getByRole('option', { name: /Ерланов Д\..*уже назначен на эту дату/ }),
    ).toBeAttached()
    await expect(
      form.getByRole('option', { name: /Сейтказы М\..*ближайшее дежурство 2026-07-24/ }),
    ).toBeAttached()
    await expect(
      form.getByRole('option', { name: /Абишев Н\..*ближайших дежурств нет/ }),
    ).toBeAttached()

    await form.getByLabel('Объект').selectOption({ label: 'Дворец Независимости (OBJ-001)' })
    await expect(form.getByText(/Паспорт: ред\. 1 от /)).toBeVisible()
    await form.getByLabel('Пост').selectOption({ label: 'Сектор A · КПП-1' })
    await expect(form.getByText(/Задача: Контроль въезда\/выезда/)).toBeVisible()
    await form.getByLabel('Сотрудник').selectOption('Абишев Н.')
    await form.getByLabel(/Примечание/).fill('Усиление на период визита')
    await form.getByRole('button', { name: 'Создать дежурство' }).click()

    const newRow = page.locator('tr', { hasText: 'Абишев Н.' })
    await expect(newRow).toBeVisible()
    await expect(newRow.getByText('Сектор A · КПП-1')).toBeVisible()
    await expect(newRow.getByText('Усиление на период визита')).toBeVisible()
    await expect(newRow.getByText('Запланировано')).toBeVisible()

    // Персистентность через reload — смена в IndexedDB, а не в state страницы.
    await page.reload()
    await expect(
      page.locator('tr', { hasText: 'Абишев Н.' }).getByText('Сектор A · КПП-1'),
    ).toBeVisible()
  })

  test('§21.34 HARD: второе дежурство сотрудника в тот же день отклоняется без обхода', async ({
    page,
  }) => {
    const form = await openForm(page)

    await form.getByLabel('Объект').selectOption({ label: 'Дворец Независимости (OBJ-001)' })
    await form.getByLabel('Пост').selectOption({ label: 'Сектор A · КПП-1' })
    // Ерланов Д. уже дежурит 2026-07-20 (дата формы по умолчанию).
    await form.getByLabel('Сотрудник').selectOption('Ерланов Д.')
    await form.getByRole('button', { name: 'Создать дежурство' }).click()

    await expect(form.getByText(/Ерланов Д\.: 2 дежурства в один день/)).toBeVisible()
    // Жёсткий конфликт НЕ предлагает обход — диалога обоснования нет.
    await expect(page.getByRole('button', { name: 'Подтвердить оверрайд' })).toHaveCount(0)
  })

  test('§21.34 SOFT: нарушение отдыха обходится через общий ConflictDialog', async ({ page }) => {
    const form = await openForm(page)

    await form.getByLabel('Дата дежурства').fill(REST_CONFLICT_DATE)
    await form.getByLabel('Вид дежурства').selectOption({ label: PROTECTED_TYPE })
    await form.getByLabel('Объект').selectOption({ label: 'Дворец Независимости (OBJ-001)' })
    await form.getByLabel('Пост').selectOption({ label: 'Сектор A · КПП-1' })
    await form.getByLabel('Сотрудник').selectOption('Нурланов Е.')
    await form.getByRole('button', { name: 'Создать дежурство' }).click()

    await expect(page.getByText(/Конфликт:.*обязательного отдыха/)).toBeVisible()
    await page.getByLabel(/Причина/).fill('Некем заменить, приказ №5')
    await page.getByRole('button', { name: 'Подтвердить оверрайд' }).click()

    const newRow = page.locator('tr', { hasText: REST_CONFLICT_DATE })
    await expect(newRow).toBeVisible()
    // Обоснование сохранено СЛЕДОМ в данных, а не осталось в диалоге.
    await expect(newRow.getByText('Конфликт обойдён: Некем заменить, приказ №5')).toBeVisible()
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
