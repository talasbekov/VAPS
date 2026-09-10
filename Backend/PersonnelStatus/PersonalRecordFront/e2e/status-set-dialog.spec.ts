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
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test, type Page } from '@playwright/test'
import { localIsoDate } from './business-date'
import { clickRowMenuItem, staffedRow } from './row-menu'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const MATRIX_PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''
const execFileAsync = promisify(execFile)
const BACKEND_ROOT = path.resolve(__dirname, '../../Personnel-Records')
const BACKEND_PYTHON = path.join(BACKEND_ROOT, '.venv/bin/python')
const DJANGO_SETTINGS = 'organization_management.config.settings.local_postgres'

async function signIn(
  page: Page,
  username = STAND_USERNAME,
  password = STAND_PASSWORD,
): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

async function tokenFor(username: string, password: string): Promise<string> {
  const response = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const payload = (await response.json()) as { access?: string }
  expect(response.status, `не удалось войти в API под ${username}`).toBe(200)
  expect(payload.access, `API не вернул access-токен для ${username}`).toBeTruthy()
  return payload.access!
}

interface StaffRow {
  id: number
  employee: { id: number; last_name: string; first_name: string } | null
}

interface PlannedStatusFixture {
  id: number
  marker: string
  employeeId: number
  employeeName: string
  statusLabel: string
  startDate: string
  endDate: string
  comment: string
  savedState: string
  savedStatusType: string
  savedStartDate: string
  savedEndDate: string
}

interface HrStatusSnapshot {
  id: number
  state: string
  status_type: string
  start_date: string | null
  end_date: string | null
  comment: string
}

const shiftedIso = (days: number): string => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return localIsoDate(date)
}

const displayIsoDate = (value: string): string => value.split('-').reverse().join('.')

/**
 * Адресная фикстура для №1112: сотрудника берём с первой страницы области
 * non-admin роли, а будущую строку ОМ создаёт выделенная management command.
 * Она не вызывает кадровый сервис, не закрывает «В строю» и помечает строку
 * уникальным marker. В штатном cleanup проверяются marker и точный id; marker
 * известен до create и позволяет убрать строку даже при непарсируемом ответе.
 */
async function seedPlannedStatus(
  token: string,
  marker: string,
): Promise<PlannedStatusFixture> {
  const staffResponse = await fetch(
    `${API}/api/staff_unit/staff-units/directorate/?page=1&page_size=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const staffPayload = (await staffResponse.json()) as { staff_units?: StaffRow[] }
  expect(staffResponse.status, 'не удалось получить сотрудников области non-admin роли').toBe(200)
  const rows = (staffPayload.staff_units ?? []).filter(
    (row): row is StaffRow & { employee: NonNullable<StaffRow['employee']> } =>
      row.employee !== null,
  )
  expect(rows.length, 'в области non-admin роли нет сотрудника для будущего статуса').toBeGreaterThan(0)

  const startDate = shiftedIso(45)
  const endDate = shiftedIso(48)
  const employee = rows[0].employee
  const { stdout } = await execFileAsync(
    BACKEND_PYTHON,
    [
      'manage.py',
      'status_dialog_probe',
      'create',
      '--employee-id',
      String(employee.id),
      '--start-date',
      startDate,
      '--end-date',
      endDate,
      '--marker',
      marker,
      `--settings=${DJANGO_SETTINGS}`,
    ],
    { cwd: BACKEND_ROOT, timeout: 120_000 },
  )
  const created = JSON.parse(stdout.trim()) as {
    id: number
    state: string
    status_type: string
    status_label: string
    start_date: string
    end_date: string
    marker: string
  }
  return {
    id: created.id,
    marker,
    employeeId: employee.id,
    employeeName: `${employee.last_name} ${employee.first_name}`,
    statusLabel: created.status_label,
    startDate,
    endDate,
    comment: created.marker,
    savedState: created.state,
    savedStatusType: created.status_type,
    savedStartDate: created.start_date,
    savedEndDate: created.end_date,
  }
}

async function purgePlannedStatus(statusId: number | null, marker: string): Promise<void> {
  const statusIdArgs = statusId === null ? [] : ['--status-id', String(statusId)]
  const { stdout } = await execFileAsync(
    BACKEND_PYTHON,
    [
      'manage.py',
      'status_dialog_probe',
      'purge',
      ...statusIdArgs,
      '--marker',
      marker,
      `--settings=${DJANGO_SETTINGS}`,
    ],
    { cwd: BACKEND_ROOT, timeout: 120_000 },
  )
  const result = JSON.parse(stdout.trim()) as { deleted_statuses: number; remaining: number }
  if (statusId !== null) {
    expect(result.deleted_statuses, `фикстура ОМ ${statusId} не была удалена`).toBe(1)
  }
  expect(result.remaining, `фикстура ОМ ${statusId} осталась после purge`).toBe(0)
}

async function hrStatuses(token: string, employeeId: number): Promise<HrStatusSnapshot[]> {
  const response = await fetch(
    `${API}/api/statuses/statuses/?employee=${employeeId}&page=1&page_size=200`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const body = (await response.json()) as { results?: HrStatusSnapshot[] }
  expect(response.status, 'не удалось снять контрольный кадровый срез').toBe(200)
  return (body.results ?? []).sort((left, right) => left.id - right.id)
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
    await clickRowMenuItem(page, staffedRow(page), 'Запланировать статус')

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

  test('будущий статус с датами остаётся в списке без отдельного учёта ОМ', async ({ page }) => {
    test.skip(MATRIX_PASSWORD === '', 'нужен ACCESS_MATRIX_PASSWORD — учётки матрицы доступа')
    const username = 'acc_dir_head_d2'
    const token = await tokenFor(username, MATRIX_PASSWORD)
    const marker = `status-dialog-e2e:${process.pid}:${Date.now()}`
    let seeded: PlannedStatusFixture | null = null
    let hrBefore: HrStatusSnapshot[] | null = null

    try {
      seeded = await seedPlannedStatus(token, marker)
      hrBefore = await hrStatuses(token, seeded.employeeId)
      expect(seeded.savedState, 'будущий статус ОМ сервер не оставил запланированным').toBe(
        'PLANNED',
      )
      expect(seeded.savedStatusType, 'сервер сохранил другой тип будущего статуса').toBe(
        'STUDY',
      )
      expect(seeded.savedStartDate, 'сервер изменил дату начала будущего статуса').toBe(
        seeded.startDate,
      )
      expect(seeded.savedEndDate, 'сервер изменил дату окончания будущего статуса').toBe(
        seeded.endDate,
      )
      await signIn(page, username, MATRIX_PASSWORD)
      await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })
      const row = page.locator('table tbody tr', { hasText: seeded.employeeName }).first()
      await expect(
        row,
        `сотрудника ${seeded.employeeName} с созданным статусом нет на первой странице`,
      ).toBeVisible({ timeout: 30_000 })

      await clickRowMenuItem(page, row, 'Запланированные статусы')

      const dialog = page.getByRole('dialog')
      await expect(dialog.getByText('Запланированные статусы', { exact: true })).toBeVisible({
        timeout: 20_000,
      })
      const plannedCard = dialog.locator('div.rounded-lg', { hasText: seeded.comment })
      await expect(
        plannedCard,
        'созданный будущий статус не показан в разделе «Запланированные статусы»',
      ).toHaveCount(1)
      await expect(plannedCard.getByText(seeded.statusLabel, { exact: true })).toBeVisible()
      await expect(
        plannedCard
          .getByText('Дата начала', { exact: true })
          .locator('..')
          .getByText(displayIsoDate(seeded.startDate), { exact: true }),
        'дата начала будущего статуса потеряна или изменена',
      ).toBeVisible()
      await expect(
        plannedCard
          .getByText('Дата окончания', { exact: true })
          .locator('..')
          .getByText(displayIsoDate(seeded.endDate), { exact: true }),
        'дата окончания будущего статуса потеряна или изменена',
      ).toBeVisible()
      await expect(
        dialog.getByText('Учёт раздела ОМ', { exact: true }),
        'окно статусов продолжает показывать отдельный учёт ОМ вместо единого списка',
      ).toHaveCount(0)
    } finally {
      await purgePlannedStatus(seeded?.id ?? null, marker)
      if (seeded !== null && hrBefore !== null) {
        expect(
          await hrStatuses(token, seeded.employeeId),
          'browser-фикстура изменила кадровые статусы живого сотрудника',
        ).toEqual(hrBefore)
      }
    }
  })
})
