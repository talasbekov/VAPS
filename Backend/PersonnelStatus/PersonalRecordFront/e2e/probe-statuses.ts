/**
 * Уборка СТАТУСОВ, заведённых пробами. Парная к `probe-events`, и место то же —
 * `global-teardown` (Plane №316).
 *
 * Зачем: уборка снимала пробные МЕРОПРИЯТИЯ и не трогала статусы. Статус
 * участия переживал снесённое ОМ, и к вечеру 29.08.2026 таких накопилось 42 —
 * из-за них покраснела чужая проба сборов сил (плитка «Участие в ОМ» показала
 * 46 против 68 у API), и полчаса ушло на разбор дефекта, которого в коде не
 * было. Мои две спеки к тому моменту оставили на стенде 69 строк: 45 с
 * комментарием фикстуры «период статуса» и 24 с «Проба №255».
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ В `afterEach` КАЖДОГО СПЕКА. Ровно тот довод, что записан
 * в `probe-events`: копия уборки в каждом спеке — это столько же мест, где её
 * можно забыть в следующем. Реестр ОМ так копил мусор трижды (Plane №34, №62,
 * №95), и лечило это одно общее место, а не дисциплина. Вдобавок глобальная
 * уборка снимает и то, что оставили ПРОШЛЫЕ прогоны, — `afterEach` не может
 * этого по устройству.
 *
 * СНИМАЕТСЯ ОТМЕНОЙ И ЗАВЕРШЕНИЕМ, А НЕ УДАЛЕНИЕМ. В разделе строки статусов не
 * удаляются вовсе: у активного статуса есть только «завершить досрочно», у
 * запланированного — «отменить». Проба не должна уметь больше, чем человек, и
 * удаление скрыло бы историю, которую система ведёт намеренно.
 *
 * ОТБОР — СТРОГО ПО МЕТКЕ В КОММЕНТАРИИ. Ни тип, ни дата, ни сотрудник
 * признаком не годятся: живой статус бывает такой же. Метку ставит
 * `probeComment`, и старые метки прошлых прогонов перечислены явно — иначе
 * уборка не забрала бы уже накопленное, а «сделано» относилось бы только к
 * будущему.
 */
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

/** Метка пробного статуса. Та же форма, что у пробного ОМ (`probe-events`). */
export const STATUS_PROBE_MARK = '(e2e)'

/**
 * Комментарий пробного статуса с меткой. Через функцию, а не руками: забытая
 * метка означает строку, которую уборка не найдёт никогда.
 */
export function probeComment(text: string): string {
  return `${text} ${STATUS_PROBE_MARK}`
}

/**
 * Метки, оставленные до появления `probeComment` (Plane №316). Держатся
 * списком, а не догадкой по подстроке «проб»: под неё попал бы живой
 * комментарий вида «на пробах в Астане», а это чужие данные.
 */
const LEGACY_MARKS = ['Проба №255', 'Фикстура пробы «период статуса»']

interface StatusRow {
  id: number
  state: string
  comment: string | null
}

function isProbeRow(row: StatusRow): boolean {
  const comment = row.comment ?? ''
  if (comment.includes(STATUS_PROBE_MARK)) return true
  return LEGACY_MARKS.some((mark) => comment.includes(mark))
}

/**
 * Пробные статусы в одном состоянии. Страницами: на стенде их тысячи.
 *
 * Обрыв списка ВОЗВРАЩАЕТСЯ НАРУЖУ, а не глотается. Прежняя редакция на любом
 * отказе (401 после протухшего токена, 500, оборванное соединение) выходила из
 * цикла и отдавала пустой список — уборка печатала «пробных строк не найдено»
 * и выглядела сделанной, пока мусор копился. Это ровно та тихая зелень, против
 * которой написан весь этот модуль (Plane №316, находка ревью).
 */
async function listProbeStatuses(
  token: string,
  state: 'active' | 'planned',
): Promise<{ rows: StatusRow[]; broke: string | null }> {
  const rows: StatusRow[] = []
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetch(
      `${API}/api/statuses/statuses/?state=${state}&page=${page}&page_size=200`,
      { headers: { Authorization: `Bearer ${token}` } },
    ).catch(() => null)
    if (res === null) return { rows, broke: `${state}: список не ответил` }
    if (!res.ok) return { rows, broke: `${state}: список ответил ${res.status}` }
    const body = (await res.json().catch(() => null)) as
      | { results?: StatusRow[]; next?: string | null }
      | null
    if (body?.results === undefined) return { rows, broke: `${state}: ответ без results` }
    rows.push(...body.results.filter(isProbeRow))
    if (!body.next) break
  }
  return { rows, broke: null }
}

const today = (): string => new Date().toISOString().slice(0, 10)

/**
 * Снять со стенда пробные статусы. Возвращает числа, чтобы вызывающий их
 * напечатал: молчаливая уборка неотличима от несделанной.
 */
export async function dropProbeStatuses(
  token: string,
): Promise<{ closed: number; refused: number; broke: string | null }> {
  let closed = 0
  let refused = 0

  const active = await listProbeStatuses(token, 'active')
  const planned = await listProbeStatuses(token, 'planned')
  const broke = active.broke ?? planned.broke

  const plan: Array<{ id: number; path: string; body: Record<string, string> }> = []
  for (const row of active.rows) {
    plan.push({
      id: row.id,
      path: 'terminate',
      // Дата завершения — сегодня: раньше начала сервер не примет, а позже
      // плановой даты — тем более (фикстуры кончаются через 5-6 дней).
      body: { termination_date: today(), reason: `уборка пробы ${STATUS_PROBE_MARK}` },
    })
  }
  for (const row of planned.rows) {
    plan.push({
      id: row.id,
      path: 'cancel',
      body: { reason: `уборка пробы ${STATUS_PROBE_MARK}` },
    })
  }

  for (const item of plan) {
    const res = await fetch(`${API}/api/statuses/statuses/${item.id}/${item.path}/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(item.body),
    }).catch(() => null)
    if (res !== null && res.ok) closed += 1
    else refused += 1
  }
  return { closed, refused, broke }
}

// ── Каталог раздела ОМ ────────────────────────────────────────────────────
//
// Вторая половина той же дыры (Plane №321, находка само-ревью). Уборка выше
// ходит по КАДРОВОМУ каталогу `/api/statuses/statuses/` и строк раздела не
// видит вовсе, а пробы заводят статусы и там — через
// `/api/operations/statuses/`. Именно такие строки к вечеру 29.08.2026
// накопились в числе 42 и покрасили чужую пробу сборов сил.
//
// Снимается ЖИЗНЕННЫМ ЦИКЛОМ раздела, а не удалением: строки здесь не
// удаляются вовсе. Но путей ДВА, и это правило сервера, а не тонкость:
// `/cancel/` берёт только PLANNED («Отменить можно только не начавшийся
// статус», 422 на ACTIVE — проверено живьём), а начавшийся закрывается
// `/complete/` с фактической датой. Уборка, знавшая один путь, находила
// строку и не снимала её: «отказано 1».
//
// ⚠️ ТРЕТИЙ СЛУЧАЙ НЕ ЗАКРЫВАЕТСЯ ВООБЩЕ, и это ограничение раздела, а не
// недоделка уборки: у статуса, заведённого СЕГОДНЯ и уже действующего, нет ни
// одного пути. `cancel` его не берёт (не PLANNED), `complete` требует дату
// позже начала («Дата завершения должна быть позже даты начала») и при этом
// не в будущем («Дата фактического завершения не может быть в будущем») —
// вместе это невозможное условие в день заведения. Такие строки считаются
// ОТДЕЛЬНО и называются вслух: молчание превратило бы их в тот самый мусор,
// против которого написан модуль. Заведена карточка Plane №322.

interface OpsStatusRow {
  id: number
  state: string
  date_start: string
  comment: string | null
}

/** Пробные строки каталога раздела. Идём по `next`: `page_size` эта
 *  пагинация игнорирует (limit/offset), и «страница побольше» молча
 *  отдала бы 50 строк из тысячи — ровно дефект, найденный ревью 29.08.2026. */
async function listOpsProbeStatuses(
  token: string,
): Promise<{ rows: OpsStatusRow[]; broke: string | null }> {
  const rows: OpsStatusRow[] = []
  let url: string | null = `${API}/api/operations/statuses/?limit=200&include_cancelled=false`
  for (let guard = 0; guard < 40 && url !== null; guard += 1) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).catch(
      () => null,
    )
    if (res === null) return { rows, broke: 'раздел: список не ответил' }
    if (!res.ok) return { rows, broke: `раздел: список ответил ${res.status}` }
    const body = (await res.json().catch(() => null)) as
      | { results?: OpsStatusRow[]; next?: string | null }
      | null
    if (body?.results === undefined) return { rows, broke: 'раздел: ответ без results' }
    rows.push(
      ...body.results.filter((row) => (row.comment ?? '').includes(STATUS_PROBE_MARK)),
    )
    url = body.next ?? null
  }
  return { rows, broke: null }
}

/** Отменить пробные строки каталога раздела. */
export async function dropOpsProbeStatuses(
  token: string,
): Promise<{ closed: number; refused: number; sameDay: number; broke: string | null }> {
  const { rows, broke } = await listOpsProbeStatuses(token)
  let closed = 0
  let refused = 0
  let sameDay = 0
  for (const row of rows) {
    // ACTIVE закрывается завершением, PLANNED — отменой; иное состояние
    // (COMPLETED, CANCELLED) уже закрыто, и трогать его незачем.
    if (row.state === 'ACTIVE' && row.date_start === today()) {
      sameDay += 1
      continue
    }
    const action =
      row.state === 'ACTIVE'
        ? { path: 'complete', body: { actual_end: today() } }
        : row.state === 'PLANNED'
          ? { path: 'cancel', body: { reason: `уборка пробы ${STATUS_PROBE_MARK}` } }
          : null
    if (action === null) continue
    const res = await fetch(`${API}/api/operations/statuses/${row.id}/${action.path}/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(action.body),
    }).catch(() => null)
    if (res !== null && res.ok) closed += 1
    else refused += 1
  }
  return { closed, refused, sameDay, broke }
}
