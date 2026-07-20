// Story 10.5 (QA-добор, workflow qa-generate-e2e-tests) — экран расхода в
// РЕАЛЬНОМ chromium против прод-сборки харнеса (порт 4174, dist-e2e).
//
// Зачем это поверх 88 плотных vitest-тестов стори. Дев-сюита сильная и
// мутационно проверенная (красная проба 5/5). Повторять её здесь незачем —
// взяты РОВНО те четыре места, где QA-проба показала, что правку прод-кода не
// краснит НИ ОДИН из 622 тестов проекта:
//
//   1) ВРЕЗКА В МАРШРУТ. Элемент маршрута `/reports` заменён мёртвым
//      компонентом `<h1>Отчёты</h1>` — 622/622 зелёных. Единственный тест,
//      реально открывающий маршрут (`app-layout.qa.test.tsx:141-151`),
//      ассертит РОВНО заголовок первого уровня, а заголовок есть и у мёртвого
//      дублёра. Экран мог бы вообще не доехать до приложения. Здесь смонтирована
//      настоящая таблица маршрутов, поэтому подмена краснит всё.
//   2) БАЙТЫ СКАЧАННОГО ФАЙЛА. `saveBlob(blob, …)` заменён на
//      `saveBlob(new Blob([]), …)` — 622/622 зелёных: jsdom не имеет
//      `URL.createObjectURL` вовсе, оба метода и клик по `<a download>` в
//      дев-сюите застабены, то есть весь путь сохранения там имитируется.
//      Оператор получил бы файл на 0 байт. Это ровно открытый вопрос №5 стори
//      («честная проверка байтов — только Playwright»), и здесь он закрыт.
//   3) ЛОКАЛЬНАЯ ДАТА. `todayLocalIso()` заменён на UTC-срез
//      (`toISOString().slice(0,10)`) — 622/622 зелёных. Первый юнит-тест
//      вычисляет ожидание ТЕМ ЖЕ способом (вакуумен по построению), второй сам
//      помечен «самодоказателен только в зонах, где они расходятся» и под
//      системной TZ гейта (+05, дневной прогон) проверяет лишь форму строки.
//      Здесь браузер живёт в UTC+14 с фиксированными часами — расхождение
//      гарантировано, а не оставлено на удачу.
//   4) НАСТОЯЩИЙ `<input type="date">`. Тип поля понижен до `text` — 622/622
//      зелёных: для jsdom это тот же текстовый инпут, `valueAsDate` он не
//      реализует. В браузере понижение означает потерю календаря и потерю
//      валидации ввода у поля, от которого зависит весь экран.
//
// Чего здесь НЕТ и почему:
//   • Живого бэкенда — это стори 10.10 (compose-контур). Сеть перехвачена
//     page.route, то есть НА УРОВНЕ БРАУЗЕРА: fetch настоящий, заголовки из
//     credential.ts настоящие, у границы работает боевой parseErrorResponse.
//   • Карты отказов AC-5 и экрана «кто не сдал» AC-6 — их девять тестов
//     дев-сюиты честны и мутационно доказаны (пробы №1 и №2 стори), в браузере
//     они проверяли бы то же самое. Дублировать нечего.
//   • Обхода блокировки «на завтра» — это стори 10.5a, поверхности здесь нет.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// Абсолютный URL: глобальный baseURL (4173) принадлежит print-спекам 8.8.
const HARNESS = 'http://localhost:4174/e2e-harness/expense.html'

// 🔴 Браузер живёт в UTC+14 (максимум смещения), а часы зафиксированы на
// 12:00 UTC. Значит локальная дата — 20 июля, а UTC-срез — 19 июля: любая
// подмена `todayLocalIso` на `toISOString().slice(0,10)` уводит экран на сутки
// назад НА КАЖДОМ прогоне, а не «иногда вечером».
test.use({ timezoneId: 'Pacific/Kiritimati' })
const FIXED_UTC = '2026-07-19T12:00:00.000Z'
const LOCAL_TODAY = '2026-07-20' // то же мгновение в UTC+14
const UTC_TODAY = '2026-07-19' // то, что показал бы UTC-срез

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const DIVISION_NAME = 'Управление кадров'
const ATTACHMENT_ID = 'b2c3d4e5-f607-1829-3a4b-5c6d7e8f9012'

/** Тело «файла»: сигнатура ZIP (docx — это zip) + кириллический маркер.
 *  Кириллица в фикстуре — урок E9: латиница даёт зелёный тест на сломанном. */
const DOCX_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('расход-ЛС-контрольный-маркер', 'utf8'),
])

/** Имя от СЕРВЕРА. Кириллица ⇒ на проводе только `filename*=UTF-8''<pct>`;
 *  без `decodeURIComponent` файл сохранился бы с процентами в имени. */
const SERVER_FILENAME = `расход_${LOCAL_TODAY}_исх-247.docx`

interface Traffic {
  /** GET point-lookup'ов расхода, считается на уровне браузера. */
  gets: number
  /** Тела ушедших POST выпуска — для ассерта «ровно два поля». */
  posts: unknown[]
  /** Заголовки запроса файла: голый `<a href>` их бы не нёс. */
  downloadHeaders: Record<string, string> | null
  /** Query-строки GET'ов: сюда попадает дата, которую экран реально спросил. */
  getQueries: string[]
}

/** Конверт §36 — та же форма, что на проводе (exception_handler.py:75-87). */
function envelope(errorCode: string, message: string) {
  return JSON.stringify({
    error_code: errorCode,
    message,
    details: {},
    request_id: 'req-e2e-10-5',
    timestamp: `${LOCAL_TODAY}T02:00:00+14:00`,
  })
}

function issuedReport(number: number) {
  return {
    id: 'c3d4e5f6-0718-2939-4a5b-6c7d8e9f0123',
    doc_type: 'EXPENSE_REPORT',
    number,
    year: 2026,
    business_date: LOCAL_TODAY,
    division_id: DIVISION_ID,
    submission_id: 41,
    submission_version: 3,
    status: 'ISSUED',
    attachment_id: ATTACHMENT_ID,
    sha256: 'a'.repeat(64),
  }
}

/**
 * Перехват сети НА УРОВНЕ БРАУЗЕРА. `issued` = null означает «за эту дату не
 * выпускалось»: 404 `ENTITY_NOT_FOUND` — ШТАТНЫЙ ответ point-lookup'а
 * (views.py:292-301), а не сбой.
 */
async function stubBackend(
  page: Page,
  options: { issuedAfterPost?: number; downloadStatus?: number } = {},
): Promise<Traffic> {
  const traffic: Traffic = {
    gets: 0,
    posts: [],
    downloadHeaders: null,
    getQueries: [],
  }
  let issued: number | null = null

  // Права: РОВНО один код — тот же, что в `permission_map` бэка
  // (views.py:229-234) и в карте гейтов app-layout.qa.test.tsx. Значит
  // `RequirePermission` проезжает боевым путём, а не потому, что у актора `*`.
  await page.route('**/api/operations/my-permissions/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ permissions: ['daily_report.generate'] }),
    }),
  )

  await page.route('**/api/core/divisions/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        count: 1,
        next: null,
        previous: null,
        results: [
          { id: DIVISION_ID, name: DIVISION_NAME, parent: null, is_active: true },
        ],
      }),
    }),
  )

  // Лента колокольчика: AppLayout приносит её вместе с шапкой (11.4).
  // Пустая страница — предмет чужой спеки, здесь только тишина в сети.
  await page.route('**/api/notifications/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
    }),
  )
  // Сокет 11.3 открывает ConnectionIndicator из той же шапки — принимаем и
  // молчим, иначе реконнект с backoff шумел бы в каждом тесте.
  await page.routeWebSocket(/\/ws\/notifications\//, () => {})

  await page.route('**/api/operations/expense-reports/**', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      traffic.posts.push(request.postDataJSON())
      if (options.issuedAfterPost === undefined) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: envelope('REPORT_NOT_READY_FOR_DATE', 'День не сдан.'),
        })
      }
      issued = options.issuedAfterPost
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(issuedReport(issued)),
      })
    }
    traffic.gets += 1
    traffic.getQueries.push(new URL(request.url()).search)
    if (issued === null) {
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: envelope('ENTITY_NOT_FOUND', 'Расход за эту дату не выпускался.'),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(issuedReport(issued)),
    })
  })

  await page.route('**/api/documents/attachments/*/download/', (route) => {
    traffic.downloadHeaders = route.request().headers()
    if (options.downloadStatus !== undefined) {
      // Конверт §36 приезжает с Content-Type: application/json — а запрос был
      // за блобом. Разбор обязан свернуть на parseErrorResponse, а не отдать
      // тело отказа как «файл».
      return route.fulfill({
        status: options.downloadStatus,
        contentType: 'application/json',
        body: envelope('PERMISSION_DENIED', 'PERMISSION_DENIED'),
      })
    }
    return route.fulfill({
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // Ровно та форма, которую ставит `content_disposition_header(True, …)`
        // на кириллическом имени (documents/api/views.py:79-88).
        'Content-Disposition': `attachment; filename="expense.docx"; filename*=UTF-8''${encodeURIComponent(SERVER_FILENAME)}`,
      },
      body: DOCX_BYTES,
    })
  })

  return traffic
}

/** Часы фиксируются ДО навигации: `todayLocalIso()` зовётся инициализатором
 *  useState на первом же рендере — после goto менять время поздно. */
async function open(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(FIXED_UTC))
  await page.goto(HARNESS)
}

async function selectDivision(page: Page): Promise<void> {
  const select = page.getByLabel('Подразделение')
  await expect(select).toBeEnabled()
  await select.selectOption(DIVISION_ID)
}

test.describe('Врезка экрана в маршрут /reports (QA-проба: мёртвый дублёр)', () => {
  test('под правом daily_report.generate доезжает НАСТОЯЩИЙ экран расхода, а не заголовок', async ({
    page,
  }) => {
    const traffic = await stubBackend(page)
    await open(page)

    // Заголовок — то единственное, что проверял чужой тест. Он обязателен, но
    // ничего не доказывает сам по себе: мёртвый дублёр давал ровно его.
    await expect(page.getByRole('heading', { level: 1, name: 'Отчёты' })).toBeVisible()
    // А вот это — уже сам экран, целиком отсутствующий у дублёра.
    await expect(page.getByText('Формирование официального расхода ЛС')).toBeVisible()
    await expect(page.getByLabel('Подразделение')).toBeVisible()
    await expect(page.getByLabel('Дата')).toBeVisible()
    // До выбора подразделения запросы расхода НЕ уходят (AC-2, `enabled`).
    await expect(page.getByText('Выберите подразделение')).toBeVisible()
    expect(traffic.gets).toBe(0)

    await selectDivision(page)

    // 404 — пустое состояние, а не отказ: экран предлагает выпустить.
    await expect(page.getByText('Расход за эту дату не выпускался')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Сформировать' })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)

    // `retry: false` на чтении — решение экрана, а не харнеса (харнес держит
    // дефолты QueryClient намеренно). Потеря гасителя дала бы четыре запроса.
    expect(traffic.gets).toBe(1)
  })

  test('выпуск: POST уходит из БРАУЗЕРА телом ровно {division_id, business_date}, карточка перечитывается', async ({
    page,
  }) => {
    const traffic = await stubBackend(page, { issuedAfterPost: 247 })
    await open(page)
    await selectDivision(page)
    await page.getByRole('button', { name: 'Сформировать' }).click()

    // Канон-строка успеха — дословно EXPERIENCE.md#L115.
    await expect(page.getByText('Расход готов. Исх.№ 247.')).toBeVisible()

    expect(traffic.posts).toHaveLength(1)
    // Ровно два поля: «Исх. №» и тумблер «черновик/ФИНАЛ» — фантом №3, номер
    // выдаёт DocumentSequence под row-локом на бэке.
    expect(traffic.posts[0]).toEqual({
      division_id: DIVISION_ID,
      business_date: LOCAL_TODAY,
    })

    // Карточка построена из СВЕЖЕГО чтения (инвалидация ключа), а не из тела POST.
    // Ассерт ЗАСКОУПЛЕН в `<dl>` карточки: незаскоупленный `getByText('247')`
    // ловит ещё и строку успеха «Расход готов. Исх.№ 247.» — и тогда он
    // доказывает не перечитку, а сообщение (ловушка №2 стори: два совпадения).
    const card = page.locator('dl')
    await expect(card).toContainText('247 / 2026')
    await expect(card).toContainText('Выпущен')
    await expect(card).toContainText(LOCAL_TODAY)
    await expect(page.getByRole('button', { name: 'Скачать' })).toBeVisible()
    expect(traffic.gets).toBe(2)
  })
})

test.describe('Скачивание .docx: настоящий файл, настоящие байты (открытый вопрос №5)', () => {
  test('файл сохранён браузером; БАЙТЫ совпадают с телом ответа, имя — кириллическое из Content-Disposition', async ({
    page,
  }) => {
    const traffic = await stubBackend(page, { issuedAfterPost: 247 })
    await open(page)
    await selectDivision(page)
    await page.getByRole('button', { name: 'Сформировать' }).click()
    await expect(page.getByRole('button', { name: 'Скачать' })).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Скачать' }).click(),
    ])

    // Имя от сервера, раскодированное из `filename*=UTF-8''<pct>`. Потеря
    // decodeURIComponent сохранила бы файл с процентами в имени.
    expect(download.suggestedFilename()).toBe(SERVER_FILENAME)

    // 🔴 Ядро добора: в jsdom и createObjectURL, и клик по `<a download>`
    // застабены, поэтому «пустой блоб вместо полученного» там незаметен.
    const saved = readFileSync(await download.path())
    expect(saved.equals(DOCX_BYTES)).toBe(true)
    expect(saved.byteLength).toBeGreaterThan(0)

    // Запрос файла нёс credential: голый `<a href>` заголовков не несёт и
    // получил бы 403 (credential.ts:18 → client.ts спред defaultHeaders).
    expect(traffic.downloadHeaders?.['x-user-id']).toBe('user-omd-7')
  })

  test('403 без document.view: объяснение показано и ФАЙЛ НЕ СОХРАНЁН', async ({
    page,
  }) => {
    // Живой разрыв прав, а не гипотеза: роль OMD имеет daily_report.generate,
    // но НЕ имеет document.view (seed_operations.py:51-55) — актор выпускает
    // документ и не может его скачать (открытый вопрос №1 стори).
    await stubBackend(page, { issuedAfterPost: 247, downloadStatus: 403 })
    await open(page)
    await selectDivision(page)
    await page.getByRole('button', { name: 'Сформировать' }).click()
    await expect(page.getByRole('button', { name: 'Скачать' })).toBeVisible()

    let saved = 0
    page.on('download', () => {
      saved += 1
    })
    await page.getByRole('button', { name: 'Скачать' }).click()

    // ⚠️ Честно о силе этого теста: он УКРЕПЛЯЕТ, а не закрывает пробел.
    // Обе пробы, которые его краснят (снятие проверки `!response.ok` в
    // `requestBlob`; сохранение тела отказа файлом до проброса ошибки),
    // краснят и дев-сюиту. Уникальна здесь только форма ассерта: «ни одного
    // download-события» — утверждение о браузере, которого jsdom сделать не
    // может в принципе (сохранение там застабено целиком). Не вакуумен:
    // соседний тест доказывает, что в этом харнесе download-события
    // наблюдаемы, — значит ноль здесь означает ноль, а не глухой слушатель.
    await expect(
      page.getByText('Нет права на скачивание документов. Требуется право document.view.'),
    ).toBeVisible()
    // Кнопка остаётся: документ выпущен и лежит, «функции нет» было бы ложью.
    await expect(page.getByRole('button', { name: 'Скачать' })).toBeVisible()
    expect(saved).toBe(0)
  })
})

test.describe('Дата по умолчанию — ЛОКАЛЬНАЯ зона браузера (AC-2)', () => {
  test('в UTC+14 экран открыт на локальном «сегодня», а не на UTC-срезе, и спрашивает бэк о нём же', async ({
    page,
  }) => {
    const traffic = await stubBackend(page)
    await open(page)

    const date = page.getByLabel('Дата')
    await expect(date).toHaveValue(LOCAL_TODAY)
    // Негативный ассерт неслучаен: ровно это значение подставил бы UTC-срез.
    await expect(date).not.toHaveValue(UTC_TODAY)

    await selectDivision(page)
    await expect(page.getByText('Расход за эту дату не выпускался')).toBeVisible()

    // Дата доехала до провода, а не осталась картинкой в поле.
    expect(traffic.getQueries).toHaveLength(1)
    expect(traffic.getQueries[0]).toContain(`business_date=${LOCAL_TODAY}`)
    expect(traffic.getQueries[0]).toContain(`division_id=${DIVISION_ID}`)
  })

  test('поле даты — НАСТОЯЩИЙ date-инпут: браузер разбирает значение как дату', async ({
    page,
  }) => {
    await stubBackend(page)
    await open(page)

    // `valueAsDate` есть только у type="date"; у текстового поля он null.
    // jsdom не реализует его вовсе — понижение типа там незаметно.
    const parsed = await page
      .getByLabel('Дата')
      .evaluate((el) => (el as HTMLInputElement).valueAsDate?.toISOString() ?? null)
    expect(parsed).toBe(`${LOCAL_TODAY}T00:00:00.000Z`)
  })
})
