/**
 * Штаб сбора сил — ОТДЕЛЬНАЯ персона `acc_ops_staff` (Plane №972, `[ШТБ-01]`–`[ШТБ-04]`).
 *
 * До №972 штабом считались начальники второго департамента: №944 выдала их
 * профилю `forces.command`, и цепочка сбора на стенде ходила под ними или под
 * админом (`forces-gathering.spec.ts` — `STAND_USERNAME`). Заказчик 08.09.2026
 * назвал Штаб отдельным актором с ролью `OPS_STAFF`, и это первая проба,
 * которая ПРОХОДИТ ШТАБНЫЕ ШАГИ ИМЕННО ЕГО УЧЁТКОЙ — с одним грантом
 * `OPS_STAFF` на всю организацию, без `event.manage` и без `OPS_STAFF_COMMAND`:
 * деление потребности по департаментам → список сборов → возврат списка →
 * приёмка списка (`[ШТБ-04]`). Шаги департамента и управления (оповещение,
 * выделение, отправка) идут админом по API: они не штабные и стерегутся
 * `department-requests.spec.ts`.
 *
 * Отрицательная половина — `[ШТБ-02]`/`[ШТБ-03]`: начальник второго
 * департамента, начальник его управления и ответственный за сбор сил на
 * штабные ручки получают 403.
 *
 * КРАСНОТА НА МУТАЦИИ: верни `forces.command` в профиль `HEAD_OPS_UNIT` — красна
 * отрицательная половина; сними его у `OPS_STAFF` — красна положительная.
 */
import { expect, test } from '@playwright/test'

import { prepareDemandEvent } from './prepare-events'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const MATRIX_PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) throw new Error(`токен для ${username}: ${res.status}`)
  return ((await res.json()) as { access: string }).access
}

async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

test.describe(LIVE ? 'штаб сбора сил: отдельная персона' : 'штаб сбора сил (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(MATRIX_PASSWORD === '', 'нужен ACCESS_MATRIX_PASSWORD — учётки матрицы доступа')

  test('acc_ops_staff проходит штабные шаги: деление → список сборов → возврат → приёмка', async () => {
    const admin = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const staff = await tokenFor('acc_ops_staff', MATRIX_PASSWORD)
    // Будущей датой: статус привлечения ещё не начался, свободных людей больше.
    const { id } = await prepareDemandEvent(admin, '2027-07-01')
    const base = `/api/ops/security-events/${id}`

    const divisions = await call(admin, 'GET', '/api/core/divisions/?page_size=200')
    const department = divisions.json.results.find((row: any) => row.type_code === 'department')
    const directorate = divisions.json.results.find(
      (row: any) => row.type_code === 'directorate' && row.parent === department.id,
    )
    expect(directorate, 'у департамента стенда нет управления').toBeTruthy()

    // Штаб: деление потребности по департаментам — `forces.command`.
    const split = await call(staff, 'POST', `${base}/forces/allocation/`, {
      rows: [{ departmentId: String(department.id), need: 1 }],
    })
    expect(split.status, `деление потребности Штабом: ${JSON.stringify(split.json)}`).toBe(200)
    const allocationId = split.json.forceAllocation[0].id as string

    // Штаб: список сборов — его экран, и своё мероприятие в нём есть.
    const collections = await call(staff, 'GET', '/api/ops/security-events/forces/collections/')
    expect(collections.status).toBe(200)
    expect(collections.json.results.map((row: any) => row.eventId)).toContain(id)

    // Департамент и управление (админом по API): оповестить, выделить, отправить.
    await call(admin, 'POST', `${base}/forces/allocation/${allocationId}/notify/`)
    const people = await call(admin, 'GET', `/api/ops/personnel/?division_id=${directorate.id}&page_size=8`)
    let added = false
    for (const person of people.json.results) {
      const r = await call(admin, 'POST', `${base}/forces/allocation/${allocationId}/members/`, {
        employeeId: person.id,
      })
      if (r.json.error_code === undefined) {
        added = true
        break
      }
    }
    expect(added, 'не нашлось ни одного свободного на дату ОМ').toBe(true)
    const submitted = await call(admin, 'POST', `${base}/forces/allocation/${allocationId}/submit/`)
    expect(submitted.json.error_code).toBeUndefined()

    // Штаб: вернуть список с причиной, затем принять повторно присланный.
    const returned = await call(staff, 'POST', `${base}/forces/allocation/${allocationId}/return/`, {
      reason: 'Нужны люди с допуском',
    })
    expect(returned.status, `возврат Штабом: ${JSON.stringify(returned.json)}`).toBe(200)
    const again = await call(admin, 'POST', `${base}/forces/allocation/${allocationId}/submit/`)
    expect(again.json.error_code).toBeUndefined()
    const accepted = await call(staff, 'POST', `${base}/forces/allocation/${allocationId}/accept/`)
    expect(accepted.status, `приёмка Штабом: ${JSON.stringify(accepted.json)}`).toBe(200)

    // `[ШТБ-05]`/`[ШТБ-06]`: штабных обходов у Штаба сбора сил нет — перевод
    // этапа мероприятия ему закрыт.
    const override = await call(staff, 'POST', `${base}/stage/`, { stage: 'PLACEMENT' })
    expect(override.status, 'Штаб сбора сил не двигает этапы ОМ').toBe(403)
  })

  test('начальники второго департамента и ответственный за сбор сил Штабом не являются', async () => {
    for (const username of ['acc_dept_head_d2', 'acc_dir_head_d2', 'acc_forces_officer']) {
      const token = await tokenFor(username, MATRIX_PASSWORD)
      const list = await call(token, 'GET', '/api/ops/security-events/forces/collections/')
      expect(list.status, `${username}: список сборов — штабной экран`).toBe(403)
    }
  })
})
