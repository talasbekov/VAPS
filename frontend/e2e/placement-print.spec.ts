// Story 16.7 — печатная форма Расстановки (`/print/placement`) в реальном
// chromium против ПРОДАКШН-сборки SPA (порт 4173). Образец
// expense-print.spec.ts (10.7)/print-qa.spec.ts (8.8) — прод-сборка нужна
// для конкатенированного CSS бандла (Ловушка 8 стори 8.8), не dist-e2e
// харнес. Сеть перехвачена page.route — реальный fetch, реальный §36-конверт.
import { expect, test, type Page } from '@playwright/test'

const EMPLOYEE_ID = '11111111-1111-1111-1111-111111111111'

async function stubApi(page: Page) {
  await page.route('**/api/operations/assignment-versions/7/', (route) =>
    route.fulfill({
      json: {
        id: 7,
        event: 3,
        status: 'APPROVED',
        version: 2,
        is_current: true,
        signature_hash: 'e2e-signature',
        created_at: '2026-08-01T09:00:00Z',
        updated_at: '2026-08-01T09:00:00Z',
        assignments: [
          {
            id: 1,
            employee_id: EMPLOYEE_ID,
            post: 5,
            conflict_severity: '',
            conflict_codes: [],
            acknowledged_at: '2026-08-02T10:00:00Z',
            ack_escalated_at: null,
          },
        ],
      },
    }),
  )
}

test('без credential /print/placement → редирект /login', async ({ page }) => {
  await page.goto('/print/placement?version_id=7')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByLabel('Идентификатор (X-User-Id)')).toBeVisible()
  await expect(page.locator('.print-root')).toHaveCount(0)
})

test.describe('за credential с assignment.create', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'e2e-placement-print' }),
      )
    })
    await page.route('**/api/operations/my-permissions/', (route) =>
      route.fulfill({ json: { permissions: ['assignment.create'] } }),
    )
  })

  test('печатная форма рендерится ВНЕ AppLayout — ни сайдбара, ни шапки портала', async ({
    page,
  }) => {
    await stubApi(page)
    await page.goto('/print/placement?version_id=7')

    await expect(page.locator('.print-root')).toBeVisible()
    await expect(page.getByRole('navigation')).toHaveCount(0)
    await expect(page.getByRole('banner')).toHaveCount(0)
  })

  test('таблица назначений и заголовок версии рендерятся', async ({ page }) => {
    await stubApi(page)
    await page.goto('/print/placement?version_id=7')

    await expect(
      page.getByRole('heading', { name: /Событие #3.*Версия 2/ }),
    ).toBeVisible()
    await expect(page.getByText(EMPLOYEE_ID)).toBeVisible()
  })

  test('print-медиа скрывает ТОЛЬКО подсказку — контент печатается', async ({
    page,
  }) => {
    await stubApi(page)
    await page.goto('/print/placement?version_id=7')
    await page.emulateMedia({ media: 'print' })

    await expect(page.locator('.print-screen-hint')).toBeHidden()
    await expect(page.locator('.print-root h1')).toBeVisible()
    await expect(page.locator('.print-root table')).toBeVisible()
    await expect(page.locator('.print-note')).toBeVisible()
  })

  test('404 показывает объясняющий текст, не пустой лист', async ({ page }) => {
    await page.route('**/api/operations/assignment-versions/999/', (route) =>
      route.fulfill({
        status: 404,
        json: {
          error_code: 'ENTITY_NOT_FOUND',
          message: 'Не найдено',
          details: {},
          request_id: null,
          timestamp: new Date().toISOString(),
        },
      }),
    )
    await page.goto('/print/placement?version_id=999')

    await expect(
      page.getByText('Версия Расстановки не найдена.'),
    ).toBeVisible()
  })
})
