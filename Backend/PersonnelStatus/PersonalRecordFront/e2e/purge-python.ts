/** Безопасное разрешение Python для серверной уборки Playwright (Plane №1119). */
import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..')
const BACKEND_RELATIVE_PATH = 'Backend/PersonnelStatus/Personnel-Records'
const LOCAL_BACKEND_ROOT = path.resolve(__dirname, '../../Personnel-Records')
const PURGE_PYTHON_ENV = 'SMOKE_PURGE_PYTHON'

export type PurgeTarget = Readonly<{ backendRoot: string; python: string }>

function targetAt(backendRoot: string, python: string): PurgeTarget | null {
  if (!existsSync(path.join(backendRoot, 'manage.py')) || !existsSync(python)) return null
  try {
    accessSync(python, constants.X_OK)
    return { backendRoot, python }
  } catch {
    return null
  }
}

function configuredTarget(): PurgeTarget | null {
  const python = process.env[PURGE_PYTHON_ENV]
  if (!python) return null
  const absolutePython = path.resolve(python)
  // Контракт переменной именно venv `…/Personnel-Records/.venv/bin/python`.
  // Так cwd остаётся у того же manage.py, а не у произвольного пути пользователя.
  return targetAt(path.resolve(absolutePython, '../../..'), absolutePython)
}

/** Главный checkout — первое поле `worktree` в porcelain-выводе Git. */
async function primaryCheckoutTarget(): Promise<PurgeTarget | null> {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: REPOSITORY_ROOT,
      timeout: 10_000,
    })
    const primaryRoot = stdout.match(/^worktree (.+)$/m)?.[1]
    if (!primaryRoot) return null
    const backendRoot = path.join(primaryRoot, BACKEND_RELATIVE_PATH)
    return targetAt(backendRoot, path.join(backendRoot, '.venv/bin/python'))
  } catch {
    return null
  }
}

/**
 * Находит проверенный Python для серверной команды, не путая worktree с API.
 * Не использует системный Python: в нём Django может отсутствовать.
 */
export async function resolvePurgeTarget(): Promise<PurgeTarget | null> {
  const configured = configuredTarget()
  if (configured) return configured

  const local = targetAt(
    LOCAL_BACKEND_ROOT,
    path.join(LOCAL_BACKEND_ROOT, '.venv/bin/python'),
  )
  return local ?? primaryCheckoutTarget()
}
