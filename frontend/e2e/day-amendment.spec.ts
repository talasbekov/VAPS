// Story 10.6 (QA-добор, workflow qa-generate-e2e-tests) — e2e исправления
// сдачи в РЕАЛЬНОМ chromium против прод-сборки харнеса (порт 4174, dist-e2e).
//
// Зачем это поверх 45 jsdom-тестов стори. Стори проверена в jsdom плотно, но
// ровно те четыре рубежа, на которых amendment-флоу держится, jsdom не
// проверяет, а ИМИТИРУЕТ:
//   1) порядок табуляции — jsdom его не вычисляет, userEvent.tab обходит свой
//      список кандидатов; AC-7 требует проходимости формы клавиатурой;
//   2) implicit submission из однострочной «Санкции» — в jsdom его выполняет
//      user-event, в браузере это алгоритм формы, и он ЗАВИСИТ от того, что
//      кнопка по умолчанию не disabled;
//   3) `disabled` на кнопке подтверждения в полёте — второй рубеж AC-3; урок
//      красной пробы 10.3 (№3a/3b): в jsdom он не отличим от программного
//      гарда, потому что userEvent просто не кликает disabled-кнопку;
//   4) `maxLength={255}` — предел, который в jsdom никто не проверял на
//      сопротивление вводу (юнит-тест держит СЛУЧАЙ 256, а не поведение поля).
// Плюс пятое, структурное: панельные тесты рендерят панель в вакууме, поэтому
// перехват Ctrl+Enter capture-хендлером ЭКРАНА (DailyUpdatePage.tsx:380),
// накрывающим и форму исправления, не виден там по построению.
//
// Чего здесь НЕТ и почему: живого бэкенда. Это НЕ стори 10.10 («E2E сдачи
// целиком»). Сеть перехвачена page.route — но перехвачена НА УРОВНЕ БРАУЗЕРА:
// fetch настоящий, статусы настоящие, конверт §36 разбирает боевой
// parseErrorResponse. И НЕ метки протухшей сводки: `summary_freshness`
// HTTP-поверхности не имеет (→10.6a/10.6b), проверять нечего.
import { expect, test, type Locator, type Page } from '@playwright/test'

// Абсолютный URL: глобальный baseURL (4173) принадлежит print-спекам 8.8.
const HARNESS = 'http://localhost:4174/e2e-harness/day-amendment.html'

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

/** Локальное «сегодня» браузера — экран открывается на нём (useState(todayLocalIso)). */
function todayIso(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Версия дня. Оси различия v1↔v2 — ВСЕ ТРИ (version, event, автор): одинаковые
 * строки сделали бы ассерт AC-5 сравнением состояния с самим собой (ретро E9).
 */
function versionFixture(over: Record<string, unknown> = {}) {
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

/** v1 до исправления — действующая. */
const V1_CURRENT = versionFixture()
/** v1 после исправления — вытеснена (flip-before-insert, amendment_service.py:147-166). */
const V1_SUPERSEDED = versionFixture({ is_current: false })
/** v2 — ответ 201: РОВНО 9 полей, reason/sanction в нём нет (Д2 5.8b). */
const V2_AMENDED = versionFixture({
  id: 78,
  version: 2,
  is_current: true,
  event: 'AMENDED',
  submitted_by: 'inspector-9',
  submitted_at: '2026-07-19T10:40:00+05:00',
})

function errorEnvelope(
  errorCode: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  return {
    error_code: errorCode,
    message,
    details,
    request_id: 'req-e2e-10-6',
    timestamp: '2026-07-19T08:00:00+05:00',
  }
}

interface Stub {
  /** Права актора; по умолчанию — с `daily_report.correct`. */
  permissions?: string[]
  /** Ответ POST /{id}/amend/; по умолчанию — 201 с v2. */
  amendStatus?: number
  amendBody?: unknown
  /** Задержка ответа amend (мс) — рубеж `disabled` существует только в полёте. */
  amendDelayMs?: number
}

interface Traffic {
  /** Тела POST /{id}/amend/ — счётчик «ровно один POST». */
  amends: Record<string, unknown>[]
  /** URL-ы тех же POST — проверка, что адресуется id действующей версии. */
  amendUrls: string[]
  /** Сколько раз перечитано состояние ДНЯ (GET с business_date). */
  dayReads: number
  /** POST дельт статусов грида — след Ctrl+Enter (сохранение правок). */
  bulks: Record<string, unknown>[]
}

/**
 * Перехват сети НА УРОВНЕ БРАУЗЕРА.
 *
 * Фикстура дня ПОСЛЕДОВАТЕЛЬНА (счётчик обращений): до успешного amend она
 * отдаёт [v1], после — [v2(is_current), v1]. Статичная фикстура сделала бы
 * ассерт «в списке видны ОБЕ версии» зелёным без единой перечитки — то есть
 * вакуумным ровно там, где проверяется инвалидация.
 */
async function stubApi(page: Page, stub: Stub = {}): Promise<Traffic> {
  const traffic: Traffic = { amends: [], amendUrls: [], dayReads: 0, bulks: [] }
  let amended = false

  await page.route('**/api/operations/statuses/bulk/**', async (route) => {
    traffic.bulks.push(JSON.parse(route.request().postData() ?? 'null'))
    await route.fulfill({ status: 201, json: { created: 1 } })
  })

  await page.route('**/api/operations/my-permissions/**', (route) =>
    route.fulfill({
      json: {
        permissions: stub.permissions ?? [
          'daily_report.mark_update',
          'status.view',
          'daily_report.correct',
        ],
      },
    }),
  )
  await page.route('**/api/core/divisions/**', (route) =>
    route.fulfill({ json: divisionsBody }),
  )
  await page.route('**/api/core/employees/**', (route) =>
    route.fulfill({ json: employeesBody }),
  )
  await page.route('**/api/operations/daily-submissions/**', async (route) => {
    const request = route.request()
    const url = request.url()

    if (request.method() === 'POST') {
      traffic.amendUrls.push(url)
      traffic.amends.push(JSON.parse(request.postData() ?? 'null'))
      if (stub.amendDelayMs) {
        // Настоящее ожидание сети: рубеж `disabled` живёт только в полёте.
        await new Promise((resolve) => setTimeout(resolve, stub.amendDelayMs))
      }
      const status = stub.amendStatus ?? 201
      if (status === 201) amended = true
      await route.fulfill({ status, json: stub.amendBody ?? V2_AMENDED })
      return
    }

    // GET состояния ДНЯ (точный фильтр по дате) ≠ GET истории подразделения
    // (limit=200, для предпросмотра сдачи) — различаем по параметру, как это
    // делает сам экран.
    const rows = url.includes('business_date=')
      ? ((traffic.dayReads += 1), amended ? [V2_AMENDED, V1_SUPERSEDED] : [V1_CURRENT])
      : [V1_CURRENT]
    await route.fulfill({
      json: { count: rows.length, next: null, previous: null, results: rows },
    })
  })
  return traffic
}

/** Экран + выбор подразделения: до него ни грида, ни состояния дня нет. */
async function openScreen(page: Page) {
  await page.goto(HARNESS)
  await page.getByLabel('Подразделение').selectOption(DIVISION_ID)
  await expect(page.getByTestId('day-submission-state')).toContainText('День сдан')
}

/**
 * НАСТОЯЩАЯ последовательная табуляция браузера (jsdom её только имитирует).
 * Бросает, если фокус до цели не дошёл: «фокус куда-то встал» — известная
 * вакуумная форма (инциденты 9.9, 11.4), поэтому цель называется поимённо.
 */
async function tabUntilFocused(page: Page, target: Locator, limit = 20) {
  for (let pressed = 0; pressed <= limit; pressed += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return pressed
    await page.keyboard.press('Tab')
  }
  throw new Error(`Фокус не дошёл до элемента за ${limit} нажатий Tab`)
}

const reasonField = (page: Page) => page.getByLabel('Причина')
const sanctionField = (page: Page) => page.getByLabel('Санкция')
const confirmButton = (page: Page) =>
  page.getByRole('button', { name: 'Подтвердить исправление' })
const amendButton = (page: Page) => page.getByRole('button', { name: 'Исправить сдачу' })

/** Открыть форму исправления мышью (клавиатурный путь проверяет отдельный тест). */
async function openAmendForm(page: Page) {
  await amendButton(page).click()
  await expect(reasonField(page)).toBeVisible()
}

/** Правка статуса первой строки грамматикой грида (Enter → выбор → Enter). */
async function editFirstRow(page: Page, code: string) {
  await page.locator('[data-grid-row]').first().click()
  await page.keyboard.press('Enter')
  await page.getByLabel('Статус').selectOption(code)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('changed-counter')).toHaveText(/Изменено 1 из 3/)
}

test('AC-1/2/3/4/5/7: флоу исправления проходится КЛАВИАТУРОЙ целиком — от кнопки до двух версий в списке', async ({
  page,
}) => {
  const traffic = await stubApi(page)
  await openScreen(page)

  // Стартуем от поля даты — дальше только НАСТОЯЩАЯ табуляция браузера.
  await page.getByLabel('Дата').focus()
  await tabUntilFocused(page, amendButton(page))
  await page.keyboard.press('Enter')

  // Порядок полей формы — тоже настоящий: причина → санкция → подтверждение.
  await tabUntilFocused(page, reasonField(page))
  await page.keyboard.type('  Ошибка в ростере: боец учтён дважды  ')
  await page.keyboard.press('Tab')
  await expect(sanctionField(page)).toBeFocused()
  await page.keyboard.type('  Выговор старшине  ')
  await page.keyboard.press('Tab')
  await expect(confirmButton(page)).toBeFocused()
  await page.keyboard.press('Enter')

  // AC-3: ровно один POST, тело — РОВНО два поля, обрезанные trim().
  await expect.poll(() => traffic.amends.length).toBe(1)
  expect(traffic.amends[0]).toEqual({
    reason: 'Ошибка в ростере: боец учтён дважды',
    sanction: 'Выговор старшине',
  })
  // AC-3: URL адресует id ДЕЙСТВУЮЩЕЙ версии (77), а не выдуманный.
  expect(traffic.amendUrls[0]).toContain(`/daily-submissions/${V1_CURRENT.id}/amend/`)

  // AC-4: новая версия видна шапкой — автор и время ИЗ ОТВЕТА (не из формы).
  const state = page.getByTestId('day-submission-state')
  await expect(state).toContainText('День сдан: v2 · Исправлено')
  await expect(state).toContainText('inspector-9')
  // AC-4: форма закрыта.
  await expect(reasonField(page)).toHaveCount(0)
  // AC-4: экран НЕ обещает reason/sanction — 201 их не возвращает.
  await expect(page.locator('body')).not.toContainText('Ошибка в ростере')

  // AC-5: состояние дня ПЕРЕЧИТАНО, и в списке видны ОБЕ версии; действующая
  // помечена СЛОВОМ, порядок — как отдал бэк.
  const rows = page.getByTestId('day-versions').getByRole('listitem')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('v2 · Исправлено')
  await expect(rows.nth(0)).toContainText('действующая')
  await expect(rows.nth(1)).toContainText('v1 · Изменено')
  await expect(rows.nth(1)).not.toContainText('действующая')
})

test('AC-7: implicit submission — Enter в однострочной «Санкции» отправляет форму (алгоритм браузера, не user-event)', async ({
  page,
}) => {
  // В jsdom implicit submission ВЫПОЛНЯЕТ user-event, поэтому там он проходит
  // при любой разметке. В браузере он существует, только пока форма — настоящий
  // <form> с не-disabled кнопкой по умолчанию.
  const traffic = await stubApi(page)
  await openScreen(page)
  await openAmendForm(page)

  await reasonField(page).fill('Перепутан статус наряда')
  await sanctionField(page).fill('Замечание')
  await sanctionField(page).press('Enter')

  await expect.poll(() => traffic.amends.length).toBe(1)
  expect(traffic.amends[0]).toEqual({
    reason: 'Перепутан статус наряда',
    sanction: 'Замечание',
  })
})

test('AC-3: пока запрос в полёте, подтверждение РЕАЛЬНО недоступно — ни клик, ни Enter второго POST не дают', async ({
  page,
}) => {
  // Второй рубеж AC-3. В jsdom он не отличим от программного гарда (урок
  // красной пробы 10.3, №3a/3b): userEvent не кликает disabled-кнопку. Здесь
  // проверяется именно DOM-атрибут — и оба пути обхода кнопки сразу.
  const traffic = await stubApi(page, { amendDelayMs: 1200 })
  await openScreen(page)
  await openAmendForm(page)

  await reasonField(page).fill('Двойной клик оператора')
  await sanctionField(page).fill('Выговор')
  await confirmButton(page).click()

  await expect(confirmButton(page)).toBeDisabled()
  // Реальный клик по disabled-кнопке браузер не доставит — force обходит
  // проверку actionability и бьёт по элементу, как упрямый пользователь.
  await confirmButton(page).click({ force: true })
  // И второй путь: implicit submission мимо кнопки.
  await sanctionField(page).press('Enter')

  await expect(page.getByTestId('day-submission-state')).toContainText('v2 · Исправлено')
  expect(traffic.amends).toHaveLength(1)
})

test('AC-2: пустая форма — Enter не отправляет НИЧЕГО, кнопка подтверждения disabled', async ({
  page,
}) => {
  const traffic = await stubApi(page)
  await openScreen(page)
  await openAmendForm(page)

  await expect(confirmButton(page)).toBeDisabled()
  await sanctionField(page).press('Enter')
  // Только причина — всё ещё недостаточно (оба поля обязательны).
  await reasonField(page).fill('Причина есть, санкции нет')
  await expect(confirmButton(page)).toBeDisabled()
  await sanctionField(page).press('Enter')

  // Форма никуда не делась и по-прежнему открыта — «тишина» тут не от того,
  // что экран сломался.
  await expect(reasonField(page)).toHaveValue('Причина есть, санкции нет')
  expect(traffic.amends).toHaveLength(0)

  // Положительный контроль: та же форма с заполненной санкцией — отправляет.
  await sanctionField(page).fill('Выговор')
  await expect(confirmButton(page)).toBeEnabled()
  await sanctionField(page).press('Enter')
  await expect.poll(() => traffic.amends.length).toBe(1)
})

test('AC-2: поле санкции РЕАЛЬНО не принимает 256-й символ (maxLength как сопротивление вводу)', async ({
  page,
}) => {
  // Юнит-тест держит СЛУЧАЙ 256 у валидатора; здесь проверяется, что поле
  // до валидатора этот случай и не пропустит. `fill` присваивает значение
  // программно и maxlength игнорирует — поэтому добор идёт НАЖАТИЯМИ.
  const traffic = await stubApi(page)
  await openScreen(page)
  await openAmendForm(page)

  const limit = 255
  await reasonField(page).fill('Санкция на границе длины')
  await sanctionField(page).fill('С'.repeat(limit))
  await expect(page.getByTestId('sanction-counter')).toHaveText(`${limit}/${limit}`)

  await sanctionField(page).pressSequentially('ХВОСТ')
  await expect(sanctionField(page)).toHaveValue('С'.repeat(limit))
  await expect(page.getByTestId('sanction-counter')).toHaveText(`${limit}/${limit}`)

  // Граничное значение — законное: 255 бэк принимает, форма отправляется.
  await confirmButton(page).click()
  await expect.poll(() => traffic.amends.length).toBe(1)
  expect(String(traffic.amends[0].sanction)).toHaveLength(limit)
})

test('AC-6: 409 (гонка версий) → форма закрыта, состояние перечитано, модального диалога в браузере НЕТ', async ({
  page,
}) => {
  // В jsdom «<dialog> отсутствует» — вакуум: модальности там нет в принципе.
  // Здесь <dialog> настоящий, и его отсутствие что-то значит:
  // DAY_ALREADY_SUBMITTED нет в OVERRIDABLE_CODES ⇒ ConflictDialog не поднимется.
  const traffic = await stubApi(page, {
    amendStatus: 409,
    amendBody: errorEnvelope(
      'DAY_ALREADY_SUBMITTED',
      'Подразделение уже сдало этот день.',
      { division_id: DIVISION_ID, business_date: todayIso() },
    ),
  })
  await openScreen(page)
  const readsBefore = traffic.dayReads
  await openAmendForm(page)

  await reasonField(page).fill('Партнёр успел раньше')
  await sanctionField(page).fill('Выговор')
  await confirmButton(page).click()

  await expect(page.getByTestId('day-amend-failure')).toContainText(
    'День успел измениться',
  )
  // Форма закрыта — «активной обманки» над устаревшим состоянием нет (HIGH 10.3/10.5).
  await expect(reasonField(page)).toHaveCount(0)
  // Перечитка состояния дня действительно случилась (счётчик, не намерение):
  // открытие формы запросов не делает, поэтому лишний GET здесь ровно один —
  // тот, что подняла инвалидация в эффекте 409.
  await expect.poll(() => traffic.dayReads).toBeGreaterThan(readsBefore)
  await expect(page.locator('dialog')).toHaveCount(0)
  expect(traffic.amends).toHaveLength(1)

  // Оператор не заперт: вход в флоу вернулся и достижим КЛАВИАТУРОЙ.
  await page.getByLabel('Дата').focus()
  await tabUntilFocused(page, amendButton(page))
})

test('AC-6: 403 → фикс-текст про право, а не «PERMISSION_DENIED» с провода', async ({
  page,
}) => {
  // Бэк кладёт в message САМ КОД (DomainError.message = message or code), и
  // рендер error.message показал бы оператору «PERMISSION_DENIED». Фикстура
  // несёт код в message — как на проводе.
  const traffic = await stubApi(page, {
    amendStatus: 403,
    amendBody: errorEnvelope('PERMISSION_DENIED', 'PERMISSION_DENIED'),
  })
  await openScreen(page)
  await openAmendForm(page)

  await reasonField(page).fill('Право отозвали, пока форма была открыта')
  await sanctionField(page).fill('Выговор')
  await confirmButton(page).click()

  const failure = page.getByTestId('day-amend-failure')
  await expect(failure).toContainText('daily_report.correct')
  await expect(page.locator('body')).not.toContainText('PERMISSION_DENIED')
  // 403 — отказ ПРАВИМЫЙ снаружи: форма остаётся открытой, данные не потеряны.
  await expect(reasonField(page)).toHaveValue('Право отозвали, пока форма была открыта')
  expect(traffic.amends).toHaveLength(1)
})

test('AC-1: без права daily_report.correct входа в флоу нет (гейт в реальном приложении)', async ({
  page,
}) => {
  // Список прав загружен и НЕ пуст — «кнопки нет» объясняется отсутствием
  // права, а не невыполненным сетапом (credential ставит харнес).
  await stubApi(page, { permissions: ['daily_report.mark_update', 'status.view'] })
  await openScreen(page)

  // Положительный контроль: список версий дня рисуется — панель жива.
  await expect(page.getByTestId('day-versions')).toBeVisible()
  await expect(amendButton(page)).toHaveCount(0)
})

test('Ctrl+Enter из формы исправления уходит грамматике ЭКРАНА: сохраняет правки грида, исправление не шлёт', async ({
  page,
}) => {
  // Структурное слепое пятно панельных тестов: `handleKeyDownCapture` висит на
  // КОРНЕВОМ div ЭКРАНА (DailyUpdatePage.tsx:380) и перехватывает Ctrl+Enter в
  // capture-фазе — то есть накрывает и форму исправления, смонтированную под
  // ним. Панель, отрендеренная в вакууме, этого хендлера не имеет и увидеть
  // эффект не может по построению.
  //
  // ⚠️ Ассерт «amend не ушёл» САМ ПО СЕБЕ был бы вакуумным: chromium и без
  // всякого хендлера не делает implicit submission по Ctrl+Enter (проверено
  // мутацией — снятие preventDefault/stopPropagation теста не красит).
  // Несущий ассерт здесь — ПОЛОЖИТЕЛЬНЫЙ: Ctrl+Enter, нажатый ВНУТРИ формы
  // исправления, доезжает до грамматики экрана и сохраняет правки ГРИДА.
  const traffic = await stubApi(page)
  await openScreen(page)
  await editFirstRow(page, 'VACATION')
  await openAmendForm(page)

  await reasonField(page).fill('Проверка перехвата Ctrl+Enter')
  await sanctionField(page).fill('Выговор')
  await reasonField(page).press('Control+Enter')

  // Несохранённые правки грида исправлению НЕ мешают (гарда dirtyCount на
  // этом пути нет — он принадлежит сдаче), но Ctrl+Enter принадлежит гриду:
  // исправление клавиатурного шортката не получает, как и сдача (epic-AC 10.3).
  await expect.poll(() => traffic.bulks.length).toBe(1)
  expect(traffic.amends).toHaveLength(0)
  // Форма цела: ничего не закрылось и введённое не потерялось.
  await expect(reasonField(page)).toHaveValue('Проверка перехвата Ctrl+Enter')

  // Положительный контроль: та же форма обычным Enter отправляется — «ноль
  // amend» выше означает чужой владелец шортката, а не сломанную форму.
  await sanctionField(page).press('Enter')
  await expect.poll(() => traffic.amends.length).toBe(1)
})
