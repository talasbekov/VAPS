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
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

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

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
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
    await page.goto(`${APP}/security-ops/events/?view=gvo`)
    const row = page.locator('tbody tr').first()
    const omCode = (await row.locator('td').first().innerText()).split('\n')[0]
    await row.locator('a').first().click()
    await page.getByRole('button', { name: '＋ Добавить лицо' }).click()
    await page.getByRole('textbox', { name: 'ФИО' }).fill(PERSON)
    await page.getByRole('textbox', { name: 'Должность' }).fill('Куратор визитов')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    // `.first()`: сводка теперь панель в КАРТОЧКЕ ОМ (Plane «Реестр ОМ-35.8»),
    // и то же имя выводится ещё и в «Сведениях об ОМ» бюллетеня — строгий
    // режим ловил оба вхождения.
    await expect(page.locator('main').getByText(PERSON).first()).toBeVisible({
      timeout: 10_000,
    })

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
    await page.goto(`${APP}/security-ops/events/?view=gvo`)
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
 * Task 10: блок «Мероприятия с участием» на карточке лица.
 *
 * Пин дословно совпадает с константой на экране (app/security-ops/persons/
 * page.tsx) — проба ловит расхождение текста, а не только факт наличия
 * какой-то строки.
 */
const EVENTS_LINK_GAP_LINE =
  'Связь показана по совпадению имени в сводках ГВО — прямой ссылки «лицо → мероприятие» в модели нет; появится бэк-этапом.'

/**
 * Fix round 1: строка отказа реестра ОМ / сводок ГВО. Тоже дословный пин —
 * см. finding отчёта «false honest-sounding message»: без своей ветки отказ
 * запроса печатал ту же строку, что и настоящее отсутствие совпадений,
 * которая в этом случае была бы неправдой.
 */
const LINKS_ERROR_LINE =
  'Реестр ОМ или сводки ГВО сейчас не отвечают — связанные мероприятия показать нечем.'

interface CatalogPerson {
  id: string
  name: string
  category: 'OURS' | 'FOREIGN'
}

interface GvoPatchRecord {
  omCode: string
  patch: { persons?: { name: string; role?: string }[] }
  updatedAt?: string
}

interface EventRow {
  id: string
  code: string
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
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
 * Живое пересечение ФИО каталога охраняемых лиц и лиц в сводках ГВО, КАК ОНО
 * ЕСТЬ на стенде без всякого перехвата. Используется ниже только чтобы найти
 * лицо, у которого гарантированно НЕТ естественного совпадения (пустое
 * состояние обязано остаться доказанным по-настоящему живой записью) — саму
 * связь «лицо ↔ ОМ» тест больше не берёт отсюда (fix round 1, ниже почему).
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

/**
 * Перехватывает GET-список сводок ГВО (`/api/ops/gvo-summaries/`) и дописывает
 * в НАСТОЯЩИЙ ответ бэка одну запись: `personName` появляется среди персон
 * сводки `omCode`. Каталог лиц и реестр ОМ остаются ЖИВЫМИ и НЕ перехвачены —
 * подменяется только payload сводки/патча, ровно как разрешает бриф.
 *
 * Имя вписывается С ЧУЖИМ РЕГИСТРОМ и лишними пробелами по краям — не
 * потому что так бывает на живых данных, а потому что при точном совпадении
 * строк проба доказывала бы только конкатенацию, а не нормализацию имени
 * (trim().toLowerCase() в page.tsx#eventsOf). С «грязным» именем совпадение
 * находится ТОЛЬКО если нормализация действительно работает — это и есть
 * материал для красной пробы ниже (см. отчёт, Fix round 1 §Красная проба).
 */
async function shapeGvoSummaryMatch(page: Page, omCode: string, personName: string): Promise<void> {
  const shapedName = `  ${personName.toUpperCase()}  `
  await page.route(
    (url) => url.pathname === '/api/ops/gvo-summaries/',
    async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as { results: GvoPatchRecord[] }
      const record = body.results.find((r) => r.omCode === omCode)
      const person = { name: shapedName, role: 'Куратор визитов' }
      if (record) {
        record.patch.persons = [...(record.patch.persons ?? []), person]
      } else {
        body.results.push({ omCode, patch: { persons: [person] }, updatedAt: new Date().toISOString() })
      }
      await route.fulfill({ json: body })
    },
  )
}

test.describe(
  LIVE
    ? 'связь «лицо → ОМ» через сводку ГВО (перехват payload, без мутаций стенда)'
    : 'связь «лицо → ОМ» через сводку ГВО (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
    // Только в этом блоке (не файл целиком): здесь и только здесь запросы
    // приложения перехватываются `page.route`. Блокировка ЗДЕСЬ ограничена —
    // на верхний мутирующий сценарий (без page.route) НЕ распространяется:
    // там MSW пытается зарегистрироваться сама и без блокировки не мешает,
    // а с ней бросает консольную ошибку регистрации, которую тот тест ловит
    // как реальный дефект экрана (проверено красной пробой этого фикса).
    test.use({ serviceWorkers: 'block' })

    /**
     * Fix round 1 (review finding «happy-path test depends on accidental
     * stand residue»): раньше пересечение искалось В ГОТОВЫХ живых данных —
     * единственная пара на стенде («Оспанов Бахыт Дюсенбаевич» ↔ ОМ-2026-80)
     * была остатком МУТАЦИИ прошлого прогона другого теста, а не чем-то,
     * что эта задача создаёт или гарантирует. На сброшенном стенде такой
     * пары могло не быть вовсе — проба падала бы, требуя ручного восстановления
     * через UI (см. Concerns прошлого отчёта).
     *
     * Теперь совпадение СОЗДАЁТСЯ перехватом ответа сводок ГВО
     * (shapeGvoSummaryMatch): matchedPerson и matchedEvent — ЛЮБЫЕ живые
     * записи каталога и реестра ОМ (взяты по API, не по угаданному имени),
     * связь между ними существует только внутри перехваченного HTTP-ответа
     * этого теста. Пустое состояние (unmatchedPerson), наоборот, обязано
     * остаться доказанным НА ЖИВЫХ данных — иначе «честная причина» была бы
     * так же подстроена, как и совпадение, и ничего не доказывала.
     */
    test('блок доказан: совпавшее лицо ведёт на карточку ОМ (перехват), несовпавшее — честную причину (живые данные)', async ({
      page,
    }) => {
      const token = await apiToken()
      const [catalogRes, eventsRes] = await Promise.all([
        apiGet<{ results: CatalogPerson[] }>('/api/ops/protected-persons/', token),
        apiGet<{ results: EventRow[] }>('/api/ops/security-events/?page_size=200', token),
      ])
      const catalog = catalogRes.results
      const events = eventsRes.results

      expect(catalog.length, 'каталог охраняемых лиц пуст — пробе не с кем работать').toBeGreaterThanOrEqual(2)
      expect(events.length, 'реестр ОМ пуст — перехваченную связь не с чем создать').toBeGreaterThan(0)

      const matchedPerson = catalog[0]!
      const matchedEvent = events.find((e) => e.code !== '') ?? events[0]!

      // Несовпавшее лицо ищем СРЕДИ ЕСТЕСТВЕННЫХ (неперехваченных) данных:
      // пустое состояние обязано остаться доказанным настоящим отсутствием
      // связи, а не тоже перехватом.
      const { matches: liveMatches } = await findNameIntersections()
      const naturallyMatchedIds = new Set(liveMatches.map((m) => m.person.id))
      const unmatchedPerson = catalog.find(
        (c) => c.id !== matchedPerson.id && !naturallyMatchedIds.has(c.id),
      )
      expect(
        unmatchedPerson,
        'у каждого лица каталога (кроме совпавшего перехватом) уже есть естественное совпадение — пустое состояние недостижимо',
      ).toBeDefined()

      await signIn(page)

      const shapedRequests: string[] = []
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.pathname === '/api/ops/gvo-summaries/') shapedRequests.push(request.url())
      })
      await shapeGvoSummaryMatch(page, matchedEvent.code, matchedPerson.name)

      // --- Совпавшее лицо (связь создана перехватом): блок со ссылкой ---
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

      // Громкий гвард: без сработавшего перехвата дальнейший поиск ссылки не
      // доказывал бы механизм — он просто упал бы (или, того хуже, случайно
      // прошёл бы мимо остаточной пары со старого стенда). Явное сообщение
      // отличает «перехват не долетел» от «нормализация имени сломана».
      await expect
        .poll(() => shapedRequests.length, {
          timeout: 15_000,
          message: 'перехват GET /api/ops/gvo-summaries/ ни разу не сработал — экран запросил сводки другим путём',
        })
        .toBeGreaterThan(0)

      const link = matchedCard.getByRole('link', { name: matchedEvent.code, exact: true })
      await expect(
        link,
        `перехваченная сводка не создала совпадение «${matchedPerson.name}» → ${matchedEvent.code} — ` +
          'проверь нормализацию имени (trim/toLowerCase) в eventsOf',
      ).toBeVisible({ timeout: 15_000 })
      await link.click()

      // Landed-identity: код ОМ на КАРТОЧКЕ мероприятия, а не только форма
      // URL — подмена «ссылка ведёт на другое, но валидное ОМ» URL-пробой
      // одна не ловится.
      await expect(page).toHaveURL(new RegExp(`/security-ops/events/${matchedEvent.id}/?$`))
      await expect(
        page.getByRole('main').getByText(matchedEvent.code, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 })

      // --- Несовпавшее лицо (живые, неперехваченные данные): честная причина ---
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

/**
 * Fix round 1 (review finding «false honest-sounding message»): PersonLinks
 * раньше не различала «данных нет» и «запрос упал» — обе ветки печатали
 * «не назван ни в одной сводке ГВО», что при отказе сети было правдоподобной
 * ложью. Перехват отдаёт 500 на реестр ОМ — естественный способ дойти до
 * ветки отказа, не трогая сам каталог охраняемых лиц.
 */
test.describe(
  LIVE
    ? 'связь «лицо → ОМ»: отказ реестра ОМ — честная причина отказа, а не пустота'
    : 'связь «лицо → ОМ»: отказ реестра ОМ (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
    // Скоуп блокировки — см. комментарий у соседнего describe выше: только
    // здесь, не файл целиком.
    test.use({ serviceWorkers: 'block' })

    test('отказ реестра ОМ печатает причину отказа, а не «не назван ни в одной сводке»', async ({ page }) => {
      const token = await apiToken()
      const catalog = await apiGet<{ results: CatalogPerson[] }>('/api/ops/protected-persons/', token)
      const anyPerson = catalog.results[0]
      expect(anyPerson, 'каталог охраняемых лиц пуст — пробе не с кем работать').toBeDefined()

      await page.route(
        (url) => url.pathname === '/api/ops/security-events/',
        async (route) => {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ detail: 'перехват: имитация отказа реестра ОМ' }),
          })
        },
      )

      await signIn(page)
      await page.goto(`${APP}/security-ops/persons/`)
      if (anyPerson!.category === 'FOREIGN') {
        await page.getByRole('button', { name: 'Иностранные' }).click()
      }
      const card = page.locator('article', { hasText: anyPerson!.name })
      await card.getByRole('button', { name: 'Все мероприятия с ОЛ' }).click()

      // Пин дословный: не «что-то про ошибку», а ИМЕННО эта строка — иначе
      // проба прошла бы и на случайном другом тексте отказа.
      await expect(card.getByText(LINKS_ERROR_LINE, { exact: true })).toBeVisible({
        timeout: 20_000,
      })
      // Ложно-честная строка из finding'а обязана исчезнуть: это ДРУГАЯ
      // причина (отказ запроса, а не отсутствие совпадений), и текст не
      // должен молчать под похожей на правду формулировкой.
      await expect(
        card.getByText(`${anyPerson!.name} не назван ни в одной сводке ГВО`),
      ).toBeHidden()
    })
  },
)
