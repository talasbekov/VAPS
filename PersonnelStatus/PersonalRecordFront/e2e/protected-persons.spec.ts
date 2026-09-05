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
import { requireFixture } from './fixtures'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
/**
 * Лицо каталога, которым проверяется связь со сводкой ГВО в мутирующем
 * сценарии. ИМЯ БОЛЬШЕ НЕ ЗАШИТО (Plane №197): сценарий начинается с «лицо не
 * названо ни в одной сводке», и любое конкретное имя рано или поздно
 * оказывается названо — фикстура стенда (`seed_smoke_fixtures`) заводит
 * закрытое мероприятие, в сводке которого стоит первое лицо справочника, и
 * зашитая «Салимова Гульнара Ержановна» стала таким лицом. Проба выбирает
 * НАШЕ лицо, которого нет ни в одной собранной сводке, и говорит вслух, если
 * такого не нашлось, — а не падает ассертом про пустое состояние.
 */
/** Роль, с которой проба вписывает лицо в сводку, — по ней хвосты и узнаются. */
const PROBE_ROLE = 'Куратор визитов'

/**
 * Снимает со сводок ГВО лиц, вписанных этой пробой (роль `PROBE_ROLE`):
 * упавший прогон оставлял лицо в сводке, и каждый следующий заход съедал ещё
 * одно свободное «наше» лицо каталога — на четвёртом фикстуры не оставалось
 * (прогон 04.09.2026, три лица из четырёх были «названы»).
 */
async function unlinkProbePersons(): Promise<void> {
  const token = await apiToken()
  const rows = await apiGet<{ results: GvoSummaryRow[] }>('/api/ops/gvo-summaries/assembled/', token)
  for (const row of rows.results) {
    const persons = row.summary.persons ?? []
    const kept = persons.filter((person) => person.role !== PROBE_ROLE)
    if (kept.length === persons.length) continue
    await fetch(`${API}/api/ops/gvo-summaries/${encodeURIComponent(row.omCode)}/`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ section: 'persons', values: { persons: kept } }),
    })
  }
}

async function cleanDomesticPerson(): Promise<string> {
  await unlinkProbePersons()
  const { matches, catalog } = await findNameIntersections()
  const busy = new Set(matches.map((m) => m.person.name.trim().toLowerCase()))
  return requireFixture(
    catalog.find(
      (row) => row.category === 'OURS' && !busy.has(row.name.trim().toLowerCase()),
    ),
    'наше охраняемое лицо, не названное ни в одной сводке ГВО (сценарий ' +
      'начинается с пустой связи; все лица каталога уже названы)',
  ).name
}

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
    const PERSON = await cleanDomesticPerson()
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

    // Код `OL-N` (Plane №417): сервер выдаёт его сам, карточка печатает
    // перед именем — ровно тот код, что пришёл в каталоге, а не выдуманный.
    const catalog = await apiGet<{ results: { id: string; code: string; name: string }[] }>(
      '/api/ops/protected-persons/',
      await apiToken(),
    )
    const mine = requireFixture(
      catalog.results.find((r) => r.name === PERSON),
      'лицо пробы не найдено в каталоге',
    )
    expect(mine.code).toMatch(/^OL-\d+$/)
    await expect(card.getByTestId(`person-code-${mine.id}`)).toHaveText(mine.code)

    // До правки сводки связи нет — и экран говорит об этом прямо.
    await card.getByRole('button', { name: 'Все мероприятия с ОЛ' }).click()
    await expect(card).toContainText('не назван ни в одной сводке ГВО', {
      timeout: 10_000,
    })

    // Вносим лицо в сводку ГВО НЕЗАКРЫТОГО ОМ, а не первого в реестре
    // (Plane №197): первой строкой стоит закрытое мероприятие фикстуры, а его
    // карточка — архив дела, read-only. Окно «Добавить лицо» там открывается,
    // но правка не сохраняется, и проба падала на «имени не видно», имея в
    // виду «править было нечего».
    const token = await apiToken()
    const [summaries, registry] = await Promise.all([
      apiGet<{ results: GvoSummaryRow[] }>('/api/ops/gvo-summaries/assembled/', token),
      apiGet<{ results: EventRow[] }>('/api/ops/security-events/?page_size=200', token),
    ])
    // Реестр ГВО показывает ТО ЖЕ, что и кнопка сводки: `kind !== 'INTERNAL'`.
    // Закрытые исключены отдельно — их карточка это архив дела, read-only.
    const openCodes = new Set(
      registry.results
        .filter((e) => e.stage !== 'CLOSED' && e.kind !== 'INTERNAL')
        .map((e) => e.code),
    )
    const omCode = requireFixture(
      summaries.results.map((r) => r.omCode).find((code) => openCodes.has(code)),
      'незакрытый визит иностранного ОЛ со сводкой ГВО — только такие строки ' +
        'показывает реестр ГВО, а в архив дела лицо не внести',
    )
    // 🔴 УБОРКА В `finally`, А ПРОВЕРКА КОНСОЛИ ПОСЛЕ НЕЁ (Plane №742).
    // Проверка `errors` стояла ПЕРЕД уборкой, и случайная ошибка в консоли
    // оставляла пробное лицо привязанным к чужой сводке: стартовый
    // `unlinkProbePersons()` подбирал это лишь на СЛЕДУЮЩЕМ прогоне, а до
    // тех пор стенд стоял грязным. Уборке место в `finally` — она обязана
    // случиться и при упавшем ассерте, и при брошенном локаторе.
    try {
      await page.goto(`${APP}/security-ops/events/?view=gvo`)
      await page.locator('tbody tr', { hasText: omCode }).locator('a').first().click()
      // Единый режим правки (`[ГВО-05]`, Plane №441): поля открывает одна
      // кнопка «Редактировать», «＋ Добавить лицо» живёт внутри формы.
      //
      // 🔴 КЛИК ПОВТОРЯЕТСЯ, ТОЛЬКО ПОКА КНОПКА ЕЩЁ ЕСТЬ (Plane №738). Панель
      // рисует «Редактировать» при `canEdit && !editing`, поэтому первый удачный
      // клик её РАЗМОНТИРУЕТ. Прежний цикл кликал по ней вслепую: если форма
      // появлялась дольше внутренних 3 с — ровно тот медленный стенд, ради
      // которого повтор и добавлен, — следующий заход ждал исчезнувшую кнопку
      // весь `actionTimeout` (10 с), и бюджет 30 с уходил на два-три таких
      // ожидания. Проба падала «Редактировать not found», хотя режим правки уже
      // был открыт: медленный УСПЕХ превращался в отказ.
      //
      // Поэтому: клик один раз, потом длинное ожидание формы, а повтор — только
      // если кнопка всё ещё в DOM (значит первый клик действительно ушёл в
      // никуда, как бывает до гидратации на свежем dev-стенде).
      const addPerson = page.getByRole('button', { name: '＋ Добавить лицо' })
      const editButton = page.getByRole('button', { name: 'Редактировать' })
      await editButton.click()
      await expect(async () => {
        if ((await editButton.count()) > 0) {
          await editButton.click({ timeout: 5_000 })
        }
        await expect(addPerson).toBeVisible({ timeout: 10_000 })
      }).toPass({ timeout: 60_000 })
      await addPerson.click()
      // 🔴 ПОЛЯ СУЖЕНЫ К СВОЕМУ БЛОКУ (Plane №736). С единым режимом правки
      // (№441) форма рисует по `fieldset` на КАЖДОЕ лицо сводки, и в каждом своя
      // подпись «ФИО»: собранная сводка уже несёт лицо, выведенное из бюллетеня,
      // поэтому после «＋ Добавить лицо» таких полей минимум два, и несужённый
      // локатор бросает strict mode. У автора прошло случайно — выбранный ОМ
      // оказался без названного лица; первый же иностранный ОМ с лицом красил
      // пробу по причине, к проверяемому поведению отношения не имеющей.
      //
      // Берётся ПОСЛЕДНИЙ блок: «＋ Добавить лицо» дописывает свой в конец.
      const personBlock = page.locator('form fieldset', { has: page.getByText(/^Лицо \d+$/) }).last()
      // Сужение проверяется, а не подразумевается: в СВОЁМ блоке поле ровно
      // одно, сколько бы лиц ни было в сводке. Без этой строки починка
      // держалась бы на удаче выбранного ОМ — ровно так дефект и прожил.
      await expect(personBlock.getByRole('textbox', { name: 'ФИО' })).toHaveCount(1)
      await personBlock.getByRole('textbox', { name: 'ФИО' }).fill(PERSON)
      await personBlock.getByRole('textbox', { name: 'Должность' }).fill(PROBE_ROLE)
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

    } finally {
      // Гигиена стенда: снимаем лицо, которое сами вписали, — иначе PERSON
      // остаётся приклеен к этому ОМ и следующий прогон стартует не с чистого
      // состояния. Ручкой, а не окном: окна «Изменить список охраняемых лиц»
      // с единым режимом правки (№441) больше нет.
      await unlinkProbePersons()
    }

    // Консоль проверяется ПОСЛЕ уборки: её падение не должно оставлять след.
    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })

  test('без catalog.view каталог закрыт', async ({ page }) => {
    // Имя правлено вместе с гейтом (Plane №267): каталог охраняемых лиц
    // перестал зависеть от права читать реестр ОМ и открывается своим
    // `catalog.view` — рядовой сотрудник видит лица, не видя мероприятий.
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

/** Строка СОБРАННОЙ сводки — то, что отдаёт `assembled/` (Plane №166).
 * Раньше здесь был патч ручных правок: сводку собирал экран. */
interface GvoSummaryRow {
  omCode: string
  summary: { persons?: { name: string; role?: string }[] }
  filled?: boolean
  updatedAt?: string | null
}

interface EventRow {
  id: string
  code: string
  stage?: string
  kind?: string
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
    apiGet<{ results: GvoSummaryRow[] }>('/api/ops/gvo-summaries/assembled/', token),
    apiGet<{ results: EventRow[] }>('/api/ops/security-events/?page_size=200', token),
  ])
  const eventByCode = new Map(events.results.map((e) => [e.code, e]))
  const matches: { person: CatalogPerson; event: EventRow }[] = []
  for (const record of patches.results) {
    const event = eventByCode.get(record.omCode)
    if (event === undefined) continue
    for (const gvoPerson of record.summary.persons ?? []) {
      const needle = gvoPerson.name.trim().toLowerCase()
      const hit = catalog.results.find((c) => c.name.trim().toLowerCase() === needle)
      if (hit !== undefined) matches.push({ person: hit, event })
    }
  }
  return { matches, catalog: catalog.results }
}

/**
 * Перехватывает СОБРАННЫЕ сводки ГВО (`/api/ops/gvo-summaries/assembled/`) и
 * дописывает в НАСТОЯЩИЙ ответ бэка одну запись: `personName` появляется среди
 * персон сводки `omCode`.
 *
 * 🔴 ПИН ИЗМЕНЁН ОСОЗНАННО (Plane №166). Перехватывался адрес патчей
 * (`/api/ops/gvo-summaries/`), и экран действительно ходил туда: сводку он
 * собирал сам. Теперь сборку делает сервер, экран читает `assembled/`, и
 * старый перехват не срабатывал ни разу — проба честно об этом сказала
 * сторожем «экран запросил сводки другим путём» вместо тихой зелени. Каталог лиц и реестр ОМ остаются ЖИВЫМИ и НЕ перехвачены —
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
    (url) => url.pathname === '/api/ops/gvo-summaries/assembled/',
    async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as { results: GvoSummaryRow[] }
      const record = body.results.find((r) => r.omCode === omCode)
      const person = { name: shapedName, role: 'Куратор визитов' }
      if (record) {
        record.summary.persons = [...(record.summary.persons ?? []), person]
      } else {
        body.results.push({
          omCode,
          summary: { persons: [person] },
          filled: true,
          updatedAt: new Date().toISOString(),
        })
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
        if (url.pathname === '/api/ops/gvo-summaries/assembled/')
          shapedRequests.push(request.url())
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
          message:
            'перехват GET /api/ops/gvo-summaries/assembled/ ни разу не сработал — экран запросил сводки другим путём',
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
