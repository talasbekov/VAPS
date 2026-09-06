/**
 * Набранный, но не сохранённый ответ департамента переживает соседнюю
 * мутацию (Plane №555).
 *
 * Форма «Ответ департамента» (`[СБС-21]`) наполнялась из ответа сервера
 * эффектом на `[allocation]` — то есть на ИДЕНТИЧНОСТИ объекта. Её меняет
 * любой рефетч, а `split` и `notify` гасят ключ `['ops-department-request',
 * id]` на успехе. Ответственный набирал «Выделяем» с пояснением, не нажимая
 * «Сохранить ответ», жал «Сохранить раскладку» — и набранное молча
 * откатывалось к серверному.
 *
 * 🔴 ОТВЕТ ЗАЯВКИ ПОСЛЕ СОХРАНЕНИЯ ОБЯЗАН ОТЛИЧАТЬСЯ ОТ ПЕРВОГО. TanStack
 * Query по умолчанию делит структуру (`structuralSharing`): на буквально том
 * же теле он вернёт ПРЕЖНИЙ объект, эффект не сработает даже в сломанном
 * коде, и проба была бы зелёной на дефекте. Поэтому подменённая ручка
 * отвечает по-разному до и после `split/` — ровно как живой сервер, который
 * записал новые квоты: `directorates` другие, `allocating` тот же.
 *
 * Красная до правки: поле «Выделяем» после сохранения раскладки пустело.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

const ALLOCATION_ID = 'synthetic-allocation-555'
const EVENT_ID = '900555'
const CODE = 'ОМ-СИНТ-555'

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
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

interface Division {
  id: number
  name: string
  parent: number | null
  type_code: string
  is_active: boolean
}

/**
 * НАСТОЯЩИЙ департамент стенда с действующими управлениями.
 *
 * Справочник оргструктуры НЕ подменяется: его читает не только эта карточка,
 * а поле квоты рисуется лишь у управлений, которые в дереве ЕСТЬ (Plane
 * №530) — с выдуманным департаментом кнопки «Сохранить раскладку» не было бы
 * вовсе, и проба щёлкала бы в пустоту.
 */
async function realDepartmentWithDirectorates(
  token: string,
): Promise<{ departmentId: string; directorateId: string; directorateName: string }> {
  const res = await fetch(`${API}/api/core/divisions/?page_size=200`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const page = (await res.json()) as { results: Division[] }
  const active = page.results.filter((row) => row.is_active)
  const department = active.find(
    (row) =>
      row.type_code === 'department' &&
      active.some((child) => child.parent === row.id && child.type_code === 'directorate'),
  )
  expect(department, 'на стенде нет департамента с действующими управлениями').toBeDefined()
  const directorate = active.find(
    (row) => row.parent === (department as Division).id && row.type_code === 'directorate',
  ) as Division
  return {
    departmentId: String((department as Division).id),
    directorateId: String(directorate.id),
    directorateName: directorate.name,
  }
}

test.describe(
  LIVE ? 'ответ департамента переживает соседнюю мутацию' : 'ответ департамента (скип: нет SMOKE_LIVE=1)',
  () => {
    test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

    test('«Сохранить раскладку» не стирает набранное «Выделяем»', async ({ page }) => {
      const token = await apiToken()
      const { departmentId } = await realDepartmentWithDirectorates(token)
      await signIn(page)

      // Раскладка сохранена — сервер вернул бы ДРУГИЕ `directorates`.
      let splitSaved = false

      const listRow = {
        eventId: EVENT_ID,
        code: CODE,
        title: 'Синтетическое мероприятие 555',
        businessDate: '2026-09-10',
        eventTime: null,
        location: 'Синт. адрес',
        stage: 'PLACEMENT',
        allocationId: ALLOCATION_ID,
        departmentId,
        departmentName: 'Синт. департамент 555',
        need: 5,
        allocating: null,
        assigned: 0,
        status: 'DRAFT',
        dueAt: null,
        overdue: false,
        submittedLate: false,
      }

      await page.route(
        (url) => url.pathname.endsWith('/forces/requests/'),
        (route) => route.fulfill({ json: { results: [listRow] } }),
      )
      await page.route(
        (url) => url.pathname.endsWith(`/forces/requests/${ALLOCATION_ID}/`),
        (route) =>
          route.fulfill({
            json: {
              eventId: EVENT_ID,
              code: CODE,
              title: 'Синтетическое мероприятие 555',
              businessDate: '2026-09-10',
              eventTime: null,
              location: 'Синт. адрес',
              stage: 'PLACEMENT',
              allocation: {
                id: ALLOCATION_ID,
                departmentId,
                departmentName: 'Синт. департамент 555',
                need: 5,
                status: 'DRAFT',
                comment: '',
                // Ответа ещё нет — форма пуста, и всё, что в ней окажется,
                // набрал человек.
                allocating: null,
                answerComment: '',
                notifiedAt: null,
                submittedAt: null,
                decidedAt: null,
                decisionComment: '',
                directorates: splitSaved
                  ? [
                      {
                        id: 'force-directorate-555',
                        divisionId: '999555',
                        name: 'Управление, выбывшее из оргструктуры',
                        need: 4,
                        assigned: 0,
                        notifiedAt: null,
                      },
                    ]
                  : [],
                members: [],
              },
            },
          }),
      )
      await page.route(
        (url) => url.pathname.endsWith(`/forces/allocation/${ALLOCATION_ID}/split/`),
        (route) => {
          splitSaved = true
          return route.fulfill({ json: {} })
        },
      )

      await page.goto(`${APP}/employees?view=forces`)
      const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()
      await page.getByRole('button', { name: new RegExp(`^Открыть заявку ${CODE} `) }).click()

      // Адрес — id полей, а не подпись: «Выделяем» стоит и в метке «В
      // разработке» бокового меню, и `getByLabel` ловит два элемента разом.
      const answerSection = page.locator('section[aria-labelledby="answer-heading"]')
      const allocating = answerSection.locator('#answer-allocating')
      const comment = answerSection.locator('#answer-comment')
      await expect(allocating).toBeVisible({ timeout: 15_000 })
      await allocating.fill('3')
      await comment.fill('людей не хватает')

      // Соседняя мутация: сохранение КВОТ, к ответу отношения не имеющее.
      const splitSection = page.locator('section[aria-labelledby="split-heading"]')
      const quotas = splitSection.locator('input[id^="quota-"]')
      await expect(quotas.first()).toBeVisible({ timeout: 15_000 })
      await quotas.first().fill('4')
      await splitSection.getByRole('button', { name: 'Сохранить раскладку' }).click()

      // Ждём сам рефетч: без него проба проверяла бы состояние ДО отката.
      await expect(
        splitSection.getByText('Управление, выбывшее из оргструктуры'),
        'подменённая ручка не отдала новую раскладку — проверять нечего',
      ).toBeVisible({ timeout: 15_000 })

      await expect(allocating, 'набранное «Выделяем» откатилось к серверному').toHaveValue('3')
      await expect(comment, 'набранный комментарий откатился к серверному').toHaveValue(
        'людей не хватает',
      )
    })

    test('«Сохранить ответ» не стирает набранные КВОТЫ', async ({ page }) => {
      /**
       * 🔴 ВТОРАЯ ПОЛОВИНА ТОГО ЖЕ КЛАССА (доводка по ревью №825). Соседний
       * эффект той же карточки наполнял черновик квот и стоял на
       * `[directorateRows]` — на идентичности массива. Путь «Отправить в
       * управления» залатан обходом (`splitDirty` + «кнопка диалога сперва
       * зовёт save()»), а путь «набрал квоты → нажал „Сохранить ответ“»
       * держался ТОЛЬКО на `structuralSharing`: `respond` меняет `allocating`,
       * а ссылка на `directorates` уцелевает. Основание ненадёжное — сама
       * №555 объявила его таким.
       *
       * Здесь `directorates` НЕ МЕНЯЮТСЯ, а тело ответа меняется (`allocating`
       * стал `3`) — значит `structuralSharing` отдаёт новый объект, и старый
       * код черновик квот сбрасывал. Красная на мутации: вернуть эффекту
       * зависимость `[directorateRows]`.
       */
      const token = await apiToken()
      const { departmentId, directorateId, directorateName } =
        await realDepartmentWithDirectorates(token)
      await signIn(page)

      let answered = false
      const listRow = {
        eventId: EVENT_ID,
        code: CODE,
        title: 'Синтетическое мероприятие 555',
        businessDate: '2026-09-10',
        eventTime: null,
        location: 'Синт. адрес',
        stage: 'PLACEMENT',
        allocationId: ALLOCATION_ID,
        departmentId,
        departmentName: 'Синт. департамент 555',
        need: 5,
        allocating: null,
        assigned: 0,
        status: 'DRAFT',
        dueAt: null,
        overdue: false,
        submittedLate: false,
      }
      await page.route(
        (url) => url.pathname.endsWith('/forces/requests/'),
        (route) => route.fulfill({ json: { results: [listRow] } }),
      )
      await page.route(
        (url) => url.pathname.endsWith(`/forces/requests/${ALLOCATION_ID}/`),
        (route) =>
          route.fulfill({
            json: {
              eventId: EVENT_ID,
              code: CODE,
              title: 'Синтетическое мероприятие 555',
              businessDate: '2026-09-10',
              eventTime: null,
              location: 'Синт. адрес',
              stage: 'PLACEMENT',
              allocation: {
                id: ALLOCATION_ID,
                departmentId,
                departmentName: 'Синт. департамент 555',
                need: 5,
                status: 'DRAFT',
                comment: '',
                // Меняется ТОЛЬКО ответ: раскладка та же и до, и после.
                allocating: answered ? 3 : null,
                answerComment: answered ? 'людей не хватает' : '',
                notifiedAt: null,
                submittedAt: null,
                decidedAt: null,
                decisionComment: '',
                directorates: [
                  {
                    id: 'force-directorate-555b',
                    divisionId: directorateId,
                    name: directorateName,
                    need: 1,
                    assigned: 0,
                    notifiedAt: null,
                  },
                ],
                members: [],
              },
            },
          }),
      )
      await page.route(
        (url) => url.pathname.endsWith(`/forces/allocation/${ALLOCATION_ID}/respond/`),
        (route) => {
          answered = true
          return route.fulfill({ json: {} })
        },
      )

      await page.goto(`${APP}/employees?view=forces`)
      const tab = page.getByRole('tab', { name: 'Заявки', exact: true })
      await expect(tab).toBeVisible({ timeout: 30_000 })
      await tab.click()
      await page.getByRole('button', { name: new RegExp(`^Открыть заявку ${CODE} `) }).click()

      const splitSection = page.locator('section[aria-labelledby="split-heading"]')
      const quota = splitSection.locator('input[id^="quota-"]').first()
      await expect(quota).toBeVisible({ timeout: 15_000 })
      // Набрано ОТЛИЧНОЕ от серверного: иначе откат был бы неотличим.
      await quota.fill('4')

      const answerSection = page.locator('section[aria-labelledby="answer-heading"]')
      await answerSection.locator('#answer-allocating').fill('3')
      await answerSection.locator('#answer-comment').fill('людей не хватает')
      await answerSection.getByRole('button', { name: 'Сохранить ответ' }).click()

      // Ждём сам рефетч: без него проба проверяла бы состояние ДО отката.
      await expect(
        answerSection.locator('#answer-comment'),
        'подменённая ручка не отдала сохранённый ответ — проверять нечего',
      ).toHaveValue('людей не хватает', { timeout: 15_000 })

      await expect(quota, 'набранная квота откатилась к серверной').toHaveValue('4')
    })
  },
)
