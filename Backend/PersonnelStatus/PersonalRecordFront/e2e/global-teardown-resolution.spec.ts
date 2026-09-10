/**
 * Контракт Plane №1119: worktree не обязан хранить Python-venv рядом с
 * фронтендом. Уборка должна найти проверенный venv главного checkout либо
 * принять явно заданный путь — иначе успешный browser-прогон оставит мусор.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { resolvePurgeTarget } from './purge-python'

const frontendRoot = path.resolve(__dirname, '..')
const worktreePython = path.resolve(frontendRoot, '../Personnel-Records/.venv/bin/python')
const resolverSource = readFileSync(path.join(frontendRoot, 'e2e/purge-python.ts'), 'utf8')
const rolePassword = process.env.ACCESS_MATRIX_PASSWORD ?? ''

test('purge Python выбирается из текущего либо главного checkout', async () => {
  const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: frontendRoot,
    encoding: 'utf8',
  })
  const primaryRoot = worktrees.match(/^worktree (.+)$/m)?.[1]
  const primaryPython = primaryRoot
    ? path.join(primaryRoot, 'Backend/PersonnelStatus/Personnel-Records/.venv/bin/python')
    : ''

  const expectedPython = existsSync(worktreePython) ? worktreePython : primaryPython
  expect(existsSync(expectedPython), 'текущий или основной checkout обязан дать проверенный Python').toBe(true)
  await expect(resolvePurgeTarget()).resolves.toEqual({
    backendRoot: path.dirname(path.dirname(path.dirname(expectedPython))),
    python: expectedPython,
  })
  expect(resolverSource).toContain('SMOKE_PURGE_PYTHON')
})

test('production: не-admin открывает личный кабинет до уборки worktree', async ({ page }) => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'нужен production-стенд: SMOKE_LIVE=1')
  test.skip(rolePassword === '', 'нужен ACCESS_MATRIX_PASSWORD для не-admin персоны')
  const app = process.env.SMOKE_APP ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3106'

  const csrf = (await (await page.context().request.get(`${app}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await page.context().request.post(`${app}/api/auth/callback/credentials/`, {
    form: {
      csrfToken: csrf.csrfToken,
      username: 'acc_employee_d2',
      password: rolePassword,
      json: 'true',
    },
  })
  await page.goto(`${app}/security-ops/profile/`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('link', { name: 'Мой профиль' })).toBeVisible()
  await expect(page.getByText('Доступ закрыт')).toHaveCount(0)
})
