/**
 * Срок сдачи списка у заявки департаменту — ЖИВОЙ стенд (Plane №287).
 *
 * На эталоне заказчика у заявки есть колонка «Срок» (дата со временем, за
 * сутки до мероприятия). Такого поля не было в системе ВООБЩЕ: экран честно
 * показывал «Дату ОМ» и оговаривался, что срока не существует. Теперь он
 * существует — и проба стережёт, что он ДОЕХАЛ ДО ЭКРАНА, а не остался в API.
 *
 * Проверяются обе стороны правила:
 *   1) срок напечатан у заявки;
 *   2) вышедший срок назван СЛОВОМ «Просрочено», а не только цветом — цвет не
 *      читается вспомогательными технологиями и не отвечает «что не так».
 *
 * Заявка заводится СВОЯ, с заведомо прошедшим сроком: ждать, пока просрочится
 * стендовая, проба не может, а брать чужую — значит зависеть от того, что с
 * ней сделал сосед.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: STAND_USERNAME,
      password: STAND_PASSWORD,
      json: 'true',
    },
  })
}

interface Fixture {
  code: string
  departmentName: string
}

async function seedOverdueRequest(token: string): Promise<Fixture> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, payload: await res.json().catch(() => ({})) }
  }

  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.payload.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  expect(object, 'на стенде нет объекта с опубликованным паспортом').toBeDefined()

  const created = await call('POST', '/api/ops/security-events/', {
    title: 'Проба срока сдачи (e2e)',
    objectId: object.id,
    businessDate: '2027-07-01',
    kind: 'INTERNAL',
  })
  expect(created.status, JSON.stringify(created.payload)).toBe(201)
  const base = `/api/ops/security-events/${created.payload.id}`

  // Потребность считается с рекогносцировки: без числа делить нечего и
  // раскладка отбивается.
  await call('PATCH', `${base}/bulletin/`, {
    briefDescription: 'Проба срока.',
    initialTasks: '—',
  })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
  const afterImport = await call('GET', `${base}/`)
  await call('PATCH', `${base}/recon/`, {
    checklist: afterImport.payload.reconChecklist.map(
      (item: Record<string, unknown>) => ({ ...item, done: true, result: 'MATCHES' }),
    ),
    sectorPosts: afterImport.payload.reconSectorPosts.map(
      (post: Record<string, unknown>, index: number) =>
        index === 0 ? { ...post, need: 2 } : post,
    ),
  })
  await call('POST', `${base}/recon/complete/`)

  // 🔴 ОТБОР ПО ТИПУ ДЕЛАЕТСЯ ЗДЕСЬ, а не параметром: `?type_code=department`
  // ручка справочника ИГНОРИРУЕТ и отдаёт всё дерево (проверено curl: первой
  // строкой приезжает организация «Служба»). Заявку такому «департаменту»
  // сервер отбивает 400 «Такого департамента нет в справочнике». Дефект
  // фильтра заведён отдельной карточкой; проба на нём падать не вправе.
  const departments = await call('GET', '/api/core/divisions/?page_size=200')
  const department = (departments.payload.results ?? []).find(
    (row: { type_code?: string }) => row.type_code === 'department',
  )
  expect(department, 'в справочнике нет ни одного департамента').toBeDefined()

  // СРОК В ПРОШЛОМ — суть пробы: «Просрочено» иначе не увидеть, а ждать сутки
  // проба не может.
  const split = await call('POST', `${base}/forces/allocation/`, {
    rows: [
      {
        departmentId: String(department.id),
        need: 1,
        dueAt: '2020-01-01T10:00',
      },
    ],
  })
  expect(split.status, JSON.stringify(split.payload)).toBe(200)
  const row = split.payload.forceAllocation[0]
  expect(row.dueAt, 'сервер не сохранил срок').toBeTruthy()
  expect(row.overdue, 'заявка с прошедшим сроком не помечена просроченной').toBe(true)

  return { code: created.payload.code, departmentName: row.departmentName }
}

test.describe('заявки департаменту: срок сдачи', () => {
  test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

  test('срок напечатан, а вышедший назван словом «Просрочено»', async ({ page }) => {
    const fixture = await seedOverdueRequest(await apiToken())

    await signIn(page)
    await page.goto(`${APP}/employees?view=forces`)
    const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
    await expect(tab).toBeVisible({ timeout: 30_000 })
    await tab.click()

    const section = page.locator('section[aria-labelledby="department-requests-heading"]')
    await expect(
      section.getByRole('heading', { name: 'Заявки департаменту' }),
    ).toBeVisible({ timeout: 30_000 })

    // (1) КОЛОНКА ЕСТЬ. «Дата ОМ» осталась рядом: это разные вопросы, и обе
    // подписи проверяются вместе — иначе «добавил колонку» могло бы означать
    // «переименовал старую».
    // Заголовки ищутся ПО ТЕКСТУ в шапке таблицы, а не ролью `columnheader`:
    // примитив таблицы рисует `<th>` без `scope`, роли у них нет, и
    // `getByRole('columnheader')` находит ноль элементов на любом составе
    // колонок (та же яма, что у дней недели календаря в №258).
    const head = section.locator('thead tr').first()
    await expect(head).toContainText('Срок сдачи')
    await expect(head).toContainText('Дата ОМ')

    // (2) СТРОКА ЗАЯВКИ НАЗЫВАЕТ ПРОСРОЧКУ СЛОВОМ.
    const row = section.locator('tbody tr', { hasText: fixture.code })
    await expect(row, `строки заявки ${fixture.code} нет в таблице`).toHaveCount(1)
    await expect(row.getByText('Просрочено', { exact: true })).toBeVisible()
    // Сам срок напечатан датой со временем, а не сырой ISO-строкой.
    await expect(row).toContainText('01.01.2020')
  })
})
