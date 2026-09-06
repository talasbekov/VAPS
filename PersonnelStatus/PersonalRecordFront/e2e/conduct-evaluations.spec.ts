/**
 * Оценки сотрудников на этапе «Проведение» (`[ЗАК-02]`/`[ЗАК-05]`, Plane №433)
 * на ЖИВОМ стенде.
 *
 * Фикстура — ОМ на «Проведении» с незакрытым объектом и назначениями.
 * Оценки на фикстуре снимаются до и после пробы (повторный клик — снять),
 * чтобы прогон не оставлял фикстуру «оценённой» и не ломал следующий.
 * Закрытие объекта проба НЕ выполняет — только открывает подтверждение и
 * проверяет текст «Оценено K из N, инцидентов N» и «без оценки. Закрыть?».
 */
import { expect, test, type Page } from '@playwright/test'
import { requireFixture } from './fixtures'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface Summary {
  rows: { assignmentId: string | null; score: number | null; replaced: boolean }[]
  evaluated: number
  total: number
  incidents: number
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

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'оценки на этапе проведения' : 'оценки на этапе проведения (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('клик ставит и снимает, «Всем 10» добивает, закрытие называет K из N', async ({ page }) => {
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const call = async (method: string, path: string, body?: unknown) =>
      (await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })).json()

    const registry = (await call('GET', '/api/ops/security-events/?page_size=50&stage=CONDUCT')) as {
      results: { id: string; placementAssignments: unknown[]; visitObjects: { id: string; stage: string }[] }[]
    }
    const target = requireFixture(
      registry.results.find(
        (e) => e.placementAssignments.length > 0 && e.visitObjects.some((v) => v.stage !== 'CLOSED'),
      ),
      'ОМ на «Проведении» с назначениями и незакрытым объектом',
    )
    const visit = target.visitObjects.find((v) => v.stage !== 'CLOSED')!
    const base = `/api/ops/security-events/${target.id}/visit-objects/${visit.id}/evaluations/`
    const clear = async () => {
      const summary = (await call('GET', base)) as Summary
      for (const row of summary.rows) {
        if (row.score !== null && row.assignmentId !== null) {
          await call('POST', base, { assignmentId: row.assignmentId, score: null })
        }
      }
    }
    await clear()
    const initial = (await call('GET', base)) as Summary
    expect(initial.total, 'у объекта нет назначений — оценивать некого').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const panel = page.locator('[data-slot="evaluation-panel"]')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    const progress = panel.locator('[data-slot="evaluation-progress"]')
    await expect(progress).toHaveText(`Оценено 0 из ${initial.total}`)

    const firstRow = panel.locator('[data-slot="evaluation-row"]').first()
    const seven = firstRow.getByRole('button', { name: '7', exact: true })
    await seven.click()
    await expect(seven).toHaveAttribute('aria-pressed', 'true')
    await expect(progress).toHaveText(`Оценено 1 из ${initial.total}`)
    // Сервер — источник: оценка попала в модель рейтинга.
    const afterOne = (await call('GET', base)) as Summary
    expect(afterOne.evaluated).toBe(1)

    // Низкая оценка — подсказка, не блокировка.
    const three = firstRow.getByRole('button', { name: '3', exact: true })
    await three.click()
    await expect(firstRow.locator('[data-slot="low-score-hint"]')).toContainText('желательно пояснить')

    // Повторный клик — снять.
    await three.click()
    await expect(three).toHaveAttribute('aria-pressed', 'false')
    await expect(progress).toHaveText(`Оценено 0 из ${initial.total}`)

    // Подтверждение закрытия называет K из N и предупреждает про неоценённых.
    await page.getByRole('button', { name: 'Закрыть объект' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('[data-slot="close-summary"]')).toContainText(
      `Оценено 0 из ${initial.total}, инцидентов ${initial.incidents}`,
    )
    await expect(dialog.locator('[data-slot="close-unrated"]')).toContainText('без оценки. Закрыть?')
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog).toBeHidden()

    // «Всем 10» — всем неоценённым.
    await panel.getByRole('button', { name: 'Всем 10' }).click()
    await expect(progress).toHaveText(`Оценено ${initial.total} из ${initial.total}`)
    const all = (await call('GET', base)) as Summary
    expect(all.rows.filter((r) => !r.replaced).every((r) => r.score === 10)).toBe(true)

    await clear()
    const cleaned = (await call('GET', base)) as Summary
    expect(cleaned.evaluated).toBe(0)
  })

  /**
   * Панель закрыта правом `event.manage` (Plane №644).
   *
   * До правки читателю ОМ панель показывала «Оценки не загрузились — обновите
   * страницу» (это был 403, а не сбой сети), десять включённых кнопок шкалы в
   * каждой строке и работающую «Всем 10» — все они отвечали 403 на нажатие.
   *
   * 🔴 ПРАВА ПОДМЕНЯЮТСЯ ОТВЕТОМ РУЧКИ, а не поиском подходящей учётки на
   * стенде (тот же приём, что в `department-requests`): нужен ТОТ, КОМУ
   * КАРТОЧКА ОТКРЫТА, но кто не ведёт мероприятие. Ходить под `observer`
   * значило бы стеречь не свой предмет — ему закрыт весь раздел, и «панель
   * недоступна» выполнялось бы само собой.
   *
   * Стережёт две мутации: снять гард с кнопок и вернуть безусловный запрос
   * сводки.
   */
  test('читателю ОМ панель оценок закрыта правом, а не сломана', async ({ page }) => {
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const registry = (await (
      await fetch(`${API}/api/ops/security-events/?page_size=50&stage=CONDUCT`, { headers })
    ).json()) as {
      results: { id: string; placementAssignments: unknown[]; visitObjects: { stage: string }[] }[]
    }
    const target = requireFixture(
      registry.results.find(
        (e) => e.placementAssignments.length > 0 && e.visitObjects.some((v) => v.stage !== 'CLOSED'),
      ),
      'ОМ на «Проведении» с назначениями и незакрытым объектом',
    )

    await page.route(
      (url) => url.pathname.includes('/api/operations/my-permissions/'),
      async (route) =>
        route.fulfill({
          json: {
            permissions: ['event.view', 'status.view', 'personnel.view'],
            roles: [],
          },
        }),
    )
    // Сводку оценок читателю не запрашивают вовсе: React Query перезапрашивает
    // при возврате фокуса, и вкладка стучалась бы в закрытую дверь снова и
    // снова. Счётчик, а не заглушка: подменить ответ значило бы спрятать
    // именно то, что проверяется.
    let asked = 0
    await page.route(
      (url) => url.pathname.includes('/evaluations/'),
      async (route) => {
        asked += 1
        await route.continue()
      },
    )
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)

    const panel = page.locator('[data-slot="evaluation-panel"]')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    // Панель НЕ спрятана — конвенция раздела: недоступное выключается, а не
    // исчезает, иначе человек не знает, что этот блок вообще существует.
    await expect(panel.locator('[data-slot="evaluation-locked"]')).toContainText(
      'Оценки ставит ведущий мероприятие',
    )
    await expect(panel.locator('[data-slot="evaluation-progress"]')).toHaveText(
      'Сводка закрыта правом',
    )
    await expect(
      panel.getByText('Оценки не загрузились'),
      'закрытая дверь названа сбоем загрузки',
    ).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Всем 10' })).toBeDisabled()
    expect(asked, 'сводка оценок запрошена у того, кому она закрыта').toBe(0)
  })

  /**
   * Причина отказа у кнопок закрытия — ВИДИМАЯ строка, а не `title`
   * (Plane №777; решение принято в №714, применено в №644).
   *
   * Браузер подавляет на ВЫКЛЮЧЕННОЙ кнопке указательные события, а с ними и
   * всплывающую подсказку: `title` показывался бы ровно тогда, когда
   * показаться не может, — то есть никогда. Читатель видел серую кнопку
   * «Закрыть объект» без единого слова о том, чьё это действие, и шёл
   * спрашивать.
   *
   * 🔴 ПРОВЕРЯЮТСЯ ТРИ ВЕЩИ, И ТРЕТЬЯ ГЛАВНАЯ: строка видна, кнопка связана
   * с ней `aria-describedby` (фокуса выключенная кнопка не получает, но
   * виртуальный курсор читалки до подписи доходит) и `title` НЕ ВЕРНУЛСЯ.
   * Без последней проверки правку откатили бы обратно одной строкой, и
   * проба осталась бы зелёной: видимая подпись и мёртвая подсказка
   * уживаются рядом.
   *
   * Красная до правки: строки нет вовсе, у кнопки стоит `title`.
   */
  test('причина отказа у кнопок закрытия видна, а не спрятана в title (Plane №777)', async ({
    page,
  }) => {
    // Формулировка причины — ОДНОЙ константой на всю пробу: она же приходит
    // из `chain-access.ts`, и правка текста там не должна требовать четырёх
    // правок здесь.
    const RIGHT_REASON = 'Переводит этапы и закрывает мероприятие ведущий ОМ или штаб'
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const registry = (await (
      await fetch(`${API}/api/ops/security-events/?page_size=50&stage=CONDUCT`, { headers })
    ).json()) as {
      results: { id: string; placementAssignments: unknown[]; visitObjects: { stage: string }[] }[]
    }
    const target = requireFixture(
      registry.results.find(
        (e) => e.placementAssignments.length > 0 && e.visitObjects.some((v) => v.stage !== 'CLOSED'),
      ),
      'ОМ на «Проведении» с назначениями и незакрытым объектом',
    )

    await page.route(
      (url) => url.pathname.includes('/api/operations/my-permissions/'),
      async (route) =>
        route.fulfill({
          json: {
            permissions: ['event.view', 'status.view', 'personnel.view'],
            roles: [],
          },
        }),
    )
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)

    const button = page.getByRole('button', { name: 'Закрыть объект' })
    await expect(button).toBeVisible({ timeout: 15_000 })
    await expect(button, 'кнопка закрытия открыта тому, у кого нет права').toBeDisabled()

    // 🔴 ПИН ПЕРЕПИСАН ОСОЗНАННО (Plane №913). Здесь стояли два своих слота —
    // `close-visit-locked` и `close-event-locked`, — по одному у каждой
    // кнопки. Панели рисуются на «Проведении» одновременно, право у них одно,
    // и человек без права читал одну и ту же фразу ДВАЖДЫ: тот самый
    // «частокол», ради которого в №801 появился общий блок `AccessHints`.
    // Теперь причина сказана один раз блоком (`data-slot="access-note"`), а
    // обе кнопки ссылаются на неё `aria-describedby`. Проба следует за этим и
    // проверяет ровно то, что важно: строка ОДНА, и обе кнопки ведут к ней.
    // Считается ЛЮБАЯ видимая строка с этим текстом, а не только слот общего
    // блока: обёртка вне блока рисует свой слот (`right-hint`), и проба,
    // привязанная к одному имени, на возврате повтора показала бы «0 строк»
    // вместо «2» — краснела бы, но врала о причине. Проверено мутацией.
    const hints = page
      .locator('[data-slot="access-note"], [data-slot="right-hint"]')
      .filter({ hasText: RIGHT_REASON })
    await expect(
      hints,
      'причина отказа напечатана не один раз — экран снова частокол',
    ).toHaveCount(1)
    await expect(
      hints.first(),
      'выключенная кнопка не объясняет, чьё это действие',
    ).toHaveText(RIGHT_REASON)

    // Связь кнопки с подписью — не украшение: у читалки другого пути к ней нет.
    const describedBy = await button.getAttribute('aria-describedby')
    expect(describedBy, 'кнопка не связана с подписью через aria-describedby').not.toBeNull()
    await expect(page.locator(`#${describedBy}`)).toHaveText(RIGHT_REASON)

    expect(
      await button.getAttribute('title'),
      'title вернулся на выключенную кнопку — подсказка снова мертва',
    ).toBeNull()

    // 🔴 ВТОРАЯ КНОПКА ТОГО ЖЕ КОММИТА (доводка по ревью №825). №777 правил
    // ДВЕ кнопки — «Закрыть объект» и «Закрыть мероприятие», — а проба
    // проверяла первую. Снять подпись у второй можно было молча: сторож
    // `right-hint-pattern` ловит только ВОЗВРАТ `title`, а не пропажу видимой
    // строки. Обе панели рисуются на «Проведении» одновременно, так что
    // отдельного захода это не стоит.
    const closeEvent = page.getByRole('button', { name: 'Закрыть мероприятие' })
    await expect(closeEvent).toBeVisible()
    await expect(
      closeEvent,
      'кнопка закрытия мероприятия открыта тому, у кого нет права',
    ).toBeDisabled()
    const eventDescribedBy = await closeEvent.getAttribute('aria-describedby')
    expect(
      eventDescribedBy,
      'кнопка закрытия мероприятия не связана с подписью через aria-describedby',
    ).not.toBeNull()
    await expect(page.locator(`#${eventDescribedBy}`)).toHaveText(RIGHT_REASON)
    // И это ТА ЖЕ САМАЯ строка, а не вторая с тем же текстом: иначе повтор
    // вернулся бы незаметно — с виду проба осталась бы зелёной.
    expect(
      eventDescribedBy,
      'кнопки ссылаются на разные подписи — причина напечатана дважды',
    ).toBe(describedBy)
    expect(
      await closeEvent.getAttribute('title'),
      'title вернулся на кнопку закрытия мероприятия — подсказка снова мертва',
    ).toBeNull()
  })
})
