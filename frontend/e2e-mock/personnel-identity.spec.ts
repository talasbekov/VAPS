// Smart Josparlau E2E (§33, Этап 39): раскрытие sensitive identity
// (§20.27/§20.28) и журнал раскрытий (§20.33).
//
// Что проверяется живым прогоном:
//   1) полный ИИН НЕ ДОЕЗЖАЕТ до клиента в ответе реестра — проверяется САМ
//      сетевой ответ, а не то, что нарисовано (маскирование в вёрстке
//      маскированием не является);
//   2) раскрытие требует цели и отдаёт значение вместе со сроком полномочия;
//   3) после «Скрыть» значения нет ни в DOM, ни в URL, ни в storage;
//   4) раскрытие попало в журнал — БЕЗ самого значения;
//   5) persona без права раскрытия видит только маску и причину отказа.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { seedCredential } from './testUtils'

/** ИИН первого сотрудника demo-фикстуры (features/personnel/mocks/fixtures.ts). */
const IIN = '800101300123'
const PURPOSE = 'Сверка данных при оформлении допуска'

async function openFirstEmployee(page: Page) {
  await page.goto('/employees')
  await page.getByRole('link', { name: /Нуртаев/ }).first().click()
  await expect(page.getByRole('heading', { name: /Нуртаев/ })).toBeVisible()
  const section = page.getByRole('region', { name: 'Идентификационные данные' })
  await expect(section).toBeVisible()
  return section
}

/** §20.27: значение не должно остаться нигде — ни в разметке, ни в адресе,
 * ни в хранилищах вкладки. */
async function expectIinAbsentEverywhere(page: Page) {
  const html = await page.content()
  expect(html).not.toContain(IIN)
  expect(page.url()).not.toContain(IIN)
  const storages = await page.evaluate(() => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
  }))
  expect(storages.local).not.toContain(IIN)
  expect(storages.session).not.toContain(IIN)
}

test.describe('Sensitive identity личного состава (§20.27/§20.33, mock-режим)', () => {
  test('реестр не доставляет полный ИИН на клиент — ни в ответе, ни в разметке', async ({
    page,
  }) => {
    await seedCredential(page)

    const directoryResponses: string[] = []
    page.on('response', async (response) => {
      if (response.url().includes('/api/ops/personnel-directory/')) {
        directoryResponses.push(await response.text().catch(() => ''))
      }
    })

    await page.goto('/employees')
    await expect(page.getByRole('link', { name: /Нуртаев/ }).first()).toBeVisible()

    expect(directoryResponses.length).toBeGreaterThan(0)
    // Главная проверка среза: чувствительного значения нет в САМОМ ответе.
    for (const body of directoryResponses) {
      expect(body).not.toContain(IIN)
    }
    await expect(page.getByText('••••••••0123').first()).toBeVisible()
    await expectIinAbsentEverywhere(page)
  })

  test('раскрытие: цель обязательна, значение приходит со сроком и убирается целиком', async ({
    page,
  }) => {
    await seedCredential(page)
    const section = await openFirstEmployee(page)

    await section.getByRole('button', { name: 'Раскрыть ИИН' }).click()
    // §20.27 purpose: пустая/короткая цель отклоняется СЕРВЕРОМ.
    await section.getByLabel(/Цель раскрытия/).fill('нет')
    await section.getByRole('button', { name: 'Раскрыть', exact: true }).click()
    await expect(section.getByText(/Укажите цель раскрытия/)).toBeVisible()
    await expectIinAbsentEverywhere(page)

    await section.getByLabel(/Цель раскрытия/).fill(PURPOSE)
    await section.getByRole('button', { name: 'Раскрыть', exact: true }).click()
    await expect(section.getByText(IIN)).toBeVisible()
    await expect(section.getByText(/полномочие действует до/)).toBeVisible()

    await section.getByRole('button', { name: 'Скрыть' }).click()
    await expect(section.getByText(IIN)).toHaveCount(0)
    await expectIinAbsentEverywhere(page)

    // §20.33: обращение попало в журнал — с целью и без значения.
    await expect(section.getByText(new RegExp(PURPOSE))).toBeVisible()
    const sectionHtml = await section.innerHTML()
    expect(sectionHtml).not.toContain(IIN)

    // Журнал переживает перезагрузку: он в хранилище, а не в состоянии страницы.
    await page.reload()
    const reloaded = page.getByRole('region', { name: 'Идентификационные данные' })
    await expect(reloaded.getByText(new RegExp(PURPOSE))).toBeVisible()
    await expectIinAbsentEverywhere(page)
  })

  test('без права раскрытия: только маска и названная причина', async ({ page }) => {
    // §20.28: право видеть карточку не то же самое, что право раскрыть ИИН.
    // Аналитик — контролёр: видит карточку и журнал обращений
    // (`personnel.identity.audit`), но раскрывать не вправе.
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'demo-analyst' }),
      )
    })
    const section = await openFirstEmployee(page)

    await expect(section.getByRole('button', { name: 'Раскрыть ИИН' })).toBeDisabled()
    await expect(section.getByText(/personnel\.identity\.reveal/)).toBeVisible()
    await expectIinAbsentEverywhere(page)
  })
})
