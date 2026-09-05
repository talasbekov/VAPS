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

/** Отметка для уборки: предполётная отказала, проб не было вовсе (ревью №823).
 *  Без неё `globalTeardown` — он выполняется и после отказа `globalSetup` —
 *  печатал бы громкий блок «падения этого прогона про стенд», хотя не
 *  выполнилось ни одной пробы, и съедал бы собственную же цель «одна внятная
 *  строка вместо пятидесяти». */
export const PREFLIGHT_FAILED = 'STAND_PREFLIGHT_FAILED'

export default async function globalSetup(): Promise<void> {
  if (process.env.SMOKE_LIVE !== '1') return
  const verdict = await standVerdict()
  if (verdict.alive) return
  process.env[PREFLIGHT_FAILED] = '1'
  throw new Error(
    `фронт-стенд ${verdict.url} не отвечает (${verdict.why}) — прогон не начат.\n` +
      '  Поднять прод-стенд:  npm run stand:prod   (порт 3108)\n' +
      '  Поднять dev-стенд:   npm run dev:guard    (порт 3106)\n' +
      '  Кто занимает порт:   ss -ltnp | grep <порт>',
  )
}
