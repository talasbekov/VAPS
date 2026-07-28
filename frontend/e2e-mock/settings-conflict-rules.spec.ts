// Smart Josparlau E2E (§33, Этап 50): §29 «Настройки» — правила конфликтов,
// §21.35 «Отдых после дежурства».
//
// Главное, что здесь проверяется, — что администрирование НЕ декоративно:
// одно и то же назначение, отвергаемое с обходом (409 + ConflictDialog),
// после переключения режима в «Жёсткий запрет» отвергается БЕЗ обхода. Ни один
// unit-тест этого показать не может: он видит одну половину — либо репозиторий
// настроек, либо репозиторий дежурств, — а связь между ними идёт через общий
// demo-снапшот.
//
// Даты — КОНСТАНТЫ фикстур (сценарий стартует 2026-07-20T08:00+05:00):
// Нурланов Е. дежурит 27 и 28 июля, поэтому 29-е нарушает обязательный отдых.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { seedCredential } from './testUtils'

const REST_CONFLICT_DATE = '2026-07-29'
const PROTECTED_TYPE = 'Суточное дежурство на охраняемом объекте'

const REST_RULE_ROW = 'Режим обязательного отдыха после дежурства'
const OVERLAP_RULE_ROW = 'Режим пересечения дежурств'

async function openForm(page: Page): Promise<Locator> {
  await page.goto('/duties')
  await expect(page.getByRole('heading', { name: 'План дежурств' })).toBeVisible()
  await page.getByRole('button', { name: 'Создать дежурство' }).click()
  const form = page.getByRole('group', { name: 'Форма нового дежурства' })
  await expect(form).toBeVisible()
  return form
}

/** Заполняет форму назначением, попадающим в период обязательного отдыха. */
async function submitRestConflict(page: Page): Promise<void> {
  const form = await openForm(page)
  await form.getByLabel('Дата дежурства').fill(REST_CONFLICT_DATE)
  await form.getByLabel('Вид дежурства').selectOption({ label: PROTECTED_TYPE })
  await form.getByLabel('Объект').selectOption({ label: 'Дворец Независимости (OBJ-001)' })
  await form.getByLabel('Пост').selectOption({ label: 'Сектор A · КПП-1' })
  await form.getByLabel('Сотрудник').selectOption('Нурланов Е.')
  await form.getByRole('button', { name: 'Создать дежурство' }).click()
}

async function setRestMode(page: Page, optionLabel: string, reason: string): Promise<void> {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Настройки' })).toBeVisible()
  const row = page.locator('tr', { hasText: REST_RULE_ROW })
  await row.getByRole('button', { name: 'Изменить' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Режим').selectOption({ label: optionLabel })
  await dialog.getByLabel(/Причина изменения/).fill(reason)
  await dialog.getByRole('button', { name: 'Сохранить' }).click()
  await expect(dialog).toBeHidden()
}

test.describe('Правила конфликтов §29 (mock-режим)', () => {
  test('правка правила МЕНЯЕТ ИСХОД назначения: обход с обоснованием → отказ', async ({
    page,
  }) => {
    // 1. Действующий режим — мягкий: то же назначение предлагает обход.
    await submitRestConflict(page)
    await expect(page.getByText(/Конфликт:.*обязательного отдыха/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Подтвердить оверрайд' })).toBeVisible()

    // 2. Администратор ужесточает правило.
    await setRestMode(page, 'Жёсткий запрет', 'Ужесточение режима на период учений')

    // 3. То же самое назначение — теперь отказ БЕЗ обхода. Диалога нет вовсе:
    // §21.34 «hard-conflict нельзя обойти».
    await submitRestConflict(page)
    await expect(page.getByText(/обязательного отдыха/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Подтвердить оверрайд' })).toHaveCount(0)
  })

  test('версия правил растёт, а версия политики наблюдений — нет', async ({ page }) => {
    await page.goto('/settings')
    const versions = page.getByText(/Версия политики наблюдений/)
    await expect(versions).toContainText('conflict-rules-2026.07.1')

    await setRestMode(page, 'Жёсткий запрет', 'Проверка версионирования разделов')

    await expect(page.getByText(/Версия политики наблюдений/)).toContainText(
      'conflict-rules-2026.07.2',
    )
    // Методика наблюдений не менялась — её версия обязана остаться прежней.
    await expect(page.getByText(/Версия политики наблюдений/)).toContainText(
      'attention-policy-2026.07.1',
    )
  })

  test('§21.34: правило пересечения показано, но не редактируется НИКЕМ', async ({ page }) => {
    await page.goto('/settings')
    const row = page.locator('tr', { hasText: OVERLAP_RULE_ROW })
    await expect(row).toBeVisible()
    // Persona — demo-admin (wildcard): отказ вызван замком правила, а не правами.
    await expect(row.getByRole('button', { name: 'Изменить' })).toHaveCount(0)
    await expect(row).toContainText('hard-конфликт')
  })

  test('журнал §29 печатает подпись режима, причину и версию своего раздела', async ({ page }) => {
    await setRestMode(page, 'Жёсткий запрет', 'Ужесточение режима на период учений')

    const history = page.locator('section', { hasText: 'История изменений' })
    await expect(history).toContainText('Обход с обоснованием → Жёсткий запрет')
    await expect(history).toContainText('Ужесточение режима на период учений')
    await expect(history).toContainText('conflict-rules-2026.07.2')
  })
})

test.beforeEach(async ({ page }) => {
  await seedCredential(page)
})
