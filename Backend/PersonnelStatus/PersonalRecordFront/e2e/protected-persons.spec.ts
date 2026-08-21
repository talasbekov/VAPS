/**
 * Каталог охраняемых лиц на ЖИВОМ стенде.
 *
 * Проба отвечает на два вопроса: вкладка действительно делит каталог (а не
 * показывает один и тот же список), и связь «лицо → мероприятия» настоящая —
 * она появляется РОВНО тогда, когда лицо названо в сводке ГВО, и исчезает,
 * когда его оттуда убрали.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
/**
 * Лицо каталога, которым проверяется связь со сводкой ГВО в мутирующем
 * сценарии. НЕ 'Оспанов Бахыт Дюсенбаевич' — на живом стенде это имя уже
 * привязано к ОМ-2026-80 остатком прошлого прогона (см. Task 10, отчёт:
 * пересечение, найденное по API, используется как read-only фикстура ниже
 * и специально не трогается) — тест с этим именем начинал бы НЕ с чистого
 * состояния и «до правки связи нет» падало бы всегда.
 */
const PERSON = 'Салимова Гульнара Ержановна'

async function signIn(page: Page, username = 'admin', password = 'admin123'): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'охраняемые лица' : 'охраняемые лица (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('вкладки делят каталог, связь с ОМ идёт из сводки ГВО', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    await signIn(page)
    await page.goto(`${APP}/security-ops/persons/`)
    await expect(page.getByRole('heading', { name: 'Охраняемые лица' })).toBeVisible()

    // «Наши» и «Иностранные» — РАЗНЫЕ списки: проверяем оба направления,
    // иначе вкладка, которая ничего не фильтрует, тест бы прошла.
    const ours = page.getByRole('heading', { name: PERSON })
    const foreign = page.getByRole('heading', { name: 'James Miller' })
    await expect(ours).toBeVisible()
    await expect(foreign).toBeHidden()
    await page.getByRole('button', { name: 'Иностранные' }).click()
    await expect(foreign).toBeVisible()
    await expect(ours).toBeHidden()
    await expect(page.getByText('Позывной «Дельта-1»')).toBeVisible()
    await page.getByRole('button', { name: 'Наши' }).click()

    const card = page.locator('article', { hasText: PERSON })

    // До правки сводки связи нет — и экран говорит об этом прямо.
    await card.getByRole('button', { name: 'Все мероприятия с ОЛ' }).click()
    await expect(card).toContainText('не назван ни в одной сводке ГВО', {
      timeout: 10_000,
    })

    // Вносим лицо в сводку ГВО первого ОМ реестра
    await page.goto(`${APP}/security-ops/gvo/`)
    const row = page.locator('tbody tr').first()
    const omCode = (await row.locator('td').first().innerText()).split('\n')[0]
    await row.locator('a').first().click()
    await page.getByRole('button', { name: '＋ Добавить лицо' }).click()
    await page.getByRole('textbox', { name: 'ФИО' }).fill(PERSON)
    await page.getByRole('textbox', { name: 'Должность' }).fill('Куратор визитов')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.locator('main').getByText(PERSON)).toBeVisible({ timeout: 10_000 })

    // Связь появилась: карточка лица ведёт на ту самую сводку и её объект
    await page.goto(`${APP}/security-ops/persons/`)
    const linked = page.locator('article', { hasText: PERSON })
    await linked.getByRole('button', { name: 'Все мероприятия с ОЛ' }).click()
    await expect(linked.getByRole('link', { name: omCode })).toBeVisible({
      timeout: 10_000,
    })
    await linked.getByRole('button', { name: 'Объекты ОЛ' }).click()
    await expect(linked.getByRole('link', { name: omCode })).toBeHidden()
    await expect(linked.locator('li')).toHaveCount(1)

    // Гигиена стенда: сбрасываем патч, который сами создали, — иначе PERSON
    // остаётся приклеен к этому ОМ и следующий прогон спеки стартует не с
    // чистого состояния (тот же класс дефекта уже нашёлся у ОМ-2026-80 /
    // 'Оспанов Бахыт Дюсенбаевич'). Тот же приём, что в
    // e2e/gvo-sections.spec.ts — «Вернуть исходные» по разделу «persons».
    await page.goto(`${APP}/security-ops/gvo/`)
    await page.locator('tbody tr', { hasText: omCode }).locator('a').first().click()
    await page.getByRole('button', { name: 'Изменить список охраняемых лиц' }).click()
    await page.getByRole('button', { name: 'Вернуть исходные' }).click()
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 })

    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })

  test('без event.view каталог закрыт', async ({ page }) => {
    await signIn(page, 'observer', 'observer123')
    await page.goto(`${APP}/security-ops/persons/`)
    await expect(page.getByText('каталога охраняемых лиц')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('heading', { name: 'Охраняемые лица' })).toBeHidden()
  })
})

/**
 * Task 10: блок «Мероприятия с участием» на карточке лица — доказан ПО API,
 * без единой мутации стенда (GET-only). Пин дословно совпадает с константой
 * на экране (app/security-ops/persons/page.tsx) — проба ловит расхождение
 * текста, а не только факт наличия какой-то строки.
 */
const EVENTS_LINK_GAP_LINE =
  'связь по совпадению имени в сводках ГВО; прямой ссылки в модели нет (бэк-этап)'

interface CatalogPerson {
  id: string
  name: string
  category: 'OURS' | 'FOREIGN'
}

interface GvoPatchRecord {
  omCode: string
  patch: { persons?: { name: string }[] }
}

interface EventRow {
  id: string
  code: string
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  return ((await res.json()) as { access: string }).access
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as T
}

/**
 * Живое пересечение ФИО каталога охраняемых лиц и лиц в сводках ГВО —
 * ЕДИНСТВЕННОЕ место связи (SecurityEvent прямой ссылки на лицо не несёт,
 * см. Known-Issues). Персона в сводке приходит ТОЛЬКО из патча ручной правки
 * (deriveGvoSummary всегда отдаёт persons: [] — entities/gvo-summary/model/
 * derive.ts), поэтому GET /api/ops/gvo-summaries/ и есть полный список
 * кандидатов, без нужды воспроизводить merge на клиенте теста.
 */
async function findNameIntersections(): Promise<{
  matches: { person: CatalogPerson; event: EventRow }[]
  catalog: CatalogPerson[]
}> {
  const token = await apiToken()
  const [catalog, patches, events] = await Promise.all([
    apiGet<{ results: CatalogPerson[] }>('/api/ops/protected-persons/', token),
    apiGet<{ results: GvoPatchRecord[] }>('/api/ops/gvo-summaries/', token),
    apiGet<{ results: EventRow[] }>('/api/ops/security-events/?page_size=200', token),
  ])
  const eventByCode = new Map(events.results.map((e) => [e.code, e]))
  const matches: { person: CatalogPerson; event: EventRow }[] = []
  for (const record of patches.results) {
    const event = eventByCode.get(record.omCode)
    if (event === undefined) continue
    for (const gvoPerson of record.patch.persons ?? []) {
      const needle = gvoPerson.name.trim().toLowerCase()
      const hit = catalog.results.find((c) => c.name.trim().toLowerCase() === needle)
      if (hit !== undefined) matches.push({ person: hit, event })
    }
  }
  return { matches, catalog: catalog.results }
}

test.describe(
  LIVE
    ? 'связь «лицо → ОМ» через сводку ГВО (без мутаций стенда)'
    : 'связь «лицо → ОМ» через сводку ГВО (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

    test('блок доказан по API: совпавшее лицо ведёт на карточку ОМ, несовпавшее — честную причину', async ({
      page,
    }) => {
      const { matches, catalog } = await findNameIntersections()

      // Вакуумный гвард №1: без реального пересечения красная проба ничего
      // не доказывает — проба обязана падать громко, а не молча зеленеть.
      expect(
        matches.length,
        'на стенде нет ни одного живого пересечения ФИО каталога и сводки ГВО — проба невозможна',
      ).toBeGreaterThan(0)
      const { person: matchedPerson, event: matchedEvent } = matches[0]!

      // Вакуумный гвард №2: пустое состояние обязано быть достижимо — иначе
      // «честная причина» никогда не рендерится и остаётся недоказанной.
      const matchedIds = new Set(matches.map((m) => m.person.id))
      const unmatchedPerson = catalog.find((c) => !matchedIds.has(c.id))
      expect(
        unmatchedPerson,
        'у каждого лица каталога есть совпадение — пустое состояние недостижимо',
      ).toBeDefined()

      await signIn(page)

      // --- Совпавшее лицо: блок со ссылкой на карточку ОМ ---
      await page.goto(`${APP}/security-ops/persons/`)
      if (matchedPerson.category === 'FOREIGN') {
        await page.getByRole('button', { name: 'Иностранные' }).click()
      }
      const matchedCard = page.locator('article', { hasText: matchedPerson.name })
      await matchedCard.getByRole('button', { name: 'Все мероприятия с ОЛ' }).click()
      await expect(
        matchedCard.getByRole('heading', { name: 'Мероприятия с участием', level: 3 }),
      ).toBeVisible()
      await expect(matchedCard.getByText(EVENTS_LINK_GAP_LINE, { exact: true })).toBeVisible()
      const link = matchedCard.getByRole('link', { name: matchedEvent.code, exact: true })
      await expect(link).toBeVisible()
      await link.click()

      // Landed-identity: код ОМ на КАРТОЧКЕ мероприятия, а не только форма
      // URL — подмена «ссылка ведёт на другое, но валидное ОМ» URL-пробой
      // одна не ловится.
      await expect(page).toHaveURL(new RegExp(`/security-ops/events/${matchedEvent.id}/?$`))
      await expect(
        page.getByRole('main').getByText(matchedEvent.code, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 })

      // --- Несовпавшее лицо: честная причина, а не пустота ---
      await page.goto(`${APP}/security-ops/persons/`)
      if (unmatchedPerson!.category === 'FOREIGN') {
        await page.getByRole('button', { name: 'Иностранные' }).click()
      }
      const unmatchedCard = page.locator('article', { hasText: unmatchedPerson!.name })
      await unmatchedCard.getByRole('button', { name: 'Все мероприятия с ОЛ' }).click()
      await expect(
        unmatchedCard.getByRole('heading', { name: 'Мероприятия с участием', level: 3 }),
      ).toBeVisible()
      await expect(unmatchedCard.getByText(EVENTS_LINK_GAP_LINE, { exact: true })).toBeVisible()
      await expect(
        unmatchedCard.getByText(
          `${unmatchedPerson!.name} не назван ни в одной сводке ГВО — связанных мероприятий и объектов нет.`,
          { exact: true },
        ),
      ).toBeVisible()
    })
  },
)
