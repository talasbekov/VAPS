import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { findBackendRoot } from './backend-layout'
import { resolvePurgeTarget } from './purge-python'

const execFileAsync = promisify(execFile)
const FRONTEND_ROOT = path.resolve(__dirname, '..')
const BACKEND_ROOT = findBackendRoot(FRONTEND_ROOT)
type CommandOptions = { env?: Record<string, string>; timeout?: number }
type Invocation = { executable: string; args: string[] }
const LEGACY_LOCAL_SETTINGS = 'organization_management.config.settings.local_postgres'

/** argv stays structured: Python snippets, JSON and passwords are never shell commands. */
export function dockerBackendInvocation(container: string, args: string[], env: Record<string, string> = {}): Invocation {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) throw new Error('Invalid backend Docker container name')
  const overrides: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid backend environment variable name')
    if (name === 'DJANGO_SETTINGS_MODULE' && value === LEGACY_LOCAL_SETTINGS) continue
    overrides.push('-e', `${name}=${value}`)
  }
  const containerArgs: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === `--settings=${LEGACY_LOCAL_SETTINGS}`) continue
    if (args[index] === '--settings' && args[index + 1] === LEGACY_LOCAL_SETTINGS) { index += 1; continue }
    containerArgs.push(args[index])
  }
  // Docker keeps its own database environment. Host PR_DB_PORT=15345 must not
  // replace the container's internal PostgreSQL port or redirect fixture work.
  // Existing fixtures target local_postgres only because they originally ran
  // outside Docker. Inside the container use its configured settings; retain
  // other explicit settings overrides and every other command argument.
  return { executable: 'docker', args: ['exec', ...overrides, container, 'python', 'manage.py', ...containerArgs] }
}

function requireBackendRoot(): string {
  if (BACKEND_ROOT === null) throw new Error('No manage.py belonging to this checkout was found')
  return BACKEND_ROOT
}

function nativePythonSync(): string {
  const configured = process.env.SMOKE_PURGE_PYTHON
  if (configured) {
    const python = path.resolve(configured)
    const venv = path.dirname(path.dirname(python))
    if (path.basename(venv) !== '.venv' || !existsSync(python) || !existsSync(path.join(path.dirname(venv), 'manage.py'))) {
      throw new Error('SMOKE_PURGE_PYTHON must point to an executable in the backend .venv')
    }
    return python
  }
  const candidateRoots = [requireBackendRoot()]
  try {
    const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: FRONTEND_ROOT, encoding: 'utf8', timeout: 10_000 })
    const primaryRoot = worktrees.match(/^worktree (.+)$/m)?.[1]
    const primaryBackend = primaryRoot ? findBackendRoot(primaryRoot) : null
    if (primaryBackend) candidateRoots.push(primaryBackend)
  } catch { /* A local venv remains usable without a Git worktree registry. */ }
  for (const root of candidateRoots) {
    for (const relative of ['.venv/Scripts/python.exe', '.venv/bin/python']) {
      const python = path.join(root, relative)
      if (existsSync(python)) return python
    }
  }
  throw new Error('Provide SMOKE_DOCKER_CONTAINER or a backend .venv / SMOKE_PURGE_PYTHON for fixture commands')
}

export async function runBackendCommand(args: string[], options: CommandOptions = {}): Promise<string> {
  const container = process.env.SMOKE_DOCKER_CONTAINER
  let invocation: Invocation
  if (container) {
    invocation = dockerBackendInvocation(container, args, options.env)
  } else {
    const target = await resolvePurgeTarget()
    if (target === null) throw new Error('Provide SMOKE_DOCKER_CONTAINER or a backend .venv / SMOKE_PURGE_PYTHON for fixture commands')
    invocation = { executable: target.python, args: ['manage.py', ...args] }
  }
  const { stdout } = await execFileAsync(invocation.executable, invocation.args, {
    cwd: requireBackendRoot(),
    env: container ? process.env : { ...process.env, ...options.env },
    timeout: options.timeout ?? 120_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  })
  return stdout
}

export function runBackendCommandSync(args: string[], options: CommandOptions = {}): string {
  const container = process.env.SMOKE_DOCKER_CONTAINER
  const invocation = container ? dockerBackendInvocation(container, args, options.env) : { executable: nativePythonSync(), args: ['manage.py', ...args] }
  return execFileSync(invocation.executable, invocation.args, {
    cwd: requireBackendRoot(),
    env: container ? process.env : { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeout ?? 120_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  })
}
