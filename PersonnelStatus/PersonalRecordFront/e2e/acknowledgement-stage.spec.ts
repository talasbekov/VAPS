/**
 * Этап «Ознакомление» карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на два вопроса: счётчик и фильтр «Ожидают» считают по
 * РЕАЛЬНЫМ подтверждениям (а не по локальному стейту), и завершить этап,
 * пока подтвердили не все, не даёт СЕРВЕР.
 *
 * Ожидаемые числа берутся из ответа API на старте, а не зашиты: проба
 * подтверждает одного сотрудника и потому меняет состояние. Все назначения
 * она не подтверждает намеренно — иначе следующий прогон получил бы
 * завершаемый этап и фикстура стала бы одноразовой.
 *
 * Фикстуру проба готовит САМА, если подходящей на стенде нет. Иначе тест
 * молча выродился бы в скип: каждый прогон подтверждает одного сотрудника, и
 * через два прогона готовое ОМ перестаёт удовлетворять условию «≥2
 * ожидающих». Снять подтверждение нечем — ручки un-acknowledge нет.
 *
 * Цена такой самодостаточности названа прямо: фикстура из трёх назначений
 * переживает два прогона, дальше на стенде появляется ещё одно ОМ «Проба
 * ознакомления (e2e)». Уборка после прогона (`e2e/global-teardown.ts`) её НЕ
 * снимает: в ОМ есть расстановка, а такое сервер удалять отказывается — это
 * работа людей. Снимает только `purge_probe_events --yes --force` с консоли.
 */
import { expect, test, type Page } from '@playwright/test'
import { anyChiefId } from './stand-chief'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface EventRow {
  id: string
  code: string
  stage: string
  objectName: string
  reconSectorPosts: { id: string; sector: string; post: string }[]
  placementAssignments: {
    id: string
    postId: string
    employeeId: string
    employeeName: string
    remindedAt?: string | null
    declinedAt?: string | null
    acknowledgedAt: string | null
  }[]
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(token: string): Promise<EventRow[]> {
  const res = await fetch(`${API}/api/ops/security-events/?page_size=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'ознакомление' : 'ознакомление (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('шапка, группы по постам, напоминание и завершение с подтверждением (Plane №432)', async ({ page }) => {
    /**
     * `[ОЗН-02]`…`[ОЗН-04]`, `[ОЗН-08]`. Экран старшего: шапка «Ознакомились
     * K из N», список по секторам и постам, «Напомнить» одному и всем,
     * «Завершить ознакомление» при неподтвердивших — только через окно с
     * комментарием (сервер держит 422 без него). Панели «Экран сотрудника»
     * и кнопки «Отправить уведомления» на этапе больше нет.
     */
    const token = await apiToken()
    const suitable = (rows: EventRow[]): EventRow | undefined =>
      rows.find(
        (e) =>
          e.stage === 'ACKNOWLEDGEMENT' &&
          e.placementAssignments.filter(
            (a) => a.acknowledgedAt === null && (a.declinedAt ?? null) === null,
          ).length >= 2,
      )
    let event = suitable(await events(token))
    if (event === undefined) {
      const prepared = await prepareEvent(token)
      event = suitable(await events(token))
      expect(event, `не удалось подготовить фикстуру (${prepared})`).toBeDefined()
    }
    event = event!
    const total = event.placementAssignments.length
    // «Ожидают» — без отказавшихся: им не напоминают, их заменяют.
    const pending = event.placementAssignments.filter(
      (a) => a.acknowledgedAt === null && (a.declinedAt ?? null) === null,
    )
    const confirmed = event.placementAssignments.filter((a) => a.acknowledgedAt !== null)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${event.id}/`)
    const card = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Ознакомление' }),
    })
    await expect(card).toBeVisible({ timeout: 15_000 })
    // `[ОЗН-02]` (№447): «не открыли · отказов · срок подтверждения», легенда полосы.
    await expect(card.getByTestId('ack-summary')).toContainText(`не открыли ${pending.length}`)
    await expect(card.getByTestId('ack-summary')).toContainText('отказов')
    await expect(card.getByTestId('ack-summary')).toContainText('срок подтверждения')
    await expect(card.getByTestId('ack-legend')).toContainText('не открывал')
    await expect(card.getByTestId('ack-summary')).toContainText(
      `Ознакомились ${confirmed.length} из ${total}`,
    )
    // `[ОЗН-08]`: ни панели сотрудника, ни старой рассылки, ни «(K/N)».
    await expect(card.getByText('Экран сотрудника')).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Отправить уведомления' })).toHaveCount(0)
    await expect(card.getByText(`Ознакомление (${confirmed.length}/${total})`)).toHaveCount(0)

    // Список — по секторам и постам расчёта.
    const groups = card.getByTestId('ack-groups')
    const sectors = new Set(
      event.placementAssignments.map(
        (a) => event!.reconSectorPosts.find((p) => p.id === a.postId)?.sector ?? 'Пост вне расчёта',
      ),
    )
    for (const sector of sectors) {
      await expect(groups.getByRole('region', { name: `Сектор ${sector}` })).toBeVisible()
    }

    const bar = card.getByRole('progressbar', { name: 'Готовность ознакомления' })
    await expect(bar).toHaveAttribute(
      'aria-valuenow',
      String(Math.round((confirmed.length / total) * 100)),
    )

    // «Напомнить» одному — отчёт и отметка «напомнили» в строке.
    const first = pending[0]!
    const row = card.getByTestId(`ack-row-${first.id}`)
    await row.getByRole('button', { name: `Напомнить: ` }).click()
    await expect(card.getByTestId('remind-report')).toContainText('Напоминание отправлено', {
      timeout: 15_000,
    })
    await expect(row).toContainText('напомнили', { timeout: 15_000 })
    const fresh = (await events(token)).find((e) => e.id === event!.id)!
    expect(fresh.placementAssignments.find((a) => a.id === first.id)?.remindedAt).toBeTruthy()

    // 🔴 ОТЧЁТ ПОКАЗЫВАЕТ ПОСЛЕДНЕЕ НАЖАТИЕ (Plane №614). Блок читал
    // `remindOne.data ?? remindAll.data`, а React Query держит данные после
    // мутации: панель навсегда приколачивалась к результату одиночного
    // «Напомнить», и «Напомнить всем» её не меняло. Числа у двух нажатий
    // разные — одному против всех ожидающих, — и на них это видно.
    //
    // Сравниваются ТЕКСТЫ двух отчётов, а не конкретные числа: у стенда часть
    // назначенных без учётной записи, и «отправлено» с «не дошло» делятся
    // по-разному от прогона к прогону. Предмет пробы — обновился ли блок,
    // а не сколько кому ушло.
    const oneReport = await card.getByTestId('remind-report').innerText()
    expect(oneReport, 'отчёт одиночного напоминания не появился').toContain(
      'Напоминание отправлено',
    )
    // «Напомнить всем, кто не подтвердил» — столько же, сколько ожидают.
    await card.getByRole('button', { name: `Напомнить всем, кто не подтвердил (${pending.length})` }).click()
    await expect(card.getByTestId('remind-report')).toBeVisible({ timeout: 15_000 })
    if (pending.length > 1) {
      await expect
        .poll(async () => await card.getByTestId('remind-report').innerText(), {
          timeout: 15_000,
        })
        .not.toBe(oneReport)
    }

    // Корзин столько же, сколько РАЗНЫХ постов в выборке — группировка идёт
    // по `postId`, а не по подписи.
    //
    // 🔴 ЧЕСТНО ПРО ГРАНИЦУ: на возврате ключа `key={bucket.post}` (Plane
    // №615) эта проверка НЕ КРАСНЕЕТ — проверено запуском. Число корзин
    // задаёт `Map` по `postId`, а `key` влияет только на сверку React, и
    // вред от совпавших ключей — предупреждение в консоли и переиспользование
    // состояния DOM при перерисовке. Чтобы это проявилось, нужны два поста с
    // ОДИНАКОВОЙ подписью в одном секторе, которых у фикстуры стенда нет.
    // Правка ключа верна и оставлена; покрытия у неё нет, и это сказано
    // вслух, а не выдано за проверку.
    const postsShown = await card.locator('[data-testid="ack-groups"] > section > div').count()
    const distinctPosts = new Set(
      event.placementAssignments.map((a) => a.postId),
    ).size
    expect(
      postsShown,
      'корзин постов меньше, чем разных постов — группировка схлопнулась',
    ).toBe(distinctPosts)

    await card.getByRole('button', { name: `Ожидают (${pending.length})` }).click()
    await expect(card.locator('li[data-state]')).toHaveCount(pending.length)
    await expect(card.locator('li[data-state="confirmed"]')).toHaveCount(0)

    // Завершение при неподтвердивших — окно с комментарием; без него кнопка
    // заперта, сервер не трогается.
    await card.getByRole('button', { name: 'Завершить ознакомление' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText(`${pending.length}`)
    await expect(dialog).toContainText('не подтвердили. Завершить?')
    const finish = dialog.getByRole('button', { name: 'Завершить без подтверждения всех' })
    await expect(finish).toBeDisabled()
    expect((await events(token)).find((e) => e.id === event!.id)?.stage).toBe('ACKNOWLEDGEMENT')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // «Ознакомлен лично» (`[ОЗН-05]`, №447) — счётчик растёт, в строке — способ и кто отметил.
    await card.getByRole('button', { name: 'Ознакомлен лично' }).first().click()
    await expect(card.getByTestId('ack-summary')).toContainText(
      `Ознакомились ${confirmed.length + 1} из ${total}`,
      { timeout: 15_000 },
    )
  })

  test.describe(() => {
    test.use({ serviceWorkers: 'block' })

    test('старший объекта ведёт этап без event.manage (Plane №612, №494)', async ({ page }) => {
      /**
       * `[ОЗН-09]`: сервер СПЕЦИАЛЬНО пускает старшего мероприятия/объекта в
       * действия этапа без `event.manage` (`_STAGE_LEAD_ACTIONS` →
       * `may_manage_stage`). Экран же считал право одним кодом и гасил ВСЁ:
       * у той персоны, ради которой обход написан, кнопки были серыми с
       * подсказкой «это дело ведущего ОМ».
       *
       * 🔴 ПОДМЕНЯЮТСЯ ДВА ОТВЕТА, И ОБА НУЖНЫ: права (без `event.manage`,
       * но с доступом к карточке) и кадровая запись — «я тот самый старший».
       * Учётки, которая была бы старшим ЭТОГО ОМ на стенде, может не быть
       * вовсе, а заводить её пробой значило бы менять состав стенда ради
       * проверки экрана.
       */
      const token = await apiToken()
      const suitable = (rows: EventRow[]) =>
        rows.find(
          (e) => e.stage === 'ACKNOWLEDGEMENT' && e.placementAssignments.length > 0,
        )
      let event = suitable(await events(token))
      if (event === undefined) {
        // Фикстура готовится САМА, как и в соседних пробах этого файла: ОМ на
        // «Ознакомлении» на стенде может не быть вовсе, и проба иначе
        // выродилась бы в отказ «нечего проверять».
        const prepared = await prepareEvent(token)
        event = suitable(await events(token))
        expect(event, `не удалось подготовить фикстуру (${prepared})`).toBeDefined()
      }
      const full = (await (
        await fetch(`${API}/api/ops/security-events/${event!.id}/`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json()) as {
        chiefEmployeeId: string | null
        visitObjects: { chiefEmployeeId: string | null }[]
      }
      const chief =
        full.chiefEmployeeId ??
        full.visitObjects.map((v) => v.chiefEmployeeId).find((id) => id !== null) ??
        null
      expect(chief, 'у ОМ нет старшего ни на мероприятии, ни на объекте').not.toBeNull()

      await page.route(
        (url) => url.pathname.includes('/api/operations/my-permissions/'),
        async (route) =>
          route.fulfill({
            json: { permissions: ['event.view', 'status.view', 'personnel.view'], roles: [] },
          }),
      )
      const asEmployee = (id: string | null) =>
        page.route(
          (url) => url.pathname.includes('/api/operations/my-employee/'),
          async (route) =>
            route.fulfill({
              json: {
                employee:
                  id === null
                    ? null
                    : {
                        id: Number(id),
                        full_name: 'Старший (проба №612)',
                        rank_code: null,
                        position_code: null,
                        division: null,
                        personnel_number: null,
                        hire_date: null,
                      },
                unlinked_reason: null,
              },
            }),
        )

      // 1. Я — СТАРШИЙ: действия этапа доступны, хотя `event.manage` нет.
      await asEmployee(chief)
      await signIn(page)
      await page.goto(`${APP}/security-ops/events/${event!.id}/`)
      // Карточка ищется так же, как в соседних пробах файла: у неё нет роли
      // региона, только заголовок.
      const card = page.locator('[data-slot="card"]', {
        has: page.locator('[data-slot="card-title"]', { hasText: 'Ознакомление' }),
      })
      await expect(card).toBeVisible({ timeout: 20_000 })
      await expect(
        card.getByRole('button', { name: /Напомнить всем, кто не подтвердил/ }),
        'у старшего объекта кнопки этапа выключены — путь [ОЗН-09] мёртв со стороны экрана',
      ).toBeEnabled()

      // 2. Я — НЕ старший: гейт на месте, иначе проба доказывала бы «включили
      //    всем».
      await page.unroute((url) => url.pathname.includes('/api/operations/my-employee/'))
      await asEmployee('999999')
      await page.goto(`${APP}/security-ops/events/${event!.id}/`)
      await expect(card).toBeVisible({ timeout: 20_000 })
      await expect(
        card.getByRole('button', { name: /Напомнить всем, кто не подтвердил/ }),
        'действия этапа открыты тому, кто ни старший, ни ведущий ОМ',
      ).toBeDisabled()
    })
  })

  test('отказ показан красным и заменяется прямо на этапе; завершение с комментарием уходит в журнал (Plane №432)', async ({
    page,
  }) => {
    const token = await apiToken()
    const code = await prepareEvent(token)
    const event = (await events(token)).find((e) => e.code === code)!
    const target = event.placementAssignments[0]!
    // Отказ — от имени сотрудника не завести (учётки нет), поэтому по API
    // тем же admin: ручка открыта ведущему.
    const declined = await fetch(`${API}/api/ops/security-events/${event.id}/decline/${target.id}/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Командировка' }),
    })
    expect(declined.status, await declined.text()).toBe(200)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${event.id}/`)
    const card = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Ознакомление' }),
    })
    const row = card.getByTestId(`ack-row-${target.id}`)
    await expect(row).toHaveAttribute('data-state', 'declined', { timeout: 15_000 })
    await expect(row).toContainText('Не может заступить: Командировка')
    await expect(card.getByTestId('ack-summary')).toContainText('отказов 1')

    // «Заменить →» — подбор с поиском тут же, на этапе 4.
    await row.getByRole('button', { name: 'Заменить →' }).click()
    const replace = card.getByTestId('ack-replace')
    await expect(replace).toContainText(`Заменить ${target.employeeName}`)
    await expect(replace.getByLabel('Причина')).toHaveValue('Отказ: Командировка')
    // Кандидат — заведомо не из расстановки (назначенного дважды сервер
    // отобьёт): берём из кадрового списка и ищем его по фамилии в подборе.
    const roster = (await (
      await fetch(`${API}/api/ops/personnel/?page_size=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: { id: string; name: string }[] }
    const assignedIds = new Set(event.placementAssignments.map((a) => a.employeeId))
    // Подпись в подборе — «Фамилия И.», и однофамильцев в базе много: берём
    // того, чья подпись в списке единственная, иначе клик попал бы в тёзку,
    // а тёзка может стоять в расстановке.
    const counts = new Map<string, number>()
    for (const p of roster.results) counts.set(p.name, (counts.get(p.name) ?? 0) + 1)
    const candidate = roster.results.find(
      (p) => !assignedIds.has(p.id) && counts.get(p.name) === 1,
    )
    expect(candidate, 'в кадровом списке нет никого вне расстановки').toBeDefined()
    await replace.locator('#ack-replace-search').fill(candidate!.name.split(' ')[0]!)
    const option = replace
      .locator('[data-slot="personnel-picker"] li button')
      .filter({ hasText: candidate!.name })
      .first()
    await expect(option).toBeVisible({ timeout: 20_000 })
    await option.click()
    await replace.getByRole('button', { name: 'Заменить' }).click()
    // Панель закрывается ОТВЕТОМ сервера; если не закрылась — в тексте
    // ошибки покажется её содержимое (отказ сервера читается прямо оттуда).
    await expect
      .poll(async () => ((await replace.isVisible()) ? await replace.textContent() : null), {
        timeout: 15_000,
        message: 'панель замены не закрылась',
      })
      .toBeNull()
    await expect(card.getByTestId(`ack-row-${target.id}`)).toHaveCount(0)
    await expect(card.getByTestId('ack-summary')).toContainText('отказов 0')

    // Завершение с комментарием — этап уходит на «Проведение», журнал мутаций
    // несёт число неподтвердивших и слова старшего.
    await card.getByRole('button', { name: 'Завершить ознакомление' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Комментарий').fill('Доведено устно на разводе (e2e)')
    await dialog.getByRole('button', { name: 'Завершить без подтверждения всех' }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })
    await expect
      .poll(async () => (await events(token)).find((e) => e.id === event.id)?.stage, { timeout: 15_000 })
      .toBe('CONDUCT')
  })

  test('утверждение расстановки САМО оповещает — колокольчик руководителя это видит', async ({
    page,
  }) => {
    /**
     * Plane №402, `[ОЗН-01]`. Два дефекта одной цепочки:
     *  1. рассылка ждала ручную кнопку на этапе — заступающие узнавали о
     *     назначении, только если кто-то не забыл нажать;
     *  2. колокольчик хедера читал ТОЛЬКО легаси-ленту `/api/notifications/`,
     *     а уведомления о заступлении пишутся в `OpsNotification`
     *     (`/api/operations/notifications/`) — запись была, счётчик рос,
     *     хедер показывал «Нет новых уведомлений».
     *
     * Проба НЕ нажимает «Отправить уведомления»: если после `approval/approve/`
     * уведомление есть — его разослало само утверждение. Читает его
     * НАЧАЛЬНИК УПРАВЛЕНИЯ (`acc_dir_head`, область «Первое управление»): он
     * получает уведомление как руководитель заступающего — своего сотрудника
     * «Токтаров А.» (учётка `acc_employee`, связанная кадровая запись стенда).
     *
     * Дата мероприятия — своя на каждый прогон: ключ уведомления «одно на
     * день», и с одной и той же датой второй прогон читал бы ПРОШЛУЮ строку
     * с чужим кодом мероприятия.
     */
    const bossPassword = process.env.ACCESS_MATRIX_PASSWORD ?? ''
    test.skip(bossPassword === '', 'нужен ACCESS_MATRIX_PASSWORD — учётки матрицы доступа')

    const token = await apiToken()
    const found = (await (
      await fetch(`${API}/api/ops/personnel/?search=${encodeURIComponent('Токтаров')}&page_size=1`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results: { id: string }[] }
    expect(found.results.length, 'на стенде нет сотрудника «Токтаров»').toBeGreaterThan(0)
    const linkedEmployeeId = found.results[0].id

    // 🔴 ДАТА ОБЯЗАНА БЫТЬ УНИКАЛЬНОЙ, А НЕ «ПОЧТИ» (Plane №567). Стояло
    // `эпоха в СЕКУНДАХ mod 300` дней — то есть цикл длиной ровно ПЯТЬ МИНУТ:
    // прогон и его повтор через пять минут брали ОДНУ И ТУ ЖЕ деловую дату.
    // Уведомление ключится (получатель, вид, деловая дата), уборка только
    // помечает прочитанным, — и `notify` во втором прогоне становился
    // холостым: опрос падал по таймауту на ИНФРАСТРУКТУРЕ, ничего не сказав о
    // коде.
    //
    // Теперь шаг считается по МИЛЛИСЕКУНДАМ, а окно — десять лет (≈3650 дней):
    // повтор требует совпадения с точностью до миллисекунды. Дата остаётся
    // валидной и заведомо будущей — этап ознакомления открывается только у
    // предстоящего мероприятия.
    const uniqueBusinessDate = (at: number) =>
      new Date(Date.UTC(2027, 1, 1) + (at % 3650) * 86_400_000).toISOString().slice(0, 10)
    // Свойство, ради которого формула именно такая, проверяется ЗДЕСЬ, а не
    // ожиданием повтора через пять минут: прежняя формула на этой строке
    // краснеет (300 000 мс — ровно её период), новая проходит.
    expect(
      uniqueBusinessDate(Date.now()),
      'дата повторяется через пять минут — проба будет мигать',
    ).not.toBe(uniqueBusinessDate(Date.now() + 300_000))
    const businessDate = uniqueBusinessDate(Date.now())
    const code = await prepareEvent(token, { firstEmployeeId: linkedEmployeeId, businessDate })

    // Сервер: у руководителя появилась строка об ЭТОМ мероприятии — без клика.
    const bossToken = (
      (await (
        await fetch(`${API}/api/token/`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'acc_dir_head', password: bossPassword }),
        })
      ).json()) as { access: string }
    ).access
    await expect
      .poll(
        async () => {
          const feed = (await (
            await fetch(`${API}/api/operations/notifications/?unread=true`, {
              headers: { Authorization: `Bearer ${bossToken}` },
            })
          ).json()) as {
            results: { kind: string; payload: { eventCode?: string; asSupervisor?: boolean } }[]
          }
          return feed.results.some(
            (r) =>
              r.kind === 'EVENT_ACKNOWLEDGEMENT' &&
              r.payload.eventCode === code &&
              r.payload.asSupervisor === true,
          )
        },
        { timeout: 15_000 },
      )
      .toBe(true)

    // Экран: колокольчик руководителя показывает это уведомление словами.
    const api = page.context().request
    const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
    await api.post(`${APP}/api/auth/callback/credentials/`, {
      form: { csrfToken: csrf.csrfToken, username: 'acc_dir_head', password: bossPassword, json: 'true' },
    })
    await page.goto(`${APP}/dashboard`)
    const bell = page.getByRole('button', { name: 'Уведомления' })
    await expect(bell).toBeVisible({ timeout: 20_000 })
    await bell.click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByText('Подчинённый заступает на мероприятие').first()).toBeVisible({
      timeout: 15_000,
    })
    await expect(menu.getByText(code, { exact: false }).first()).toBeVisible()

    // Уборка ленты: своё уведомление отмечается прочитанным, иначе каждый
    // прогон оставлял бы руководителю по непрочитанной строке. Само ОМ
    // уборка не снимает (в нём есть расстановка) — см. шапку файла.
    const feed = (await (
      await fetch(`${API}/api/operations/notifications/?unread=true`, {
        headers: { Authorization: `Bearer ${bossToken}` },
      })
    ).json()) as { results: { id: number; payload: { eventCode?: string } }[] }
    for (const row of feed.results.filter((r) => r.payload.eventCode === code)) {
      await fetch(`${API}/api/operations/notifications/${row.id}/read/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bossToken}` },
      })
    }
  })
})

/**
 * Заводит ОМ и проводит его до «Ознакомления» с тремя неподтверждёнными
 * назначениями. Тем же путём, каким это делает человек в интерфейсе, —
 * своих служебных ручек у стенда нет.
 */
async function prepareEvent(
  token: string,
  options: { firstEmployeeId?: string; businessDate?: string } = {},
): Promise<string> {
  const headers = {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }
  const call = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Record<string, never> & Record<string, unknown>> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return (await res.json().catch(() => ({}))) as Record<string, never> &
      Record<string, unknown>
  }

  const objects = (await call('GET', '/api/ops/security-events/bindable-objects/')) as unknown as {
    results: { id: string; publishedVersionCount: number }[]
  }
  const object = objects.results.find((item) => item.publishedVersionCount > 0)
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')

  const created = (await call('POST', '/api/ops/security-events/', {
    title: 'Проба ознакомления (e2e)',
    objectId: object.id,
    businessDate: options.businessDate ?? '2026-08-22',
    // `kind` обязателен с 23.08: без него сервер отдаёт 400, `created.id`
    // выходит undefined, и проба падает не на своём предмете, а на строке
    // «не удалось подготовить фикстуру».
    kind: 'INTERNAL',
    chiefEmployeeId: await anyChiefId(token),
  })) as unknown as { id: string; code: string }
  const id = created.id
  const base = `/api/ops/security-events/${id}`

  await call('PATCH', `${base}/bulletin/`, {
    briefDescription: 'Проба ознакомления.',
    initialTasks: '—',
  })
  await call('POST', `${base}/bulletin/complete/`)
  await call('POST', `${base}/recon/import-from-passport/`)
  const afterImport = (await call('GET', `${base}/`)) as unknown as {
    reconChecklist: Record<string, unknown>[]
    reconSectorPosts: {
      id: string
      sector: string
      task: string
      need: number
      requirements: string
    }[]
  }
  await call('PATCH', `${base}/recon/`, {
    checklist: afterImport.reconChecklist.map((item) => ({
      ...item,
      done: true,
      result: 'MATCHES',
    })),
    sectorPosts: afterImport.reconSectorPosts,
  })
  await call('POST', `${base}/recon/complete/`)
  // Стадии «Потребность» и «Запрос сил» проходит СЕРВЕР на завершении
  // рекогносцировки (Plane №110): форм у них нет, и ручные `demand/approve/`,
  // `forces/<id>/`, `forces/complete/` здесь отбились бы «не на этом этапе».
  // ОМ уже стоит на «Расстановке» — фикстура идёт сразу к назначениям.
  const roster = (await call('GET', '/api/ops/personnel/')) as unknown as {
    results: { id: string }[]
  }
  for (const [index, post] of afterImport.reconSectorPosts.entries()) {
    await call('POST', `${base}/placement/assign/`, {
      postId: post.id,
      // Первый пост — НАЗВАННОМУ человеку, если проба его назвала: рассылке
      // о заступлении нужен сотрудник, СВЯЗАННЫЙ с учёткой, а первые строки
      // реестра такой связи не обещают.
      employeeId:
        index === 0 && options.firstEmployeeId !== undefined
          ? options.firstEmployeeId
          : roster.results[index].id,
    })
  }
  await call('POST', `${base}/placement/complete/`)
  // Согласование с 25.08 (Plane «ОМ-37.3») — это маршрут, отправка и решение:
  // завершить этап «просто так» больше нельзя. Фикстуре нужен один
  // согласующий, доведённый до «Согласовано».
  const withRoute = (await call('POST', `${base}/approval/route/`, {
    name: 'Согласующий пробы',
    unit: 'Управление ОМ',
    position: 'полковник',
  })) as unknown as { approvalRoute: { id: string }[] }
  await call('POST', `${base}/approval/send/`)
  await call(
    'POST',
    `${base}/approval/route/${withRoute.approvalRoute[0]!.id}/decide/`,
    { decision: 'APPROVED', comment: '' },
  )
  await call('POST', `${base}/approval/approve/`)
  return created.code
}

/**
 * Завершение этапа — операция МЕРОПРИЯТИЯ, а не объекта (Plane №528).
 *
 * 🔴 СВОЁ ОПИСАНИЕ С `serviceWorkers: 'block'`: без него `page.route` не
 * перехватывает запросы, ушедшие через service worker MSW, — состояние
 * «объект впереди мероприятия» подделать нельзя, и проба была бы зелёной на
 * живых данных, ничего не проверив.
 *
 * Состояние подделывается ПЕРЕХВАТОМ, а не правкой стенда: развести этапы
 * объекта и мероприятия по-настоящему значило бы оставить на общем стенде
 * мероприятие в противоречивом виде, и следующая проба нашла бы его первым.
 */
test.describe(LIVE ? 'ознакомление: этап мероприятия отстаёт' : 'ознакомление: отстающий этап (скип)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.use({ serviceWorkers: 'block' })

  test('кнопка «Завершить ознакомление» гаснет и называет причину (Plane №528)', async ({
    page,
  }) => {
    /**
     * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. Цепочка этапов в карточке рисуется по этапу
     * ПОКАЗАННОГО ОБЪЕКТА (`[МД-04]`, №412), а сервер сторожит
     * `complete_acknowledgement` этапом МЕРОПРИЯТИЯ — и правильно: он смотрит
     * на `placement_assignments`, которые общие. У ОМ, где один объект уже на
     * «Ознакомлении», а второй ещё нет, карточка показывала этот этап с
     * ВКЛЮЧЁННОЙ кнопкой, и сервер отвечал 422. Предлагать заведомо
     * невыполнимое действие хуже, чем не предлагать: человек считает отказ
     * поломкой и жмёт снова.
     *
     * Мутация, на которой проба обязана краснеть: убрать `!eventOnStage` из
     * `disabled`.
     */
    const token = await apiToken()
    const rows = (await (
      await fetch(`${API}/api/ops/security-events/?page_size=100`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as {
      results: {
        id: string
        visitObjects: { id: string }[]
        placementAssignments: unknown[]
      }[]
    }
    // ОМ С НАЗНАЧЕНИЯМИ, а не любой: кнопка гаснет ещё и при `total === 0`,
    // и на пустой расстановке проба доказывала бы не тот запрет — она осталась
    // бы зелёной на мутации (проверено запуском: так и вышло с первой версией).
    const target = rows.results.find(
      (row) => row.visitObjects.length > 0 && row.placementAssignments.length > 0
    )
    expect(target, 'в реестре нет ОМ с объектом посещения и назначениями').toBeTruthy()

    await page.route(
      new RegExp(`/api/ops/security-events/${target!.id}/(\\?.*)?$`),
      async (route) => {
        const response = await route.fetch()
        const body = await response.json()
        // Объект ВПЕРЕДИ мероприятия — ровно то состояние, где карточка
        // предлагала невыполнимое.
        body.stage = 'APPROVAL'
        body.visitObjects = body.visitObjects.map((visit: Record<string, unknown>, index: number) =>
          index === 0
            ? { ...visit, stage: 'ACKNOWLEDGEMENT' }
            : { ...visit, stage: 'APPROVAL' },
        )
        await route.fulfill({ response, json: body })
      },
    )

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target!.id}/?visit=${target!.visitObjects[0].id}`)

    const complete = page.getByRole('button', { name: 'Завершить ознакомление' })
    await expect(complete).toBeVisible({ timeout: 20_000 })
    await expect(complete).toBeDisabled()
    // Причина НАЗВАНА: это не «нет прав» и не «не все подтвердили», а третье
    // состояние, и молчать о нём нельзя.
    await expect(complete).toHaveAttribute('title', /по всему мероприятию/)

    // И обратная сторона: когда мероприятие ДОШЛО до этапа, кнопка живая —
    // иначе проба доказывала бы «кнопка всегда выключена».
    await page.unroute(new RegExp(`/api/ops/security-events/${target!.id}/(\\?.*)?$`))
    await page.route(
      new RegExp(`/api/ops/security-events/${target!.id}/(\\?.*)?$`),
      async (route) => {
        const response = await route.fetch()
        const body = await response.json()
        body.stage = 'ACKNOWLEDGEMENT'
        body.visitObjects = body.visitObjects.map((visit: Record<string, unknown>) => ({
          ...visit,
          stage: 'ACKNOWLEDGEMENT',
        }))
        await route.fulfill({ response, json: body })
      },
    )
    await page.goto(`${APP}/security-ops/events/${target!.id}/?visit=${target!.visitObjects[0].id}`)
    await expect(page.getByRole('button', { name: 'Завершить ознакомление' })).toBeEnabled({
      timeout: 20_000,
    })
  })
})
