/**
 * Возврат к расстановке с шага «Согласование», пока документ — черновик
 * (Plane №861).
 *
 * 🔴 ЧТО СТЕРЕЖЁТ ЭТА ПРОБА. По `[СОГ-04]` (задачи №533 и №536) сервер правит
 * расстановку, пока документ ЧЕРНОВИК или ВОЗВРАЩЁН: заморозка ключится на
 * статус документа, а не на этап объекта. Но объект уходит на «Согласование»
 * САМИМ завершением расстановки — то есть штатно оказывается на этапе, где
 * документ ещё никому не отправлен, а править его можно.
 *
 * Экранного пути к этой правке не было НИ У КОГО: без права `event.stage_override`
 * параметр `?step=` не действовал вовсе, а с правом панель расстановки
 * показывалась `inert` — смотреть можно, трогать нельзя. Половина «стало» двух
 * закрытых карточек была проверяема только запросом к API, и заказчик, читая
 * записку «черновик правится свободно», открыл бы карточку и не нашёл, куда
 * нажать.
 *
 * Проба ведёт путь ЧЕЛОВЕКА и заканчивается ответом СЕРВЕРА: находит кнопку,
 * нажимает, снимает человека с поста и сверяет, что назначений на сервере
 * стало меньше. Ассерт «панель видна» доказывал бы только разметку — а предмет
 * карточки в том, что правка ДОХОДИТ.
 *
 * Права подменяются ответом ручки БЕЗ `event.stage_override` намеренно: именно
 * оператор без админского обхода этапов и был заперт.
 */
import { expect, test } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { prepareDemandEvent } from './prepare-events'
import { uniqueBusinessDate } from './business-date'
import { assertStep } from './fixture-step'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  const body = (await res.json()) as { access?: string }
  if (!body.access) throw new Error('стенд не выдал токен — проверять нечего')
  return body.access
}

function standCall(token: string) {
  return async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // Шаг подготовки, отбитый сервером, роняет пробу СРАЗУ и со своей причиной
    // (Plane №812): молча пропущенный шаг уводит разбор к разметке.
    await assertStep(res, method, path)
    return res.json().catch(() => ({}))
  }
}

/**
 * ОМ, доведённый до «Согласования» с документом-ЧЕРНОВИКОМ.
 *
 * Своё мероприятие безусловно (№822): проба СНИМАЕТ человека с поста, то есть
 * правит состояние, а на общей фикстуре стенда отняла бы работу у соседей.
 * Своя деловая дата — по той же причине: занятость считается по дате.
 */
async function prepareDraftOnApproval(token: string) {
  const call = standCall(token)
  const { id } = await prepareDemandEvent(token, uniqueBusinessDate())
  const base = `/api/ops/security-events/${id}`
  const event = await call('GET', `${base}/`)
  const posts = event.reconSectorPosts as { id: string }[]
  expect(posts.length, 'у пробного ОМ нет постов — расставлять некого').toBeGreaterThan(0)
  // На КАЖДЫЙ пост по человеку: `placement/complete/` отбивает 409
  // `PLACEMENT_UNDERSTAFFED`, пока хоть один пост пуст, и обходить это
  // `override` в подготовке значило бы завести фикстуру, отличающуюся от
  // штатного пути ровно тем, что проверяет проба.
  const roster = await call('GET', `/api/ops/personnel/?page_size=${posts.length + 5}`)
  const people = roster.results as { id: string }[]
  expect(
    people.length,
    'в кадрах стенда меньше людей, чем постов у пробного ОМ — расставить некого',
  ).toBeGreaterThanOrEqual(posts.length)
  for (const [index, post] of posts.entries()) {
    await call('POST', `${base}/placement/assign/`, {
      postId: post.id,
      employeeId: people[index]!.id,
    })
  }
  await call('POST', `${base}/placement/complete/`)

  const afterComplete = await call('GET', `${base}/`)
  const visit = (afterComplete.visitObjects ?? [])[0]
  // Сторож фикстуры: проба про состояние «этап APPROVAL, документ DRAFT».
  // Без него она молча проверяла бы что-нибудь другое.
  expect(visit, 'у пробного ОМ нет объекта посещения — этапов объекта нет').toBeTruthy()
  expect(visit.stage, 'объект не ушёл на согласование завершением расстановки').toBe('APPROVAL')
  expect(
    visit.documentStatus,
    'документ объекта не черновик — правка и должна быть закрыта',
  ).toBe('DRAFT')
  const assignments = (afterComplete.placementAssignments ?? []) as { id: string }[]
  expect(assignments.length, 'на постах никого — снимать некого').toBeGreaterThan(0)
  return { id, visitId: visit.id as string, assigned: assignments.length }
}

test.use({ serviceWorkers: 'block' })

test.describe(
  LIVE ? 'расстановка правится с шага «Согласование»' : 'расстановка правится с шага «Согласование» (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'живая проба — нужен SMOKE_LIVE=1')

    test('черновик правится с шага «Согласование» и БЕЗ права обхода этапов', async ({
      page,
    }) => {
      const token = await apiToken()
      const fixture = await prepareDraftOnApproval(token)

      // Права — «ведёт мероприятие и расставляет людей, обхода этапов нет».
      // Заводить такую роль на стенде ради пробы значило бы менять данные
      // стенда ради проверки экрана.
      await page.route(
        (url) => url.pathname.includes('/api/operations/my-permissions/'),
        async (route) =>
          route.fulfill({
            json: {
              permissions: [
                'event.view',
                'event.manage',
                'placement.manage',
                'status.view',
                'personnel.view',
              ],
            },
          }),
      )

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

      await page.goto(
        `${APP}/security-ops/events/${fixture.id}?visit=${encodeURIComponent(fixture.visitId)}`,
      )

      // 1. ДОРОГА НАЗАД ВИДНА. Ссылка, а не спрятанный адрес: человек, который
      //    не знает про `?step=`, обязан найти путь глазами.
      const fix = page.locator('[data-slot="fix-placement"]')
      await expect(
        fix,
        'на шаге «Согласование» нет пути к правке расстановки, хотя документ — черновик',
      ).toBeVisible({ timeout: 30_000 })
      await fix.click()

      // 2. БАННЕР ГОВОРИТ ПРАВДУ. Жёлтый «форма только для чтения» над живой
      //    формой был бы прямой неправдой — состояние у баннера своё.
      const notice = page.locator('[data-slot="stage-view-notice"]')
      await expect(notice).toHaveAttribute('data-editing', 'true')
      await expect(notice).toContainText('Правка расстановки открыта')

      // 3. ПРАВКА ДОХОДИТ ДО СЕРВЕРА — то, ради чего карточка и заведена.
      const remove = page.getByRole('button', { name: /^Удалить с поста: / }).first()
      await expect(
        remove,
        'панель расстановки открыта, но снять человека нечем — форма погашена',
      ).toBeEnabled({ timeout: 20_000 })
      await remove.click()

      await expect
        .poll(
          async () => {
            const fresh = await standCall(token)(
              'GET',
              `/api/ops/security-events/${fixture.id}/`,
            )
            return (fresh.placementAssignments ?? []).length
          },
          {
            timeout: 20_000,
            message: 'сервер не принял правку расстановки с шага «Согласование»',
          },
        )
        .toBe(fixture.assigned - 1)
    })
  },
)
