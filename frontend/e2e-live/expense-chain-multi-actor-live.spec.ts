// Story 10.10a — та же цепочка целиком (10.10), но РЕАЛЬНЫМИ ролями вместо
// одного ADMIN: bulk-обновление статусов — ADMIN (`status.manage`), сдача дня
// + светофор — `DIVISION_OPERATOR` (`daily_report.mark_update`+`status.view`),
// выпуск + скачивание расхода — `ORGD` (`daily_report.generate`).
//
// ОТДЕЛЬНЫЙ файл, не правка `expense-chain-live.spec.ts` (AC-6, 10.10a):
// тот спек уже прошёл красную пробу и явно заявляет себя «ЕДИНСТВЕННЫМ тестом
// с одним актором на весь путь» — переписывать его под мультиактёрность
// противоречило бы этому заявлению. Хелперы (`seed`/`watch`/`openSection`/
// `trafficNode`/`trafficLabel`) — ЛОКАЛЬНЫЕ копии (тот же приём, что решение
// №4 родительской стори «новый вход, не переиспользование»).
//
// AC-5: НЕ дублирует детальные ассерты байт/дат родительской стори — тот факт
// уже доказан 10.10. Здесь предмет — переключение РЕАЛЬНЫХ ролей и негативный
// путь 403 (AC-4), не повторная проверка «файл валиден».
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

import { LIVE_ENV } from '../playwright.live.config'

const HARNESS = 'http://localhost:4174/e2e-harness/chain.html'

const BACKEND_DIR = fileURLToPath(new URL('../../Backend/VAPS', import.meta.url))
const PYTHON = '.venv/bin/python'

test.use({ timezoneId: 'Asia/Qyzylorda' })

// Зеркало родительского спека: DUTY — единственный код, безопасный и для bulk
// (не HARD_BLOCK), и для сходимости чисел (не ATTACHED/DETACHED/IN_SERVICE).
const STATUS_CODE = 'DUTY'

interface Seed {
  day: string
  divisionId: string
  actor: string
  operatorActor: string
  issuerActor: string
  employees: number
}

/** Сид дочерним процессом — зеркало `expense-chain-live.spec.ts`'s `seed()`,
 * читает ДВЕ ДОПОЛНИТЕЛЬНЫЕ переменные (10.10a). */
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
    operatorActor: read('OPERATOR_ACTOR', String.raw`[\x21-\x7e]+`),
    issuerActor: read('ISSUER_ACTOR', String.raw`[\x21-\x7e]+`),
    employees: Number(read('EMPLOYEES', String.raw`\d+`)),
  }
}

interface Traffic {
  treeGets: string[]
  bulkPosts: number[]
  browserActors: string[]
}

function watch(page: Page): Traffic {
  const traffic: Traffic = { treeGets: [], bulkPosts: [], browserActors: [] }
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
    // Массив (не Set, в отличие от родителя): здесь актор МЕНЯЕТСЯ по ходу
    // теста, и порядок/последнее значение — несущий факт для `switchActor`.
    traffic.browserActors.push(request.headers()['x-user-id'] ?? '')
  })
  return traffic
}

async function openSection(page: Page, label: string) {
  await page
    .getByRole('navigation', { name: 'Разделы' })
    .getByRole('link', { name: label })
    .click()
}

function trafficNode(page: Page, divisionId: string) {
  return page.locator(`li[data-traffic-node="${divisionId}"]`)
}

function trafficLabel(page: Page, divisionId: string, label: string) {
  return trafficNode(page, divisionId).getByText(label, { exact: true })
}

/**
 * Переключение актора — Story 10.10a AC-1. Живой вызов `setCredential` через
 * харнес-хук `window.__e2eSetActor` (chain.tsx), БЕЗ `page.reload()`: credential
 * реактивен (`useSyncExternalStore`), навигаций между шагами нет (`MemoryRouter`).
 *
 * `expect.poll` ПОСЛЕ переключения — не на факт вызова evaluate, а на то, что
 * СЛЕДУЮЩИЙ реальный HTTP-запрос браузера ушёл под НОВЫМ актором: сам evaluate
 * не гарантирует, что уже стартовавший запрос (например, background refetch)
 * не проскочит со СТАРЫМ заголовком между вызовом и следующим взаимодействием.
 */
async function switchActor(page: Page, traffic: Traffic, userId: string) {
  const callsBefore = traffic.browserActors.length
  await page.evaluate((id) => {
    ;(window as unknown as { __e2eSetActor: (c: unknown) => void }).__e2eSetActor({
      kind: 'dev',
      userId: id,
    })
  }, userId)
  await expect
    .poll(() => traffic.browserActors.length, {
      message: 'после переключения актора браузер не сделал ни одного запроса',
    })
    .toBeGreaterThan(callsBefore)
  expect(
    traffic.browserActors[traffic.browserActors.length - 1],
    'последний запрос ушёл не под тем актором, на которого переключились',
  ).toBe(userId)
}

test('оператор проходит цепочку целиком РЕАЛЬНЫМИ ролями: ADMIN(bulk) → DIVISION_OPERATOR(сдача+светофор) → ORGD(расход)', async ({
  page,
}) => {
  const { day, divisionId, actor, operatorActor, issuerActor, employees } = seed()

  const traffic = watch(page)
  await page.goto(HARNESS)

  // Харнес стартует захардкоженным ADMIN-актором (chain.tsx) — тот же пин к
  // сиду, что 10.10.
  await expect
    .poll(() => traffic.browserActors.length, {
      message: 'браузер не сделал ни одного запроса — пин к сиду был бы вакуумен',
    })
    .toBeGreaterThan(0)
  expect(traffic.browserActors[0]).toBe(actor)

  await page.getByLabel('Подразделение').selectOption(divisionId)
  await expect(page.getByTestId('changed-counter')).toBeVisible()

  // ───────────────────── ШАГ 1. Правка грида — под ЛЮБЫМ актором (клиентский
  // dirtyCount, серверу ничего не уходит до клика «Сохранить правки»).
  await page.locator('[data-grid-row]').first().click()
  await page.keyboard.press('Enter')
  await page.getByLabel('Статус').selectOption(STATUS_CODE)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('changed-counter')).toHaveText(
    new RegExp(`Изменено 1 из ${employees}`),
  )

  // ───────── ШАГ 2 (AC-4). Негативный путь: DIVISION_OPERATOR НЕ проходит
  // bulk-сохранение (status.manage отсутствует, красная проба №5 10.10).
  // Формализуется как ПОСТОЯННАЯ регресс-защита, не разовая проверка.
  await switchActor(page, traffic, operatorActor)
  await page.getByRole('button', { name: 'Сохранить правки' }).click()
  await expect
    .poll(
      () =>
        traffic.bulkPosts[traffic.bulkPosts.length - 1] === 403
          ? 403
          : traffic.bulkPosts.length,
      {
        message:
          'DIVISION_OPERATOR должен получить 403 на bulk — если это не так, ' +
          'RBAC-модель изменилась и AC эпика 10.6/10.10a нужно пересмотреть',
      },
    )
    .toBe(403)

  // ──────────── ШАГ 3. Переключение на ADMIN — РЕАЛЬНОЕ bulk-сохранение.
  // Правка из ШАГа 1 остаётся в клиентском dirtyCount (403 не откатывает
  // локальное состояние грида — сервер её не принял, значит и не обязан).
  await switchActor(page, traffic, actor)
  await page.getByRole('button', { name: 'Сохранить правки' }).click()
  await expect(page.getByText('Применено 1 отклонений')).toBeVisible()
  expect(
    traffic.bulkPosts,
    'массовое обновление под ADMIN не доехало до сервера 201-м ответом',
  ).toEqual([403, 201])

  // ───────────────────────────────────── ШАГ 4. Сдача дня — DIVISION_OPERATOR.
  await switchActor(page, traffic, operatorActor)
  await openSection(page, 'Расход дня')
  await page.getByLabel('Подразделение').selectOption(divisionId)
  await expect(page.getByTestId('changed-counter')).toBeVisible()

  await page.getByRole('button', { name: 'Сдать день' }).click()
  await page.getByRole('button', { name: 'Подтвердить сдачу' }).click()
  await expect(page.getByTestId('day-submission-state')).toContainText('День сдан')

  // ────────────────────────────── ШАГ 5. Светофор — ЗЕЛЁНЫЙ, DIVISION_OPERATOR
  // (держит status.view). Точное совпадение метки — тот же приём, что красная
  // проба №2 родительской стори: подстрока 'сдано' цепляет и YELLOW.
  await openSection(page, 'Подразделения')
  await expect(trafficLabel(page, divisionId, 'сдано')).toBeVisible()
  await expect(trafficNode(page, divisionId)).not.toContainText('разошёлся')

  // ──────────────────────────── ШАГ 6. Выпуск + скачивание расхода — ORGD.
  await switchActor(page, traffic, issuerActor)
  await openSection(page, 'Отчёты')
  await page.getByLabel('Подразделение').selectOption(divisionId)
  await expect(page.getByLabel('Дата')).toHaveValue(day)

  await page.getByRole('button', { name: 'Сформировать' }).click()
  await expect(page.getByText(/^Расход готов\. Исх\.№ \d+\.$/)).toBeVisible()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать' }).click(),
  ])
  // AC-5: НЕ повторяет байтовую/сигнатурную проверку 10.10 — здесь предмет
  // ролей, не генератора. Достаточно факта: файл СКАЧАН тем актором, у
  // которого реально есть document.view (ORGD).
  expect(download.suggestedFilename()).toMatch(
    new RegExp(String.raw`^расход_${day}_исх-\d+\.docx$`),
  )
})
