/**
 * Таблицы кадров и статусов — ЖИВОЙ стенд.
 *
 * Проба стережёт то, что обе таблицы ГОВОРЯТ ПРАВДУ, а не то, как они
 * выглядят. До правки:
 *
 * 1. ручка штатки не клала в `current_status` даты, хотя они есть в модели, —
 *    «Последнее обновление» и «Следующее обновление» печатали «Не обновлено» и
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

/** Значения колонки по её подписи в шапке. */
async function column(page: Page, head: string): Promise<string[]> {
  return page.evaluate((name) => {
    const table = document.querySelector('table')
    if (table === null) return []
    const heads = [...table.querySelectorAll('thead th')]
    const index = heads.findIndex((th) => th.textContent?.trim() === name)
    if (index === -1) return []
    return [...table.querySelectorAll('tbody tr')].map((row) =>
      (row.children[index]?.textContent ?? '').trim(),
    )
  }, head)
}

test.use({ serviceWorkers: 'block' })

test.describe(LIVE ? 'таблицы: правда в колонках' : 'таблицы (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('период статуса доезжает с бэка до обеих таблиц', async ({ page }) => {
    // Сверяемся с ответом сервера, а не с числами в коде: «сегодня» плавает.
    const token = await tokenFor('admin', 'admin123')
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

    await signIn(page, 'admin', 'admin123')
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    const since = await column(page, 'Последнее обновление')
    const until = await column(page, 'Следующее обновление')
    expect(since.length).toBeGreaterThan(0)
    // Ключевой ассерт: колонка РАЗЛИЧАЕТ строки. Одно значение на всю таблицу
    // — ровно то состояние, из которого её вытаскивали.
    expect(new Set(since).size, `«Последнее обновление» одинаково во всех строках: ${since[0]}`)
      .toBeGreaterThan(1)
    expect(new Set(until).size, `«Следующее обновление» одинаково во всех строках: ${until[0]}`)
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
      (url) => url.pathname.includes('/api/staff_unit/staff-units/directorate'),
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

    await signIn(page, 'admin', 'admin123')
    await page.goto('/statuses')
    await hydrated(page)
    await tableFilled(page)

    const marks = await page.evaluate(() => {
      const table = document.querySelector('table')
      if (table === null) return []
      const heads = [...table.querySelectorAll('thead th')]
      const index = heads.findIndex((th) => th.textContent?.trim() === 'Следующее обновление')
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

  test('кадровая таблица не выдаёт сегодняшнее число за дату у всех', async ({ page }) => {
    await signIn(page, 'admin', 'admin123')
    await page.goto('/employees/registry')
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
    const token = await tokenFor('admin', 'admin123')
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

    await signIn(page, 'admin', 'admin123')
    await page.goto('/employees/registry')
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
    const token = await tokenFor('admin', 'admin123')
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

    await signIn(page, 'admin', 'admin123')
    await page.goto('/employees/registry')
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
        await route.fulfill({ response, json: body })
      },
    )

    await signIn(page, 'admin', 'admin123')
    await page.goto('/employees/registry')
    await hydrated(page)
    await tableFilled(page)

    const names = await column(page, 'ФИО')
    const withTail = names.filter((cell) => cell.includes(`ИИН ${TAIL}`))
    expect(withTail.length, 'хвост ИИН не напечатан ни в одной строке').toBe(1)
    // Остальным ИИН не выдуман: строк с хвостом ровно одна — та, что подменена.
    expect(names.some((cell) => cell.includes('ИИН') && !cell.includes(TAIL))).toBe(false)
  })

  test('«Экспорт CSV» выгружает ОТОБРАННОЕ, а не весь список', async ({ page }) => {
    /**
     * Кнопка была без обработчика вовсе — нажатие не делало ничего и ничего не
     * сообщало. Теперь она собирает файл из уже загруженного отбора.
     *
     * 🔴 Ассерт «в файле есть строки» вакуумен: он зеленеет и на выгрузке
     * ВСЕГО списка. Отличает одно от другого только то, что отобранного
     * СТРОГО МЕНЬШЕ, чем всего, и лишних имён в файле нет. Поэтому проба
     * сначала убеждается, что отбор что-то отсёк.
     */
    await signIn(page, 'admin', 'admin123')
    await page.goto('/employees/registry')
    await hydrated(page)
    await tableFilled(page)

    const allNames = await column(page, 'ФИО')
    expect(allNames.length, 'таблица пуста — проба вакуумна').toBeGreaterThan(2)

    // Отбор по первой букве фамилии первого человека: он обязан отсечь хоть
    // кого-то, иначе «отобранное» неотличимо от «всего».
    const firstSurname = allNames[0].split('\n')[0].trim().split(' ')[0]
    await page.goto(`/employees/registry?search=${encodeURIComponent(firstSurname)}`)
    await hydrated(page)
    await tableFilled(page)
    const pickedNames = await column(page, 'ФИО')
    expect(
      pickedNames.length,
      `отбор по «${firstSurname}» ничего не отсёк — выгрузку отбора не отличить от полной`,
    ).toBeLessThan(allNames.length)
    expect(pickedNames.length).toBeGreaterThan(0)

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Экспорт CSV' }).click(),
    ]).then(([event]) => event)

    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const csv = Buffer.concat(chunks).toString('utf8')

    const lines = csv.trim().split('\r\n')
    expect(lines[0], 'в файле нет шапки').toContain('Дата найма')
    expect(lines.length - 1, 'число строк в файле не совпало с отбором').toBe(pickedNames.length)
    expect(csv).toContain(firstSurname)

    // Ни одного имени, которого в отборе нет.
    const dropped = allNames
      .map((cell) => cell.split('\n')[0].trim())
      .filter((name) => !pickedNames.some((picked) => picked.includes(name)))
    expect(dropped.length, 'отбор не отсёк ни одного имени — проба вырождена').toBeGreaterThan(0)
    for (const name of dropped) {
      expect(csv, `в файл попало отсечённое отбором имя «${name}»`).not.toContain(name)
    }
  })
})
