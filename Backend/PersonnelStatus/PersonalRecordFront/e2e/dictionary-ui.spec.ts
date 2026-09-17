import { test, expect } from '@playwright/test'
test.use({ serviceWorkers: 'block' })
const APP = process.env.SMOKE_APP ?? 'http://localhost:3108'
test.skip(process.env.SMOKE_LIVE !== '1', 'Requires running frontend')

test('dictionary reader sees values without write actions', async ({ page }) => {
  await page.route('**/api/auth/session**', route => route.fulfill({headers: {'access-control-allow-origin':'*'}, json: {
    user: {id: '1278', name: 'Учебный читатель', username: 'reader', role: 'USER', accessToken: 'test-only'},
    accessToken: 'test-only', expires: '2099-01-01T00:00:00Z',
  }}))
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({headers: {'access-control-allow-origin':'*'}, json: {permissions: ['dictionary.view']}}))
  await page.route('**/api/ops/dictionaries/*/entries/**', route => route.fulfill({headers: {'access-control-allow-origin':'*'}, json: {results: [{
    id: '1278', dictionaryCode: 'RETURN_REASONS', code: 'TEST1278', label: 'Учебная причина', description: '',
    isActive: true, groupCode: null, updatedAt: '', usage: {status: 'TRACKED', reason: null, references: [], totalCount: 0},
  }]}}))
  await page.goto(`${APP}/security-ops/dictionaries/RETURN_REASONS/`)
  await expect(page.getByText('Учебная причина', {exact:true})).toBeVisible()
  for (const name of ['Добавить', 'Редактировать', 'Удалить', 'Деактивировать']) {
    await expect(page.getByRole('button', {name, exact:true})).toHaveCount(0)
  }
})
