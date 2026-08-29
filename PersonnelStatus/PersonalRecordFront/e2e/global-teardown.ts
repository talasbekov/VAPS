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
 * ЧАСТЬ СТРОК API НЕ ОТДАЁТ, и это правило сервера, а не недоделка: ОМ с
 * расстановкой, записями журнала штаба или закрытое через API не удаляется —
 * там работа людей.
 *
 * ДО 26.08.2026 на этом уборка и заканчивалась: она печатала «оставлено 69 —
 * снимает purge_probe_events --force», и эту строку читали прогон за прогоном,
 * ничего не делая. Реестр стенда дорос до 69 пробных строк из 82 (Plane №95,
 * до него №34 и №62 — там сносили руками 188 и 44 строки). Печатать совет
 * вместо уборки — это не уборка.
 *
 * Теперь остаток снимается той самой командой, которую совет называл:
 * `manage.py purge_probe_events --yes --force` запускается ИЗ уборки, когда
 * бэкенд лежит рядом в дереве (обычный случай: обе половины в одном
 * репозитории). Нет бэкенда рядом — печатается прежний совет: команду негде
 * взять, а падать уборке нельзя, она не предмет проверки.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { dropProbeEvents, probeToken } from './probe-events'
import { dropProbeStatuses } from './probe-statuses'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const execFileAsync = promisify(execFile)

/** Корень бэкенда рядом с фронтом: обе половины лежат в одном репозитории. */
const BACKEND_ROOT = path.resolve(__dirname, '../../Personnel-Records')
const BACKEND_PYTHON = path.join(BACKEND_ROOT, '.venv/bin/python')
const DJANGO_SETTINGS = 'organization_management.config.settings.local_postgres'

/** Снимает то, что API отдать отказался; null — бэкенда рядом нет. */
async function purgeStubborn(): Promise<string | null> {
  if (!existsSync(BACKEND_PYTHON)) return null
  const { stdout } = await execFileAsync(
    BACKEND_PYTHON,
    [
      'manage.py',
      'purge_probe_events',
      '--yes',
      '--force',
      `--settings=${DJANGO_SETTINGS}`,
    ],
    { cwd: BACKEND_ROOT, timeout: 120_000 },
  )
  const lines = stdout.trim().split('\n').filter((line) => line.trim() !== '')
  return lines[lines.length - 1] ?? ''
}

export default async function globalTeardown(): Promise<void> {
  if (process.env.SMOKE_LIVE !== '1') return
  const token = await probeToken(STAND_USERNAME, STAND_PASSWORD)
  if (token === null) {
    // Стенд мог быть погашен между прогоном и уборкой — это не повод
    // объявлять прогон неудачным.
    console.log('уборка пробных ОМ: стенд недоступен, пропущена')
    return
  }
  // Статусы убираются ВСЕГДА и первыми, независимо от судьбы мероприятий
  // (Plane №316): статус переживает снесённое ОМ, и пока его не снимали,
  // участия в удалённых мероприятиях копились — 42 строки к вечеру 29.08.2026,
  // из-за них покраснела проба сборов сил.
  try {
    const statuses = await dropProbeStatuses(token)
    const tail = statuses.broke === null ? '' : ` ⚠️ список оборвался (${statuses.broke}) — ` +
      'часть мусора могла остаться незамеченной'
    if (statuses.closed > 0 || statuses.refused > 0) {
      console.log(
        `уборка пробных статусов: снято ${statuses.closed}` +
          (statuses.refused > 0 ? `, отказано ${statuses.refused}` : '') +
          tail,
      )
    } else if (statuses.broke !== null) {
      // «Не найдено» здесь было бы ложью: мы не искали, а не нашли ничего.
      console.log(`уборка пробных статусов: НЕ ВЫПОЛНЕНА —${tail}`)
    } else {
      console.log('уборка пробных статусов: пробных строк не найдено')
    }
  } catch (error) {
    // Тот же довод, что и ниже у мероприятий: уборка не предмет проверки, и
    // падать на ней значило бы красить зелёный прогон по чужой причине.
    console.log(`уборка пробных статусов: не отработала (${String(error).slice(0, 120)})`)
  }

  const { dropped, refused } = await dropProbeEvents(token)
  if (refused === 0) {
    console.log(`уборка пробных ОМ: снято ${dropped}`)
    return
  }
  try {
    const purged = await purgeStubborn()
    if (purged === null) {
      console.log(
        `уборка пробных ОМ: снято ${dropped}, оставлено ${refused} ` +
          '(расстановка/журнал/закрытые; бэкенда рядом нет — снимите ' +
          'purge_probe_events --yes --force с консоли)',
      )
      return
    }
    console.log(
      `уборка пробных ОМ: снято через API ${dropped}, упрямых ${refused} — ` +
        `добиты командой: ${purged}`,
    )
  } catch (error) {
    // Падать уборке нельзя: она не предмет проверки, и красный прогон по её
    // причине скрыл бы настоящий результат.
    console.log(
      `уборка пробных ОМ: снято ${dropped}, оставлено ${refused}; ` +
        `команда добивания не отработала (${String(error).slice(0, 120)})`,
    )
  }
}
