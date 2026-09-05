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

      // Согласующий — ручкой мока, а не кнопкой: с №429/№446 маршрут задаётся
      // в настройках, и «+ Добавить согласующего» на объекте нет. Сначала
      // дождаться экрана: сразу после перезагрузки страница ещё не включила
      // MSW, service worker пропускает запрос в сеть — и ручка отвечает 403
      // живого бэка вместо мока (замерено 04.09.2026).
      await expect(
        page.locator('section', { hasText: 'Маршрут согласования' }).first()
      ).toBeVisible({ timeout: 30_000 })
      const added = await page.evaluate(async () => {
        const res = await fetch('/api/ops/security-events/se-1/approval/route/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Проба мока', unit: '', position: '' }),
        })
        return { status: res.status, body: (await res.text()).slice(0, 200) }
      })
      expect(added.status, added.body).toBe(200)
      await page.reload()
      const route = page
        .locator('section', { hasText: 'Маршрут согласования' })
        .first()
      await expect(route).toBeVisible({ timeout: 20_000 })

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
        // Подписывает ПЕРВЫЙ по порядку, второй остаётся ждать.
        const approver = event.approvalRoute[0]
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

      // Усиление сверх расчёта (Plane №414): пока расчёт поста НЕ исчерпан,
      // назначение проходит молча; как только мест не осталось — мок обязан
      // встретить его тем же мягким конфликтом, что и сервер. Обе половины
      // обязательны: без первой проба доказывала бы, что расстановка сломана
      // вообще, а не что гард считает расчёт.
      const overNeed = await page.evaluate(
        async ([postId, employeeId]: [string, string]) => {
          const assign = async (withReason: boolean) => {
            const res = await fetch('/api/ops/security-events/se-1/placement/assign/', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(
                withReason
                  ? { postId, employeeId, override: true, override_reason: 'добор до расчёта' }
                  : { postId, employeeId },
              ),
            })
            return { status: res.status, body: await res.json() }
          }
          const state = async () => {
            const fresh = await (await fetch('/api/ops/security-events/se-1/')).json()
            const post = fresh.reconSectorPosts.find((p: any) => p.id === postId)
            return {
              need: Number(post?.need ?? 0),
              taken: fresh.placementAssignments.filter((a: any) => a.postId === postId).length,
            }
          }
          const before = await state()
          // Внутри расчёта — тихо: место в запасе ещё есть.
          const within = before.taken < before.need ? await assign(false) : null
          // Добираем пост до расчёта, чтобы упереться в границу.
          for (let guard = 0; guard < 20; guard += 1) {
            const now = await state()
            if (now.taken >= now.need) break
            await assign(true)
          }
          const filled = await state()
          return { within, filled, over: await assign(false) }
        },
        [placed.postId, members.employeeId] as [string, string],
      )

      expect(overNeed.within?.status, 'место в расчёте есть — гард молчать обязан').toBe(200)
      expect(overNeed.filled.taken).toBeGreaterThanOrEqual(overNeed.filled.need)
      expect(overNeed.over.status).toBe(409)
      expect(overNeed.over.body.error_code).toBe('SOFT_CONFLICT_DETECTED')
      // 🔴 АССЕРТ ВЕРНУЛСЯ (Plane №523). Здесь стояло «`overridable` в конверте
      // мока НЕТ и не было … здесь не проверяется» — то самое место, где
      // расхождение конверта с сервером пришлось обойти комментарием. Сервер
      // кладёт этот флаг в мягкий 409, потому что признак «можно повторить с
      // причиной» несёт САМ ОТВЕТ, а не код: клиент сегодня решает по коду,
      // но как только начнёт читать флаг — мок-режим молча перестал бы
      // открывать окно обоснования.
      expect(
        overNeed.over.body.overridable,
        'мягкий конфликт мока не помечен обходимым — конверт разошёлся с сервером',
      ).toBe(true)
      expect(
        overNeed.over.body.details.conflicts.map((c: any) => c.conflict_code),
      ).toContain('OVER_NEED')

      // ПЕРЕНОС — ОДНА ОПЕРАЦИЯ (Plane №762). Мок обязан повторить ровно три
      // отличия ручки переноса от ручки назначения, иначе экран в мок-режиме
      // зелен там, где на живом стенде открывается окно обоснования:
      // 1) счёт поста-приёмника ИСКЛЮЧАЕТ переносимого — поэтому смена роли
      //    на СВОЁМ посту не считается усилением и проходит молча;
      // 2) укомплектованный чужой пост встречает переносящего тем же 409
      //    `OVER_NEED`;
      // 3) идентификатор назначения СОХРАНЯЕТСЯ: это перенос, а не «удалили и
      //    завели заново».
      const movedRow = await page.evaluate(
        async ([filledPostId, employeeId]: [string, string]) => {
          const fresh = await (await fetch('/api/ops/security-events/se-1/')).json()
          const mine = fresh.placementAssignments.find(
            (a: any) => a.employeeId === employeeId,
          )
          const move = async (postId: string, body: Record<string, unknown> = {}) => {
            const res = await fetch(
              `/api/ops/security-events/se-1/placement/${encodeURIComponent(mine.id)}/move/`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ postId, ...body }),
              },
            )
            return { status: res.status, body: await res.json() }
          }
          const other = fresh.reconSectorPosts.find((p: any) => p.id !== mine.postId)
          return {
            assignmentId: mine.id,
            samePost: await move(mine.postId, { roleCode: 'SENIOR' }),
            ontoFilled: other === undefined ? null : await move(filledPostId),
            hasOther: other !== undefined,
          }
        },
        [placed.postId, members.employeeId] as [string, string],
      )

      // Смена роли на своём посту усилением не является — счёт исключает
      // самого переносимого.
      expect(
        movedRow.samePost.status,
        'перенос на СВОЙ пост считает переносимого дважды и просит обоснование',
      ).toBe(200)
      const afterMove = movedRow.samePost.body.placementAssignments.find(
        (a: any) => a.id === movedRow.assignmentId,
      )
      expect(afterMove, 'идентификатор назначения переносом менять нельзя').toBeTruthy()
      expect(afterMove.roleCode).toBe('SENIOR')
      // Отметка ознакомления и старшинство относились к покинутому посту.
      expect(afterMove.acknowledgedAt).toBeNull()
      expect(afterMove.isSectorSenior).toBe(false)

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

    test('сводка закрытия в моке считается, а не лежит нулями', async ({
      page,
    }) => {
      // Правило сервера (`serializers._closure_summary`): «Постов N ·
      // назначено K из N · замен · отказов · инцидентов» СЧИТАЕТСЯ на выдаче.
      // В моке оба вхождения поля были литералами внутри `emptyEvent`, и
      // больше его не писало ничто (Plane №728): заголовок задачи на
      // мок-стенде всегда читался нулями — даже после импорта постов,
      // назначения людей и записи инцидентов собственными обработчиками мока.
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

      const measured = await page.evaluate(async () => {
        const read = async () =>
          (await (await fetch('/api/ops/security-events/se-1/')).json()) as {
            reconSectorPosts: { id: string; need: number }[]
            placementAssignments: { postId: string }[]
            journalEntries: { type: string }[]
            closureSummary: { posts: number; need: number; assigned: number; incidents: number }
          }
        // Посты в мок-сиде не заведены — импортируем их из паспорта той же
        // ручкой мока, которой пользуется экран. Без постов проба сравнивала
        // бы ноль с нулём и зеленела бы при живом дефекте.
        //
        // Этап сначала переводится на «Рекогносцировку»: мок отбивает импорт
        // вне этого этапа (`RECON_STAGE_REQUIRED`) — то же правило, что у
        // сервера, и обходить его пробе незачем.
        const setStage = async (stage: string) =>
          fetch('/api/ops/security-events/se-1/stage/', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stage }),
          })
        await setStage('RECON')
        await fetch('/api/ops/security-events/se-1/recon/import-from-passport/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
        const before = await read()
        // Инцидент пишется РУЧКОЙ мока: предмет пробы — что сводка считается,
        // а не как выглядит форма.
        await setStage('CONDUCT')
        await fetch('/api/ops/security-events/se-1/journal/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'INCIDENT',
            title: 'Проба сводки',
            description: '',
          }),
        })
        const after = await read()
        return {
          posts: after.reconSectorPosts.length,
          need: after.reconSectorPosts.reduce((s, p) => s + (p.need ?? 0), 0),
          assigned: after.placementAssignments.length,
          incidentsBefore: before.closureSummary.incidents,
          summary: after.closureSummary,
        }
      })

      // Сводка равна тому, что лежит в самом ОМ, — а не нулям.
      expect(measured.posts).toBeGreaterThan(0)
      expect(measured.summary.posts).toEqual(measured.posts)
      expect(measured.summary.need).toEqual(measured.need)
      expect(measured.summary.assigned).toEqual(measured.assigned)
      // И она ЖИВАЯ: записанный инцидент в неё попал.
      expect(measured.summary.incidents).toEqual(measured.incidentsBefore + 1)
    })

    test('отзыв согласования в моке отбивается после первой подписи', async ({
      page,
    }) => {
      // Правило сервера `[СОГ-07]`: «Отозвать» доступна, пока никто не
      // подписал — подпись есть факт под составом, и отзыв после неё был бы
      // переписыванием. Мок проверял только этап и молча отвечал 200 даже с
      // APPROVED в маршруте (Plane №717): экран под мок-режимом вёл себя
      // иначе, чем в бою, и мок-проба регресс `[СОГ-07]` поймать не могла.
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

      const result = await page.evaluate(async () => {
        const post = (url: string, body?: unknown) =>
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
        // Путь к состоянию: отправка требует НЕПУСТОЙ расстановки
        // (`PLACEMENT_EMPTY`), а мок-сид постов не заводит. Поэтому сперва
        // рекогносцировка с импортом из паспорта и назначение людей — теми же
        // ручками мока, что и экран.
        await post('/api/ops/security-events/se-1/stage/', { stage: 'RECON' })
        await post(
          '/api/ops/security-events/se-1/recon/import-from-passport/',
          {},
        )
        const withPosts = await (
          await fetch('/api/ops/security-events/se-1/')
        ).json()
        const roster = await (await fetch('/api/ops/personnel/?page_size=50')).json()
        for (const [index, p0] of withPosts.reconSectorPosts.entries()) {
          await post('/api/ops/security-events/se-1/placement/assign/', {
            postId: p0.id,
            employeeId: roster.results[index].id,
          })
        }
        await post('/api/ops/security-events/se-1/stage/', { stage: 'APPROVAL' })
        // СОГЛАСУЮЩИХ ДВОЕ, и это не украшение: последняя подпись завершает
        // этап (`[СОГ-09]`), и с одним подписавшим ОМ уходит с «Согласования»
        // — отзыв тогда отбивается стадией, а не правилом `[СОГ-07]`, и
        // проба сторожила бы не то. Со вторым, ждущим решения, этап остаётся
        // на месте, и предметом отказа становится именно подпись.
        for (const name of ['Подписавший (проба №717)', 'Ждущий (проба №717)']) {
          await post('/api/ops/security-events/se-1/approval/route/', {
            name,
            employeeId: '1',
            position: 'Начальник',
          })
        }
        const sent = await post('/api/ops/security-events/se-1/approval/send/')
        const sentBody = await sent.text()
        const event = await (
          await fetch('/api/ops/security-events/se-1/')
        ).json()
        const approver = event.approvalRoute[event.approvalRoute.length - 1]
        // Подпись ставится ручкой мока — предмет пробы отзыв, а не путь к нему.
        const signed = await post(
          `/api/ops/security-events/se-1/approval/route/${approver.id}/decide/`,
          { decision: 'APPROVED', comment: '' },
        )
        const withdrawn = await post(
          '/api/ops/security-events/se-1/approval/withdraw/',
        )
        return {
          sendStatus: sent.status,
          sendBody: sentBody.slice(0, 200),
          approverStatus: approver.status,
          signStatus: signed.status,
          withdrawStatus: withdrawn.status,
          withdrawBody: await withdrawn.text(),
        }
      })

      expect(
        result.signStatus,
        `подпись обязана пройти; send=${result.sendStatus} ${result.sendBody}; статус согласующего=${result.approverStatus}`,
      ).toEqual(200)
      // Отказ мока — тот же код и тот же смысл, что у сервера.
      expect(result.withdrawStatus).toEqual(422)
      expect(result.withdrawBody).toContain('APPROVAL_WITHDRAW_AFTER_SIGN')
    })

    test('мок разрешает замену и на «Ознакомлении» (Plane №500)', async ({ page }) => {
      // Правило сервера с №432 `[ОЗН-03]`: «отказавшийся заменяется там, где
      // отказ виден, а не после перехода на „Проведение“». Кнопка «Заменить
      // →» на экране ознакомления уже есть, а мок отбивал её этапом — то есть
      // мок-проба была зелена над поведением, которого в бою нет.
      const api = page.context().request
      const csrf = (await (await api.get(`${MOCK_APP}/api/auth/csrf/`)).json()) as {
        csrfToken: string
      }
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

      const result = await page.evaluate(async () => {
        const post = (url: string, body?: unknown) =>
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
        await post('/api/ops/security-events/se-1/stage/', { stage: 'RECON' })
        await post('/api/ops/security-events/se-1/recon/import-from-passport/', {})
        const withPosts = await (await fetch('/api/ops/security-events/se-1/')).json()
        const roster = await (await fetch('/api/ops/personnel/?page_size=50')).json()
        for (const [index, p0] of withPosts.reconSectorPosts.entries()) {
          await post('/api/ops/security-events/se-1/placement/assign/', {
            postId: p0.id,
            employeeId: roster.results[index].id,
          })
        }
        // 🔴 ПОРЯДОК: сначала ГРАНИЦА, потом предмет. Мок (как и сервер) не
        // пускает этап назад, и проверить «на „Расстановке“ замены нет»
        // после перехода на «Ознакомление» нельзя вовсе.
        //
        // Граница проверяется НА «РАССТАНОВКЕ» — том этапе, откуда человек и
        // жмёт «Заменить →» раньше времени. Раньше здесь стояла
        // «Рекогносцировка» в обход: у мока не было `PLACEMENT` в карте
        // этапов ручки `stage/`, и перевести туда напрямую было нельзя
        // (Plane №791). Теперь карта — зеркало `STAGE_OVERRIDE_TARGETS`
        // сервера, и обход не нужен. Правило одно: замена разрешена ТОЛЬКО
        // на «Ознакомлении» и «Проведении».
        await post('/api/ops/security-events/se-1/stage/', { stage: 'PLACEMENT' })
        const onPlacement = await (await fetch('/api/ops/security-events/se-1/')).json()
        const spare0 = (await (
          await fetch('/api/ops/personnel/?page_size=50')
        ).json()).results.find(
          (person: { id: string }) =>
            !onPlacement.placementAssignments.some(
              (a: { employeeId: string }) => a.employeeId === person.id,
            ),
        )
        const refused = await post('/api/ops/security-events/se-1/conduct/replace/', {
          assignmentId: onPlacement.placementAssignments[0].id,
          incomingEmployeeId: spare0.id,
          reasonCode: 'ILLNESS',
        })

        // Этап ставится прямо: предмет пробы — правило замены, а не путь.
        await post('/api/ops/security-events/se-1/stage/', { stage: 'ACKNOWLEDGEMENT' })
        const staged = await (await fetch('/api/ops/security-events/se-1/')).json()
        const outgoing = staged.placementAssignments[0]
        const incoming = roster.results.find(
          (person: { id: string }) =>
            !staged.placementAssignments.some(
              (a: { employeeId: string }) => a.employeeId === person.id,
            ),
        )
        const replaced = await post('/api/ops/security-events/se-1/conduct/replace/', {
          assignmentId: outgoing.id,
          incomingEmployeeId: incoming.id,
          reasonCode: 'ILLNESS',
        })
        return {
          stage: staged.stage,
          replaceStatus: replaced.status,
          replaceBody: (await replaced.text()).slice(0, 200),
          borderStage: onPlacement.stage,
          refusedStatus: refused.status,
          refusedBody: (await refused.text()).slice(0, 200),
        }
      })

      expect(result.stage, 'этап не встал на «Ознакомление» — проба вакуумна').toEqual(
        'ACKNOWLEDGEMENT',
      )
      expect(
        result.replaceStatus,
        `замена на «Ознакомлении» отбита моком: ${result.replaceBody}`,
      ).toEqual(200)
      // На «Расстановке» замены нет и у сервера — граница осталась границей:
      // правило не снято, а выправлено.
      // Гвард: если этап не встал, проверять границу нечем, и «отказа не
      // было» означало бы не то.
      expect(
        result.borderStage,
        'ОМ не на «Расстановке» — граница не проверена',
      ).toEqual('PLACEMENT')
      expect(result.refusedStatus).toEqual(422)
      expect(result.refusedBody).toContain('INVALID_STAGE_TRANSITION')
    })

    test('срочность замечания в моке считается по календарю и по настройке (Plane №504)', async ({
      page,
    }) => {
      // Сервер сравнивает КАЛЕНДАРНЫЕ ДАТЫ (`(business_date −
      // Clock.today_local()).days`) и читает порог из настроек
      // (`APPROVAL.RETURN_URGENT_DAYS`). Мок вычитал «сейчас» из полуночи UTC
      // и округлял, а порог держал числом 1: у ОМ ЧЕРЕЗ ДВА КАЛЕНДАРНЫХ ДНЯ
      // после полудня выходила единица — мок ставил «Срочно», сервер нет.
      //
      // 🔴 ДАТА ЗАДАЁТСЯ ПРИ СОЗДАНИИ, а не правится: менять `businessDate`
      // мок не умеет ни одной ручкой, а на дате `se-1` (сегодня) обе формулы
      // дают ноль и проба была бы вакуумной.
      const api = page.context().request
      const csrf = (await (await api.get(`${MOCK_APP}/api/auth/csrf/`)).json()) as {
        csrfToken: string
      }
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

      const result = await page.evaluate(async () => {
        const post = (url: string, body?: unknown) =>
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
        const plusDays = (days: number) => {
          const d = new Date()
          d.setDate(d.getDate() + days)
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
            d.getDate(),
          ).padStart(2, '0')}`
        }
        const objectsRes = await fetch('/api/ops/security-events/bindable-objects/')
        const objectsText = await objectsRes.text()
        const objects = JSON.parse(objectsText) as {
          results?: { id: string; publishedVersionCount: number }[]
        }
        const object = (objects.results ?? []).find((o) => o.publishedVersionCount > 0)
        const rosterRes = await fetch('/api/ops/personnel/?page_size=50')
        const rosterText = await rosterRes.text()
        const roster = JSON.parse(rosterText) as { results?: { id: string }[] }
        if (object === undefined || (roster.results ?? []).length === 0) {
          return {
            broken: `объекты ${objectsRes.status} ${objectsText.slice(0, 120)}; ` +
              `состав ${rosterRes.status} ${rosterText.slice(0, 120)}`,
          }
        }

        const urgencyFor = async (businessDate: string) => {
          const created = await (
            await post('/api/ops/security-events/', {
              title: `Срочность (проба №504) ${businessDate}`,
              objectId: object.id,
              businessDate,
              businessDateEnd: businessDate,
              kind: 'INTERNAL',
            })
          ).json()
          const id = created.id
          const base = `/api/ops/security-events/${id}`
          await post(`${base}/recon/import-from-passport/`, {})
          const withPosts = await (await fetch(`${base}/`)).json()
          for (const [index, p0] of withPosts.reconSectorPosts.entries()) {
            await post(`${base}/placement/assign/`, {
              postId: p0.id,
              employeeId: roster.results![index].id,
            })
          }
          await post(`${base}/stage/`, { stage: 'APPROVAL' })
          await post(`${base}/approval/route/`, {
            name: 'Согласующий (проба №504)',
            employeeId: '1',
            position: 'Начальник',
          })
          await post(`${base}/approval/send/`)
          const sent = await (await fetch(`${base}/`)).json()
          const approver = sent.approvalRoute[sent.approvalRoute.length - 1]
          await post(`${base}/approval/route/${approver.id}/decide/`, {
            decision: 'RETURNED',
            comment: `Замечание на ${businessDate}`,
          })
          const after = await (await fetch(`${base}/`)).json()
          const last = after.approvalRemarks[after.approvalRemarks.length - 1]
          return {
            urgent: last?.urgent as boolean | undefined,
            businessDate: after.businessDate as string,
            remarks: after.approvalRemarks.length as number,
          }
        }
        return {
          broken: null as string | null,
          far: await urgencyFor(plusDays(2)),
          near: await urgencyFor(plusDays(1)),
        }
      })

      expect(result.broken ?? null, `фикстура мока не собралась: ${result.broken}`).toBeNull()
      expect(result.far!.remarks, 'замечание не завелось — проверять нечего').toBeGreaterThan(0)
      expect(
        result.far!.urgent,
        `ОМ через два календарных дня объявлен срочным (дата ${result.far!.businessDate})`,
      ).toBe(false)
      expect(
        result.near!.urgent,
        `ОМ на завтра не объявлен срочным при пороге «сутки» (дата ${result.near!.businessDate})`,
      ).toBe(true)
    })

    test('мок знает про отказ заступить и «мои назначения» (Plane №592)', async ({
      page,
    }) => {
      // Обработчиков не было ВОВСЕ: `decline/` проваливался мимо мока, а
      // `my-assignments/` съедал обработчик детали `security-events/:id/` с
      // `id = "my-assignments"` — вкладки профиля «Охранные мероприятия» и
      // «История» на мок-стенде всегда рисовали карточку отказа.
      const api = page.context().request
      const csrf = (await (await api.get(`${MOCK_APP}/api/auth/csrf/`)).json()) as {
        csrfToken: string
      }
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

      const result = await page.evaluate(async () => {
        const post = (url: string, body?: unknown) =>
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
        await post('/api/ops/security-events/se-1/stage/', { stage: 'RECON' })
        await post('/api/ops/security-events/se-1/recon/import-from-passport/', {})
        const withPosts = await (await fetch('/api/ops/security-events/se-1/')).json()
        const roster = await (await fetch('/api/ops/personnel/?page_size=50')).json()
        for (const [index, p0] of withPosts.reconSectorPosts.entries()) {
          if (
            withPosts.placementAssignments.some(
              (a: { postId: string }) => a.postId === p0.id,
            )
          )
            continue
          await post('/api/ops/security-events/se-1/placement/assign/', {
            postId: p0.id,
            employeeId: roster.results[index].id,
          })
        }
        const staged = await (await fetch('/api/ops/security-events/se-1/')).json()
        const assignment = staged.placementAssignments[0]
        const path = `/api/ops/security-events/se-1/decline/${assignment.id}/`

        // Пустая причина отбивается — правило сервера, а не «лишь бы 200».
        const empty = await post(path, { reason: '   ' })
        const declined = await post(path, { reason: 'Командировка по приказу' })
        const afterDecline = await (await fetch('/api/ops/security-events/se-1/')).json()
        const declinedRow = afterDecline.placementAssignments.find(
          (a: { id: string }) => a.id === assignment.id,
        )
        // Подтверждение СНИМАЕТ отказ — обе отметки взаимоисключающи.
        await post(`/api/ops/security-events/se-1/acknowledge/${assignment.id}/`, {})
        const afterAck = await (await fetch('/api/ops/security-events/se-1/')).json()
        const ackRow = afterAck.placementAssignments.find(
          (a: { id: string }) => a.id === assignment.id,
        )

        const mineRes = await fetch('/api/ops/security-events/my-assignments/')
        const mineText = await mineRes.text()
        return {
          emptyStatus: empty.status,
          declineStatus: declined.status,
          declinedAt: declinedRow.declinedAt as string | null,
          declineReason: declinedRow.declineReason as string | null,
          ackClearedDecline: ackRow.declinedAt === null && ackRow.declineReason === null,
          mineStatus: mineRes.status,
          mineHead: mineText.slice(0, 160),
          mineCount: (JSON.parse(mineText).results ?? []).length as number,
          // Способ и автор ОТКАЗА (Plane №588, показ — №796): сервер пишет
          // их той же мутацией, что и причину (`my_assignments.decline`).
          declinedVia: declinedRow.declinedVia as string | undefined,
          declinedBy: declinedRow.declinedBy as string | undefined,
        }
      })

      expect(result.emptyStatus, 'пустая причина принята').toEqual(400)
      expect(result.declineStatus, 'отказ не прошёл').toEqual(200)
      expect(result.declinedAt).not.toBeNull()
      expect(result.declineReason).toEqual('Командировка по приказу')
      expect(
        result.ackClearedDecline,
        'подтверждение оставило отказ — карточка показала бы обе отметки разом',
      ).toBe(true)
      expect(
        result.mineStatus,
        `«мои назначения» в моке недостижимы: ${result.mineHead}`,
      ).toEqual(200)
      expect(result.mineCount, 'список «моих назначений» пуст').toBeGreaterThan(0)
      // 🔴 СПОСОБ ОТКАЗА ЕСТЬ И ОН «САМ» (Plane №796). Полей не было вовсе, и
      // `declinedVia` приезжал пустым: карточка профиля в мок-режиме не могла
      // показать «записал: …» НИКОГДА. Ожидается именно `self`: у мока
      // учётных записей нет, доказать чужую строку нечем — то же правило, по
      // которому подтверждение в моке пишется «сам» (№542).
      expect(
        result.declinedVia,
        'мок не пишет способ отказа — «записал: …» в мок-режиме недостижимо',
      ).toEqual('self')
      expect(result.declinedBy, 'у собственного отказа появился автор').toEqual('')
    })

    /**
     * Мок-слой ПАНЕЛИ ОЦЕНОК (`[ЗАК-05]`, Plane №775; правила — №433).
     *
     * Слов «оценк» и «evaluation» в этом файле не было вовсе: обработчики
     * `.../evaluations/` и `.../evaluations/all/` не проверялись ничем, и весь
     * этап «Проведение» мог разойтись с сервером молча. Так и жила зашитая
     * пустая строка `divisionName` (№643): клиент прячет подпись «· управление»
     * при пустой строке, и ни одна проба по моку не могла поймать, что живая
     * ручка не отдаёт её никогда.
     *
     * 🔴 ПРОВЕРЯЮТСЯ ПРАВИЛА, А НЕ КОДЫ ОТВЕТА. Мок ценен ровно тем, чем
     * повторяет сервер: состав строки, счёт «оценено K из N», шкала 1-10,
     * снятие оценки, и главное — «Всем 10» НЕ ТРОГАЕТ поставленное вручную
     * (`conduct_evaluations.score_all`). Последнее и есть то, ради чего кнопка
     * существует: она добивает неоценённых, а не переписывает чужую работу.
     */
    test('мок панели оценок живёт по правилам сервера (Plane №775)', async ({
      page,
    }) => {
      const api = page.context().request
      const csrf = (await (await api.get(`${MOCK_APP}/api/auth/csrf/`)).json()) as {
        csrfToken: string
      }
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

      const result = await page.evaluate(async () => {
        const post = (url: string, body?: unknown) =>
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
        const read = async () =>
          (await (await fetch('/api/ops/security-events/se-1/')).json()) as {
            visitObjects: { id: string }[]
            reconSectorPosts: { id: string }[]
            placementAssignments: { id: string; postId: string }[]
          }

        // Посты в мок-сиде не заведены — импортируем той же ручкой, что и
        // экран, и назначаем людей: без назначений сводка пуста, и проба
        // сравнивала бы ноль с нулём.
        await post('/api/ops/security-events/se-1/stage/', { stage: 'RECON' })
        await post('/api/ops/security-events/se-1/recon/import-from-passport/', {})
        const withPosts = await read()
        const roster = (await (
          await fetch('/api/ops/personnel/?page_size=50')
        ).json()) as { results: { id: string }[] }
        for (const [index, p0] of withPosts.reconSectorPosts.entries()) {
          if (withPosts.placementAssignments.some((a) => a.postId === p0.id)) continue
          await post('/api/ops/security-events/se-1/placement/assign/', {
            postId: p0.id,
            employeeId: roster.results[index].id,
          })
        }

        const staged = await read()
        const visitObjectId = staged.visitObjects[0]?.id ?? ''
        const url = `/api/ops/security-events/se-1/visit-objects/${visitObjectId}/evaluations/`

        // Правило этапа — раньше «Проведения» оценок нет.
        const tooEarly = await post(url, { assignmentId: staged.placementAssignments[0].id, score: 5 })
        await post('/api/ops/security-events/se-1/stage/', { stage: 'CONDUCT' })

        const summary = async () => (await (await fetch(url)).json())
        const fresh = await summary()
        const first = fresh.rows[0]

        // Шкала 1-10 — правило сервера, а не «лишь бы число».
        const outOfScale = await post(url, { assignmentId: first.assignmentId, score: 11 })

        const scored = await (
          await post(url, { assignmentId: first.assignmentId, score: 3, comment: 'своей рукой' })
        ).json()
        // «Всем 10» добивает НЕОЦЕНЁННЫХ и не трогает поставленное вручную.
        const afterAll = await (
          await post(`${url}all/`, { score: 10 })
        ).json()
        const kept = afterAll.rows.find(
          (r: { assignmentId: string }) => r.assignmentId === first.assignmentId,
        )
        // Снятие оценки возвращает строку в неоценённые.
        const cleared = await (
          await post(url, { assignmentId: first.assignmentId, score: null })
        ).json()

        return {
          tooEarlyStatus: tooEarly.status,
          outOfScaleStatus: outOfScale.status,
          // Ключ конверта — `error_code`, как у сервера (`errorEnvelope`).
          outOfScaleCode: ((await outOfScale.json()) as { error_code?: string }).error_code,
          rowKeys: Object.keys(first ?? {}).sort(),
          divisionName: first?.divisionName as string | undefined,
          replaced: first?.replaced as boolean | undefined,
          freshEvaluated: fresh.evaluated as number,
          total: fresh.total as number,
          rows: fresh.rows.length as number,
          scoredEvaluated: scored.evaluated as number,
          keptScore: kept?.score as number | undefined,
          keptComment: kept?.comment as string | undefined,
          allEvaluated: afterAll.evaluated as number,
          clearedEvaluated: cleared.evaluated as number,
        }
      })

      // Состав строки — тот же, что у сервера: без `divisionName` и
      // `replaced` экран рисует другую строку, а мок этого не заметит.
      expect(result.rowKeys, 'состав строки сводки разошёлся с сервером').toEqual([
        'acknowledgedAt',
        'assignmentId',
        'comment',
        'divisionName',
        'employeeId',
        'employeeName',
        'post',
        'postId',
        'replaced',
        'score',
        'sector',
      ])
      expect(
        result.divisionName,
        'подразделение снова зашито пустой строкой — мок слеп к дефекту №643',
      ).not.toEqual('')
      expect(result.replaced, 'признак замены не булев').toBe(false)

      // Этап и шкала — правила сервера, а не «лишь бы 200».
      expect(result.tooEarlyStatus, 'оценка принята раньше «Проведения»').toBe(422)
      expect(result.outOfScaleStatus, 'оценка 11 принята').toBe(422)
      expect(result.outOfScaleCode).toEqual('SCORE_OUT_OF_SCALE')

      // «Оценено K из N» считается, а не лежит нулями.
      expect(result.rows, 'строк в сводке нет — проверять нечего').toBeGreaterThan(1)
      expect(result.total).toEqual(result.rows)
      expect(result.freshEvaluated).toBe(0)
      expect(result.scoredEvaluated, 'поставленная оценка не попала в счёт').toBe(1)

      // 🔴 ГЛАВНОЕ ПРАВИЛО: «Всем 10» ДОБИВАЕТ, а не переписывает.
      expect(result.keptScore, '«Всем 10» переписала оценку, поставленную вручную').toBe(3)
      expect(result.keptComment, '«Всем 10» стёрла комментарий оценщика').toBe('своей рукой')
      expect(result.allEvaluated, 'после «Всем 10» оценены не все').toEqual(result.total)

      // Снятие возвращает строку в неоценённые — иначе оценку нельзя было бы
      // переменить, а сервер это позволяет.
      expect(result.clearedEvaluated).toEqual(result.total - 1)
    })

    /**
     * Сидовые ОМ приезжают с ПОСЧИТАННЫМИ полями, а не полусырыми
     * (Plane №605).
     *
     * Вывод (стадия объекта, подпись статуса, сводка закрытия, итог
     * потребности) жил внутри `saveEvent`, то есть на пути ЗАПИСИ. А сид
     * кладёт события в стор напрямую: `emptyEvent()` заводит их на
     * «Бюллетене», потом им присваивается настоящая стадия — и никто не
     * пересчитывает то, что от стадии зависит. Под моком ОМ-…-1 стоял на
     * «Расстановке», а чип объекта печатал «Бюллетень»; закрытый ОМ-…-3 —
     * тот же чип. GET-ручки отдают стор как есть, поэтому расхождение
     * доживало до экрана, и значение чипа не сверяла ни одна проба.
     *
     * 🔴 ПРОВЕРЯЕТСЯ СИД, А НЕ РЕЗУЛЬТАТ ДЕЙСТВИЙ. Ни одной мутации до
     * чтения: любая из них прошла бы через `saveEvent` и вылечила бы стор,
     * скрыв ровно тот дефект, ради которого проба написана.
     */
    test('сидовые ОМ мока приезжают с посчитанной стадией объекта (Plane №605)', async ({
      page,
    }) => {
      const api = page.context().request
      const csrf = (await (await api.get(`${MOCK_APP}/api/auth/csrf/`)).json()) as {
        csrfToken: string
      }
      await api.post(`${MOCK_APP}/api/auth/callback/credentials/`, {
        form: {
          csrfToken: csrf.csrfToken,
          username: STAND_USERNAME,
          password: STAND_PASSWORD,
          json: 'true',
        },
      })
      // Заходим на СПИСОК, а не в карточку: карточка тоже только читает, но
      // список — самый ранний экран, на котором чип виден.
      await page.goto(`${MOCK_APP}/security-ops/events/`)
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 })

      const seeded = await page.evaluate(async () => {
        const read = async (id: string) =>
          (await (await fetch(`/api/ops/security-events/${id}/`)).json()) as {
            stage: string
            forceNeed: number
            forceDemandTotal: number
            visitObjects: { stage: string; statusLabel: string; closedAt: string | null }[]
          }
        return {
          placement: await read('se-1'),
          bulletin: await read('se-2'),
          closed: await read('se-3'),
        }
      })

      // ОМ на «Расстановке»: стадия объекта и подпись — его собственные.
      expect(seeded.placement.stage).toBe('PLACEMENT')
      expect(
        seeded.placement.visitObjects[0]?.stage,
        'стадия объекта осталась от emptyEvent(), а не от стадии ОМ',
      ).toBe('PLACEMENT')
      // Людей на постах у сида нет — по правилу мока это «Рекогносцировка
      // завершена», а НЕ «Бюллетень»: чип отвечает на «что дальше делать».
      expect(
        seeded.placement.visitObjects[0]?.statusLabel,
        'чип объекта печатает чужую стадию',
      ).toBe('Рекогносцировка завершена')
      // Итог потребности — тоже вывод, и он тоже считался только при записи.
      expect(seeded.placement.forceDemandTotal).toBe(seeded.placement.forceNeed)

      // ОМ на «Бюллетене» — тот же вывод, просто совпал с исходным.
      expect(seeded.bulletin.visitObjects[0]?.statusLabel).toBe('Бюллетень')

      // Закрытый ОМ: и стадия объекта, и момент закрытия — от мероприятия.
      expect(seeded.closed.stage).toBe('CLOSED')
      expect(seeded.closed.visitObjects[0]?.stage).toBe('CLOSED')
      expect(seeded.closed.visitObjects[0]?.statusLabel, 'закрытый ОМ с чужим чипом').toBe(
        'Закрыто',
      )
      expect(
        seeded.closed.visitObjects[0]?.closedAt,
        'объект закрытого ОМ не получил момента закрытия',
      ).not.toBeNull()
    })

    /**
     * Карта этапов ручки `stage/` — зеркало `STAGE_OVERRIDE_TARGETS` сервера
     * (Plane №791).
     *
     * Она расходилась с сервером в ОБЕ стороны: не было `PLACEMENT` — этапа,
     * на который выводит завершение рекогносцировки в самом же моке, — и был
     * `DEMAND`, которого сервер не принимает вовсе. То есть мок УМЕЛ быть на
     * «Расстановке», но перевести его туда напрямую было нельзя, а на
     * «Потребность» — можно, хотя живая ручка отвечает отказом. Мок-пробы
     * из-за первого строили обходные пути.
     *
     * 🔴 ПРОВЕРЯЮТСЯ ОБА КРАЯ. Проба «PLACEMENT принимается» одна закрыла бы
     * ровно ту половину, о которой знала карточка, и оставила бы лишний
     * `DEMAND` жить дальше: расхождение мока с сервером «в плюс» так же
     * опасно — на нём зеленеет проба над действием, которого в бою нет.
     *
     * Список сервера: BULLETIN, RECON, PLACEMENT, APPROVAL, ACKNOWLEDGEMENT,
     * CONDUCT (`STAGE_OVERRIDE_TARGETS` в `apps/ops/security_events.py`);
     * `CLOSED` в нём нет намеренно — закрывают по итогам направлений.
     */
    test('карта этапов ручки stage/ совпадает со списком сервера (Plane №791)', async ({
      page,
    }) => {
      const api = page.context().request
      const csrf = (await (await api.get(`${MOCK_APP}/api/auth/csrf/`)).json()) as {
        csrfToken: string
      }
      await api.post(`${MOCK_APP}/api/auth/callback/credentials/`, {
        form: {
          csrfToken: csrf.csrfToken,
          username: STAND_USERNAME,
          password: STAND_PASSWORD,
          json: 'true',
        },
      })
      await page.goto(`${MOCK_APP}/security-ops/events/se-2/`)
      await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 })

      const answers = await page.evaluate(async () => {
        const stages = [
          'BULLETIN',
          'RECON',
          'DEMAND',
          'FORCES',
          'PLACEMENT',
          'APPROVAL',
          'ACKNOWLEDGEMENT',
          'CONDUCT',
          'CLOSED',
        ]
        const out: Record<string, number> = {}
        for (const stage of stages) {
          const res = await fetch('/api/ops/security-events/se-2/stage/', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ stage }),
          })
          out[stage] = res.status
        }
        // Готовность после последнего принятого перевода — она приезжает
        // клиенту и показывается в шапке карточки.
        const after = (await (await fetch('/api/ops/security-events/se-2/')).json()) as {
          stage: string
          readinessPercent: number
        }
        return { out, stage: after.stage, readinessPercent: after.readinessPercent }
      })

      // Принимаются ровно шесть — те же, что у сервера.
      for (const stage of ['BULLETIN', 'RECON', 'PLACEMENT', 'APPROVAL', 'ACKNOWLEDGEMENT', 'CONDUCT']) {
        expect(answers.out[stage], `мок не пускает на «${stage}», а сервер пускает`).toBe(200)
      }
      // И ровно три отбиваются — иначе мок разрешает то, чего сервер не даст.
      for (const stage of ['DEMAND', 'FORCES', 'CLOSED']) {
        expect(answers.out[stage], `мок пускает на «${stage}», а сервер отбивает`).toBe(400)
      }
      // Проценты — из `STAGE_READINESS` сервера, теми же числами.
      expect(answers.stage).toBe('CONDUCT')
      expect(answers.readinessPercent, 'готовность разошлась с STAGE_READINESS').toBe(95)
    })

    test('возврат обнуляет маршрут, ответ на последнее замечание завершает этап (Plane №569, №570)', async ({
      page,
    }) => {
      // №570: подпись под ВОЗВРАЩЁННЫМ составом ничего не говорит о
      // следующем — сервер снимает все подписи (`[ВОЗ-03]`), мок оставлял их
      // в «Согласовано»/«На согласовании» на ОБЕИХ дорогах возврата.
      // №569: ответ на последнее открытое замечание — тоже «последняя
      // подпись» (`[СОГ-09]`): сервер завершает этап сам, мок не двигался.
      const api = page.context().request
      const csrf = (await (await api.get(`${MOCK_APP}/api/auth/csrf/`)).json()) as {
        csrfToken: string
      }
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

      const result = await page.evaluate(async () => {
        const post = (url: string, body?: unknown) =>
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
        const read = async () =>
          (await (await fetch('/api/ops/security-events/se-1/')).json()) as {
            stage: string
            approvalRoute: { id: string; status: string; comment: string }[]
            approvalRemarks: { id: string; status: string }[]
            visitObjects: { statusLabel: string }[]
          }
        await post('/api/ops/security-events/se-1/stage/', { stage: 'RECON' })
        await post('/api/ops/security-events/se-1/recon/import-from-passport/', {})
        const withPosts = await read()
        const roster = await (await fetch('/api/ops/personnel/?page_size=50')).json()
        for (const [index, p0] of (withPosts as unknown as {
          reconSectorPosts: { id: string }[]
          placementAssignments: { postId: string }[]
        }).reconSectorPosts.entries()) {
          if (
            (withPosts as unknown as { placementAssignments: { postId: string }[] })
              .placementAssignments.some((a) => a.postId === p0.id)
          )
            continue
          await post('/api/ops/security-events/se-1/placement/assign/', {
            postId: p0.id,
            employeeId: roster.results[index].id,
          })
        }
        // №606: подпись объекта на «Расстановке» считается по живым данным.
        await post('/api/ops/security-events/se-1/stage/', { stage: 'APPROVAL' })
        for (const name of ['Первый (проба №570)', 'Второй (проба №570)']) {
          await post('/api/ops/security-events/se-1/approval/route/', {
            name,
            employeeId: '1',
            position: 'Начальник',
          })
        }
        await post('/api/ops/security-events/se-1/approval/send/')
        const sent = await read()
        // Первый подписывает, второй возвращает — тогда есть ЧТО обнулять.
        await post(
          `/api/ops/security-events/se-1/approval/route/${sent.approvalRoute[0].id}/decide/`,
          { decision: 'APPROVED', comment: '' },
        )
        await post(
          `/api/ops/security-events/se-1/approval/route/${sent.approvalRoute[1].id}/decide/`,
          { decision: 'RETURNED', comment: 'Переставьте людей (проба №570)' },
        )
        const returned = await read()

        // Повторная отправка идёт ЧЕРЕЗ ЗАВЕРШЕНИЕ РАССТАНОВКИ: возврат
        // опустил ОМ на «Расстановку», а `approval/send/` работает на
        // «Согласовании» — тот же порядок, что у человека на экране.
        await post('/api/ops/security-events/se-1/placement/complete/', {})
        await post('/api/ops/security-events/se-1/approval/send/')
        const resent = await read()
        for (const approver of resent.approvalRoute) {
          if (approver.status === 'PENDING') {
            await post(
              `/api/ops/security-events/se-1/approval/route/${approver.id}/decide/`,
              { decision: 'APPROVED', comment: '' },
            )
          }
        }
        const signed = await read()
        const open = signed.approvalRemarks.find((r) => r.status === 'OPEN')
        if (open === undefined) {
          return { broken: 'открытых замечаний не осталось — автозавершение проверять нечем' }
        }
        // Идентификатор замечания собран из id согласующего, а в нём есть
        // двоеточия и плюс (метка времени) — без кодирования путь не совпал
        // бы с обработчиком, и ответ ушёл бы в пустоту молча.
        const resolved = await post(
          `/api/ops/security-events/se-1/approval/remarks/${encodeURIComponent(
            open.id,
          )}/resolve/`,
          { decision: 'RESOLVED', response: 'Переставили (проба №569)' },
        )
        const after = await read()
        return {
          broken: null as string | null,
          // №606: подпись объекта на «Расстановке» считается по живым данным,
          // а не по полю, которому ноль присвоили однажды.
          labelOnPlacement: (returned as unknown as {
            visitObjects: { statusLabel: string }[]
          }).visitObjects[0]?.statusLabel ?? '',
          returnedStatuses: returned.approvalRoute.map((a) => a.status),
          stageAfterSign: signed.stage,
          stageAfterResolve: after.stage,
          resolveStatus: resolved.status,
          resolveBody: (await resolved.text()).slice(0, 180),
          signedRoute: signed.approvalRoute.map((a) => a.status),
          stale: (signed as unknown as { approvalStale?: boolean }).approvalStale ?? null,
          visitLabel: after.visitObjects[0]?.statusLabel ?? '',
        }
      })

      expect(result.broken ?? null, `${result.broken}`).toBeNull()
      // №606: после возврата ОМ стоит на «Расстановке», и люди на постах
      // назначены — подпись объекта обязана это отражать. До правки ветка
      // «PLACEMENT + назначено 0» срабатывала всегда.
      expect(
        result.labelOnPlacement,
        'подпись объекта на «Расстановке» с назначенными людьми осталась прежней',
      ).not.toEqual('Рекогносцировка завершена')
      expect(
        result.returnedStatuses,
        'после возврата в маршруте остались подписи — таблица показывает «Согласовано» под возвращённым составом',
      ).toEqual(['NOT_SENT', 'RETURNED'])
      expect(
        result.stageAfterSign,
        'после подписей ОМ не на «Согласовании» — автозавершение проверять нечем',
      ).toEqual('APPROVAL')
      expect(
        result.resolveStatus,
        `ответ на замечание не принят: ${result.resolveBody}`,
      ).toEqual(200)
      expect(
        result.stageAfterResolve,
        `ответ на последнее открытое замечание не завершил этап; маршрут ${JSON.stringify(
          result.signedRoute,
        )}, состав менялся после отправки: ${result.stale}`,
      ).toEqual('ACKNOWLEDGEMENT')
    })

    test('мок пишет «ознакомлен сам», а не «лично» (Plane №542)', async ({ page }) => {
      // Сервер (Plane №721) ставит «лично», только когда ЧУЖАЯ строка
      // ДОКАЗАНА, а неизвестность читает как «в системе». У мока учётных
      // записей нет вовсе — доказать чужую строку нечем, значит это «сам».
      // Мок же писал `personal` и автора «Старший (мок)» БЕЗУСЛОВНО, и каждое
      // самоподтверждение рисовалось видом, которого живой стенд не выдаёт.
      const api = page.context().request
      const csrf = (await (await api.get(`${MOCK_APP}/api/auth/csrf/`)).json()) as {
        csrfToken: string
      }
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

      const row = await page.evaluate(async () => {
        const post = (url: string, body?: unknown) =>
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          })
        await post('/api/ops/security-events/se-1/stage/', { stage: 'RECON' })
        await post('/api/ops/security-events/se-1/recon/import-from-passport/', {})
        const withPosts = await (await fetch('/api/ops/security-events/se-1/')).json()
        const roster = await (await fetch('/api/ops/personnel/?page_size=50')).json()
        for (const [index, p0] of withPosts.reconSectorPosts.entries()) {
          if (
            withPosts.placementAssignments.some(
              (a: { postId: string }) => a.postId === p0.id,
            )
          )
            continue
          await post('/api/ops/security-events/se-1/placement/assign/', {
            postId: p0.id,
            employeeId: roster.results[index].id,
          })
        }
        const staged = await (await fetch('/api/ops/security-events/se-1/')).json()
        const assignment = staged.placementAssignments[0]
        await post(`/api/ops/security-events/se-1/acknowledge/${assignment.id}/`, {})
        const after = await (await fetch('/api/ops/security-events/se-1/')).json()
        return after.placementAssignments.find(
          (a: { id: string }) => a.id === assignment.id,
        ) as { acknowledgedVia: string; acknowledgedBy: string; acknowledgedAt: string | null }
      })

      expect(row.acknowledgedAt, 'подтверждение не записалось').not.toBeNull()
      expect(
        row.acknowledgedVia,
        'мок объявил самоподтверждение отметкой старшего «лично»',
      ).toEqual('self')
      expect(row.acknowledgedBy, 'у самоподтверждения появился автор').toEqual('')
    })

    test('стор мока не поднимает события прежней формы', async ({ page }) => {
      // Стор лежит в `sessionStorage` и восстанавливался ДОСЛОВНО, а ключ не
      // был версионирован (Plane №733): вкладка, открытая ДО выката новой
      // формы события, поднимала старые записи без нового поля, и экран
      // падал TypeError на первом же обращении к нему. Чинилось только
      // ручной очисткой хранилища — знанием, которого у человека нет.
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

      // Кладём в хранилище снимок ПРЕЖНЕЙ формы — под старым ключом и без
      // `closureSummary`, ровно как его оставила бы вкладка до выката.
      const outcome = await page.evaluate(async () => {
        const fresh = await (
          await fetch('/api/ops/security-events/se-1/')
        ).json()
        const stale = { ...fresh }
        delete stale.closureSummary
        stale.visitObjects = (stale.visitObjects ?? []).map(
          (v: Record<string, unknown>) => {
            const copy = { ...v }
            delete copy.closureSummary
            return copy
          },
        )
        sessionStorage.setItem(
          'ops-mock-security-events',
          JSON.stringify([stale]),
        )
        return {
          legacyWritten: sessionStorage.getItem('ops-mock-security-events') !== null,
        }
      })
      expect(outcome.legacyWritten).toBe(true)

      await page.reload()
      await page.goto(`${MOCK_APP}/security-ops/events/se-1/`)
      const main = page.getByRole('main')
      await expect(main).toBeVisible({ timeout: 30_000 })

      const after = await page.evaluate(async () => {
        const event = await (
          await fetch('/api/ops/security-events/se-1/')
        ).json()
        return {
          hasSummary: event.closureSummary !== undefined,
          legacyLeft: sessionStorage.getItem('ops-mock-security-events') !== null,
        }
      })

      // Снимок прежней формы не поднялся: поле на месте, а брошенный ключ
      // убран — иначе он держал бы квоту хранилища до закрытия вкладки.
      expect(after.hasSummary).toBe(true)
      expect(after.legacyLeft).toBe(false)
    })
  },
)
