/**
 * Уборка мероприятий, заведённых пробами. ОДНО место вместо копии в каждом
 * спеке.
 *
 * Зачем: пробы заводят ОМ и не убирали их за собой. К 25.08.2026 из 53 строк
 * реестра стенда 44 были пробными — реестр перестал читаться глазом, отбор по
 * этапу перестал сужать выдачу (страница в 20 строк), а пробы, ищущие фикстуру
 * запросом по реестру, стали находить чужой мусор (Plane №62, до него — №34,
 * где вручную снесли 188 строк).
 *
 * ПРИЗНАК ПРОБНОЙ СТРОКИ — МЕТКА В НАЗВАНИИ, а не стадия и не дата: стадия у
 * пробной строки любая, а живое ОМ на той же стадии сносить нельзя. Метку
 * ставит `probeTitle`, ту же метку ищет серверная чистилка
 * `manage.py purge_probe_events`.
 *
 * ЧЕГО УБОРКА НЕ МОЖЕТ. Сервер отказывает в удалении закрытого ОМ и ОМ, в
 * котором есть расстановка или записи журнала штаба, — это работа людей, и
 * «удалить» вместо «отменить» скрыло бы её (`delete_event`). Пробы этапов
 * расстановки и ознакомления доводят фикстуру именно до такого состояния,
 * поэтому их строки остаются, и снимает их только `purge_probe_events --force`
 * с консоли. Отказ здесь НЕ роняет прогон: уборка — не предмет проверки, и
 * падать на ней значило бы красить зелёный прогон по чужой причине.
 */
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

/** Метка пробной строки. Совпадает с умолчанием `purge_probe_events`. */
export const PROBE_MARK = '(e2e)'

/** Название пробного ОМ с меткой. Через функцию, а не руками: забытая метка
 * означает строку, которую ни уборка спека, ни серверная чистилка не найдут. */
export function probeTitle(name: string): string {
  return `${name} ${PROBE_MARK}`
}

interface EventRow {
  id: string
  title: string
}

async function listProbeEvents(token: string): Promise<EventRow[]> {
  const rows: EventRow[] = []
  // Страницами: реестр стенда переваливает за сотню строк, и первая страница
  // оставила бы хвост неубранным — то есть уборка выглядела бы сделанной.
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetch(
      `${API}/api/ops/security-events/?page=${page}&page_size=100`,
      { headers: { Authorization: `Bearer ${token}` } },
    ).catch(() => null)
    if (res === null || !res.ok) break
    const body = (await res.json().catch(() => null)) as
      | { results?: EventRow[]; next?: string | null }
      | null
    if (body?.results === undefined) break
    rows.push(...body.results.filter((row) => row.title.includes(PROBE_MARK)))
    if (!body.next) break
  }
  return rows
}

/**
 * Снять со стенда все пробные мероприятия. Возвращает числа, чтобы вызывающий
 * мог их напечатать: молчаливая уборка неотличима от несделанной.
 */
export async function dropProbeEvents(
  token: string,
): Promise<{ dropped: number; refused: number }> {
  let dropped = 0
  let refused = 0
  for (const row of await listProbeEvents(token)) {
    const res = await fetch(`${API}/api/ops/security-events/${row.id}/`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null)
    if (res !== null && res.ok) dropped += 1
    else refused += 1
  }
  return { dropped, refused }
}

/** Токен стенда для уборки. Свой, а не общий со спекой: уборка живёт в
 * `afterAll`, где фикстур спеки уже нет. */
export async function probeToken(
  username: string,
  password: string,
): Promise<string | null> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }).catch(() => null)
  if (res === null || !res.ok) return null
  const body = (await res.json().catch(() => null)) as { access?: string } | null
  return body?.access ?? null
}
