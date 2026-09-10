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
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FullConfig } from '@playwright/test'
import { resolvePurgeTarget } from './purge-python'
import { standVerdict } from './stand-alive'

/** Отметка для уборки: предполётная отказала, проб не было вовсе (ревью №823).
 *  Без неё `globalTeardown` — он выполняется и после отказа `globalSetup` —
 *  печатал бы громкий блок «падения этого прогона про стенд», хотя не
 *  выполнилось ни одной пробы, и съедал бы собственную же цель «одна внятная
 *  строка вместо пятидесяти». */
export const PREFLIGHT_FAILED = 'STAND_PREFLIGHT_FAILED'
const DATES_PER_WORKER = 256
const MAX_FIXTURE_WORKERS = 64
// Совпадает с global-teardown: локальная команда обязана работать с той же
// PostgreSQL-базой, что и временный Django-стенд, а не с manage.py default.
const DJANGO_SETTINGS = 'organization_management.config.settings.local_postgres'
const execFileAsync = promisify(execFile)

export function fixtureRangeSize(workers: number): number {
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > MAX_FIXTURE_WORKERS) {
    throw new Error(`workers должен быть целым числом от 1 до ${MAX_FIXTURE_WORKERS}; получено ${workers}`)
  }
  return workers * DATES_PER_WORKER
}

async function reserveFixtureDateRange(workers: number): Promise<void> {
  const rangeDays = fixtureRangeSize(workers)
  const target = await resolvePurgeTarget()
  if (target === null) {
    throw new Error('не найден Django venv для локальной брони e2e-дат')
  }
  const { stdout } = await execFileAsync(
    target.python,
    ['manage.py', 'reserve_e2e_fixture_dates', '--count', String(rangeDays), `--settings=${DJANGO_SETTINGS}`],
    { cwd: target.backendRoot, timeout: 120_000 },
  )
  const body = JSON.parse(stdout.trim()) as { businessDate?: string; count?: number }
  if (typeof body.businessDate !== 'string' || body.count !== rangeDays) {
    throw new Error('локальная команда вернула некорректную бронь e2e-дат')
  }
  process.env.E2E_FIXTURE_DATE_RANGE_START = body.businessDate
  process.env.E2E_FIXTURE_DATE_WORKERS = String(workers)
  process.env.E2E_FIXTURE_DATE_RANGE_DAYS = String(rangeDays)
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.SMOKE_LIVE !== '1') return
  const verdict = await standVerdict()
  if (verdict.alive) {
    await reserveFixtureDateRange(config.workers)
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
