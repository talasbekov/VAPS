/**
 * Паспорт на изолированном стенде: вкладки, серверные сведения,
 * сохранность черновика, снимок объекта и права просмотра.
 * Service worker заблокирован, чтобы сверка использовала API стенда.
 */
import { expect, test, type Page } from '@playwright/test'
import { requireFixture } from './fixtures'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const SCREEN = '/security-ops/objects'

interface Freshness {
  objectId: string
  state: 'FRESH' | 'DUE_SOON' | 'OVERDUE' | 'NO_PUBLISHED_VERSION'
  verificationDueAt: string | null
}

interface ObjectRow {
  id: string
  name: string
  code: string
  type: string
  region: string
  address: string
  objectState: 'ACTIVE' | 'ARCHIVED'
  passportState: 'GREEN' | 'YELLOW' | 'RED'
  ownership: 'OWN' | 'GUARDED'
  hasSecurityEvents: boolean
  sectors: { name: string; posts: unknown[] }[]
  photoUrl: string | null
}

interface Registry {
  results: ObjectRow[]
  freshness: Freshness[]
  unavailableKpi: { code: string; label: string; reason: string }[]
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function registry(token: string): Promise<Registry> {
  const res = await fetch(`${API}/api/ops/objects/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as Registry
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

/** Значение строки «Общие данные» по её подписи. */
function field(page: Page, label: string) {
  return page.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) })
}

/**
 * Карточка общей вкладки. Ищется по карточке, а НЕ по роли заголовка:
 * `CardTitle` этого набора — обычный `div`, и `getByRole('heading')` тут
 * промахивается молча (на этом проба и покраснела в первый прогон).
 */
function generalCard(page: Page) {
  return page.locator('[data-slot="card"]', { hasText: 'Общие данные' }).first()
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'паспорт объекта' : 'паспорт объекта (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('вкладки переключают содержимое и живут в адресе', async ({ page }) => {
    const snapshot = await registry(await apiToken())
    const object = snapshot.results[0]
    expect(object, 'в реестре нет ни одного объекта — проба вакуумна').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}${SCREEN}/${object.id}`)
    await expect(page.getByRole('heading', { name: object.name })).toBeVisible({ timeout: 15_000 })

    // Умолчание НЕ пишется в адрес: `?tab=general` и голый адрес — одно
    // состояние, две записи истории на один экран ломали бы «назад».
    await expect(page).toHaveURL(new RegExp(`objects/${object.id}/?$`))
    await expect(page.getByRole('tab', { name: 'Общие данные' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(generalCard(page)).toBeVisible()

    await expect(page.getByRole('tab')).toHaveCount(3)
    for (const label of ['Общие данные', 'Посты и секторы', 'История']) {
      await expect(page.getByRole('tab', { name: label })).toBeVisible()
    }

    await page.getByRole('tab', { name: 'История' }).click()
    await expect(page).toHaveURL(/\?tab=history$/)
    await expect(page.getByRole('tab', { name: 'История' })).toHaveAttribute('aria-selected', 'true')
    // Содержимое именно СМЕНИЛОСЬ, а не добавилось: поля общей вкладки ушли.
    await expect(generalCard(page)).toHaveCount(0)

    await page.reload()
    await expect(page.getByRole('tab', { name: 'История' })).toHaveAttribute('aria-selected', 'true')
    await expect(generalCard(page)).toHaveCount(0)

    await page.getByRole('tab', { name: 'Посты и секторы' }).click()
    await expect(page).toHaveURL(/\?tab=posts$/)
    await expect(generalCard(page)).toHaveCount(0)
  })

  test('набранный черновик переживает уход на другую вкладку', async ({ page }) => {
    // Объект с НЕПУСТЫМ паспортом, а не первый попавшийся (Plane №196):
    // предмет пробы — набранный черновик в поле сектора, а у объекта без
    // секторов полей нет вовсе, и проба падала на «поле не найдено», не
    // добравшись до своего вопроса. Первым в реестре стоит «Отан» —
    // объект заказчика, паспорт которого никто не заполнял.
    const snapshot = await registry(await apiToken())
    const object = requireFixture(
      snapshot.results.find((row) => row.sectors.length > 0),
      'объект с непустым паспортом (секторы и посты)',
    )

    await signIn(page)
    await page.goto(`${APP}${SCREEN}/${object.id}?tab=posts`)
    const sector = page.getByRole('textbox').first()
    await expect(sector).toBeVisible({ timeout: 15_000 })

    const typed = `черновик проба ${object.code}`
    await sector.fill(typed)

    // Уход и возврат: несохранённое обязано остаться. Вкладка, которая
    // размонтирует форму, стёрла бы набранное молча — человек увидел бы
    // прежние посты и не узнал, что его правку выбросили.
    await page.getByRole('tab', { name: 'Общие данные' }).click()
    await expect(generalCard(page)).toBeVisible()
    await page.getByRole('tab', { name: 'Посты и секторы' }).click()

    await expect(page.getByRole('textbox').first()).toHaveValue(typed)
    // На сервер это не уехало: черновик правится локально, PATCH шлёт кнопка.
    const fresh = await registry(await apiToken())
    expect(fresh.results.find((row) => row.id === object.id)?.name).toBe(object.name)
  })

  test('старые ссылки на макеты открывают общие данные и сохраняют возврат в реестр', async ({ page }) => {
    const snapshot = await registry(await apiToken())
    const object = requireFixture(snapshot.results[0], 'объект для проверки старых ссылок')
    const back = 'tab=own&search=объект'
    await signIn(page)
    for (const tab of ['infra', 'check', 'groups']) {
      await page.goto(`${APP}${SCREEN}/${object.id}?${new URLSearchParams({ tab, back })}`)
      await expect(generalCard(page)).toBeVisible()
      await expect(page.getByRole('tab', { name: 'Общие данные' })).toHaveAttribute('aria-selected', 'true')
      await page.getByRole('tab', { name: 'Посты и секторы' }).click()
      expect(new URL(page.url()).searchParams.get('back')).toBe(back)
      await expect(page.getByRole('link', { name: '← Назад к реестру' })).toHaveAttribute('href', `${SCREEN}?${back}`)
    }
  })

  test('снимок объекта загружается с шапки паспорта (Plane SJ-1049)', async ({ page }) => {
    // Своя карточка КАТАЛОГА — не визита: снимок переживает конкретное ОМ,
    // грузится один раз с шапки паспорта. Проба стережёт: плейсхолдер до
    // загрузки (иконка, не <img>), кнопка меняет подпись «Загрузить» →
    // «Заменить», <img> после загрузки указывает на своё файловое хранилище,
    // и снимок ДОЕЗЖАЕТ до конверта реестра — не только до карточки.
    const snapshot = await registry(await apiToken())
    const object = snapshot.results[0]
    expect(object, 'в реестре нет ни одного объекта — проба вакуумна').toBeDefined()

    await signIn(page)
    await page.goto(`${APP}${SCREEN}/${object!.id}`)
    await expect(generalCard(page)).toBeVisible({ timeout: 15_000 });

    const fileInput = page.getByLabel(`Снимок объекта ${object!.name}`);
    const uploadLabel = page.getByText(/^(Загрузить снимок|Заменить снимок)$/);
    await expect(uploadLabel).toBeVisible();
    const wasEmpty = (await uploadLabel.textContent()) === 'Загрузить снимок';
    // Прошлый прогон этой самой пробы мог уже оставить снимок на объекте —
    // `src` ДО загрузки снят заранее, чтобы дождаться, что он ИЗМЕНИЛСЯ, а не
    // просто «виден» (старый `<img>` виден и без новой загрузки — ассерт по
    // одной видимости читал бы предыдущий прогон за этот).
    const img = page.locator('img[alt=""]').first();
    const srcBefore = wasEmpty ? null : await img.getAttribute('src');

    // 1×1 PNG в памяти — файл на диске пробе не нужен.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    await fileInput.setInputFiles({ name: 'probe.png', mimeType: 'image/png', buffer: png });

    if (wasEmpty) {
      await expect(page.getByText('Заменить снимок')).toBeVisible({ timeout: 15_000 });
      await expect(img).toBeVisible({ timeout: 15_000 });
    } else {
      await expect
        .poll(() => img.getAttribute('src'), { timeout: 15_000 })
        .not.toBe(srcBefore);
    }
    const src = await img.getAttribute('src');
    expect(src, 'снимок должен указывать на своё файловое хранилище').toMatch(
      /\/media\/security-objects\/photos\//,
    );

    // Сервер, а не только экран: снимок пришёл в конверт реестра.
    const after = await registry(await apiToken());
    const updated = after.results.find((row) => row.id === object!.id);
    expect(updated?.photoUrl).toBe(src);
  });

  test('читатель паспорта не получает действие загрузки снимка (Plane SJ-1049)', async ({
    page,
  }) => {
    const snapshot = await registry(await apiToken())
    const object = snapshot.results[0]
    expect(object, 'в реестре нет ни одного объекта — проба вакуумна').toBeDefined()

    await signIn(page)
    await page.route('**/api/operations/my-permissions/**', (route) =>
      route.fulfill({ json: { permissions: ['object.view'], roles: [] } }),
    )
    await page.goto(`${APP}${SCREEN}/${object!.id}`)
    await expect(page.getByRole('heading', { name: object!.name })).toBeVisible({ timeout: 15_000 })

    await expect(page.getByLabel(`Снимок объекта ${object!.name}`)).toHaveCount(0)
    await expect(page.getByText(/^(Загрузить снимок|Заменить снимок)$/)).toHaveCount(0)
  })

  test('общие данные и срок проверки идут от сервера', async ({ page }) => {
    const snapshot = await registry(await apiToken())
    // Объект ищем ЗАПРОСОМ: свежесть у первой строки конверта может случайно
    // совпасть со своей, и подмена «взять первую» осталась бы незамеченной.
    const dated = snapshot.results.find((row) => {
      const own = snapshot.freshness.find((f) => f.objectId === row.id)
      const first = snapshot.freshness[0]
      return own?.verificationDueAt != null && own.verificationDueAt !== first?.verificationDueAt
    })
    expect(
      dated,
      'у всех объектов один срок проверки — сверка «свой, а не первый» вакуумна',
    ).toBeDefined()
    const own = snapshot.freshness.find((f) => f.objectId === dated!.id)!

    await signIn(page)
    await page.goto(`${APP}${SCREEN}/${dated!.id}`)
    await expect(generalCard(page)).toBeVisible({ timeout: 15_000 })

    await expect(field(page, 'Регистрационный №')).toContainText(dated!.code)
    await expect(field(page, 'Тип')).toContainText(dated!.type)
    await expect(field(page, 'Регион')).toContainText(dated!.region)
    await expect(field(page, 'Адрес')).toContainText(dated!.address)
    await expect(field(page, 'Срок проверки')).toContainText(own.verificationDueAt!)
    await expect(field(page, 'Есть охранные мероприятия')).toContainText(
      dated!.hasSecurityEvents ? 'да' : 'нет',
    )
  })

  test('баннер неготовности повторяет вердикт сервера, а не рисуется всегда', async ({ page }) => {
    const snapshot = await registry(await apiToken())
    const ready = snapshot.results.find(
      (row) =>
        row.passportState === 'GREEN' &&
        snapshot.freshness.find((f) => f.objectId === row.id)?.state === 'FRESH',
    )
    const notReady = snapshot.results.find((row) => {
      const state = snapshot.freshness.find((f) => f.objectId === row.id)?.state
      return row.passportState !== 'GREEN' || state === 'OVERDUE' || state === 'NO_PUBLISHED_VERSION'
    })
    // Обе стороны обязаны найтись: с одной проба доказывает только половину.
    expect(ready, 'нет готового объекта — молчание баннера не проверяется').toBeDefined()
    expect(notReady, 'нет неготового объекта — появление баннера не проверяется').toBeDefined()

    await signIn(page)

    await page.goto(`${APP}${SCREEN}/${notReady!.id}`)
    const banner = page.getByRole('status').first()
    await expect(banner).toBeVisible({ timeout: 15_000 })
    await expect(banner).toContainText('Паспорт:')

    await page.goto(`${APP}${SCREEN}/${ready!.id}`)
    await expect(page.getByRole('heading', { name: ready!.name })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('status')).toHaveCount(0)
  })

})
