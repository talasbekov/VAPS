// Smart Josparlau E2E (§33, Этап 42): карточка работы отчёта §22.27.
//
// Что проверяется живым прогоном:
//   1) прямая ссылка `/service-reports/:reportJobId` открывает карточку и САМА
//      доводит работу до готовности — реестр для этого открывать не нужно;
//   2) параметры чужого запуска (§22.26) не приходят в браузер вовсе: их нет ни
//      в DOM, ни в теле ответа сервера — проверяются ОБА, потому что «нет на
//      экране» и «нет в ответе» — разные утверждения;
//   3) скачивание чужого файла закрыто и названо причиной: период написан в
//      первой строке содержимого, и открытый файл вернул бы то, что вырезали.
import { expect, test } from '@playwright/test'
import { hideDemoToolbar, seedCredential } from './testUtils'

const PERIOD_FROM = '2026-07-01'
const PERIOD_TO = '2026-07-31'

test.describe('Карточка работы отчёта (§22.27, mock-режим)', () => {
  test('прямая ссылка открывает карточку без единого перехода по реестру', async ({ page }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)

    await page.goto('/service-reports')
    const form = page.getByRole('group', { name: 'Форма запуска отчёта' })
    await form.getByLabel('Начало периода').fill(PERIOD_FROM)
    await form.getByLabel('Конец периода').fill(PERIOD_TO)
    // Идентификатор берётся из ОТВЕТА на создание, а не вычитывается из
    // реестра: иначе «прямая ссылка» проверялась бы переходом по ссылке.
    const created = page.waitForResponse(
      (response) =>
        response.url().includes('/api/ops/service-report-jobs/') &&
        response.request().method() === 'POST',
    )
    await form.getByRole('button', { name: 'Сформировать отчёт' }).click()
    const { reportJobId } = (await (await created).json()) as { reportJobId: string }

    await page.goto(`/service-reports/${reportJobId}`)

    await expect(page.getByText('ваш запуск')).toBeVisible()
    await expect(
      page.getByText(`${PERIOD_FROM} — ${PERIOD_TO} (границы включительно)`),
    ).toBeVisible()
    // Карточка доводит работу до готовности своим опросом (§22.21).
    await expect(page.getByText('Готов', { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Скачать' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Новая редакция' })).toBeEnabled()
  })

  test('параметры чужого запуска не приезжают в браузер — ни в DOM, ни в ответе', async ({
    page,
  }) => {
    await seedCredential(page)
    await hideDemoToolbar(page)

    await page.goto('/service-reports')
    const form = page.getByRole('group', { name: 'Форма запуска отчёта' })
    await form.getByLabel('Начало периода').fill(PERIOD_FROM)
    await form.getByLabel('Конец периода').fill(PERIOD_TO)
    await form.getByRole('button', { name: 'Сформировать отчёт' }).click()
    await expect(page.getByText('Готов', { exact: true })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('link', { name: 'История отчётов →' }).click()
    const rows = page.getByRole('region', { name: 'История отчётов' }).locator('tbody tr')
    await rows.first().getByRole('link', { name: 'Расход личного состава' }).click()
    await expect(page).toHaveURL(/\/service-reports\/report-job-/)
    const jobUrl = page.url()

    // Тела ответов собираются ПРИНЯТЫМИ КАДРАМИ, а не по виду экрана: экран
    // мог бы промолчать и по другой причине.
    const bodies: string[] = []
    page.on('response', async (response) => {
      if (
        response.url().includes('/api/ops/service-report-jobs/') &&
        response.request().method() === 'GET'
      ) {
        bodies.push(await response.text().catch(() => ''))
      }
    })

    // Смена persona — вторым init-скриптом: `seedCredential` тоже init-скрипт и
    // переустанавливал бы demo-admin на каждой навигации.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-analyst' }),
      )
    })
    await page.goto(jobUrl)

    // Работа видна (она не sensitive) — закрыты именно ПАРАМЕТРЫ.
    await expect(page.getByText('запуск другого пользователя')).toBeVisible()
    // Причина названа И в секции параметров, И в списке отказов — локатор
    // сужен до секции: одна и та же причина в двух местах экрана делает поиск
    // по всей странице неоднозначным (тот же класс, что дубли подписей).
    await expect(
      page.getByLabel('Параметры запуска').getByText(/просмотр параметров чужого отчёта/),
    ).toBeVisible()

    await expect(page.getByText(PERIOD_FROM)).toHaveCount(0)
    await expect(page.getByText(PERIOD_TO)).toHaveCount(0)
    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) {
      expect(body).not.toContain(PERIOD_FROM)
      expect(body).not.toContain(PERIOD_TO)
    }

    // §22.26: файл закрыт, и причина названа именно та, что есть.
    await expect(page.getByRole('button', { name: 'Скачать' })).toBeDisabled()
    await expect(page.getByText(/первой строке/)).toBeVisible()
  })
})
