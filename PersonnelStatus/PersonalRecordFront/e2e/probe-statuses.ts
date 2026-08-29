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
