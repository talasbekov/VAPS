/**
 * Деловая дата раздела ОМ и местная календарная дата — ДВЕ РАЗНЫЕ ВЕЩИ, и обе
 * не равны `new Date().toISOString().slice(0, 10)` (Plane №373).
 *
 * 🔴 КАК ЭТО ПОЙМАЛОСЬ. 01.09.2026, 00:26 по местному времени (UTC+5) проба
 * `tables-data.spec.ts:381` объявила: «у сотрудников 7, 9, 10 сервер знает
 * привлечение, а таблица его не показывает». Кода дефекта не было вовсе:
 * `toISOString()` отдаёт UTC, а в UTC на тот момент стояло ещё 31.08.2026 —
 * проба спрашивала у сервера ВЧЕРАШНИЕ статусы и сравнивала их с сегодняшним
 * экраном. Каждую ночь после 19:00 по местному времени такая проба краснеет, и
 * краснеет УБЕДИТЕЛЬНО — поимённым списком сотрудников.
 *
 * Клиент этой ловушки не знает с №281: `use-ops-section-statuses` берёт дату
 * ИЗ ОТВЕТА РАСХОДА и рядом записано почему. Пробы остались на браузерных
 * часах, и это расхождение — не мелочь: проба, считающая дату сама, проверяет
 * не то, что показывает экран.
 *
 * ЧТО КОГДА БРАТЬ:
 *   • спрашиваете у сервера «что сегодня в разделе» → `businessDateOf`:
 *     деловая дата живёт на сервере и календарному дню не обязана совпадать
 *     вовсе (расход составляется на день вперёд);
 *   • нужна местная календарная дата (закрыть статус сегодняшним числом) →
 *     `localIsoDate`: те же цифры, что видит человек на своих часах.
 */

/** Деловая дата раздела — та же, что берёт клиент (`strength-report`). */
export async function businessDateOf(api: string, token: string): Promise<string> {
  const res = await fetch(`${api}/api/operations/strength-report/`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(
      `расход не ответил (${res.status}) — деловую дату взять неоткуда, ` +
        'а считать её в браузере и есть дефект №373',
    )
  }
  const body = (await res.json()) as { business_date?: string }
  if (!body.business_date) {
    throw new Error('в ответе расхода нет business_date — сравнивать экран не с чем')
  }
  return body.business_date
}

/** Местная календарная дата «ГГГГ-ММ-ДД» — без ухода в UTC. */
export function localIsoDate(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Деловая дата, РАЗНАЯ на каждый вызов, — для проб, которые заводят свою фикстуру.
 *
 * 🔴 БЫЛА «ПОЧТИ УНИКАЛЬНОЙ», И ЭТО ПОЙМАЛО РЕВЮ (Plane №881). Стояло
 * `Date.UTC(2027,1,1) + (at % 3650) * ДЕНЬ` при `at = Date.now()`, а рядом
 * обещание: «повтор требует совпадения с точностью до миллисекунды». Обещание
 * неверно: `at % 3650` — это МИЛЛИСЕКУНДЫ по модулю 3650, то есть значение
 * повторяется каждые 3,65 СЕКУНДЫ. Замерено исполнением: `f(now)` и
 * `f(now + 3650)` дают одну дату, а в первые 20 000 мс совпадений пять.
 *
 * Горше всего то, что формула ЧИНИЛА ровно эту болезнь у предшественницы (там
 * период был пять минут, Plane №567) — и унаследовала её же, только короче.
 * Две подготовки одного прогона, разошедшиеся на кратное 3,65 с, брали один
 * день и вычерпывали друг у друга свободных людей: то самое «ни один сотрудник
 * не свободен», ради чего всё и заводилось.
 *
 * 🔴 ТЕПЕРЬ РАЗЛИЧИЕ ДЕРЖИТ БД, А НЕ УДАЧА. До запуска глобальная подготовка
 * атомарно бронирует отдельный десятилетний диапазон в API. Воркеры только
 * делят УЖЕ выданный диапазон и потому не могут пересечь ни другой worker,
 * ни независимый одновременный прогон.
 *
 * 🔴 ЗАЧЕМ ЭТО ОБЩЕЕ (Plane №822 Ш-3). Своя дата — лечение четвёртого подвида
 * мигания: пробы делят не только мероприятия, но и ЛЮДЕЙ. Занятость считается
 * по дате, и две подготовки на одну дату вычерпывают друг у друга свободных
 * сотрудников — замер 06.09.2026 дал этому два падения чистого прогона.
 *
 * Дата заведомо БУДУЩАЯ: этап ознакомления открывается только у предстоящего
 * мероприятия. Диапазон — десять лет от 2027-02-01.
 */
const DAY_MS = 86_400_000
const MAX_RANGE_DAYS = 16_384

/**
 * Каждая e2e-сессия получает свой диапазон через `global-setup.ts` и хранит
 * его начало в E2E_FIXTURE_DATE_RANGE_START. БД защищает бронь singleton-
 * курсором под транзакцией; `TEST_PARALLEL_INDEX` и фактическое число workers
 * делят уже эксклюзивный диапазон без скрытого предела количества воркеров.
 */
let issued = 0

function asPositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`e2e ${name} должен быть положительным целым числом`)
  }
  return value
}

/** Выдаёт дату внутри непересекающегося среза конкретного worker-slot. */
export function businessDateForWorker(
  rangeStart: string,
  rangeDays: number,
  parallelIndex: number,
  workerCount: number,
  issuedByWorker: number,
): string {
  const days = asPositiveInteger(rangeDays, 'rangeDays')
  const workers = asPositiveInteger(workerCount, 'workers')
  const index = asPositiveInteger(parallelIndex + 1, 'parallelIndex') - 1
  const issued = asPositiveInteger(issuedByWorker + 1, 'issued') - 1
  if (days > MAX_RANGE_DAYS) {
    throw new Error(`e2e rangeDays (${days}) больше допустимого значения (${MAX_RANGE_DAYS})`)
  }
  if (workers > days) {
    throw new Error(`e2e workers (${workers}) больше доступных дат (${days})`)
  }
  if (index >= workers) {
    throw new Error(`e2e parallelIndex ${index} вне диапазона workers=${workers}`)
  }
  const sliceStart = Math.floor((days * index) / workers)
  const sliceEnd = Math.floor((days * (index + 1)) / workers)
  if (issued >= sliceEnd - sliceStart) {
    throw new Error(`e2e-worker ${index} исчерпал свой диапазон из ${sliceEnd - sliceStart} дат`)
  }
  const start = Date.parse(`${rangeStart}T00:00:00Z`)
  if (Number.isNaN(start)) throw new Error(`некорректное начало e2e-диапазона: ${rangeStart}`)
  return new Date(start + (sliceStart + issued) * DAY_MS).toISOString().slice(0, 10)
}

export function uniqueBusinessDate(): string {
  const rangeStart = process.env.E2E_FIXTURE_DATE_RANGE_START
  if (rangeStart === undefined) {
    throw new Error('e2e-диапазон дат не забронирован: global-setup.ts не выдал E2E_FIXTURE_DATE_RANGE_START')
  }
  const parallelIndex = Number(process.env.TEST_PARALLEL_INDEX ?? 0)
  const workers = Number(process.env.E2E_FIXTURE_DATE_WORKERS)
  const rangeDays = Number(process.env.E2E_FIXTURE_DATE_RANGE_DAYS)
  const businessDate = businessDateForWorker(rangeStart, rangeDays, parallelIndex, workers, issued)
  issued += 1
  return businessDate
}
