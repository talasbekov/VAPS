/**
 * Таблицы кадров и статусов — ЖИВОЙ стенд.
 *
 * Проба стережёт то, что обе таблицы ГОВОРЯТ ПРАВДУ, а не то, как они
 * выглядят. До правки:
 *
 * 1. ручка штатки не клала в `current_status` даты, хотя они есть в модели, —
 *    «Обновлён» и «Следующий» (до №331 — «Последнее обновление» и
 *    «Следующее обновление») печатали «Не обновлено» и
 *    «Не указано» во ВСЕХ строках, 362 px на две колонки без единого бита;
 * 2. карточка сотрудника подставляла вместо отсутствующей даты СЕГОДНЯШНЕЕ
 *    число — колонка «Дата найма» показывала одну дату у всех, а «стаж
 *    работы» обнулялся у всякого, кто ушёл в отпуск;
 * 3. подсветка просрочки не срабатывала ни разу: `isOverdue` разбирал обратно
 *    уже отформатированную строку (`new Date("14.08.2026")` → NaN).
 *
 * 🔴 Фикстура обязана содержать И просроченные статусы, И действующие — иначе
 * ассерт «просроченные отмечены» вырождается в «отмечены все» или «никто».
 */
import { expect, test, type Page } from '@playwright/test'
import { businessDateOf } from './business-date'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { probeComment } from './probe-statuses'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface StatusBrief {
  status_type: string
  state: string
  start_date?: string | null
  end_date?: string | null
}

async function tokenFor(username: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /тему|theme/i }).first()).toBeEnabled({
    timeout: 20_000,
  })
}

/**
 * Дождаться СТРОК, а не таблицы: шапка отрисована сразу, и проба, ждущая
 * `table`, читает пустой `tbody` и получает пустую колонку — «нет данных» и
 * «данные одинаковы» при этом выглядят одинаково.
 */
async function tableFilled(page: Page): Promise<void> {
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 25_000 })
}

/**
 * Значения колонки по её подписи в шапке.
 *
 * Оформительские узлы (`aria-hidden`) выбрасываются: с 27.08.2026 в колонке
 * ФИО стоит аватарка, и её ЗАГЛУШКА-ИНИЦИАЛЫ — тоже текст. Без вычистки
 * «Абенов Санжар» читался бы как «АСАбенов Санжар», и отбор по первому слову
 * искал бы несуществующую фамилию. Берётся ровно то, что читает скринридер.
 */
async function column(page: Page, head: string): Promise<string[]> {
  return page.evaluate((name) => {
    const table = document.querySelector('table')
    if (table === null) return []
    const heads = [...table.querySelectorAll('thead th')]
    const index = heads.findIndex((th) => th.textContent?.trim() === name)
    if (index === -1) return []
    return [...table.querySelectorAll('tbody tr')].map((row) => {
      const cell = row.children[index]
      if (cell === undefined) return ''
      const copy = cell.cloneNode(true) as HTMLElement
      copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove())
      return (copy.textContent ?? '').trim()
    })
  }, head)
}

/** Дата в формате API. */
const iso = (date: Date): string => date.toISOString().slice(0, 10)

/**
 * Завести СРОЧНЫЙ действующий статус (с датой окончания) первому сотруднику
 * первой страницы, у которого период свободен. Возвращает дату окончания.
 *
 * Перебор, а не «первый попавшийся»: сервер запрещает пересекающиеся статусы,
 * и на занятом человеке фикстура молча не завелась бы.
 */
async function seedTimedStatus(token: string): Promise<string> {
  const raw = await fetch(`${API}/api/staff_unit/staff-units/directorate/?page=1&page_size=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = (await raw.json()) as { staff_units: { employee: { id: number } | null }[] }
  const employees = body.staff_units
    .map((unit) => unit.employee)
    .filter((employee): employee is { id: number } => employee !== null && employee !== undefined)

  const end = new Date()
  end.setDate(end.getDate() + 6)
  const endDate = iso(end)

  for (const employee of employees) {
    const res = await fetch(`${API}/api/statuses/statuses/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        employee: employee.id,
        status_type: 'business_trip',
        start_date: iso(new Date()),
        end_date: endDate,
        comment: probeComment('Фикстура пробы «период статуса»'),
      }),
    })
    if (res.status === 201) return endDate
  }
  throw new Error(
    'не удалось завести срочный статус ни одному сотруднику первой страницы: ' +
      'у всех период пересекается. Это не повод для скипа — проверьте данные стенда.',
  )
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'таблицы: правда в колонках' : 'таблицы (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('период статуса доезжает с бэка до обеих таблиц', async ({ page }) => {
    // Сверяемся с ответом сервера, а не с числами в коде: «сегодня» плавает.
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)

    /**
     * 🔴 СРОЧНЫЙ статус заводится ПРОБОЙ, а не берётся из данных стенда
     * (Plane №255, 28.08.2026).
     *
     * Ассерт ниже требует, чтобы колонка «Следующий» РАЗЛИЧАЛА
     * строки, то есть чтобы хоть у кого-то на первой странице была дата
     * окончания. Фикстуры под это не было: `seed_smoke_fixtures` заводит
     * `OpsEmployeeStatus` (модель ОМ), а колонка читает `EmployeeStatus`
     * (модель кадрового статуса) — разные таблицы. Проба держалась на ОДНОЙ
     * случайной строке стенда, и в тот день, когда этому человеку сменили
     * статус на бессрочный «В строю», все 48 строк стали «Не указано» и проба
     * покраснела, не найдя при этом ни одного дефекта кода.
     *
     * Это тот же урок, что записан ниже у соседней пробы: данные стенда —
     * не фикстура. Отличие лишь в том, что здесь нужен ЖИВОЙ круг (ручка →
     * экран), поэтому перехватом обойтись нельзя — статус заводится по-честному.
     */
    await seedTimedStatus(token)

    const raw = await fetch(`${API}/api/staff_unit/staff-units/directorate/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await raw.json()) as {
      staff_units: { employee: { current_status: StatusBrief | null } | null }[]
    }
    const statuses = body.staff_units
      .map((unit) => unit.employee?.current_status)
      .filter((status): status is StatusBrief => status !== undefined && status !== null)

    expect(statuses.length, 'на стенде нет ни одного статуса — проба вакуумна').toBeGreaterThan(0)
    // Ручка собирает current_status литеральным словарём; даты в него не
    // клали, и обе колонки печатали константу.
    const withStart = statuses.filter((s) => typeof s.start_date === 'string' && s.start_date !== '')
    expect(withStart.length, 'ручка штатки не отдаёт start_date — колонки нечем наполнить').toBe(
      statuses.length,
    )

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    // 🔴 ПИН ПОДПИСЕЙ ПРАВЛЕН ОСОЗНАННО (Plane №331): заголовки колонок дат
    // сокращены до «Обновлён» и «Следующий» — они задавали ширину таблице,
    // а сами даты вдвое уже. Предмет пробы не изменился: колонки обязаны
    // РАЗЛИЧАТЬ строки, а не печатать одно и то же.
    const since = await column(page, 'Обновлён')
    const until = await column(page, 'Следующий')
    expect(since.length).toBeGreaterThan(0)
    // Ключевой ассерт: колонка РАЗЛИЧАЕТ строки. Одно значение на всю таблицу
    // — ровно то состояние, из которого её вытаскивали.
    expect(new Set(since).size, `«Обновлён» одинаково во всех строках: ${since[0]}`)
      .toBeGreaterThan(1)
    expect(new Set(until).size, `«Следующий» одинаково во всех строках: ${until[0]}`)
      .toBeGreaterThan(1)
    // Даты — без времени: `toLocaleString` дописывал «, 00:00:00» у поля,
    // у которого времени нет.
    expect(since.join(' ')).not.toContain('00:00:00')
  })

  test('просроченные статусы отмечены, действующие — нет', async ({ page }) => {
    /**
     * 🔴 Фикстура задаётся ПЕРЕХВАТОМ, а не берётся из данных стенда.
     *
     * Первая версия полагалась на то, что просроченные статусы на стенде есть.
     * Полный смоук-обход это опроверг: он сам кликает по кнопкам `/statuses` и
     * меняет статусы — после него просроченных не осталось ни одного, и проба
     * упала на собственном гварде против вакуума. Поодиночке она при этом была
     * зелёной, то есть падала бы только в общем прогоне.
     *
     * Обе стороны (просроченный и действующий) задаются здесь явно, поэтому
     * проба больше не зависит от того, что стенд успел пережить до неё.
     */
    const YESTERDAY = new Date()
    YESTERDAY.setDate(YESTERDAY.getDate() - 3)
    const TOMORROW = new Date()
    TOMORROW.setDate(TOMORROW.getDate() + 5)
    const iso = (value: Date) => value.toISOString().slice(0, 10)

    await page.route(
      // 🔴 ТОЛЬКО ЗАПРОС СТРАНИЦЫ, не сводки. С 28.08.2026 экран статусов
      // просит у той же ручки ещё и сводку (`with_summary=1&page_size=1`,
      // Plane №231): в её теле одна строка, и перехват, правивший «первых
      // двух со статусом», падал на собственном стороже против вакуума.
      (url) =>
        url.pathname.includes('/api/staff_unit/staff-units/directorate') &&
        url.searchParams.get('with_summary') === null,
      async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as {
          staff_units?: {
            employee?: { current_status?: Record<string, unknown> | null } | null
          }[]
        }
        const withStatus = (body.staff_units ?? []).filter(
          (unit) => unit.employee?.current_status != null,
        )
        expect(
          withStatus.length,
          'на стенде нет сотрудников со статусом — подменять нечего',
        ).toBeGreaterThan(1)

        // Первому — истёкший период, второму — действующий. Остальные как есть.
        withStatus[0].employee!.current_status!.end_date = iso(YESTERDAY)
        withStatus[1].employee!.current_status!.end_date = iso(TOMORROW)
        await route.fulfill({ response, json: body })
      },
    )

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    const marks = await page.evaluate(() => {
      const table = document.querySelector('table')
      if (table === null) return []
      const heads = [...table.querySelectorAll('thead th')]
      const index = heads.findIndex((th) => th.textContent?.trim() === 'Следующий')
      return [...table.querySelectorAll('tbody tr')].map((row) => ({
        text: (row.children[index]?.textContent ?? '').trim(),
        marked: getComputedStyle(row).backgroundColor === 'rgb(254, 242, 242)',
      }))
    })

    const dated = marks.filter((row) => /^\d{2}\.\d{2}\.\d{4}$/.test(row.text))
    expect(dated.length, 'ни одной строки с датой окончания — проба вакуумна').toBeGreaterThan(0)

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const overdue = dated.filter((row) => {
      const [day, month, year] = row.text.split('.').map(Number)
      return new Date(year, month - 1, day) < today
    })
    const actual = dated.filter((row) => !overdue.includes(row))

    // 🔴 Обе стороны обязаны быть непустыми: на одних просроченных ассерт
    // «отмечены просроченные» неотличим от «отмечены все».
    expect(overdue.length, 'нет просроченных статусов — отметку не на чем проверить').toBeGreaterThan(0)
    expect(actual.length, 'нет действующих статусов — отметка неотличима от «всегда»').toBeGreaterThan(0)

    expect(overdue.every((row) => row.marked), 'просроченная строка не отмечена').toBe(true)
    expect(actual.some((row) => row.marked), 'действующая строка отмечена как просроченная').toBe(false)
  })

  test('строка называет, из какого учёта пришло привлечение на ОМ', async ({ page }) => {
    /**
     * Plane №314. В одной ячейке соседствуют два факта из РАЗНЫХ каталогов:
     * бейдж кадрового статуса (`EmployeeStatus` — например «В строю») и ссылки
     * на мероприятия из каталога раздела ОМ. Оба верны каждый в своём учёте, но
     * рядом и без подписи строка утверждала разом «в строю» и «привлечён на
     * ОМ» — и читалось это как противоречие данных, а не как два учёта.
     *
     * 🔴 ПИН ПРАВЛЕН ОСОЗНАННО (30.08.2026). Здесь стерёгся ПОДПИСЬ-ярлык «по
     * учёту ОМ» внутри общей ячейки — половинчатая мера, пока заказчик не
     * выбрал главный каталог. Выбор сделан: ЯВНАЯ ВТОРАЯ КОЛОНКА «По разделу
     * ОМ». Подписи больше нет — вместо неё колонка, и проба стережёт её:
     * учёт раздела обязан стоять В СВОЕЙ ячейке, а кадровый бейдж — в своей.
     * Мост кодов (раздел перекрывает кадровый) заказчиком отвергнут, и проба
     * заодно держит этот конец: кадровый бейдж из строки не исчезает.
     *
     * 🔴 ПОДОПЫТНОГО НАХОДИМ ЧЕРЕЗ API, А НЕ «КТО ПОПАЛСЯ НА ПЕРВОЙ СТРАНИЦЕ»
     * (урок Plane №288). Первая редакция этой пробы искала строку с ссылкой на
     * ОМ среди видимых пятидесяти — и через полчаса покраснела, потому что
     * фикстуры пересеялись и привлечённый уехал с первой страницы. Кто
     * привлечён сегодня, знает сервер; таблицу доводим до него поиском.
     */
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    // Деловая дата — С СЕРВЕРА (Plane №373). `toISOString()` отдаёт UTC, и в
    // плюсовой зоне после семи вечера проба спрашивала бы ВЧЕРАШНИЕ статусы,
    // сравнивая их с сегодняшним экраном.
    const today = await businessDateOf(API, token)
    const statuses = (await (
      await fetch(`${API}/api/operations/statuses/?business_date=${today}&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { results?: Array<{ employee_id: number; participations?: unknown[] }> }
    const attached = (statuses.results ?? []).find(
      (row) => (row.participations ?? []).length > 0,
    )
    expect(
      attached,
      'на стенде сегодня нет ни одного привлечения на ОМ — проверять нечего',
    ).toBeDefined()

    const employee = (await (
      await fetch(`${API}/api/core/employees/${attached!.employee_id}/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { last_name: string; first_name: string }

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    await page.getByPlaceholder('Поиск по ФИО').fill(`${employee.last_name} ${employee.first_name}`)
    // 🔴 СТРОКА АДРЕСУЕТСЯ ПО id, А НЕ ПО ФАМИЛИИ. На стенде полных тёзок по
    // четверо, и поиск (пословный с Plane №312) вернёт их всех: `.first()` по
    // фамилии выбрал бы однофамильца БЕЗ привлечения, проба упала бы с
    // «пропала ссылка на мероприятие» и указала на регрессию, которой нет.
    // Атрибут `data-employee-id` заведён ради этого же в №281.
    const row = page.locator(
      `table tbody tr[data-employee-id="${attached!.employee_id}"]`,
    )
    await expect(row, `сотрудник ${employee.last_name} не нашёлся в таблице`).toBeVisible({
      timeout: 15_000,
    })
    // Колонки адресуются по позиции заголовка, а не по номеру ячейки в коде:
    // порядок колонок — вопрос вёрстки, и вшитый индекс сломался бы от любой
    // перестановки, ничего не сказав о сути.
    const headers = await page.locator('table thead th').allInnerTexts()
    const kadrIndex = headers.findIndex((text) => text.includes('Статус (кадровый)'))
    const opsIndex = headers.findIndex((text) => text.includes('По разделу ОМ'))
    expect(kadrIndex, 'колонки кадрового статуса нет вовсе').toBeGreaterThanOrEqual(0)
    expect(opsIndex, 'колонки «По разделу ОМ» нет вовсе (Plane №314)').toBeGreaterThanOrEqual(0)

    const opsCell = row.locator('td').nth(opsIndex)
    const kadrCell = row.locator('td').nth(kadrIndex)

    await expect(
      opsCell.getByRole('link', { name: /^→ ОМ-/ }),
      'ссылка на мероприятие ушла не в колонку раздела — учёты снова в одной ячейке',
    ).toBeVisible()
    await expect(
      kadrCell.getByRole('link', { name: /^→ ОМ-/ }),
      'ссылка на мероприятие осталась в кадровой колонке: строка снова утверждает два факта разом',
    ).toHaveCount(0)
    // Кадровый статус НЕ перекрыт разделом (мост кодов заказчиком отвергнут):
    // бейдж на месте, и им живут кадровые отчёты.
    await expect(
      kadrCell.locator('span,div').first(),
      'кадровый бейдж исчез из своей колонки',
    ).toBeVisible()
    await expect(
      await kadrCell.innerText(),
      'кадровая колонка пуста — статус подменён учётом раздела',
    ).not.toBe('')
  })

  test('привлечения доезжают до таблицы ВСЕ, а не первой страницей', async ({ page }) => {
    /**
     * Класс дефекта, который проба «одной строки» поймать не может.
     *
     * Соседняя проба выше проверяет, что у КОНКРЕТНОГО привлечённого видна
     * ссылка на ОМ, — и она была зелёной, когда экран получал 50 строк участий
     * из тысячи: её подопытный попадал в эти 50. Дефект (ручка раздела
     * пагинируется limit/offset и параметр `page_size` ИГНОРИРУЕТ, умолчание
     * 50) нашло ревью, а не прогон, потому что ни один ассерт не говорил
     * о ЧИСЛЕ. Утверждение «участие видно у Иванова» не отвечает на вопрос
     * «а у остальных?».
     *
     * Здесь ассерт именно о числе: у КАЖДОЙ видимой строки, чей сотрудник по
     * данным сервера сегодня привлечён, обязана стоять ссылка на мероприятие.
     * Разъедется клиент с сервером на одну строку — проба назовёт её поимённо.
     */
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    // 🔴 ДЕЛОВАЯ ДАТА — С СЕРВЕРА, а не из браузерных часов (Plane №373).
    // Здесь эта проба и попалась: 01.09.2026 в 00:26 по местному времени
    // (UTC+5) `toISOString()` дал 31.08, проба взяла ВЧЕРАШНИЕ привлечения и
    // объявила «у сотрудников 7, 9, 10 сервер знает, а таблица не
    // показывает». Экран при этом был прав — он спрашивает дату у расхода
    // (`use-ops-section-statuses`), как и положено.
    const today = await businessDateOf(API, token)

    // Все страницы, а не первая: ровно та ошибка, которую проба и стережёт.
    const attachedIds = new Set<number>()
    let next: string | null =
      `${API}/api/operations/statuses/?business_date=${today}&limit=200`
    for (let guard = 0; guard < 20 && next !== null; guard += 1) {
      const body = (await (
        await fetch(next, { headers: { Authorization: `Bearer ${token}` } })
      ).json()) as {
        results?: Array<{ employee_id: number; participations?: unknown[] }>
        next?: string | null
      }
      for (const row of body.results ?? []) {
        if ((row.participations ?? []).length > 0) attachedIds.add(row.employee_id)
      }
      next = body.next ?? null
    }
    expect(
      attachedIds.size,
      'на стенде сегодня нет ни одного привлечения — проверять нечего',
    ).toBeGreaterThan(0)

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    // 🔴 ЖДЁМ УЧАСТИЯ, а не читаем таблицу сразу. `tableFilled` говорит, что
    // пришли СТРОКИ; участия едут отдельным запросом и позже — ровно как
    // фотографии в пробе аватарок (Plane №293). Первая редакция этой пробы
    // читала DOM немедленно и объявляла «сервер знает привлечение, а таблица
    // не показывает» у девяти сотрудников подряд — то есть обвиняла код в
    // дефекте, которого нет, ещё и убедительным списком имён.
    await expect(
      page.locator('table tbody a[href^="/security-ops/events/"]').first(),
      'ни одной ссылки на мероприятие не появилось — участия не доехали вовсе',
    ).toBeVisible({ timeout: 20_000 })

    const visible = await page.evaluate(() =>
      [...document.querySelectorAll('table tbody tr[data-employee-id]')].map((row) => ({
        id: Number(row.getAttribute('data-employee-id')),
        // Ссылка ИЛИ подпись «ОМ снят»: у участия в удалённом мероприятии
        // интерфейс намеренно рисует текст, а не ссылку в 404 (Plane №281).
        // Требовать здесь именно <a> значило бы краснеть на правильном коде.
        shown:
          row.querySelector('a[href^="/security-ops/events/"]') !== null ||
          (row.textContent ?? '').includes('ОМ снят'),
      })),
    )
    const shouldHaveLink = visible.filter((row) => attachedIds.has(row.id))
    expect(
      shouldHaveLink.length,
      'ни один привлечённый не попал на видимую страницу — ассерт о числе стал бы вакуумным',
    ).toBeGreaterThan(0)

    const missing = shouldHaveLink.filter((row) => !row.shown).map((row) => row.id)
    expect(
      missing,
      `у сотрудников ${missing.join(', ')} сервер знает привлечение, а таблица его не показывает — ` +
        'клиент забрал не все участия (так было при page_size вместо limit: 50 строк из тысячи)',
    ).toEqual([])
  })

  test('без известного мероприятия «Участие в ОМ» ведёт на общий разрез и говорит об этом', async ({
    page,
  }) => {
    /**
     * 🔴 Фикстура — ПЕРЕХВАТ, не мутация стенда: `EmployeeStatus.StatusType`
     * на бэке `staff_unit/staff-units/directorate/` вообще не знает кода
     * `EVENT_ASSIGNMENT` — это код каталога `operations` (раздел «Сбор сил на
     * ОМ», см. `seed_status_types.py`), другая модель. На живом стенде такой
     * строки быть не может в принципе — только перехватом.
     */
    const EVENT_ASSIGNMENT = 'EVENT_ASSIGNMENT'
    // 🔴 ПИН ПОДПИСИ ИЗМЕНЁН ОСОЗНАННО ВТОРОЙ РАЗ (Plane №281; первый — №274,
    // Ш-5). Прежний текст — «Мероприятия участия видны в разрезе „Сбор сил“» —
    // описывал состояние, когда мероприятие СИСТЕМЕ ИЗВЕСТНО, а экрану нет:
    // теперь известно и ему, и в строке стоит ссылка на карточку конкретного
    // ОМ. Общий разрез остался ровно для случая, который эта проба и
    // воспроизводит: кадровый статус говорит «участвует», а участий у
    // сотрудника нет — статус проставлен без привязки (так заводили до Ш-3).
    // Подпись теперь называет ИМЕННО ЭТО, а не место, где искать.
    const CAPTION = 'Мероприятие у статуса не указано'

    await page.route(
      // 🔴 ТОЛЬКО ЗАПРОС СТРАНИЦЫ, не сводки. С 28.08.2026 экран статусов
      // просит у той же ручки ещё и сводку (`with_summary=1&page_size=1`,
      // Plane №231): в её теле одна строка, и перехват, правивший «первых
      // двух со статусом», падал на собственном стороже против вакуума.
      (url) =>
        url.pathname.includes('/api/staff_unit/staff-units/directorate') &&
        url.searchParams.get('with_summary') === null,
      async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as {
          staff_units?: {
            employee?: { current_status?: Record<string, unknown> | null } | null
          }[]
        }
        const withStatus = (body.staff_units ?? []).filter(
          (unit) => unit.employee?.current_status != null,
        )
        expect(
          withStatus.length,
          'на стенде меньше двух сотрудников со статусом — вакуумный гвард не на чем проверить',
        ).toBeGreaterThan(1)

        // Только ПЕРВОМУ — «Участие в ОМ»: остальные остаются как есть, иначе
        // гвард «ссылка не у всех» вырождается в «ни у кого».
        withStatus[0].employee!.current_status!.status_type = EVENT_ASSIGNMENT
        await route.fulfill({ response, json: body })
      },
    )

    // 🔴 ВТОРОЙ ПЕРЕХВАТ — ПУСТЫЕ УЧАСТИЯ (Plane №281). Без него проба зависела
    // бы от данных стенда: у сотрудника, которому она подменяет кадровый код,
    // в разделе ОМ вполне может быть живое участие, и тогда экран — правильно
    // — покажет ссылку на КОНКРЕТНОЕ мероприятие вместо общего разреза.
    // Проверяется здесь именно запасная ветка, поэтому «мероприятий нет»
    // задаётся явно, а не выпрашивается у стенда.
    await page.route(
      (url) => url.pathname.includes('/api/operations/statuses'),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
        })
      },
    )

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    const rows = page.locator('table tbody tr')
    const rowCount = await rows.count()
    expect(rowCount, 'таблица пуста — пробе не на чем стоять').toBeGreaterThan(1)

    const links = page.getByRole('link', { name: '→ Сбор сил' })
    await expect(links).toHaveCount(1)
    // `next.config.js` несёт `trailingSlash: true` — рендер добавляет слэш
    // перед строкой запроса (как и у соседней ссылки в PlacementStage.tsx,
    // см. `events-registry.spec.ts:170`); адрес назначения от этого не
    // меняется, поэтому слэш здесь необязательный, а не расплывчатый.
    await expect(links.first()).toHaveAttribute('href', /^\/employees\/?\?view=forces$/)

    // 🔴 Вакуумный гвард: если бы ссылка рисовалась у КАЖДОЙ строки, предикат
    // «только у «Участие в ОМ»» был бы сломан и остался незамеченным —
    // «есть ссылка» превратилось бы в «есть таблица».
    expect(
      rowCount - (await links.count()),
      'ссылка есть у каждой строки — предикат статуса её не фильтрует',
    ).toBeGreaterThan(0)

    const row = rows.filter({ has: page.getByRole('link', { name: '→ Сбор сил' }) })
    await expect(row).toHaveCount(1)
    await expect(row.getByText(CAPTION, { exact: true })).toBeVisible()
    // 🔴 ПИН ПОДПИСИ ПОДНЯТ ОСОЗНАННО (Plane №366). Здесь стояло «Участие в
    // ОМ» — литерал, который клиент печатал САМ веточкой на два кода
    // (`describeStatus` в `status-table.tsx`), одинаково для наряда и для
    // боевой группы. Веточка снята: подпись приходит из справочника, а он эти
    // два вида различает («…(наряд)» и «…(боевая группа)») — как их различает
    // и сам заказчик, который справочник и правит.
    //
    // Ожидание берётся ИЗ СПРАВОЧНИКА, а не вписывается строкой: заказчик
    // вправе переименовать тип в админке завтра, и пин обязан краснеть на
    // поломке вывода, а не на переименовании. Ссылка «→ Сбор сил» по-прежнему
    // проверена ВЫШЕ и по-прежнему стоит у обоих кодов — «тот же вид работы»
    // держится предикатом по коду, а не совпадением подписей.
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const catalog = (await (
      await fetch(`${API}/api/statuses/types/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as Array<{ code: string; label: string }>
    const assignmentLabel = catalog.find((item) => item.code === EVENT_ASSIGNMENT)?.label
    expect(
      assignmentLabel,
      `в справочнике нет кода ${EVENT_ASSIGNMENT} — сверять подпись не с чем`,
    ).toBeTruthy()
    await expect(
      row.getByText(assignmentLabel!, { exact: true }),
      'подпись статуса разошлась со справочником — вывод снова печатает свой литерал',
    ).toBeVisible()
  })

  test('кадровая таблица не выдаёт сегодняшнее число за дату у всех', async ({ page }) => {
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    // 🔴 АДРЕС С `?view=forces` ЯВНО (Plane №273). Вид по умолчанию сменился на
    // «Ежедневный расход организации» — решение заказчика о порядке вкладок; без
    // параметра эта проба открывала бы борд расхода, а проверяет она реестр.
    await page.goto('/employees?view=forces')
    await hydrated(page)
    await tableFilled(page)

    const values = await column(page, 'Статус с')
    expect(values.length, 'таблица сотрудников пуста — проба вакуумна').toBeGreaterThan(1)

    // Колонка звалась «Дата найма», а несла начало текущего статуса с
    // фолбэком `new Date()`: у всех строк стояло сегодняшнее число.
    const todayRu = new Date().toLocaleDateString('ru-RU')
    expect(
      values.every((value) => value === todayRu),
      `все строки показывают сегодняшнюю дату (${todayRu}) — вернулся фолбэк «сегодня»`,
    ).toBe(false)
    expect(new Set(values).size, 'колонка одинакова во всех строках').toBeGreaterThan(1)

    // Колонки «Контакты» нет: телефон и почту эта ручка не отдаёт вовсе, а
    // подпись поля с пустым значением читается как «не заполнено».
    const heads = await page.evaluate(() =>
      [...document.querySelectorAll('table thead th')].map((th) => th.textContent?.trim() ?? ''),
    )
    expect(heads).not.toContain('Контакты')
  })

  test('«Дата найма» — своя дата, а не начало статуса', async ({ page }) => {
    /**
     * Колонка прототипа вернулась, но уже со своим источником: ручка штатки
     * теперь кладёт `hire_date` из модели. Раньше под этой подписью ехало
     * начало ТЕКУЩЕГО СТАТУСА — отсюда её и сняли.
     *
     * 🔴 Проба обязана СРАВНИТЬ две колонки между собой. Ассерт «даты найма
     * различаются» зеленел бы и на прежней подмене: начала статусов тоже
     * разные. Отличает подмену только то, что у одного и того же человека
     * «Статус с» и «Дата найма» — РАЗНЫЕ дни.
     */
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const raw = await fetch(`${API}/api/staff_unit/staff-units/directorate/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await raw.json()) as {
      staff_units: {
        employee: {
          hire_date?: string | null
          rank?: string | null
          iin_masked?: string | null
          current_status: StatusBrief | null
        } | null
      }[]
    }
    const people = body.staff_units
      .map((unit) => unit.employee)
      .filter((employee): employee is NonNullable<typeof employee> => employee != null)

    expect(people.length, 'на стенде нет сотрудников — проба вакуумна').toBeGreaterThan(1)
    const hired = people.map((p) => p.hire_date).filter((v): v is string => !!v)
    expect(hired.length, 'ручка не отдаёт hire_date — колонке неоткуда взяться').toBe(people.length)
    expect(new Set(hired).size, 'дата найма одинакова у всех — проба не различает поля')
      .toBeGreaterThan(1)

    // Гвард против вакуума ГЛАВНОГО ассерта: хотя бы у одного человека дата
    // найма обязана отличаться от начала его статуса. Если совпадут все,
    // подмену полей ничем не поймать.
    const differing = people.filter(
      (p) => p.hire_date && p.current_status?.start_date && p.hire_date !== p.current_status.start_date,
    )
    expect(
      differing.length,
      'ни у кого дата найма не отличается от начала статуса — подмену не отличить',
    ).toBeGreaterThan(0)

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    // 🔴 АДРЕС С `?view=forces` ЯВНО (Plane №273). Вид по умолчанию сменился на
    // «Ежедневный расход организации» — решение заказчика о порядке вкладок; без
    // параметра эта проба открывала бы борд расхода, а проверяет она реестр.
    await page.goto('/employees?view=forces')
    await hydrated(page)
    await tableFilled(page)

    const heads = await page.evaluate(() =>
      [...document.querySelectorAll('table thead th')].map((th) => th.textContent?.trim() ?? ''),
    )
    expect(heads).toContain('Дата найма')
    expect(heads).toContain('Статус с')

    const hiredColumn = await column(page, 'Дата найма')
    const sinceColumn = await column(page, 'Статус с')
    expect(hiredColumn.length).toBeGreaterThan(1)
    expect(new Set(hiredColumn).size, 'колонка «Дата найма» одинакова во всех строках')
      .toBeGreaterThan(1)
    // Две колонки не совпадают построчно — значит в правой не копия левой.
    expect(
      hiredColumn.some((value, index) => value !== sinceColumn[index]),
      '«Дата найма» построчно повторяет «Статус с» — вернулась подмена полей',
    ).toBe(true)
  })

  test('под именем стоит звание, а не пустая строка', async ({ page }) => {
    /**
     * Подстрока прототипа. На её месте печаталось поле `manager`, которому
     * ручка штатки не даёт источника: во ВСЕХ строках стояла пустая строка.
     */
    const token = await tokenFor(STAND_USERNAME, STAND_PASSWORD)
    const raw = await fetch(`${API}/api/staff_unit/staff-units/directorate/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await raw.json()) as {
      staff_units: { employee: { last_name: string; rank?: string | null } | null }[]
    }
    const people = body.staff_units
      .map((unit) => unit.employee)
      .filter((employee): employee is NonNullable<typeof employee> => employee != null)

    const ranked = people.filter((p) => !!p.rank)
    expect(ranked.length, 'ни у кого на стенде нет звания — проба вакуумна').toBeGreaterThan(0)
    // Гвард против «звание у всех одинаковое»: тогда ассерт ниже не отличит
    // живое поле от подставленной константы.
    expect(new Set(ranked.map((p) => p.rank)).size, 'звание одинаково у всех — проба вырождена')
      .toBeGreaterThan(1)

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    // 🔴 АДРЕС С `?view=forces` ЯВНО (Plane №273). Вид по умолчанию сменился на
    // «Ежедневный расход организации» — решение заказчика о порядке вкладок; без
    // параметра эта проба открывала бы борд расхода, а проверяет она реестр.
    await page.goto('/employees?view=forces')
    await hydrated(page)
    await tableFilled(page)

    const names = await column(page, 'ФИО')
    expect(names.length).toBeGreaterThan(1)
    // Каждое звание стоит в строке СВОЕГО человека, а не «где-то в таблице».
    for (const person of ranked.slice(0, 3)) {
      const cell = names.find((value) => value.includes(person.last_name))
      expect(cell, `строки ${person.last_name} нет в таблице`).toBeTruthy()
      expect(cell, `под именем ${person.last_name} нет звания «${person.rank}»`).toContain(
        person.rank!,
      )
    }
  })

  test('ИИН печатается хвостом — фикстура перехватом', async ({ page }) => {
    /**
     * 🔴 Фикстура НЕ берётся из данных стенда: у сотрудников подразделения
     * `admin` ИИН не заполнен ни у кого, и проба «хвост напечатан» была бы
     * вакуумной — она молча проверяла бы пустоту.
     *
     * Маскирование как таковое стережёт бэк
     * (`test_directorate_personnel_fields.py`): там и полного ИИН нет во всём
     * теле ответа, и короткое значение скрывается целиком. Здесь проверяется
     * ровно одно — что фронт ПЕЧАТАЕТ пришедший хвост, а не роняет его.
     *
     * Перехват по предикату, а не по глобу: путь заканчивается слэшем, и
     * `/**` его не ловит.
     */
    const TAIL = '•••••• 4216'
    const served = new Set<string>()
    await page.route(
      (url) => url.pathname.endsWith('/staff-units/directorate/'),
      async (route) => {
        const response = await route.fetch()
        const body = (await response.json()) as {
          staff_units: { employee: { iin_masked?: string | null } | null }[]
        }
        const first = body.staff_units.find((unit) => unit.employee != null)
        expect(first, 'в ответе нет ни одного сотрудника — перехват нечего править').toBeTruthy()
        first!.employee!.iin_masked = TAIL
        served.clear()
        for (const unit of body.staff_units) {
          const masked = unit.employee?.iin_masked
          if (masked != null && masked !== '') served.add(masked)
        }
        await route.fulfill({ response, json: body })
      },
    )

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    // 🔴 АДРЕС С `?view=forces` ЯВНО (Plane №273). Вид по умолчанию сменился на
    // «Ежедневный расход организации» — решение заказчика о порядке вкладок; без
    // параметра эта проба открывала бы борд расхода, а проверяет она реестр.
    await page.goto('/employees?view=forces')
    await hydrated(page)
    await tableFilled(page)

    const names = await column(page, 'ФИО')
    const withTail = names.filter((cell) => cell.includes(`ИИН ${TAIL}`))
    expect(withTail.length, 'хвост ИИН не напечатан ни в одной строке').toBe(1)

    /**
     * Остальным ИИН не выдуман. Раньше здесь стояло «ни в одной другой строке
     * слова ИИН нет» — и это держалось на том, что на стенде ИИН не заполнен
     * ни у кого (27.08.2026 сид №204 заполнил его у 426 человек, и проба стала
     * красной, ничего не сломав по существу). Проверяется то же самое, но по
     * существу: КАЖДЫЙ напечатанный хвост пришёл из ответа ручки.
     */
    const printed = names
      .filter((cell) => cell.includes('ИИН'))
      .map((cell) => cell.slice(cell.indexOf('ИИН') + 'ИИН'.length).trim())
    expect(printed.length, 'хвостов на экране меньше, чем строк с ИИН в ответе').toBeGreaterThan(0)
    const invented = printed.filter((tail) => !served.has(tail))
    expect(invented, `фронт напечатал хвост, которого не было в ответе: ${invented.join(', ')}`).toEqual(
      [],
    )
  })

  test('«Экспорт CSV» выгружает ВЕСЬ ОТБОР, а не показанную страницу', async ({ page }) => {
    /**
     * Кнопка была без обработчика вовсе; потом собирала файл из загруженного
     * списка. С 27.08.2026 реестр листается по пятьдесят строк (Plane №228), и
     * проба переписана под это:
     *
     * 🔴 «В файле есть строки» вакуумно — зеленеет и на выгрузке страницы.
     * Отличает одно от другого ровно одно: строк в файле СТОЛЬКО ЖЕ, сколько
     * сервер насчитал по отбору («Показано N из M» — берётся M), и это число
     * БОЛЬШЕ страницы. Иначе человек, нажавший «Экспорт» на пяти тысячах
     * сотрудников, получил бы полсотни и не узнал бы об этом.
     */
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    // 🔴 АДРЕС С `?view=forces` ЯВНО (Plane №273). Вид по умолчанию сменился на
    // «Ежедневный расход организации» — решение заказчика о порядке вкладок; без
    // параметра эта проба открывала бы борд расхода, а проверяет она реестр.
    await page.goto('/employees?view=forces')
    await hydrated(page)
    await tableFilled(page)

    const allNames = await column(page, 'ФИО')
    expect(allNames.length, 'таблица пуста — проба вакуумна').toBeGreaterThan(2)

    // Отбор по фамилии первого человека: он обязан отсечь хоть кого-то, иначе
    // «отобранное» неотличимо от «всего».
    const firstSurname = allNames[0].split('\n')[0].trim().split(' ')[0]
    // `view=forces` НЕ ТЕРЯЕТСЯ при переходе с отбором: без него адрес
    // открывает расход организации, и «отобранный реестр» проверять негде.
    await page.goto(
      `/employees?view=forces&search=${encodeURIComponent(firstSurname)}`,
    )
    await hydrated(page)
    await tableFilled(page)

    const counter = await page.locator('text=/Показано \\d+ из \\d+/').first().innerText()
    const [shown, matched] = counter.match(/\d+/g)!.map(Number)
    expect(matched, 'отбор ничего не нашёл').toBeGreaterThan(0)

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Экспорт CSV/ }).click(),
    ]).then(([event]) => event)

    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const csv = Buffer.concat(chunks).toString('utf8')

    const lines = csv.trim().split('\r\n')
    expect(lines[0], 'в файле нет шапки').toContain('Дата найма')
    expect(
      lines.length - 1,
      `в файле ${lines.length - 1} строк, а отбору отвечает ${matched}: выгружена страница, а не отбор`,
    ).toBe(matched)
    expect(csv).toContain(firstSurname)

    // Имя, которого в отборе нет, в файл не попадает. Берём его из полного
    // списка: там есть люди с другими фамилиями.
    const alien = allNames
      .map((cell) => cell.split('\n')[0].trim().split(' ')[0])
      .find((surname) => surname !== firstSurname && !surname.startsWith(firstSurname))
    expect(alien, 'на стенде все однофамильцы — проба вырождена').toBeTruthy()
    expect(csv, `в файл попало отсечённое отбором имя «${alien}»`).not.toContain(alien!)

    // И «показано» на экране — это страница, а не весь отбор: если они равны,
    // страниц нет, и проба ничего не сторожит.
    expect(shown).toBeLessThanOrEqual(matched)
  })

  test('в строке реестра стоит аватарка, а без фотографии — инициалы', async ({ page }) => {
    /**
     * Две половины, и обе обязательны (Plane №206).
     *
     * 🔴 ФОТОГРАФИЯ ДОЛЖНА ЗАГРУЗИТЬСЯ, а не просто «тег на месте»: адрес
     * приходит относительным («/media/…»), и без перезаписи `/media/*` в
     * `next.config.js` браузер получил бы 404 — картинка была бы битой, а
     * ассерт «есть <img>» этого не заметил бы. Поэтому проверяется
     * `naturalWidth`, то есть факт декодирования.
     *
     * 🔴 БЕЗ ФОТОГРАФИИ ОБЯЗАНЫ БЫТЬ ИНИЦИАЛЫ. У части сотрудников стенда
     * фотографии нет вовсе; заглушка-картинка вместо инициалов не различает
     * строки, а битая иконка браузера читается как поломка.
     */
    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    // 🔴 АДРЕС С `?view=forces` ЯВНО (Plane №273). Вид по умолчанию сменился на
    // «Ежедневный расход организации» — решение заказчика о порядке вкладок; без
    // параметра эта проба открывала бы борд расхода, а проверяет она реестр.
    await page.goto('/employees?view=forces')
    await hydrated(page)
    await tableFilled(page)

    const rows = page.locator('table tbody tr')
    const total = await rows.count()
    expect(total, 'в реестре нет строк — проба вакуумна').toBeGreaterThan(1)

    const avatars = page.locator('table tbody tr img[src*="/media/"]')

    // 🔴 КАРТИНКИ ЖДУТ, А НЕ СЧИТАЮТСЯ МГНОВЕННО (Plane №293). `tableFilled`
    // говорит, что пришли СТРОКИ; фотографии в них подгружаются отдельными
    // запросами и позже. Прежний `avatars.count()` сразу после него ловил
    // момент, когда строки уже есть, а картинок ещё нет, — и проба падала на
    // «ни одной аватарки» в КОНЦЕ длинного прогона, когда машине тяжелее, а
    // запущенная одиночно была зелёной. Красная проба, зависящая от нагрузки,
    // не отвечает ни на один вопрос: «смоук зелёный» перестаёт значить что-то
    // определённое, и каждый прогон разбирается руками (так было дважды за
    // 28-29.08.2026).
    await expect(
      avatars.first(),
      'ни одной аватарки в реестре: ни одна строка не показала фотографию',
    ).toBeVisible({ timeout: 20_000 })

    // Ждать «пока догрузятся ВСЕ» не нужно и вредно: Radix-аватарка вставляет
    // <img> в DOM ТОЛЬКО после успешной загрузки, а до тех пор держит
    // заглушку-инициалы. Значит каждая найденная картинка уже загружена, а
    // строка с едущей фотографией просто не попадает в выборку. Проверка «все
    // complete» была бы новым источником мигания: под задержкой отдачи
    // картинок она не сходится, хотя проверять там нечего.
    const withPhoto = await avatars.count()
    expect(withPhoto, 'ни одной аватарки в реестре').toBeGreaterThan(0)

    // `naturalWidth` — это факт ДЕКОДИРОВАНИЯ, а не «тег на месте»: адрес
    // приходит относительным, и без перезаписи `/media/*` браузер получил бы
    // 404 (картинка битая, а `complete` у неё всё равно true).
    const decoded = await avatars.first().evaluate((img) => (img as HTMLImageElement).naturalWidth)
    expect(decoded, 'аватарка не загрузилась: адрес отдаёт не картинку').toBeGreaterThan(0)

    const initials = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('table tbody tr')]
      return rows
        .filter((row) => row.querySelector('img[src*="/media/"]') === null)
        .map((row) => (row.querySelector('[data-slot="avatar-fallback"]')?.textContent ?? '').trim())
    })
    const withoutPhoto = initials.length
    expect(withoutPhoto, 'на стенде все с фотографиями — заглушку никто не проверит').toBeGreaterThan(0)
    expect(
      initials.every((text) => /^[А-ЯЁA-Z]{1,2}$/.test(text)),
      `вместо инициалов: ${initials.filter((t) => !/^[А-ЯЁA-Z]{1,2}$/.test(t)).join(', ')}`,
    ).toBe(true)
  })
})
