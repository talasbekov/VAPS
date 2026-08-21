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
 * чек-лист → recon/complete → demand/approve → forces → placement/assign на
 * каждый пост → placement/complete → approval/approve → acknowledge каждого →
 * acknowledgement/complete.
 *
 * Само закрытие проба НЕ выполняет: оно необратимо и сделало бы фикстуру
 * одноразовой. Успешный путь закрытия покрыт снимком уже закрытого дела.
 */
import { expect, test, type Page } from '@playwright/test'

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
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
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
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

test.describe(LIVE ? 'закрытие и итоги' : 'закрытие и итоги (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('готовность считается по итогам, отказ приходит от сервера', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    const token = await apiToken()
    const conduct = (await events(token, 'CONDUCT'))[0]
    test.skip(conduct === undefined, 'на стенде нет ОМ на стадии «Проведение»')
    const target = conduct!
    const directions = [...new Set(target.reconSectorPosts.map((p) => p.sector))]
    expect(directions.length, 'фикстуре нужно ≥2 направления').toBeGreaterThan(1)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const panel = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Закрытие и итоги' }),
    })
    await expect(panel).toBeVisible({ timeout: 15_000 })

    // Сводка — из живых данных карточки, а не из воздуха
    const need = target.reconSectorPosts.reduce((sum, p) => sum + p.need, 0)
    await expect(panel).toContainText(
      `${target.placementAssignments.length} / ${need}`,
    )
    const incidents = target.journalEntries.filter((e) => e.type === 'INCIDENT').length
    await expect(panel.getByText('инцидентов')).toBeVisible()
    expect(await panel.innerText()).toContain(String(incidents))

    // Готовность стартует с нуля и растёт от РЕАЛЬНО введённого итога
    await expect(panel).toContainText(`0 из ${directions.length} готовы`)
    await expect(panel.getByText('Ожидается').first()).toBeVisible()
    await panel
      .getByLabel(`${directions[0]} *`)
      .fill('Итог направления: замечаний нет.')
    await expect(panel).toContainText(`1 из ${directions.length} готовы`)
    await expect(panel.getByText('Готово').first()).toBeVisible()

    // Владелец правила — сервер: кнопка активна, отказ приходит с бэка.
    // Ассертим ИМЕННО тот канал, который срабатывает: пустой итог ловит
    // валидация поля (400 «Обязательное поле.») ДО проверки полноты
    // направлений (422 CLOSURE_DIRECTIONS_INCOMPLETE) — вторая с этого экрана
    // недостижима, потому что клиент всегда шлёт все направления.
    // Название направления в ассерт не берём: подпись «КПП *» на панели есть
    // и без ошибки, такой ассерт был бы вакуумным.
    const refusal = panel.getByText('Проверьте заполнение формы.')
    await expect(refusal).toBeHidden()
    const closeButton = panel.getByRole('button', { name: 'Закрыть мероприятие' })
    await expect(closeButton).toBeEnabled()
    await closeButton.click()
    await expect(refusal).toBeVisible({ timeout: 15_000 })
    await expect(panel).toContainText('directionSummaries.1.summary')

    // Отказ не сдвинул стадию
    const after = await eventDetail(token, target.id)
    expect(after.stage).toBe('CONDUCT')

    // 400 в консоли — ЭТОТ отказ и есть предмет пробы, он ожидаем;
    // CLIENT_FETCH_ERROR — обрыв навигации NextAuth, не дефект экрана.
    expect(
      errors.filter(
        (e) => !e.includes('CLIENT_FETCH_ERROR') && !e.includes('400 (Bad Request)'),
      ),
    ).toEqual([])
  })

  test('архив дела собирает разделы закрытого ОМ', async ({ page }) => {
    const token = await apiToken()
    const closed = (await events(token, 'CLOSED')).find(
      (e) => e.closureDirectionSummaries.length > 0,
    )
    test.skip(closed === undefined, 'на стенде нет закрытого ОМ с итогами')
    const target = closed!

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const card = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Итоги направлений' }),
    })
    await expect(card).toBeVisible({ timeout: 15_000 })

    const need = target.reconSectorPosts.reduce((sum, p) => sum + p.need, 0)
    await expect(card).toContainText(
      `${target.placementAssignments.length} / ${need}`,
    )
    for (const item of target.closureDirectionSummaries) {
      await expect(card).toContainText(item.direction)
      await expect(card).toContainText(item.summary)
    }

    // Разделы архива — по экрану прототипа «Архив дела». Каждый ассертит
    // ЖИВОЕ значение дела, а не наличие заголовка: заголовок отрисуется и на
    // пустых данных.
    // Шапка архива из прототипа
    // Замок теперь иконка (lucide Lock), а не эмодзи в тексте: ассерт пинит
    // сам заголовок архива, а не способ нарисовать замок.
    await expect(
      page.getByRole('heading', { name: `Архив · ${target.code}` }),
    ).toBeVisible()
    await expect(page.getByText('read-only')).toBeVisible()

    const bulletin = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', {
        hasText: 'Карточка, бюллетень, программа',
      }),
    })
    await expect(bulletin).toContainText(target.businessDate)
    await expect(bulletin).toContainText(target.objectName)
    if (target.passportBinding !== null) {
      await expect(
        bulletin.getByRole('link', {
          name: `версия ${target.passportBinding.versionNumber}`,
        }),
      ).toBeVisible()
    }

    const demand = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Расчёты и заявки' }),
    })
    if (target.demandRows.length === 0) {
      await expect(demand).toContainText('Потребность не заводилась')
    } else {
      await expect(demand).toContainText(target.demandRows[0].sector)
    }

    const replacements = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Изменения и замены' }),
    })
    const replacementEntries = target.journalEntries.filter(
      (e) => e.type === 'REPLACEMENT',
    )
    if (replacementEntries.length === 0) {
      await expect(replacements).toContainText('Замен по ходу мероприятия не было')
    } else {
      await expect(replacements).toContainText(replacementEntries[0].title)
    }

    // Ссылка на реестр оценок несёт фильтр по ЭТОМУ делу, и реестр его читает
    const evaluations = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Оценки участников' }),
    })
    const link = evaluations.getByRole('link', {
      name: 'Итоговые оценки участников ОМ →',
    })
    // trailingSlash: true в next.config.js — Next нормализует адрес, поэтому
    // сверяем по образцу, а не по литералу без слэша.
    await expect(link).toHaveAttribute(
      'href',
      new RegExp(
        `/security-ops/ratings/evaluations/?\\?event=${encodeURIComponent(target.code)}$`,
      ),
    )
    // Ассертим ЗАПРОС, а не значение <select>: список мероприятий в фильтре
    // строит сервер (§19.15), и дела без единой оценки в нём нет — контрол
    // остался бы пустым даже при работающем фильтре. Уходящий запрос — то
    // место, где фильтр либо есть, либо его нет.
    //
    // Переходим ПОЛНОЙ навигацией, а не кликом: карточка архива уже спросила
    // реестр с теми же фильтрами, и по клику React Query отдал бы ответ из
    // кэша — запрос бы не ушёл, и ожидание его повисло бы на ровном месте.
    const href = await link.getAttribute('href')
    const [registryRequest] = await Promise.all([
      page.waitForRequest((request) => request.url().includes('/api/ops/evaluation-registry'), {
        timeout: 15_000,
      }),
      page.goto(`${APP}${href}`),
    ])
    expect(decodeURIComponent(registryRequest.url())).toContain(`event=${target.code}`)
    await expect(page).toHaveURL(/\/security-ops\/ratings\/evaluations/)
  })

  // 🔴 Воркер MSW блокируется ТОЛЬКО здесь: `page.route` в пробе недобора иначе
  // не перехватит запрос карточки. На весь файл ставить нельзя — соседняя проба
  // сторожит пустую консоль, а неудачная регистрация воркера пишет в неё ошибку.
  test.describe('контроль постов', () => {
    test.use({ serviceWorkers: 'block' })

    test('контроль постов считает укомплектованность по живым данным карточки', async ({ page }) => {
      const token = await apiToken()
      const conduct = (await events(token, 'CONDUCT'))[0]
      test.skip(conduct === undefined, 'на стенде нет ОМ на стадии «Проведение»')
      const target = conduct!

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
      const conduct = (await events(token, 'CONDUCT'))[0]
      test.skip(conduct === undefined, 'на стенде нет ОМ на стадии «Проведение»')
      const target = conduct!
      const first = target.reconSectorPosts[0]
      test.skip(first === undefined, 'у фикстуры нет ни одного поста')

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
  })
})
