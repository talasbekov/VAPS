// Smart Josparlau E2E (§34 hardening, второй слой accessibility-аудита,
// продолжение Этапа 20/23 — FRONTEND_PROGRESS.md): первый проход (Этап 20)
// был ручным (Explore-агент + browser-QA), нашёл только form-контролы без
// accessible name. Второй слой — количественный, через axe-core: цветовой
// контраст, ARIA-корректность, структура landmarks/heading-порядок,
// дублирующиеся id и т.д. на КАЖДОМ реализованном экране (список — та же
// карта, что smart-josparlau-routing.qa.test.tsx использует для гейтов).
//
// Правило severity (см. FRONTEND_DECISIONS для номера решения): падаем ТОЛЬКО
// на 'critical'/'serious' — это категории axe, которые почти никогда не бывают
// ложными срабатываниями (contrast-ниже-порога, отсутствующий accessible name,
// сломанный ARIA-атрибут). 'moderate'/'minor' логируются в консоль теста для
// видимости, но не гейтят — иначе спека стала бы хрупкой к субъективным
// эвристикам axe (например landmark-unique на composed-страницах).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

const FAILING_IMPACT = new Set(['critical', 'serious'])

async function assertNoSeriousViolations(page: Page, screenLabel: string): Promise<void> {
  // Button/badge state changes use `transition-colors` (Tailwind default
  // 150ms) — sampling axe immediately after a click can catch a MID-transition
  // colour (e.g. half-faded bg-primary→transparent) and report a false
  // color-contrast violation for a value nobody actually sees. Settle first.
  //
  // Playwright's `.click()` leaves the mouse parked on the clicked element,
  // so axe would also measure the `:hover` variant of THAT element's colours
  // — a real CSS state, but not what "is this screen's resting content
  // accessible" is asking. Park the pointer away so we assess the settled
  // (non-hover) page, same as a keyboard user or someone who moved the mouse
  // away would see.
  await page.mouse.move(0, 0)
  await page.waitForTimeout(200)
  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter(
    (v) => v.impact !== null && v.impact !== undefined && FAILING_IMPACT.has(v.impact),
  )
  const rest = results.violations.filter((v) => !serious.includes(v))
  if (rest.length > 0) {
    console.log(
      `[axe:${screenLabel}] ${rest.length} moderate/minor находок (не гейтят):`,
      rest.map((v) => `${v.id} (${v.impact})`).join(', '),
    )
  }
  expect(
    serious,
    `[axe:${screenLabel}] critical/serious нарушения:\n${JSON.stringify(serious, null, 2)}`,
  ).toEqual([])
}

test.describe('Accessibility (axe-core): второй слой аудита по всем реализованным экранам (mock-режим)', () => {
  test('нет critical/serious нарушений на экранах верхнего уровня', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)

    const topLevelScreens: Array<[string, string]> = [
      ['/command-center', 'Командный центр'],
      ['/security-events', 'Реестр ОМ'],
      ['/employees', 'Сотрудники'],
      ['/objects', 'Объекты'],
      ['/duties', 'План дежурств (По объектам)'],
      ['/dictionaries', 'Справочники'],
      ['/calendar', 'Календарь смен'],
      ['/analytics', 'Аналитика службы'],
      ['/audit', 'Аудит'],
    ]

    for (const [path, label] of topLevelScreens) {
      await page.goto(path)
      await expect(page.locator('main, [role="main"]').first()).toBeVisible()
      await assertNoSeriousViolations(page, label)
    }
  })

  test('нет critical/serious нарушений на детальных/composed экранах', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)

    // Карточка сотрудника (§20.5 вкладки, Этап 23 клавиатурная навигация).
    await page.goto('/employees')
    await page.getByRole('link', { name: /Нуртаев/ }).click()
    await expect(page.getByRole('heading', { name: /Нуртаев/ })).toBeVisible()
    await assertNoSeriousViolations(page, 'Карточка сотрудника — вкладка Сводка')
    await page.getByRole('tab', { name: 'Назначения' }).click()
    await assertNoSeriousViolations(page, 'Карточка сотрудника — вкладка Назначения')

    // ОМ детальная страница (стадия PLACEMENT — форма расстановки, самая
    // насыщенная интерактивными контролами из всех 9 стадий).
    await page.goto('/security-events')
    await page.getByRole('link', { name: /Международный экономический форум/ }).click()
    await expect(
      page.getByRole('heading', { name: 'Международный экономический форум' }),
    ).toBeVisible()
    await assertNoSeriousViolations(page, 'ОМ — стадия Расстановка')

    // Паспорт объекта (формы секторов/постов).
    await page.goto('/objects')
    await page.getByRole('link', { name: /Дом Министерств/ }).click()
    await assertNoSeriousViolations(page, 'Паспорт объекта')

    // Справочник (таблица значений + форма создания).
    await page.goto('/dictionaries')
    await page.getByRole('link', { name: /Причины возврата на доработку/ }).click()
    await assertNoSeriousViolations(page, 'Справочник — значения')

    // Боевые группы и Трассы (третья вкладка DutyPlanPage — отдельный datasource).
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Боевые группы и Трассы' }).click()
    await assertNoSeriousViolations(page, 'План дежурств — Боевые группы и Трассы')
  })
})
