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
  },
)
