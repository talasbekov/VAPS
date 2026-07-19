// Story 10.3 (QA-добор, workflow qa-generate-e2e-tests) — e2e ритуала сдачи дня
// в РЕАЛЬНОМ chromium против прод-сборки харнеса (порт 4174, dist-e2e).
//
// Зачем это поверх 30 jsdom-тестов панели. Стори осознанно выбрала инлайн-панель
// вместо модалки именно потому, что «модальность в jsdom не эмулируется — ассерт
// был бы вакуумным» (Решение №5). Тот же аргумент бьёт по трём другим местам,
// и закрыть их может только настоящий браузер:
//   1) порядок табуляции — jsdom его не вычисляет, а ИМИТИРУЕТ (userEvent.tab
//      обходит свой список кандидатов); AC-11 требует проходимости панели
//      клавиатурой ЦЕЛИКОМ;
//   2) `disabled` на кнопке подтверждения во время полёта запроса — второй из
//      двух рубежей AC-6, и красная проба стори (№3a/3b) показала, что порознь
//      они не различимы;
//   3) отсутствие <dialog> при 409 — в jsdom его нет и не могло бы быть, ассерт
//      проходил бы на любой реализации.
//
// Чего здесь НЕТ и почему: живого бэкенда. Это НЕ стори 10.10 («E2E сдачи
// целиком» — compose-окружение, светофор 10.4, скачивание расхода): её
// пререквизит 10.3a (HTTP-роут светофора) ещё не существует. Здесь сеть
// перехвачена page.route — но перехвачена НА УРОВНЕ БРАУЗЕРА: fetch настоящий,
// статусы настоящие, конверт §36 разбирает боевой parseErrorResponse.
import { expect, test, type Locator, type Page } from '@playwright/test'

// Абсолютный URL: глобальный baseURL (4173) принадлежит print-спекам 8.8.
const HARNESS = 'http://localhost:4174/e2e-harness/day-submission.html'

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'

/** Кириллица во всех фикстурах — урок E9: латиница даёт зелёный тест на сломанном. */
const NAMES = [
  'Абдуллаев Асхат Маратович',
  'Бекова Гульмира Ержановна',
  'Валиев Тимур Русланович',
]

const divisionsBody = {
  count: 1,
  next: null,
  previous: null,
  results: [
    {
      id: DIVISION_ID,
      organization: 'aa11bb22-cc33-dd44-ee55-ff6677889900',
      type_code: 'DEPARTMENT',
      name: 'Первый отдел',
      code: 'DIV-1',
    },
  ],
}

const employeesBody = {
  count: NAMES.length,
  next: null,
  previous: null,
  results: NAMES.map((full_name, i) => ({
    id: `emp-${i}`,
    full_name,
    division: DIVISION_ID,
    position_code: 'POS-1',
    rank_code: 'RANK-1',
  })),
}

/** Локальное «сегодня» браузера — окно сдачи считает клиент (AC-5). */
function todayIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function submissionFixture(over: Record<string, unknown> = {}) {
  return {
    id: 77,
    division_id: DIVISION_ID,
    business_date: todayIso(),
    version: 1,
    is_current: true,
    event: 'CHANGED',
    submitted_by: 'operator-1',
    submitted_at: '2026-07-19T08:15:00+05:00',
    late: false,
    ...over,
  }
}

function errorEnvelope(
  errorCode: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return {
    error_code: errorCode,
    message,
    details,
    request_id: 'req-e2e-10-3',
    timestamp: '2026-07-19T08:00:00+05:00',
  }
}

interface Stub {
  /** Строки, которыми отвечает GET состояния дня/истории. */
  dayRows?: Record<string, unknown>[]
  /** Ответ POST сдачи; по умолчанию — 201 с текущей сдачей. */
  submitStatus?: number
  submitBody?: unknown
  /** Задержка ответа POST (мс) — для проверки рубежа `disabled` в полёте. */
  submitDelayMs?: number
}

interface Traffic {
  submits: Record<string, unknown>[]
  bulks: Record<string, unknown>[]
}

/**
 * Перехват сети НА УРОВНЕ БРАУЗЕРА. Один обработчик на путь daily-submissions:
 * GET (состояние дня + история подразделения) и POST (сдача) различаются
 * методом — как на настоящем ViewSet.
 */
async function stubApi(page: Page, stub: Stub = {}): Promise<Traffic> {
  const traffic: Traffic = { submits: [], bulks: [] }
  const rows = stub.dayRows ?? []

  await page.route('**/api/core/divisions/**', (route) =>
    route.fulfill({ json: divisionsBody }),
  )
  await page.route('**/api/core/employees/**', (route) =>
    route.fulfill({ json: employeesBody }),
  )
  await page.route('**/api/operations/statuses/bulk/**', async (route) => {
    traffic.bulks.push(JSON.parse(route.request().postData() ?? 'null'))
    await route.fulfill({ status: 201, json: { created: 1 } })
  })
  await page.route('**/api/operations/daily-submissions/**', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') {
      await route.fulfill({
        json: { count: rows.length, next: null, previous: null, results: rows },
      })
      return
    }
    traffic.submits.push(JSON.parse(request.postData() ?? 'null'))
    if (stub.submitDelayMs) {
      // Настоящее ожидание сети: рубеж `disabled` существует только в полёте.
      await new Promise((resolve) => setTimeout(resolve, stub.submitDelayMs))
    }
    await route.fulfill({
      status: stub.submitStatus ?? 201,
      json: stub.submitBody ?? submissionFixture(),
    })
  })
  return traffic
}

/** Экран + выбор подразделения: до него грида и состояния дня нет. */
async function openScreen(page: Page) {
  await page.goto(HARNESS)
  await page.getByLabel('Подразделение').selectOption(DIVISION_ID)
  await expect(page.getByTestId('changed-counter')).toBeVisible()
}

/**
 * НАСТОЯЩАЯ последовательная табуляция браузера (jsdom её только имитирует).
 * Возвращает число нажатий; бросает, если фокус до цели не дошёл — «где-то»
 * фокус нас не устраивает (урок 9.9: activeElement в никуда даёт зелёный).
 */
async function tabUntilFocused(page: Page, target: Locator, limit = 15) {
  for (let pressed = 0; pressed <= limit; pressed += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return pressed
    await page.keyboard.press('Tab')
  }
  throw new Error(`Фокус не дошёл до элемента за ${limit} нажатий Tab`)
}

/** Правка статуса текущей строки грамматикой грида (Enter → выбор → Enter). */
async function editFirstRow(page: Page, code: string) {
  await page.locator('[data-grid-row]').first().click()
  await page.keyboard.press('Enter')
  await page.getByLabel('Статус').selectOption(code)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('changed-counter')).toHaveText(/Изменено 1 из 3/)
}

test('ритуал сдачи проходится КЛАВИАТУРОЙ целиком: Tab → Enter → подтверждение → «День сдан»', async ({
  page,
}) => {
  const traffic = await stubApi(page)
  await openScreen(page)

  const submitDay = page.getByRole('button', { name: 'Сдать день' })
  await expect(page.getByText('День не сдан')).toBeVisible()

  // Стартуем от поля даты — дальше только настоящая табуляция браузера.
  await page.getByLabel('Дата').focus()
  await tabUntilFocused(page, submitDay)
  await expect(submitDay).toBeFocused()
  await page.keyboard.press('Enter')

  // Канон-строка подтверждения (EXPERIENCE.md#L116) — дословно.
  await expect(
    page.getByText('Сдать день? Изменено 0 из 3. После сдачи лист станет зелёным.'),
  ).toBeVisible()

  const confirm = page.getByRole('button', { name: 'Подтвердить сдачу' })
  await tabUntilFocused(page, confirm)
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('day-submission-state')).toContainText('День сдан')
  expect(traffic.submits).toHaveLength(1)
  // Тело — СТРОГО два поля (ARCH-SEC-030: submitted_by бэк игнорирует).
  expect(Object.keys(traffic.submits[0]).sort()).toEqual([
    'business_date',
    'division_id',
  ])
  // Кнопка сдачи со сданного дня уходит — обманки «сдать ещё раз» нет.
  await expect(submitDay).toHaveCount(0)
})

test('AC-6: пока запрос в полёте, кнопка подтверждения РЕАЛЬНО недоступна → ровно один POST', async ({
  page,
}) => {
  // Второй рубеж AC-6. В jsdom он не отличим от программного гарда (красная
  // проба стори, №3a/3b: userEvent не кликает disabled-кнопку, и снятие одного
  // рубежа не краснеет). Настоящий браузер проверяет именно DOM-атрибут.
  const traffic = await stubApi(page, { submitDelayMs: 1200 })
  await openScreen(page)

  await page.getByRole('button', { name: 'Сдать день' }).click()
  const confirm = page.getByRole('button', { name: 'Подтвердить сдачу' })
  await confirm.click()

  await expect(page.getByText('Отправка…')).toBeVisible()
  await expect(confirm).toBeDisabled()
  // Реальный клик по disabled-кнопке браузер не доставит — force обходит
  // проверку actionability и бьёт по элементу, как это сделал бы упрямый
  // пользователь; второго POST всё равно быть не должно.
  await confirm.click({ force: true })

  await expect(page.getByTestId('day-submission-state')).toContainText('День сдан')
  expect(traffic.submits).toHaveLength(1)
})

test('AC-8: 409 → путь пересдачи назван, модального диалога в браузере НЕТ', async ({
  page,
}) => {
  // В jsdom «<dialog> отсутствует» — вакуум: модальности там нет в принципе.
  // Здесь <dialog> настоящий, и его отсутствие что-то значит.
  const traffic = await stubApi(page, {
    submitStatus: 409,
    submitBody: errorEnvelope(
      'DAY_ALREADY_SUBMITTED',
      'Подразделение уже сдало этот день.',
      { division_id: DIVISION_ID, business_date: todayIso() },
    ),
  })
  await openScreen(page)

  await page.getByRole('button', { name: 'Сдать день' }).click()
  await page.getByRole('button', { name: 'Подтвердить сдачу' }).click()

  await expect(page.getByTestId('day-submission-failure')).toContainText(
    'День уже сдан. Пересдача — через исправление (amendment).',
  )
  expect(traffic.submits).toHaveLength(1)
  // DAY_ALREADY_SUBMITTED нет в OVERRIDABLE_CODES ⇒ ConflictDialog не поднимется.
  await expect(page.locator('dialog')).toHaveCount(0)
  // И поля причины оверрайда тоже нет — amendment это 10.6, не здесь.
  await expect(page.getByLabel(/причин/i)).toHaveCount(0)
})

test('AC-4/AC-11: несохранённые правки блокируют сдачу, а Ctrl+Enter из панели их СОХРАНЯЕТ', async ({
  page,
}) => {
  const traffic = await stubApi(page)
  await openScreen(page)

  await editFirstRow(page, 'VACATION')

  // AC-4: блокировка инвариантная — submit_day снял бы снапшот с СЕРВЕРНОГО
  // состояния, и оператор сдал бы не то, что видит.
  const submitDay = page.getByRole('button', { name: 'Сдать день' })
  await submitDay.click()
  await expect(page.getByText('Сначала сохраните правки: изменено 1')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Подтвердить сдачу' })).toHaveCount(0)
  expect(traffic.submits).toHaveLength(0)

  // AC-11, документированный квирк: handleKeyDownCapture висит на КОРНЕВОМ div
  // экрана, который оборачивает и панель ⇒ Ctrl+Enter при фокусе внутри панели
  // сохраняет правки (кнопкой грида), а день НЕ сдаёт. Настоящий capture-путь
  // настоящего браузера — не синтетическое событие.
  await submitDay.focus()
  await page.keyboard.press('Control+Enter')

  await expect.poll(() => traffic.bulks.length).toBe(1)
  // Сдача клавиатурного шортката не получает НАМЕРЕННО (epic-AC: «сдача —
  // осознанное действие»).
  expect(traffic.submits).toHaveLength(0)
})

test('AC-2: день уже сдан → состояние из сети, кнопки сдачи нет, метка опоздания видна', async ({
  page,
}) => {
  await stubApi(page, {
    dayRows: [submissionFixture({ version: 2, event: 'AMENDED', late: true })],
  })
  await openScreen(page)

  const state = page.getByTestId('day-submission-state')
  await expect(state).toContainText('День сдан')
  await expect(state).toContainText('v2')
  // Подпись события — ДОСЛОВНО из DailySubmission.Event.
  await expect(state).toContainText('Исправлено')
  await expect(state).toContainText('сдано с опозданием')
  await expect(page.getByRole('button', { name: 'Сдать день' })).toHaveCount(0)
})
