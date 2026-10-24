import fs from 'node:fs'
import { open, shot, sleep, api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
// 6-neg: начальник управления без распределения
{
  const { page, close } = await open('n_meldebekov')
  await page.goto(`http://localhost:3106/statuses?forcesRequest=${encodeURIComponent(run.allocationId)}`)
  await page.waitForLoadState('networkidle'); await sleep(1200)
  const banner = page.getByRole('status', { name: `Запрос на ${run.code}`, exact: true })
  console.log('баннер:', await banner.count(), (await banner.innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 400))
  await shot(page, 'meldebekov-statuses-banner')
  await page.getByPlaceholder('Поиск по ФИО, отделу, должности...').fill('Байжанов'); await sleep(900)
  const rows = page.getByRole('row').filter({ hasText: 'Байжанов' })
  console.log('строк Байжанов:', await rows.count(), (await rows.allInnerTexts()).map(s => s.replace(/\n+/g, ' · ').slice(0, 80)).join(' || '))
  await rows.first().getByRole('checkbox').check()
  const btn = banner.getByRole('button', { name: /Добавить в общий резерв/ })
  console.log('кнопка резерва:', await btn.count(), (await btn.allInnerTexts()).join('|'), '| подгруппа:', (await banner.getByRole('group', { name: 'Подгруппа участия ОМ' }).innerText().catch(() => 'нет')).replace(/\n+/g, ' | '))
  await shot(page, 'meldebekov-select-no-campaign')
  if (await btn.count()) {
    await btn.first().click(); await sleep(1200)
    console.log('результат без распределения:', (await banner.innerText()).replace(/\n+/g, ' | ').slice(0, 500))
    await shot(page, 'meldebekov-no-campaign-error')
  }
  await close()
}
// 6a: Штаб создаёт распределение
{
  const { page, close } = await open('y_meiram')
  await page.goto(`http://localhost:3106/employees?view=forces&businessDate=${run.date}`)
  await page.waitForLoadState('networkidle'); await sleep(800)
  await page.getByRole('button', { name: 'Новое распределение', exact: true }).click(); await sleep(400)
  await page.getByLabel('Название', { exact: true }).fill('Проходка №1142 — распределение')
  const cbs = page.getByRole('checkbox', { name: new RegExp(run.code) })
  console.log('чекбоксов ОМ:', await cbs.count(), (await cbs.first().getAttribute('aria-label')) ?? (await page.locator('label').filter({ hasText: run.code }).allInnerTexts()).join('|'))
  await cbs.first().check()
  await shot(page, 'meiram-new-campaign-form')
  await page.getByRole('button', { name: 'Создать распределение', exact: true }).click()
  await page.waitForURL(/campaign=/, { timeout: 15000 }); await sleep(800)
  const campaignId = new URL(page.url()).searchParams.get('campaign')
  const c = await api('y_meiram', 'GET', `/api/ops/security-events/forces/campaigns/${campaignId}/`)
  console.log('кампания:', campaignId, c.body.code, c.body.status, 'events', c.body.events?.map(e => e.code), 'pool', c.body.pool?.length, 'warnings', JSON.stringify(c.body.warnings))
  await shot(page, 'meiram-campaign-created', true)
  fs.writeFileSync('run.json', JSON.stringify({ ...run, campaignId, campaignCode: c.body.code }, null, 2))
  await close()
}
