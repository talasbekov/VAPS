import { existsSync } from 'node:fs'
import path from 'node:path'

/** Resolve the application in both the GitLab monorepo and its GitHub export. */
export function findBackendRoot(frontendRoot: string): string | null {
  let root = path.resolve(frontendRoot)
  while (true) {
    for (const relative of ['Personnel-Records', 'backend', 'PersonnelStatus/Personnel-Records', 'Backend/PersonnelStatus/Personnel-Records']) {
      const candidate = path.join(root, relative)
      if (existsSync(path.join(candidate, 'manage.py'))) return candidate
    }
    const parent = path.dirname(root)
    if (parent === root) return null
    root = parent
  }
}
