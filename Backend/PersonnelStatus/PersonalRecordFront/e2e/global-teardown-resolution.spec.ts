/**
 * Контракт Plane №1119: worktree не обязан хранить Python-venv рядом с
 * фронтендом. Уборка должна найти проверенный venv главного checkout либо
 * принять явно заданный путь — иначе успешный browser-прогон оставит мусор.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { resolvePurgeTarget } from './purge-python'

const rolePassword = process.env.ACCESS_MATRIX_PASSWORD ?? ''

test('purge Python resolves an executable from a backend venv', async () => {
  const target = await resolvePurgeTarget()
  expect(target, 'provide the backend .venv or SMOKE_PURGE_PYTHON').not.toBeNull()
  expect(existsSync(target!.python)).toBe(true)
  expect(existsSync(path.join(target!.backendRoot, 'manage.py'))).toBe(true)
  if (process.env.SMOKE_PURGE_PYTHON) {
    expect(target!.python).toBe(path.resolve(process.env.SMOKE_PURGE_PYTHON))
  }
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
