/**
 * Панель «Бюллетень мероприятия» карточки ОМ на ЖИВОМ стенде. Своим этапом
 * бюллетень быть перестал 24.08.2026 — он стоит НАД цепочкой этапов, и проба
 * ходит в панель, а не в карточку активного этапа.
 *
 * Первая проба отвечает на один вопрос: готовность считается по
 * СОХРАНЁННОМУ бюллетеню, а не по набранному в полях. Разница не
 * косметическая: сервер смотрит на своё состояние, и набранный, но не
 * сохранённый текст этап не откроет — экран, считающий по форме, обещал бы
 * завершение, которого не будет.
 *
 * Вторая — что «Сведения об ОМ» собраны из ответов сервера, а не из вёрстки:
 * адрес приходит из КАРТОЧКИ ОБЪЕКТА (отдельный запрос), продолжительность
 * выводится из пары дат, статус — из стадии.
 *
 * Фикстуры проба готовит сама и переиспользует по названию; этапы не
 * завершает — иначе фикстура одноразовая.
 *
 * С 25.08.2026 (Plane «Реестр ОМ-5») ОМ С ОБЪЕКТОМ заводится сразу на
 * рекогносцировке, и стадия «Бюллетень» достижима ТОЛЬКО у ОМ без объекта —
 * фикстуры готовности заводятся без него намеренно. Панель бюллетеня при
 * этом правится на любой стадии, кроме закрытой: у ОМ, стартовавшего с
 * рекогносцировки, это единственное место, где описание и задачи вписывают.
 */
import { uniqueBusinessDate } from './business-date'
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

// Фикстура «Сведений об ОМ»: даты выбраны так, что и дни недели, и
// продолжительность различимы (вторник → четверг, три дня включительно).
const FACTS_TITLE = 'Проба сведений об ОМ без объекта (e2e)'
const BULLETIN_TITLE = 'Проба бюллетеня без объекта (e2e)'
const STAGE_LABEL: Record<string, string> = {
  BULLETIN: 'Бюллетень',
  RECON: 'Рекогносцировка',
  DEMAND: 'Потребность',
  FORCES: 'Запрос сил',
  PLACEMENT: 'Расстановка',
  APPROVAL: 'Согласование',
  ACKNOWLEDGEMENT: 'Ознакомление',
  CONDUCT: 'Проведение',
  CLOSED: 'Закрыто',
}
const FACTS_START = '2026-09-01'
const FACTS_END = '2026-09-03'

interface EventRow {
  id: string
  code: string
  title: string
  stage: string
  objectId: string | null
  objectName: string
  ownerName: string
  businessDate: string
  businessDateEnd: string | null
  briefDescription: string
  initialTasks: string
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(token: string, search = ''): Promise<EventRow[]> {
  const query = `page_size=50${search === '' ? '' : `&search=${encodeURIComponent(search)}`}`
  const res = await fetch(`${API}/api/ops/security-events/?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

// Service worker MSW блокируется на весь файл: раздел ОМ живой, мок-домены
// бюллетеню не нужны, а `page.route` запросы воркера не видит — без этого
// задержать ответ о правах в пробе ниже невозможно.
test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'бюллетень' : 'бюллетень (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('готовность считается по сохранённому, а не по набранному', async ({ page }) => {
    const token = await apiToken()
    const suitable = (rows: EventRow[]): EventRow | undefined =>
      rows.find(
        (e) =>
          e.stage === 'BULLETIN' &&
          // Без объекта: строка готовности «можно открывать рекогносцировку»
          // живёт только там, где переход ещё предстоит.
          e.objectId === null &&
          (e.briefDescription.trim() === '' || e.initialTasks.trim() === ''),
      )
    // 🔴 СВОЁ БЕЗУСЛОВНО (Plane №853). Здесь стояло «возьми подходящее, а заведи
    // своё только если не нашлось» — на живом стенде это значит править чужой
    // бюллетень, который соседняя сессия ведёт своим путём.
    // Фикстура ищется ЗАПРОСОМ по названию, а не на первой странице реестра:
    // он перевалил за `page_size`, и только что созданное ОМ в первые 50 строк
    // не попадает.
    const id = await prepareEvent(token)
    const event = (await events(token, BULLETIN_TITLE)).find((e) => e.id === id)
    expect(event, `не удалось подготовить фикстуру (${id})`).toBeDefined()
    expect(suitable([event!]), 'своя фикстура не на «Бюллетене» без объекта').toBeDefined()
    const target = event!

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const card = page.getByTestId('bulletin-panel')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toContainText('заполнено не всё')
    await expect(card).toContainText('Краткое описание — не заполнено')

    // Набранное, но НЕ сохранённое готовность не меняет — меняет предупреждение
    await card.getByLabel('Краткое описание *').fill('Проба бюллетеня.')
    await card.getByLabel('Первичные задачи направлениям *').fill('Проба задач.')
    await expect(card).toContainText('Есть несохранённые правки')
    await expect(card).toContainText('заполнено не всё')
    await expect(card).toContainText('Краткое описание — не заполнено')

    // Сохранение открывает рекогносцировку, и это видит бэк
    await card.getByRole('button', { name: 'Сохранить бюллетень' }).click()
    await expect(card).toContainText('можно открывать рекогносцировку', {
      timeout: 15_000,
    })
    await expect(card).toContainText('Краткое описание — сохранено')
    const fresh = (await events(token)).find((e) => e.id === target.id)
    expect(fresh?.briefDescription).toBe('Проба бюллетеня.')
  })

  test('несохранённый бюллетень не даёт открыть рекогносцировку', async ({ page }) => {
    // Панель бюллетеня стоит НАД этапами, а кнопка перехода — в области
    // этапа: без переданного наружу признака черновика переход уносил бы
    // набранный текст молча (после смены стадии сервер правку не примет).
    const token = await apiToken()
    const suitable = (rows: EventRow[]): EventRow | undefined =>
      rows.find((e) => e.stage === 'BULLETIN' && e.objectId === null)
    // Своё безусловно и УЖЕ ЗАПОЛНЕННОЕ (Plane №853): проба начинает с того,
    // что кнопка перехода включена, а включена она только у полного бюллетеня.
    const id = await prepareFilledBulletin(token)
    const event = (await events(token, BULLETIN_TITLE)).find((e) => e.id === id)
    expect(event, `не удалось подготовить фикстуру (${id})`).toBeDefined()
    expect(suitable([event!]), 'своя фикстура не на «Бюллетене» без объекта').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${event!.id}/`)
    const open = page.getByRole('button', { name: 'Открыть рекогносцировку' })
    await expect(open).toBeEnabled({ timeout: 15_000 })

    // Набранное, но НЕ сохранённое запирает переход и говорит почему.
    // Текст черновика уникален на прогон. Прежде это было ОБЯЗАТЕЛЬНО и
    // объяснялось так: «фикстура переиспользуется, и в прошлый раз проба
    // СОХРАНИЛА в неё свой же черновик». То есть проба опиралась на чужое
    // прошлое — ровно болезнь №853. Теперь фикстура своя, и уникальность
    // осталась лишь как страховка.
    const panel = page.getByTestId('bulletin-panel')
    const draft = `Черновик, который нельзя потерять. ${Date.now()}`
    await panel.getByLabel('Краткое описание *').fill(draft)
    await expect(open).toBeDisabled()
    await expect(page.getByText('иначе переход их потеряет')).toBeVisible()

    // Сохранение снимает замок
    await panel.getByRole('button', { name: 'Сохранить бюллетень' }).click()
    await expect(open).toBeEnabled({ timeout: 15_000 })
  })

  test('«Сведения об ОМ» собраны из ответов сервера', async ({ page }) => {
    const token = await apiToken()
    const target = await factsEvent(token)
    // 🔴 ИНВАРИАНТ ИСПРАВЛЕН (Plane №750). Здесь стояло «ОМ на стадии
    // „Бюллетень" объекта не имеет НИКОГДА» — это неправда с двух сторон:
    // `STAGE_OVERRIDE_TARGETS` содержит `BULLETIN`, то есть администратор
    // может вернуть туда ОМ С объектом; а с №748 панель видна на всех
    // незакрытых стадиях, и «Сведения об ОМ» больше не привязаны к
    // «Бюллетеню» вовсе.
    //
    // Фикстура этой пробы заводится БЕЗ объекта НАМЕРЕННО — предмет здесь
    // остальные факты, — и потому ассертов «Объект проведения» и «Место /
    // адрес» тут нет. Их состояние стережёт соседняя проба ниже, на своей
    // фикстуре С объектом.
    expect(target.objectId, 'фикстура этой пробы заводится без объекта').toBeNull()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const facts = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Сведения об ОМ' }),
    })
    await expect(facts).toBeVisible({ timeout: 15_000 })

    await expect(facts).toContainText(`Номер ОМ: ${target.code}`)
    // Дни недели и продолжительность выводятся из дат, а не хранятся
    await expect(facts).toContainText('Дата начала: 01.09.2026, вторник')
    await expect(facts).toContainText('Дата окончания: 03.09.2026, четверг')
    await expect(facts).toContainText('Продолжительность: 3 дня')
    // Статус читается из ОТВЕТА сервера, а не пинится литералом: стадия
    // заведения менялась (24.08 и 25.08), и литерал краснел бы при каждой
    // такой правке, ничего не стерегя.
    await expect(facts).toContainText(`Текущий статус: ${STAGE_LABEL[target.stage]}`)
    // Ответственный — подпись человека, а не id учётки, которым он вошёл
    expect(target.ownerName, 'в ответе сервера id вместо подписи').not.toMatch(/^\d+$/)
    await expect(facts).toContainText(`Ответственный за ОМ: ${target.ownerName}`)

    // Факты ГВО живые (21.08.2026): выводятся из сводки ГВО; пустая сводка
    // отвечает «уточняется», а не пустой ячейкой и не выдумкой.
    await expect(facts).toContainText('Охраняемые лица:')
    // «Старший ГРУППЫ ГВО» с 23.08.2026: рядом появился старший мероприятия
    // из бюллетеня, и у визита иностранного лица он тоже «Старший ГВО» —
    // подпись факта сводки уточнена, чтобы две строки не совпадали.
    await expect(facts).toContainText('Старший группы ГВО:')
    await expect(facts).toContainText('Численность ГВО:')
    // Ссылка ведёт на СТРАНИЦУ ВИЗИТА (`[ГВО-01]`/`[ГВО-03]`, Plane №436, №441).
    await expect(facts.getByRole('link', { name: 'сводки ГВО' })).toHaveAttribute(
      'href',
      new RegExp(`^/security-ops/visits/${target.id}/?$`),
    )
  })

  test('незагруженные права — не отказ: адрес ждёт, а не обвиняет', async ({
    page,
  }) => {
    // 🔴 ПРОБА ВЕРНУЛАСЬ (Plane №750). Её сняли в №468 с обоснованием «ОМ на
    // стадии „Бюллетень" объекта не имеет никогда» — неверным дважды:
    // администратор может ВЕРНУТЬ на «Бюллетень» мероприятие с объектом
    // (`STAGE_OVERRIDE_TARGETS`), а с №748 панель видна на всех незакрытых
    // стадиях. Лестница адреса и прав в «Сведениях об ОМ» всё это время
    // оставалась достижимой и не стереглась ничем.
    //
    // Сюжет: пока грузятся права, `hasPermission` отвечает false, хотя право
    // у администратора есть. Экран обязан сказать «загрузка», а не «нужно
    // право»: обвинить человека в отсутствии права, которого он не лишён, —
    // хуже, чем подождать.
    const token = await apiToken()
    const withObject = (await events(token)).find(
      (e) => e.objectId !== null && e.stage !== 'CLOSED',
    )
    test.skip(withObject === undefined, 'нужен незакрытый ОМ с объектом')
    const object = await objectCard(token, withObject!.objectId!)

    await signIn(page)
    await page.route('**/api/operations/my-permissions/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4_000))
      await route.continue()
    })
    await page.goto(`${APP}/security-ops/events/${withObject!.id}/`)
    const panel = page.getByTestId('bulletin-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    // Панель вне «Бюллетеня» свёрнута (№748) — раскрываем, сведения внутри.
    const toggle = panel.getByRole('button', { expanded: false }).first()
    if (await toggle.count()) await toggle.click()

    await expect(panel).toContainText('Место / адрес: загрузка карточки объекта…', {
      timeout: 15_000,
    })
    await expect(panel).not.toContainText('нужно право')

    // Дождались прав — адрес появился, отказа не было ни на одном кадре.
    await expect(panel).toContainText(`Место / адрес: ${object.address}`, {
      timeout: 15_000,
    })
  })


  test('описание и задачи правятся у ОМ, заведённого сразу с рекогносцировки', async ({
    page,
  }) => {
    // Панель бюллетеня — ЕДИНСТВЕННЫЙ редактор `briefDescription` и
    // `initialTasks`, а ОМ с объектом заводится сразу на «Рекогносцировке».
    // Пока панель рисовалась только при `stage === 'BULLETIN'`, этим полям
    // не было входа НИКОГДА (Plane №748) — при том что сервер PATCH принимает
    // на любой стадии, а сама панель это в своей шапке и объявляет.
    const token = await apiToken()
    const target = (await events(token)).find(
      (e) => e.stage !== 'BULLETIN' && e.stage !== 'CLOSED',
    )
    test.skip(target === undefined, 'нужен ОМ дальше «Бюллетеня» и не закрытый')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const panel = page.getByTestId('bulletin-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })

    // Свёрнута: №468 убирал панель именно за то, что она отжимала работу вниз.
    const toggle = panel.getByRole('button', { expanded: false }).first()
    await expect(toggle).toBeVisible()
    await toggle.click()

    // Раскрыв — можно править: поля на месте и не выключены.
    const brief = panel.getByLabel(/Краткое описание/i)
    await expect(brief).toBeVisible({ timeout: 10_000 })
    await expect(brief).toBeEditable()
  })

  test('у внутреннего ОМ без объектов посещения реквизиты видны и после «Бюллетеня»', async ({
    page,
  }) => {
    // Тип, локация, охраняемые лица и старший живут в панели бюллетеня, а
    // «смягчение», на которое опирался №468 — ссылка «Карточка визита →» в
    // шапке, — само спрятано у внутренних ОМ: страницы визита у них нет
    // (Plane №749). Пока панель рисовалась только на стадии «Бюллетень», у
    // внутреннего мероприятия без объектов посещения дальше по цепочке эти
    // сведения не показывались НИГДЕ.
    //
    // Состояние подставляется перехватом: заводить внутренний ОМ и снимать у
    // него объекты — мутация стенда ради одного экрана.
    const token = await apiToken()
    const target = (await events(token)).find(
      (e) => e.stage !== 'BULLETIN' && e.stage !== 'CLOSED',
    )
    test.skip(target === undefined, 'нужен ОМ дальше «Бюллетеня» и не закрытый')

    await page.route(
      new RegExp(`/api/ops/security-events/${target!.id}/(\\?.*)?$`),
      async (r) => {
        const response = await r.fetch()
        const body = await response.json()
        body.kind = 'INTERNAL'
        body.visitObjects = []
        await r.fulfill({ response, json: body })
      },
    )

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const panel = page.getByTestId('bulletin-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    await panel.getByRole('button', { expanded: false }).first().click()

    // Реквизиты на месте — им больше неоткуда взяться на этом экране.
    await expect(panel).toContainText('Тип мероприятия')
    await expect(panel).toContainText('Локация')
    await expect(panel).toContainText('Охраняемые лица')
    await expect(panel).toContainText('Старший наряда')
  })
})

/** Заводит пустое ОМ на этапе «Бюллетень» — БЕЗ объекта: с объектом сервер
 * ставит ОМ сразу на рекогносцировку, и стадии «Бюллетень» у него не бывает. */
/**
 * СВОЙ бюллетень, УЖЕ ЗАПОЛНЕННЫЙ и сохранённый (Plane №853).
 *
 * Нужен пробе, которая проверяет замок перехода: она начинает с того, что
 * кнопка «Открыть рекогносцировку» ВКЛЮЧЕНА, а включена она только у полного
 * бюллетеня. Раньше проба брала фикстуру со стенда и полагалась на то, что её
 * заполнил ПРЕДЫДУЩИЙ ПРОГОН, — это прямо записано было в её комментарии как
 * приём. Своя фикстура снимает зависимость от чужого прошлого.
 */
async function prepareFilledBulletin(token: string): Promise<string> {
  const id = await prepareEvent(token)
  const res = await fetch(`${API}/api/ops/security-events/${id}/bulletin/`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      briefDescription: 'Проба замка перехода.',
      initialTasks: 'Проба задач.',
    }),
  })
  // 🔴 `assertStep` ЗДЕСЬ НЕ СРАБАТЫВАЛ НИКОГДА (найдено ревью, №892): он
  // освобождает шаг по списку `TRANSITION_STEPS`, где есть
  // `bulletin/complete/`, но нет `bulletin/`. Отбитый PATCH оставался
  // молчаливым, и проба падала позже на «кнопка не включилась» — вместо кода и
  // тела отказа. Проверяем прямо.
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `PATCH /api/ops/security-events/${id}/bulletin/ → ${res.status}: ${body.slice(0, 300)}`,
    )
  }
  return id
}

async function prepareEvent(token: string): Promise<string> {
  return createEvent(token, {
    title: BULLETIN_TITLE,
    // Своя деловая дата на каждую подготовку (Plane №853).
    businessDate: uniqueBusinessDate(),
    withObject: false,
  })
}

/** ОМ с обеими датами для «Сведений об ОМ» — заводится один раз и потом
 * находится по названию: каждый прогон новое мероприятие засорял бы реестр. */
/** Карточка объекта реестра — адрес берётся оттуда, а не из полей ОМ. */
async function objectCard(
  token: string,
  id: string,
): Promise<{ code: string; name: string; type: string; address: string }> {
  const res = await fetch(`${API}/api/ops/objects/${id}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as {
    code: string
    name: string
    type: string
    address: string
  }
}

async function factsEvent(token: string): Promise<EventRow> {
  const match = (rows: EventRow[]): EventRow | undefined =>
    rows.find(
      (e) =>
        e.title === FACTS_TITLE &&
        // Стадию НЕ пиним: фикстура нужна ради дат и объекта, а стадия
        // заведения сменилась 25.08 — пин отправлял бы пробу заводить новое
        // ОМ каждый прогон и засорял реестр.
        e.businessDate === FACTS_START &&
        e.businessDateEnd === FACTS_END,
    )
  let found = match(await events(token, FACTS_TITLE))
  if (found === undefined) {
    await createEvent(token, {
      title: FACTS_TITLE,
      businessDate: FACTS_START,
      businessDateEnd: FACTS_END,
      // БЕЗ объекта (Plane №468): панель «Бюллетень мероприятия» рисуется
      // только на стадии «Бюллетень», а ОМ С объектом заводится сразу
      // рекогносцировкой и этой стадии не видит вовсе — «Сведения об ОМ»
      // у него на экране не появляются.
      withObject: false,
    })
    found = match(await events(token, FACTS_TITLE))
  }
  expect(found, 'не удалось подготовить ОМ со сведениями').toBeDefined()
  return found!
}

/** Создаёт ОМ на первом объекте с опубликованным паспортом. */
async function createEvent(
  token: string,
  body: {
    title: string
    businessDate: string
    businessDateEnd?: string
    /** Без объекта ОМ остаётся на «Бюллетене»; с объектом — сразу RECON. */
    withObject?: boolean
  },
  // Возвращается id ЗАВЕДЁННОГО мероприятия (Plane №853). Пока помощник отдавал
  // `void`, найти своё после подготовки было НЕЧЕМ — и вызывающим не оставалось
  // ничего, кроме поиска «подходящего» по реестру стенда.
): Promise<string> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, payload?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    return res.json().catch(() => ({}))
  }
  const { withObject = true, ...payload } = body
  if (!withObject) {
    const bare = await call('POST', '/api/ops/security-events/', {
      ...payload,
      kind: 'INTERNAL',
    })
    return String(bare.id)
  }
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  const created = await call('POST', '/api/ops/security-events/', {
    ...payload,
    kind: 'INTERNAL',
    objectId: object.id,
  })
  return String(created.id)
}
