/**
 * Правая колонка расстановки — только пул штаба (`[РАС-04]`, `[РАС-05]`, Plane №428).
 *
 * До этой задачи, пока штаб не принял состав, колонка «Доступные сотрудники»
 * показывала ВСЮ кадровую базу (440 человек) с поиском и страницами — и
 * предлагала на пост тех, кого сервер всё равно отклонит. Теперь:
 *
 *  1) ОМ без принятого состава — пустое состояние «Силы на объект ещё не
 *     выделены · Заявка ОМ-код: прислано Y из N → Сбор сил на ОМ», ни поиска,
 *     ни списка, ни запроса к кадровой базе (проба ловит сетевой запрос);
 *  2) ОМ с составом — заголовок «Выделено на объект штабом», подзаголовок
 *     «Выделено X из потребности N», фильтр «Управление», у строки
 *     «свободен» либо «на посту …».
 *
 * Фикстуры проба готовит сама (как `placement-stage`); для (2) состав
 * принимается общим помощником `stand-roster` тем же API-путём, что в «Сборе сил».
 *
 * КРАСНОТА НА МУТАЦИИ: верни `enabled: !fromRoster` у `usePersonnelPage` —
 * (1) красна на запросе `/api/ops/personnel/`.
 */
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { acceptRosterFor } from './stand-roster'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SHOTS = path.join(__dirname, '..', '..', '..', '..', 'docs', 'audit', 'om-2026-09-03')

interface EventRow {
  id: string
  code: string
  stage: string
  forceRoster: { employeeId: string }[]
}

async function token(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(tok: string): Promise<EventRow[]> {
  const res = await fetch(`${API}/api/ops/security-events/?page_size=100`, {
    headers: { Authorization: `Bearer ${tok}` },
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

/** ОМ на «Расстановке» без состава — тем же путём, что и проба этапа. */
async function prepareWithoutRoster(tok: string): Promise<string> {
  const headers = { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }
  const call = async (method: string, p: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return res.json().catch(() => ({}))
  }
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find((o: { publishedVersionCount: number }) => o.publishedVersionCount > 0)
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  const roster = await call('GET', '/api/ops/personnel/?page_size=1')
  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба пула штаба (e2e)',
    objectId: object.id,
    businessDate: '2026-09-22',
    kind: 'INTERNAL',
    // Старший объекта — с №424 рекогносцировка без него закрыта.
    chiefEmployeeId: roster.results[0]?.id,
  })
  const base = `/api/ops/security-events/${created.id}`
  await call('PATCH', `${base}/bulletin/`, { briefDescription: 'Проба пула.', initialTasks: '—' })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
  const after = await call('GET', `${base}/`)
  await call('PATCH', `${base}/recon/`, {
    checklist: after.reconChecklist.map((i: Record<string, unknown>) => ({ ...i, done: true, result: 'MATCHES' })),
    sectorPosts: after.reconSectorPosts,
  })
  const onPlacement = await call('POST', `${base}/recon/complete/`)
  // 🔴 ФИКСТУРА ОТВЕЧАЕТ ЗА СЕБЯ (Plane №653). Здесь результат завершения
  // рекогносцировки не читался вовсе: подготовка, споткнувшаяся на любом
  // шаге, возвращала id, и проба падала ПОЗЖЕ и НЕ ТАМ — на «нет колонки
  // расстановки» вместо имени сломанного звена. Соседняя `placement-stage`
  // эту проверку делает; здесь её просто забыли.
  if (onPlacement.stage !== 'PLACEMENT') {
    throw new Error(
      `фикстура не дошла до «Расстановки»: стадия ${onPlacement.stage ?? '—'}, ` +
        `${JSON.stringify(onPlacement).slice(0, 200)}`,
    )
  }
  return created.id as string
}

test.describe(LIVE ? 'пул штаба на расстановке' : 'пул штаба (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('без принятого состава — пустое состояние, кадровая база не спрашивается', async ({ page }) => {
    const tok = await token()
    let target = (await events(tok)).find((e) => e.stage === 'PLACEMENT' && e.forceRoster.length === 0)
    if (target === undefined) {
      const id = await prepareWithoutRoster(tok)
      target = (await events(tok)).find((e) => e.id === id)
    }
    expect(target, 'не удалось подготовить ОМ на «Расстановке» без состава').toBeDefined()

    const personnelCalls: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/ops/personnel/')) personnelCalls.push(req.url())
    })
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const card = page.getByRole('region', { name: 'Расстановка сил' })
    await expect(card).toBeVisible()
    const empty = card.locator('[data-slot="placement-pool-empty"]')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText('Силы на объект ещё не выделены')
    // 🔴 ПИН ПРАВЛЕН ОСОЗНАННО (Plane №648). Здесь стояло «прислано X из N» —
    // строка, числитель которой СТРУКТУРНО ноль: у автозаявки сервер пишет
    // `allocatedCount = len(force_roster)`, а это состояние рисуется ровно
    // тогда, когда состав пуст. Регулярка со `\d+` принимала ноль как
    // законное число и потому зеленела на дефекте. Теперь экран называет то,
    // что действительно знает, и проба требует именно этого.
    await expect(empty).toContainText(
      new RegExp(
        `(Заявка ${target!.code}: запрошено \\d+ чел\\. В состав штаб пока никого не принял\\.` +
          `|Заявки на силы по ${target!.code} ещё нет\\.)`,
      ),
    )
    await expect(empty, 'вернулось «прислано X из N»').not.toContainText('прислано')
    await expect(empty.getByRole('link', { name: 'Сбор сил на ОМ →' })).toBeVisible()
    await expect(card.getByLabel('Поиск кандидатов')).toHaveCount(0)
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(personnelCalls, 'кадровая база не должна спрашиваться без состава').toEqual([])
    await card.screenshot({ path: path.join(SHOTS, 'placement-pool-empty.png') })
  })

  test('с составом — «Выделено X из потребности N», фильтр по управлению, «свободен / на посту»', async ({ page }) => {
    const tok = await token()
    let target = (await events(tok)).find((e) => e.stage === 'PLACEMENT' && e.forceRoster.length > 0)
    if (target === undefined) {
      // Состав принимается тем же API-путём, что и в «Сборе сил» (общий
      // помощник `stand-roster`): своего ОМ с составом на стенде может не быть.
      const id = await prepareWithoutRoster(tok)
      await acceptRosterFor(tok, id, { count: 2 })
      target = (await events(tok)).find((e) => e.id === id)
    }
    expect(target, 'не удалось подготовить ОМ с принятым составом').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const card = page.getByRole('region', { name: 'Расстановка сил' })
    await expect(card.getByText('Выделено на объект штабом')).toBeVisible()
    await expect(card.getByText(/Выделено \d+ из потребности \d+/)).toBeVisible()
    await expect(card.getByLabel('Фильтр по управлению')).toBeVisible()
    await expect(card.getByText(/свободен|на посту /).first()).toBeVisible()
    // Плейсхолдер обещает ровно то, что делает (Plane №651): поиск по
    // подразделению серверная половина умела, но её выключил `[РАС-04]`.
    await expect(card.getByLabel('Поиск кандидатов')).toHaveAttribute(
      'placeholder',
      'Поиск по ФИО',
    )
    // Мёртвой разметки кадрового списка на экране нет (Plane №652): счётчика
    // страниц и пагинации при составе не бывает — он весь на руках.
    await expect(card.getByText(/Найдено \d+ · страница/)).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Дальше', exact: true })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Назад', exact: true })).toHaveCount(0)
    await expect(card.getByText(/Состав мероприятия: \d+ чел\./)).toBeVisible()
    await card.screenshot({ path: path.join(SHOTS, 'placement-pool.png') })
  })

  test('пустой список называет ТЕ фильтры, что стоят (Plane №649, №650)', async ({ page }) => {
    const tok = await token()
    let target = (await events(tok)).find((e) => e.stage === 'PLACEMENT' && e.forceRoster.length > 0)
    if (target === undefined) {
      const id = await prepareWithoutRoster(tok)
      await acceptRosterFor(tok, id, { count: 2 })
      target = (await events(tok)).find((e) => e.id === id)
    }
    expect(target, 'не удалось подготовить ОМ с принятым составом').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const card = page.getByRole('region', { name: 'Расстановка сил' })
    await expect(card.getByText('Выделено на объект штабом')).toBeVisible()

    // Фамилия, которой в составе заведомо нет: список пустеет ПОИСКОМ, а не
    // фильтром рейтинга — и экран обязан назвать именно поиск. До правки он
    // посылал сбрасывать рейтинг, который стоит на «Все».
    await card.getByLabel('Поиск кандидатов').fill('ЗаведомоНетТакойФамилии')
    const emptyNote = card.getByText(/Под выбранные фильтры/)
    await expect(emptyNote).toBeVisible()
    await expect(emptyNote, 'пустоту объяснили не тем фильтром').toContainText(
      'поиск «ЗаведомоНетТакойФамилии»',
    )
    await expect(emptyNote).not.toContainText('рейтинг')
    await card.getByLabel('Поиск кандидатов').fill('')

    // 🔴 ФИЛЬТР УПРАВЛЕНИЯ СВЕРЯЕТСЯ СО СПИСКОМ ВАРИАНТОВ (Plane №650).
    // Значение, которого в вариантах нет, — то же самое, что состояние после
    // снятия штабом последнего человека управления: `<select>` рисует «Все
    // управления», а отбор резал по исчезнувшему значению. Ставим его прямо
    // в DOM и проверяем, что экран и отбор говорят одно и то же.
    const unit = card.getByLabel('Фильтр по управлению')
    await unit.evaluate((node: HTMLSelectElement) => {
      const ghost = document.createElement('option')
      ghost.value = 'Управление, которого нет в составе'
      ghost.text = 'Управление, которого нет в составе'
      node.append(ghost)
      node.value = ghost.value
      node.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(unit, 'выбранное значение осталось в поле, хотя варианта нет').toHaveValue('')
    await expect(
      card.getByText(/Под выбранные фильтры/),
      'отбор режет по значению, которого в поле уже нет',
    ).toHaveCount(0)
  })

  /**
   * Два назначения одного человека называются ОБА (Plane №654).
   *
   * 🔴 ЭТО ПРОБА НА ДАННЫЕ, А НЕ НА ПУТЬ ЭКРАНА. Сегодня создать такую
   * расстановку через API нельзя: `assign_placement` отбивает
   * `DOUBLE_ASSIGNMENT` — «сотрудник не может занимать два поста одного ОМ».
   * Но `placement_assignments` это JSON-поле без ограничения БД: строки в него
   * кладут ещё и миграции с фикстурами, а прежнее правило было заведено не
   * всегда. Поэтому состояние подменяется в ОТВЕТЕ РУЧКИ — экран обязан
   * пережить данные, которые может получить, а не только те, которые сам
   * умеет создать.
   */
  // 🔴 `serviceWorkers: 'block'` НУЖЕН ЗДЕСЬ И ТОЛЬКО ЗДЕСЬ: без него запросы
  // страницы идут через MSW, и `page.route` не видит их вовсе — перехват
  // молча не срабатывает, а проба падает на «данных нет» вместо предмета.
  test.describe(() => {
    test.use({ serviceWorkers: 'block' })

  test('человек на двух постах назван обоими постами (Plane №654)', async ({ page }) => {
    const tok = await token()
    let target = (await events(tok)).find((e) => e.stage === 'PLACEMENT' && e.forceRoster.length > 0)
    if (target === undefined) {
      const id = await prepareWithoutRoster(tok)
      await acceptRosterFor(tok, id, { count: 2 })
      target = (await events(tok)).find((e) => e.id === id)
    }
    expect(target, 'не удалось подготовить ОМ с принятым составом').toBeDefined()

    let titles: string[] = []
    await page.route(
      (url) => url.pathname.endsWith(`/api/ops/security-events/${target!.id}/`),
      async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as {
          reconSectorPosts: { id: string; sector: string; post: string }[]
          placementAssignments: Record<string, unknown>[]
          forceRoster: { employeeId: string; name: string }[]
        }
        const [first, second] = body.reconSectorPosts
        if (first === undefined || second === undefined) {
          await route.fulfill({ response })
          return
        }
        const member = body.forceRoster[0]!
        titles = [
          `${first.sector} · ${first.post}`,
          `${second.sector} · ${second.post}`,
        ]
        const row = (postId: string, index: number) => ({
          id: `probe-assignment-${index}`,
          postId,
          employeeId: member.employeeId,
          employeeName: member.name,
          roleCode: null,
          sectionCode: null,
          acknowledgedAt: null,
          ratingOverrideReason: null,
          needOverrideReason: null,
          divisionName: '',
          statusCode: null,
          statusLabel: null,
          isSectorSenior: false,
        })
        body.placementAssignments = [row(first.id, 1), row(second.id, 2)]
        await route.fulfill({ response, json: body })
      },
    )

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const card = page.getByRole('region', { name: 'Расстановка сил' })
    await expect(card.getByText('Выделено на объект штабом')).toBeVisible({ timeout: 20_000 })
    expect(titles.length, 'у ОМ меньше двух постов — проба вакуумна').toBe(2)

    const line = card.getByText(/на пост(у|ах) /).first()
    await expect(line, 'второе назначение человека скрыто').toContainText(
      `на постах ${titles[0]}, ${titles[1]}`,
    )
  })
  })
})
