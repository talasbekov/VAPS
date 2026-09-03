/**
 * Мок-слой против правил СЕРВЕРА: создание ОМ.
 *
 * Зачем отдельная спека. У мок-слоя не было прогона ВООБЩЕ, и он молча
 * разошёлся с бэком: мок требовал объект при создании ОМ, хотя сервер сделал
 * его необязательным ещё 24.08 (Plane №45). Нашлось это через несколько задач
 * и глазами — тестом найти было нечем. Мок, разошедшийся с сервером, зелен
 * там, где живой стек ведёт себя иначе, то есть перестаёт быть проверкой
 * контракта и становится его подделкой.
 *
 * Как гонять. Нужен ВТОРОЙ dev-сервер, поднятый на моке (основной стенд живой):
 *
 *   NEXT_PUBLIC_OPS_MOCK_DOMAINS=security-events,objects,access \
 *   NEXT_DIST_DIR=.next-mock npx next dev -p 3107
 *   SMOKE_MOCK_APP=http://localhost:3107 npx playwright test \
 *     -c playwright.smoke.config.ts e2e/mock-contract.spec.ts
 *
 * Свой `NEXT_DIST_DIR` обязателен: два `next dev` делят `.next` и травят
 * сборку друг друга, а `NEXT_PUBLIC_*` инлайнятся в сборку — на общем кэше
 * мок-режим уехал бы и в живой стенд.
 *
 * Без `SMOKE_MOCK_APP` проба скипается ВСЛУХ (в имени describe), а не молча:
 * тихий скип читается как зелень.
 */
import { expect, test } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const MOCK_APP = process.env.SMOKE_MOCK_APP ?? ''

test.describe(
  MOCK_APP === '' ? 'мок-слой (скип: нет SMOKE_MOCK_APP)' : 'мок-слой',
  () => {
    test.skip(MOCK_APP === '', 'нужен dev-сервер на моке: SMOKE_MOCK_APP=…')

    test('бюллетень заводится БЕЗ объекта и остаётся на бюллетене', async ({
      page,
    }) => {
      // Правило сервера (`create_event`): объект необязателен; без него
      // осматривать нечего, поэтому ОМ остаётся на «Бюллетене», а не уходит
      // на рекогносцировку, и объекта посещения у него нет.
      const api = page.context().request
      const csrf = (await (
        await api.get(`${MOCK_APP}/api/auth/csrf/`)
      ).json()) as { csrfToken: string }
      await api.post(`${MOCK_APP}/api/auth/callback/credentials/`, {
        form: {
          csrfToken: csrf.csrfToken,
          username: STAND_USERNAME,
          password: STAND_PASSWORD,
          json: 'true',
        },
      })
      await page.goto(`${MOCK_APP}/security-ops/events/`)
      await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible({
        timeout: 30_000,
      })

      const title = `Мок без объекта ${Date.now()}`
      await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Название ОМ').fill(title)
      await dialog.getByRole('button', { name: 'Внутреннее' }).click()
      await dialog.getByLabel('Дата начала').fill('2026-09-20')
      // Окончание и лицо обязательны (`[БЛН-11]`, Plane №419); лицо — из
      // мок-каталога через combobox.
      await dialog.getByLabel('Дата окончания').fill('2026-09-20')
      await dialog.getByLabel('Охраняемые лица').click()
      await page.locator('[data-slot="persons-combobox"] li button').first().click()
      await dialog.getByRole('button', { name: 'Создать бюллетень' }).click()

      // Дошли до карточки — значит мок создание ПРИНЯЛ. До правки он отбивал
      // его полем objectId «Объект не найден в реестре».
      await expect(page).toHaveURL(/\/security-ops\/events\/se-/, {
        timeout: 30_000,
      })
      const main = page.getByRole('main')
      await expect(main).toContainText(title)
      await expect(main).toContainText('Бюллетень')
    })

    test('согласование в моке требует маршрута и отправки', async ({ page }) => {
      // Правила сервера («ОМ-37.3»): внесённый в маршрут ещё НЕ на
      // согласовании, решать по неотправленному нечего, а завершение этапа
      // без решений отбивается. Пока мок этого не знал, он зеленел там, где
      // живой стек отказывает.
      const api = page.context().request
      const csrf = (await (
        await api.get(`${MOCK_APP}/api/auth/csrf/`)
      ).json()) as { csrfToken: string }
      await api.post(`${MOCK_APP}/api/auth/callback/credentials/`, {
        form: {
          csrfToken: csrf.csrfToken,
          username: STAND_USERNAME,
          password: STAND_PASSWORD,
          json: 'true',
        },
      })
      // Мок-сид держит ОМ на «Расстановке». Доводим его до согласования
      // переводом этапа — ручкой, а не кликами: предмет пробы здесь правила
      // СОГЛАСОВАНИЯ, и путь к нему не должен их заслонять. Запрос идёт ИЗ
      // СТРАНИЦЫ: перехватывает мок service worker, и запрос мимо браузера он
      // не увидит.
      await page.goto(`${MOCK_APP}/security-ops/events/se-1/`)
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 })
      await page.evaluate(async () => {
        await fetch('/api/ops/security-events/se-1/stage/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ stage: 'APPROVAL' }),
        })
      })
      await page.reload()

      const route = page
        .locator('section', { hasText: 'Маршрут согласования' })
        .first()
      await expect(route).toBeVisible({ timeout: 20_000 })
      await route.getByRole('button', { name: '+ Добавить согласующего' }).click()
      await route.getByLabel('ФИО согласующего').fill('Проба мока')
      await route.getByRole('button', { name: 'Добавить', exact: true }).click()

      const row = route.locator('tr', { hasText: 'Проба мока' }).first()
      await expect(row).toContainText('Не отправлено', { timeout: 20_000 })
      // Решения по неотправленному нет — кнопок нет.
      await expect(row.getByRole('button', { name: 'Согласовать' })).toHaveCount(0)

      // Отправлять нечего: у мок-сида этого ОМ расстановки нет. Отказ ТОТ ЖЕ,
      // что у сервера, — мок обязан отбивать в тех же местах.
      await route.getByRole('button', { name: 'Отправить на согласование' }).click()
      await expect(page.getByRole('main')).toContainText(
        'Расстановка пуста — согласовывать нечего',
        { timeout: 20_000 },
      )

      // Кнопки «Завершить этап и перейти далее» на согласовании НЕТ
      // (`[СОГ-11]`, Plane №399): этап завершается сам последней подписью, а
      // решать по неотправленному нечего — кнопок решения у строки нет
      // (проверено выше). Мок обязан рисовать тот же экран, что и сервер.
      await expect(
        page.getByRole('button', { name: 'Завершить этап и перейти далее' }),
      ).toHaveCount(0)
      await expect(page.getByRole('main')).toContainText(
        'Этап завершится сам, когда подпишут все согласующие',
        { timeout: 20_000 },
      )

      // Правка маршрута ходит по МОКУ, а не мимо него (Plane №82). Три
      // обработчика — перемещение, решение и снятие согласующего — не
      // сматчивались никогда: путь собирался хелпером, который прогоняет id
      // через encodeURIComponent, и `:approverId` превращался в
      // `%3AapproverId`. Запрос молча уходил на живой бэк, а мок-проба этого
      // не замечала. Запросы идут ИЗ СТРАНИЦЫ: их перехватывает service worker.
      const routeCalls = await page.evaluate(async () => {
        // Маршрут читается из КАРТОЧКИ: отдельной ручки GET у маршрута нет
        // ни на сервере, ни в моке — он приезжает полем мероприятия.
        const event = await (
          await fetch('/api/ops/security-events/se-1/')
        ).json()
        const approver = event.approvalRoute[event.approvalRoute.length - 1]
        const base = `/api/ops/security-events/se-1/approval/route/${approver.id}`
        const moved = await fetch(`${base}/move/`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ direction: 'UP' }),
        })
        const movedBody = await moved.json()
        const removed = await fetch(`${base}/`, { method: 'DELETE' })
        const removedBody = await removed.json()
        return {
          approverId: approver.id,
          moveStatus: moved.status,
          movedIds: (movedBody.approvalRoute ?? []).map((a: {id: string}) => a.id),
          removeStatus: removed.status,
          removedIds: (removedBody.approvalRoute ?? []).map((a: {id: string}) => a.id),
        }
      })

      // Мок ответил СВОИМ телом (маршрут целиком), а не 404 живого бэка,
      // которому идентификаторы мок-сида неизвестны.
      expect(routeCalls.moveStatus).toEqual(200)
      expect(routeCalls.movedIds).toContain(routeCalls.approverId)
      expect(routeCalls.removeStatus).toEqual(200)
      expect(routeCalls.removedIds).not.toContain(routeCalls.approverId)
    })

    test('раскладка сил в моке живёт по правилам сервера', async ({ page }) => {
      // Правила сервера (Plane №73, «СС-1»): раскладка правится только на
      // «Потребности»/«Запросе сил», сумма не может превысить потребность, а
      // один департамент не встречается дважды. Мок, не знающий этих правил,
      // зеленел бы там, где живой стек отказывает.
      const api = page.context().request
      const csrf = (await (
        await api.get(`${MOCK_APP}/api/auth/csrf/`)
      ).json()) as { csrfToken: string }
      await api.post(`${MOCK_APP}/api/auth/callback/credentials/`, {
        form: {
          csrfToken: csrf.csrfToken,
          username: STAND_USERNAME,
          password: STAND_PASSWORD,
          json: 'true',
        },
      })
      await page.goto(`${MOCK_APP}/security-ops/events/se-1/`)
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 })

      // Фикстура: доводим мок-ОМ до «Потребности» с ненулевым расчётом —
      // иначе проверка перебора прошла бы вакуумно (сравнивать не с чем).
      const prepared = await page.evaluate(async () => {
        const call = async (path: string, body?: unknown) =>
          (
            await fetch(path, {
              method: body === undefined ? 'POST' : 'POST',
              headers: { 'content-type': 'application/json' },
              body: body === undefined ? undefined : JSON.stringify(body),
            })
          ).json()
        const base = '/api/ops/security-events/se-1/'
        await call(`${base}stage/`, { stage: 'RECON' })
        await call(`${base}recon/import-from-passport/`)
        const fresh = await (await fetch(base)).json()
        await fetch(`${base}recon/`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            checklist: fresh.reconChecklist.map((item: Record<string, unknown>) => ({
              ...item,
              done: true,
              result: 'MATCHES',
            })),
            sectorPosts: fresh.reconSectorPosts.map(
              (post: Record<string, unknown>, index: number) =>
                index === 0 ? { ...post, need: 4 } : post,
            ),
          }),
        })
        return (await call(`${base}recon/complete/`)) as {
          stage: string
          forceDemandTotal: number
        }
      })
      // Мок зеркалит автопроход стадий сервера (Plane №110).
      expect(prepared.stage).toBe('PLACEMENT')
      expect(
        prepared.forceDemandTotal,
        'мок-фикстура без потребности — делить нечего',
      ).toBeGreaterThan(1)

      const outcome = await page.evaluate(async (total: number) => {
        const post = async (rows: unknown) => {
          const res = await fetch('/api/ops/security-events/se-1/forces/allocation/', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rows }),
          })
          return { status: res.status, body: await res.json() }
        }
        return {
          over: await post([{ departmentId: '2', need: total + 1 }]),
          repeated: await post([
            { departmentId: '2', need: 1 },
            { departmentId: '2', need: 1 },
          ]),
          saved: await post([{ departmentId: '2', need: total - 1 }]),
        }
      }, prepared.forceDemandTotal)

      expect(outcome.over.status).toBe(422)
      expect(outcome.over.body.error_code).toBe('ALLOCATION_OVER_DEMAND')
      expect(outcome.repeated.status).toBe(400)
      expect(outcome.repeated.body.details['rows.1.departmentId']).toBeTruthy()
      expect(outcome.saved.status).toBe(200)
      expect(outcome.saved.body.forceAllocation).toHaveLength(1)
      expect(outcome.saved.body.forceAllocation[0].status).toBe('DRAFT')
      expect(outcome.saved.body.forceAllocation[0].need).toBe(
        prepared.forceDemandTotal - 1,
      )

      // Оповещение управлений (СС-2): незнакомая заявка — 404, своя переводит
      // заявку в «оповещено», а повтор НЕ переписывает момент уже оповещённым.
      const allocationId = outcome.saved.body.forceAllocation[0].id as string
      const notified = await page.evaluate(async (id: string) => {
        const call = async (path: string) => {
          const res = await fetch(path, { method: 'POST' })
          return { status: res.status, body: await res.json() }
        }
        const base = '/api/ops/security-events/se-1/forces/allocation/'
        return {
          missing: await call(`${base}no-such-request/notify/`),
          first: await call(`${base}${id}/notify/`),
          again: await call(`${base}${id}/notify/`),
        }
      }, allocationId)

      expect(notified.missing.status).toBe(404)
      expect(notified.first.status).toBe(200)
      expect(notified.first.body.forceAllocation[0].status).toBe('NOTIFIED')
      expect(notified.first.body.forceAllocation[0].directorates.length).toBeGreaterThan(0)
      expect(notified.again.body.forceAllocation[0].directorates[0].notifiedAt).toBe(
        notified.first.body.forceAllocation[0].directorates[0].notifiedAt,
      )

      // Выделение людей (СС-3): незнакомый сотрудник — 400, второй раз тот же
      // человек — 422 с названием департамента, снятие убирает строку.
      const members = await page.evaluate(async (id: string) => {
        const base = `/api/ops/security-events/se-1/forces/allocation/${id}/members/`
        const post = async (employeeId: string) => {
          const res = await fetch(base, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ employeeId }),
          })
          return { status: res.status, body: await res.json() }
        }
        const roster = await (await fetch('/api/ops/personnel/?page=1&page_size=1')).json()
        const employeeId = roster.results[0].id as string
        const added = await post(employeeId)
        const twice = await post(employeeId)
        const unknown = await post('no-such-employee')
        const removed = await fetch(`${base}${employeeId}/`, { method: 'DELETE' })
        return {
          employeeId,
          added,
          twice,
          unknown,
          removed: { status: removed.status, body: await removed.json() },
        }
      }, allocationId)

      expect(members.added.status).toBe(200)
      expect(members.added.body.forceAllocation[0].members).toHaveLength(1)
      expect(members.twice.status).toBe(422)
      expect(members.twice.body.error_code).toBe('DOUBLE_ASSIGNMENT')
      expect(members.unknown.status).toBe(400)
      expect(members.removed.status).toBe(200)
      expect(members.removed.body.forceAllocation[0].members).toHaveLength(0)

      // Отправка списка (СС-4): пустой список не отправляется, а отправленный
      // отзывается ровно один раз.
      const submitted = await page.evaluate(
        async ({ id, employeeId }: { id: string; employeeId: string }) => {
          const base = `/api/ops/security-events/se-1/forces/allocation/${id}/`
          const post = async (path: string) => {
            const res = await fetch(`${base}${path}`, { method: 'POST' })
            return { status: res.status, body: await res.json() }
          }
          const empty = await post('submit/')
          await fetch(`${base}members/`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ employeeId }),
          })
          return {
            empty,
            ok: await post('submit/'),
            withdrawn: await post('withdraw/'),
            again: await post('withdraw/'),
          }
        },
        { id: allocationId, employeeId: members.employeeId },
      )

      expect(submitted.empty.status).toBe(422)
      expect(submitted.empty.body.error_code).toBe('ALLOCATION_EMPTY')
      expect(submitted.ok.body.forceAllocation[0].status).toBe('SUBMITTED')
      expect(submitted.ok.body.forceAllocation[0].submittedAt).not.toBeNull()
      expect(submitted.withdrawn.body.forceAllocation[0].status).toBe('NOTIFIED')
      expect(submitted.again.status).toBe(422)
      expect(submitted.again.body.error_code).toBe('ALLOCATION_NOT_WITHDRAWABLE')

      // Решение штаба (СС-5): возврат без причины — 400, приёмка отдаёт людей
      // в состав и повторная приёмка его не удваивает.
      const decided = await page.evaluate(async (id: string) => {
        const base = `/api/ops/security-events/se-1/forces/allocation/${id}/`
        const post = async (path: string, body?: unknown) => {
          const res = await fetch(`${base}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
          return { status: res.status, body: await res.json() }
        }
        await post('submit/')
        const noReason = await post('return/', {})
        const returned = await post('return/', { reason: 'Нужны люди с допуском' })
        await post('submit/')
        const accepted = await post('accept/')
        return { noReason, returned, accepted }
      }, allocationId)

      expect(decided.noReason.status).toBe(400)
      expect(decided.returned.body.forceAllocation[0].status).toBe('RETURNED')
      expect(decided.returned.body.forceAllocation[0].decisionComment).toBe(
        'Нужны люди с допуском',
      )
      expect(decided.accepted.body.forceAllocation[0].status).toBe('ACCEPTED')
      expect(decided.accepted.body.forceRoster).toHaveLength(1)

      // Расстановка (СС-6): у ОМ с составом посторонний на пост не встаёт, а
      // принятый — встаёт. Без второй половины проба доказывала бы лишь, что
      // расстановка сломана.
      const placed = await page.evaluate(async (rosterId: string) => {
        const fresh = await (await fetch('/api/ops/security-events/se-1/')).json()
        const postId = fresh.reconSectorPosts[0]?.id
        const roster = await (await fetch('/api/ops/personnel/?page=1&page_size=5')).json()
        const stranger = roster.results.find((row: any) => row.id !== rosterId)
        const assign = async (employeeId: string) => {
          const res = await fetch('/api/ops/security-events/se-1/placement/assign/', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ postId, employeeId, override: true, override_reason: 'проба' }),
          })
          return { status: res.status, body: await res.json() }
        }
        return { postId, outsider: await assign(stranger.id), member: await assign(rosterId) }
      }, members.employeeId)

      expect(placed.postId, 'у мок-ОМ нет постов — расстановку проверять негде').toBeTruthy()
      expect(placed.outsider.status).toBe(422)
      expect(placed.outsider.body.error_code).toBe('NOT_IN_ROSTER')
      expect(placed.member.status).toBe(200)

      // Р-1: строка назначения несёт подразделение и статус дня. Тип
      // проверяется строго — `not.toBe('')` прошёл бы на `undefined`, то есть
      // ровно на моке, который этих полей не отдаёт.
      const row = placed.member.body.placementAssignments.at(-1)
      expect(typeof row.divisionName).toBe('string')
      expect(row.divisionName).not.toBe('')
      expect(row).toHaveProperty('statusCode')
      expect(row).toHaveProperty('statusLabel')

      // Р-2: статус в кадровом снимке — только на СПРОШЕННУЮ дату; без неё
      // мок молчит, как и сервер. Обе половины обязательны: без первой проба
      // доказывала бы, что статусов нет вовсе.
      const personnel = await page.evaluate(async () => {
        const one = async (query: string) =>
          (await (await fetch(`/api/ops/personnel/?page=1&page_size=10${query}`)).json())
            .results
        return {
          bare: await one(''),
          dated: await one('&business_date=2026-08-10'),
        }
      })
      expect(personnel.bare.every((r: any) => r.statusCode === null)).toBe(true)
      expect(personnel.dated.some((r: any) => r.statusCode !== null)).toBe(true)

      // Р-4: старший сектора в моке — один, как у сервера.
      const senior = await page.evaluate(async (assignmentId: string) => {
        const call = async () =>
          (
            await fetch(
              `/api/ops/security-events/se-1/placement/${encodeURIComponent(assignmentId)}/senior/`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ senior: true }),
              },
            )
          ).json()
        const set = await call()
        const cleared = await (
          await fetch(
            `/api/ops/security-events/se-1/placement/${encodeURIComponent(assignmentId)}/senior/`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ senior: false }),
            },
          )
        ).json()
        return { set, cleared }
      }, placed.member.body.placementAssignments.at(-1).id)

      expect(
        senior.set.placementAssignments.filter((a: any) => a.isSectorSenior),
      ).toHaveLength(1)
      expect(
        senior.cleared.placementAssignments.filter((a: any) => a.isSectorSenior),
      ).toHaveLength(0)
    })

    test('раздел доступа в моке живёт по правилам сервера', async ({ page }) => {
      // Правила сервера (шаги «П-2»…«П-5»): удаления учётки нет вовсе,
      // временный пароль приходит один раз при заведении, повторная выдача
      // той же роли в той же области второго назначения не заводит. Мок,
      // разрешающий больше живого, зеленил бы экраны там, где живой стек
      // отказывает, — ровно та яма, ради которой эта спека и заведена.
      const api = page.context().request
      const csrf = (await (
        await api.get(`${MOCK_APP}/api/auth/csrf/`)
      ).json()) as { csrfToken: string }
      await api.post(`${MOCK_APP}/api/auth/callback/credentials/`, {
        form: {
          csrfToken: csrf.csrfToken,
          username: STAND_USERNAME,
          password: STAND_PASSWORD,
          json: 'true',
        },
      })

      await page.goto(`${MOCK_APP}/settings/users/`)
      await expect(
        page.getByRole('heading', { name: 'Пользователи', exact: true }),
      ).toBeVisible({ timeout: 30_000 })

      await page.getByRole('button', { name: 'Завести учётку' }).click()
      // Логин ПОСТОЯННЫЙ, а не уникальный на прогон: если мок вдруг не
      // перехватит (так уже было — на /settings/* он не стартовал вовсе),
      // уникальное имя заводило бы на живом стенде по учётке за прогон, а
      // удаления учёток в API нет. Стор мока живёт в памяти вкладки и на
      // каждый переход обнуляется, так что повтора имени в моке не бывает.
      await page.getByLabel('Логин').fill('mock_probe_account')
      await page.getByRole('button', { name: 'Завести', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Временный пароль' })).toBeVisible()
      const shown = (await page.locator('code.select-all').innerText()).trim()
      expect(shown.length).toBeGreaterThan(7)
      await page.getByRole('button', { name: 'Закрыть', exact: true }).first().click()

      // Запросы идут ИЗ СТРАНИЦЫ: перехватывает service worker, запрос мимо
      // браузера мок не увидит.
      const rules = await page.evaluate(async () => {
        const deleted = await fetch('/api/operations/accounts/1/', { method: 'DELETE' })
        const passwordPatch = await fetch('/api/operations/accounts/1/', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'whatever-123' }),
        })
        const body = { user_id: '3', role_code: 'OBSERVER', scope_division_id: null }
        const post = async () =>
          fetch('/api/operations/user-roles/', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
        const first = (await (await post()).json()) as { id: number }
        const second = (await (await post()).json()) as { id: number }
        const listed = (await (
          await fetch('/api/operations/user-roles/?user_id=3')
        ).json()) as { results: Array<{ role_code: string; is_active: boolean }> }
        return {
          deleteStatus: deleted.status,
          passwordPatchStatus: passwordPatch.status,
          sameAssignment: first.id === second.id,
          observerRows: listed.results.filter(
            (row) => row.role_code === 'OBSERVER' && row.is_active,
          ).length,
        }
      })

      expect(rules.deleteStatus).toEqual(405)
      expect(rules.passwordPatchStatus).toEqual(400)
      expect(rules.sameAssignment).toBe(true)
      expect(rules.observerRows).toEqual(1)
    })
  },
)
