/** Resolve a project venv without falling back to an unrelated system Python. */
import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { findBackendRoot } from './backend-layout'

const execFileAsync = promisify(execFile)
const FRONTEND_ROOT = path.resolve(__dirname, '..')
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

function venvAt(backendRoot: string | null): PurgeTarget | null {
  if (!backendRoot) return null
  for (const relative of ['.venv/bin/python', '.venv/Scripts/python.exe']) {
    const target = targetAt(backendRoot, path.join(backendRoot, relative))
    if (target) return target
  }
  return null
}

export async function resolvePurgeTarget(frontendRoot = FRONTEND_ROOT): Promise<PurgeTarget | null> {
  const configured = process.env[PURGE_PYTHON_ENV]
  if (configured) {
    const python = path.resolve(configured)
    const venv = path.dirname(path.dirname(python))
    const backendRoot = path.dirname(venv)
    const target = path.basename(venv) === '.venv' ? targetAt(backendRoot, python) : null
    if (!target) throw new Error('SMOKE_PURGE_PYTHON must point to an executable in the backend .venv')
    return target
  }
  const local = venvAt(findBackendRoot(frontendRoot))
  if (local) return local
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: frontendRoot, timeout: 10_000,
    })
    const primaryRoot = stdout.match(/^worktree (.+)$/m)?.[1]
    return primaryRoot ? venvAt(findBackendRoot(primaryRoot)) : null
  } catch {
    return null
  }
}
