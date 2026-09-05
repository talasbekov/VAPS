/**
 * Принятый состав для ОМ на стенде (Plane №428, `[РАС-04]`).
 *
 * С №428 правая колонка расстановки показывает ТОЛЬКО людей, которых штаб
 * принял в «Сборе сил»: кадровой базы там больше нет. Пробы, которые ставят
 * людей на посты с экрана, обязаны сначала провести ОМ через сбор сил — тем
 * же API-путём, что и `force-collections.spec.ts`: раскладка потребности по
 * департаменту → оповещение → выделение людей → отправка → приём штабом.
 *
 * Один помощник на все пробы, а не копия цепочки в каждой: цепочка живая
 * (№389–№393 меняли её трижды за день), и три копии разошлись бы на первой
 * же правке.
 */
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

export interface AcceptedRoster {
  allocationId: string
  employeeIds: string[]
}

/**
 * Провести ОМ через сбор сил до принятого состава.
 *
 * `count` — сколько людей выделить (по умолчанию — вся потребность ОМ по
 * заявке, но не меньше одного). Люди берутся с начала кадрового списка.
 */
export async function acceptRosterFor(
  token: string,
  eventId: string,
  options: { count?: number; department?: string } = {},
): Promise<AcceptedRoster> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  /**
   * Запрос к стенду, который СМОТРИТ НА КОД ОТВЕТА (Plane №653).
   *
   * 🔴 Здесь стояло `res.json().catch(() => ({}))` без единой проверки
   * статуса. Любой не-JSON отказ — 403 в HTML, страница трассировки 500,
   * ошибка прокси — превращался в `{}`: `added.error_code` оставался
   * `undefined`, и помощник записывал сотрудника как ВЫДЕЛЕННОГО, хотя
   * сервер его не принял. Ровно так же молча проглатывались `submit/` и
   * `accept/`.
   *
   * Чем это стоило: если ручка приёмки начнёт отвечать 500,
   * `acceptRosterFor` вернёт правдоподобный `AcceptedRoster`, а зависящие
   * пробы упадут ПОЗЖЕ и НЕ ТАМ — с «region not visible» вместо имени
   * сломанного звена. Подготовка обязана падать на себе.
   *
   * Отказ с разобранным `error_code` — НЕ ошибка помощника: цепочка сбора
   * сил отвечает такими штатно (`STATUS_OVERLAP_WARNING`), и решает по ним
   * вызывающий. Поэтому тело возвращается как есть, а поднимается только то,
   * что телом объяснить нельзя.
   */
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let parsed: any = undefined
    try {
      parsed = text === '' ? {} : JSON.parse(text)
    } catch {
      parsed = undefined
    }
    if (parsed === undefined) {
      throw new Error(
        `${method} ${path} → ${res.status}, ответ не JSON: ${text.slice(0, 200)}`,
      )
    }
    if (!res.ok && parsed.error_code === undefined) {
      throw new Error(
        `${method} ${path} → ${res.status}: ${JSON.stringify(parsed).slice(0, 200)}`,
      )
    }
    return parsed
  }

  const event = await call('GET', `/api/ops/security-events/${eventId}/`)
  const need = Math.max(
    1,
    (event.forceRequests as { requestedCount: number }[] | undefined)?.reduce(
      (sum, row) => sum + row.requestedCount,
      0,
    ) ?? event.forceNeed ?? 1,
  )
  const count = options.count ?? need

  const divisions = (await call('GET', '/api/core/divisions/?page_size=200')) as {
    results: { id: number; name: string }[]
  }
  const department = divisions.results.find(
    (d) => d.name === (options.department ?? 'Первый департамент'),
  )
  if (department === undefined) throw new Error('на стенде нет департамента для раскладки')

  const split = await call('POST', `/api/ops/security-events/${eventId}/forces/allocation/`, {
    rows: [{ departmentId: String(department.id), need }],
  })
  const allocationId = (split.forceAllocation?.[0]?.id ?? '') as string
  if (allocationId === '') throw new Error(`раскладка не создана: ${JSON.stringify(split).slice(0, 200)}`)
  await call('POST', `/api/ops/security-events/${eventId}/forces/allocation/${allocationId}/notify/`)

  // Людей берётся с запасом: у части на дату ОМ уже стоит статус (отпуск,
  // другое мероприятие), и сервер отвечает STATUS_OVERLAP_WARNING — такой
  // человек пропускается, а не роняет фикстуру.
  const people = (await call('GET', `/api/ops/personnel/?page_size=${Math.max(count * 8, 40)}`)) as {
    results: { id: string }[]
  }
  const employeeIds: string[] = []
  for (const person of people.results) {
    if (employeeIds.length >= count) break
    const added = await call(
      'POST',
      `/api/ops/security-events/${eventId}/forces/allocation/${allocationId}/members/`,
      { employeeId: person.id },
    )
    if (added.error_code === 'STATUS_OVERLAP_WARNING') continue
    if (added.error_code !== undefined) throw new Error(`выделение не прошло: ${added.error_code}`)
    employeeIds.push(String(person.id))
  }
  if (employeeIds.length === 0) throw new Error('не нашлось ни одного свободного на дату ОМ')
  // Отправка проверяется, а не выполняется «на удачу» (Plane №653): её
  // результат здесь не читался вовсе, и провалившаяся отправка выглядела как
  // успешная подготовка.
  const submitted = await call(
    'POST',
    `/api/ops/security-events/${eventId}/forces/allocation/${allocationId}/submit/`,
  )
  if (submitted.error_code !== undefined) {
    throw new Error(`отправка списка не прошла: ${submitted.error_code}`)
  }
  const accepted = await call(
    'POST',
    `/api/ops/security-events/${eventId}/forces/allocation/${allocationId}/accept/`,
  )
  if (accepted.error_code !== undefined) throw new Error(`приём не прошёл: ${accepted.error_code}`)
  // Состав ПРОВЕРЯЕТСЯ по мероприятию, а не выводится из того, что ручки не
  // отказали (Plane №653): «приём вернул 200» и «люди в составе» — разные
  // утверждения, и подготовка обязана отвечать за второе.
  const after = await call('GET', `/api/ops/security-events/${eventId}/`)
  const roster = (after.forceRoster ?? []) as { employeeId: string }[]
  if (roster.length === 0) {
    throw new Error('приём прошёл, но состав мероприятия пуст — подготовка не состоялась')
  }
  return { allocationId, employeeIds }
}
