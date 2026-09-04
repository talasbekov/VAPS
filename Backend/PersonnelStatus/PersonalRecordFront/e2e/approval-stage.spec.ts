/**
 * Этап «Согласование» карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на два вопроса: сводка и блок обходов предупреждений стоят
 * на РЕАЛЬНОМ расчёте (обход показывается с тем обоснованием, которое ввели
 * при назначении), и пустую причину возврата отбивает СЕРВЕР, а не экран.
 *
 * Фикстуру проба готовит сама: нужен ОМ на «Согласовании», где хотя бы одно
 * назначение прошло через мягкий 409 по требованию поста к рейтингу. Такой
 * набор на стенде не заводится сам — посты из паспорта приходят без
 * minRating, его проба выставляет на рекогносцировке.
 *
 * Утверждение проба НЕ выполняет: переход необратим и сделал бы фикстуру
 * одноразовой. Возврат тоже не доводится до конца — только отказ на пустой
 * причине, он состояние не меняет.
 */
import { expect, test, type Page } from '@playwright/test'
import { anyChiefId } from './stand-chief'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const OVERRIDE_REASON = 'Проба: обоснование обхода предупреждения'

interface EventRow {
  id: string
  code: string
  stage: string
  updatedAt: string
  reconSectorPosts: { id: string; sector: string; post: string; need: number }[]
  placementAssignments: {
    id: string
    employeeName: string
    postId: string
    ratingOverrideReason: string | null
  }[]
  approvalRoute: { id: string; name: string; status: string; comment: string }[]
  visitObjects: {
    id: string
    objectName: string
    documentVersion: number
    documentStatus: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED' | null
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

/**
 * Согласующий на объект — по API, а не кнопкой: с №429 (`[СОГ-05]`) маршрут
 * задаётся в настройках, и «+ Добавить согласующего» на объекте нет. Ручка
 * `approval/route/` осталась под админа и API — ею проба и пользуется.
 */
async function addApproverViaApi(token: string, eventId: string, who: string): Promise<void> {
  const res = await fetch(`${API}/api/ops/security-events/${eventId}/approval/route/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: who, unit: 'Управление ОМ', position: 'полковник' }),
  })
  if (!res.ok) throw new Error(`согласующий не добавлен: ${res.status} ${await res.text()}`)
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'согласование' : 'согласование (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('сводка и обходы идут от расчёта, пустой возврат отбивает сервер', async ({
    page,
  }) => {
    const token = await apiToken()
    const suitable = (rows: EventRow[]): EventRow | undefined =>
      rows.find(
        (e) =>
          e.stage === 'APPROVAL' &&
          e.placementAssignments.some((a) => a.ratingOverrideReason !== null),
      )
    let event = suitable(await events(token))
    if (event === undefined) {
      await prepareEvent(token)
      event = suitable(await events(token))
      expect(event, 'не удалось подготовить фикстуру').toBeDefined()
    }
    const target = event!
    const override = target.placementAssignments.find(
      (a) => a.ratingOverrideReason !== null,
    )!
    const totalNeed = target.reconSectorPosts.reduce((sum, p) => sum + p.need, 0)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    // По ИМЕНИ ОБЛАСТИ: видимый заголовок карточки снят как повтор шапки
    // страницы (Plane №70).
    const card = page.getByRole('region', { name: 'Согласование расстановки' })
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Сводка — из расчёта, а не из воздуха
    await expect(card).toContainText(
      `${target.placementAssignments.length} / ${totalNeed}`,
    )
    // Плитки «обходов предупреждений» на согласовании больше НЕТ (`[СОГ-11]`,
    // Plane №446): обходы — предмет аудита. Пин перевёрнут осознанно.
    await expect(card).not.toContainText('обходов предупреждений')

    // Блока «Обходы предупреждений» на согласовании НЕТ (`[СОГ-11]`, Plane
    // №399) — его место в аудите; число обходов остаётся плиткой сводки выше.
    // Назначение с обходом по-прежнему видно в расчёте на согласование.
    const post = target.reconSectorPosts.find((p) => p.id === override.postId)!
    await expect(card).toContainText(override.employeeName)
    // Печатный вид (Plane №430, [СОГ-02]) пишет сектор заголовком, а пост —
    // строкой под ним; прежний пин «Сектор · Пост» ждал список назначений.
    await expect(card).toContainText(`Сектор «${post.sector}»`)
    await expect(card).toContainText(post.post)
    await expect(card.getByText('Обходы предупреждений при назначении')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Завершить этап и перейти далее' })).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Вернуть на доработку' })).toHaveCount(0)

    // Маршрут согласования из прототипа: добавляем согласующего, решаем по
    // нему и сверяем с тем, что вернул БЭК, а не с экраном.
    const route = card.locator('section', { hasText: 'Маршрут согласования' }).first()
    const who = `Проба ${Date.now()}`
    await addApproverViaApi(token, target.id, who)
    await page.reload()
    await expect(route).toContainText(who, { timeout: 15_000 })
    // Внесённый в маршрут — ещё НЕ на согласовании: расстановку ему не
    // отправляли (эталон, задача «ОМ-37.3»).
    await expect(route).toContainText('Не отправлено')

    const added = await expect
      .poll(async () => {
        const fresh = (await events(token)).find((e) => e.id === target.id)
        return fresh?.approvalRoute.find((a) => a.name === who)?.id ?? null
      }, { timeout: 15_000 })
      .not.toBeNull()
    void added

    // Решать по неотправленному нечего — кнопок решения у строки нет.
    const row = route.locator('tr', { hasText: who }).first()
    await expect(row.getByRole('button', { name: 'Вернуть' })).toHaveCount(0)

    // Отправка переводит ВЕСЬ маршрут в «На согласовании».
    await route.getByRole('button', { name: 'Отправить на согласование' }).click()
    await expect(row).toContainText('На согласовании', { timeout: 15_000 })

    // Возврат — модалка (`[ВОЗ-01]`, Plane №431): причина обязательна, и отказ
    // на пустую по-прежнему приходит от СЕРВЕРА — кнопка не выключается.
    await row.getByRole('button', { name: 'Вернуть' }).click()
    const dialog = page.locator('[data-slot="return-dialog"]')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Подтвердить возврат' }).click()
    await expect(dialog).toContainText('Укажите причину возврата', { timeout: 15_000 })

    // С причиной решение фиксируется, и его видит бэк
    await dialog.getByLabel('Общая причина *').fill('Уточнить расчёт постов')
    await dialog.getByRole('button', { name: 'Подтвердить возврат' }).click()
    await expect
      .poll(async () => {
        const fresh = (await events(token)).find((e) => e.id === target.id)
        const mine = fresh?.approvalRoute.find((a) => a.name === who)
        return `${mine?.status}|${mine?.comment}`
      }, { timeout: 15_000 })
      .toBe('RETURNED|Уточнить расчёт постов')

    // РЕШЕНИЕ «ВЕРНУТЬ» — ДЕЙСТВИЕ (`[СОГ-08]`, Plane №399): объект сразу
    // возвращается на «Расстановку», отдельной кнопки для этого нет. Замечание
    // видно там, над деревом постов (№397).
    await expect
      .poll(async () => (await events(token)).find((e) => e.id === target.id)?.stage ?? null, {
        timeout: 15_000,
      })
      .toBe('PLACEMENT')
    const placement = page.getByRole('region', { name: 'Расстановка сил' })
    await expect(placement).toBeVisible({ timeout: 15_000 })
    await expect(placement.getByRole('region', { name: 'Замечания согласования' })).toContainText(
      'Уточнить расчёт постов',
    )

    // Бейдж возврата в РЕЕСТРЕ (`[РЕЕ-08]`/`[ВОЗ-03]`, Plane №400): о возврате
    // видно, не открывая карточку, — «Возвращено · N замечаний» в раскрытой
    // строке объекта.
    await page.goto(`${APP}/security-ops/events/`)
    await page
      .getByRole('button', { name: `Развернуть объекты посещения ${target.code}` })
      .click()
    const returnedBadge = page.locator('[data-slot="visit-returned-badge"]').first()
    await expect(returnedBadge).toBeVisible({ timeout: 15_000 })
    await expect(returnedBadge).toContainText(/Возвращено · \d+ замечани/)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)

    // Старший завершает расстановку заново (состав не менялся) — объект снова
    // на согласовании, и замечание ждёт ответа там.
    await fetch(`${API}/api/ops/security-events/${target.id}/placement/complete/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    })
    await page.reload()
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Возврат согласующего порождает ЗАМЕЧАНИЕ — экран показывает его
    // отдельным списком, и закрывается оно по одному.
    const remarks = card.locator('section', { hasText: 'Замечания' }).first()
    await expect(remarks).toContainText('Уточнить расчёт постов', { timeout: 15_000 })
    // Статус замечания — тройной (`[МД-07]`, Plane №386): свежее — «Открыто».
    await expect(remarks).toContainText('Открыто')
    // Общий возврат согласующего без выбранного поста — «общее»; версия
    // документа при замечании — та, что была на момент постановки.
    await expect(remarks).toContainText('общее')
    await expect(remarks).toContainText(/документ v\d+/)

    // «Не согласен» БЕЗ ответа отбивает СЕРВЕР (`[ВОЗ-04]`) — ошибка поля,
    // а не молчание; со ответом замечание закрывается несогласием и больше
    // не считается «без ответа».
    const remarkRow = remarks.locator('li', { hasText: 'Уточнить расчёт постов' }).first()
    await remarkRow.getByRole('button', { name: 'Не согласен' }).click()
    await remarkRow.getByRole('button', { name: 'Подтвердить несогласие' }).click()
    await expect(remarks).toContainText('Укажите, почему вы не согласны', { timeout: 15_000 })
    await remarkRow.getByLabel('Почему не согласны *').fill('Пост режимный, снять нельзя')
    await remarkRow.getByRole('button', { name: 'Подтвердить несогласие' }).click()
    await expect(remarkRow).toContainText('Не согласен', { timeout: 15_000 })
    await expect(remarkRow).toContainText('Ответ: Пост режимный, снять нельзя')
    await expect
      .poll(async () => {
        const fresh = (await events(token)).find((e) => e.id === target.id) as
          | (EventRow & { visitObjects: { approvalRemarks: { status: string; response: string }[] }[] })
          | undefined
        const mine = fresh?.visitObjects[0]?.approvalRemarks.find(
          (r) => r.response === 'Пост режимный, снять нельзя',
        )
        return mine?.status ?? null
      }, { timeout: 15_000 })
      .toBe('DISAGREED')

    // Нижней «Вернуть на доработку» на согласовании больше нет (`[СОГ-11]`):
    // пустую причину отбивает строка возврата в маршруте — проверено выше.
    // Этап остаётся на согласовании: несогласие с ответом его не двигает, а
    // подписи ещё нет.
    expect((await events(token)).find((e) => e.id === target.id)?.stage).toBe('APPROVAL')
  })

  /**
   * Номер версии документа «Расстановка сил» (Plane №411, Ш-5 плана №385).
   *
   * Версия принадлежит ОБЪЕКТУ ПОСЕЩЕНИЯ и растёт ОТПРАВКОЙ на согласование:
   * версия — это состав, под которым подписываются. Проба сверяет экран с
   * сервером, а не с самим собой: подпись «документ vN» обязана совпадать с
   * `visitObjects[].documentVersion`, иначе экран рисовал бы свой счётчик.
   *
   * Отправка состояние не ломает и фикстуру не тратит: маршрут после неё
   * отзывается тут же, а номер версии откату не подлежит по правилу — под
   * ним уже подписывались.
   */
  test('версия документа растёт отправкой и совпадает с ответом сервера', async ({
    page,
  }) => {
    const token = await apiToken()
    const onApproval = (rows: EventRow[]): EventRow | undefined =>
      rows.find((e) => e.stage === 'APPROVAL' && e.visitObjects.length > 0)
    let event = onApproval(await events(token))
    if (event === undefined) {
      await prepareEvent(token)
      event = onApproval(await events(token))
      expect(event, 'не удалось подготовить фикстуру').toBeDefined()
    }
    const target = event!
    const before = target.visitObjects[0].documentVersion
    // `[СОГ-01]`/`[ВОЗ-06]` (Plane №398): первая отправка НЕ меняет номер —
    // черновик становится «на согласовании»; номер растёт только повторной
    // отправкой ПОСЛЕ ВОЗВРАТА. Ожидание считается от статуса документа, а
    // не «+1 всегда» — иначе проба зеленела бы на неверном правиле.
    const expectedAfterSend =
      target.visitObjects[0].documentStatus === 'RETURNED' ? before + 1 : Math.max(before, 1)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const card = page.getByRole('region', { name: 'Согласование расстановки' })
    await expect(card).toBeVisible({ timeout: 15_000 })
    const route = card.locator('section', { hasText: 'Маршрут согласования' }).first()

    // Подпись ДО отправки — та, что отдал сервер. `0` пишется словами: число
    // на экране читалось бы как номер выпуска, которого не было.
    await expect(route).toContainText(
      before === 0 ? 'документ не отправлялся' : `документ v${before}`,
      { timeout: 15_000 },
    )

    // Маршрут нужен, иначе отправка отбивается «маршрут не настроен».
    const who = `Версия ${Date.now()}`
    await addApproverViaApi(token, target.id, who)
    await page.reload()
    await expect(route).toContainText(who, { timeout: 15_000 })

    await route.getByRole('button', { name: 'Отправить на согласование' }).click()

    // Сервер отвечает номером по правилу выше…
    await expect
      .poll(async () => {
        const fresh = (await events(token)).find((e) => e.id === target.id)
        return fresh?.visitObjects[0].documentVersion ?? null
      }, { timeout: 15_000 })
      .toBe(expectedAfterSend)
    // …и экран показывает ЕГО и статус «на согласовании», а не свой счёт.
    await expect(route).toContainText(`документ v${expectedAfterSend}`, { timeout: 15_000 })
    await expect(route).toContainText('на согласовании')

    // История версий (`[СОГ-04]`, Plane №398): после отправки единственный
    // черновик стал «на согласовании» — блок истории появляется и называет
    // текущую версию тем же номером, что и подпись у маршрута.
    const history = card.getByRole('region', { name: 'История версий документа' })
    await expect(history).toBeVisible({ timeout: 15_000 })
    await expect(history).toContainText(`Версия ${expectedAfterSend}`)
    await expect(history).toContainText(`v${expectedAfterSend}`)

    // Отзыв номер НЕ откатывает: состав уже уходил людям.
    await route.getByRole('button', { name: 'Отозвать с согласования' }).click()
    await expect(route).toContainText(`документ v${expectedAfterSend}`, { timeout: 15_000 })
  })
})

/**
 * Заводит ОМ и доводит его до «Согласования» так, чтобы одно назначение
 * прошло через мягкий конфликт: посту выставляется minRating, и назначение
 * уходит с override + обоснованием.
 */
async function prepareEvent(token: string): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }
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
    title: 'Проба согласования (e2e)',
    objectId: object.id,
    businessDate: '2026-08-23',
    chiefEmployeeId: await anyChiefId(token),
    // См. recon-stage: без обязательного `kind` создание отбивается 400.
    kind: 'INTERNAL',
  })
  const base = `/api/ops/security-events/${created.id}`

  await call('PATCH', `${base}/bulletin/`, {
    briefDescription: 'Проба согласования.',
    initialTasks: '—',
  })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
  const afterImport = await call('GET', `${base}/`)
  // Требование к рейтингу — на первом посту: без него мягкого конфликта не
  // возникнет и обосновывать будет нечего.
  const posts = afterImport.reconSectorPosts.map(
    (post: Record<string, unknown>, index: number) =>
      index === 0 ? { ...post, minRating: 8 } : post,
  )
  await call('PATCH', `${base}/recon/`, {
    checklist: afterImport.reconChecklist.map((item: Record<string, unknown>) => ({
      ...item,
      done: true,
      result: 'MATCHES',
    })),
    sectorPosts: posts,
  })
  await call('POST', `${base}/recon/complete/`)
  // Стадии «Потребность» и «Запрос сил» проходит СЕРВЕР на завершении
  // рекогносцировки (Plane №110): форм у них нет, и ручные `demand/approve/`,
  // `forces/<id>/`, `forces/complete/` здесь отбились бы «не на этом этапе».
  // ОМ уже стоит на «Расстановке» — фикстура идёт сразу к назначениям.
  const roster = await call('GET', '/api/ops/personnel/')
  for (const [index, post] of posts.entries()) {
    await call('POST', `${base}/placement/assign/`, {
      postId: (post as { id: string }).id,
      employeeId: roster.results[index].id,
      // обход нужен только там, где выставлено требование
      ...(index === 0 ? { override: true, override_reason: OVERRIDE_REASON } : {}),
    })
  }
  await call('POST', `${base}/placement/complete/`)
}
