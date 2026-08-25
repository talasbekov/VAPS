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
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

// Фикстура «Сведений об ОМ»: даты выбраны так, что и дни недели, и
// продолжительность различимы (вторник → четверг, три дня включительно).
const FACTS_TITLE = 'Проба сведений об ОМ (e2e)'
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

async function objectCard(token: string, id: string): Promise<{ address: string }> {
  const res = await fetch(`${API}/api/ops/objects/${id}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as { address: string }
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
    let event = suitable(await events(token))
    if (event === undefined) {
      await prepareEvent(token)
      // Ищем СВОЮ фикстуру запросом, а не на первой странице: реестр стенда
      // перевалил за page_size, и только что созданное ОМ в первые 50 строк
      // не попадало — проба падала на «не удалось подготовить фикстуру»,
      // хотя фикстура была создана.
      event = suitable(await events(token, BULLETIN_TITLE))
      expect(event, 'не удалось подготовить фикстуру').toBeDefined()
    }
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
    let event = suitable(await events(token))
    if (event === undefined) {
      await prepareEvent(token)
      event = suitable(await events(token, BULLETIN_TITLE))
    }
    expect(event, 'на стенде нет ОМ на стадии «Бюллетень»').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${event!.id}/`)
    const open = page.getByRole('button', { name: 'Открыть рекогносцировку' })
    await expect(open).toBeEnabled({ timeout: 15_000 })

    // Набранное, но НЕ сохранённое запирает переход и говорит почему.
    // Текст черновика УНИКАЛЕН на прогон: фикстура переиспользуется, и в
    // прошлый раз проба СОХРАНИЛА в неё свой же черновик — повтор той же
    // строки не менял бы поле, признак `dirty` не вставал, и замок «не
    // сработал» по причине, не имеющей к нему отношения. В одиночку проба
    // при этом зеленела: там ей доставалась свежая фикстура.
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
    expect(target.objectId, 'фикстура должна быть привязана к объекту').not.toBeNull()
    const object = await objectCard(token, target.objectId!)
    expect(object.address.trim(), 'у объекта стенда пустой адрес — проба вакуумна').not.toBe('')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const facts = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Сведения об ОМ' }),
    })
    await expect(facts).toBeVisible({ timeout: 15_000 })

    await expect(facts).toContainText(`Номер ОМ: ${target.code}`)
    await expect(facts).toContainText(`Объект проведения: ${target.objectName}`)
    // Адрес живёт НЕ в мероприятии: карточка ходит за ним в реестр объектов
    await expect(facts).toContainText(`Место / адрес: ${object.address}`)
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
    // Слэш на конце добавляет Next (trailingSlash), в разметке его нет
    await expect(facts.getByRole('link', { name: 'сводки ГВО' })).toHaveAttribute(
      'href',
      `/security-ops/gvo/${target.id}/`,
    )
  })

  // Задержать ответ о правах удаётся только при ДВУХ условиях сразу, и оба
  // выяснились красной пробой — без них проба зеленела не от задержки, а от
  // медленного первого рендера (окно загрузки прав ~0.5 с) и разваливалась на
  // прогретом dev-сервере:
  //
  // * `serviceWorkers: 'block'` — фронт держит service worker MSW, и запросы
  //   идут через него; `page.route` запросы воркера не видит. Мок-домены
  //   бюллетеню не нужны: он ходит в живой `/api/ops/*`;
  // * матчер-ПРЕДИКАТ вместо строки-глоба: `'**/api/operations/
  //   my-permissions/**'` этот адрес НЕ ловит — у Playwright `/**` требует
  //   ещё одного сегмента, а путь кончается слэшем.
  //
  // Счётчик перехватов ниже больше не даёт пробе соврать про задержку.
  test('незагруженные права — не отказ: адрес ждёт, а не обвиняет', async ({ page }) => {
    const token = await apiToken()
    const target = await factsEvent(token)
    const object = await objectCard(token, target.objectId!)

    await signIn(page)
    let permissionsAsked = 0
    await page.route(
      (url) => url.pathname.includes('/api/operations/my-permissions/'),
      async (route) => {
        permissionsAsked += 1
        await new Promise((resolve) => setTimeout(resolve, 4_000))
        await route.continue()
      }
    )
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const facts = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Сведения об ОМ' }),
    })
    await expect(facts).toContainText(
      'Место / адрес: загрузка карточки объекта…',
      { timeout: 15_000 }
    )
    await expect(facts).not.toContainText('нужно право')

    // Полторы секунды спустя ответа о правах всё ещё нет: окно держит
    // задержка, а не медленный первый рендер (он укладывался в полсекунды)
    await page.waitForTimeout(1_500)
    await expect(facts).toContainText('Место / адрес: загрузка карточки объекта…')
    await expect(facts).not.toContainText('нужно право')

    // Дождались прав — адрес появился, отказа не было ни на одном кадре
    await expect(facts).toContainText(`Место / адрес: ${object.address}`, {
      timeout: 15_000,
    })
    expect(permissionsAsked, 'запрос прав прошёл мимо перехвата').toBeGreaterThan(0)
  })
})

/** Заводит пустое ОМ на этапе «Бюллетень» — БЕЗ объекта: с объектом сервер
 * ставит ОМ сразу на рекогносцировку, и стадии «Бюллетень» у него не бывает. */
async function prepareEvent(token: string): Promise<void> {
  await createEvent(token, {
    title: BULLETIN_TITLE,
    businessDate: '2026-08-25',
    withObject: false,
  })
}

/** ОМ с обеими датами для «Сведений об ОМ» — заводится один раз и потом
 * находится по названию: каждый прогон новое мероприятие засорял бы реестр. */
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
): Promise<void> {
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
    await call('POST', '/api/ops/security-events/', { ...payload, kind: 'INTERNAL' })
    return
  }
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  await call('POST', '/api/ops/security-events/', {
    ...payload,
    kind: 'INTERNAL',
    objectId: object.id,
  })
}
