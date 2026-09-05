/**
 * Этап «Расстановка» карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на один вопрос: дерево «сектор → посты» и карточка поста
 * стоят на настоящих данных расчёта и на живых мутациях назначения — счётчик
 * заполненности меняется от РЕАЛЬНОГО назначения, а не от локального стейта.
 *
 * Мероприятие берётся с живого стенда — зашитых id нет, стенд пересевается.
 * Если ОМ на стадии «Расстановка» нет, проба СКИПАЕТСЯ (молча не зеленеет).
 * Подготовить такое ОМ можно через API: создать → bulletin/complete →
 * recon/import-from-passport → отметить чек-лист → recon/complete. Дальше
 * ничего: «Потребность» и «Запрос сил» проходит сервер сам (Plane №110), и
 * завершение осмотра оставляет ОМ уже на «Расстановке».
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { anyChiefId } from './stand-chief'
import { requireFixture } from './fixtures'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { acceptRosterFor } from './stand-roster'
import { prepareDemandEvent } from './prepare-events'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function apiToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = (await res.json()) as { access?: string }
  if (body.access === undefined) throw new Error('нет токена стенда')
  return body.access
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

/**
 * ОМ на «Расстановке» С ПРИНЯТЫМ СОСТАВОМ (Plane №428, `[РАС-04]`): правая
 * колонка показывает только людей, принятых штабом, — кадровой базы там больше
 * нет. Первый попавшийся ОМ без состава проводится через сбор сил общим
 * помощником `stand-roster`, чтобы кликать было по кому.
 */
async function placementEventWithRoster(
  request: APIRequestContext,
  auth: Record<string, string>,
  token: string,
): Promise<{ id: string; code: string } | undefined> {
  const list = (await (
    await request.get(`${API}/api/ops/security-events/?page_size=50&stage=PLACEMENT`, {
      headers: auth,
    })
  ).json()) as { results: { id: string; code: string; forceRoster: unknown[] }[] }
  const ready = list.results.find((row) => (row.forceRoster ?? []).length > 0)
  if (ready !== undefined) return ready
  const first = list.results[0]
  if (first === undefined) return undefined
  await acceptRosterFor(token, first.id, { count: 3 })
  return first
}

test.describe(LIVE ? 'расстановка' : 'расстановка (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('дерево постов и назначение идут от живого расчёта', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }

    // Берём ОМ на стадии расстановки; расчёт постов заводим сами, чтобы проба
    // не зависела от того, что осталось в БД от прошлых прогонов.
    // Стадию фильтрует СЕРВЕР: на растущем реестре стенда фикстура уходит со
    // первой страницы, и проба молча превращается в skip.
    const target = await placementEventWithRoster(request, auth, token)
    requireFixture(target, 'мероприятие на стадии «Расстановка»')
    const eventId = target!.id

    const before = (await (
      await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
    ).json()) as {
      reconSectorPosts: { id: string; sector: string; post: string; need: number }[]
      placementAssignments: { id: string }[]
    }
    test.skip(before.reconSectorPosts.length === 0, 'у ОМ нет расчёта постов')
    const post = before.reconSectorPosts[0]

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${eventId}/`)
    // Карточка этапа ищется по ИМЕНИ ОБЛАСТИ: видимый заголовок снят как
    // повтор шапки страницы (Plane №70).
    const card = page.getByRole('region', { name: 'Расстановка сил' })
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Дерево слева перечисляет ИМЕННО посты расчёта, а не выдумку экрана
    const postButton = page.getByRole('button', { name: new RegExp(post.post) }).first()
    await expect(postButton).toBeVisible()
    await postButton.click()

    // Карточка показывает выбранный пост, его сектор и заполненность
    const panel = page.locator('section', { hasText: 'Требования поста' }).first()
    await expect(panel).toContainText(post.post)
    await expect(panel).toContainText(post.sector)
    await expect(panel).toContainText(`из ${post.need}`)

    // Правая колонка подбора — из прототипа: заголовок, чипы пула, кандидаты
    // Заголовок — по РАС-04 (Plane №428): колонка называет ПРОИСХОЖДЕНИЕ
    // пула — штаб, и число выделенных против потребности.
    await expect(page.getByText('Выделено на объект штабом')).toBeVisible()
    // Подзаголовок сменился осознанно (Plane №110): вместо «Подбор по
    // требованиям поста» колонка называет ПРОИСХОЖДЕНИЕ пула. Форм потребности
    // и выделения сил на шаге больше нет, и без этой строки человек не узнал
    // бы, почему в подборе именно эти люди. Пин стережёт, что строка есть и
    // говорит об одном из двух оснований, а не что она вообще какая-то.
    await expect(
      page.getByText(/Выделено \d+ из потребности \d+/)
    ).toBeVisible()
    // Путь к сбору состава — из снятого бокса «выделение сил»: пул собирают там.
    await expect(
      page.getByRole('main').getByRole('link', { name: /Сбор сил на ОМ/ })
    ).toBeVisible()
    // Плашка «Выделено N» — ровно чип; подзаголовок колонки «Выделено X из
    // потребности N» (Plane №428) тоже начинается с этого слова.
    await expect(page.getByText(/^Выделено \d+$/)).toBeVisible()
    await expect(page.getByText(/Совпадение \d+%/).first()).toBeVisible()

    // Сводка шага — шесть показателей прототипа
    for (const label of ['постов', 'требуется', 'назначено', 'свободно', 'незаполнено', 'конфликтов']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    }

    // Назначение — живая мутация: счётчик в дереве растёт, и бэк это видит
    const assignedBefore = (
      await (
        await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
      ).json()
    ).placementAssignments.length as number

    // Назначение — клик по кандидату в правой колонке (как в прототипе)
    await page.locator('aside button', { hasText: 'Совпадение' }).first().click()

    await expect
      .poll(async () => {
        const fresh = (await (
          await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
        ).json()) as { placementAssignments: { id: string }[] }
        return fresh.placementAssignments.length
      }, { timeout: 15_000 })
      .toBe(assignedBefore + 1)

    // Снимаем назначение обратно — проба не оставляет за собой мусор
    await page.getByRole('button', { name: 'Удалить с поста' }).first().click()
    await expect
      .poll(async () => {
        const fresh = (await (
          await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
        ).json()) as { placementAssignments: { id: string }[] }
        return fresh.placementAssignments.length
      }, { timeout: 15_000 })
      .toBe(assignedBefore)

    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })

  test('лишний пост снимается с расстановки, занятый — нет', async ({ page, request }) => {
    /**
     * Негативная ветка недобора (Plane №259, Ш-5).
     *
     * Заказчик: «штаб не всегда добирает полное количество… старшие нарядов на
     * этапе „Расстановка“ удаляют лишние посты». И правило, подтверждённое им
     * дословно 28.08.2026: «Если на этапе расстановки к посту привязан человек
     * то нельзя удалять пост, а если он пустой соответственно можно удалять
     * этот пост с расстановки».
     *
     * 🔴 Проба стережёт ОБЕ половины правила. Одна половина без второй
     * бесполезна: «снимается» без «занятый не снимается» зеленело бы и на
     * кнопке, сносящей пост вместе с людьми.
     */
    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }

    const target = await placementEventWithRoster(request, auth, token)
    requireFixture(target, 'мероприятие на стадии «Расстановка»')
    const eventId = target!.id

    type Snapshot = {
      reconSectorPosts: { id: string; post: string; need: number }[]
      placementAssignments: { id: string; postId: string; employeeId: string }[]
      forceRoster?: { employeeId: string }[]
      visitObjects: { id: string; objectName: string }[]
      forceNeed: number
    }
    const read = async (): Promise<Snapshot> =>
      (await (
        await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
      ).json()) as Snapshot

    let before = await read()
    // Пост под снятие заводит САМА проба: на стенде расчёт живёт от прошлых
    // прогонов, и «взять последний» означало бы проверять их остатки. Пост
    // добавляется правкой рекогносцировки — она стадией не ограничена.
    //
    // ПОСТОВ ЗАВОДИТСЯ ДВА, и это не запас. Правка рекогносцировки потребность
    // НЕ пересчитывает (её считает завершение рекогносцировки), поэтому после
    // снятия единственного заведённого поста сумма оставшихся совпала бы с
    // прежним `forceNeed` — и проба зеленела бы даже без пересчёта. С двумя
    // заведёнными и одним снятым сумма и прежнее число расходятся, и мутация
    // «не пересчитывать потребность» становится видимой.
    //
    // Имена постов УНИКАЛЬНЫ на прогон. С постоянными именами упавший прогон
    // оставлял свой пост на стенде, следующий заводил второй такой же, и
    // локатор по имени находил ДВА — проба падала на собственном мусоре, а
    // сообщение говорило о правиле заказчика. Уникальность здесь не
    // аккуратность, а условие того, что проба вообще про то, о чём говорит.
    const run = Date.now()
    const doomedName = `Проба №259/${run} · пост под снятие`
    const keptName = `Проба №259/${run} · пост-свидетель`
    const patched = await request.patch(
      `${API}/api/ops/security-events/${eventId}/recon/`,
      {
        headers: auth,
        data: {
          sectorPosts: [
            ...before.reconSectorPosts,
            // 🔴 Пост заводится С ОБЪЕКТОМ ПОСЕЩЕНИЯ (Plane №410). Экран
            // расстановки показывает расчёт ВЫБРАННОГО объекта, и ничейный
            // пост у ОМ с несколькими объектами лежит в отдельном пункте
            // «Не отнесены» — на экране по умолчанию его нет, и проба искала
            // бы кнопку, до которой не дошла. Через экран пост и заводится
            // так же: у показанного объекта.
            { sector: 'Проба №259', post: doomedName, need: 1, task: '', requirements: '',
              visitObjectId: before.visitObjects[0]?.id ?? null },
            { sector: 'Проба №259', post: keptName, need: 1, task: '', requirements: '',
              visitObjectId: before.visitObjects[0]?.id ?? null },
          ],
        },
      },
    )
    expect(patched.status(), 'посты пробы не завелись').toBe(200)

    before = await read()
    const doomed = before.reconSectorPosts.find((p) => p.post === doomedName)
    expect(doomed, 'заведённый пост не вернулся с сервера').toBeTruthy()

    await signIn(page)
    await page.goto(`/security-ops/events/${eventId}`)
    const removeDoomed = page.getByRole('button', { name: `Снять пост ${doomedName}` })
    await expect(removeDoomed, 'кнопки снятия поста нет на «Расстановке»').toBeVisible({
      timeout: 25_000,
    })
    await expect(removeDoomed, 'пустой пост нельзя снять — кнопка выключена').toBeEnabled()

    await removeDoomed.click()
    const dialog = page.getByRole('dialog')
    // Подтверждение обязано назвать ЧИСЛО: снятие поста меняет основание, по
    // которому собирают людей.
    await expect(dialog.getByText(new RegExp(`уменьшится на ${doomed!.need} чел`))).toBeVisible()
    await dialog.getByRole('button', { name: 'Снять пост' }).click()
    await expect(dialog, 'окно не закрылось — сервер отказал').toHaveCount(0, {
      timeout: 15_000,
    })

    const after = await read()
    expect(
      after.reconSectorPosts.some((p) => p.id === doomed!.id),
      'пост остался в расчёте',
    ).toBe(false)
    // Потребность — СУММА оставшихся постов. Сверяемся с ней, а не с
    // «прежнее минус снятое»: прежнее число моложе не всех правок расчёта, а
    // сумма оставшихся — то, что потребность обязана означать.
    const remainingNeed = after.reconSectorPosts.reduce((sum, p) => sum + p.need, 0)
    expect(
      after.forceNeed,
      'потребность не пересчитана — пост, которого нет, людей не требует',
    ).toBe(remainingNeed)
    expect(
      after.forceNeed,
      'потребность осталась прежней — значит её просто не тронули',
    ).not.toBe(before.forceNeed)

    // ВТОРАЯ ПОЛОВИНА ПРАВИЛА: занятый пост не снимается.
    //
    // Человека на пост сажает САМА проба. Прежде здесь стоял `test.skip`, если
    // на стенде не нашлось занятого поста, — и половина правила заказчика
    // молча не проверялась, а прогон показывал «skipped», что читается как
    // зелень (правило `CLAUDE.md`: скип — ответ на «этой среды нет вовсе», а
    // не на «данные не подготовили»).
    const kept = after.reconSectorPosts.find((p) => p.post === keptName)
    requireFixture(kept, 'пост-свидетель, заведённый этой же пробой')
    // Кандидат берётся ИЗ СОСТАВА мероприятия, когда состав есть: сервер
    // ставит на посты только тех, кого штаб принял в «Сборе сил»
    // (`NOT_IN_ROSTER`). У мероприятий без состава правило не включается, и
    // тогда годится любой из кадрового списка.
    //
    // 🔴 Эта развилка не теория. В одиночку проба зеленела, а в полном
    // прогоне падала 422: соседние спеки наполняют состав тому же ОМ, и
    // «первый из кадрового списка» переставал быть допустимым. Тот же урок,
    // что записан в Known-Issues 26.08.2026 про «первое попавшееся
    // мероприятие».
    const withRoster = await read()
    const busy = new Set(withRoster.placementAssignments.map((a) => String(a.employeeId)))
    const fromRoster = (withRoster.forceRoster ?? []).map((m) => String(m.employeeId))
    let pool = fromRoster
    if (pool.length === 0) {
      const people = (await (
        await request.get(`${API}/api/ops/personnel/?page_size=50`, { headers: auth })
      ).json()) as { results: { id: string }[] }
      pool = people.results.map((row) => String(row.id))
    }
    const person = pool.find((id) => !busy.has(id))
    requireFixture(
      person,
      fromRoster.length > 0
        ? 'свободный человек В СОСТАВЕ мероприятия (все принятые штабом уже стоят на постах)'
        : 'свободный сотрудник в кадровом списке',
    )
    const seated = await request.post(
      `${API}/api/ops/security-events/${eventId}/placement/assign/`,
      { headers: auth, data: { postId: kept!.id, employeeId: person! } },
    )
    expect(
      seated.status(),
      `человек не сел на пост-свидетель: ${await seated.text()}`,
    ).toBe(200)

    await page.reload()
    const removeStaffed = page.getByRole('button', {
      name: `Снять пост ${keptName}`,
    })
    // `[РАС-02]` (Plane №445): у занятого поста корзины НЕТ вовсе — не
    // выключенная, а не отрисованная.
    await expect(
      removeStaffed,
      'занятый пост предлагается снять — правило заказчика нарушено',
    ).toHaveCount(0)

    // Уборка: человек снимается с поста, пост — с расчёта. Стенд общий, и
    // проба, оставляющая за собой мусор, ломает соседние.
    const seatedBody = (await seated.json()) as {
      placementAssignments: { id: string; postId: string }[]
    }
    const mine = seatedBody.placementAssignments.find((a) => a.postId === kept!.id)
    if (mine !== undefined) {
      await request.delete(
        `${API}/api/ops/security-events/${eventId}/placement/${mine.id}/`,
        { headers: auth },
      )
    }
    await request.delete(
      `${API}/api/ops/security-events/${eventId}/placement/posts/${kept!.id}/`,
      { headers: auth },
    )
  })

  test('секция бланка назначается в строке, доезжает до сервера и переживает смену роли', async ({
    page,
    request,
  }) => {
    /**
     * ВТОРАЯ КООРДИНАТА МЕСТА (Plane №242). Роль отвечает «кем человек идёт»,
     * секция — «где»: «Көшпелі күзетінің жауаптысы» есть у восьми выездных
     * охран подряд, и по одной роли документ ставил первого назначенного в
     * первую охрану наугад.
     *
     * 🔴 ГЛАВНОЕ ЗДЕСЬ — ВТОРАЯ ПОЛОВИНА: секция обязана ПЕРЕЖИТЬ смену роли.
     * Смена роли устроена как снятие и назначение заново, и всё, что не
     * передано явно, теряется молча. Человек менял бы роль и лишался секции;
     * место в бланке опустело бы, а причина не была бы видна нигде. Тем же
     * дефектом до №242 страдало перемещение на другой пост — оно теряло роль.
     */
    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }

    const dictionary = async (code: string) =>
      ((await (
        await request.get(`${API}/api/ops/dictionaries/${code}/entries/`, { headers: auth })
      ).json()) as { results: { code: string; label: string }[] }).results

    const sections = await dictionary('PLACEMENT_SECTIONS')
    const roles = await dictionary('PLACEMENT_ROLES')
    const section = sections[0]
    const role = roles[0]
    requireFixture(section, 'справочник секций бланка пуст — назначать нечего')
    requireFixture(role, 'справочник ролей наряда пуст — менять роль нечем')

    const target = await placementEventWithRoster(request, auth, token)
    requireFixture(target, 'мероприятие на стадии «Расстановка»')
    const eventId = target!.id

    type Row = { id: string; roleCode: string | null; sectionCode: string | null }
    const assignmentsOf = async (): Promise<Row[]> => {
      const fresh = (await (
        await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
      ).json()) as { placementAssignments: Row[] }
      return fresh.placementAssignments
    }

    const before = new Set((await assignmentsOf()).map((row) => row.id))
    const mineOf = (rows: Row[]) => rows.filter((row) => !before.has(row.id)).at(-1) ?? null

    try {
      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${eventId}/`)
      await page.locator('button', { hasText: 'Пост' }).first().click()
      await page.locator('aside button', { hasText: 'Совпадение' }).first().click()

      await expect
        .poll(async () => (await assignmentsOf()).length, { timeout: 15_000 })
        .toBe(before.size + 1)

      // 🔴 СТРОКА ИЩЕТСЯ ПО id НАЗНАЧЕНИЯ, А НЕ `.first()` (Plane №415).
      // Пост без предела численности несёт десятки строк, среди них —
      // одноимённые сотрудники: `getByRole('combobox', {name: /^Секция
      // бланка: /})` без адреса строки ловит ЛЮБУЮ из них, и на живых данных
      // это почти никогда не новая строка. Якорь — `data-testid`
      // (`placement-assignment-<id>`), а не имя: оно не единственно.
      //
      // 🔴 И СЕКЦИЯ, И РОЛЬ МЕНЯЮТСЯ СНЯТИЕМ И НАЗНАЧЕНИЕМ ЗАНОВО (своей
      // операции «сменить» у бэка нет, см. `PlacementStage`) — id строки
      // меняется ПОСЛЕ КАЖДОГО клика. Locator на старый id после смены
      // указывал бы на узел, которого уже нет в DOM: строка ищется заново
      // перед каждым действием, а не запоминается один раз.
      const rowOf = (id: string) => page.getByTestId(`placement-assignment-${id}`)
      const mine = mineOf(await assignmentsOf())
      if (mine === null) throw new Error('назначение не появилось — искать строку негде')

      // Селектов в строке больше нет (`[РАС-03]`, Plane №445): роль и секция
      // ставятся в окне «Роль и секция…» строки.
      await rowOf(mine.id).getByRole('button', { name: /^Роль и секция: / }).click()
      await page.getByRole('dialog').getByRole('combobox', { name: 'Секция бланка' }).selectOption(section!.code)
      await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()

      await expect
        .poll(async () => mineOf(await assignmentsOf())?.sectionCode ?? null, {
          timeout: 20_000,
        })
        .toBe(section!.code)

      // Смена РОЛИ не должна снести секцию. Строка перечитывается заново —
      // назначение сектора её уже пересоздало.
      const afterSection = mineOf(await assignmentsOf())
      if (afterSection === null) throw new Error('строка пропала после смены секции')
      await rowOf(afterSection.id).getByRole('button', { name: /^Роль и секция: / }).click()
      await page.getByRole('dialog').getByRole('combobox', { name: 'Роль наряда' }).selectOption(role!.code)
      await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()

      await expect
        .poll(async () => mineOf(await assignmentsOf())?.roleCode ?? null, { timeout: 20_000 })
        .toBe(role!.code)
      expect(
        mineOf(await assignmentsOf())?.sectionCode ?? null,
        'смена роли снесла секцию бланка — место в документе опустеет молча',
      ).toBe(section!.code)
    } finally {
      for (const row of await assignmentsOf()) {
        if (before.has(row.id)) continue
        await request.delete(
          `${API}/api/ops/security-events/${eventId}/placement/${encodeURIComponent(row.id)}/`,
          { headers: auth },
        )
      }
    }
  })

  test('роль наряда назначается в строке и доезжает до сервера', async ({
    page,
    request,
  }) => {
    /**
     * 🔴 Проверяется НЕ «в списке есть роли», а что выбранная роль легла в
     * назначение НА СЕРВЕРЕ: бланк «Общая расстановка» заполняется по ней, и
     * роль, оставшаяся только на экране, оставит место в документе пустым
     * (Plane №239, находка №195).
     *
     * 🔴 УБОРКА В `finally`. Проба назначает человека на живом стенде, и
     * падение ассерта посреди пути оставляло бы назначение на посту — пост
     * добирался бы до предела, а СОСЕДНЯЯ проба («дерево постов…») падала бы
     * следом, обвиняя код. Так и случилось при первом прогоне: пять
     * назначений на посту, где нужно четыре.
     */
    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }

    const roles = (await (
      await request.get(`${API}/api/ops/dictionaries/PLACEMENT_ROLES/entries/`, {
        headers: auth,
      })
    ).json()) as { results: { code: string; label: string }[] }
    const role = roles.results[0]
    requireFixture(role, 'справочник ролей наряда пуст — назначать нечего')

    const target = await placementEventWithRoster(request, auth, token)
    requireFixture(target, 'мероприятие на стадии «Расстановка»')
    const eventId = target!.id

    const assignmentsOf = async (): Promise<{ id: string; roleCode: string | null }[]> => {
      const fresh = (await (
        await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
      ).json()) as { placementAssignments: { id: string; roleCode: string | null }[] }
      return fresh.placementAssignments
    }

    const before = new Set((await assignmentsOf()).map((row) => row.id))
    const mineOf = (rows: { id: string; roleCode: string | null }[]) =>
      rows.filter((row) => !before.has(row.id)).at(-1) ?? null

    try {
      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${eventId}/`)
      await page.locator('button', { hasText: 'Пост' }).first().click()
      await page.locator('aside button', { hasText: 'Совпадение' }).first().click()

      await expect
        .poll(async () => (await assignmentsOf()).length, { timeout: 15_000 })
        .toBe(before.size + 1)

      // 🔴 СТРОКА ИЩЕТСЯ ПО id, А НЕ `.first()` (Plane №415, тот же разбор,
      // что и у соседней пробы «секция бланка…»): пост без предела
      // численности несёт десятки строк, среди них — одноимённые сотрудники,
      // и `.first()` по имени роли попадает в произвольную ЧУЖУЮ строку.
      const created = mineOf(await assignmentsOf())
      if (created === null) throw new Error('назначение не появилось — искать строку негде')

      // Роль ставится ИЗ СТРОКИ, как это делает человек.
      await page
        .getByTestId(`placement-assignment-${created.id}`)
        .getByRole('button', { name: /^Роль и секция: / })
        .click()
      await page.getByRole('dialog').getByRole('combobox', { name: 'Роль наряда' }).selectOption(role!.code)
      await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click()

      // 🔴 СМЕНА РОЛИ ПЕРЕСОЗДАЁТ НАЗНАЧЕНИЕ (снятие + назначение заново —
      // своей операции «сменить роль» у бэка нет, см. `PlacementStage`), а
      // значит id строки меняется вместе с ней. Строка после клика ищется
      // ЗАНОВО по САМОМУ СВЕЖЕМУ id вне `before`, а не по старому `created.id`
      // — иначе ассерт спрашивал бы у DOM узел, которого уже нет.
      let assignedId: string | null = null
      await expect
        .poll(
          async () => {
            const mine = mineOf(await assignmentsOf())
            assignedId = mine?.id ?? null
            return mine?.roleCode ?? null
          },
          { timeout: 20_000 },
        )
        .toBe(role!.code)

      // Подпись роли видна в СВОЕЙ строке — и не в чужой строке с тем же
      // текстом где-то ещё на экране: выбор сужен до ОДНОЙ строки. Таймаут больше
      // стандартного: строка на экране обновляется инвалидацией react-query
      // ПОСЛЕ того, как сервер уже ответил (что мы и дождались выше
      // поллингом по API) — эти два момента не совпадают.
      await expect(
        page.getByTestId(`placement-assignment-${assignedId}`).getByText(role!.label, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      for (const row of await assignmentsOf()) {
        if (before.has(row.id)) continue
        await request.delete(
          `${API}/api/ops/security-events/${eventId}/placement/${encodeURIComponent(row.id)}/`,
          { headers: auth },
        )
      }
    }
  })

  test('отбор по рейтингу идёт по СОСТАВУ, кадровая база не спрашивается', async ({
    page,
    request,
  }) => {
    /**
     * До №428 эта проба стерегла обратное — что отбор уходит на сервер по
     * всей базе. По РАС-04 «поиска по всей базе нет»: пул — только состав,
     * принятый штабом, и отбор по полосе рейтинга идёт по нему на клиенте.
     * Пин ПЕРЕВЁРНУТ осознанно: любой запрос к `/api/ops/personnel/` с этого
     * экрана теперь дефект, а не признак работы.
     */
    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const target = await placementEventWithRoster(request, auth, token)
    requireFixture(target, 'мероприятие на стадии «Расстановка»')
    const asked: string[] = []
    page.on('request', (req) => {
      const url = new URL(req.url())
      if (url.pathname === '/api/ops/personnel/') asked.push(url.search)
    })
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    const aside = page.locator('aside')
    await expect(aside.getByLabel('Фильтр по рейтингу')).toBeVisible({ timeout: 25_000 })
    await aside.getByLabel('Фильтр по рейтингу').selectOption('9,0–10,0')
    await aside.getByLabel('Сортировка кандидатов').selectOption('По рейтингу')
    await expect(aside.getByText(/Состав мероприятия: \d+ чел\./)).toBeVisible()
    await page.waitForLoadState('networkidle').catch(() => {})
    expect(asked, 'кадровая база не должна спрашиваться с расстановки').toEqual([])
  })

  test('расстановка ведётся по объекту посещения, а не по мероприятию целиком', async ({
    page,
    request,
  }) => {
    /**
     * Plane №410 (Ш-4 плана №385), требование `[МД-04]`: у объекта СВОИ этапы.
     * До этого шага дерево постов и счётчики этапа складывали разные объекты
     * в одно число — «назначено 5 из 12» ничего не говорило о том, где
     * недобор.
     *
     * Проба заводит СВОЁ мероприятие с двумя объектами: на стенде таких мало,
     * и брать чужое значило бы проверять чьи-то остатки.
     */
    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const call = async (method: 'get' | 'post' | 'patch', path: string, data?: unknown) => {
      const res = await request[method](`${API}${path}`, { headers: auth, data: data as never })
      return (await res.json().catch(() => ({}))) as any
    }

    const objects = await call('get', '/api/ops/security-events/bindable-objects/')
    const withPassport = (objects.results as { id: string; publishedVersionCount: number }[]).find(
      (item) => item.publishedVersionCount > 0,
    )
    requireFixture(withPassport, 'объект с опубликованным паспортом')
    const other = (objects.results as { id: string; name: string }[]).find(
      (item) => item.id !== withPassport!.id,
    )
    requireFixture(other, 'второй объект реестра')

    const created = await call('post', '/api/ops/security-events/', {
      title: `Проба №410 · расстановка по объекту ${Date.now()}`,
      objectId: withPassport!.id,
      businessDate: '2026-08-26',
      kind: 'INTERNAL',
      chiefEmployeeId: await anyChiefId(token),
    })
    const base = `/api/ops/security-events/${created.id}`
    await call('patch', `${base}/bulletin/`, { briefDescription: 'x', initialTasks: '—' })
    await call('post', `${base}/bulletin/complete/`)
    await call('post', `${base}/recon/import-from-passport/`)
    const withSecond = await call('post', `${base}/visit-objects/`, { objectId: other!.id })
    const secondVisit = (withSecond.visitObjects as { id: string; objectName: string }[]).find(
      (v) => v.objectName === other!.name,
    )!
    const firstVisit = (withSecond.visitObjects as { id: string; objectName: string }[]).find(
      (v) => v.id !== secondVisit.id,
    )!
    // Старший нужен КАЖДОМУ объекту (гвард №424): рекогносцировка второго
    // объекта без него отвечает VISIT_CHIEF_REQUIRED, и ОМ не доходит до
    // расстановки.
    await call('post', `${base}/visit-objects/${secondVisit.id}/chief/`, {
      employeeId: await anyChiefId(token),
    })

    // Пост ВТОРОГО объекта: у него своего паспорта нет, и посты ему заводят
    // руками — ровно так это и делается на экране.
    const ownPost = `Пост объекта ${secondVisit.objectName} ${Date.now()}`
    const state = await call('get', `${base}/`)
    await call('patch', `${base}/recon/`, {
      checklist: (state.reconChecklist as { id: string }[]).map((item) => ({
        ...item,
        done: true,
        result: 'MATCHES',
      })),
      sectorPosts: [
        ...(state.reconSectorPosts as Record<string, unknown>[]),
        {
          id: `local-${Date.now()}`,
          sector: 'Сектор второго объекта',
          post: ownPost,
          task: 'Охрана',
          need: 2,
          shift: '',
          requirements: '',
          result: null,
          comment: '',
          sourceSectorId: null,
          sourcePostId: null,
          minRating: null,
          visitObjectId: secondVisit.id,
        },
      ],
    })
    const onPlacement = await call('post', `${base}/recon/complete/`)
    expect(
      onPlacement.stage,
      `ОМ не дошёл до расстановки — фикстура непригодна: ${JSON.stringify(onPlacement).slice(0, 300)}`,
    ).toBe(
      'PLACEMENT',
    )

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${created.id}/`)
    const tree = page.getByRole('complementary', { name: 'Дерево постов' })
    await expect(tree).toBeVisible({ timeout: 25_000 })

    // Показан ПЕРВЫЙ объект: его посты есть, поста второго — нет.
    await expect(tree).not.toContainText(ownPost)

    // Переключились на второй — видно только его пост.
    // Именно COMBOBOX: подпись «объект посещения» есть и в шапке карточки ОМ,
    // и `getByLabel` находит два элемента.
    const picker = page.getByRole('combobox', { name: 'Объект посещения' })
    await expect(picker).toBeVisible()
    await picker.selectOption(secondVisit.id)
    await expect(tree).toContainText(ownPost)
    await expect(tree).toContainText('Сектор второго объекта')
    // Счётчик дерева — потребность ЭТОГО объекта (2), а не сумма по ОМ
    // (у первого объекта постов из паспорта больше).
    await expect(tree).toContainText('назначено 0 из 2')

    // 🔴 КОММЕНТАРИЙ ПОСТА НЕ ДОЛЖЕН СНОСИТЬ ЧУЖОЙ ОБЪЕКТ (Plane №471).
    //
    // Окно правки шлёт `sectorPosts` ЦЕЛИКОМ, а сервер (`update_recon`) не
    // сливает, а ЗАМЕЩАЕТ список. Пока окно собирало тело из постов ПОКАЗАННОГО
    // объекта, сохранение комментария на объекте A удаляло все посты объекта B:
    // его потребность падала в ноль, а назначения оставались ссылаться на
    // несуществующие id. Восстановить было нечем — прежних строк нет ни в одной
    // версии.
    //
    // Проверяется и экраном, и ручкой: экран показывает, что человек этого не
    // заметит, ручка — что данные на месте.
    await picker.selectOption(firstVisit.id)
    await expect(tree).not.toContainText(ownPost)
    const before = await call('get', `${base}/`)
    const mine = (before.reconSectorPosts as { id: string; post: string; visitObjectId: string | null }[])
      .filter((row) => String(row.visitObjectId) === String(firstVisit.id))
    requireFixture(mine[0], 'пост первого объекта посещения')
    const totalBefore = (before.reconSectorPosts as unknown[]).length

    await tree.getByRole('button').filter({ hasText: mine[0]!.post }).first().click()
    const note = `комментарий №471 ${Date.now()}`
    await page.locator('#post-comment').fill(note)
    await page.getByRole('button', { name: 'Сохранить', exact: true }).first().click()
    // Ждём ответа ручки, а не таймера: сохранение асинхронно, и чтение сразу
    // после клика застало бы прежнее состояние и зеленело бы на поломке.
    await page.waitForResponse(
      (r) => r.url().includes('/recon/') && r.request().method() === 'PATCH',
      { timeout: 20_000 },
    )

    const after = await call('get', `${base}/`)
    const rows = after.reconSectorPosts as { id: string; post: string; comment: string }[]
    expect(
      rows.length,
      'после сохранения комментария постов стало меньше — снесён чужой объект',
    ).toBe(totalBefore)
    expect(
      rows.some((row) => row.post === ownPost),
      'пост второго объекта посещения исчез после правки комментария на первом',
    ).toBe(true)
    expect(
      rows.find((row) => row.id === mine[0]!.id)?.comment,
      'комментарий не сохранился — проба проверяла бы отсутствие вреда от действия, которого не было',
    ).toBe(note)
    // И на экране: переключение на второй объект показывает его пост, а не
    // пустое дерево.
    await picker.selectOption(secondVisit.id)
    await expect(tree).toContainText(ownPost)

    // Уборка: своё мероприятие проба уносит за собой. Отказ её не роняет —
    // это уборка, а не предмет проверки; не удалённое подберёт
    // `manage.py purge_probe_events`.
    await request
      .delete(`${API}/api/ops/security-events/${created.id}/`, { headers: auth })
      .catch(() => undefined)
  })


  /**
   * Завершение расстановки с недобором (`[РАС-06]`, Plane №396).
   *
   * Проба заводит СВОЙ ОМ с ОДНИМ постом и НЕ занимает его: «Завершить»
   * обязана попросить подтверждение, а не завершить молча и не блокировать
   * намертво. Подтверждение с причиной — общий `ConflictDialog` раздела
   * (тот же путь, что у обхода предупреждения по рейтингу), поэтому проба
   * заодно проверяет, что новый код ошибки (`PLACEMENT_UNDERSTAFFED`)
   * подключён к диалогу, а не повис отдельным необработанным путём.
   */
  test('недобор просит подтверждение, версия документа появляется после завершения', async ({
    page,
    request,
  }) => {
    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: auth,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return res.json().catch(() => ({}))
    }

    const objects = (await call('GET', '/api/ops/security-events/bindable-objects/')) as {
      results: { id: string; publishedVersionCount: number }[]
    }
    const object = objects.results.find((item) => item.publishedVersionCount > 0)
    if (object === undefined) throw new Error('на стенде нет объекта с паспортом')

    const created = (await call('POST', '/api/ops/security-events/', {
      title: 'Проба недобора расстановки (e2e)',
      objectId: object.id,
      businessDate: '2026-09-03',
      kind: 'INTERNAL',
      chiefEmployeeId: await anyChiefId(token),
    })) as { id: string }
    const base = `/api/ops/security-events/${created.id}`

    await call('POST', `${base}/recon/import-from-passport/`)
    const afterImport = (await call('GET', `${base}/`)) as {
      reconChecklist: Record<string, unknown>[]
      reconSectorPosts: { id: string; sector: string; post: string }[]
    }
    await call('PATCH', `${base}/recon/`, {
      checklist: afterImport.reconChecklist.map((item) => ({
        ...item,
        done: true,
        result: 'MATCHES',
      })),
      sectorPosts: afterImport.reconSectorPosts,
    })
    await call('POST', `${base}/recon/complete/`)
    const post = (await call('GET', `${base}/`) as {
      reconSectorPosts: { id: string; sector: string; post: string }[]
    }).reconSectorPosts[0]

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${created.id}/`)
    const card = page.getByRole('region', { name: 'Расстановка сил' })
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Ни один пост не занят — «Завершить» обязана спросить подтверждение.
    await card.getByRole('button', { name: 'Завершить расстановку' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog).toContainText('без людей')
    await expect(dialog).toContainText('Завершить с недобором')

    // Причина короче минимума — подтвердить нельзя (общий диалог, Plane №239).
    const textarea = dialog.getByRole('textbox')
    await textarea.fill('коротко')
    const confirm = dialog.getByRole('button', { name: /Подтвердить|Обойти/ })
    await expect(confirm).toBeDisabled()

    await textarea.fill('Второй кандидат заболел, замену найдём к выезду.')
    await expect(confirm).toBeEnabled()
    await confirm.click()

    // Сервер принял — этап ушёл на «Согласование», диалог закрылся.
    await expect(dialog).toBeHidden({ timeout: 15_000 })
    await expect
      .poll(async () => {
        const fresh = (await call('GET', `${base}/`)) as { stage: string }
        return fresh.stage
      }, { timeout: 15_000 })
      .toBe('APPROVAL')

    // Документ получил версию 1 — «Черновик» из `[РАС-06]`, не 0.
    const finalState = (await call('GET', `${base}/`)) as {
      visitObjects: { documentVersion: number }[]
    }
    expect(finalState.visitObjects[0].documentVersion).toBe(1)
    void post
  })


  /**
   * Панель замечаний над деревом после возврата с согласования (`[РАС-07]`,
   * Plane №397).
   *
   * Проба заводит СВОЙ ОМ, доводит до согласования, согласующий возвращает его
   * с замечанием К ПОСТУ (№386) — объект уходит обратно на «Расстановку».
   * Там над деревом обязана появиться панель, клик по замечанию — подсветить
   * именно этот пост (aria-current) и показать замечание в карточке поста.
   */
  test('кандидат перетаскивается из пула на пост в дереве и садится на него', async ({
    page,
    request,
  }) => {
    /**
     * `[РАС-03]` (Plane №445): перетаскивание — единственная новая механика
     * шага. Проба тянет первого кандидата пула на первый пост дерева и ждёт
     * назначение НА СЕРВЕРЕ, а не подсветку: иначе drop, который ничего не
     * шлёт, прошёл бы зелёным. Красная проверка — снять `onDrop` у поста.
     */
    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const target = await placementEventWithRoster(request, auth, token)
    requireFixture(target, 'мероприятие на стадии «Расстановка»')
    const eventId = target!.id
    type Row = { id: string; postId: string }
    const assignmentsOf = async (): Promise<Row[]> =>
      ((await (
        await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
      ).json()) as { placementAssignments: Row[] }).placementAssignments
    const before = new Set((await assignmentsOf()).map((row) => row.id))
    try {
      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${eventId}/`)
      const tree = page.getByRole('complementary', { name: 'Дерево постов' })
      const post = tree.locator('li[data-drop-post]').first()
      await expect(post).toBeVisible()
      const postId = await post.getAttribute('data-drop-post')
      const candidate = page.locator('aside button', { hasText: 'Совпадение' }).first()
      await expect(candidate).toBeVisible({ timeout: 25_000 })
      await candidate.dragTo(post)
      await expect
        .poll(async () => (await assignmentsOf()).filter((row) => !before.has(row.id)).map((row) => row.postId), {
          timeout: 15_000,
        })
        .toEqual([postId])
    } finally {
      for (const row of await assignmentsOf()) {
        if (before.has(row.id)) continue
        await request.delete(
          `${API}/api/ops/security-events/${eventId}/placement/${encodeURIComponent(row.id)}/`,
          { headers: auth },
        )
      }
    }
  })

  test('пост, набранный по расчёту, просит обоснование усиления', async ({
    page,
    request,
  }) => {
    /**
     * `OVER_NEED` (Plane №414, решение заказчика 04.09.2026): поставить на пост
     * больше людей, чем в расчёте, МОЖНО, но сервер спрашивает почему. До
     * правки пост с потребностью 1 принимал пятерых молча, и «назначено» в
     * реестре нельзя было читать как факт.
     *
     * Проба ведёт путь ЧЕЛОВЕКОМ, а не ручкой: набирает пост до расчёта через
     * API (это подготовка, а не предмет), тянет лишнего кандидата мышью и
     * ждёт ДИАЛОГ обоснования. Красная проверка — снять гард `taken >= need`
     * в `assign_placement`: тогда назначение проходит молча и диалога нет.
     *
     * Берётся пост с НАИМЕНЬШИМ расчётом: состав стенда невелик, и на посту
     * «на четверых» пробе не хватило бы людей — она скипалась бы, а скип
     * читается как зелень.
     */
    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const target = await placementEventWithRoster(request, auth, token)
    requireFixture(target, 'мероприятие на стадии «Расстановка»')
    const eventId = target!.id
    type Row = { id: string; postId: string; employeeId: string }
    const fresh = async () =>
      (await (
        await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
      ).json()) as {
        placementAssignments: Row[]
        reconSectorPosts: { id: string; need: number }[]
        forceRoster: { employeeId: string }[]
      }
    const before = new Set((await fresh()).placementAssignments.map((row) => row.id))

    try {
      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${eventId}/`)
      const tree = page.getByRole('complementary', { name: 'Дерево постов' })
      await expect(tree.locator('li[data-drop-post]').first()).toBeVisible()
      const shown = await tree.locator('li[data-drop-post]').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-drop-post')),
      )

      const state = await fresh()
      const cheapest = state.reconSectorPosts
        .filter((row) => shown.includes(row.id))
        .sort((a, b) => Number(a.need ?? 0) - Number(b.need ?? 0))[0]
      requireFixture(cheapest, 'пост расчёта в дереве')
      const postId = cheapest!.id
      const need = Number(cheapest!.need ?? 0)

      // Подготовка: добираем ИМЕННО ЭТОТ пост до расчёта.
      const spare = state.forceRoster
        .map((member) => member.employeeId)
        .filter((id) => !state.placementAssignments.some((row) => row.employeeId === id))
      let taken = state.placementAssignments.filter((row) => row.postId === postId).length
      for (const employeeId of spare) {
        if (taken >= need) break
        const res = await request.post(
          `${API}/api/ops/security-events/${eventId}/placement/assign/`,
          {
            headers: auth,
            data: {
              postId,
              employeeId,
              override: true,
              override_reason: 'Добор поста до расчёта пробой №414',
            },
          },
        )
        if (res.ok()) taken += 1
      }
      expect(taken, 'пост не набран до расчёта — проверять усиление не на чем').toBeGreaterThanOrEqual(need)

      await page.reload()
      const candidate = page.locator('aside button', { hasText: 'Совпадение' }).first()
      await expect(candidate).toBeVisible({ timeout: 25_000 })
      await candidate.dragTo(tree.locator(`li[data-drop-post="${postId}"]`))

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(dialog).toContainText('Расчёт поста')
      await expect(dialog).toContainText('обоснование усиления')
      // Снимок — в `smoke-results/` (Plane №747): каталог закрыт `.gitignore`,
      // как и у всех прочих спек. Голый относительный путь писал PNG в КОРЕНЬ
      // фронта, и каждый прогон смоука оставлял в репозитории неотслеживаемый
      // файл — ровно тот мусор, из-за которого здесь запрещён `git add -A`.
      await page.screenshot({ path: 'smoke-results/414-over-need-dialog.png' })
    } finally {
      for (const row of (await fresh()).placementAssignments) {
        if (before.has(row.id)) continue
        await request.delete(
          `${API}/api/ops/security-events/${eventId}/placement/${encodeURIComponent(row.id)}/`,
          { headers: auth },
        )
      }
    }
  })

  test('после возврата замечания стоят над деревом, клик подсвечивает пост', async ({
    page,
  }) => {
    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    // Админ стенда держит и ведение, и утверждение — отдельная учётка
    // согласующего пробе не нужна: проверяется экран, а не права.
    const approverToken = token
    const call = async (method: string, path: string, body?: unknown, who = token) => {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${who}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return res.json().catch(() => ({}))
    }
    const objects = (await call('GET', '/api/ops/security-events/bindable-objects/')) as {
      results: { id: string; publishedVersionCount: number }[]
    }
    const object = objects.results.find((item) => item.publishedVersionCount > 0)
    if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
    const created = (await call('POST', '/api/ops/security-events/', {
      title: 'Проба панели замечаний (e2e)',
      objectId: object.id,
      businessDate: '2026-12-31',
      kind: 'INTERNAL',
      chiefEmployeeId: await anyChiefId(token),
    })) as { id: string }
    const base = `/api/ops/security-events/${created.id}`
    await call('POST', `${base}/recon/import-from-passport/`)
    const afterImport = (await call('GET', `${base}/`)) as {
      reconChecklist: Record<string, unknown>[]
      reconSectorPosts: { id: string; sector: string; post: string; need: number }[]
    }
    await call('PATCH', `${base}/recon/`, {
      checklist: afterImport.reconChecklist.map((item) => ({ ...item, done: true, result: 'MATCHES' })),
      sectorPosts: afterImport.reconSectorPosts,
    })
    await call('POST', `${base}/recon/complete/`)
    const roster = (await call('GET', '/api/ops/personnel/')) as { results: { id: string }[] }
    let i = 0
    for (const post of afterImport.reconSectorPosts) {
      for (let k = 0; k < Math.max(post.need, 1); k += 1) {
        await call('POST', `${base}/placement/assign/`, { postId: post.id, employeeId: roster.results[i].id })
        i += 1
      }
    }
    await call('POST', `${base}/placement/complete/`)
    const route = (await call('POST', `${base}/approval/route/`, {
      name: 'Проба Согласующий', unit: 'Департамент охраны', position: 'Зам.',
    })) as { approvalRoute: { id: string }[] }
    await call('POST', `${base}/approval/send/`)
    // Пост, к которому ставится замечание, — ВТОРОЙ, если он есть: первый пост
    // выбран в дереве по умолчанию, и клик по замечанию к нему ничего не
    // доказал бы.
    const targetPost = afterImport.reconSectorPosts[1] ?? afterImport.reconSectorPosts[0]
    const decided = (await call(
      'POST',
      `${base}/approval/route/${route.approvalRoute[0].id}/decide/`,
      { decision: 'RETURNED', comment: 'Усилить пост вторым сотрудником', postId: targetPost.id, urgent: true },
      approverToken,
    )) as { error_code?: string }
    if (decided.error_code) throw new Error(`возврат не прошёл: ${decided.error_code}`)
    // Возврат ОБЪЕКТА — большой кнопкой: объект уходит на «Расстановку».
    await call('POST', `${base}/approval/return/`, { comment: 'На доработку по замечанию' }, approverToken)
    const state = (await call('GET', `${base}/`)) as { stage: string }
    expect(state.stage).toBe('PLACEMENT')

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${created.id}/`)
    const card = page.getByRole('region', { name: 'Расстановка сил' })
    await expect(card).toBeVisible({ timeout: 15_000 })

    const panel = card.getByRole('region', { name: 'Замечания согласования' })
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('Усилить пост вторым сотрудником')
    await expect(panel).toContainText(`${targetPost.sector} · ${targetPost.post}`)
    await expect(panel).toContainText('срочно')

    // Клик по замечанию подсвечивает ИМЕННО его пост в дереве…
    await panel.getByRole('button', { name: /Усилить пост вторым сотрудником/ }).click()
    const treeButton = card.locator(`#placement-post-${targetPost.id}`)
    await expect(treeButton).toHaveAttribute('aria-current', 'true')
    // …и в карточке поста видно замечание по нему.
    const postRemarks = card.locator('[data-slot="post-remarks"]')
    await expect(postRemarks).toBeVisible()
    await expect(postRemarks).toContainText('Усилить пост вторым сотрудником')
    await expect(postRemarks).toContainText('срочно')
    // Метка «!N» у поста в дереве — открытое замечание видно и без клика.
    await expect(treeButton).toContainText('!1')
  })
  // ── Перенос человека между постами обратим (Plane №744, №703) ──────────────
  //
  // 🔴 ОБЕ ПРОБЫ ЗАВОДЯТ СВОЁ МЕРОПРИЯТИЕ, а не берут стендовое, и это стоило
  // четырёх переписанных редакций. Взятое общим `placementEventWithRoster` ОМ
  // делится с соседними спеками: то они разбирают его состав по постам и
  // подготовка падает «не хватает людей», то убирают за собой в `finally` и
  // на постах не стоит никто. Попытка добрать состав на месте задевала уже
  // третью пробу («знаменатели взяты у расхода»), потому что меняла числа,
  // которые та считает. Ровно об этом предупреждает шапка `prepare-events.ts`:
  // проба, взявшая чужое мероприятие, зелена в одиночку и красна в прогоне.

  /** Своё ОМ на «Расстановке» с составом, которого хватает на перенос. */
  async function ownPlacementEvent(
    token: string,
  ): Promise<{ eventId: string; roster: string[] }> {
    // Дата ДАЛЁКАЯ и своя: на ближних днях у половины кадров уже стоят статусы,
    // и выделение молча пропускает их (`STATUS_OVERLAP_WARNING`) — состав
    // выходил бы меньше запрошенного.
    const { id } = await prepareDemandEvent(token, '2027-07-11')
    const accepted = await acceptRosterFor(token, id, { count: 5 })
    return { eventId: id, roster: accepted.employeeIds }
  }

  test('отмена обоснования возвращает человека на прежний пост, а не теряет его', async ({
    page,
    request,
  }) => {
    /**
     * ПЕРЕНОС ОБРАТИМ (Plane №744). Перенос человека с поста на пост — это два
     * запроса: снятие и назначение. С `OVER_NEED` (Plane №414) второй отвечает
     * 409 на ЛЮБОМ укомплектованном посту, то есть в нормальном его состоянии,
     * — открывается окно обоснования. До правки «Отмена» в этом окне оставляла
     * человека снятым с исходного поста и не назначенным никуда, МОЛЧА: снятие
     * уже прошло, а назначение не состоялось.
     *
     * Проба ведёт путь ЧЕЛОВЕКОМ: набирает пост-приёмник до расчёта, ставит
     * одного человека на отдельный пост-источник, тянет его мышью на набранный
     * пост, дожидается окна и жмёт «Отмена». Проверяется НЕ сообщение, а факт
     * в данных: назначение на исходном посту цело.
     *
     * Красная проверка — вернуть `onCancel={() => assign.dismissConflict()}` в
     * `PlacementStage`: человек исчезает с обоих постов, и `sourceRows` внизу
     * становится пустым.
     */
    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const { eventId } = await ownPlacementEvent(token)
    type Row = { id: string; postId: string; employeeId: string }
    const fresh = async () =>
      (await (
        await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
      ).json()) as {
        placementAssignments: Row[]
        reconSectorPosts: { id: string; need: number }[]
        forceRoster: { employeeId: string }[]
      }
    const before = new Set((await fresh()).placementAssignments.map((row) => row.id))
    try {
      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${eventId}/`)
      const tree = page.getByRole('complementary', { name: 'Дерево постов' })
      await expect(tree.locator('li[data-drop-post]').first()).toBeVisible()
      const shown = await tree.locator('li[data-drop-post]').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-drop-post')),
      )

      const assignTo = async (postId: string, employeeId: string) =>
        request.post(`${API}/api/ops/security-events/${eventId}/placement/assign/`, {
          headers: auth,
          data: {
            postId,
            employeeId,
            override: true,
            override_reason: 'Подготовка пробы переноса: расстановка до отказа',
          },
        })

      /**
       * Собрать расстановку, на которой перенос ОТКАЗЫВАЕТ: приёмник набран до
       * расчёта, а наш человек стоит на другом посту.
       *
       * 🔴 ПАРА ПОСТОВ ПОДБИРАЕТСЯ, А НЕ НАЗНАЧАЕТСЯ (Plane №703/№744). Три
       * прежние редакции опирались каждая на своё допущение о стенде — «в
       * составе есть свободные», «на постах уже кто-то стоит», «состав можно
       * добрать» — и каждая падала при прогоне ФАЙЛА ЦЕЛИКОМ: соседние пробы
       * то занимают людей, то убирают за собой в `finally`, а `acceptRosterFor`
       * на уже принятом составе отвечает `DOUBLE_ASSIGNMENT`. Порядок проб в
       * файле не гарантирует ни занятости, ни свободы. Поэтому перебираются
       * пары постов и берётся первая, которую ХВАТАЕТ людей собрать: стоящий
       * на посту человек годится как есть, свободный — доназначается.
       */
      async function stageTransfer(): Promise<{
        destination: { id: string; need: number }
        source: { id: string }
        traveller: { id: string; employeeId: string; roleCode?: string | null }
      }> {
        const state = await fresh()
        const visible = state.reconSectorPosts
          .filter((row) => shown.includes(row.id))
          .sort((a, b) => Number(a.need ?? 0) - Number(b.need ?? 0))
        requireFixture(visible[1], 'в дереве меньше двух постов — переносить не с чего на что')
        const takenOf = (postId: string) =>
          state.placementAssignments.filter((row) => row.postId === postId).length
        const free = state.forceRoster
          .map((member) => member.employeeId)
          .filter((id) => !state.placementAssignments.some((row) => row.employeeId === id))

        for (const destination of visible) {
          const missing = Math.max(0, Number(destination.need ?? 0) - takenOf(destination.id))
          for (const source of visible) {
            if (source.id === destination.id) continue
            const standing = state.placementAssignments.find((row) => row.postId === source.id)
            if (missing + (standing === undefined ? 1 : 0) > free.length) continue

            let taken = takenOf(destination.id)
            let cursor = 0
            while (taken < Number(destination.need ?? 0) && cursor < free.length) {
              const res = await assignTo(destination.id, free[cursor]!)
              if (res.ok()) taken += 1
              cursor += 1
            }
            if (taken < Number(destination.need ?? 0)) continue
            if (standing !== undefined) return { destination, source, traveller: standing }
            if (cursor >= free.length) continue

            const mine = free[cursor]!
            const placed = await assignTo(source.id, mine)
            expect(placed.ok(), 'подготовка: человек не встал на пост-источник').toBe(true)
            const row = (await fresh()).placementAssignments.find(
              (assignment) => assignment.employeeId === mine,
            )
            requireFixture(row, 'подготовленное назначение не нашлось в карточке ОМ')
            return { destination, source, traveller: row! }
          }
        }
        throw new Error(
          'на стенде не собрать перенос: ни для одной пары постов не хватает людей на ' +
            'приёмник по расчёту плюс одного на пост-источник',
        )
      }

      // Постов нужно ДВА и разных: с одного тянем, на другой роняем. Перенос
      // на тот же пост экран отсекает сам (`fromPostId === postId`), и проба
      // на одном посту была бы вакуумной.
      const { destination, source, traveller } = await stageTransfer()

      await page.reload()
      await tree.locator(`li[data-drop-post="${source.id}"]`).click()
      // Якорь — id назначения, а не имя: имя на экране не единственно
      // (Plane №415), и `.first()` по строке взял бы чужую.
      const row = page.getByTestId(`placement-assignment-${traveller.id}`)
      await expect(row).toBeVisible({ timeout: 25_000 })
      await row.dragTo(tree.locator(`li[data-drop-post="${destination.id}"]`))

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await expect(dialog).toContainText('обоснование усиления')
      await dialog.getByRole('button', { name: 'Отмена' }).click()
      await expect(dialog).toBeHidden()

      // 🔴 ПРОВЕРЯЕТСЯ ФАКТ В ДАННЫХ, а не надпись: экран мог бы нарисовать
      // человека на месте и из устаревшего кэша.
      await expect
        .poll(
          async () =>
            (await fresh()).placementAssignments.filter(
              (assignment) => assignment.employeeId === traveller.employeeId,
            ).length,
          {
            message: 'после отмены человек не назначен никуда — перенос съел его молча',
            timeout: 15_000,
          },
        )
        .toBe(1)
      const sourceRows = (await fresh()).placementAssignments.filter(
        (assignment) => assignment.employeeId === traveller.employeeId,
      )
      expect(sourceRows[0]!.postId, 'человек вернулся не на тот пост, с которого его тянули').toBe(
        source.id,
      )
    } finally {
      for (const row of (await fresh()).placementAssignments) {
        if (before.has(row.id)) continue
        await request.delete(
          `${API}/api/ops/security-events/${eventId}/placement/${encodeURIComponent(row.id)}/`,
          { headers: auth },
        )
      }
    }
  })

  test('отклонённая правка роли возвращает человека с ПРЕЖНЕЙ ролью, а не с новой', async ({
    page,
    request,
  }) => {
    /**
     * ПОЛОВИНА ОТКЛОНЁННОЙ ПРАВКИ (Plane №703). Окно «Роль и секция…» умеет
     * менять ПОСТ заодно с ролью, и делает это тем же способом, что
     * перетаскивание, — снятием и назначением заново. Возврат из №744
     * собирался из ЦЕЛЕВЫХ значений, поэтому у перетаскивания был верен (там
     * роль не меняется), а здесь ставил человека на прежний пост с НОВОЙ
     * ролью: отклонённая правка применялась наполовину и молча.
     *
     * Проба меняет РАЗОМ роль и пост, получает отказ на набранном посту и
     * жмёт «Отмена». Проверяется не только «человек на месте», но и «роль та
     * же»: без второй проверки правка свелась бы к №744.
     *
     * Красная проверка — вернуть в `restoreMove` целевые `move.roleCode` /
     * `move.sectionCode` вместо `move.origin.*`: роль после отмены станет
     * новой.
     */
    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const roles = (await (
      await request.get(`${API}/api/ops/dictionaries/PLACEMENT_ROLES/entries/`, { headers: auth })
    ).json()) as { results: { code: string; label: string }[] }
    requireFixture(roles.results[0], 'справочник ролей наряда пуст — менять нечего')

    const { eventId } = await ownPlacementEvent(token)
    type Row = { id: string; postId: string; employeeId: string; roleCode: string | null }
    const fresh = async () =>
      (await (
        await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
      ).json()) as {
        placementAssignments: Row[]
        reconSectorPosts: { id: string; need: number }[]
        forceRoster: { employeeId: string }[]
      }
    const before = new Set((await fresh()).placementAssignments.map((row) => row.id))
    try {
      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${eventId}/`)
      const tree = page.getByRole('complementary', { name: 'Дерево постов' })
      await expect(tree.locator('li[data-drop-post]').first()).toBeVisible()
      const shown = await tree.locator('li[data-drop-post]').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-drop-post')),
      )

      const assignTo = async (postId: string, employeeId: string) =>
        request.post(`${API}/api/ops/security-events/${eventId}/placement/assign/`, {
          headers: auth,
          data: {
            postId,
            employeeId,
            override: true,
            override_reason: 'Подготовка пробы переноса: расстановка до отказа',
          },
        })

      /**
       * Собрать расстановку, на которой перенос ОТКАЗЫВАЕТ: приёмник набран до
       * расчёта, а наш человек стоит на другом посту.
       *
       * 🔴 ПАРА ПОСТОВ ПОДБИРАЕТСЯ, А НЕ НАЗНАЧАЕТСЯ (Plane №703/№744). Три
       * прежние редакции опирались каждая на своё допущение о стенде — «в
       * составе есть свободные», «на постах уже кто-то стоит», «состав можно
       * добрать» — и каждая падала при прогоне ФАЙЛА ЦЕЛИКОМ: соседние пробы
       * то занимают людей, то убирают за собой в `finally`, а `acceptRosterFor`
       * на уже принятом составе отвечает `DOUBLE_ASSIGNMENT`. Порядок проб в
       * файле не гарантирует ни занятости, ни свободы. Поэтому перебираются
       * пары постов и берётся первая, которую ХВАТАЕТ людей собрать: стоящий
       * на посту человек годится как есть, свободный — доназначается.
       */
      async function stageTransfer(): Promise<{
        destination: { id: string; need: number }
        source: { id: string }
        traveller: { id: string; employeeId: string; roleCode?: string | null }
      }> {
        const state = await fresh()
        const visible = state.reconSectorPosts
          .filter((row) => shown.includes(row.id))
          .sort((a, b) => Number(a.need ?? 0) - Number(b.need ?? 0))
        requireFixture(visible[1], 'в дереве меньше двух постов — переносить не с чего на что')
        const takenOf = (postId: string) =>
          state.placementAssignments.filter((row) => row.postId === postId).length
        const free = state.forceRoster
          .map((member) => member.employeeId)
          .filter((id) => !state.placementAssignments.some((row) => row.employeeId === id))

        for (const destination of visible) {
          const missing = Math.max(0, Number(destination.need ?? 0) - takenOf(destination.id))
          for (const source of visible) {
            if (source.id === destination.id) continue
            const standing = state.placementAssignments.find((row) => row.postId === source.id)
            if (missing + (standing === undefined ? 1 : 0) > free.length) continue

            let taken = takenOf(destination.id)
            let cursor = 0
            while (taken < Number(destination.need ?? 0) && cursor < free.length) {
              const res = await assignTo(destination.id, free[cursor]!)
              if (res.ok()) taken += 1
              cursor += 1
            }
            if (taken < Number(destination.need ?? 0)) continue
            if (standing !== undefined) return { destination, source, traveller: standing }
            if (cursor >= free.length) continue

            const mine = free[cursor]!
            const placed = await assignTo(source.id, mine)
            expect(placed.ok(), 'подготовка: человек не встал на пост-источник').toBe(true)
            const row = (await fresh()).placementAssignments.find(
              (assignment) => assignment.employeeId === mine,
            )
            requireFixture(row, 'подготовленное назначение не нашлось в карточке ОМ')
            return { destination, source, traveller: row! }
          }
        }
        throw new Error(
          'на стенде не собрать перенос: ни для одной пары постов не хватает людей на ' +
            'приёмник по расчёту плюс одного на пост-источник',
        )
      }

      const { destination, source, traveller } = await stageTransfer()
      // ИСХОДНУЮ РОЛЬ ЧИТАЕМ, А НЕ СТАВИМ. Поставить её отдельно нечем: своей
      // операции «сменить роль» у бэка нет вовсе — она и ЕСТЬ снятие с
      // назначением заново, то самое, что проба проверяет. Роль берётся такая,
      // какая у человека уже есть (в том числе «нет вовсе»), а новая —
      // ОТЛИЧНАЯ от неё: правка на ту же роль ничего не меняет, и проба была
      // бы вакуумной.
      const keptRole = traveller.roleCode ?? null
      const newRole = roles.results.find((entry) => entry.code !== keptRole)
      requireFixture(newRole, 'в справочнике ролей нет роли, отличной от нынешней')

      await page.reload()
      await tree.locator(`li[data-drop-post="${source.id}"]`).click()
      const row = page.getByTestId(`placement-assignment-${traveller.id}`)
      await expect(row).toBeVisible({ timeout: 25_000 })
      await row.getByRole('button', { name: /^Роль и секция: / }).click()

      // Меняем РАЗОМ роль и пост — в этом и разница с №744.
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('combobox', { name: 'Роль наряда' }).selectOption(newRole!.code)
      await dialog.getByRole('combobox', { name: 'Пост' }).selectOption(destination.id)
      await dialog.getByRole('button', { name: 'Сохранить' }).click()

      const conflict = page.getByRole('dialog')
      await expect(conflict).toContainText('обоснование усиления', { timeout: 15_000 })
      await conflict.getByRole('button', { name: 'Отмена' }).click()

      await expect
        .poll(
          async () => {
            const rows = (await fresh()).placementAssignments.filter(
              (assignment) => assignment.employeeId === traveller.employeeId,
            )
            return rows.length === 1
              ? `${rows[0]!.postId}|${rows[0]!.roleCode ?? null}`
              : 'нет|нет'
          },
          {
            message:
              'после отмены человек должен стоять на ПРЕЖНЕМ посту с ПРЕЖНЕЙ ролью — ' +
              'иначе отклонённая правка применилась наполовину',
            timeout: 15_000,
          },
        )
        .toBe(`${source.id}|${keptRole}`)
    } finally {
      for (const row of (await fresh()).placementAssignments) {
        if (before.has(row.id)) continue
        await request.delete(
          `${API}/api/ops/security-events/${eventId}/placement/${encodeURIComponent(row.id)}/`,
          { headers: auth },
        )
      }
    }
  })
})
