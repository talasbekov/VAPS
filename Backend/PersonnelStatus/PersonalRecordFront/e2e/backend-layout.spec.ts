import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { findBackendRoot } from './backend-layout'
import { resolvePurgeTarget } from './purge-python'

let fixture: string
test.beforeEach(() => { fixture = mkdtempSync(path.join(os.tmpdir(), 'sj-layout-')) })
test.afterEach(() => { rmSync(fixture, { recursive: true, force: true }) })

for (const layout of [
  ['backend', 'frontend'],
  ['PersonnelStatus/Personnel-Records', 'PersonnelStatus/PersonalRecordFront'],
  ['Backend/PersonnelStatus/Personnel-Records', 'Backend/PersonnelStatus/PersonalRecordFront'],
]) {
  test(`finds the backend in ${layout[0]}`, () => {
    const backend = path.join(fixture, layout[0])
    const frontend = path.join(fixture, layout[1])
    mkdirSync(backend, { recursive: true })
    mkdirSync(frontend, { recursive: true })
    writeFileSync(path.join(backend, 'manage.py'), '')
    expect(findBackendRoot(frontend)).toBe(backend)
  })
}

test('an invalid explicit Python path fails instead of selecting another database', async () => {
  const previous = process.env.SMOKE_PURGE_PYTHON
  process.env.SMOKE_PURGE_PYTHON = path.join(fixture, 'missing', '.venv', 'bin', 'python')
  try {
    await expect(resolvePurgeTarget(fixture)).rejects.toThrow(/SMOKE_PURGE_PYTHON/)
  } finally {
    if (previous === undefined) delete process.env.SMOKE_PURGE_PYTHON
    else process.env.SMOKE_PURGE_PYTHON = previous
  }
})
