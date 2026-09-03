/**
 * Справочник «страна → город» на ЖИВОМ стенде (Plane №417, `[МД-09]`).
 *
 * Проба ходит по API, а не по экрану: своего экрана у справочника нет
 * (правка — Django Admin, чтение — форма ОМ в Ш-3). Стережёт три вещи:
 * сид не пустой (Казахстан с Астаной), города приезжают по стране, и
 * право чтения — `catalog.view`, а не `event.view`: у рядового
 * `acc_employee` список открыт, у учётки без роли — 403.
 */
import { expect, test } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return ((await res.json()) as { access: string }).access
}

test.describe(LIVE ? 'справочник страна → город' : 'справочник страна → город (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('сид не пуст, города по стране, чтение под catalog.view', async () => {
    const admin = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const countries = (await (
      await fetch(`${API}/api/ops/countries/`, { headers: { Authorization: `Bearer ${admin}` } })
    ).json()) as { results: { id: string; code: string; name: string }[] }
    const kz = countries.results.find((c) => c.code === 'KZ')
    expect(kz, 'сид миграции 0078 не оставил Казахстан').toBeDefined()

    const cities = (await (
      await fetch(`${API}/api/ops/countries/${kz!.id}/cities/`, {
        headers: { Authorization: `Bearer ${admin}` },
      })
    ).json()) as { results: { name: string; countryId: string }[] }
    expect(cities.results.map((c) => c.name)).toContain('Астана')
    expect(cities.results.every((c) => c.countryId === kz!.id)).toBe(true)

    const password = process.env.ACCESS_MATRIX_PASSWORD ?? ''
    test.skip(password === '', 'нужен ACCESS_MATRIX_PASSWORD — учётки матрицы доступа')
    const employee = await tokenFor('acc_employee', password)
    const asEmployee = await fetch(`${API}/api/ops/countries/`, {
      headers: { Authorization: `Bearer ${employee}` },
    })
    expect(asEmployee.status, 'рядовой сотрудник держит catalog.view — список должен быть открыт').toBe(200)
    // Гвард: тот же сотрудник реестр ОМ не видит — значит, список открыт
    // именно правом каталога, а не «ему открыли всё».
    const registry = await fetch(`${API}/api/ops/security-events/`, {
      headers: { Authorization: `Bearer ${employee}` },
    })
    expect(registry.status).toBe(403)
  })
})
