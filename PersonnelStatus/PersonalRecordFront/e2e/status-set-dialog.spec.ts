/**
 * «Проставить» на «Ежедневном расходе» (`/employees?view=daily`) — окно
 * постановки статуса ОМ-модели (Plane №274, Ш-4).
 *
 * ПОЧЕМУ ЭТО ОКНО ВООБЩЕ ПОЯВИЛОСЬ. До Ш-4 ПОСТАВИТЬ статус расхода из
 * интерфейса было НЕЛЬЗЯ НИКАК: борд отдавал `dirtyCount={0}` литералом, а у
 * массовой ручки (`DAILY_BULK_PATH`) не было ни одного читателя. Статусы
 * расхода заводились только сидом и цепочкой ОМ. Так что Ш-4 — это не «ещё
 * один диалог», а первая поверхность записи в эту модель.
 *
 * 🔴 ДВЕ МОДЕЛИ СТАТУСОВ, И ЭТО НЕ ОПЕЧАТКА. `statuses.EmployeeStatus`
 * (кадровые экраны) и `operations.OpsEmployeeStatus` (расход) не связаны ни
 * сигналом, ни синком — только `StatusType.legacy_code`. Заказчик писал «этот
 * статус как статус На дежурстве», и буквальное прочтение уводит к кадровому
 * диалогу, где мероприятиям взяться неоткуда. Окно живёт на расходе.
 *
 * Стережёт: пропажу кнопки «Проставить», развал цепочки «вид участия → роли
 * его группы» (роль обязана предлагаться ТОЛЬКО из группы выбранного вида) и
 * потерю мероприятий по дороге на сервер.
 *
 * 🔴 ПРОБА МУТИРУЕТ СТЕНД И НЕ УБИРАЕТ ЗА СОБОЙ — и это не забытая уборка.
 * Статус расхода в этой модели ФАКТ, а не черновик: ручка удаления не
 * предусмотрена вовсе (`http_method_names` без `delete`), `cancel` работает
 * только по ещё не начавшемуся (`PLANNED`), а досрочное завершение требует
 * конца ПОЗЖЕ начала — то есть пустым интервал не сделать и дату оно не
 * освобождает. Убрать поставленный статус через API нельзя ПО УСТРОЙСТВУ
 * предметной области.
 *
 * Поэтому проба не борется с этим, а обходит: берёт сотрудника, у которого на
 * эту дату статуса ЕЩЁ НЕТ (бейдж «В строю»), и ставит статус ему. Накопление
 * ограничено само: одна строка за прогон, а завтрашняя дата свободна снова.
 * Первая версия пробы била в первого попавшегося и на втором прогоне падала
 * 409 по собственному следу — падение было её, а не кода.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe('расход: постановка статуса с мероприятиями', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('окно ведёт цепочку «вид участия → роли его группы» и доносит её до сервера', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`, { waitUntil: 'domcontentloaded' })
      const toggles = page.locator('[role="group"] button[aria-expanded]')
      await expect(toggles.first()).toBeVisible({ timeout: 30_000 })

      // Строка сотрудника БЕЗ статуса на дату: бейдж «В строю» ставится
      // ровно тогда, когда статуса нет (`statusLabel(null)`).
      //
      // 🔴 РАСКРЫВАЕМ УПРАВЛЕНИЯ, ПОКА НЕ НАЙДЁМ СВОБОДНОГО. Проба оставляет
      // после себя статус (убрать его нельзя — это факт расхода), и людей
      // одного управления хватило на сутки: дальше в первой группе не
      // осталось ни одного «В строю», и проба падала не из-за кода.
      const freeRow = page
        .locator('tr')
        .filter({ hasText: 'В строю' })
        .filter({ has: page.getByRole('button', { name: 'Проставить' }) })
      const groups = await toggles.count()
      for (let index = 0; index < groups; index += 1) {
        await toggles.nth(index).click()
        if ((await freeRow.count()) > 0) break
      }
      await expect(
        freeRow.first(),
        'ни в одном управлении нет сотрудника без статуса на дату',
      ).toBeVisible({ timeout: 20_000 })
      await freeRow.first().getByRole('button', { name: 'Проставить' }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      // Пока статус не «участие», блока мероприятий нет — он не для любого статуса.
      await expect(dialog.getByText('Мероприятия', { exact: true })).toHaveCount(0)

      await dialog.getByLabel('Статус', { exact: true }).click()
      await page.getByRole('option', { name: /Привлечён на мероприятие \(наряд\)/ }).first().click()
      await expect(dialog.getByText('Мероприятия', { exact: true })).toBeVisible()

      await dialog.getByRole('button', { name: '+ Мероприятие' }).click()
      await dialog.getByLabel('Мероприятие 1', { exact: true }).click()
      // 🔴 ЖДЁМ НАПОЛНЕНИЯ, а не кликаем в пустоту. В полном прогоне реестр ОМ
      // под нагрузкой отвечал не сразу, и `option.first()` истекал по
      // таймауту. Ожидание привязано к состоянию, которое окно теперь
      // показывает явно, — «Загружаем мероприятия…» должно СМЕНИТЬСЯ.
      await expect(
        page.getByText('Загружаем мероприятия…'),
        'состояние загрузки списка ОМ сменяется списком',
      ).toHaveCount(0, { timeout: 30_000 })
      await expect(
        page.getByText('Мероприятий нет — привлекать не на что'),
        'на стенде есть хотя бы одно ОМ — иначе проба вакуумна',
      ).toHaveCount(0)
      // 🔴 ВЫБОР С КЛАВИАТУРЫ, А НЕ КЛИК В «ПЕРВЫЙ ПО DOM». Когда реестр ОМ
      // подрастает (15 записей — уже достаточно), Radix открывает список
      // прокрученным к подсвеченному варианту, и ПЕРВЫЙ ПО DOM оказывается
      // выше видимой области: Playwright честно говорит «element is outside
      // of the viewport» и падает по таймауту. Сам список при этом
      // отрисован верно — проверено снимком экрана на 15 записях. То есть
      // ломалась проба, а не окно, и лечится это не ожиданием, а тем, чтобы
      // не адресовать вариант его позицией в разметке.
      await expect(page.getByRole('listbox')).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(
        dialog.getByLabel('Мероприятие 1', { exact: true }),
        'мероприятие выбрано — в поле стоит код ОМ',
      ).toContainText(/ОМ-\d+/)

      // Роль появляется только у видов, у которых есть роли, и только своей группы.
      await expect(dialog.getByLabel('Роль в группе 1', { exact: true })).toHaveCount(0)
      await dialog.getByLabel('Вид участия 1', { exact: true }).click()
      await page.getByRole('option', { name: 'Группа досмотра' }).click()

      const role = dialog.getByLabel('Роль в группе 1', { exact: true })
      await expect(role, 'у группы досмотра роли есть — поле показано').toBeVisible()
      await role.click()
      const roles = await page.getByRole('option').allTextContents()
      expect(roles.length, 'роли предлагаются').toBeGreaterThan(0)
      expect(
        roles.some((r) => /досмотр/i.test(r)),
        `роли той же группы, а не всего справочника: ${roles.join(' | ')}`,
      ).toBe(true)
      await page.getByRole('option').first().click()

      const [response] = await Promise.all([
        page.waitForResponse((r) =>
          r.url().includes('/api/operations/statuses/') && r.request().method() === 'POST'),
        dialog.getByRole('button', { name: 'Проставить' }).click(),
      ])

      expect(response.status(), await response.text()).toBe(201)
      const saved = (await response.json()) as {
        participations: { event_id: number; kind_code: string; role_code: string }[]
      }
      expect(saved.participations, 'мероприятия доехали до сервера и вернулись из него').toHaveLength(1)
      expect(saved.participations[0].kind_code).toBe('SCREENING_GROUP')
      expect(saved.participations[0].role_code, 'роль сохранена, а не потеряна').not.toBe('')

      await expect(dialog, 'после успеха окно закрывается').toHaveCount(0)
  })
})
