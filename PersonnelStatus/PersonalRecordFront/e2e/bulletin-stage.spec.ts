/**
 * Панель «Бюллетень мероприятия» карточки ОМ на ЖИВОМ стенде. Своим этапом
 * бюллетень быть перестал 24.08.2026 — он стоит НАД цепочкой этапов, и проба
 * ходит в панель, а не в карточку активного этапа.
 *
 * 🔴 ТЕКСТА БЮЛЛЕТЕНЯ В ПАНЕЛИ НЕТ (Plane №943, слово заказчика 07.09.2026):
 * «Краткое описание», «Первичные задачи направлениям», «Документы к
 * подготовке» и «Сохранить бюллетень» сняты со всего проекта, а сервер их для
 * перехода не требует. Первая проба стережёт именно это: полей нет, а
 * «Открыть рекогносцировку» у ОМ без объекта проходит без них.
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

  test('текста бюллетеня нет, а рекогносцировка открывается без него', async ({ page }) => {
    const token = await apiToken()
    // Своё безусловно (Plane №853): ОМ без объекта на «Бюллетене», описание и
    // задачи пустые — именно та строка, которую до №943 сервер отбивал
    // «BULLETIN_INCOMPLETE».
    const id = await prepareEvent(token)
    const event = (await events(token, BULLETIN_TITLE)).find((e) => e.id === id)
    expect(event, `не удалось подготовить фикстуру (${id})`).toBeDefined()
    expect(event!.stage, 'своя фикстура не на «Бюллетене»').toBe('BULLETIN')
    expect(event!.objectId, 'своя фикстура с объектом — переход открыт и без №943').toBeNull()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${event!.id}/`)
    const card = page.getByTestId('bulletin-panel')
    await expect(card).toBeVisible({ timeout: 15_000 })
    // Сначала — что панель ВООБЩЕ раскрыта и несёт сведения: «поля нет» на
    // пустой панели зелено всегда.
    await expect(card.getByText('Сведения об ОМ', { exact: false }).first()).toBeVisible()
    for (const gone of ['Краткое описание', 'Первичные задачи', 'Документы к подготовке', 'Сохранить бюллетень']) {
      await expect(card.getByText(gone, { exact: false }), `«${gone}» снят со всего проекта (№943)`).toHaveCount(0)
    }
    await expect(card.locator('textarea')).toHaveCount(0)

    // Переход открыт без текста — и это видит бэк.
    const open = page.getByRole('button', { name: 'Открыть рекогносцировку' })
    await expect(open).toBeEnabled({ timeout: 15_000 })
    await open.click()
    await expect
      .poll(async () => (await events(token, BULLETIN_TITLE)).find((e) => e.id === id)?.stage, {
        timeout: 20_000,
      })
      .toBe('RECON')
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
