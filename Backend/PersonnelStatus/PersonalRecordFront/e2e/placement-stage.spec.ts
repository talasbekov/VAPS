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
import { requireFixture } from './fixtures'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

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
    const list = (await (
      await request.get(`${API}/api/ops/security-events/?page_size=50&stage=PLACEMENT`, {
        headers: auth,
      })
    ).json()) as { results: { id: string; code: string; stage: string }[] }
    const target = list.results[0]
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
    await expect(page.getByText('Доступные сотрудники')).toBeVisible()
    // Подзаголовок сменился осознанно (Plane №110): вместо «Подбор по
    // требованиям поста» колонка называет ПРОИСХОЖДЕНИЕ пула. Форм потребности
    // и выделения сил на шаге больше нет, и без этой строки человек не узнал
    // бы, почему в подборе именно эти люди. Пин стережёт, что строка есть и
    // говорит об одном из двух оснований, а не что она вообще какая-то.
    await expect(
      page.getByText(/Состав мероприятия: те, кого штаб принял|Кадровый список: состав мероприятия ещё не собран/)
    ).toBeVisible()
    // Путь к сбору состава — из снятого бокса «выделение сил»: пул собирают там.
    await expect(
      page.getByRole('main').getByRole('link', { name: /Сбор сил на ОМ/ })
    ).toBeVisible()
    await expect(page.getByText(/Выделено \d+/)).toBeVisible()
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

    const list = (await (
      await request.get(`${API}/api/ops/security-events/?page_size=50&stage=PLACEMENT`, {
        headers: auth,
      })
    ).json()) as { results: { id: string }[] }
    const target = list.results[0]
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
    await expect(
      removeStaffed,
      'занятый пост предлагается снять — правило заказчика нарушено',
    ).toBeDisabled()
    await expect(removeStaffed).toHaveAttribute('title', /стоит \d+ чел/)

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

    const list = (await (
      await request.get(`${API}/api/ops/security-events/?page_size=50&stage=PLACEMENT`, {
        headers: auth,
      })
    ).json()) as { results: { id: string }[] }
    const target = list.results[0]
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

      await rowOf(mine.id).getByRole('combobox', { name: /^Секция бланка: / }).selectOption(section!.code)

      await expect
        .poll(async () => mineOf(await assignmentsOf())?.sectionCode ?? null, {
          timeout: 20_000,
        })
        .toBe(section!.code)

      // Смена РОЛИ не должна снести секцию. Строка перечитывается заново —
      // назначение сектора её уже пересоздало.
      const afterSection = mineOf(await assignmentsOf())
      if (afterSection === null) throw new Error('строка пропала после смены секции')
      await rowOf(afterSection.id).getByRole('combobox', { name: /^Роль наряда: / }).selectOption(role!.code)

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

    const list = (await (
      await request.get(`${API}/api/ops/security-events/?page_size=50&stage=PLACEMENT`, {
        headers: auth,
      })
    ).json()) as { results: { id: string }[] }
    const target = list.results[0]
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
        .getByRole('combobox', { name: /^Роль наряда: / })
        .selectOption(role!.code)

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

      // Подпись роли видна в СВОЕЙ строке, а не только в выпадающем списке —
      // и не в чужой строке с тем же текстом где-то ещё на экране. `.first()`
      // здесь безопасен (в отличие от `.first()` по всей странице до
      // правки): выбор уже сужен до ОДНОЙ строки, и внутри нее совпадений
      // ровно два — бейдж роли и спрятанный `<option>` того же текста в
      // `<select>` — бейдж в разметке строки идёт ПЕРВЫМ. Таймаут больше
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

  test('отбор по рейтингу уходит НА СЕРВЕР, а не фильтрует страницу', async ({
    page,
    request,
  }) => {
    // Дефект, ради которого шаг делался (Plane №67): панель отбирала по
    // рейтингу в пределах ЗАГРУЖЕННОЙ страницы, и «нет кандидатов» означало
    // «нет на этой странице». Отличить это от правды с экрана было нельзя.
    //
    // Проба стережёт ровно наблюдаемое следствие переезда: выбор полосы
    // ОТПРАВЛЯЕТ запрос кадров с `rating_band`. Вернётся клиентская фильтрация
    // — параметра не будет, и проба покраснеет.
    const auth = { Authorization: `Bearer ${await apiToken(STAND_USERNAME, STAND_PASSWORD)}` }
    const events = (await (
      await request.get(`${API}/api/ops/security-events/?stage=PLACEMENT`, { headers: auth })
    ).json()) as { results: { id: string; forceRoster?: unknown[] }[] }
    // Мероприятие берётся с ПУСТЫМ составом, и это не придирка к фикстуре.
    // При непустом составе доска СОЗНАТЕЛЬНО не ходит в кадровую ручку вовсе:
    // кандидаты — принятые штабом люди, они уже пришли карточкой ОМ, и отбор
    // по ним идёт на клиенте (см. РЙ-5). Тогда `rating_band` не уходит никуда
    // — не потому, что отбор вернулся на страницу, а потому, что кадровую
    // базу здесь не спрашивают.
    //
    // Первая редакция пробы брала ПЕРВОЕ попавшееся мероприятие и на составном
    // падала с сообщением «отбор не ушёл на сервер» — то есть врала о причине.
    // Поймано соседней сессией: в блоке красная, в одиночку зелёная, потому
    // что соседние пробы меняют порядок мероприятий в реестре.
    const withoutRoster = events.results.filter(
      (event) => (event.forceRoster ?? []).length === 0,
    )
    test.skip(
      withoutRoster.length === 0,
      'на стенде нет ОМ на расстановке БЕЗ состава — кадровую базу спрашивать неоткуда',
    )
    const eventId = withoutRoster[0].id

    const asked: string[] = []
    page.on('request', (req) => {
      const url = new URL(req.url())
      if (url.pathname === '/api/ops/personnel/') asked.push(url.search)
    })

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${eventId}/`)
    const aside = page.locator('aside')
    await expect(aside.getByLabel('Фильтр по рейтингу')).toBeVisible({ timeout: 25_000 })

    asked.length = 0
    await aside.getByLabel('Фильтр по рейтингу').selectOption('9,0–10,0')

    await expect
      .poll(() => asked.some((query) => query.includes('rating_band=9_10')), {
        timeout: 15_000,
        // Сообщение обязано отличать «ушло не то» от «не спрашивали вовсе»:
        // без этого «не ушёл на сервер» читается как приговор коду. Факты
        // печатает ассерт ниже — `poll` принимает только строку.
        message: 'отбор по рейтингу не ушёл на сервер (запросы ниже)',
      })
      .toBe(true)
    expect(asked, 'запросы кадровой ручки после выбора полосы').not.toEqual([])

    // И то же для порядка: ранжирование по баллу считает сервер по всей базе
    // (решение заказчика 26.08.2026), а не страница сама себя.
    asked.length = 0
    await aside.getByLabel('Сортировка кандидатов').selectOption('По рейтингу')

    await expect
      .poll(() => asked.some((query) => query.includes('ordering=rating')), {
        timeout: 15_000,
        message: 'порядок по баллу не ушёл на сервер (запросы ниже)',
      })
      .toBe(true)
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
    expect(onPlacement.stage, 'ОМ не дошёл до расстановки — фикстура непригодна').toBe(
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

    // Уборка: своё мероприятие проба уносит за собой. Отказ её не роняет —
    // это уборка, а не предмет проверки; не удалённое подберёт
    // `manage.py purge_probe_events`.
    await request
      .delete(`${API}/api/ops/security-events/${created.id}/`, { headers: auth })
      .catch(() => undefined)
  })
})
