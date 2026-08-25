/**
 * Уборка стенда после прогона: пробные мероприятия снимаются с реестра.
 *
 * ОДНО МЕСТО, а не `afterAll` в каждом спеке. Спеков, заводящих ОМ, семь, и
 * копия уборки в каждом означала бы семь мест, где её можно забыть в восьмом —
 * ровно так реестр и накопил 44 пробные строки из 53 (Plane №62). Глобальная
 * уборка снимает и то, что оставили прошлые прогоны, а не только свой мусор.
 *
 * Живой стенд не обязателен: без `SMOKE_LIVE=1` спеки скипаются, и уборке
 * нечего убирать — она молча выходит, а не падает на недоступном API.
 *
 * ЧАСТЬ СТРОК ОСТАНЕТСЯ, и это правило сервера, а не недоделка: ОМ с
 * расстановкой, записями журнала штаба или закрытое не удаляется — там работа
 * людей. Такие строки снимает `manage.py purge_probe_events --yes --force` с
 * консоли; сколько их осталось, уборка печатает числом.
 */
import { dropProbeEvents, probeToken } from './probe-events'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

export default async function globalTeardown(): Promise<void> {
  if (process.env.SMOKE_LIVE !== '1') return
  const token = await probeToken(STAND_USERNAME, STAND_PASSWORD)
  if (token === null) {
    // Стенд мог быть погашен между прогоном и уборкой — это не повод
    // объявлять прогон неудачным.
    console.log('уборка пробных ОМ: стенд недоступен, пропущена')
    return
  }
  const { dropped, refused } = await dropProbeEvents(token)
  console.log(
    `уборка пробных ОМ: снято ${dropped}` +
      (refused > 0
        ? `, оставлено ${refused} (расстановка/журнал/закрытые — снимает ` +
          'purge_probe_events --yes --force)'
        : ''),
  )
}
