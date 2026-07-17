// Story 10.10 — E2E сдачи целиком (сценарий №3 жёсткого лимита 5, architecture
// L259): ЕДИНСТВЕННЫЙ спек против РЕАЛЬНОГО Django (project full-flow, гейт
// E2E_FULL — см. playwright.config.ts; бэк поднимает e2e/serve-backend.sh:
// compose-Postgres + migrate + сид vaps_e2e + runserver). Прод-сборка фронта
// (vite preview :4173) ходит в бэк через preview.proxy /api.
//
// Флоу: логин X-User-Id (реальная LoginPage, Д2) → /daily-expense: K=3
// отклонений + «Сохранить изменения» → панель сдачи: предпросмотр CHANGED →
// showModal-подтверждение → «сдано v1» → /organization: узел GREEN (текст/
// aria, не CSS-класс) → /reports: выпуск + скачивание .docx (PK-магия, Д3) →
// /print/expense: числа сходятся с введённым (та же БД, тот же derive).
//
// Константы ростера — КОНТРАКТ с сидом Backend/VAPS/scripts/e2e_seed.py
// (DIVISION_NAME, ростер 8, порядок sorted(full_name)): менять синхронно.
import { readFileSync } from 'node:fs'
import { expect, test, type CDPSession, type Page } from '@playwright/test'

// Зеркало сида e2e_seed.py.
const DIVISION_NAME = 'Отдел дежурной службы'
const ROSTER_SIZE = 8

// businessDate прогона = СЕГОДНЯ локальных суток машины (зеркало todayLocalIso
// фронта; Ловушка №4 — одна константа на весь прогон, полуночный старт — вне
// договорённостей стори). Машинный пояс == бизнес-поясу бэка (+05).
function todayLocalIso(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}
const BUSINESS_DATE = todayLocalIso()

// K=3 отклонения (Д4: ≥1 hard-типа — здесь ДВА: SICK_LEAVE и LEAVE_BY_REPORT).
// key — кириллический type-ahead-сид; label — ПЕРВАЯ опция каталога
// seed_statuses по префиксу (порядок Meta: priority, code): 'н' → «На
// больничном» (SICK_LEAVE, 10), 'о' → «Отпуск по рапорту» (LEAVE_BY_REPORT,
// 15), 'к' → «Конференция» (CONFERENCE, 36). Правятся ПЕРВЫЕ ТРИ строки грида
// (сортировка full_name): Абенов, Байжанов, Габитов.
const DEVIATIONS = [
  { key: 'н', label: 'На больничном', employee: 'Абенов Арман Серикович' },
  { key: 'о', label: 'Отпуск по рапорту', employee: 'Байжанов Даулет Муратович' },
  { key: 'к', label: 'Конференция', employee: 'Габитов Ержан Талгатович' },
] as const
const K = DEVIATIONS.length

// Ожидаемые 12 ячеек печатной формы в порядке DOCX_COLUMNS (expensePrint.ts):
// «В строю» = ростер − K (вчерашний DUTY-факт сида сегодня COMPLETED и в
// расход не попадает); SICK/VACATION/TRAINING — ровно введённое (LEAVE_BY_
// REPORT ложится в колонку VACATION, CONFERENCE — в TRAINING; report_column_
// code из seed_statuses); ATTACHED рендерится «+N».
const EXPECTED_PRINT_CELLS = [
  String(ROSTER_SIZE - K), // IN_SERVICE «В строю»
  '0', // ON_DUTY
  '0', // AFTER_DUTY
  '0', // COMMAND
  '1', // TRAINING ← CONFERENCE
  '1', // VACATION ← LEAVE_BY_REPORT
  '1', // SICK ← SICK_LEAVE
  '+0', // ATTACHED
  '0', // DETACHED
  '0', // BEFORE_DUTY
  '0', // OTHER
  '0', // PENDING
] as const

// Кириллический type-ahead — только через CDP Input.dispatchKeyEvent
// (keyboard.press('н') = Unknown key — инцидент 9.9). Осознанная копия
// хелпера daily-grid.spec.ts: импорт чужого спек-файла зарегистрировал бы
// его тесты в этом (top-level test() исполняется при импорте) — общий
// helpers-модуль = отдельный рефакторинг инфры, не эта стори.
const cdpSessions = new WeakMap<Page, CDPSession>()
async function getCdp(page: Page): Promise<CDPSession> {
  let session = cdpSessions.get(page)
  if (!session) {
    session = await page.context().newCDPSession(page)
    cdpSessions.set(page, session)
  }
  return session
}
async function pressCyr(page: Page, ch: string) {
  const cdp = await getCdp(page)
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: ch,
    text: ch,
  })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
}

test('сдача целиком: логин → отклонения → сдано v1 → GREEN → расход скачан → числа сходятся', async ({
  page,
}) => {
  // Полный стек: migrate/сид уже в webServer; сетевые POST/выпуск .docx —
  // реальные. Дефолтных 30с на весь сценарий мало.
  test.setTimeout(180_000)

  // --- Шаг 0: логин через реальную LoginPage (dev-путь X-User-Id 8.6) ---
  await page.goto('/login')
  await page
    .getByLabel('Идентификатор (X-User-Id)')
    .fill('e2e-operator')
  await page.getByRole('button', { name: 'Войти' }).click()
  // Успешный вход уводит на home (replace) — credential лёг в sessionStorage.
  await page.waitForURL('**/')

  // --- Шаг 1 (AC-1): /daily-expense — K отклонений + «Сохранить изменения» ---
  await page.goto('/daily-expense')
  await expect(
    page.getByRole('heading', { name: 'Расход дня' }),
  ).toBeVisible()
  // Дефолт date-input = сегодня (todayLocalIso экрана) — одна дата прогона.
  await expect(page.getByLabel('Дата')).toHaveValue(BUSINESS_DATE)
  // Грид смонтирован и сам сфокусировал активную ячейку (канон 9.9).
  await page.waitForFunction(() => {
    const active = document.activeElement
    return (
      active instanceof HTMLElement &&
      active.hasAttribute('data-active') &&
      active.closest('[data-grid-row]') !== null
    )
  })
  // Ростер реального сида: 8 строк, первая — Абенов (сортировка full_name).
  await expect(page.locator('[data-grid-row]')).toHaveCount(ROSTER_SIZE)

  // Слепой ввод сверху вниз: NAVIGATE+Char → EDIT+type-ahead (значение этим
  // же нажатием), EDIT+Enter → COMMIT + вниз (колонка «Статус» сохраняется).
  for (const deviation of DEVIATIONS) {
    await pressCyr(page, deviation.key)
    await page.keyboard.press('Enter')
  }
  // Значения легли в свои строки (привязка к ФИО, не к индексу DOM).
  for (const deviation of DEVIATIONS) {
    await expect(
      page.locator('[data-grid-row]', { hasText: deviation.employee }),
    ).toContainText(deviation.label)
  }

  await page
    .getByRole('button', { name: 'Сохранить изменения' })
    .click()
  // Счётчик из ОТВЕТА бэка (data.created, AC-6 10.2) — «→БД» шаг 1: bulk
  // реально создал K строк (число не из длины запроса — проба (а)).
  await expect(page.getByText(`Применено отклонений: ${K}`)).toBeVisible()

  // --- Шаг 2 (AC-2): панель сдачи — предпросмотр CHANGED → showModal → v1 ---
  const panel = page.getByTestId('day-submission-panel')
  // Автовыбор единственного подразделения + серверный previewEvent CHANGED
  // (вчерашний DUTY-факт сида + сегодняшние отклонения ≠ вчера).
  await expect(panel).toContainText('День не сдан.')
  await expect(panel).toContainText('Срез изменился против вчера.')
  await panel.getByRole('button', { name: 'Сдать день' }).click()

  const dialog = page.locator('dialog[open]')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Сдача дня — подтверждение')
  await expect(dialog).toContainText(
    `Применено отклонений за сессию: ${K}`,
  )
  // Реальный showModal (top-layer), не show — жёсткий дискриминатор 9.9.
  expect(
    await page.evaluate(
      () => document.querySelector('dialog[open]')?.matches(':modal') ?? false,
    ),
  ).toBe(true)
  await dialog.getByRole('button', { name: 'Подтвердить' }).click()

  // «Сдано» ИЗ 201-ответа (AC-8 10.3): событие CHANGED, версия 1.
  await expect(dialog).toHaveCount(0)
  await expect(panel).toContainText('День сдан: срез изменён')
  await expect(panel).toContainText('версия 1')

  // --- Шаг 3 (AC-3): /organization — узел GREEN без ожидания поллинга ---
  await page.goto('/organization')
  // Семантический текст-статус в aria-label узла (цвет не единственный
  // сигнал): «сдано и сходится» = GREEN (STATUS_META trafficTree.ts).
  // Регэксп терпит бейдж «, поздно» (контрольный час — не предмет стори).
  const greenNode = page.getByRole('group', {
    name: new RegExp(`^${DIVISION_NAME}: сдано и сходится`),
  })
  await expect(greenNode).toBeVisible()

  // --- Шаг 4 (AC-4): /reports — выпуск расхода + скачивание файла ---
  await page.goto('/reports')
  const divisionSelect = page.getByLabel('Подразделение')
  // Автовыбор единственного подразделения (деривация 10.5) — и это же
  // значение = division_id для печатной формы шага 5.
  await expect(divisionSelect).not.toHaveValue('')
  const divisionId = await divisionSelect.inputValue()
  await expect(page.getByLabel('Дата')).toHaveValue(BUSINESS_DATE)

  const currentCard = page.getByTestId('current-issue')
  await expect(currentCard).toContainText('Расход за дату не выпущен.')
  await currentCard.getByRole('button', { name: 'Сформировать' }).click()
  // Карточка из 201-ответа + журнал с «Исх.№» (инвалидация history).
  await expect(currentCard).toContainText(/Выпущен: Исх\.№ \d+\/\d{4}/)
  await expect(
    page
      .getByTestId('issues-journal')
      .locator('[data-testid^="issue-row-"]')
      .first(),
  ).toContainText(/Исх\.№ \d+\/\d{4}/)

  // Скачивание (download-канал 6.7 за document.view): реальное download-
  // событие браузера; файл валиден по Д3 — имя с .docx, ZIP-магия PK, размер.
  const downloadPromise = page.waitForEvent('download')
  await currentCard.getByRole('button', { name: 'Скачать .docx' }).click()
  const download = await downloadPromise
  const suggested = download.suggestedFilename()
  expect(suggested).not.toBe('')
  expect(suggested).toMatch(/\.docx$/)
  const downloadPath = await download.path()
  const bytes = readFileSync(downloadPath)
  expect(bytes.length).toBeGreaterThan(0)
  // docx = ZIP-контейнер: первые байты «PK» (0x50 0x4B). Глубокий парс
  // офисного формата — осознанно НЕ здесь (новая зависимость = policy-стоп).
  expect(bytes[0]).toBe(0x50)
  expect(bytes[1]).toBe(0x4b)

  // --- Шаг 5 (AC-5): /print/expense — числа из той же БД сходятся ---
  await page.goto(
    `/print/expense?division_id=${divisionId}&date=${BUSINESS_DATE}`,
  )
  const row = page.locator('tbody tr', { hasText: DIVISION_NAME })
  await expect(row).toBeVisible()
  const cells = row.locator('td')
  // Колонки: №, Управление, По штату, По списку, Вакансии, затем 12 статусных
  // (FIXED_HEAD + DOCX_COLUMNS, expensePrint.ts). «По списку» = ростер сида.
  await expect(cells.nth(3)).toHaveText(String(ROSTER_SIZE))
  for (const [index, expected] of EXPECTED_PRINT_CELLS.entries()) {
    await expect(cells.nth(5 + index)).toHaveText(expected)
  }
  // ИТОГО (литерально из totals бэка) — единственное подразделение: те же
  // числа, «По списку» = ростер.
  const totalsRow = page.locator('tfoot tr', { hasText: 'ИТОГО' })
  await expect(totalsRow.locator('td').nth(3)).toHaveText(String(ROSTER_SIZE))
})
