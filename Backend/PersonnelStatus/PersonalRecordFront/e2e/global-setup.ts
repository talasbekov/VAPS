/**
 * Предполётная проверка стенда (Plane №823).
 *
 * Без неё прогон по погашенному стенду не отказывается стартовать, а
 * ВЫПОЛНЯЕТСЯ: каждая проба идёт своим путём, падает на своём ассерте и
 * печатает своё имя. Отчёт получается длинным и убедительным — и целиком не
 * про код. Здесь прогон обрывается ОДНОЙ строкой, называющей адрес и то, чем
 * его поднять.
 *
 * Без `SMOKE_LIVE=1` живые спеки скипаются сами, и проверять нечего.
 */
import { standVerdict } from './stand-alive'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

/** Отметка для уборки: предполётная отказала, проб не было вовсе (ревью №823).
 *  Без неё `globalTeardown` — он выполняется и после отказа `globalSetup` —
 *  печатал бы громкий блок «падения этого прогона про стенд», хотя не
 *  выполнилось ни одной пробы, и съедал бы собственную же цель «одна внятная
 *  строка вместо пятидесяти». */
export const PREFLIGHT_FAILED = 'STAND_PREFLIGHT_FAILED'
const FIXTURE_RANGE_DAYS = 3650

async function reserveFixtureDateRange(): Promise<void> {
  const api = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
  const login = await fetch(`${api}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  const token = (await login.json().catch(() => ({}))) as { access?: string }
  if (!login.ok || token.access === undefined) {
    throw new Error(`не удалось получить токен для брони e2e-дат (${login.status})`)
  }
  const reservation = await fetch(`${api}/api/ops/security-events/fixture-date/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access}`, 'content-type': 'application/json' },
    body: JSON.stringify({ count: FIXTURE_RANGE_DAYS }),
  })
  const body = (await reservation.json().catch(() => ({}))) as { businessDate?: string }
  if (!reservation.ok || body.businessDate === undefined) {
    throw new Error(`не удалось забронировать e2e-диапазон дат (${reservation.status})`)
  }
  process.env.E2E_FIXTURE_DATE_RANGE_START = body.businessDate
}

export default async function globalSetup(): Promise<void> {
  if (process.env.SMOKE_LIVE !== '1') return
  const verdict = await standVerdict()
  if (verdict.alive) {
    await reserveFixtureDateRange()
    return
  }
  process.env[PREFLIGHT_FAILED] = '1'
  throw new Error(
    `фронт-стенд ${verdict.url} не отвечает (${verdict.why}) — прогон не начат.\n` +
      '  Поднять прод-стенд:  npm run stand:prod   (порт 3108)\n' +
      '  Поднять dev-стенд:   npm run dev:guard    (порт 3106)\n' +
      '  Кто занимает порт:   ss -ltnp | grep <порт>',
  )
}
