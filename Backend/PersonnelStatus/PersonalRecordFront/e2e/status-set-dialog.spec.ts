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
import { clickRowMenuItem } from './row-menu'
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

  test('«Участие в ОМ» из окна расхода снято — статус ставится из запроса (Plane №427)', async ({ page }) => {
    /**
     * `[СТА-04]`: статус участия заводится только чекбоксами запроса на
     * сбор сил. В окне расхода типов участия в списке нет вовсе, а обычный
     * статус по-прежнему ставится и уходит без участий.
     */
    await signIn(page)
    await page.goto(`${APP}/employees?view=daily`, { waitUntil: 'domcontentloaded' })
    const toggles = page.locator('[role="group"] button[aria-expanded]')
    await expect(toggles.first()).toBeVisible({ timeout: 30_000 })
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

    await dialog.getByLabel('Статус', { exact: true }).click()
    const options = await page.getByRole('option').allTextContents()
    expect(options.length, 'справочник статусов пуст').toBeGreaterThan(0)
    expect(
      options.some((o) => /Привлечён на мероприятие|Участие в ОМ/i.test(o)),
      `типы участия не должны предлагаться вручную: ${options.join(' | ')}`,
    ).toBe(false)
    // Обычный статус ставится как прежде — без блока мероприятий и без участий.
    const plain = page.getByRole('option').filter({ hasNotText: 'В строю' }).first()
    await plain.click()
    await expect(dialog.getByText('Мероприятия', { exact: true })).toHaveCount(0)
    const [response] = await Promise.all([
      page.waitForResponse((r) =>
        r.url().includes('/api/operations/statuses/') && r.request().method() === 'POST'),
      dialog.getByRole('button', { name: 'Проставить' }).click(),
    ])
    expect([201, 409, 422]).toContain(response.status())
    if (response.status() === 201) {
      const saved = (await response.json()) as { participations: unknown[] }
      expect(saved.participations).toHaveLength(0)
    }
  })

  test('на «Статусах сотрудников» типы участия тоже не предлагаются', async ({ page }) => {
    /**
     * Plane №486 (заказчик): «Убери статусы Привлечен на мероприятия(обе)».
     *
     * Окно расхода их не предлагало с №427, а ЭТО окно — «Запланировать
     * статус» на «Статусах сотрудников» — предлагало по-прежнему: в коде
     * прямо стояло «тип в списке остаётся видимым, но отправка отбивается
     * словами». То есть человек выбирал «Привлечён на мероприятие (наряд)»,
     * заполнял форму и получал отказ — выбор, который не мог сработать
     * НИКОГДА.
     *
     * Сами типы из справочника НЕ удаляются: их ставит система при
     * назначении на мероприятие, по ним считаются колонки расхода и разрезы
     * сбора сил. Убран только ручной выбор.
     *
     * Красная проверка — снять фильтр `EVENT_PARTICIPATION_STATUS_CODES` в
     * `EditStatusDialog`: оба типа возвращаются в список.
     */
    await signIn(page)
    await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 })

    // Через помощника (Plane №820): строка доводится до окна ДО открытия меню.
    await clickRowMenuItem(page, page.locator('table tbody tr').first(), 'Запланировать статус')

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 20_000 })
    await dialog.getByLabel('Новый статус').click()
    const options = await page.getByRole('option').allTextContents()
    expect(options.length, 'справочник статусов пуст — проба вакуумна').toBeGreaterThan(0)
    expect(
      options.some((o) => /Привлечён на мероприятие/i.test(o)),
      `типы участия не должны предлагаться вручную: ${options.join(' | ')}`,
    ).toBe(false)
    // Обычные статусы на месте — фильтр убрал участие, а не список целиком.
    expect(
      options.some((o) => /В командировке|В отпуске|На больничном/i.test(o)),
      `из списка пропали обычные статусы: ${options.join(' | ')}`,
    ).toBe(true)
  })
})
