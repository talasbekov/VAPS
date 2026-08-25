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
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

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
  reconChecklist?: { id: string; done: boolean }[]
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
    const stage = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Рекогносцировка' }),
    })
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
    const stage = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Рекогносцировка' }),
    })
    await expect(stage).toBeVisible({ timeout: 15_000 })
    // Промежуточного шага «Открыть рекогносцировку» у такого ОМ нет вовсе.
    await expect(
      page.getByRole('button', { name: 'Открыть рекогносцировку' }),
    ).toHaveCount(0)
    // Панель бюллетеня при этом ПРАВИТСЯ: иначе описание и задачи такому ОМ
    // уже никогда не вписать.
    const panel = page.getByTestId('bulletin-panel')
    await expect(panel.getByLabel('Краткое описание *')).toBeVisible()

    // Счётчик чек-листа из эталона считает по черновику формы.
    await expect(stage).toContainText('Выполнено: 0 из')
    await stage.getByLabel(/^Выполнено: /).first().check()
    await expect(stage).toContainText('Выполнено: 1 из')

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
    await page.goto(`${APP}/employees/`)
    const inbox = page.locator('[data-slot="card"]', {
      has: page.getByText('Запросы с рекогносцировки — ждут распределения'),
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
    const stage = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Рекогносцировка' }),
    })
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

})

/** Заводит ОМ и доводит до «Рекогносцировки» с постами из паспорта. */
async function prepareEvent(token: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.json().catch(() => ({}))
  }
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба рекогносцировки (e2e)',
    objectId: object.id,
    businessDate: '2026-08-24',
    // `kind` обязателен с 23.08 — без него создание отбивается 400, и вся
    // подготовка дальше бьёт по /security-events/undefined/.
    kind: 'INTERNAL',
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
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.json().catch(() => ({}))
  }
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  return (await call('POST', '/api/ops/security-events/', {
    title: 'Проба старта с рекогносцировки (e2e)',
    objectId: object.id,
    businessDate: '2026-08-25',
    kind: 'INTERNAL',
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
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба запроса штабу (e2e)',
    objectId: object.id,
    businessDate: '2026-08-25',
    kind: 'INTERNAL',
  })
  const base = `/api/ops/security-events/${created.id}`
  const withPosts = await call('POST', `${base}/recon/import-from-passport/`)
  // 300-899: за пределами правдоподобных чужих чисел на стенде и в пределах
  // трёх знаков, чтобы подстрока не совпала с частью чужого числа.
  const request = 300 + (Date.now() % 600)
  await call('PATCH', `${base}/recon/`, {
    checklist: (withPosts.reconChecklist ?? []).map((i: { id: string }) => ({
      ...i,
      done: true,
    })),
    sectorPosts: withPosts.reconSectorPosts,
    forceRequest: request,
  })
  const done = await call('POST', `${base}/recon/complete/`)
  expect(done.stage, 'рекогносцировка не завершилась — фикстура непригодна').toBe(
    'DEMAND',
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
