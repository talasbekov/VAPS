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
      rest
        .map(
          (v) =>
            `${v.id} (${v.impact}) — ${v.nodes.map((n) => `[${n.target.join(' ')}] ${n.html}`).join(' | ')}`,
        )
        .join(' ;;; '),
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
      ['/analytics/operations', 'Аналитика мероприятий'],
      ['/audit', 'Аудит'],
    ]

    for (const [path, label] of topLevelScreens) {
      await page.goto(path)
      // Routes are React.lazy-code-split (RouteChunkBoundary, §5.2) — `main`
      // становится visible СРАЗУ через Suspense-фолбэк «Загрузка раздела…»,
      // раньше, чем догрузится реальный chunk с h1. Ждать нужно h1, а не
      // просто наличие каркаса `main` — иначе axe сканирует фолбэк-состояние
      // и ложно репортит page-has-heading-one (найдено этим же аудитом).
      await expect(page.locator('h1').first()).toBeVisible()
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

    // Форма создания дежурства (§21.31). Она СВЁРНУТА по умолчанию — сканируя
    // /duties как экран верхнего уровня, axe её не видит вовсе; раскрываем
    // явно, иначе покрытие было бы мнимым.
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Создать дежурство' }).click()
    const createForm = page.getByRole('group', { name: 'Форма нового дежурства' })
    await expect(createForm).toBeVisible()
    await createForm.getByLabel('Объект').selectOption({ label: 'Дворец Независимости (OBJ-001)' })
    // С выбранным объектом появляется селект поста — без выбора часть контролов
    // формы просто не отрендерена и сканирование было бы неполным.
    await expect(createForm.getByLabel('Пост')).toBeVisible()
    await assertNoSeriousViolations(page, 'План дежурств — форма создания дежурства')

    // Карточка дежурства (§21.32) — свой маршрут, сканированием /duties не
    // покрыт. Берём смену с конфликтом: цветные бейджи severity — ровно тот
    // класс разметки, где прошлые проходы находили contrast-нарушения.
    await page.goto('/duties')
    await page.locator('tr', { hasText: 'Жумабаев Р.' }).first().getByRole('link').click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await assertNoSeriousViolations(page, 'Карточка дежурства')

    // Матрица доступности §21.30 — новая таблица, где значение клетки несут
    // ЦВЕТОВЫЕ слои: контраст и наличие текстовой альтернативы здесь важнее,
    // чем где-либо ещё на экране.
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Месяц' }).click()
    await page.getByRole('button', { name: 'Сотрудники × дни' }).click()
    await expect(page.getByText('Слои, которых нет в модели')).toBeVisible()
    await assertNoSeriousViolations(page, 'Месячный план — матрица по сотрудникам')

    // Список дежурств §21.30 — ещё одна широкая таблица в прокручиваемой
    // области, тот же класс разметки, где нашёлся scrollable-region-focusable.
    await page.goto('/duties')
    await page.getByRole('button', { name: 'Список' }).click()
    await expect(page.getByText('Колонки, которых нет в модели')).toBeVisible()
    await assertNoSeriousViolations(page, 'План дежурств — список дежурств')

    // История отчётов §22.25 — сканируется СО СТРОКОЙ и раскрытыми
    // параметрами: пустая история не содержит ни таблицы, ни кнопок действий,
    // и покрытие было бы мнимым (тот же урок, что форма создания дежурства).
    await page.goto('/service-reports')
    const reportForm = page.getByRole('group', { name: 'Форма запуска отчёта' })
    await reportForm.getByLabel('Начало периода').fill('2026-07-01')
    await reportForm.getByLabel('Конец периода').fill('2026-07-31')
    await reportForm.getByRole('button', { name: 'Сформировать отчёт' }).click()
    await expect(page.getByText('Готов', { exact: true })).toBeVisible({ timeout: 10_000 })
    await assertNoSeriousViolations(page, 'Отчёты службы — запуск и артефакт')

    await page.getByRole('link', { name: 'История отчётов →' }).click()
    await page.getByRole('button', { name: 'Открыть параметры' }).click()
    await expect(page.getByText('Ключ идемпотентности')).toBeVisible()
    await assertNoSeriousViolations(page, 'История отчётов — строка с параметрами')

    // Карточка работы §22.27 — сканируется у ГОТОВОЙ работы: у незавершённой
    // нет ни метаданных артефакта, ни включённых кнопок действий, и покрытие
    // было бы мнимым.
    await page.getByRole('link', { name: 'Расход личного состава' }).first().click()
    await expect(page.getByText('ваш запуск')).toBeVisible()
    await assertNoSeriousViolations(page, 'Карточка работы отчёта')
  })
})
