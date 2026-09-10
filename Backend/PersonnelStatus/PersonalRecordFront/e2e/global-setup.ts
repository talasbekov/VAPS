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
import { existsSync } from 'node:fs'
import path from 'node:path'
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
const CURRENT_BACKEND_ROOT = path.resolve(__dirname, '../../Personnel-Records')
const FIXTURE_DATE_COMMAND = path.join(
  CURRENT_BACKEND_ROOT,
  'organization_management/apps/operations/management/commands/reserve_e2e_fixture_dates.py',
)
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

/**
 * Python разрешается брать из venv главного checkout, но manage.py всегда
 * берётся из кода этого worktree. Иначе новый command отсутствует у primary
 * checkout и setup падает до первой пробы (P1 ревью Plane №890).
 */
export async function resolveFixtureDateCommandTarget(): Promise<Readonly<{ backendRoot: string; python: string }>> {
  if (!existsSync(path.join(CURRENT_BACKEND_ROOT, 'manage.py'))) {
    throw new Error(`в текущем worktree не найден manage.py: ${CURRENT_BACKEND_ROOT}`)
  }
  if (!existsSync(FIXTURE_DATE_COMMAND)) {
    throw new Error(`в текущем worktree не найдена команда брони e2e-дат: ${FIXTURE_DATE_COMMAND}`)
  }
  const pythonTarget = await resolvePurgeTarget()
  if (pythonTarget === null) {
    throw new Error('не найден Django venv для локальной брони e2e-дат')
  }
  return { backendRoot: CURRENT_BACKEND_ROOT, python: pythonTarget.python }
}

async function reserveFixtureDateRange(workers: number): Promise<void> {
  const rangeDays = fixtureRangeSize(workers)
  const target = await resolveFixtureDateCommandTarget()
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
