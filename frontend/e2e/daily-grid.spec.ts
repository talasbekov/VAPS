// Story 9.9 — e2e слепого ввода: реальный chromium против прод-сборки харнеса
// (порт 4174, dist-e2e). Всё, что jsdom не может: реальная виртуализация и
// скролл, showModal-модальность (deferred 9.5), перф-тренд под CDP-троттлингом
// (deferred 9.8). «→БД» = 10.2 (Ловушка №2 спеки) — здесь payload-контракт.
// Дисциплина AC1: в гриде НИ ОДНОГО mouse-действия — только page.keyboard;
// «Сдать день» вне грида активируется программным focus()+Enter (Ловушка №6:
// Tab из грида не выводит — грамматика клампит, deferred 9.4 → Q4/10.2).
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type CDPSession, type Page } from '@playwright/test'

// Абсолютный URL: глобальный baseURL (4173) принадлежит print-спекам 8.8.
const HARNESS = 'http://localhost:4174/e2e-harness/index.html'
const BUSINESS_DATE = '2026-07-14'

// Расчётный DOM-бюджет реального браузера (ревью-прецедент 9.8 P3 — не магия):
// h-96=384px / ROW_HEIGHT=36 → ⌈384/36⌉=11 видимых + 2·OVERSCAN(8) + пин
// фокусной (rangeExtractor 9.5) + частичная ≈ 29; люфт до 34.
const DOM_BUDGET = 34

declare global {
  interface Window {
    __e2e: {
      commits: number
      keys: number
      maxCommitsPerKey: number
      samples: number[]
      lastBulkRequest: {
        business_date: string
        rows: {
          employee_id: string
          status_type_code: string
          date_start: string
          date_end: string
        }[]
      } | null
    }
  }
}

// Кириллические сиды (Ловушка №4: латиница не матчится toLocaleLowerCase('ru')).
// Prefill всех строк = IN_SERVICE «В строю» → н/о/к всегда dirty-дельта.
const SEEDS = [
  { key: 'н', code: 'SICK_LEAVE' },
  { key: 'о', code: 'VACATION' },
  { key: 'к', code: 'COMMAND' },
] as const

// ISO-периоды (O1 спеки: не-ISO ушёл бы в date_end как есть — громкий 422
// by-design 9.7); «включительно» → date_end = период+1д.
const PERIODS: Record<number, { typed: string; dateEnd: string }> = {
  3: { typed: '2026-07-20', dateEnd: '2026-07-21' },
  8: { typed: '2026-07-25', dateEnd: '2026-07-26' },
  15: { typed: '2026-08-01', dateEnd: '2026-08-02' },
}

// Кириллический сид: page.keyboard.press знает только US-раскладку — шлём
// через реальный CDP-пайплайн ввода (keydown несёт event.key = 'н' и т.д.).
// Ограничение: event.code пуст — если грамматика когда-нибудь обопрётся на
// e.code (layout-независимость), CDP-ввод сломается молча (грид сейчас читает
// только e.key — DailyGrid.tsx toKey).
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

async function gridRowCount(page: Page): Promise<number> {
  return page.evaluate(
    () => document.querySelectorAll('[data-grid-row]').length,
  )
}

async function e2eState(page: Page) {
  return page.evaluate(() => ({
    commits: window.__e2e.commits,
    keys: window.__e2e.keys,
    maxCommitsPerKey: window.__e2e.maxCommitsPerKey,
    samplesCount: window.__e2e.samples.length,
  }))
}

// Дождаться, пока счётчик коммитов стабилен два замера подряд (ревью 9.9 P3):
// async-хвост маунта (ResizeObserver initialRect→384px) или каскад
// scrollToIndex должны докатиться ДО снапшота — иначе строгий toBe(N) флейкует
// под троттлингом ×4. Заменяет магический waitForTimeout(300).
async function settleCommits(page: Page) {
  let prev = -1
  for (;;) {
    const c = await page.evaluate(() => window.__e2e.commits)
    if (c === prev) return
    prev = c
    await page.waitForTimeout(80)
  }
}

// aria-rowindex активной (сфокусированной) строки грида, или null если фокус
// вне строки. Позиционная привязка серий (прецедент 9.5 — не «мутный таймаут»).
async function activeRowIndex(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return null
    const row = active.closest('[data-grid-row]')
    const raw = row?.getAttribute('aria-rowindex')
    return raw ? Number(raw) : null
  })
}

async function focusInside(page: Page, selector: string): Promise<boolean> {
  // instanceof-гард обязателен (ревью 9.9 P1): `activeElement?.closest() !==
  // null` даёт undefined!==null=true при фокусе В НИКУДА — ассерт стал бы
  // вакуумным ровно там, ради чего 9.9 и существует.
  return page.evaluate((sel) => {
    const active = document.activeElement
    return active instanceof HTMLElement && active.closest(sel) !== null
  }, selector)
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS)
  // Грид сам фокусирует активную ячейку на маунте (layout-эффект 9.5) —
  // харнес НЕ трогает фокус; ждём готовности точки опоры слепого ввода.
  await page.waitForFunction(() => {
    const active = document.activeElement
    return (
      active instanceof HTMLElement &&
      active.hasAttribute('data-active') &&
      active.closest('[data-grid-row]') !== null
    )
  })
})

test('слепой ввод 20 строк только клавиатурой → bulk-payload РОВНО соответствует вводу', async ({
  page,
}) => {
  // Стартовая точка: ячейка статуса строки 0 (aria-rowindex 1).
  expect(await activeRowIndex(page)).toBe(1)

  for (let row = 0; row < 20; row++) {
    const seed = SEEDS[row % SEEDS.length]
    // NAVIGATE+Char → EDIT + type-ahead (значение выставлено этим же нажатием)
    await pressCyr(page, seed.key)
    const period = PERIODS[row]
    if (period) {
      // EDIT+Tab → COMMIT статуса + вправо (колонка «Период», NAVIGATE)
      await page.keyboard.press('Tab')
      // NAVIGATE+Enter на периоде → PERIOD_EDIT (нативный input)
      await page.keyboard.press('Enter')
      // Цифры/дефис проходят в input (Char в PERIOD_EDIT = NOOP грамматики)
      await page.keyboard.type(period.typed)
      // PERIOD_EDIT+Enter → COMMIT + вниз (колонка остаётся «Период»)
      await page.keyboard.press('Enter')
      // Назад в колонку «Статус» для следующей строки
      await page.keyboard.press('ArrowLeft')
    } else {
      // EDIT+Enter → COMMIT + вниз, колонка «Статус» сохраняется
      await page.keyboard.press('Enter')
    }
    if (row === 15) {
      // ПО ХОДУ ввода (ревью P8): ввод реально уехал через границу окна
      // (фокус на строке 16, не в стартовом окне) И бюджет держится —
      // сломанная виртуализация к этому моменту накопила бы строки >34
      // (проба overscan 8→40 в 9.8 показала: 34 ловит 3× регрессию).
      await settleCommits(page)
      expect(await activeRowIndex(page)).toBe(17) // строка 16 = rowindex 17
      expect(await gridRowCount(page)).toBeLessThanOrEqual(DOM_BUDGET)
    }
  }

  // AC2: после 20 строк фокус на строке 20 — начало списка ушло за окно.
  // Строка 0 НЕ запинена (фокус давно не на ней) — обязана анмаунтиться.
  const rowsAfterInput = await gridRowCount(page)
  expect(rowsAfterInput).toBeGreaterThanOrEqual(11)
  expect(rowsAfterInput).toBeLessThanOrEqual(DOM_BUDGET)
  await expect(page.getByText('Сотрудник 20', { exact: true })).toBeVisible()
  await expect(page.getByText('Сотрудник 0', { exact: true })).toHaveCount(0)

  // Счётчик отклонений (9.4): изменено ровно 20 из 500.
  await expect(page.getByTestId('changed-counter')).toContainText(
    'Изменено 20 из 500',
  )

  // «Сдать день»: кнопка ВНЕ грида; программный focus()+Enter — мышь в гриде
  // не использована ни разу (Ловушка №6, Q4 — клавиатурный выход = 10.2).
  const submit = page.getByRole('button', { name: 'Сдать день' })
  await submit.focus()
  await page.keyboard.press('Enter')

  const payload = await page.evaluate(() => window.__e2e.lastBulkRequest)
  expect(payload).not.toBeNull()
  expect(payload!.business_date).toBe(BUSINESS_DATE)
  // РОВНО 20 дельт — в порядке rows-массива (порядок `changed` 9.4).
  expect(payload!.rows).toEqual(
    Array.from({ length: 20 }, (_, row) => ({
      employee_id: `e${row}`,
      status_type_code: SEEDS[row % SEEDS.length].code,
      date_start: BUSINESS_DATE,
      date_end: PERIODS[row]?.dateEnd ?? '2026-07-15',
    })),
  )
})

test('ConflictDialog: showModal-модальность — фокус внутри, фон inert, Esc = «Отмена» (маркер остаётся), оверрайд снимает маркер', async ({
  page,
}) => {
  // К строке-фикстуре e42 (вне слепой серии AC1 — ревью-C4) только клавиатурой;
  // позиционный ассерт ПЕРЕД ударом (ревью P6: потерянная стрелка = внятный
  // провал здесь, а не мутный таймаут на невидимом диалоге).
  for (let i = 0; i < 42; i++) await page.keyboard.press('ArrowDown')
  expect(await activeRowIndex(page)).toBe(43) // строка e42 = rowindex 43
  await pressCyr(page, 'н') // EDIT + значение «На больничном»
  await page.keyboard.press('Enter') // COMMIT → seam вернёт soft-409 → CONFLICT

  const dialog = page.locator('dialog[open]')
  await expect(dialog).toBeVisible()

  // Диалог реально МОДАЛЬНЫЙ (showModal, не show): `:modal` истинно только для
  // top-layer showModal — жёсткий дискриминатор (красная проба showModal→show
  // роняет именно этот ассерт; focus-in-dialog один show бы не отличил).
  // jsdom-полифилл 9.5 модальность доказать не мог — ради этого 9.9 и есть.
  expect(
    await page.evaluate(
      () => document.querySelector('dialog[open]')?.matches(':modal') ?? false,
    ),
  ).toBe(true)
  // Фокус УШЁЛ внутрь диалога (нативный focus-trap top-layer).
  expect(await focusInside(page, 'dialog[open]')).toBe(true)

  const fixtureRow = page.locator('[data-grid-row]', {
    hasText: 'Сотрудник 42',
  })
  // Inert-фон: сид мимо диалога грид НЕ меняет. Барьер перед негативным
  // ассертом (ревью P6) — окно на обработку события, затем проверка, что
  // значение НЕ уехало.
  await pressCyr(page, 'о')
  await page.waitForTimeout(100)
  await expect(fixtureRow).toContainText('На больничном')
  await expect(fixtureRow).not.toContainText('Отпуск')

  // Esc = «Отмена»: диалог закрыт, значение ОТКАТИЛОСЬ к pre-edit («В строю»),
  // soft-маркер ОСТАЁТСЯ (замороженная семантика 9.6 AC-3), фокус в ячейке.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(fixtureRow).toContainText('В строю')
  await expect(fixtureRow).toHaveAttribute('data-marker', 'soft')
  expect(await focusInside(page, '[data-grid-row]')).toBe(true)

  // Override-ветка (ревью P6/Task 4): снова открыть конфликт, набрать причину
  // (BR-003: 10–500 символов) и «Подтвердить оверрайд» — маркер СНЯТ, значение
  // принято. Это браузерный override-путь, jsdom 9.5/9.6 его не покрывал.
  await pressCyr(page, 'н')
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  const reason = dialog.getByLabel('Причина (10–500 символов)')
  await reason.fill('Наряд сокращён по приказу №42 от 14.07 (e2e-проверка)')
  const overrideBtn = dialog.getByRole('button', {
    name: 'Подтвердить оверрайд',
  })
  await overrideBtn.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  // Маркер снят (overrideConflict → clearMarker), значение принято.
  await expect(fixtureRow).not.toHaveAttribute('data-marker', 'soft')
  await expect(fixtureRow).toContainText('На больничном')
})

test('перф-тренд под CDP-троттлингом: edit=1 коммит/нажатие (блокирующе); p95/каскад → артефакт', async ({
  page,
  browser,
}) => {
  // CDP CPU-троттлинг ×4 (Д4) — эмуляция слабого железа контура.
  const cdp = await getCdp(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  // Дождаться async-хвоста маунта (RO initialRect→384px) ДО снапшота, иначе
  // хвостовой коммит лёг бы в edit-окно → 61≠60 (ревью P3).
  await settleCommits(page)

  // --- Edit-серия: 60 сидов в ОДНОЙ ячейке (н↔в реально переключают значение
  // каждым нажатием — вакуум-урок ревью 9.8), скролла нет.
  const beforeEdit = await e2eState(page)
  for (let i = 0; i < 60; i++) {
    await pressCyr(page, i % 2 === 0 ? 'н' : 'в')
  }
  await settleCommits(page) // хвост докатился — строгий счёт честен (ревью P3)
  const afterEdit = await e2eState(page)
  const editCommits = afterEdit.commits - beforeEdit.commits
  // БЛОКИРУЮЩИЙ детерминированный инвариант (L246): ровно 1 коммит на нажатие,
  // проверяется И суммой, И пиком (ревью P4: сумма 60 прошла бы для 0,2,0,2…;
  // max=1 к этому моменту — nav-каскад ещё не бежал).
  const editMaxPerKey = afterEdit.maxCommitsPerKey

  // --- Навигационная серия: выйти из EDIT и ехать вниз через границу окна
  // (реальный scrollToIndex → возможный каскад). beforeNav := afterEdit —
  // между сериями нет непокрытой щели (ревью P3).
  await page.keyboard.press('Escape') // EDIT → NAVIGATE (RESTORE_PRE_EDIT)
  await settleCommits(page)
  const beforeNav = await e2eState(page)
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('ArrowDown')
  }
  await settleCommits(page)
  const afterNav = await e2eState(page)
  const navCommits = afterNav.commits - beforeNav.commits
  // Нав-серия РЕАЛЬНО двигала фокус (ревью P5: без этого 0-каскад = вакуум).
  expect(await activeRowIndex(page)).toBeGreaterThan(40)

  // --- Артефакт тренда СОБРАН И ЗАПИСАН ДО блокирующих ассертов (ревью P7:
  // при регрессе edit-инварианта интересные перф-данные не должны теряться,
  // стейл-файл не должен маскировать провал).
  const perf = await page.evaluate(() => {
    const sorted = [...window.__e2e.samples].sort((a, b) => a - b)
    const rank = (q: number) =>
      sorted.length ? sorted[Math.floor(q * (sorted.length - 1))] : null
    return {
      samples_n: sorted.length,
      p50_ms: rank(0.5),
      p95_ms: rank(0.95),
      max_ms: sorted.length ? sorted[sorted.length - 1] : null,
      max_commits_per_key: window.__e2e.maxCommitsPerKey,
      dom_rows: document.querySelectorAll('[data-grid-row]').length,
      keys: window.__e2e.keys,
    }
  })
  const artefact = {
    story: '9.9',
    generated_at: new Date().toISOString(),
    cdp_cpu_throttle: 4,
    note: 'dev-тренд (chromium, троттлинг ×4) — НЕ бюджет; бюджет = BUDGET.md §4 PENDING-target (FF100/4ГБ, ручной прогон)',
    // Метаданные окружения (ревью P7: реальные, не спуфнутый UA-override).
    env: { platform: process.platform, chromium: browser.version() },
    edit_series: {
      keystrokes: 60,
      commits: editCommits,
      max_commits_per_key: editMaxPerKey,
    },
    nav_series: {
      keystrokes: 40,
      commits: navCommits,
      commits_per_keystroke: navCommits / 40,
    },
    ...perf,
  }
  const outDir = fileURLToPath(new URL('../test-results', import.meta.url))
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    fileURLToPath(new URL('../test-results/perf-trend.json', import.meta.url)),
    JSON.stringify(artefact, null, 2),
  )

  // Блокирующие детерминированные инварианты — ПОСЛЕ записи артефакта.
  expect(editCommits).toBe(60)
  expect(editMaxPerKey).toBe(1)
  // Санити артефакта (детерминированный, не тайминг): выборка собралась и
  // нав-серия реально коммитила (ревью P5).
  expect(perf.samples_n).toBeGreaterThanOrEqual(90)
  expect(navCommits).toBeGreaterThanOrEqual(40)
})
