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
      lastCommitsPerKey: number
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
  await expect(
    page.locator('[data-grid-row]', { hasText: 'Сотрудник 0' }),
  ).toHaveAttribute('aria-rowindex', '1')

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
    if (row === 10) {
      // Середина серии: окно уже проскроллено реальным scrollToIndex —
      // виртуализация держит бюджет прямо ПО ХОДУ ввода (AC2).
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

test('ConflictDialog: реальная showModal-модальность — фокус внутри, фон inert, Esc = «Отмена», soft-маркер остаётся', async ({
  page,
}) => {
  // К строке-фикстуре e42 (вне слепой серии AC1 — ревью-C4) только клавиатурой.
  for (let i = 0; i < 42; i++) await page.keyboard.press('ArrowDown')
  await pressCyr(page, 'н') // EDIT + значение «На больничном»
  await page.keyboard.press('Enter') // COMMIT → seam вернёт soft-409 → CONFLICT

  const dialog = page.locator('dialog[open]')
  await expect(dialog).toBeVisible()

  // Фокус УШЁЛ внутрь диалога (нативный showModal focus-trap) — jsdom-полифилл
  // 9.5 этого доказать не мог, ради этого ассерта и существует 9.9.
  const focusInsideDialog = await page.evaluate(
    () => document.activeElement?.closest('dialog[open]') !== null,
  )
  expect(focusInsideDialog).toBe(true)

  // Inert-фон: сид мимо диалога грид НЕ меняет (значение ячейки как было).
  await pressCyr(page, 'о')
  const fixtureRow = page.locator('[data-grid-row]', {
    hasText: 'Сотрудник 42',
  })
  await expect(fixtureRow).toContainText('На больничном')
  await expect(fixtureRow).not.toContainText('Отпуск')

  // Esc = «Отмена»: диалог закрыт, значение ОТКАТИЛОСЬ к pre-edit («В строю»),
  // soft-маркер ОСТАЁТСЯ (замороженная семантика 9.6 AC-3 — снимает только
  // «Подтвердить оверрайд»), фокус вернулся в ячейку грида.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(fixtureRow).toContainText('В строю')
  await expect(fixtureRow).toHaveAttribute('data-marker', 'soft')
  const focusBackInGrid = await page.evaluate(
    () => document.activeElement?.closest('[data-grid-row]') !== null,
  )
  expect(focusBackInGrid).toBe(true)
})

test('перф-тренд под CDP-троттлингом: edit=1 коммит (блокирующе); p95/каскад → артефакт', async ({
  page,
}) => {
  // CDP CPU-троттлинг ×4 (Д4) — эмуляция слабого железа контура.
  const cdp = await getCdp(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  // --- Edit-серия: 60 сидов в ОДНОЙ ячейке (н↔в реально переключают значение
  // каждым нажатием — вакуум-урок ревью 9.8), скролла нет.
  const beforeEdit = await e2eState(page)
  for (let i = 0; i < 60; i++) {
    await pressCyr(page, i % 2 === 0 ? 'н' : 'в')
  }
  // Дать async-хвосту докатиться (урок BUDGET.md §6.5), затем строгий ассерт.
  await page.waitForTimeout(300)
  const afterEdit = await e2eState(page)
  // БЛОКИРУЮЩИЙ детерминированный инвариант (L246): ровно 1 коммит/edit-нажатие.
  expect(afterEdit.commits - beforeEdit.commits).toBe(60)

  // --- Навигационная серия: 40×ArrowDown из EDIT? Нет: выходим коммитом и
  // едем вниз через границу окна (реальный scrollToIndex → возможный каскад).
  await page.keyboard.press('Escape') // EDIT → NAVIGATE (RESTORE_PRE_EDIT)
  const beforeNav = await e2eState(page)
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('ArrowDown')
  }
  await page.waitForTimeout(300)
  const afterNav = await e2eState(page)
  const navCommits = afterNav.commits - beforeNav.commits

  // --- Артефакт тренда (НЕ блокирующий, L246; Q1 — порог назначается после
  // первого факта). Закрывает PENDING-перепрогон спайка 1.10 §7 реальным числом.
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
      user_agent: navigator.userAgent,
    }
  })
  const artefact = {
    story: '9.9',
    generated_at: new Date().toISOString(),
    cdp_cpu_throttle: 4,
    note: 'dev-тренд (chromium, троттлинг ×4) — НЕ бюджет; бюджет = BUDGET.md §4 PENDING-target (FF100/4ГБ, ручной прогон)',
    edit_series: {
      keystrokes: 60,
      commits: afterEdit.commits - beforeEdit.commits,
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
  // Санити артефакта (не тайминг): выборка латентности реально собралась.
  expect(perf.samples_n).toBeGreaterThanOrEqual(100)
})
