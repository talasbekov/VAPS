/**
 * Этап «Расстановка» карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на один вопрос: дерево «сектор → посты» и карточка поста
 * стоят на настоящих данных расчёта и на живых мутациях назначения — счётчик
 * заполненности меняется от РЕАЛЬНОГО назначения, а не от локального стейта.
 *
 * Мероприятие берётся с живого стенда — зашитых id нет, стенд пересевается.
 * Если ОМ на стадии «Расстановка» нет, проба СКИПАЕТСЯ (молча не зеленеет).
 * Подготовить такое ОМ можно через API: создать → bulletin/complete →
 * recon/import-from-passport → отметить чек-лист → recon/complete. Дальше
 * ничего: «Потребность» и «Запрос сил» проходит сервер сам (Plane №110), и
 * завершение осмотра оставляет ОМ уже на «Расстановке».
 *
 * Без SMOKE_LIVE=1 скипается: нужен стек Django :8100 + Next :3106.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { requireFixture } from './fixtures'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function apiToken(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = (await res.json()) as { access?: string }
  if (body.access === undefined) throw new Error('нет токена стенда')
  return body.access
}

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'расстановка' : 'расстановка (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('дерево постов и назначение идут от живого расчёта', async ({ page, request }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    const token = await apiToken(STAND_USERNAME, STAND_PASSWORD)
    const auth = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }

    // Берём ОМ на стадии расстановки; расчёт постов заводим сами, чтобы проба
    // не зависела от того, что осталось в БД от прошлых прогонов.
    // Стадию фильтрует СЕРВЕР: на растущем реестре стенда фикстура уходит со
    // первой страницы, и проба молча превращается в skip.
    const list = (await (
      await request.get(`${API}/api/ops/security-events/?page_size=50&stage=PLACEMENT`, {
        headers: auth,
      })
    ).json()) as { results: { id: string; code: string; stage: string }[] }
    const target = list.results[0]
    requireFixture(target, 'мероприятие на стадии «Расстановка»')
    const eventId = target!.id

    const before = (await (
      await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
    ).json()) as {
      reconSectorPosts: { id: string; sector: string; post: string; need: number }[]
      placementAssignments: { id: string }[]
    }
    test.skip(before.reconSectorPosts.length === 0, 'у ОМ нет расчёта постов')
    const post = before.reconSectorPosts[0]

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${eventId}/`)
    // Карточка этапа ищется по ИМЕНИ ОБЛАСТИ: видимый заголовок снят как
    // повтор шапки страницы (Plane №70).
    const card = page.getByRole('region', { name: 'Расстановка сил' })
    await expect(card).toBeVisible({ timeout: 15_000 })

    // Дерево слева перечисляет ИМЕННО посты расчёта, а не выдумку экрана
    const postButton = page.getByRole('button', { name: new RegExp(post.post) }).first()
    await expect(postButton).toBeVisible()
    await postButton.click()

    // Карточка показывает выбранный пост, его сектор и заполненность
    const panel = page.locator('section', { hasText: 'Требования поста' }).first()
    await expect(panel).toContainText(post.post)
    await expect(panel).toContainText(post.sector)
    await expect(panel).toContainText(`из ${post.need}`)

    // Правая колонка подбора — из прототипа: заголовок, чипы пула, кандидаты
    await expect(page.getByText('Доступные сотрудники')).toBeVisible()
    // Подзаголовок сменился осознанно (Plane №110): вместо «Подбор по
    // требованиям поста» колонка называет ПРОИСХОЖДЕНИЕ пула. Форм потребности
    // и выделения сил на шаге больше нет, и без этой строки человек не узнал
    // бы, почему в подборе именно эти люди. Пин стережёт, что строка есть и
    // говорит об одном из двух оснований, а не что она вообще какая-то.
    await expect(
      page.getByText(/Состав мероприятия: те, кого штаб принял|Кадровый список: состав мероприятия ещё не собран/)
    ).toBeVisible()
    // Путь к сбору состава — из снятого бокса «выделение сил»: пул собирают там.
    await expect(
      page.getByRole('main').getByRole('link', { name: /Сбор сил на ОМ/ })
    ).toBeVisible()
    await expect(page.getByText(/Выделено \d+/)).toBeVisible()
    await expect(page.getByText(/Совпадение \d+%/).first()).toBeVisible()

    // Сводка шага — шесть показателей прототипа
    for (const label of ['постов', 'требуется', 'назначено', 'свободно', 'незаполнено', 'конфликтов']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible()
    }

    // Назначение — живая мутация: счётчик в дереве растёт, и бэк это видит
    const assignedBefore = (
      await (
        await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
      ).json()
    ).placementAssignments.length as number

    // Назначение — клик по кандидату в правой колонке (как в прототипе)
    await page.locator('aside button', { hasText: 'Совпадение' }).first().click()

    await expect
      .poll(async () => {
        const fresh = (await (
          await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
        ).json()) as { placementAssignments: { id: string }[] }
        return fresh.placementAssignments.length
      }, { timeout: 15_000 })
      .toBe(assignedBefore + 1)

    // Снимаем назначение обратно — проба не оставляет за собой мусор
    await page.getByRole('button', { name: 'Удалить с поста' }).first().click()
    await expect
      .poll(async () => {
        const fresh = (await (
          await request.get(`${API}/api/ops/security-events/${eventId}/`, { headers: auth })
        ).json()) as { placementAssignments: { id: string }[] }
        return fresh.placementAssignments.length
      }, { timeout: 15_000 })
      .toBe(assignedBefore)

    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })

  test('отбор по рейтингу уходит НА СЕРВЕР, а не фильтрует страницу', async ({
    page,
    request,
  }) => {
    // Дефект, ради которого шаг делался (Plane №67): панель отбирала по
    // рейтингу в пределах ЗАГРУЖЕННОЙ страницы, и «нет кандидатов» означало
    // «нет на этой странице». Отличить это от правды с экрана было нельзя.
    //
    // Проба стережёт ровно наблюдаемое следствие переезда: выбор полосы
    // ОТПРАВЛЯЕТ запрос кадров с `rating_band`. Вернётся клиентская фильтрация
    // — параметра не будет, и проба покраснеет.
    const auth = { Authorization: `Bearer ${await apiToken(STAND_USERNAME, STAND_PASSWORD)}` }
    const events = (await (
      await request.get(`${API}/api/ops/security-events/?stage=PLACEMENT`, { headers: auth })
    ).json()) as { results: { id: string; forceRoster?: unknown[] }[] }
    // Мероприятие берётся с ПУСТЫМ составом, и это не придирка к фикстуре.
    // При непустом составе доска СОЗНАТЕЛЬНО не ходит в кадровую ручку вовсе:
    // кандидаты — принятые штабом люди, они уже пришли карточкой ОМ, и отбор
    // по ним идёт на клиенте (см. РЙ-5). Тогда `rating_band` не уходит никуда
    // — не потому, что отбор вернулся на страницу, а потому, что кадровую
    // базу здесь не спрашивают.
    //
    // Первая редакция пробы брала ПЕРВОЕ попавшееся мероприятие и на составном
    // падала с сообщением «отбор не ушёл на сервер» — то есть врала о причине.
    // Поймано соседней сессией: в блоке красная, в одиночку зелёная, потому
    // что соседние пробы меняют порядок мероприятий в реестре.
    const withoutRoster = events.results.filter(
      (event) => (event.forceRoster ?? []).length === 0,
    )
    test.skip(
      withoutRoster.length === 0,
      'на стенде нет ОМ на расстановке БЕЗ состава — кадровую базу спрашивать неоткуда',
    )
    const eventId = withoutRoster[0].id

    const asked: string[] = []
    page.on('request', (req) => {
      const url = new URL(req.url())
      if (url.pathname === '/api/ops/personnel/') asked.push(url.search)
    })

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${eventId}/`)
    const aside = page.locator('aside')
    await expect(aside.getByLabel('Фильтр по рейтингу')).toBeVisible({ timeout: 25_000 })

    asked.length = 0
    await aside.getByLabel('Фильтр по рейтингу').selectOption('9,0–10,0')

    await expect
      .poll(() => asked.some((query) => query.includes('rating_band=9_10')), {
        timeout: 15_000,
        // Сообщение обязано отличать «ушло не то» от «не спрашивали вовсе»:
        // без этого «не ушёл на сервер» читается как приговор коду. Факты
        // печатает ассерт ниже — `poll` принимает только строку.
        message: 'отбор по рейтингу не ушёл на сервер (запросы ниже)',
      })
      .toBe(true)
    expect(asked, 'запросы кадровой ручки после выбора полосы').not.toEqual([])

    // И то же для порядка: ранжирование по баллу считает сервер по всей базе
    // (решение заказчика 26.08.2026), а не страница сама себя.
    asked.length = 0
    await aside.getByLabel('Сортировка кандидатов').selectOption('По рейтингу')

    await expect
      .poll(() => asked.some((query) => query.includes('ordering=rating')), {
        timeout: 15_000,
        message: 'порядок по баллу не ушёл на сервер (запросы ниже)',
      })
      .toBe(true)
  })
})
