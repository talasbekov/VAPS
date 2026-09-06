/**
 * Этап «Рекогносцировка» карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на два вопроса: сведения об объекте берутся из ЖИВОЙ
 * карточки объекта и привязанной версии паспорта (а не из полей мероприятия),
 * и результат осмотра поста с замечанием ДОХОДЯТ ДО СЕРВЕРА — до этой правки
 * поля были в контракте, но экран их не показывал.
 *
 * Фикстуру проба готовит сама, если ОМ на «Рекогносцировке» нет. Правку она
 * сохраняет (это и есть предмет проверки), но стадию не завершает — иначе
 * фикстура стала бы одноразовой.
 */
import { expect, test, type Page } from '@playwright/test'
import { createOwnEvent, objectWithPassport, standCall } from './prepare-events'
import { probeTitle } from './probe-events'
import { anyChiefId } from './stand-chief'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { assertStep } from './fixture-step'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface EventRow {
  id: string
  code: string
  stage: string
  objectId: string | null
  objectName: string
  title?: string
  reconForceRequest?: number
  reconForceRequestedAt?: string | null
  reconChecklist?: { id: string; done: boolean; state?: string; result?: string | null }[]
  passportBinding: { versionId: string; versionNumber: number } | null
  reconSectorPosts: {
    id: string
    sector: string
    post: string
    postType?: string
    weapon?: string
    uniform?: string
    parentPostId?: string
    comment: string
  }[]
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(token: string): Promise<EventRow[]> {
  const res = await fetch(`${API}/api/ops/security-events/?page_size=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

async function objectCard(
  token: string,
  id: string,
): Promise<{ code: string; name: string; type: string; address: string }> {
  const res = await fetch(`${API}/api/ops/objects/${id}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as { code: string; name: string; type: string; address: string }
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'рекогносцировка' : 'рекогносцировка (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('сведения об объекте живые, осмотр поста доходит до сервера', async ({ page }) => {
    const token = await apiToken()
    const suitable = (rows: EventRow[]): EventRow | undefined =>
      rows.find((e) => e.stage === 'RECON' && e.reconSectorPosts.length > 0)
    let event = suitable(await events(token))
    if (event === undefined) {
      await prepareEvent(token)
      event = suitable(await events(token))
      expect(event, 'не удалось подготовить фикстуру').toBeDefined()
    }
    const target = event!
    const card = await objectCard(token, target.objectId!)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    // Карточка этапа ищется по ИМЕНИ ОБЛАСТИ, а не по заголовку внутри:
    // видимый заголовок снят как повтор шапки страницы (Plane №70), и имя
    // области — то, что осталось у блока как название.
    const stage = page.getByRole('region', { name: 'Рекогносцировка объекта' })
    await expect(stage).toBeVisible({ timeout: 15_000 })

    // Сведения — из карточки ОБЪЕКТА, а не из полей мероприятия: адрес и тип
    // у мероприятия отсутствуют вовсе, взяться им больше неоткуда.
    await expect(stage).toContainText(`${card.code} · ${card.name}`, {
      timeout: 15_000,
    })
    await expect(stage).toContainText(card.type)
    await expect(stage).toContainText(card.address)
    if (target.passportBinding !== null) {
      await expect(stage).toContainText(`№ ${target.passportBinding.versionNumber}`)
    }
    await expect(
      stage.getByRole('link', { name: 'История прошлых ОМ по объекту →' }),
    ).toHaveAttribute('href', new RegExp(encodeURIComponent(target.objectName)))

    // Колонки таблицы прототипа: тип, вооружение, форма одежды, примечание.
    // Заполняем и сверяем с тем, что вернул БЭК, а не с полем на экране.
    // «Тип поста» с 25.08 — ВЫБОР из списка эталона, а не свободный текст.
    const post = target.reconSectorPosts[0]
    const note = `Проба осмотра ${Date.now()}`
    // Тип, вооружение, форма одежды и примечание — в раскрытии ✎ (`[РЕК-05]`, №424).
    await stage.getByLabel(`Подробнее: ${post.post}`, { exact: true }).click()
    await stage
      .getByLabel(`Тип поста: ${post.post}`, { exact: true })
      .selectOption('Группа досмотра')
    await stage.getByLabel(`Вооружение: ${post.post}`, { exact: true }).fill('АКС-74У')
    await stage.getByLabel(`Форма одежды: ${post.post}`, { exact: true }).fill('Повседневная')
    await stage.getByLabel(`Примечание к посту: ${post.post}`, { exact: true }).fill(note)
    await stage.getByRole('button', { name: 'Сохранить расчёт' }).click()

    await expect
      .poll(
        async () => {
          const fresh = (await events(token)).find((e) => e.id === target.id)
          const row = fresh?.reconSectorPosts.find((r) => r.id === post.id)
          return [row?.postType, row?.weapon, row?.uniform, row?.comment].join('|')
        },
        { timeout: 15_000 },
      )
      .toBe(`Группа досмотра|АКС-74У|Повседневная|${note}`)

    // Подпост из прототипа: строка встаёт за родителем и доезжает до сервера.
    // Ожидание считается ОТ ИСХОДНОГО состояния фикстуры: проба добавляет
    // подпост каждым прогоном, и зашитая единица делала бы её одноразовой.
    const fresh0 = (await events(token)).find((e) => e.id === target.id)!
    const before = fresh0.reconSectorPosts.length
    const subsBefore = fresh0.reconSectorPosts.filter(
      (r) => (r.parentPostId ?? '') !== '',
    ).length
    await stage.getByLabel(`Добавить подпост: ${post.post}`, { exact: true }).click()
    await stage.getByRole('button', { name: 'Сохранить расчёт' }).click()
    await expect
      .poll(
        async () => {
          const fresh = (await events(token)).find((e) => e.id === target.id)
          const subs = fresh?.reconSectorPosts.filter(
            (r) => (r.parentPostId ?? '') !== '',
          )
          return { total: fresh?.reconSectorPosts.length, subs: subs?.length }
        },
        { timeout: 15_000 },
      )
      .toEqual({ total: before + 1, subs: subsBefore + 1 })
  })

  test('ОМ с объектом открывается СРАЗУ рекогносцировкой', async ({ page }) => {
    // Задача заказчика «Реестр ОМ-5». Проба судит по ФОРМЕ, а не по подписи
    // шага: «этап открылся» означает, что расчёт постов можно править, а не
    // что на экране написано слово «Рекогносцировка».
    const token = await apiToken()
    // Судим по СВЕЖЕЗАВЕДЁННОМУ ОМ: старая строка стенда могла попасть на
    // рекогносцировку переходом, и на ней правило заведения не проверяется.
    const call = await apiCall(token)
    const fixture = await createWithObject(token)
    expect(fixture.stage, 'ОМ с объектом заведено не на рекогносцировке').toBe(
      'RECON',
    )

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${fixture.id}/`)
    // Карточка этапа ищется по ИМЕНИ ОБЛАСТИ, а не по заголовку внутри:
    // видимый заголовок снят как повтор шапки страницы (Plane №70), и имя
    // области — то, что осталось у блока как название.
    const stage = page.getByRole('region', { name: 'Рекогносцировка объекта' })
    await expect(stage).toBeVisible({ timeout: 15_000 })
    // Промежуточного шага «Открыть рекогносцировку» у такого ОМ нет вовсе.
    await expect(
      page.getByRole('button', { name: 'Открыть рекогносцировку' }),
    ).toHaveCount(0)
    // 🔴 ПАНЕЛЬ БЮЛЛЕТЕНЯ НА РЕКОГНОСЦИРОВКЕ СНОВА ЕСТЬ (Plane №748), и пин
    // здесь ПЕРЕВЁРНУТ ОСОЗНАННО. История у него такая:
    //   1) сначала проба требовала панель — «иначе описание и задачи такому
    //      ОМ уже никогда не вписать»;
    //   2) №468 панель убрал, и пин перевернули на «панели нет»;
    //   3) названное в п. 1 следствие сбылось — ОМ с объектом заводится сразу
    //      рекогносцировкой и стадии «Бюллетень» не видит, — и №748 вернул
    //      панель на все незакрытые стадии, оставив от №468 главное: сама она
    //      больше не раскрывается вне «Бюллетеня» и места вниз не отжимает.
    // Пин остался от шага 2 и краснел с самого №748; правится вместе с ним, а
    // не подгоном под вывод: проверяется теперь ровно то, что решил заказчик.
    await expect(page.getByTestId('bulletin-panel')).toHaveCount(1)

    // `[РЕК-04]` (Plane №443): один переключатель «Норма / Замечание / Не
    // проверено», счётчик «Проверено X из Y» считает по черновику формы;
    // «Замечание» без комментария подсвечивается, «Не проверено» не засчитывается.
    const counter = stage.locator('[data-slot="recon-checked-counter"]')
    await expect(counter).toContainText('Проверено: 0 из')
    const firstItem = stage.locator('[data-slot="recon-check-item"]').first()
    await firstItem.getByRole('button', { name: 'Норма', exact: true }).click()
    await expect(firstItem).toHaveAttribute('data-state', 'NORMAL')
    await expect(counter).toContainText('Проверено: 1 из')
    await firstItem.getByRole('button', { name: 'Замечание', exact: true }).click()
    await expect(firstItem.getByText('Укажите комментарий')).toBeVisible()
    await expect(counter).toContainText('Проверено: 1 из')
    await firstItem.getByRole('button', { name: 'Не проверено', exact: true }).click()
    await expect(counter).toContainText('Проверено: 0 из')
    // `[РЕК-07]`: подвал с потребностью и «Завершить рекогносцировку →»,
    // недоступной с причиной; `[РЕК-09]`: строки про материалы нет.
    const footer = stage.locator('[data-slot="recon-footer"]')
    await expect(footer).toContainText('Потребность по объекту')
    await expect(footer.getByRole('button', { name: 'Завершить рекогносцировку →' })).toBeDisabled()
    await expect(stage.getByText('система не хранит')).toHaveCount(0)

    // Проба УБИРАЕТ за собой: предмет проверки — состояние ЗАВЕДЕНИЯ, значит
    // строку приходится заводить каждый прогон, и без уборки реестр копил бы
    // её бесконечно (24.08.2026: 188 пробных строк из 194 — Plane «Реестр
    // ОМ-34»). Удаление — та же ручка, что у кнопки реестра.
    await dropEvent(call, fixture.id)
  })


  test('запрос личного состава с рекогносцировки доходит до штаба', async ({ page }) => {
    // Задача заказчика «Реестр ОМ-23». Проба ведёт число ЧЕРЕЗ ВЕСЬ путь:
    // ввод старшим наряда на этапе → завершение этапа → экран «Сбор сил на
    // ОМ». Ассерт только на карточке ОМ был бы ассертом на своё же поле.
    const token = await apiToken()
    const call = await apiCall(token)
    const created = await createRequestFixture(call)
    const want = created.request

    await signIn(page)
    // Штаб видит ИМЕННО это число и именно у этого мероприятия.
    // `?view=forces` ЯВНО (Plane №273): вид по умолчанию сменился на расход
    // организации, а проба смотрит на РЕЕСТР — он живёт под «Сбором сил».
    await page.goto(`${APP}/employees/?view=forces`)
    // Заголовок ленты сменился осознанно (Plane №110): две ленты сбора сведены
    // в одну — «Запрос сил по мероприятиям». Разводили их стадии, которых
    // больше нет, и любой признак деления заставлял карточку прыгать из блока
    // в блок посреди работы штаба.
    const inbox = page.locator('[data-slot="card"]', {
      has: page.getByText('Запрос сил по мероприятиям'),
    })
    await expect(inbox).toBeVisible({ timeout: 15_000 })
    const row = inbox.locator('div').filter({ hasText: created.code }).first()
    await expect(row).toContainText(`${want} чел.`, { timeout: 15_000 })

    // Проба убирает за собой — см. `dropEvent`.
    await dropEvent(call, created.id)
  })


  test('сектор заводится на экране, и пост внутри него доезжает до сервера', async ({
    page,
  }) => {
    // Задача заказчика Plane №64: расчёт постов в эталоне — ИЕРАРХИЯ
    // «сектор → пост». Проба судит по тому, что вернул СЕРВЕР: сектор живёт
    // полем строки расчёта, и группа, существующая только в состоянии
    // компонента, была бы зелёной на экране и пустой в БД.
    const token = await apiToken()
    const call = await apiCall(token)
    // Своё мероприятие, а не чужая строка стенда: проба ДОБАВЛЯЕТ расчёт, и
    // на общей фикстуре она копила бы посты каждым прогоном.
    const fixture = await createWithObject(token)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${fixture.id}/`)
    // Карточка этапа ищется по ИМЕНИ ОБЛАСТИ, а не по заголовку внутри:
    // видимый заголовок снят как повтор шапки страницы (Plane №70), и имя
    // области — то, что осталось у блока как название.
    const stage = page.getByRole('region', { name: 'Рекогносцировка объекта' })
    await expect(stage).toBeVisible({ timeout: 15_000 })

    // Имя УНИКАЛЬНО на прогон: на стенде уже есть секторы из паспортов, и
    // совпавшее имя дало бы ассерт, зелёный по чужой строке.
    const sector = `Сектор пробы ${Date.now()}`
    const post = `Пост пробы ${Date.now()}`
    await stage.getByRole('button', { name: '+ Добавить сектор' }).click()
    await stage.getByLabel(/^Название сектора: /).last().fill(sector)
    await stage.getByRole('button', { name: '+ Пост' }).last().click()
    await stage.getByLabel('Пост', { exact: true }).last().fill(post)
    await stage.getByRole('button', { name: 'Сохранить расчёт' }).click()

    await expect
      .poll(
        async () => {
          const fresh = (await events(token)).find((e) => e.id === fixture.id)
          const row = fresh?.reconSectorPosts.find((r) => r.post === post)
          return row?.sector ?? null
        },
        { timeout: 15_000 },
      )
      .toBe(sector)

    await dropEvent(call, fixture.id)
  })

  test('объект посещения выбирается на экране, и импорт адресуется ему', async ({
    page,
  }) => {
    // Plane №409 (Ш-3 плана №385), требование `[РЕК-05]`: импорт идёт из
    // паспорта ОБЪЕКТА посещения. С №408 сервер при двух объектах отвечает
    // «выберите, для какого» — а выбирать на экране было негде, и кнопка
    // «Импорт из паспорта» у такого ОМ просто переставала работать.
    //
    // 🔴 ПРОБА НИЧЕГО НЕ ПУБЛИКУЕТ В РЕЕСТРЕ ОБЪЕКТОВ. Первая её редакция
    // доводила второй объект сама — публиковала ему версию паспорта, — и этим
    // ЛОМАЛА ЧУЖИЕ ПРОБЫ: соседние спеки берут «первый объект с
    // опубликованным паспортом», и им доставался объект пробы с пустым
    // адресом и единственным постом (замерено: 2 красных в полном смоуке
    // 03.09.2026). Адресность импорта проверяется без этого — по тому, КОМУ
    // сервер отвечает отказом и КОМУ достаются посты.
    const token = await apiToken()
    const call = await apiCall(token)
    const fixture = await createWithObject(token)

    // Второй объект посещения — БЕЗ своего паспорта: он и нужен, чтобы
    // отличить «импорт для второго» от «импорт в мероприятие вообще».
    const bindable = await call('GET', '/api/ops/security-events/bindable-objects/')
    const second = (bindable.results as { id: string; name: string }[]).find(
      (item) => item.id !== fixture.objectId,
    )
    if (second === undefined) throw new Error('на стенде один объект — выбирать не из чего')
    const withSecond = await call(
      'POST',
      `/api/ops/security-events/${fixture.id}/visit-objects/`,
      { objectId: second.id },
    )
    const secondVisitId = (
      withSecond.visitObjects as { id: string; objectName: string }[]
    ).find((v) => v.objectName === second.name)!.id
    const firstVisitId = (
      withSecond.visitObjects as { id: string; objectName: string }[]
    ).find((v) => v.objectName === fixture.objectName)!.id

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${fixture.id}/`)
    const stage = page.getByRole('region', { name: 'Рекогносцировка объекта' })
    await expect(stage).toBeVisible({ timeout: 15_000 })

    // Переключатель появляется ровно тогда, когда выбор есть.
    const picker = stage.getByLabel('Объект посещения')
    await expect(picker).toBeVisible()

    // Выбран ВТОРОЙ объект — кнопка импорта названа его нехваткой паспорта,
    // а не молчит и не тащит паспорт мероприятия: подстановка чужого паспорта
    // и была бы «импортом в мероприятие вообще».
    await picker.selectOption(secondVisitId)
    // `[РЕК-02]` (№424): объект, дописанный кнопкой «+», старшего не наследует —
    // вместо формы пустое состояние, кнопки импорта нет вовсе. Старший
    // назначается через API, страница перечитывается — форма открывается.
    await expect(stage.locator('[data-slot="recon-chief-empty"]')).toContainText(
      'Назначьте старшего объекта, чтобы начать рекогносцировку',
    )
    await expect(stage.getByRole('button', { name: 'Импорт из паспорта' })).toHaveCount(0)
    const withChief = await call('POST', `/api/ops/security-events/${fixture.id}/visit-objects/${secondVisitId}/chief/`, {
      employeeId: await anyChiefId(token),
    })
    expect(
      (withChief.visitObjects as { id: string; chiefEmployeeId: string | null }[] | undefined)?.find(
        (v) => v.id === secondVisitId,
      )?.chiefEmployeeId,
      `старший объекту не назначен: ${JSON.stringify(withChief).slice(0, 200)}`,
    ).toBeTruthy()
    await page.reload()
    await expect(stage).toBeVisible({ timeout: 15_000 })
    await picker.selectOption(secondVisitId)
    const importButton = stage.getByRole('button', { name: 'Импорт из паспорта' })
    await expect(importButton).toBeDisabled()
    await expect(importButton).toHaveAttribute(
      'title',
      'У объекта нет привязанной версии паспорта.',
    )

    // Выбран ПЕРВЫЙ — импорт проходит, и посты достаются именно ему.
    await picker.selectOption(firstVisitId)
    await expect(importButton).toBeEnabled()
    await importButton.click()

    const needOf = async (objectName: string): Promise<number | null> => {
      const fresh = await call('GET', `/api/ops/security-events/${fixture.id}/`)
      const visit = (
        fresh.visitObjects as { objectName: string; placementNeed: number | null }[]
      ).find((v) => v.objectName === objectName)
      return visit?.placementNeed ?? null
    }
    await expect
      .poll(async () => await needOf(fixture.objectName), { timeout: 15_000 })
      .toBeGreaterThan(0)
    expect(
      await needOf(second.name),
      'посты уехали и второму объекту — импорт не адресный',
    ).toBe(0)

    await dropEvent(call, fixture.id)
  })

  test('ссылка на объект открывает этапы ЭТОГО объекта, выбор пишется в адрес', async ({
    page,
  }) => {
    // Plane №388, требование `[РЕЕ-06]`: «клик по объекту → страница этапов
    // объекта». Из раскрытой строки реестра сюда приходят адресом
    // `?visit=<id>`, и до этой правки понятий «текущий объект» у карточки было
    // ДВА: шапка читала адрес, а дерево постов держало своё состояние и всегда
    // начиналось с ПЕРВОГО объекта. Человек по ссылке на второй объект видел
    // второй в шапке и посты первого в дереве.
    const token = await apiToken()
    const call = await apiCall(token)
    const fixture = await createWithObject(token)

    const bindable = await call('GET', '/api/ops/security-events/bindable-objects/')
    const second = (bindable.results as { id: string; name: string }[]).find(
      (item) => item.id !== fixture.objectId,
    )
    if (second === undefined) throw new Error('на стенде один объект — выбирать не из чего')
    const withSecond = await call(
      'POST',
      `/api/ops/security-events/${fixture.id}/visit-objects/`,
      { objectId: second.id },
    )
    const byName = (name: string): string =>
      (withSecond.visitObjects as { id: string; objectName: string }[]).find(
        (v) => v.objectName === name,
      )!.id
    const secondVisitId = byName(second.name)
    const firstVisitId = byName(fixture.objectName)

    await signIn(page)
    // ВТОРОЙ объект в адресе — именно он и должен быть показан на этапе.
    // Ассерт по значению `select`, а не по видимому тексту: до правки текст
    // первого объекта был бы на экране в шапке тоже, и проба зеленела бы.
    await page.goto(`${APP}/security-ops/events/${fixture.id}/?visit=${secondVisitId}`)
    const stage = page.getByRole('region', { name: 'Рекогносцировка объекта' })
    await expect(stage).toBeVisible({ timeout: 15_000 })
    const picker = stage.getByLabel('Объект посещения')
    await expect(picker).toHaveValue(secondVisitId)

    // Шапка показывает ТО ЖЕ: одно значение, а не два согласованных вручную.
    await expect(
      page.getByRole('button', { name: second.name, pressed: true }),
    ).toBeVisible()

    // Обратная сторона того же правила: выбор на этапе уезжает в адрес, и
    // ссылку можно переслать. Без этого «этапы объекта» жили бы только внутри
    // вкладки того, кто нажал.
    await picker.selectOption(firstVisitId)
    await expect(page).toHaveURL(new RegExp(`visit=${firstVisitId}(&|$)`))
    await expect(picker).toHaveValue(firstVisitId)

    await dropEvent(call, fixture.id)
  })



  test('«Не проверено» переживает сохранение чек-листа', async ({ page }) => {
    // Кнопка меняла только `state`, и наверх уходило тело
    // `{state:'UNCHECKED', done:true, result:'MATCHES'}` — со СТАРЫМИ
    // значениями выводимых ключей. Серверное правило «явное UNCHECKED поверх
    // done — не верим» переписывало состояние обратно в NORMAL, ответ
    // переносился в форму, счётчик откатывался, и ошибки не было никакой:
    // человек снимал отметку, а она возвращалась сама (Plane №707).
    //
    // Проба ЖИВАЯ и мутирующая: предмет — что сервер принял и вернул, а
    // подменённый ответ этого не докажет. Прежнее состояние возвращается в
    // `finally`.
    // ОМ СВОЙ: проба мутирующая, и общий со стендом ОМ делал её мигающей —
    // разбор в шапке `ownEventOnRecon`.
    const token = await apiToken()
    const target = await ownEventOnRecon(token)
    // 🔴 НАЧИНАЕМ С «НЕ ПРОВЕРЕНО» — ЭТО ЧАСТЬ ПРЕДМЕТА. Форма сравнивалась
    // с пропом `event`, а карточка ОМ намеренно не пересобирается на каждом
    // обновлении данных: проп остаётся тем, каким пришёл при открытии. Значит
    // «отметил → сохранил → снял отметку» возвращало форму РОВНО к тому, что
    // лежит в устаревшем пропе, «Сохранить» гасла, и второе сохранение не
    // уходило вовсе. Если начать с «Норма», этой половины дефекта не видно.
    await fetch(`${API}/api/ops/security-events/${target.id}/recon/`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        checklist: (target.reconChecklist ?? []).map((item, index) =>
          index === 0
            ? { ...item, state: 'UNCHECKED', done: false, result: null }
            : item,
        ),
      }),
    })

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const item = page.locator('[data-slot="recon-check-item"]').first()
    await expect(item).toBeVisible({ timeout: 15_000 })
    const before = await item.getAttribute('data-state')

    // «Сохранить» выключена, пока форма не изменена, — жать её вслепую значит
    // ждать десять секунд отключённую кнопку (так и вышло на первом прогоне,
    // когда пункт УЖЕ был «Норма»).
    //
    // 🔴 СНАЧАЛА ДОЖИДАЕМСЯ КОНЦА ПРЕДЫДУЩЕГО СОХРАНЕНИЯ. Пока мутация в
    // полёте, кнопка подписана «Сохранение…» и выключена — `isEnabled()`
    // вернул бы `false` не потому, что править нечего, и второе сохранение
    // молча не состоялось бы. Ответ первого затем переносился в форму и
    // возвращал «Норма» поверх только что снятой отметки: проба падала
    // ровно тем симптомом, который стережёт, и мигала прогон через прогон
    // (замерено: два запуска подряд — passed, failed).
    //
    // Локатор по имени «Сохранить» и есть ожидание: во время сохранения
    // кнопка зовётся иначе, и `toBeVisible` держит паузу до её возвращения.
    const footer = page.locator('[data-slot="recon-footer"]')
    const save = async () => {
      const button = footer.getByRole('button', { name: 'Сохранить' })
      await expect(button).toBeVisible({ timeout: 15_000 })
      // 🔴 `isEnabled()` — СНИМОК БЕЗ ОЖИДАНИЯ. Сразу после щелчка по «Не
      // проверено» React ещё не перерисовал подвал, кнопка снимком выключена,
      // и сохранение молча не отправлялось: в сеть уходил ОДИН PATCH из двух
      // (проверено логом запросов). Проба падала «состояние вернулось в
      // „Норма“» — то есть ровно тем симптомом, который стережёт, и врала бы
      // про дефект сервера.
      //
      // `toBeEnabled` ждёт; отсутствие правок — не ошибка пробы, поэтому
      // ожидание короткое и его исход не обязателен.
      await expect(button).toBeEnabled({ timeout: 5_000 }).catch(() => undefined)
      if (!(await button.isEnabled())) return
      // 🔴 ЖДЁМ ОТВЕТ СЕРВЕРА, А НЕ ПОДПИСЬ КНОПКИ. Ответ сохранения
      // переносится в форму (`onEvent` → `setChecklist`), поэтому правка,
      // сделанная ПОКА запрос в полёте, затирается пришедшим ответом: проба
      // щёлкала «Не проверено» поверх летящего сохранения «Норма», ответ
      // возвращал «Норма», и падение выглядело дефектом сервера.
      //
      // Ожидание по подписи («Сохранение…» появилась и пропала) здесь НЕ
      // работает: проверка отсутствия проходит мгновенно — React ещё не успел
      // перерисовать кнопку после щелчка. Ждать надо ответ, и подписка на
      // него оформляется ДО щелчка, иначе он успеет прийти раньше.
      const saved = page.waitForResponse(
        (r) => r.url().includes('/recon/') && r.request().method() === 'PATCH',
        { timeout: 20_000 },
      )
      await button.click()
      await saved
    }

    try {
      // Ставим «Норма», сохраняем — чтобы снимать было что.
      await item.getByRole('button', { name: 'Норма' }).click()
      await save()
      await expect(item).toHaveAttribute('data-state', 'NORMAL', { timeout: 15_000 })

      // Снимаем отметку и сохраняем: состояние обязано остаться «Не проверено».
      await item.getByRole('button', { name: 'Не проверено' }).click()
      await save()
      await expect(item).toHaveAttribute('data-state', 'UNCHECKED', { timeout: 15_000 })

      // И это состояние СЕРВЕРА, а не экрана: перечитываем карточку.
      await page.reload()
      await expect(page.locator('[data-slot="recon-check-item"]').first()).toHaveAttribute(
        'data-state',
        'UNCHECKED',
        { timeout: 15_000 },
      )
    } finally {
      if (before !== null && before !== 'UNCHECKED') {
        const label = before === 'REMARK' ? 'Замечание' : 'Норма'
        await page.locator('[data-slot="recon-check-item"]').first().getByRole('button', { name: label }).click()
        await save()
      }
    }
  })

  // Воркер MSW блокируется ТОЛЬКО здесь: обе пробы ниже подменяют карточку
  // `page.route`, а с живым воркером подмена не применяется и проба зеленеет
  // на неподменённых данных (та же яма, что в `approval-stage.spec.ts`).
  test.describe('подвал на ОМ с двумя объектами', () => {
    test.use({ serviceWorkers: 'block' })

    test('подвал называет и число объекта, и то, что уйдёт штабу', async ({
      page,
    }) => {
      // Подвал печатал потребность ПОКАЗАННОГО объекта, а `complete_recon`
      // отправляет штабу сумму по ВСЕМ постам мероприятия (Plane №708): на ОМ
      // с двумя объектами человек подтверждал «5 сотрудников», а уходило 12.
      const token = await apiToken()
      // ОМ обязан СТОЯТЬ на «Рекогносцировке»: стадию отдаёт и серверный
      // рендер, подменой в ответе её не сдвинуть (проверено — панель не
      // появлялась). Фикстура готовится тем же помощником, что и у соседней
      // пробы, если готовой нет.
      const suitable = (rows: EventRow[]): EventRow | undefined =>
        rows.find((e) => e.stage === 'RECON' && e.reconSectorPosts.length > 0)
      let found = suitable(await events(token))
      if (found === undefined) {
        await prepareEvent(token)
        found = suitable(await events(token))
      }
      expect(found, 'не удалось подготовить ОМ на «Рекогносцировке»').toBeDefined()
      const target = found

      await page.route(
        new RegExp(`/api/ops/security-events/${target!.id}/(\\?.*)?$`),
        async (r) => {
          const response = await r.fetch()
          const body = await response.json()
          const visit = { ...(body.visitObjects[0] ?? {}), id: 'probe-a', objectName: 'Объект А' }
          const second = { ...visit, id: 'probe-b', objectName: 'Объект Б' }
          body.visitObjects = [visit, second]
          // Посты РАЗМЕЧЕНЫ по объектам, и суммы разные: у показанного 2, у
          // мероприятия 5. Без разницы проба не отличила бы починку от
          // прежнего поведения.
          body.reconSectorPosts = [
            { ...body.reconSectorPosts[0], id: 'p1', need: 2, visitObjectId: 'probe-a' },
            { ...body.reconSectorPosts[0], id: 'p2', need: 3, visitObjectId: 'probe-b' },
          ]
          await r.fulfill({ response, json: body })
        },
      )

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target!.id}/?visit=probe-a`)
      const footer = page.locator('[data-slot="recon-footer"]')
      await expect(footer).toBeVisible({ timeout: 15_000 })

      await expect(footer.locator('[data-slot="recon-need"]')).toHaveText('2')
      // И число, которое ДЕЙСТВИТЕЛЬНО уйдёт штабу, названо рядом.
      await expect(footer.locator('[data-slot="recon-need-event"]')).toHaveText('5')
    })

    test('на объекте без постов кнопка не жалуется на пустой расчёт', async ({
      page,
    }) => {
      // `completeBlocked` считал пустоту по ПОКАЗАННОМУ объекту, а сервер
      // требует непустой расчёт по мероприятию целиком (Plane №710): стоя на
      // объекте без постов, человек видел выключенную кнопку с неверной
      // причиной, хотя завершение прошло бы.
      const token = await apiToken()
      const suitable = (rows: EventRow[]): EventRow | undefined =>
        rows.find((e) => e.stage === 'RECON' && e.reconSectorPosts.length > 0)
      let found = suitable(await events(token))
      if (found === undefined) {
        await prepareEvent(token)
        found = suitable(await events(token))
      }
      expect(found, 'не удалось подготовить ОМ на «Рекогносцировке»').toBeDefined()
      const target = found

      await page.route(
        new RegExp(`/api/ops/security-events/${target!.id}/(\\?.*)?$`),
        async (r) => {
          const response = await r.fetch()
          const body = await response.json()
          const visit = { ...(body.visitObjects[0] ?? {}), id: 'probe-a', objectName: 'Объект А' }
          const second = { ...visit, id: 'probe-b', objectName: 'Объект Б' }
          body.visitObjects = [visit, second]
          // ВСЕ посты у второго объекта: у показанного пусто, у мероприятия
          // расчёт есть — то самое состояние, где кнопка врала.
          body.reconSectorPosts = body.reconSectorPosts.map(
            (post: Record<string, unknown>) => ({ ...post, visitObjectId: 'probe-b' }),
          )
          await r.fulfill({ response, json: body })
        },
      )

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target!.id}/?visit=probe-a`)
      const footer = page.locator('[data-slot="recon-footer"]')
      await expect(footer).toBeVisible({ timeout: 15_000 })

      const complete = footer.getByRole('button', { name: /Завершить рекогносцировку/ })
      // Причина отказа может быть ДРУГОЙ (чек-лист, старший объекта) — это не
      // предмет пробы. Предмет: она не «Нет постов расчёта», потому что по
      // мероприятию расчёт есть.
      await expect(complete).not.toHaveAttribute('title', 'Нет постов расчёта.')
    })

    test('кнопка знает про старшего СОСЕДНЕГО объекта и называет его', async ({
      page,
    }) => {
      // 🔴 Plane №635. `completeBlocked` смотрел старшего только у ПОКАЗАННОГО
      // объекта, а `complete_recon` требует его у КАЖДОГО объекта на этапе
      // «Рекогносцировка». Человек стоял на объекте со старшим, кнопка была
      // включена, сервер отвечал 422 — и это не редкий случай, а состояние
      // двухобъектного ОМ ПО УМОЛЧАНИЮ: второй объект, добавленный кнопкой
      // «+», старшего не наследует.
      //
      // Красная проверка — вернуть условие по активному объекту: подпись
      // станет `null`, кнопка включится, и `toHaveAttribute` не найдёт текста.
      const token = await apiToken()
      const suitable = (rows: EventRow[]): EventRow | undefined =>
        rows.find((e) => e.stage === 'RECON' && e.reconSectorPosts.length > 0)
      let found = suitable(await events(token))
      if (found === undefined) {
        await prepareEvent(token)
        found = suitable(await events(token))
      }
      expect(found, 'не удалось подготовить ОМ на «Рекогносцировке»').toBeDefined()
      const target = found

      await page.route(
        new RegExp(`/api/ops/security-events/${target!.id}/(\\?.*)?$`),
        async (r) => {
          const response = await r.fetch()
          const body = await response.json()
          const base = body.visitObjects[0] ?? {}
          // Показанный объект — СО СТАРШИМ (иначе экран показывает пустое
          // состояние «назначьте старшего» и до кнопки дело не доходит);
          // соседний — БЕЗ старшего и на том же этапе.
          const shown = {
            ...base,
            id: 'probe-a',
            objectName: 'Объект А',
            stage: 'RECON',
            chiefEmployeeId: base.chiefEmployeeId ?? '1',
          }
          const neighbour = {
            ...shown,
            id: 'probe-b',
            objectName: 'Объект Б',
            chiefEmployeeId: null,
          }
          body.visitObjects = [shown, neighbour]
          body.reconSectorPosts = body.reconSectorPosts.map(
            (post: Record<string, unknown>) => ({ ...post, visitObjectId: 'probe-a' }),
          )
          await r.fulfill({ response, json: body })
        },
      )

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target!.id}/?visit=probe-a`)
      const footer = page.locator('[data-slot="recon-footer"]')
      await expect(footer).toBeVisible({ timeout: 15_000 })

      const complete = footer.getByRole('button', { name: /Завершить рекогносцировку/ })
      await expect(complete).toBeDisabled()
      // Имя в подписи обязательно: без него человек не поймёт, куда идти —
      // объект, на котором он стоит, со старшим.
      await expect(complete).toHaveAttribute(
        'title',
        'Не назначен старший объекта «Объект Б».',
      )
    })
  })
})

/**
 * СВОЙ ОМ на «Рекогносцировке» с постами — и его строка реестра.
 *
 * 🔴 ПОЧЕМУ НЕ «ПЕРВЫЙ ПОДХОДЯЩИЙ СО СТЕНДА». Пробы, которые ПРАВЯТ состояние,
 * не имеют права брать чужую строку: стенд один на все сессии, и соседняя
 * проба (или соседний Claude) ведёт тот же ОМ своим путём. Замерено
 * 05.09.2026: проба «Не проверено» на общем ОМ мигала прогон через прогон —
 * четыре запуска подряд дали ✓ ✘ ✓ ✘, причём падение было ровно тем
 * симптомом, который она стережёт, то есть врало про дефект.
 *
 * Читающим пробам первый подходящий по-прежнему годится: они ничего не меняют.
 */
async function ownEventOnRecon(token: string): Promise<EventRow> {
  await prepareEvent(token)
  const rows = await events(token)
  const mine = rows
    .filter((e) => e.stage === 'RECON' && e.reconSectorPosts.length > 0)
    .sort((a, b) => Number(b.id) - Number(a.id))[0]
  expect(mine, 'не удалось завести свой ОМ на «Рекогносцировке»').toBeDefined()
  return mine
}

/** Заводит ОМ и доводит до «Рекогносцировки» с постами из паспорта.
 *
 * Заведение живёт в общем `prepare-events.ts` (Plane №822 Ш-1): своя копия
 * была одной из шестнадцати, и контракт заведения они держали вразнобой.
 * Здесь остаётся только то, что своё, — доведение до рекогносцировки. */
async function prepareEvent(token: string): Promise<void> {
  const call = standCall(token)
  const created = await createOwnEvent(call, token, {
    name: 'Проба рекогносцировки',
    // Своя деловая дата у КАЖДОЙ подготовки: общая воспроизводит исчерпание
    // кадрового пула, от которого и уходим (№822, подвид 4).
    businessDate: '2026-08-24',
  })
  const base = `/api/ops/security-events/${created.id}`
  await call('PATCH', `${base}/bulletin/`, {
    briefDescription: 'Проба рекогносцировки.',
    initialTasks: '—',
  })
  // Завершать бюллетень больше НЕ нужно: ОМ с объектом заводится сразу на
  // рекогносцировке (Plane «Реестр ОМ-5»), и `bulletin/complete/` ответил бы
  // отказом «не на этом этапе».
  await call('POST', `${base}/recon/import-from-passport/`)
}

/** Заводит ОМ С ОБЪЕКТОМ и возвращает ответ сервера — предмет пробы именно
 * состояние ЗАВЕДЕНИЯ, а не состояние случайной строки стенда. */
async function createWithObject(token: string): Promise<EventRow> {
  return (await createOwnEvent(standCall(token), token, {
    name: 'Проба старта с рекогносцировки',
    businessDate: '2026-08-25',
  })) as EventRow
}

/** Обёртка над API стенда: заголовки и разбор один раз на файл. */
async function apiCall(
  token: string,
): Promise<(method: string, path: string, body?: unknown) => Promise<any>> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  return async (method, path, body) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    await assertStep(res, method, path)
    return res.json().catch(() => ({}))
  }
}

/** Заводит ОМ, доводит рекогносцировку до конца с запросом личного состава и
 * возвращает код мероприятия и запрошенное число. Число УНИКАЛЬНО на прогон:
 * на стенде уже есть чужие запросы, и совпавшее число дало бы ассерт,
 * зелёный по чужой строке. */
async function createRequestFixture(
  call: (method: string, path: string, body?: unknown) => Promise<any>,
): Promise<{ code: string; request: number; id: string }> {
  // Поиск объекта — общий (Plane №822 Ш-1). Заведение здесь НЕ общее осознанно:
  // эта фикстура ходит обёрткой с `assertStep` и берёт старшего из другого
  // источника, и подмена того и другого была бы правкой предмета, а не дедупом.
  const object = await objectWithPassport(call)
  const created = await call('POST', '/api/ops/security-events/', {
    title: probeTitle('Проба запроса штабу'),
    objectId: object.id,
    businessDate: '2026-08-25',
    kind: 'INTERNAL',
    chiefEmployeeId: (await call('GET', '/api/ops/personnel/?page_size=1')).results[0].id,
  })
  const base = `/api/ops/security-events/${created.id}`
  // Сторож фикстуры (Plane №196): версия паспорта привязывается по деловой
  // дате, и у ОМ прошлой датой её может не оказаться вовсе. Без этого пина
  // проба падала на завершении этапа словами «добавьте хотя бы один пост» —
  // то есть винила расчёт постов вместо привязки, которой нет.
  expect(
    created.passportBinding,
    'к ОМ не привязана версия паспорта — на стенде нет версии, действующей ' +
      'на деловую дату пробы (пересейте seed_smoke_fixtures)',
  ).not.toBeNull()
  const withPosts = await call('POST', `${base}/recon/import-from-passport/`)
  // 300-899: за пределами правдоподобных чужих чисел на стенде и в пределах
  // трёх знаков, чтобы подстрока не совпала с частью чужого числа.
  const request = 300 + (Date.now() % 600)
  await call('PATCH', `${base}/recon/`, {
    checklist: (withPosts.reconChecklist ?? []).map((i: { id: string }) => ({
      ...i,
      state: 'NORMAL',
      done: true,
    })),
    sectorPosts: withPosts.reconSectorPosts,
    forceRequest: request,
  })
  const done = await call('POST', `${base}/recon/complete/`)
  // Пин перенацелен осознанно (Plane №110): завершение осмотра проходит
  // «Потребность» и «Запрос сил» само и оставляет ОМ на «Расстановке».
  expect(done.stage, 'рекогносцировка не завершилась — фикстура непригодна').toBe(
    'PLACEMENT',
  )
  expect(done.reconForceRequestedAt, 'момент отправки штабу не проставлен').not.toBeNull()
  return { code: created.code, request, id: String(created.id) }
}

/** Убрать за собой заведённую пробой строку реестра.
 *
 * Отказ НЕ роняет пробу: удаление — уборка, а не предмет проверки, и падать
 * на нём значило бы красить зелёный прогон по причине, к нему не относящейся.
 * Не удалённое подберёт `manage.py purge_probe_events`.
 */
async function dropEvent(
  call: (method: string, path: string, body?: unknown) => Promise<any>,
  eventId: string,
): Promise<void> {
  await call('DELETE', `/api/ops/security-events/${eventId}/`).catch(() => ({}))
}

