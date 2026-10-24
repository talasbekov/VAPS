import fs from 'node:fs'
import { open, shot, sleep, api } from './walk.mjs'
const R = JSON.parse(fs.readFileSync('run2.json', 'utf8'))
const APP = 'http://localhost:3106'
const reg = await api('acc_admin', 'GET', '/api/ops/evaluation-registry/?employee=20')
const row = reg.body.results?.find(r => r.eventNumber === R.code && r.participated)
console.log('строка реестра ОМ-46:', JSON.stringify(row).slice(0, 700))
{
  const { page, close } = await open('y_talasbekov')
  await page.goto(`${APP}/security-ops/profile`); await page.waitForLoadState('networkidle'); await sleep(1500)
  const tabs = page.getByRole('main').getByText('История', { exact: true })
  console.log('элементов «История»:', await tabs.count())
  await tabs.first().click(); await sleep(1500)
  const t = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  const k = t.indexOf('История'); console.log('История (сотрудник):', t.slice(k, k + 700))
  await shot(page, 'r2-profile-history-self', true)
  const cal = page.getByRole('main').getByText('Календарь', { exact: true }); if (await cal.count()) { await cal.first().click(); await sleep(1200); await shot(page, 'r2-profile-calendar', true) }
  await close()
}
for (const who of ['n_meldebekov', 'acc_admin']) {
  const { page, close } = await open(who)
  await page.goto(`${APP}/security-ops/profile/20`); await page.waitForLoadState('networkidle'); await sleep(1500)
  const tabs = page.getByRole('main').getByText('История', { exact: true }); if (await tabs.count()) { await tabs.first().click(); await sleep(1200) }
  const t = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  const k = t.indexOf('История'); console.log(who, 'профиль 20 / История:', t.slice(k, k + 500))
  await shot(page, `r2-${who.replace('_', '-')}-history-20`, true); await close()
}
{
  const { page, close } = await open('acc_admin')
  await page.goto(`${APP}/security-ops/analytics`); await page.waitForLoadState('networkidle'); await sleep(2000)
  const tabs = page.getByRole('main').getByText('Аналитика мероприятий', { exact: true })
  console.log('вкладка «Аналитика мероприятий»:', await tabs.count()); await tabs.first().click(); await sleep(3000)
  const t = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  console.log('Аналитика мероприятий:', t.slice(t.indexOf('Аналитика мероприятий'), t.indexOf('Аналитика мероприятий') + 600))
  for (const code of [R.code, 'ОМ-2026-45']) { const k = t.indexOf(code); console.log(code, 'в аналитике:', k >= 0 ? t.slice(k - 20, k + 220) : 'НЕТ') }
  await shot(page, 'r2-admin-event-analytics', true)
  const rt = page.getByRole('main').getByText('Аналитика рейтинга', { exact: true }); await rt.first().click(); await sleep(3000)
  const t2 = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  console.log('Аналитика рейтинга:', t2.slice(t2.indexOf('Аналитика рейтинга'), t2.indexOf('Аналитика рейтинга') + 500))
  await shot(page, 'r2-admin-rating-analytics', true)
  await page.goto(`${APP}/security-ops/ratings/workspace`); await page.waitForLoadState('networkidle'); await sleep(2500)
  const t3 = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | '); const k3 = t3.indexOf('Байжанов'); console.log('рабочее место оценивания, Байжанов:', k3 >= 0 ? t3.slice(k3 - 100, k3 + 200) : 'НЕТ')
  await shot(page, 'r2-admin-ratings-workspace', true)
  await close()
}
