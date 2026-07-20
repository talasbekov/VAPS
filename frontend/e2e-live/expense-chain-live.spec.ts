// Story 10.10 — ЕДИНСТВЕННЫЙ тест проекта, в котором один актор проходит весь
// критичный путь пилота в настоящем браузере против ЖИВОГО бэкенда: массовое
// обновление статусов → сдача дня → зелёный светофор подразделения → скачанный
// файл расхода. Сценарий №3 из лимита 5 (architecture.md#L259).
//
// Каждое звено цепочки покрыто по отдельности мокнутыми спеками
// (day-submission.spec.ts, traffic-light.spec.ts, expense.spec.ts), а связка
// четырёх экранов и четырёх ручек — ни разу. Именно она есть предмет пилота.
//
// 🔴 Ни одного page.route — в этом весь смысл. Сеть здесь настоящая: Postgres,
// ASGI-приложение, vite-прокси, реальный `Content-Disposition`, реальные байты
// .docx. Захотелось заглушить — значит стек не поднялся, и это находка, а не
// повод замокать.
//
// Наблюдение (page.on) — не перехват: слушатели ничего не подменяют, они лишь
// считают то, что реально ушло по проводу.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

import { LIVE_ENV } from '../playwright.live.config'

const HARNESS = 'http://localhost:4174/e2e-harness/chain.html'
const BACKEND_URL = 'http://127.0.0.1:8001'

// fileURLToPath, не URL.pathname — путь репо содержит кириллицу (ловушка 8.8 №7)
const BACKEND_DIR = fileURLToPath(new URL('../../Backend/VAPS', import.meta.url))
const PYTHON = '.venv/bin/python'

// 🔴 ОТСТУПЛЕНИЕ ОТ 11.6 С ЯВНОЙ ПРИЧИНОЙ (Решение №5). 11.6 могла позволить
// себе `America/Anchorage` (разрыв 14 часов), потому что дату ей печатал сид, а
// экран уведомлений даты не имеет. Здесь три экрана из четырёх считают
// дефолтную дату В БРАУЗЕРЕ (`todayLocalIso()` — четыре независимые копии:
// DailyUpdatePage.tsx:75, daySubmission.ts:167, TrafficLightTreePage.tsx:71,
// expense.ts:72), а у СВЕТОФОРА нет контрола даты вовсе (`useState(todayLocalIso)`
// без сеттера, TrafficLightTreePage.tsx:85). В далёкой зоне спека 14 часов в
// сутки спрашивала бы светофор про ДРУГОЙ день и получала честный RED.
//
// Плата за совпадение зон — потеря бесплатной TZ-независимости. Компенсация —
// ЗАЩИТНЫЙ АССЕРТ «дата браузера == E2E_DAY» в двух точках (см. ниже): без него
// прогон в 00:0х по Кызылорде молча уехал бы на сутки.
test.use({ timezoneId: 'Asia/Qyzylorda' })

// Годится любой код из seed_statuses КРОМЕ трёх: `IN_SERVICE` (нулевая дельта —
// все строки стартуют в нём, преднабора со вчера нет, 10.1b в backlog),
// `ATTACHED` (выпадает из `list_total`, strength_report.py:167-172 → ломает
// сверку чисел), `DETACHED` (делает сотрудника нередактируемым, FR-16 → 403 на
// последующих bulk'ах). `DUTY` — мягкий (не входит в HARD_BLOCK_CODES
// seed_statuses.py:35), поэтому повторный прогон не упрётся в 422
// OVERLAPPING_HARD_STATUS даже до уборки.
const STATUS_CODE = 'DUTY'

interface Seed {
  day: string
  divisionId: string
  actor: string
  employees: number
}

/**
 * Сид дочерним процессом — с тем же env, что у uvicorn в webServer.
 *
 * Единственный источник бизнес-даты: `clock.override` это ContextVar, границу
 * процесса он не пересекает, поэтому спека часы сервера заморозить не может.
 * 🔴 Дату НИКОГДА не вычислять в JS (`new Date().toISOString().slice(0,10)` и
 * родня) — браузер и сервер считают «сегодня» независимо.
 */
function seed(): Seed {
  const out = execFileSync(PYTHON, ['manage.py', 'seed_e2e_expense_chain'], {
    cwd: BACKEND_DIR,
    encoding: 'utf-8',
    env: { ...process.env, ...LIVE_ENV },
  })
  const read = (key: string, pattern: string) => {
    const value = new RegExp(`^E2E_${key}=(${pattern})$`, 'm').exec(out)?.[1]
    if (!value) throw new Error(`сид не напечатал E2E_${key}; stdout:\n${out}`)
    return value
  }
  return {
    day: read('DAY', String.raw`\d{4}-\d{2}-\d{2}`),
    divisionId: read('DIVISION', '[0-9a-f-]+'),
    actor: read('ACTOR', String.raw`[\x21-\x7e]+`),
    employees: Number(read('EMPLOYEES', String.raw`\d+`)),
  }
}

interface Traffic {
  /** Ответы дерева готовности — отделяют «перечитано с сервера» от «из кэша». */
  treeGets: string[]
  /** Статусы ответов на массовое обновление: 201 = отклонения действительно легли. */
  bulkPosts: number[]
  /** Кем браузер представлялся бэкенду — пин харнеса к сиду (см. ШАГ 2). */
  browserActors: Set<string>
}

function watch(page: Page): Traffic {
  const traffic: Traffic = { treeGets: [], bulkPosts: [], browserActors: new Set() }
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.pathname === '/api/operations/traffic-light/tree/') {
      traffic.treeGets.push(response.url())
    }
    if (
      url.pathname === '/api/operations/statuses/bulk/' &&
      response.request().method() === 'POST'
    ) {
      traffic.bulkPosts.push(response.status())
    }
  })
  page.on('request', (request) => {
    if (!new URL(request.url()).pathname.startsWith('/api/')) return
    // Заголовок подставляет credential.ts:18 из того, что харнес положил в
    // sessionStorage. Пустая строка вместо undefined — чтобы «актора не было
    // вовсе» попало в множество и покраснело сравнением, а не потерялось.
    traffic.browserActors.add(request.headers()['x-user-id'] ?? '')
  })
  return traffic
}

/** Переход по САЙДБАРУ — тем же кодом, что у оператора (`MemoryRouter`). */
async function openSection(page: Page, label: string) {
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('link', { name: label })
    .click()
}

/** Узел фикстурного подразделения. Лист и корень — кнопки «Раскрыть» у него
 *  НЕТ (она рендерится только при непустых children, TrafficLightNode.tsx:91-107),
 *  а дефолтное раскрытие — корни, значит узел виден сразу. */
function trafficNode(page: Page, divisionId: string) {
  return page.locator(`li[data-traffic-node="${divisionId}"]`)
}

/**
 * Метка светофора узла — ТОЧНЫМ совпадением, а не подстрокой.
 *
 * 🔴 НАХОДКА КРАСНОЙ ПРОБЫ №2. Первая редакция ассертила
 * `toContainText('сдано')`, и проба «сдача ДО массового обновления» осталась
 * ЗЕЛЁНОЙ: перестановка шагов честно красит узел в YELLOW, но YELLOW-метка —
 * `'сдано, расход разошёлся'` (trafficLight.ts:49-58), и она СОДЕРЖИТ подстроку
 * `'сдано'`. Тест проходил бы и на разошедшемся расходе, то есть не проверял
 * ровно то, что стори заявляет заголовком — ЗЕЛЁНЫЙ светофор.
 *
 * `{ exact: true }` матчит полный текст элемента, поэтому 'сдано' не цепляет ни
 * 'не сдано' (RED), ни 'сдано, расход разошёлся' (YELLOW).
 */
function trafficLabel(page: Page, divisionId: string, label: string) {
  return trafficNode(page, divisionId).getByText(label, { exact: true })
}

test('оператор проходит цепочку целиком: массовое обновление → сдача → зелёный светофор → скачанный расход', async ({
  page,
  request,
}) => {
  // ШАГ 1. Сид ДО открытия страницы: уборка на входе + корневое бездетное
  // подразделение, состав, слоты штата и якорь горизонта данных.
  const { day, divisionId, actor, employees } = seed()

  const traffic = watch(page)
  await page.goto(HARNESS)

  // 🔴 ПИН ХАРНЕСА К СИДУ — ПЕРВЫМ ассертом, до единого взаимодействия.
  // Актор захардкожен ДВАЖДЫ и на двух языках: `DEFAULT_ACTOR` в
  // seed_e2e_expense_chain.py (там же ему выдаётся ADMIN-роль) и
  // `setCredential` в e2e-harness/chain.tsx. Ни один гейт эту пару не сверяет:
  // `make gate` не знает про .tsx, `npm run gate` не знает про .py, а живая
  // спека в гейты не входит вовсе.
  //
  // Порядок здесь несущий, а не косметический: при рассинхроне актор приходит
  // БЕЗ единой роли, `GET /api/core/divisions/` отдаёт 403, список подразделений
  // остаётся пустым — и ближайший `selectOption` падает «нет такой опции»,
  // уводя отладку в грид вместо одной строки credential'а. Ассерт обязан
  // сработать РАНЬШЕ него.
  //
  // `expect.poll`, а не голое чтение: `goto` возвращается по load, а запросы
  // каркаса (`my-permissions`, `divisions`) уходят следом. Ноль запросов —
  // красный по таймауту, а не молчаливо пройденный ассерт по пустому множеству.
  await expect
    .poll(() => traffic.browserActors.size, {
      message: 'браузер не сделал ни одного запроса к /api/ — пин был бы вакуумен',
    })
    .toBe(1)
  expect(
    [...traffic.browserActors][0],
    'харнес представился не тем актором, которому сид выдал ADMIN-роль: ' +
      'chain.tsx и seed_e2e_expense_chain.py разъехались',
  ).toBe(actor)

  // ──────────────────────────────────────────── ШАГ 2. Экран массового обновления

  await page.getByLabel('Подразделение').selectOption(divisionId)
  await expect(page.getByTestId('changed-counter')).toBeVisible()

  // 🔴 ЗАЩИТНЫЙ АССЕРТ ДАТЫ, точка 1 из 2 (AC-5). Дата здесь ВИДИМА, и её
  // считает браузер (`todayLocalIso()`), а не сервер. Расхождение означает, что
  // экран смотрит на другой день, чем засеял сид, — и вся цепочка ниже
  // проверяла бы не тот день, оставаясь при этом «зелёной по-своему».
  await expect(
    page.getByLabel('Дата'),
    'браузер считает «сегодня» иначе, чем сервер — прогон уехал на сутки',
  ).toHaveValue(day)

  // ────────────────────────────────────────────────── ШАГ 3. Массовое обновление

  // Грамматика грида (макрос day-submission.spec.ts:176-182): клик → Enter →
  // выбор кода → Enter.
  await page.locator('[data-grid-row]').first().click()
  await page.keyboard.press('Enter')
  await page.getByLabel('Статус').selectOption(STATUS_CODE)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('changed-counter')).toHaveText(
    new RegExp(`Изменено 1 из ${employees}`),
  )

  await page.getByRole('button', { name: 'Сохранить правки' }).click()

  // Два независимых ассерта: канон-строка экрана И код ответа сервера. Строка
  // без кода не отличила бы «сохранилось» от «показалось».
  await expect(page.getByText('Применено 1 отклонений')).toBeVisible()
  expect(
    traffic.bulkPosts,
    'массовое обновление не доехало до сервера 201-м ответом',
  ).toEqual([201])

  // ─────────────────────────── ШАГ 4. Светофор, ПЕРВЫЙ заход — ДО сдачи

  // 🔴 Почему именно здесь, а не раньше: до шага 3 в БД нет ни одной живой
  // EmployeeStatus, и хотя горизонт данных держит EmployeeDivisionHistory
  // (якорь сида), заход до массового обновления проверял бы не то звено.
  // Этот шаг — половина (а) AC-7: без него «стало зелёным» нечем отличить от
  // «было зелёным».
  await openSection(page, 'Подразделения')
  await expect(trafficLabel(page, divisionId, 'не сдано')).toBeVisible()
  const treeGetsBeforeSubmission = traffic.treeGets.length
  expect(treeGetsBeforeSubmission).toBeGreaterThan(0)

  // ────────────────────────────────────────────────────────── ШАГ 5. Сдача дня

  await openSection(page, 'Расход дня')

  // 🔴 НАХОДКА ДЕВ-ПРОХОДА, а не украшение: выбор подразделения НЕ переживает
  // уход со страницы. `divisionId` — локальный `useState` экрана, а переход по
  // сайдбару перемонтирует роут; автовыбор первого элемента экран делать
  // отказывается сознательно (DailyUpdatePage.tsx:447-449 — список не
  // отфильтрован по scope оператора). Без повторного выбора панель сдачи
  // рисует «Выберите подразделение.», кнопка «Сдать день» остаётся, а
  // подтверждение не открывается вовсе — ровно так упал первый прогон.
  // Записано в Открытые вопросы: сохранение выбора между разделами — вопрос
  // продукта, прод-код эта стори не трогает.
  await page.getByLabel('Подразделение').selectOption(divisionId)
  await expect(page.getByTestId('changed-counter')).toBeVisible()

  // 🔴 Шаг 3 обязан был завершиться сохранением: при dirtyCount > 0 панель
  // вообще не открывает подтверждение (DaySubmissionPanel.tsx:259-271,
  // «Сначала сохраните правки: изменено N»).
  await page.getByRole('button', { name: 'Сдать день' }).click()
  await page.getByRole('button', { name: 'Подтвердить сдачу' }).click()

  // `toContainText`, не точное равенство: строка несёт версию и событие, а
  // бейдж «с опозданием» зависит от СЕРВЕРНОГО времени суток (`_is_late()`
  // сравнивает строгим `>` контрольного часа, а часы сервера спека заморозить
  // не может). Ассертить опоздание в любую сторону спека права не имеет.
  await expect(page.getByTestId('day-submission-state')).toContainText('День сдан')

  // ───────────────────────── ШАГ 6. Светофор, ВТОРОЙ заход — ПОСЛЕ сдачи

  // Свежесть дерева — РЕМОНТОМ страницы через сайдбар, а не часами: уход и
  // возврат перемонтируют TrafficLightTreePage, а `createQueryClient()`
  // (providers.tsx:34-40) не задаёт staleTime (дефолт 0) при refetchOnMount →
  // рефетч происходит немедленно. `page.clock.install()` здесь НЕ подходит:
  // его нужно ставить ДО goto, а поставленный посреди теста он уже запущенный
  // refetchInterval не перехватит. `page.reload()` и `waitForTimeout` запрещены.
  await openSection(page, 'Подразделения')
  // 🔴 ТОЧНОЕ 'сдано' = GREEN, и только он. Подстрочный ассерт пропускал бы
  // YELLOW ('сдано, расход разошёлся') — красная проба №2.
  await expect(trafficLabel(page, divisionId, 'сдано')).toBeVisible()
  // Дубль-страховка тем же фактом с другой стороны: разошедшийся расход в узле
  // не назван. Держит ассерт живым, даже если метки STATUS_LABEL перепишут.
  await expect(trafficNode(page, divisionId)).not.toContainText('разошёлся')

  // 🔴 АТРИБУЦИЯ ЗЕЛЁНОГО (AC-7в) — прямой перенос урока 11.6 (красная проба
  // №7: «счётчик становился 1 без единого WS-кадра, тест был зелёным по
  // неправильной причине»). TrafficLightTreePage держит refetchInterval =
  // 30_000, поэтому ассерт «зелёный» сам по себе зеленеет и от фонового
  // рефетча. Проверяемый факт: дерево ПЕРЕЧИТАНО с сервера и на НУЖНУЮ дату.
  //
  // Почему не «навигаций ровно одна»: харнес монтирует MemoryRouter, History
  // API не трогается вовсе, и `page.on('framenavigated')` физически не может
  // вырасти — такой ассерт был бы вакуумен by construction.
  await expect
    .poll(() => traffic.treeGets.length, {
      message: 'дерево не перезапрашивалось — зелёный мог приехать из кэша',
    })
    .toBeGreaterThan(treeGetsBeforeSubmission)

  // 🔴 ЗАЩИТНЫЙ АССЕРТ ДАТЫ, точка 2 из 2 (AC-5). У светофора контрола даты
  // нет вовсе, поэтому его дата наблюдаема ТОЛЬКО на проводе.
  const lastTreeUrl = new URL(traffic.treeGets[traffic.treeGets.length - 1])
  expect(
    lastTreeUrl.searchParams.get('business_date'),
    'светофор спрашивает про другой день, чем засеял сид',
  ).toBe(day)

  // ─────────────────────────────────────────────────────────── ШАГ 7. Расход

  await openSection(page, 'Отчёты')
  await page.getByLabel('Подразделение').selectOption(divisionId)
  await expect(page.getByLabel('Дата')).toHaveValue(day)

  await page.getByRole('button', { name: 'Сформировать' }).click()
  // Канон-строка успеха (expense.ts:61-62) с номером исходящего.
  const success = page.getByText(/^Расход готов\. Исх\.№ \d+\.$/)
  await expect(success).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать' }).click(),
  ])

  // 🔴 Имя файла НЕ детерминировано между прогонами: `number` берётся из
  // монотонного счётчика DocumentSequence (documents/models.py:73-96), который
  // уборка сида не сбрасывает и не должна — нумерация исходящих сквозная.
  // Первый прогон даёт исх-1, второй исх-2, а AC-9 требует ДВУХ прогонов
  // подряд. Литеральное равенство имени = красный второй прогон.
  expect(download.suggestedFilename()).toMatch(
    new RegExp(String.raw`^расход_${day}_исх-\d+\.docx$`),
  )

  // 🔴 Ядро AC-8.2: «файл валиден», а не «событие скачивания состоялось».
  // Пустое тело — ровно тот отказ, который даёт VAPS_XACCEL_ENABLED=1
  // (200 + X-Accel-Redirect, исполнять который в этой топологии некому:
  // nginx появится только в 12.1). Ассерт на длину — несущий.
  const saved = readFileSync(await download.path())
  expect(
    saved.byteLength,
    'файл пустой — скорее всего X-Accel-Redirect вместо FileResponse',
  ).toBeGreaterThan(0)
  // .docx это ZIP: локальная сигнатура заголовка — PK\x03\x04.
  expect(saved.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))

  // ────────────────────────────────────── ШАГ 8. «Числа сходятся» (AC-8.3)

  // Источник — `/period/`, а НЕ содержимое .docx и НЕ макет: JSON-поверхности
  // тела расхода в проекте нет вовсе (её адрес — 10.7a, backlog). Распаковка
  // .docx и разбор XML в e2e запрещены — это тест генератора, а не цепочки, и
  // он живёт в pytest.
  //
  // 🔴 Все три квери-параметра обязательны: `division_id` объявлен БЕЗ
  // required=False (submissions/api/serializers.py:111-117), вью читает
  // validated_data["division_id"] и гоняет через ensure_division_scope — без
  // него ответ 400. Заголовок X-User-Id — явно: подстановку делает браузерный
  // credential.ts:18, а запрос из Node-контекста спеки её не получит.
  const period = await request.get(
    `${BACKEND_URL}/api/operations/expense-reports/period/`,
    {
      params: { division_id: divisionId, date_from: day, date_to: day },
      headers: { 'X-User-Id': actor },
    },
  )
  expect(period.status()).toBe(200)
  const body = await period.json()
  // Страница на дату: однодневный диапазон обязан дать РОВНО одну. Без этого
  // `pages[0]` на пустом массиве упал бы TypeError'ом вместо внятного ассерта,
  // а лишние страницы означали бы, что фильтр по дате не сработал и число
  // ниже сверяется не с тем днём.
  expect(
    body.pages,
    'на однодневный диапазон пришло не одна страница расхода',
  ).toHaveLength(1)
  expect(
    body.pages[0].totals.list_total,
    'списочный состав в источнике данных расхода разошёлся с засеянным',
  ).toBe(employees)
})
