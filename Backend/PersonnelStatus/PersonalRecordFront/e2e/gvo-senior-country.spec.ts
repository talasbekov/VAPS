/**
 * Сводные данные ГВО: страна из карточки ОЛ, ответственный и старший ГВО из
 * кадрового списка, без текстового поля «Транспорт» (Plane №952, задача
 * заказчика 07.09.2026).
 *
 * Заказчик: «Страна должна подтягиваться с данных ОЛ … ОЛ должен иметь все
 * данные, которые я предоставил … нет возможности назначить старшего ГВО …
 * после ответственного за ГВО сделать старший ГВО, и обе должны выбираться
 * со списка сотрудников с поиском в боксе Состав ГВО … убрать в боксе
 * Выделяемый транспорт инпут ячейку для текста „Транспорт“».
 *
 * ЧТО БЫЛО. Страна сводки вписывалась руками; лицо из справочника приходило
 * без должности и данных; в блоке состава стояло одно текстовое поле
 * «Ответственный» («Фамилия | позывной | роль»), а старшего ГВО назначить
 * было негде; в блоке транспорта — свободный текст.
 *
 * ЧТО СТАЛО. Выбор лица из справочника кладёт страну в пустое поле «Страна»,
 * должность и данные — в карточку лица; «Ответственный за ГВО» и «Старший
 * ГВО» — выбором из кадров с поиском; текстового поля «Транспорт» нет.
 *
 * КРАСНАЯ ПРОБА: убери `setWhole("head", "country", …)` из `onPick` формы —
 * падёт ассерт на значение «Страны»; верни `Fields` раздела `transport` —
 * падёт `toHaveCount(0)`; убери `MemberField` старшего — падёт выбор.
 */
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SHOTS = path.join(__dirname, '..', '.shot-tmp-952')
const PROBE_PERSON = 'Проба-952 Лицо со страной (e2e)'
const PROBE_COUNTRY = 'Черногория-952'
const PROBE_POSITION = 'Президент пробы 952'

async function token(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

function caller(access: string) {
  return async (method: string, p: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${p}`, {
      method,
      headers: { Authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    return { status: res.status, ...json }
  }
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'ГВО: страна из ОЛ, старший из кадров' : 'ГВО: страна из ОЛ, старший из кадров (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('выбор лица подтягивает страну и должность; старший ГВО назначается из списка; поля «Транспорт» нет', async ({ page }) => {
    test.setTimeout(120_000)
    const admin = caller(await token())

    // Пробное лицо со страной и данными — переиспользуется между прогонами.
    const catalog = await admin('GET', '/api/ops/protected-persons/')
    let person = (catalog.results as Array<{ id: string; name: string; country: string }>).find(
      (row) => row.name === PROBE_PERSON,
    )
    if (person === undefined) {
      const created = await admin('POST', '/api/ops/protected-persons/', {
        name: PROBE_PERSON,
        category: 'FOREIGN',
        country: PROBE_COUNTRY,
        position: PROBE_POSITION,
        facts: [{ key: 'Группа крови', value: 'О (I) Rh +' }],
      })
      expect(created.status, JSON.stringify(created).slice(0, 200)).toBe(201)
      person = created
    }
    // Каталог несёт данные образца — это контракт, на котором стоит автозаполнение.
    expect(person!.country).toBe(PROBE_COUNTRY)

    // ОМ БЕЗ лица: страна сводки пуста, и заполнить её должен выбор лица в форме.
    const created = await admin('POST', '/api/ops/security-events/', {
      title: 'Проба страны и старшего ГВО (e2e)',
      businessDate: '2026-09-30',
      kind: 'FOREIGN',
    })
    expect(created.status, JSON.stringify(created).slice(0, 200)).toBe(201)

    try {
      await signIn(page)
      await page.goto(`${APP}/security-ops/visits/${created.id}`)
      const main = page.locator('main')
      await expect(page.getByRole('heading', { name: 'Сводные данные ГВО' })).toBeVisible({ timeout: 15_000 })
      await main.getByRole('button', { name: 'Редактировать', exact: true }).click()
      const form = page.locator('[data-slot="gvo-edit-form"]')
      await expect(form).toBeVisible()

      // (3) Текстового поля «Транспорт» в форме нет.
      await expect(form.getByRole('textbox', { name: 'Транспорт' })).toHaveCount(0)
      await expect(form.getByRole('button', { name: '+ Машина из реестра' })).toBeVisible()

      // (1) Страна пуста → выбор лица из справочника её заполняет.
      const country = form.getByRole('textbox', { name: 'Страна' })
      await expect(country).toHaveValue('')
      await form.getByRole('button', { name: '＋ Лицо из справочника' }).click()
      const personDialog = page.getByRole('dialog')
      await personDialog.getByRole('textbox', { name: 'Поиск охраняемого лица' }).fill('Проба-952')
      await personDialog.locator('[data-slot="protected-person-picker"] li button:not([disabled])').first().click()
      await expect(personDialog).toBeHidden()
      await expect(country).toHaveValue(PROBE_COUNTRY)
      await expect(form.getByRole('textbox', { name: 'Должность' }).last()).toHaveValue(PROBE_POSITION)
      await expect(form.getByRole('textbox', { name: 'Данные' }).last()).toHaveValue(/Группа крови = О \(I\) Rh \+/)

      // (2) Ответственный и старший ГВО — из кадрового списка с поиском.
      const seniorField = form.locator('[data-slot="gvo-member-field"][aria-label="Старший ГВО"]')
      const respField = form.locator('[data-slot="gvo-member-field"][aria-label="Ответственный за ГВО"]')
      await expect(seniorField).toBeVisible()
      await expect(respField).toBeVisible()
      // Старший из бюллетеня (если назначен при создании) уже стоит — кнопка
      // тогда «Заменить»; без него — «Выбрать из списка». Обе ведут в список.
      await seniorField.getByRole('button', { name: /^(Выбрать из списка|Заменить)$/ }).click()
      const pickDialog = page.getByRole('dialog')
      await expect(pickDialog.getByRole('heading', { name: 'Старший ГВО из списка сотрудников' })).toBeVisible()
      // Роль задана окном — поля «Роль в группе» нет.
      await expect(pickDialog.getByRole('textbox', { name: 'Роль в группе' })).toHaveCount(0)
      const row = pickDialog.locator('[data-slot="personnel-picker"] li button:not([disabled])').first()
      await expect(row).toBeVisible({ timeout: 15_000 })
      const seniorName = (await row.locator('span.font-medium').innerText()).trim()
      await row.click()
      await pickDialog.getByRole('button', { name: 'Назначить' }).click()
      await expect(pickDialog).toBeHidden()
      await expect(seniorField.getByText('из кадров')).toBeVisible()
      await page.screenshot({ path: path.join(SHOTS, 'visit-edit-senior-country.png'), fullPage: true })

      await form.getByRole('button', { name: 'Сохранить' }).click()
      await expect(form).toBeHidden({ timeout: 20_000 })

      // Панель: страна в шапке, старший — подписью сервера «Фамилия И.».
      await expect(main.getByText(PROBE_COUNTRY).first()).toBeVisible({ timeout: 10_000 })
      const seniorLine = main.locator('[data-slot="gvo-senior"]')
      await expect(seniorLine).toContainText(seniorName.split(' ')[0])
      await page.screenshot({ path: path.join(SHOTS, 'visit-panel-senior-country.png'), fullPage: true })

      // Сервер: старший сводки — он же старший мероприятия (права на сводку).
      const summary = await admin('GET', `/api/ops/gvo-summaries/${encodeURIComponent(created.code)}/`)
      expect(summary.summary.country).toBe(PROBE_COUNTRY)
      expect(summary.summary.senior.employeeId).toBeTruthy()
      const event = await admin('GET', `/api/ops/security-events/${created.id}/`)
      expect(String(event.chiefEmployeeId)).toBe(String(summary.summary.senior.employeeId))
    } finally {
      await admin('DELETE', `/api/ops/security-events/${created.id}/`)
    }
  })
})
