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
import { standAlive, standUrl } from './stand-alive'

export default async function globalSetup(): Promise<void> {
  if (process.env.SMOKE_LIVE !== '1') return
  const url = standUrl()
  if (await standAlive(url)) return
  throw new Error(
    `фронт-стенд ${url} не отвечает — прогон не начат.\n` +
      '  Поднять прод-стенд:  npm run stand:prod   (порт 3108)\n' +
      '  Поднять dev-стенд:   npm run dev:guard    (порт 3106)\n' +
      '  Кто занимает порт:   ss -ltnp | grep <порт>',
  )
}
