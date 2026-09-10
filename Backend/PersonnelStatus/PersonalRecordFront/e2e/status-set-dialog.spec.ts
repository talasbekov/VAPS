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
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test, type Page } from '@playwright/test'
import { localIsoDate } from './business-date'
import { resolvePurgeTarget } from './purge-python'
import { clickRowMenuItem, staffedRow } from './row-menu'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const MATRIX_PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''
const execFileAsync = promisify(execFile)
const BACKEND_ROOT = path.resolve(__dirname, '../../Personnel-Records')
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
  marker: string
  employeeId: number
  employeeName: string
  legacyCode: string
  opsCode: string
  statusLabel: string
  startDate: string
  exactEndDate: string
  nearEndDate: string
  hrId: number
  hrComment: string
  hrState: string
  exactOpsId: number
  exactOpsComment: string
  exactOpsState: string
  nearOpsId: number
  nearOpsComment: string
  nearOpsState: string
}

interface HrStatusSnapshot {
  id: number
  state: string
  status_type: string
  start_date: string | null
  end_date: string | null
  comment: string
}

interface OpsStatusSnapshot {
  id: number
  status_type_code: string
  date_start: string
  date_end: string
  state: string
  comment: string
}

const shiftedIso = (days: number): string => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return localIsoDate(date)
}

const displayIsoDate = (value: string): string => value.split('-').reverse().join('.')

async function permissionsFor(token: string): Promise<string[]> {
  const response = await fetch(`${API}/api/operations/my-permissions/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await response.json()) as { permissions?: string[] }
  expect(response.status, 'не удалось прочитать фактические права non-admin роли').toBe(200)
  return body.permissions ?? []
}

async function visibleEmployee(token: string): Promise<NonNullable<StaffRow['employee']>> {
  const staffResponse = await fetch(
    `${API}/api/staff_unit/staff-units/directorate/?page=1&page_size=50`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const staffPayload = (await staffResponse.json()) as { staff_units?: StaffRow[] }
  expect(staffResponse.status, 'не удалось получить сотрудников области non-admin роли').toBe(200)
  const employee = (staffPayload.staff_units ?? []).find((row) => row.employee !== null)?.employee
  expect(employee, 'в области non-admin роли нет сотрудника для будущего статуса').toBeTruthy()
  return employee!
}

async function runStatusDialogProbe(args: string[]): Promise<string> {
  expect(
    existsSync(path.join(BACKEND_ROOT, 'manage.py')),
    'manage.py должен принадлежать текущей worktree',
  ).toBe(true)
  const target = await resolvePurgeTarget()
  expect(target, 'не найден общий либо локальный Python backend venv').not.toBeNull()
  const { stdout } = await execFileAsync(
    target!.python,
    ['manage.py', 'status_dialog_probe', ...args, `--settings=${DJANGO_SETTINGS}`],
    // Python разрешено разделять между checkout, код команды — никогда.
    { cwd: BACKEND_ROOT, timeout: 120_000 },
  )
  return stdout.trim()
}

/**
 * Адресная фикстура для №1112: сотрудника берём с первой страницы области
 * non-admin роли, а выделенная management command создаёт только собственную
 * тройку HR + exact OM + near OM. Marker известен до create, поэтому finally
 * удаляет все три строки даже при непарсируемом ответе команды.
 */
async function seedPlannedStatus(
  employee: NonNullable<StaffRow['employee']>,
  marker: string,
): Promise<PlannedStatusFixture> {
  const startDate = shiftedIso(3650)
  const exactEndDate = shiftedIso(3653)
  const stdout = await runStatusDialogProbe([
      'create',
      '--employee-id',
      String(employee.id),
      '--start-date',
      startDate,
      '--end-date',
      exactEndDate,
      '--marker',
      marker,
  ])
  const created = JSON.parse(stdout) as {
    employee_id: number
    employee_name: string
    legacy_code: string
    ops_code: string
    status_label: string
    start_date: string
    exact_end_date: string
    near_end_date: string
    hr: { id: number; comment: string; state: string }
    ops_exact: { id: number; comment: string; state: string }
    ops_near: { id: number; comment: string; state: string }
  }
  return {
    marker,
    employeeId: created.employee_id,
    employeeName: created.employee_name,
    legacyCode: created.legacy_code,
    opsCode: created.ops_code,
    statusLabel: created.status_label,
    startDate: created.start_date,
    exactEndDate: created.exact_end_date,
    nearEndDate: created.near_end_date,
    hrId: created.hr.id,
    hrComment: created.hr.comment,
    hrState: created.hr.state,
    exactOpsId: created.ops_exact.id,
    exactOpsComment: created.ops_exact.comment,
    exactOpsState: created.ops_exact.state,
    nearOpsId: created.ops_near.id,
    nearOpsComment: created.ops_near.comment,
    nearOpsState: created.ops_near.state,
  }
}

async function purgePlannedStatus(marker: string, fixtureCreated: boolean): Promise<void> {
  const stdout = await runStatusDialogProbe(['purge', '--marker', marker])
  const result = JSON.parse(stdout) as {
    deleted_hr_statuses: number
    deleted_ops_statuses: number
    remaining: number
  }
  if (fixtureCreated) {
    expect(result.deleted_hr_statuses, 'кадровая marker-фикстура не была удалена').toBe(1)
    expect(result.deleted_ops_statuses, 'обе OM marker-фикстуры не были удалены').toBe(2)
  }
  expect(result.remaining, 'после purge остались строки marker-фикстуры').toBe(0)
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

async function opsStatuses(token: string, employeeId: number): Promise<OpsStatusSnapshot[]> {
  const response = await fetch(
    `${API}/api/operations/statuses/?employee_id=${employeeId}&limit=500`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const body = (await response.json()) as { results?: OpsStatusSnapshot[] }
  expect(response.status, 'не удалось прочитать OM-статусы marker-фикстуры').toBe(200)
  return body.results ?? []
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

  test('единый список сводит только точный HR/OM дубль и оставляет OM read-only', async ({ page }) => {
    test.skip(MATRIX_PASSWORD === '', 'нужен ACCESS_MATRIX_PASSWORD — учётки матрицы доступа')
    const username = 'acc_dir_head_d2'
    const token = await tokenFor(username, MATRIX_PASSWORD)
    const marker = `status-dialog-e2e:${process.pid}:${Date.now()}`
    const permissions = await permissionsFor(token)
    const employee = await visibleEmployee(token)
    let seeded: PlannedStatusFixture | null = null
    const hrBefore = await hrStatuses(token, employee.id)

    try {
      expect(permissions, 'проверка должна идти под non-admin без wildcard').not.toContain('*')
      expect(permissions).toEqual(expect.arrayContaining(['status.view', 'status.manage']))
      seeded = await seedPlannedStatus(employee, marker)
      expect(seeded.employeeId).toBe(employee.id)
      expect(seeded.legacyCode).toBe('training')
      expect(seeded.opsCode).toBe('STUDY')
      expect(seeded.hrState).toBe('planned')
      expect(seeded.exactOpsState).toBe('PLANNED')
      expect(seeded.nearOpsState).toBe('PLANNED')
      expect([seeded.hrId, seeded.exactOpsId, seeded.nearOpsId].every((id) => id > 0)).toBe(true)
      expect(seeded.nearEndDate).not.toBe(seeded.exactEndDate)

      const hrFixture = (await hrStatuses(token, employee.id)).find(
        (status) => status.id === seeded!.hrId,
      )
      expect(hrFixture).toMatchObject({
        status_type: seeded.legacyCode,
        state: 'planned',
        start_date: seeded.startDate,
        end_date: seeded.exactEndDate,
        comment: seeded.hrComment,
      })
      const omFixture = await opsStatuses(token, employee.id)
      expect(omFixture.find((status) => status.id === seeded!.exactOpsId)).toMatchObject({
        status_type_code: seeded.opsCode,
        state: 'PLANNED',
        date_start: seeded.startDate,
        date_end: seeded.exactEndDate,
        comment: seeded.exactOpsComment,
      })
      expect(omFixture.find((status) => status.id === seeded!.nearOpsId)).toMatchObject({
        status_type_code: seeded.opsCode,
        state: 'PLANNED',
        date_start: seeded.startDate,
        date_end: seeded.nearEndDate,
        comment: seeded.nearOpsComment,
      })
      await signIn(page, username, MATRIX_PASSWORD)
      await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })
      const row = page.locator(`table tbody tr[data-employee-id="${employee.id}"]`).first()
      await expect(
        row,
        `сотрудника ${seeded.employeeName} с созданным статусом нет на первой странице`,
      ).toBeVisible({ timeout: 30_000 })

      await clickRowMenuItem(page, row, 'Запланированные статусы')

      const dialog = page.getByRole('dialog')
      await expect(dialog.getByText('Запланированные статусы', { exact: true })).toBeVisible({
        timeout: 20_000,
      })
      const plannedCard = dialog.locator('div.rounded-lg', { hasText: seeded.hrComment })
      await expect(
        plannedCard,
        'кадровая половина exact HR+OM пары не показана',
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
          .getByText(displayIsoDate(seeded.exactEndDate), { exact: true }),
        'дата окончания будущего статуса потеряна или изменена',
      ).toBeVisible()
      await expect(
        dialog.getByText(seeded.exactOpsComment, { exact: true }),
        'точный дубль OM должен быть сведён с кадровой карточкой',
      ).toHaveCount(0)
      const nearCard = dialog.locator('[data-status-source="operations"]', {
        hasText: seeded.nearOpsComment,
      })
      await expect(
        nearCard,
        'OM-строка с одной отличающейся датой не должна считаться дублем',
      ).toHaveCount(1)
      await expect(
        nearCard.getByText(displayIsoDate(seeded.nearEndDate), { exact: true }),
      ).toBeVisible()
      await expect(
        nearCard.getByText(displayIsoDate(seeded.startDate), { exact: true }),
      ).toBeVisible()
      await expect(
        nearCard.getByRole('button', { name: /Изменить/ }),
        'OM-карточка должна оставаться только для чтения',
      ).toHaveCount(0)
      await expect(
        dialog.getByText('Учёт раздела ОМ', { exact: true }),
        'окно статусов продолжает показывать отдельный учёт ОМ вместо единого списка',
      ).toHaveCount(0)
    } finally {
      await purgePlannedStatus(marker, seeded !== null)
      expect(
        await hrStatuses(token, employee.id),
        'cleanup не восстановил исходный кадровый срез сотрудника',
      ).toEqual(hrBefore)
    }
  })
})
