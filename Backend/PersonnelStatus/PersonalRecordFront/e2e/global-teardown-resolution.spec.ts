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

test('worktree без локального venv находит purge Python главного checkout', async () => {
  const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: frontendRoot,
    encoding: 'utf8',
  })
  const primaryRoot = worktrees.match(/^worktree (.+)$/m)?.[1]
  const primaryPython = primaryRoot
    ? path.join(primaryRoot, 'Backend/PersonnelStatus/Personnel-Records/.venv/bin/python')
    : ''

  expect(existsSync(worktreePython), 'проверка осмысленна только без local worktree venv').toBe(false)
  expect(existsSync(primaryPython), 'основной checkout обязан дать проверенный Python').toBe(true)
  await expect(resolvePurgeTarget()).resolves.toEqual({
    backendRoot: path.dirname(path.dirname(path.dirname(primaryPython))),
    python: primaryPython,
  })
  expect(resolverSource).toContain('SMOKE_PURGE_PYTHON')
})

test('production: observer открывает личный кабинет до уборки worktree', async ({ page }) => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'нужен production-стенд: SMOKE_LIVE=1')
  const app = process.env.SMOKE_APP ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3106'
  const password = process.env.SMOKE_PASSWORD ?? ''
  expect(password, 'production config обязан передать пароль стенда').not.toBe('')

  const csrf = (await (await page.context().request.get(`${app}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await page.context().request.post(`${app}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'observer', password, json: 'true' },
  })
  await page.goto(`${app}/security-ops/profile/`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('link', { name: 'Мой профиль' })).toBeVisible()
  await expect(page.getByText('Доступ закрыт')).toHaveCount(0)
})
