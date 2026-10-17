/**
 * Реестр транспорта ГОН на ЖИВОМ стенде (Plane №215).
 *
 * Проба отвечает на три вопроса: таблица показывает колонки ОБРАЗЦА, отбор по
 * классу брони считает СЕРВЕР (а не браузер над уже полученным списком), и
 * снятая машина в реестр по умолчанию не попадает.
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next.
 */
import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { runBackendCommand } from './backend-command'
import { uniqueBusinessDate } from './business-date'
import { requireFixture } from './fixtures'
import { standCall } from './prepare-events'
import { probeTitle } from './probe-events'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SCREEN = '/security-ops/vehicles/'

interface VehicleRow {
  id: string
  brand: string
  plate: string
  armorClass: string
  deployment: string
  isActive: boolean
}

interface OwnVehicle extends VehicleRow { fixtureKey: string }
type VehicleIdentity = Pick<OwnVehicle, 'fixtureKey' | 'plate' | 'isActive'> & { id?: string }
interface VehicleAllocation {
  id: string
  vehicleId: string | null
  label: string
  callsign: string
  purpose: string
  plate: string | null
  armorClass: string | null
}
interface EventBody {
  id: string
  code: string
  title: string
  kind: string
  businessDate: string
  vehicles: VehicleAllocation[]
}
interface OwnForeignEvent extends EventBody { marker: string; foreignVisitId?: string }

function publicVehicle(car: OwnVehicle): VehicleRow {
  return { id: car.id, brand: car.brand, plate: car.plate, armorClass: car.armorClass, deployment: car.deployment, isActive: car.isActive }
}

// The fleet has no public write API. Provisioning is management-only; the
// registry, allocation and release below still use the real UI/API.
async function ownVehicle(isActive: boolean): Promise<OwnVehicle> {
  const fixtureKey = `e2e-vehicle:${randomUUID()}`
  const plate = `E2E-${fixtureKey.split(':')[1].replace(/-/g, '').slice(0, 28)}`
  const script = [
    'import json, os',
    'from organization_management.apps.operations.models_vehicle import OpsVehicle',
    'marker = os.environ["E2E_VEHICLE_MARKER"]',
    'row = OpsVehicle.objects.create(',
    '    brand="000 E2E ГОН " + marker, plate=os.environ["E2E_VEHICLE_PLATE"],',
    '    body_class="седан (e2e)", production_year=2026, armor_class="VR7",',
    '    deployment=marker, note=marker, created_by=marker,',
    '    is_active=os.environ["E2E_VEHICLE_ACTIVE"] == "1",',
    ')',
    'print("FIXTURE_JSON=" + json.dumps({"id": str(row.pk), "brand": row.brand, "plate": row.plate, "armorClass": row.armor_class, "deployment": row.deployment, "isActive": row.is_active, "fixtureKey": marker}))',
  ].join('\n')
  const identity = { fixtureKey, plate, isActive }
  try {
    const output = await runBackendCommand(['shell', '-c', script], {
      env: { E2E_VEHICLE_MARKER: fixtureKey, E2E_VEHICLE_PLATE: plate, E2E_VEHICLE_ACTIVE: isActive ? '1' : '0' },
    })
    const line = output.split(/\r?\n/).find(row => row.startsWith('FIXTURE_JSON='))
    if (line === undefined) throw new Error('owned vehicle preparation returned no fixture')
    const car = JSON.parse(line.slice('FIXTURE_JSON='.length)) as OwnVehicle
    expect(car).toMatchObject({ fixtureKey, plate, brand: `000 E2E ГОН ${fixtureKey}`, armorClass: 'VR7', deployment: fixtureKey, isActive })
    expect(Number(car.id)).toBeGreaterThan(0)
    return car
  } catch (error) {
    // The UUID exists before the command. Recover only its exact singleton if
    // create committed but stdout/DTO did not reach the caller with its PK.
    let recoveredId: string | null = null
    try {
      recoveredId = await removeOwnVehicle(identity)
    } catch (cleanupError) {
      await test.info().attach('owned-vehicle-preparation-recovery', {
        contentType: 'application/json', body: Buffer.from(JSON.stringify({ ...identity, cleanupFailed: true })),
      })
      throw new AggregateError([error, cleanupError], 'failed to recover owned vehicle after preparation failure')
    }
    await test.info().attach('owned-vehicle-preparation-recovery', {
      contentType: 'application/json', body: Buffer.from(JSON.stringify({ ...identity, id: recoveredId, cleanupFailed: false })),
    })
    throw error
  }
}

async function removeOwnVehicle(car: VehicleIdentity): Promise<string | null> {
  const script = [
    'import json, os',
    'from django.db import transaction',
    'from organization_management.apps.operations.models_vehicle import OpsVehicle, OpsEventVehicle',
    'removed_id = None',
    'with transaction.atomic():',
    '    marker = os.environ["E2E_VEHICLE_MARKER"]',
    '    owned = OpsVehicle.objects.select_for_update().filter(created_by=marker)',
    '    vehicle_id = os.environ["E2E_VEHICLE_ID"]',
    '    if vehicle_id:',
    '        row = owned.get(pk=vehicle_id)',
    '    else:',
    '        rows = list(owned)',
    '        assert len(rows) <= 1, "ambiguous owned vehicle identity; preserve every row"',
    '        row = rows[0] if rows else None',
    '    if row is not None:',
    '        assert row.brand == "000 E2E ГОН " + marker and row.plate == os.environ["E2E_VEHICLE_PLATE"]',
    '        assert row.note == marker and row.deployment == marker',
    '        assert row.body_class == "седан (e2e)" and row.production_year == 2026 and row.armor_class == "VR7"',
    '        assert row.is_active == (os.environ["E2E_VEHICLE_ACTIVE"] == "1")',
    '        assert not OpsEventVehicle.objects.filter(vehicle=row).exists(), "owned fixture still has allocations; preserve the vehicle"',
    '        removed_id = str(row.pk)',
    '        row.delete()',
    'print("FIXTURE_REMOVED=" + json.dumps({"id": removed_id, "fixtureKey": marker}))',
  ].join('\n')
  const output = await runBackendCommand(['shell', '-c', script], {
    env: { E2E_VEHICLE_ID: car.id ?? '', E2E_VEHICLE_MARKER: car.fixtureKey, E2E_VEHICLE_PLATE: car.plate, E2E_VEHICLE_ACTIVE: car.isActive ? '1' : '0' },
  })
  const line = output.split(/\r?\n/).find(row => row.startsWith('FIXTURE_REMOVED='))
  if (line === undefined) throw new Error('owned vehicle cleanup returned no identity')
  const removed = JSON.parse(line.slice('FIXTURE_REMOVED='.length)) as { id: string | null; fixtureKey: string }
  expect(removed.fixtureKey).toBe(car.fixtureKey)
  if (car.id !== undefined) expect(removed.id).toBe(car.id)
  return removed.id
}

async function prepareEvent(token: string): Promise<OwnForeignEvent> {
  const marker = `e2e-vehicle-allocation:${randomUUID()}`
  const created = await standCall(token)('POST', '/api/ops/security-events/', {
    title: probeTitle(`Проба транспорта ГВО ${marker}`),
    businessDate: uniqueBusinessDate(),
    kind: 'FOREIGN',
  }) as EventBody
  if (created.id === undefined || created.id === null) throw new Error('owned foreign event returned no ID')
  return { ...created, id: String(created.id), marker }
}

async function ownEventDetail(token: string, event: OwnForeignEvent): Promise<EventBody> {
  const row = await standCall(token)('GET', `/api/ops/security-events/${event.id}/`) as EventBody
  expect(row).toMatchObject({ id: event.id, title: event.title, kind: 'FOREIGN', businessDate: event.businessDate })
  expect(event.title).toBe(probeTitle(`Проба транспорта ГВО ${event.marker}`))
  return row
}

async function captureForeignVisit(event: OwnForeignEvent): Promise<string> {
  const script = [
    'import json, os',
    'from organization_management.apps.operations.models_event import OpsSecurityEvent',
    'from organization_management.apps.operations.models_gvo import OpsForeignVisit',
    'event = OpsSecurityEvent.objects.get(pk=os.environ["E2E_EVENT_ID"], title=os.environ["E2E_EVENT_TITLE"], kind="FOREIGN")',
    'visit = OpsForeignVisit.objects.get(event=event)',
    'print("FIXTURE_JSON=" + json.dumps({"eventId": str(event.pk), "visitId": str(visit.pk)}))',
  ].join('\n')
  const output = await runBackendCommand(['shell', '-c', script], { env: { E2E_EVENT_ID: event.id, E2E_EVENT_TITLE: event.title } })
  const line = output.split(/\r?\n/).find(row => row.startsWith('FIXTURE_JSON='))
  if (line === undefined) throw new Error('owned foreign visit returned no fixture identity')
  const row = JSON.parse(line.slice('FIXTURE_JSON='.length)) as { eventId: string; visitId: string }
  expect(row.eventId).toBe(event.id)
  expect(Number(row.visitId)).toBeGreaterThan(0)
  return row.visitId
}

async function purgeOwnEvent(event: OwnForeignEvent): Promise<void> {
  const script = [
    'import os',
    'from django.core.management import call_command',
    'from django.db import transaction',
    'from organization_management.apps.operations.models_event import OpsSecurityEvent',
    'from organization_management.apps.operations.models_gvo import OpsForeignVisit',
    'with transaction.atomic():',
    '    row = OpsSecurityEvent.objects.select_for_update().get(pk=os.environ["E2E_EVENT_ID"], title=os.environ["E2E_EVENT_TITLE"], kind="FOREIGN")',
    '    assert row.title == "Проба транспорта ГВО " + os.environ["E2E_EVENT_MARKER"] + " (e2e)"',
    '    assert list(OpsSecurityEvent.objects.filter(title__contains=row.title).values_list("pk", flat=True)) == [row.pk]',
    '    visit_id = os.environ.get("E2E_FOREIGN_VISIT_ID")',
    '    if visit_id: OpsForeignVisit.objects.get(pk=visit_id, event=row)',
    '    assert not row.vehicles.exists(), "owned event still has allocations; preserve it"',
    '    call_command("purge_probe_events", marker=row.title, yes=True, force=True, actor="e2e-vehicles-registry")',
    '    assert not OpsSecurityEvent.objects.filter(pk=os.environ["E2E_EVENT_ID"]).exists()',
    '    if visit_id: assert not OpsForeignVisit.objects.filter(pk=visit_id).exists()',
    'print("FIXTURE_PURGED=ok")',
  ].join('\n')
  const output = await runBackendCommand(['shell', '-c', script], {
    env: { E2E_EVENT_ID: event.id, E2E_EVENT_TITLE: event.title, E2E_EVENT_MARKER: event.marker, E2E_FOREIGN_VISIT_ID: event.foreignVisitId ?? '' },
  })
  expect(output).toContain('FIXTURE_PURGED=ok')
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  expect(res.status, 'vehicle registry account must obtain a token').toBe(200)
  return ((await res.json()) as { access: string }).access
}

async function fleet(token: string, query = ''): Promise<VehicleRow[]> {
  const res = await fetch(`${API}/api/ops/vehicles/${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status, `GET vehicle registry ${query}`).toBe(200)
  const body = await res.json() as { results: VehicleRow[] }
  expect(Array.isArray(body.results)).toBe(true)
  return body.results
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  const response = await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
  expect(response.status(), 'vehicle registry login must succeed').toBe(200)
}

test.describe(LIVE ? 'транспорт ГОН' : 'транспорт ГОН (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('таблица несёт колонки образца и живые строки реестра', async ({ page }) => {
    const token = await apiToken()
    const car = requireFixture(
      (await fleet(token))[0],
      'машина в реестре транспорта (заводится manage.py seed_vehicles)',
    )

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    await expect(
      page.getByRole('heading', { name: 'Транспорт ГОН' }),
    ).toBeVisible({ timeout: 20_000 })

    // Колонки ПИНЯТСЯ ПОИМЁННО: подписи взяты из образца заказчика, и
    // переименование колонки — решение, а не оговорка. Подмени любую — проба
    // покраснеет.
    for (const column of [
      'Марка автомобиля',
      'Классификация по кузову',
      'Год выпуска',
      'ГРНЗ',
      'Класс брони',
      'Дислокация',
      'Примечание',
    ]) {
      await expect(page.getByRole('columnheader', { name: column })).toBeVisible()
    }

    // Строка ЖИВАЯ: номер взят из ответа сервера, а не из вёрстки.
    const row = page.getByRole('row', { name: new RegExp(car.plate) })
    await expect(row).toBeVisible()
    await expect(row).toContainText(car.brand)

    // Врезки «на бэке нет /api/ops/*» здесь быть НЕ ДОЛЖНО: строки выше
    // пришли с сервера, и утверждать над ними, что всё показанное — мок,
    // значит врать о собственных данных (Plane №215).
    await expect(page.getByText('на бэке нет')).toHaveCount(0)
  })

  test('отбор по классу брони сужает выдачу и живёт в адресе', async ({ page }) => {
    const token = await apiToken()
    const all = await fleet(token)
    const classes = [...new Set(all.map((c) => c.armorClass).filter(Boolean))]
    // Сторож вакуумности: на парке из одного класса отбор не проверяется —
    // «сузил» и «показал всё» дали бы одну и ту же таблицу.
    expect(
      classes.length,
      'в парке один класс брони — отбор проверять нечем (manage.py seed_vehicles)',
    ).toBeGreaterThan(1)
    const wanted = classes[0]
    const expected = all.filter((c) => c.armorClass === wanted).map((c) => c.plate)
    const hidden = all.find((c) => c.armorClass !== wanted && c.armorClass !== '')

    await signIn(page)
    await page.goto(`${APP}${SCREEN}`)
    await page.getByRole('button', { name: wanted, exact: true }).click()

    // Отбор УЕХАЛ В АДРЕС: обновление страницы не сбрасывает выборку, и
    // ссылкой можно поделиться.
    await expect(page).toHaveURL(new RegExp(`armorClass=${wanted}`))
    for (const plate of expected) {
      await expect(page.getByRole('row', { name: new RegExp(plate) })).toBeVisible()
    }
    if (hidden !== undefined) {
      await expect(
        page.getByRole('row', { name: new RegExp(hidden.plate) }),
      ).toHaveCount(0)
    }
  })

  test('машина выделяется на ОМ и видна в сводке ГВО, снятие её убирает', async ({
    page,
  }) => {
    // Путь целиком, а не ассерт на своё же поле: выделили ЭКРАНОМ → машина
    // названа в разделе «Выделяемый транспорт» карточки ОМ вместе с ГРНЗ →
    // сняли → строка ушла. Ровно того, чего не умел свободный текст.
    const token = await apiToken()
    let car: OwnVehicle | undefined
    let event: OwnForeignEvent | undefined
    const allocationIds: string[] = []
    let scenarioError: unknown
    try {
      car = await ownVehicle(true)
      expect((await fleet(token)).find(row => row.id === car!.id)).toMatchObject({ ...publicVehicle(car) })
      event = await prepareEvent(token)
      expect((await ownEventDetail(token, event)).vehicles).toEqual([])
      // Create the foreign visit through its supported API. Its internal PK is
      // audit metadata; /visits/{id} intentionally calls useSecurityEvent(id).
      const country = `Страна пробы ${event.marker}`
      const summaryPath = `/api/ops/gvo-summaries/${encodeURIComponent(event.code)}/`
      const patched = await standCall(token)('PATCH', summaryPath, {
        section: 'head', values: { country },
      }) as { omCode: string; patch: { country: string } }
      expect(patched).toMatchObject({ omCode: event.code, patch: { country } })
      event.foreignVisitId = await captureForeignVisit(event)
      const summary = await standCall(token)('GET', summaryPath) as { omCode: string; visit: { status: string } | null; summary: { country: string } }
      expect(summary).toMatchObject({ omCode: event.code, visit: { status: 'READY' }, summary: { country } })

      await signIn(page)
      await page.goto(`${APP}/security-ops/visits/${event.id}/`)
      await expect(page.getByRole('heading', { name: `${event.code} · ${event.title}`, exact: true })).toBeVisible()
      const section = page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByRole('heading', { name: 'Выделяемый транспорт' }) })
      await expect(section).toHaveCount(1)
      await expect(section).toBeVisible({ timeout: 15_000 })

      await section.getByRole('button', { name: '+ Машина из реестра' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox', { name: 'Поиск по реестру транспорта' }).fill(car.plate)
      await dialog.getByRole('button', { name: new RegExp(car.plate) }).click()
      await dialog.getByLabel('Позывной в кортеже').fill('S1')
      const purpose = `кортеж ${event.marker}`
      await dialog.getByLabel('Назначение').fill(purpose)
      const allocated = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(`/security-events/${event!.id}/vehicles/`))
      await dialog.getByRole('button', { name: 'Выделить' }).click()
      const allocationResponse = await allocated
      expect(allocationResponse.status()).toBe(201)
      const allocationBody = await allocationResponse.json() as EventBody
      const allocation = allocationBody.vehicles.find(row => row.vehicleId === car!.id)
      expect(allocation).toBeDefined()
      allocationIds.push(allocation!.id)
      expect(allocationBody).toMatchObject({ id: event.id, title: event.title })
      expect(allocationBody.vehicles).toHaveLength(1)
      expect(allocation).toMatchObject({ vehicleId: car.id, callsign: 'S1', purpose, plate: car.plate, armorClass: car.armorClass })
      expect((await ownEventDetail(token, event)).vehicles).toEqual(allocationBody.vehicles)
      await expect(dialog).toBeHidden({ timeout: 15_000 })

      // The exact owned allocation, not the first release button on the page.
      const row = section.locator('[data-slot="registry-vehicles"] > div').filter({ hasText: car.plate })
      await expect(row).toHaveCount(1)
      await expect(row).toContainText(car.plate)
      await expect(row).toContainText(car.armorClass)
      await expect(row).toContainText('из реестра ГОН')
      const released = page.waitForResponse(response => response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname.endsWith(`/security-events/${event!.id}/vehicles/${allocation!.id}/`))
      await row.getByRole('button', { name: 'Снять', exact: true }).click()
      const releaseResponse = await released
      expect(releaseResponse.status()).toBe(200)
      const releaseBody = await releaseResponse.json() as EventBody
      expect(releaseBody).toMatchObject({ id: event.id, title: event.title, vehicles: [] })
      expect((await ownEventDetail(token, event)).vehicles).toEqual([])
      await expect(section).not.toContainText(car.plate, { timeout: 15_000 })
    } catch (error) {
      scenarioError = error
      throw error
    } finally {
      const failures: unknown[] = []
      if (event !== undefined && car !== undefined) {
        try {
          // Recover even if the UI POST succeeded before an assertion failed.
          // Only allocations joining these two captured owned resources qualify.
          const detail = await ownEventDetail(token, event)
          for (const row of detail.vehicles.filter(link => link.vehicleId === car!.id)) {
            if (!allocationIds.includes(row.id)) allocationIds.push(row.id)
            const removed = await standCall(token)('DELETE', `/api/ops/security-events/${event.id}/vehicles/${row.id}/`) as EventBody
            expect(removed).toMatchObject({ id: event.id, title: event.title })
            expect(removed.vehicles.some(link => link.id === row.id)).toBe(false)
          }
        } catch (error) { failures.push(error) }
      }
      if (event !== undefined) {
        try { await purgeOwnEvent(event) } catch (error) { failures.push(error) }
      }
      if (car !== undefined) {
        try { await removeOwnVehicle(car) } catch (error) { failures.push(error) }
      }
      await test.info().attach('owned-vehicle-allocation-fixture', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ vehicle: car, event, allocationIds, provisioning: 'management-only; registry/allocation/release UI and API are real', cleanupFailures: failures.length }, null, 2)),
      })
      if (failures.length > 0) throw new AggregateError(scenarioError === undefined ? failures : [scenarioError, ...failures], 'failed to clean up owned vehicle allocation fixtures')
    }
  })

  test('снятая машина показывается только по прямой просьбе', async ({ page }) => {
    const token = await apiToken()
    const retired = await ownVehicle(false)
    let scenarioError: unknown
    try {
      const whole = await fleet(token, '?includeRetired=1')
      expect(whole.find(row => row.id === retired.id)).toMatchObject({ ...publicVehicle(retired) })
      const live = await fleet(token)
      expect(live.every(row => row.isActive), 'реестр по умолчанию отдал снятую машину').toBe(true)
      expect(live.some(row => row.id === retired.id)).toBe(false)
      await signIn(page)
      const defaultLoaded = page.waitForResponse(response => {
        const url = new URL(response.url())
        return response.request().method() === 'GET' && url.pathname === '/api/ops/vehicles/' && url.searchParams.get('includeRetired') !== '1'
      })
      await page.goto(`${APP}${SCREEN}`)
      const defaultResponse = await defaultLoaded
      expect(defaultResponse.status()).toBe(200)
      const defaultBody = await defaultResponse.json() as { results: VehicleRow[] }
      expect(defaultBody.results).toEqual(live)
      // Absence is meaningful only after the default server response has
      // rendered. The toggle itself is already visible during loading.
      if (live.length === 0) {
        await expect(page.getByText('Реестр транспорта пуст: машины заводятся в Django Admin.', { exact: true })).toBeVisible()
      } else {
        const table = page.getByRole('table', { name: 'Реестр бронированных транспортных средств ГОН' })
        await expect(table).toBeVisible()
        await expect(table.locator('tbody tr')).toHaveCount(live.length)
        expect(await table.locator('tbody tr td:nth-child(4)').allTextContents()).toEqual(live.map(row => row.plate))
      }
      const ownRow = page.getByRole('row', { name: new RegExp(retired.plate) })
      await expect(ownRow).toHaveCount(0)
      const included = page.waitForResponse(response => {
        const url = new URL(response.url())
        return response.request().method() === 'GET' && url.pathname === '/api/ops/vehicles/' && url.searchParams.get('includeRetired') === '1'
      })
      await page.getByRole('button', { name: 'Показывать снятые' }).click()
      expect((await included).status()).toBe(200)
      await expect(page).toHaveURL(/includeRetired=1/)
      await expect(ownRow).toBeVisible({ timeout: 10_000 })
      await expect(ownRow).toContainText(retired.brand)
    } catch (error) {
      scenarioError = error
      throw error
    } finally {
      const failures: unknown[] = []
      try { await removeOwnVehicle(retired) } catch (error) { failures.push(error) }
      await test.info().attach('owned-retired-vehicle-fixture', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ vehicle: retired, provisioning: 'management-only; real registry toggle', cleanupFailures: failures.length }, null, 2)),
      })
      if (failures.length > 0) throw new AggregateError(scenarioError === undefined ? failures : [scenarioError, ...failures], 'failed to clean up owned retired vehicle fixture')
    }
  })
})
