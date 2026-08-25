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
 *   NEXT_PUBLIC_OPS_MOCK_DOMAINS=security-events,objects \
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

      // И завершение этапа отбивается — маршрут есть, но решений нет.
      await page
        .getByRole('button', { name: 'Завершить этап и перейти далее' })
        .click()
      await expect(page.getByRole('main')).toContainText(
        'Расстановка не отправлена на согласование',
        { timeout: 20_000 },
      )
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
      expect(prepared.stage).toBe('DEMAND')
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
    })
  },
)
