/**
 * Сводные данные ГВО — из справочников (Plane №951, задача заказчика
 * 07.09.2026).
 *
 * Заказчик: «Состав ГВО должен выбираться из списка сотрудников. Машины …
 * со справочника транспортов. … Как добавить фото ОЛ? … должна быть кнопка
 * добавить ОЛ. … редактировать Бюллетень тем, у кого есть возможность
 * создавать бюллетень».
 *
 * Здесь — то, что не покрывает `gvo-sections` (выбор из кадров и справочника
 * там уже в пути правки): снимок лица доезжает до карточки сводки, новое лицо
 * заводится с экрана и встаёт в сводку, кнопка «Редактировать бюллетень» стоит
 * в шапке визита и открывает окно правки, в форме правки есть машина из
 * реестра.
 *
 * Фикстура: своё FOREIGN-ОМ с пробным лицом каталога заводится по API админа
 * и убирается в конце вместе с лицом (лицо — мягко: ручки удаления у
 * справочника нет, снимается `is_active` через Django нет — поэтому пробное
 * лицо помечается в имени и переиспользуется следующим прогоном).
 *
 * КРАСНОТА НА МУТАЦИИ: убери `photoUrl` из `_resolve_person` — снимок не
 * появится; сними кнопку в шапке — проба кнопки красная.
 */
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SHOTS = path.join(__dirname, '..', '.shot-tmp-951')
const PROBE_PERSON = 'Проба-951 Лицо справочника (e2e)'

// PNG 1×1, прозрачный: снимок для пробы, без файла на диске.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

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

test.describe(LIVE ? 'ГВО из справочников' : 'ГВО из справочников (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('снимок лица из справочника виден в сводке; бюллетень правится из шапки; машина — из реестра', async ({ page }) => {
    const access = await token()
    const admin = caller(access)

    // Пробное лицо: берём своё прежнее либо заводим.
    const catalog = await admin('GET', '/api/ops/protected-persons/')
    let person = (catalog.results as { id: string; name: string; photoUrl: string | null }[]).find(
      (row) => row.name === PROBE_PERSON,
    )
    if (!person) {
      const created = await admin('POST', '/api/ops/protected-persons/', {
        name: PROBE_PERSON,
        category: 'FOREIGN',
        bio: 'Заведено пробой Plane №951',
      })
      expect(created.status, JSON.stringify(created).slice(0, 200)).toBe(201)
      person = created
    }
    // Снимок — multipart, как шлёт экран.
    const form = new FormData()
    form.append('photo', new Blob([PNG_1PX], { type: 'image/png' }), 'probe.png')
    const uploaded = await fetch(`${API}/api/ops/protected-persons/${person!.id}/photo/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}` },
      body: form,
    })
    expect(uploaded.status, await uploaded.text().catch(() => '')).toBe(200)

    const created = await admin('POST', '/api/ops/security-events/', {
      title: 'Проба ГВО из справочников (e2e)',
      businessDate: '2026-09-29',
      kind: 'FOREIGN',
      protectedPersonIds: [person!.id],
    })
    expect(created.status, JSON.stringify(created).slice(0, 200)).toBe(201)

    try {
      await signIn(page)
      await page.goto(`${APP}/security-ops/visits/${created.id}`)
      const main = page.locator('main')
      await expect(page.getByRole('heading', { name: 'Сводные данные ГВО' })).toBeVisible({ timeout: 15_000 })

      // Карточка лица: снимок из справочника (img, не заглушка) и код OL-N.
      const photo = main.locator('img[data-slot="gvo-person-photo"]').first()
      await expect(photo).toBeVisible({ timeout: 10_000 })
      // Protected snapshots are fetched with the current JWT and rendered
      // from an object URL; the legacy public /media URL must not reappear.
      await expect(photo).toHaveAttribute('src', /^blob:/)
      await expect(main.getByText(PROBE_PERSON).first()).toBeVisible()
      await expect(main.getByText(/· OL-\d+/).first()).toBeVisible()
      await page.screenshot({ path: path.join(SHOTS, 'visit-person-photo.png'), fullPage: true })

      // Бюллетень правится из шапки визита.
      const head = page.locator('[data-slot="visit-head"]')
      await head.getByRole('button', { name: 'Редактировать бюллетень' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: 'Правка бюллетеня' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      // В форме правки — машина из реестра, лицо из справочника, сотрудник из списка.
      await main.getByRole('button', { name: 'Редактировать', exact: true }).click()
      const editForm = page.locator('[data-slot="gvo-edit-form"]')
      await expect(editForm).toBeVisible()
      await expect(editForm.getByRole('button', { name: '+ Машина из реестра' })).toBeVisible()
      await expect(editForm.getByRole('button', { name: '＋ Лицо из справочника' })).toBeVisible()
      await expect(editForm.getByRole('button', { name: '＋ Сотрудник из списка' }).first()).toBeVisible()
      // Лицо из справочника в форме — имя из записи, снимок и кнопка замены.
      const personHead = editForm.locator('[data-slot="gvo-person-head"]').first()
      await expect(personHead).toContainText(PROBE_PERSON)
      await expect(personHead.getByRole('button', { name: 'Заменить фото' })).toBeVisible()
      await page.screenshot({ path: path.join(SHOTS, 'visit-edit-form.png'), fullPage: true })
    } finally {
      await admin('DELETE', `/api/ops/security-events/${created.id}/`)
    }
  })
})
