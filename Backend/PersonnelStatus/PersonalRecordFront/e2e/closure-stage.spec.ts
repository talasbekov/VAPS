/**
 * «Закрытие и итоги» карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на два вопроса: готовность к закрытию считается по РЕАЛЬНО
 * заполненным итогам направлений, и владелец правила «итоги всех направлений
 * обязательны» — сервер, а не экран. Второе проверяется прямо: с неполными
 * итогами нажимаем «Закрыть», и отказ должен прийти от бэка (экран кнопку не
 * блокирует намеренно — два гарда маскировали бы серверный).
 *
 * Мероприятия берутся с живого стенда, зашитых id нет. Нужны два: одно на
 * стадии «Проведение» (панель закрытия) и одно закрытое (снимок итогов). Нет
 * такого — проба СКИПАЕТСЯ, молча не зеленеет. Подготовить «Проведение» можно
 * через API: создать → bulletin/complete → recon/import-from-passport →
 * чек-лист → recon/complete (он же проходит «Потребность» и «Запрос сил»,
 * Plane №110) → placement/assign на каждый пост → placement/complete →
 * approval/approve → acknowledge каждого →
 * acknowledgement/complete.
 *
 * Само закрытие проба НЕ выполняет: оно необратимо и сделало бы фикстуру
 * одноразовой. Успешный путь закрытия покрыт снимком уже закрытого дела.
 */
import { expect, test, type Page } from '@playwright/test'
import { requireFixture } from './fixtures'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface EventRow {
  id: string
  code: string
  title: string
  stage: string
  businessDate: string
  objectName: string
  passportBinding: { versionNumber: number } | null
  reconSectorPosts: { id: string; post: string; sector: string; need: number }[]
  demandRows: { sector: string }[]
  placementAssignments: { postId: string }[]
  journalEntries: { type: string; title: string }[]
  closureDirectionSummaries: { direction: string; summary: string }[]
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  const body = (await res.json()) as { access?: string }
  if (body.access === undefined) throw new Error('нет токена стенда')
  return body.access
}

/** Стадию фильтрует СЕРВЕР: реестр стенда растёт от прогона к прогону, и
 * поиск фикстуры по первой странице однажды перестаёт её находить — проба
 * тогда молча уходит в skip и больше ничего не сторожит. */
async function events(token: string, stage = ''): Promise<EventRow[]> {
  const query = `page_size=50${stage === '' ? '' : `&stage=${stage}`}`
  const res = await fetch(`${API}/api/ops/security-events/?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

/** Одно мероприятие по id: проверять состояние после операции выборкой из
 * реестра нельзя — на растущем стенде строка уезжает со первой страницы, и
 * «стадия не сдвинулась» превращается в `undefined`. */
async function eventDetail(token: string, id: string): Promise<EventRow> {
  const res = await fetch(`${API}/api/ops/security-events/${id}/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return (await res.json()) as EventRow
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'закрытие и итоги' : 'закрытие и итоги (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('итог одной строкой, инциденты и один необязательный комментарий', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    const token = await apiToken()
    const target = requireFixture(
      (await events(token, 'CONDUCT'))[0],
      'мероприятие на стадии «Проведение»',
    )
    const detail = (await eventDetail(token, target.id)) as EventRow & {
      closureSummary: { posts: number; need: number; assigned: number; incidents: number }
    }

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const panel = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Закрытие и итоги' }),
    })
    await expect(panel).toBeVisible({ timeout: 15_000 })

    // `[ЗАК-01]` (Plane №448): итог одной строкой — из сводки сервера.
    const line = panel.locator('[data-slot="closure-summary-line"]')
    await expect(line).toContainText(`Постов ${detail.closureSummary.posts}`)
    await expect(line).toContainText(
      `назначено ${detail.closureSummary.assigned} из ${detail.closureSummary.need}`,
    )
    await expect(line).toContainText(`инцидентов ${detail.closureSummary.incidents}`)

    // `[ЗАК-04]`: комментарий один и необязательный; обязательных итогов по
    // направлениям больше нет (🔴 мутация: вернуть поля «<направление> *»).
    await expect(panel.getByLabel('Итоговый комментарий (необязательно)')).toBeVisible()
    await expect(panel.getByText(/готовы$/)).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Закрыть мероприятие' })).toBeEnabled()

    // `[ЗАК-03]`: панель инцидентов — список или «Инцидентов не было»,
    // «+ Добавить» открывает форму с временем, постом, описанием и мерами.
    const incidents = page.locator('[data-slot="incidents-panel"]')
    await expect(incidents).toBeVisible()
    if (detail.closureSummary.incidents === 0) {
      await expect(incidents.locator('[data-slot="incidents-empty"]')).toHaveText('Инцидентов не было')
    } else {
      await expect(incidents.locator('[data-slot="incident-row"]')).toHaveCount(
        detail.closureSummary.incidents,
      )
    }
    await incidents.getByRole('button', { name: '+ Добавить' }).click()
    for (const label of ['Время', 'Пост', 'Описание *', 'Подробности', 'Принятые меры']) {
      await expect(incidents.getByLabel(label)).toBeVisible()
    }
    await incidents.getByRole('button', { name: 'Отмена' }).click()

    // Закрытие проба НЕ выполняет — необратимо; стадия не сдвинулась.
    const after = await eventDetail(token, target.id)
    expect(after.stage).toBe('CONDUCT')
    expect(errors.filter((e) => !e.includes('CLIENT_FETCH_ERROR'))).toEqual([])
  })

  test('архив дела — одна страница с якорями, без лишних карточек', async ({ page }) => {
    const token = await apiToken()
    const target = requireFixture(
      (await events(token, 'CLOSED')).find((e) => e.reconSectorPosts.length > 0),
      'закрытое мероприятие с постами расчёта',
    )

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    // `[ЗАК-10]` (Plane №448): якоря «Итог · Оценки · Инциденты · Документы · История».
    const anchors = page.locator('[data-slot="archive-anchors"]')
    await expect(anchors).toBeVisible({ timeout: 15_000 })
    for (const label of ['Итог', 'Оценки', 'Инциденты', 'Документы', 'История']) {
      await expect(anchors.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    await expect(page.locator('#archive-summary [data-slot="closure-summary-line"]')).toContainText(/Постов \d+ · назначено \d+ из \d+/)
    await expect(page.locator('#archive-incidents')).toBeVisible()
    await expect(page.locator('#archive-documents [data-slot="archive-documents"]')).toContainText('Рекогносцировка')
    await expect(page.locator('#archive-history')).toBeVisible()

    // `[ЗАК-13]`: лишних карточек и надписей нет (🔴 мутация: вернуть любую).
    for (const gone of ['Итоги направлений', 'Карточка, бюллетень, программа', 'Расчёты и заявки']) {
      await expect(page.locator('[data-slot="card-title"]', { hasText: gone })).toHaveCount(0)
    }
    await expect(page.getByText('read-only')).toHaveCount(0)
    await expect(page.getByText('Дело закрыто')).toHaveCount(0)

    // «Скачать дело» (`[ЗАК-11]`, Plane №437) — в шапке архива.
    const caseBlock = page.locator('[data-slot="case-download"]')
    await expect(caseBlock).toBeVisible()
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await caseBlock.getByRole('button', { name: /Скачать дело/ }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^delo-.*\.pdf$/)
  })

  // 🔴 Воркер MSW блокируется ТОЛЬКО здесь: `page.route` в пробе недобора иначе
  // не перехватит запрос карточки. На весь файл ставить нельзя — соседняя проба
  // сторожит пустую консоль, а неудачная регистрация воркера пишет в неё ошибку.
  test.describe('контроль постов', () => {
    test.use({ serviceWorkers: 'block' })

    test('контроль постов считает укомплектованность по живым данным карточки', async ({ page }) => {
      const token = await apiToken()
      const target = requireFixture(
        (await events(token, 'CONDUCT'))[0],
        'мероприятие на стадии «Проведение»',
      )

      // Ожидание считается из ОТВЕТА сервера, а не пишется числом: фикстура
      // стенда меняется, а пин литералом однажды начал бы сторожить прошлое.
      const filledByPost = new Map<string, number>()
      for (const assignment of target.placementAssignments) {
        filledByPost.set(assignment.postId, (filledByPost.get(assignment.postId) ?? 0) + 1)
      }
      const sectors = new Map<string, { filled: number; need: number }>()
      for (const post of target.reconSectorPosts) {
        const row = sectors.get(post.sector) ?? { filled: 0, need: 0 }
        row.filled += filledByPost.get(post.id) ?? 0
        row.need += post.need
        sectors.set(post.sector, row)
      }
      expect(sectors.size, 'фикстуре нужно хотя бы одно направление').toBeGreaterThan(0)

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target.id}/`)
      const panel = page.locator('[data-slot="card"]', {
        has: page.locator('[data-slot="card-title"]', { hasText: 'Контроль постов' }),
      })
      await expect(panel).toBeVisible({ timeout: 15_000 })

      for (const [sector, row] of sectors) {
        const block = panel.getByRole('region', { name: `Направление ${sector}` })
        await expect(block).toContainText(`${row.filled} / ${row.need}`)
        await expect(block).toContainText(row.filled < row.need ? `Недобор ${row.need - row.filled}` : 'Штатно')
      }
      // Посты названы поимённо — панель отвечает «где», а не только «сколько».
      for (const post of target.reconSectorPosts) {
        await expect(
          panel.getByRole('region', { name: `Направление ${post.sector}` }),
        ).toContainText(post.post)
      }
    })

    test('недобор на посту виден, хотя расстановка завершена', async ({ page }) => {
      // Гейт `complete_placement` требует у поста ХОТЯ БЫ ОДНОГО назначенного, а
      // не закрытия по потребности (apps/ops/security_events.py) — пост с
      // `need: 3` и одним человеком проходит на «Проведение». Такого ОМ на
      // стенде сейчас нет, и создавать его цепочкой из десяти вызовов ради
      // одного экрана — значит мутировать данные стенда; потребность поднимается
      // перехватом ОТВЕТА. Сервер такой ответ вернуть может: это его же карточка
      // с другой потребностью, выдуманного состояния здесь нет.
      const token = await apiToken()
      const target = requireFixture(
        (await events(token, 'CONDUCT'))[0],
        'мероприятие на стадии «Проведение»',
      )
      const first = requireFixture(
        target.reconSectorPosts[0],
        'расчёт постов у мероприятия на «Проведении»',
      )

      const detail = await eventDetail(token, target.id)
      const patched = {
        ...detail,
        reconSectorPosts: detail.reconSectorPosts.map((post) =>
          post.id === first.id ? { ...post, need: post.need + 2 } : post,
        ),
      }

      await signIn(page)
      await page.route(
        (url) => url.pathname.endsWith(`/api/ops/security-events/${target.id}/`),
        (route) => route.fulfill({ json: patched }),
      )
      await page.goto(`${APP}/security-ops/events/${target.id}/`)

      const panel = page.locator('[data-slot="card"]', {
        has: page.locator('[data-slot="card-title"]', { hasText: 'Контроль постов' }),
      })
      const block = panel.getByRole('region', { name: `Направление ${first.sector}` })
      await expect(block).toContainText('Недобор 2', { timeout: 15_000 })
      await expect(block).not.toContainText('Штатно')

      // Свод направления читает ИМЕННО потребность, а не число постов: у
      // фикстуры стенда `need` у каждого поста равен единице, и без поднятой
      // потребности эти два числа совпадали бы — ассерт был бы вакуумным.
      const sectorPosts = detail.reconSectorPosts.filter((p) => p.sector === first.sector)
      const sectorFilled = detail.placementAssignments.filter((a) =>
        sectorPosts.some((p) => p.id === a.postId),
      ).length
      const sectorNeed = sectorPosts.reduce((sum, p) => sum + p.need, 0) + 2
      await expect(block).toContainText(`${sectorFilled} / ${sectorNeed}`)

      // Недобор назван на КОНКРЕТНОМ посту, а не только в итоге направления:
      // иначе панель говорила бы «где-то не хватает двоих».
      const filledOnFirst = detail.placementAssignments.filter(
        (a) => a.postId === first.id,
      ).length
      await expect(
        block.getByRole('listitem').filter({ hasText: first.post }),
      ).toContainText(`${filledOnFirst} / ${first.need + 2}`)
    })

    test('неразбираемое время инцидента печатается прочерком, а не Invalid Date', async ({
      page,
    }) => {
      // `occurredAt` приходит из JSON мероприятия КАК ЕСТЬ — сервер хранит его
      // необрезанной строкой, — и `new Date("10:15")` даёт Invalid Date,
      // которую `toLocaleString` печатает буквально (Plane №730). Архив на тех
      // же данных уже показывал «—»: два вида на одни данные расходились.
      //
      // Значение подставляется ПЕРЕХВАТОМ ответа, а не записью в журнал
      // стенда: запись необратима, а предмет пробы — как экран рисует то, что
      // сервер уже способен вернуть.
      const token = await apiToken()
      const target = requireFixture(
        (await events(token, 'CONDUCT'))[0],
        'мероприятие на стадии «Проведение»',
      )

      await page.route(`**/api/ops/security-events/${target.id}/`, async (route) => {
        const response = await route.fetch()
        const body = await response.json()
        body.journalEntries = [
          {
            id: 'probe-bad-time',
            type: 'INCIDENT',
            title: 'Проба неразбираемого времени',
            description: '',
            createdAt: '2026-09-05T07:00:00.000Z',
            occurredAt: '10:15',
            postId: null,
            measures: '',
          },
          ...body.journalEntries,
        ]
        await route.fulfill({ response, json: body })
      })

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target.id}/`)
      const row = page
        .locator('[data-slot="incidents-panel"] [data-slot="incident-row"]')
        .filter({ hasText: 'Проба неразбираемого времени' })
      await expect(row).toBeVisible({ timeout: 15_000 })

      await expect(row).not.toContainText('Invalid Date')
      // Запасное значение то же, что у архива на тех же данных.
      await expect(row).toContainText('—')
    })

    test('пост не остаётся выбранным после записи инцидента', async ({ page }) => {
      // Форма чистила заголовок, описание, меры и время, а ПОСТ оставляла
      // (Plane №731): открыв «+ Добавить» второй раз, человек видел уже
      // выбранным пост ПЕРВОГО инцидента и, заполнив только время и описание,
      // приписывал запись не тому посту.
      //
      // Запись в журнал стенда НЕ делается: ручка перехватывается и отвечает
      // той же карточкой, что вернул бы успех. Предмет пробы — состояние формы
      // ПОСЛЕ успеха, то есть чистая работа клиента; настоящая запись сделала
      // бы пробу одноразовой и оставила бы след на общем стенде.
      const token = await apiToken()
      const target = requireFixture(
        (await events(token, 'CONDUCT'))[0],
        'мероприятие на стадии «Проведение»',
      )
      const post = requireFixture(
        target.reconSectorPosts[0],
        'пост расчёта у мероприятия «Проведения»',
      )

      let journalCalls = 0
      await page.route(
        `**/api/ops/security-events/${target.id}/journal/`,
        async (route) => {
          journalCalls += 1
          const card = await route.fetch({
            url: `${APP}/api/ops/security-events/${target.id}/`,
            method: 'GET',
          })
          await route.fulfill({ response: card })
        },
      )

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target.id}/`)
      const panel = page.locator('[data-slot="incidents-panel"]')
      await expect(panel).toBeVisible({ timeout: 15_000 })

      await panel.getByRole('button', { name: '+ Добавить' }).click()
      const form = panel.locator('[data-slot="incident-form"]')
      await form.getByLabel('Пост').selectOption(post.id)
      await form.getByLabel('Описание *').fill('Проба сброса поста')
      await form.getByRole('button', { name: 'Записать инцидент' }).click()

      // Форма закрылась — успешный путь пройден, а не отвалился молча.
      await expect(form).toBeHidden({ timeout: 15_000 })
      expect(journalCalls, 'ручка журнала обязана была быть вызвана').toBeGreaterThan(0)

      await panel.getByRole('button', { name: '+ Добавить' }).click()
      await expect(
        panel.locator('[data-slot="incident-form"]').getByLabel('Пост'),
      ).toHaveValue('')
    })

    test('инцидент записывается одной дорогой и показывается один раз', async ({
      page,
    }) => {
      // `[ЗАК-03]` требует у инцидента время, пост и принятые меры. «Журнал
      // штаба» на том же экране предлагал тип «Инцидент» в своём списке и слал
      // {type, title, description} — без всего этого (Plane №729): записанный
      // оттуда инцидент выходил неполным, а панель инцидентов рисовала его
      // «— · —». Хуже: общий список журнала показывал ВСЕ записи, поэтому
      // каждый инцидент был на экране дважды.
      const token = await apiToken()
      const target = requireFixture(
        (await events(token, 'CONDUCT'))[0],
        'мероприятие на стадии «Проведение»',
      )

      await page.route(`**/api/ops/security-events/${target.id}/`, async (route) => {
        const response = await route.fetch()
        const body = await response.json()
        body.journalEntries = [
          {
            id: 'probe-one-incident',
            type: 'INCIDENT',
            title: 'Проба единственного показа',
            description: '',
            createdAt: '2026-09-05T07:00:00.000Z',
            occurredAt: '2026-09-05T07:00:00.000Z',
            postId: null,
            measures: '',
          },
          {
            id: 'probe-instruction',
            type: 'INSTRUCTION',
            title: 'Проба указания',
            description: '',
            createdAt: '2026-09-05T07:05:00.000Z',
          },
          ...body.journalEntries,
        ]
        await route.fulfill({ response, json: body })
      })

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target.id}/`)
      const main = page.getByRole('main')
      await expect(main).toBeVisible({ timeout: 15_000 })

      // Инцидент виден РОВНО ОДИН раз на всём экране — в своей панели.
      await expect(main.getByText('Проба единственного показа')).toHaveCount(1)
      await expect(
        page
          .locator('[data-slot="incidents-panel"] [data-slot="incident-row"]')
          .filter({ hasText: 'Проба единственного показа' }),
      ).toHaveCount(1)
      // Прочие записи журнала своего списка не потеряли.
      await expect(main.getByText('Проба указания')).toHaveCount(1)

      // Второй дороги к инциденту на экране нет: в списке типов журнала
      // остались только указание и приказ.
      const journalType = page.locator('#journal-type')
      await expect(journalType).toBeVisible()
      await expect(journalType.locator('option')).toHaveCount(2)
      await expect(journalType).not.toContainText('Инцидент')
    })

    test('архив не обещает приложение к неотправленному документу', async ({
      page,
    }) => {
      // Вторая половина строки «Документы» печаталась БЕЗУСЛОВНО (Plane №732):
      // у объекта, чья «Расстановка сил» не отправлялась, выходило
      // «… · не отправлялась · лист ознакомления в приложении — в деле (PDF
      // выше)». Лист ознакомления — приложение К РАССТАНОВКЕ, и без неё его
      // негде приложить.
      const token = await apiToken()
      const target = requireFixture(
        (await events(token, 'CLOSED')).find((e) => e.reconSectorPosts.length > 0),
        'закрытое мероприятие с постами расчёта',
      )

      await page.route(`**/api/ops/security-events/${target.id}/`, async (route) => {
        const response = await route.fetch()
        const body = await response.json()
        const sample = body.visitObjects[0] ?? {}
        // Два объекта на одной карточке: у одного документ отправлен, у
        // другого нет. Одного не хватило бы — «убрать приложение всегда»
        // прошло бы половину проверки.
        body.visitObjects = [
          {
            ...sample,
            id: 'probe-sent',
            objectName: 'Объект с документом',
            documentVersions: [{ number: 3, status: 'APPROVED', createdAt: '2026-09-01T10:00:00.000Z' }],
          },
          {
            ...sample,
            id: 'probe-unsent',
            objectName: 'Объект без документа',
            documentVersions: [],
          },
        ]
        await route.fulfill({ response, json: body })
      })

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target.id}/`)
      const documents = page.locator('#archive-documents [data-slot="archive-documents"]')
      await expect(documents).toBeVisible({ timeout: 15_000 })

      const unsent = documents.getByRole('listitem').filter({ hasText: 'Объект без документа' })
      await expect(unsent).toContainText('не отправлялась')
      await expect(unsent).not.toContainText('лист ознакомления')

      // А у отправленного приложение обещано как прежде.
      const sent = documents.getByRole('listitem').filter({ hasText: 'Объект с документом' })
      await expect(sent).toContainText('версия 3')
      await expect(sent).toContainText('лист ознакомления в приложении')
    })

    test('неудачный повтор «Скачать дело» не показывает прежнее «сохранено»', async ({
      page,
    }) => {
      // `render.mutate` не чистил `saved` (Plane №698): после удачной первой
      // выгрузки неудачная вторая показывала ОДНОВРЕМЕННО «сохранено:
      // delo-….pdf» и сообщение об ошибке — два взаимоисключающих итога
      // одного действия рядом. Соседний экран согласования так не делает.
      const token = await apiToken()
      const target = requireFixture(
        (await events(token, 'CLOSED')).find((e) => e.reconSectorPosts.length > 0),
        'закрытое мероприятие с постами расчёта',
      )

      // Первый вызов проходит, второй отбивается: предмет пробы — что
      // показывает экран ПОСЛЕ отказа, шедшего за успехом.
      let calls = 0
      await page.route('**/api/ops/event-documents/render/**', async (route) => {
        calls += 1
        if (calls === 1) {
          await route.fallback()
          return
        }
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            error_code: 'INTERNAL_ERROR',
            message: 'Сборка дела не удалась',
          }),
        })
      })

      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${target.id}/`)
      const block = page.locator('[data-slot="case-download"]')
      await expect(block).toBeVisible({ timeout: 15_000 })

      const download = page.waitForEvent('download', { timeout: 60_000 })
      await block.getByRole('button', { name: /Скачать дело/ }).click()
      await download
      await expect(block.getByRole('status')).toContainText('сохранено:')

      await block.getByRole('button', { name: /Скачать дело/ }).click()
      await expect(block.getByRole('alert')).toBeVisible({ timeout: 30_000 })
      // Итог ОДИН: строка успеха ушла вместе с попыткой, которая её породила.
      await expect(block.getByRole('status')).toHaveCount(0)
    })
  })
})
