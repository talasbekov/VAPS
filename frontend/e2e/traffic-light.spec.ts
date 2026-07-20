// Story 10.4 (QA-добор, workflow qa-generate-e2e-tests) — e2e светофор-дерева в
// РЕАЛЬНОМ chromium против прод-сборки харнеса (порт 4174, dist-e2e).
//
// Зачем это поверх 86 vitest-тестов фичи. Сюита стори плотная, и повторять её
// здесь незачем — взяты РОВНО те четыре места, где jsdom-ассерт был бы вакуумен
// или невозможен, и это прямо признано в самой стори:
//
//   1) ЦВЕТ. jsdom не применяет CSS вообще — он сверяет имена классов. Если
//      Tailwind JIT не эмитит `bg-emerald-500` в dist-CSS, все 86 тестов
//      остаются зелёными, а пять состояний на экране становятся одинаковыми
//      серыми кружками. AC-3 требует различимости, а доказать её может только
//      настоящий каскад настоящей сборки (тот же довод, которым 8.8 выбрала
//      прод-сборку: «именно в dist CSS конкатенирован»).
//   2) ОТСТУП УРОВНЯ. `LEVEL_INDENT` — статические `ps-*` именно потому, что
//      «JIT-сканер видит только целые классы» (комментарий TrafficLightNode).
//      Довод записан, а проверки у него не было ни одной.
//   3) ТАБУЛЯЦИЯ. jsdom порядок обхода не вычисляет, а ИМИТИРУЕТ (userEvent.tab
//      идёт по своему списку кандидатов). Task 3 стори прямо запретил вакуумные
//      a11y-ассерты — «что не проверяется честно, то уезжает в e2e».
//   4) ФОКУС ПРИ ПЕРЕЧИТКЕ. AC-10 требует, чтобы фокус не терялся при
//      polling-перечитке. Ни один тест стори этого не проверял: polling-сюита
//      проверяет выживание РАСКЛАДКИ, а не фокуса.
//
// Чего здесь НЕТ и почему: живого бэкенда — это стори 10.10 (compose-окружение).
// Сеть перехвачена page.route, но перехвачена НА УРОВНЕ БРАУЗЕРА: fetch
// настоящий, JSON настоящий, у границы работает боевой parseTrafficLightTree.
//
// Чего здесь НЕТ ОСОЗНАННО: проверки «скрытая вкладка не опрашивается» (вторая
// половина AC-7). Спрятать страницу честно из Playwright нечем: `bringToFront()`
// соседней вкладки в headless-контуре оставляет `document.visibilityState ===
// 'visible'` (проверено), а CDP `Page.setWebLifecycleState` знает только
// active/frozen. Ассерт получился бы зелёным на любой реализации — ровно тот
// вакуум, за который E9 платил пять раз. Проверка ушла в jsdom-сюиту опроса,
// где `visibilityState` подменяется честно и focusManager react-query реально
// переключается (`TrafficLightTreePage.polling.test.tsx`).
import { expect, test, type Page } from '@playwright/test'

// Абсолютный URL: глобальный baseURL (4173) принадлежит print-спекам 8.8.
const HARNESS = 'http://localhost:4174/e2e-harness/traffic-light.html'

/** Интервал опроса экрана (AC-7). Дублируется числом ОСОЗНАННО: спека e2e не
 *  импортирует прод-модуль (сборка харнеса отдельная), а `clock.fastForward`
 *  требует именно число. Расхождение поймает тест «перечитка ушла» — он ждёт
 *  второго запроса после прыжка и покраснеет, если прод-интервал станет больше. */
const POLL_MS = 30_000

type Status = 'GREEN' | 'YELLOW' | 'RED' | 'NEUTRAL' | 'UNKNOWN'

interface NodeFixture {
  division_id: string
  name: string
  parent_id: string | null
  status: Status
  late: boolean
}

/** Кириллица во всех фикстурах — урок E9: латиница даёт зелёный тест на сломанном. */
function node(over: Partial<NodeFixture> & { division_id: string }): NodeFixture {
  return {
    name: 'Подразделение',
    parent_id: null,
    status: 'GREEN',
    late: false,
    ...over,
  }
}

interface Traffic {
  /** Число РЕАЛЬНО ушедших GET дерева — считается на уровне браузера. */
  gets: number
}

/**
 * Перехват сети НА УРОВНЕ БРАУЗЕРА. Отвечает конвертом `{business_date, nodes}` —
 * той формой, которую стори выписала из схемы (голый массив разбор считает
 * мусором, и это её осознанное решение).
 */
async function stubTree(page: Page, nodes: NodeFixture[]): Promise<Traffic> {
  const traffic: Traffic = { gets: 0 }
  await page.route('**/api/operations/traffic-light/tree/**', async (route) => {
    traffic.gets += 1
    await route.fulfill({ json: { business_date: '2026-07-19', nodes } })
  })
  return traffic
}

/** Строка узла — СОБСТВЕННАЯ карточка, без вложенного поддерева. */
function row(page: Page, divisionId: string) {
  return page.locator(`li[data-traffic-node="${divisionId}"] > div`).first()
}

/** Маркер-кружок узла (`aria-hidden` — цвет дублируется текст-меткой, AC-3). */
function marker(page: Page, divisionId: string) {
  return row(page, divisionId).locator('span[aria-hidden="true"]').first()
}

async function backgroundColor(page: Page, divisionId: string): Promise<string> {
  return marker(page, divisionId).evaluate((el) => getComputedStyle(el).backgroundColor)
}

/** Число СМОНТИРОВАННЫХ узлов — тот же счётчик, что перф-ассерт AC-4 в vitest. */
function mountedNodes(page: Page) {
  return page.locator('li[data-traffic-node]')
}

const SHTAB = '11111111-1111-4111-8111-111111111111'

test('AC-3: пять состояний РАЗЛИЧИМЫ в прод-сборке — цвета доехали до dist-CSS, метки читаемы', async ({
  page,
}) => {
  // jsdom сверяет ИМЕНА классов и зелен даже если Tailwind не эмитил ни одного
  // из них. Здесь работает настоящий каскад настоящей сборки.
  const STATUSES: Status[] = ['GREEN', 'YELLOW', 'RED', 'NEUTRAL', 'UNKNOWN']
  const LABELS: Record<Status, string> = {
    GREEN: 'сдано',
    YELLOW: 'сдано, расход разошёлся',
    RED: 'не сдано',
    NEUTRAL: 'нет данных',
    UNKNOWN: 'неопределён',
  }
  const ids = STATUSES.map((_, i) => `2222${i}222-2222-4222-8222-222222222222`)

  await stubTree(page, [
    node({ division_id: SHTAB, name: 'Штаб бригады', status: 'UNKNOWN' }),
    ...STATUSES.map((status, i) =>
      node({
        division_id: ids[i],
        name: `Рота ${i + 1}`,
        parent_id: SHTAB,
        status,
        // late на КРАСНОМ узле: метка опоздания обязана быть отдельным
        // видимым сигналом, а не оттенком цвета (AC-3).
        late: status === 'RED',
      }),
    ),
  ])
  await page.goto(HARNESS)

  // Дефолт — раскрыт только корень, значит все пять детей на экране.
  await expect(page.getByText('Штаб бригады')).toBeVisible()

  const colors = new Map<Status, string>()
  for (const [i, status] of STATUSES.entries()) {
    await expect(row(page, ids[i])).toContainText(LABELS[status])
    const color = await backgroundColor(page, ids[i])
    // Прозрачный маркер = класс до сборки не доехал.
    expect(color, `маркер ${status} прозрачен — класс не попал в dist-CSS`).not.toBe(
      'rgba(0, 0, 0, 0)',
    )
    colors.set(status, color)
  }

  // Пять состояний — пять РАЗНЫХ цветов. Слипшаяся пара означала бы, что
  // светофор на экране врёт, при полностью зелёной vitest-сюите.
  expect(new Set(colors.values()).size, `цвета слиплись: ${[...colors].join(', ')}`).toBe(
    STATUSES.length,
  )

  // Метка опоздания — отдельная строка, а не оттенок красного.
  await expect(row(page, ids[2])).toContainText('с опозданием')
  await expect(row(page, ids[0])).not.toContainText('с опозданием')
})

test('AC-3: глубина видна ОТСТУПОМ — статические ps-* классы пережили JIT-сканер', async ({
  page,
}) => {
  // `LEVEL_INDENT` собран статическими классами именно потому, что вычисленное
  // имя молча не попало бы в сборку (комментарий в TrafficLightNode). Довод был
  // записан, проверки не было: в jsdom padding не вычисляется вовсе.
  const ROTA = '33333333-3333-4333-8333-333333333333'
  const VZVOD = '44444444-4444-4444-8444-444444444444'
  await stubTree(page, [
    node({ division_id: SHTAB, name: 'Штаб бригады', status: 'RED' }),
    node({ division_id: ROTA, name: 'Первая рота', parent_id: SHTAB, status: 'RED' }),
    node({ division_id: VZVOD, name: 'Взвод связи', parent_id: ROTA, status: 'RED' }),
  ])
  await page.goto(HARNESS)

  await page.getByRole('button', { name: 'Раскрыть Первая рота' }).click()
  await expect(page.getByText('Взвод связи')).toBeVisible()

  const indents: number[] = []
  for (const id of [SHTAB, ROTA, VZVOD]) {
    indents.push(
      await page
        .locator(`li[data-traffic-node="${id}"]`)
        .evaluate((el) =>
          parseFloat(getComputedStyle(el).getPropertyValue('padding-inline-start')),
        ),
    )
  }

  // Строго возрастает: одинаковые отступы = лестница уровней не собралась.
  expect(indents[1], `уровень 2 не отступил: ${indents.join(' / ')}`).toBeGreaterThan(
    indents[0],
  )
  expect(indents[2], `уровень 3 не отступил: ${indents.join(' / ')}`).toBeGreaterThan(
    indents[1],
  )
})

test('AC-10: дерево проходимо НАСТОЯЩЕЙ табуляцией, Enter и Space раскрывают ветку', async ({
  page,
}) => {
  // jsdom порядок табуляции не вычисляет, а имитирует; Enter/Space там —
  // синтетические события, а не нативное поведение <button>.
  const ROTA = '33333333-3333-4333-8333-333333333333'
  const VZVOD = '44444444-4444-4444-8444-444444444444'
  await stubTree(page, [
    node({ division_id: SHTAB, name: 'Штаб бригады', status: 'RED' }),
    node({ division_id: ROTA, name: 'Первая рота', parent_id: SHTAB, status: 'RED' }),
    node({ division_id: VZVOD, name: 'Взвод связи', parent_id: ROTA, status: 'RED' }),
  ])
  await page.goto(HARNESS)
  await expect(page.getByText('Первая рота')).toBeVisible()

  // Стартуем от тумблера фильтра — дальше только настоящая табуляция браузера.
  await page.locator('#only-lagging').focus()
  await page.keyboard.press('Tab')

  // Первая раскрывашка после тумблера — корневая. Подпись зависит от состояния
  // ветки, поэтому проверяем именно ту кнопку, что сейчас в фокусе.
  const rootToggle = page.getByRole('button', { name: 'Свернуть Штаб бригады' })
  await expect(rootToggle).toBeFocused()

  // Enter — нативное срабатывание кнопки: ветка сворачивается, дети УХОДЯТ ИЗ
  // DOM (механизм AC-4 — не hidden).
  await page.keyboard.press('Enter')
  await expect(page.locator(`li[data-traffic-node="${ROTA}"]`)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Раскрыть Штаб бригады' })).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page.getByText('Первая рота')).toBeVisible()

  // Дальше по дереву — следующая раскрывашка в порядке документа.
  await page.keyboard.press('Tab')
  const rotaToggle = page.getByRole('button', { name: 'Раскрыть Первая рота' })
  await expect(rotaToggle).toBeFocused()

  // Space на кнопке — второй нативный канал (срабатывает на keyup).
  await page.keyboard.press(' ')
  await expect(page.getByText('Взвод связи')).toBeVisible()
  await expect(rotaToggle).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Свернуть Первая рота' })).toBeFocused()
})

test('AC-10: фокус ПЕРЕЖИВАЕТ polling-перечитку, раскладка не схлопывается', async ({
  page,
}) => {
  // AC-10 требует «фокус не теряется при перечитке», и это единственное место,
  // где такая проверка не вакуумна: в jsdom фокус живёт по своим правилам.
  // Часы браузера подменены, чтобы не ждать 30 реальных секунд; fastForward
  // прыгает вперёд и роняет ровно один назревший таймер опроса.
  await page.clock.install()

  const ROTA = '33333333-3333-4333-8333-333333333333'
  const VZVOD = '44444444-4444-4444-8444-444444444444'
  const traffic = await stubTree(page, [
    node({ division_id: SHTAB, name: 'Штаб бригады', status: 'RED' }),
    node({ division_id: ROTA, name: 'Первая рота', parent_id: SHTAB, status: 'RED' }),
    node({ division_id: VZVOD, name: 'Взвод связи', parent_id: ROTA, status: 'RED' }),
  ])
  await page.goto(HARNESS)

  await page.getByRole('button', { name: 'Раскрыть Первая рота' }).click()
  await expect(page.getByText('Взвод связи')).toBeVisible()

  const focused = page.getByRole('button', { name: 'Свернуть Первая рота' })
  await focused.focus()
  await expect(focused).toBeFocused()
  expect(traffic.gets).toBe(1)

  await page.clock.fastForward(POLL_MS)
  // Перечитка РЕАЛЬНО ушла — иначе тест ниже проверял бы «фокус пережил ничто».
  await expect.poll(() => traffic.gets).toBe(2)

  await expect(focused).toBeFocused()
  await expect(page.getByText('Взвод связи')).toBeVisible()
})

test('AC-8: НАСТОЯЩИЙ 500 на опросе не стирает уже показанное дерево — баннер поверх', async ({
  page,
}) => {
  // Худший исход экрана наблюдения: в разгар смены фоновый опрос спотыкается и
  // картина готовности гаснет. jsdom-сюита это судит через MSW; здесь отказ
  // настоящий — реальный не-2xx проходит боевой parseErrorResponse в браузере,
  // и `data` с `isError` обязаны ужиться (не «или-или»).
  await page.clock.install()

  const ROTA = '33333333-3333-4333-8333-333333333333'
  const nodes: NodeFixture[] = [
    node({ division_id: SHTAB, name: 'Штаб бригады', status: 'RED' }),
    node({ division_id: ROTA, name: 'Первая рота', parent_id: SHTAB, status: 'RED' }),
  ]

  // Первый ответ штатный, ВТОРОЙ (тот, что придёт по расписанию) — 500 с
  // конвертом §36. Ронять первый было бы другим тестом: рушить нечего.
  let gets = 0
  await page.route('**/api/operations/traffic-light/tree/**', async (route) => {
    gets += 1
    if (gets === 1) {
      await route.fulfill({ json: { business_date: '2026-07-19', nodes } })
      return
    }
    await route.fulfill({
      status: 500,
      json: {
        error_code: 'INTERNAL_ERROR',
        message: 'Сервис временно недоступен.',
        details: {},
        request_id: 'req-e2e-10-4',
        timestamp: '2026-07-19T08:00:00+05:00',
      },
    })
  })

  await page.goto(HARNESS)
  await expect(page.getByText('Первая рота')).toBeVisible()

  await page.clock.fastForward(POLL_MS)
  await expect.poll(() => gets).toBe(2)

  // Баннер поднялся…
  await expect(page.getByRole('alert')).toContainText(
    'Не удалось загрузить дерево готовности.',
  )
  // …а дерево под ним ЖИВО. Обнуление здесь означало бы пустой экран у
  // руководителя ровно в тот момент, когда картина нужнее всего.
  await expect(page.getByText('Штаб бригады')).toBeVisible()
  await expect(page.getByText('Первая рота')).toBeVisible()
  await expect(mountedNodes(page)).toHaveCount(2)
})

test('AC-4: 400 подразделений — свёрнутое НЕ в DOM, раскрытие не шлёт ни одного запроса', async ({
  page,
}) => {
  // Часы замораживаются (install без fastForward): без этого фоновый опрос сам
  // инкрементил бы счётчик запросов и ассерт «раскрытие не шлёт запросов» стал
  // бы флейком — ловушка, названная в Task 6 стори.
  await page.clock.install()

  // 1 корень + 19 рот × 20 взводов = ровно 400 (форма из перф-фикстуры стори).
  const nodes: NodeFixture[] = [node({ division_id: SHTAB, name: 'Штаб бригады' })]
  const companyIds: string[] = []
  for (let c = 0; c < 19; c += 1) {
    const companyId = `c${String(c).padStart(3, '0')}`
    companyIds.push(companyId)
    nodes.push(
      node({ division_id: companyId, name: `Рота ${c + 1}`, parent_id: SHTAB }),
    )
    for (let p = 0; p < 20; p += 1) {
      nodes.push(
        node({
          division_id: `${companyId}-p${p}`,
          name: `Взвод ${c + 1}-${p + 1}`,
          parent_id: companyId,
        }),
      )
    }
  }
  expect(nodes).toHaveLength(400)

  const traffic = await stubTree(page, nodes)
  await page.goto(HARNESS)
  await expect(page.getByText('Штаб бригады')).toBeVisible()

  // Дефолт — раскрыт только корень: смонтированы корень + 19 рот, взводов нет.
  await expect(mountedNodes(page)).toHaveCount(20)
  expect(traffic.gets).toBe(1)

  // exact: по умолчанию имя матчится подстрокой, и «Рота 1» поймала бы ещё и
  // «Рота 10…19» — strict mode это ловит, но лечится именно точным именем.
  await page.getByRole('button', { name: 'Раскрыть Рота 1', exact: true }).click()
  await expect(page.getByText('Взвод 1-1', { exact: true })).toBeVisible()

  // Раскрылась ОДНА ветка: +20 взводов, а не всё дерево.
  await expect(mountedNodes(page)).toHaveCount(40)
  // И ни одного нового запроса: данные пришли одним ответом, ленив РЕНДЕР, а
  // не загрузка (дозагрузка на раскрытии была бы изобретённым N+1).
  expect(traffic.gets, 'раскрытие ветки ушло в сеть — это ленивая ЗАГРУЗКА').toBe(1)

  // Сворачивание РАЗМОНТИРУЕТ поддерево — узлы не копятся в DOM.
  await page.getByRole('button', { name: 'Свернуть Рота 1', exact: true }).click()
  await expect(mountedNodes(page)).toHaveCount(20)
})
