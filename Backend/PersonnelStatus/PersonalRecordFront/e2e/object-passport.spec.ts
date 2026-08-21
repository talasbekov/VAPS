/**
 * Паспорт объекта на ЖИВОМ стенде.
 *
 * Проба отвечает на шесть вопросов:
 *
 * 1. вкладки прототипа переключают содержимое, состояние живёт в адресе и
 *    переживает перезагрузку, а умолчание в адрес НЕ пишется — и все ШЕСТЬ
 *    вкладок прототипа видны, а не только три живых;
 * 2. «Общие данные» и срок проверки сходятся с ответами сервера — причём
 *    свежесть берётся по СВОЕМУ объекту, а не первой строкой конверта;
 * 3. баннер неготовности появляется ровно тогда, когда так сказал сервер, и
 *    молчит на зелёном объекте с соблюдённым сроком;
 * 4. «Чего в этом паспорте нет» печатает причины сервера ЕГО словами, и
 *    больше НЕ называет три вкладки, у которых теперь есть свой макет;
 * 5. три вкладки без бэка («Инфраструктура», «Чек-лист», «Привлекаемые
 *    группы») рисуют макет прототипа и по одной честной строке причины —
 *    ДОСЛОВНО, не подстрокой;
 * 6. набранный черновик на «Посты и секторы» переживает уход через ЛЮБУЮ
 *    вкладку, включая новые макетные, — вкладки прячутся `hidden`, а не
 *    снимаются условным рендером.
 *
 * 🔴 Service worker MSW блокируется на весь файл: без этого запросы идут через
 * воркер, и сверка с живым ответом проверяла бы мок. Разделу ОМ мок не нужен.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SCREEN = '/security-ops/objects'

// Пин дословно совпадает с константами на экране
// (features/object-passport/ui/PassportPlannedTabs.tsx) — проба ловит
// расхождение текста, а не только факт наличия какой-то строки.
const PLANNED_TABS: ReadonlyArray<{ code: string; label: string; honestLine: string }> = [
  {
    code: 'infra',
    label: 'Инфраструктура',
    honestLine:
      'Входы и выходы, транспорт, вертикальные коммуникации, инженерные системы, уязвимые места и ремонтные работы объекта в модели не хранятся — ни таблиц, ни ручек нет; появится бэк-этапом.',
  },
  {
    code: 'check',
    label: 'Чек-лист',
    honestLine:
      'Контрольных вопросов, ответов «да / нет / не применимо» и решения по расчёту постов в бэке нет — дата проверки в шапке паспорта считается политикой свежести от последней публикации, а не от пройденного чек-листа; появится бэк-этапом.',
  },
  {
    code: 'groups',
    label: 'Привлекаемые группы',
    honestLine:
      'Кинологическая, инженерно-сапёрная, группа быстрого реагирования и подобные привлекаемые группы у объекта не заведены: такие силы живут в мероприятии, а не в паспорте объекта; появится бэк-этапом.',
  },
]

interface Freshness {
  objectId: string
  state: 'FRESH' | 'DUE_SOON' | 'OVERDUE' | 'NO_PUBLISHED_VERSION'
  verificationDueAt: string | null
}

interface ObjectRow {
  id: string
  name: string
  code: string
  type: string
  region: string
  address: string
  objectState: 'ACTIVE' | 'ARCHIVED'
  passportState: 'GREEN' | 'YELLOW' | 'RED'
  ownership: 'OWN' | 'GUARDED'
  hasSecurityEvents: boolean
}

interface Registry {
  results: ObjectRow[]
  freshness: Freshness[]
  unavailableKpi: { code: string; label: string; reason: string }[]
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  return ((await res.json()) as { access: string }).access
}

async function registry(token: string): Promise<Registry> {
  const res = await fetch(`${API}/api/ops/objects/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as Registry
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

/** Значение строки «Общие данные» по её подписи. */
function field(page: Page, label: string) {
  return page.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) })
}

/**
 * Карточка общей вкладки. Ищется по карточке, а НЕ по роли заголовка:
 * `CardTitle` этого набора — обычный `div`, и `getByRole('heading')` тут
 * промахивается молча (на этом проба и покраснела в первый прогон).
 */
function generalCard(page: Page) {
  return page.locator('[data-slot="card"]', { hasText: 'Общие данные' }).first()
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'паспорт объекта' : 'паспорт объекта (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('вкладки переключают содержимое и живут в адресе', async ({ page }) => {
    const snapshot = await registry(await apiToken())
    const object = snapshot.results[0]
    expect(object, 'в реестре нет ни одного объекта — проба вакуумна').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}${SCREEN}/${object.id}`)
    await expect(page.getByRole('heading', { name: object.name })).toBeVisible({ timeout: 15_000 })

    // Умолчание НЕ пишется в адрес: `?tab=general` и голый адрес — одно
    // состояние, две записи истории на один экран ломали бы «назад».
    await expect(page).toHaveURL(new RegExp(`objects/${object.id}/?$`))
    await expect(page.getByRole('tab', { name: 'Общие данные' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(generalCard(page)).toBeVisible()

    // Прототип держит ШЕСТЬ вкладок паспорта — три живых и три макетных
    // (см. PLANNED_TABS); все шесть обязаны быть видимыми контролами.
    await expect(page.getByRole('tab')).toHaveCount(6)
    for (const label of [
      'Общие данные',
      'Инфраструктура',
      'Посты и секторы',
      'Чек-лист',
      'Привлекаемые группы',
      'История',
    ]) {
      await expect(page.getByRole('tab', { name: label })).toBeVisible()
    }

    await page.getByRole('tab', { name: 'История' }).click()
    await expect(page).toHaveURL(/\?tab=history$/)
    await expect(page.getByRole('tab', { name: 'История' })).toHaveAttribute('aria-selected', 'true')
    // Содержимое именно СМЕНИЛОСЬ, а не добавилось: поля общей вкладки ушли.
    await expect(generalCard(page)).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('tab', { name: 'История' })).toHaveAttribute('aria-selected', 'true')
    await expect(generalCard(page)).toHaveCount(0)

    await page.getByRole('tab', { name: 'Посты и секторы' }).click()
    await expect(page).toHaveURL(/\?tab=posts$/)
    await expect(generalCard(page)).toHaveCount(0)
  })

  test('набранный черновик переживает уход на другую вкладку', async ({ page }) => {
    const snapshot = await registry(await apiToken())
    const object = snapshot.results[0]

    await signIn(page)
    await page.goto(`${APP}${SCREEN}/${object.id}?tab=posts`)
    const sector = page.getByRole('textbox').first()
    await expect(sector).toBeVisible({ timeout: 15_000 })

    const typed = `черновик проба ${object.code}`
    await sector.fill(typed)

    // Уход и возврат: несохранённое обязано остаться. Вкладка, которая
    // размонтирует форму, стёрла бы набранное молча — человек увидел бы
    // прежние посты и не узнал, что его правку выбросили.
    await page.getByRole('tab', { name: 'Общие данные' }).click()
    await expect(generalCard(page)).toBeVisible()
    await page.getByRole('tab', { name: 'Посты и секторы' }).click()

    await expect(page.getByRole('textbox').first()).toHaveValue(typed)
    // На сервер это не уехало: черновик правится локально, PATCH шлёт кнопка.
    const fresh = await registry(await apiToken())
    expect(fresh.results.find((row) => row.id === object.id)?.name).toBe(object.name)
  })

  /**
   * Тот же черновик, но уход теперь идёт через НОВУЮ макетную вкладку —
   * ровно тот риск, который вносит эта задача: три вкладки добавляются в
   * общий рендер паспорта, и если хоть одна обёрнута условным рендером
   * (`&&`) вместо `hidden`, форма «Посты и секторы» может размонтироваться
   * при проходе через неё. Красная проба на этот ассерт — в отчёте задачи.
   */
  test('набранный черновик переживает уход через новую макетную вкладку', async ({ page }) => {
    const snapshot = await registry(await apiToken())
    const object = snapshot.results[0]

    await signIn(page)
    await page.goto(`${APP}${SCREEN}/${object.id}?tab=posts`)
    const sector = page.getByRole('textbox').first()
    await expect(sector).toBeVisible({ timeout: 15_000 })

    const typed = `черновик через макет ${object.code}`
    await sector.fill(typed)

    await page.getByRole('tab', { name: 'Инфраструктура' }).click()
    await expect(page.getByText(PLANNED_TABS[0].honestLine, { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Посты и секторы' }).click()

    await expect(page.getByRole('textbox').first()).toHaveValue(typed)
  })

  test('три вкладки без бэка рисуют макет прототипа и честную причину', async ({ page }) => {
    const snapshot = await registry(await apiToken())
    const object = snapshot.results[0]

    await signIn(page)
    await page.goto(`${APP}${SCREEN}/${object.id}`)
    await expect(generalCard(page)).toBeVisible({ timeout: 15_000 })

    for (const planned of PLANNED_TABS) {
      await page.getByRole('tab', { name: planned.label }).click()
      await expect(page.getByRole('tab', { name: planned.label })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      // Дословно, не подстрокой: «появится» само по себе — слишком общая
      // подстрока, чтобы доказать, что причина именно ЭТА, а не какая-то.
      await expect(page.getByText(planned.honestLine, { exact: true })).toBeVisible()
    }
  })

  test('общие данные и срок проверки идут от сервера', async ({ page }) => {
    const snapshot = await registry(await apiToken())
    // Объект ищем ЗАПРОСОМ: свежесть у первой строки конверта может случайно
    // совпасть со своей, и подмена «взять первую» осталась бы незамеченной.
    const dated = snapshot.results.find((row) => {
      const own = snapshot.freshness.find((f) => f.objectId === row.id)
      const first = snapshot.freshness[0]
      return own?.verificationDueAt != null && own.verificationDueAt !== first?.verificationDueAt
    })
    expect(
      dated,
      'у всех объектов один срок проверки — сверка «свой, а не первый» вакуумна',
    ).toBeDefined()
    const own = snapshot.freshness.find((f) => f.objectId === dated!.id)!

    await signIn(page)
    await page.goto(`${APP}${SCREEN}/${dated!.id}`)
    await expect(generalCard(page)).toBeVisible({ timeout: 15_000 })

    await expect(field(page, 'Регистрационный №')).toContainText(dated!.code)
    await expect(field(page, 'Тип')).toContainText(dated!.type)
    await expect(field(page, 'Регион')).toContainText(dated!.region)
    await expect(field(page, 'Адрес')).toContainText(dated!.address)
    await expect(field(page, 'Срок проверки')).toContainText(own.verificationDueAt!)
    await expect(field(page, 'Есть охранные мероприятия')).toContainText(
      dated!.hasSecurityEvents ? 'да' : 'нет',
    )
  })

  test('баннер неготовности повторяет вердикт сервера, а не рисуется всегда', async ({ page }) => {
    const snapshot = await registry(await apiToken())
    const ready = snapshot.results.find(
      (row) =>
        row.passportState === 'GREEN' &&
        snapshot.freshness.find((f) => f.objectId === row.id)?.state === 'FRESH',
    )
    const notReady = snapshot.results.find((row) => {
      const state = snapshot.freshness.find((f) => f.objectId === row.id)?.state
      return row.passportState !== 'GREEN' || state === 'OVERDUE' || state === 'NO_PUBLISHED_VERSION'
    })
    // Обе стороны обязаны найтись: с одной проба доказывает только половину.
    expect(ready, 'нет готового объекта — молчание баннера не проверяется').toBeDefined()
    expect(notReady, 'нет неготового объекта — появление баннера не проверяется').toBeDefined()

    await signIn(page)

    await page.goto(`${APP}${SCREEN}/${notReady!.id}`)
    const banner = page.getByRole('status').first()
    await expect(banner).toBeVisible({ timeout: 15_000 })
    // Список незаполненных полей НЕ выдумывается: сервер его не отдаёт, и
    // экран обязан сказать это вслух, а не перечислить поля догадкой.
    await expect(banner).toContainText('сервер не сообщает')

    await page.goto(`${APP}${SCREEN}/${ready!.id}`)
    await expect(page.getByRole('heading', { name: ready!.name })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('status')).toHaveCount(0)
  })

  test('«чего нет» печатается словами сервера', async ({ page }) => {
    const snapshot = await registry(await apiToken())
    expect(
      snapshot.unavailableKpi.length,
      'сервер не назвал ни одного недоступного показателя',
    ).toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}${SCREEN}/${snapshot.results[0].id}`)
    const missing = page
      .locator('[data-slot="card"]', { hasText: 'Чего в этом паспорте нет' })
      .first()
    await expect(missing).toBeVisible({ timeout: 15_000 })
    for (const item of snapshot.unavailableKpi) {
      await expect(missing).toContainText(item.label)
      await expect(missing).toContainText(item.reason)
    }
    // Три вкладки получили собственный макет и честную строку — список
    // «чего нет» их больше не называет, иначе одно и то же отсутствие
    // читалось бы дважды двумя разными словами.
    for (const tab of PLANNED_TABS) {
      await expect(missing).not.toContainText(tab.label)
    }
  })
})
