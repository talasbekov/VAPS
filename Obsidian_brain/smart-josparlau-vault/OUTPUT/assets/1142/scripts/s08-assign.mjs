import fs from 'node:fs'
import { open, shot, sleep, api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
const { page, close } = await open('y_meiram')
await page.goto(`http://localhost:3106/employees?campaign=${run.campaignId}&businessDate=${run.date}`)
await page.waitForLoadState('networkidle'); await sleep(1200)
await shot(page, 'meiram-campaign-pool', true)
const main = page.getByRole('main')
const t = (await main.innerText()).replace(/\n+/g, ' | ')
console.log('экран распределения:', t.slice(t.indexOf('Общий пул'), t.indexOf('Общий пул') + 500))
const empSel = page.getByLabel('Сотрудник', { exact: true })
console.log('опции «Сотрудник»:', (await empSel.locator('option').allTextContents()).join(' | '))
const c = (await api('y_meiram', 'GET', `/api/ops/security-events/forces/campaigns/${run.campaignId}/`)).body
const ev = c.events[0]
const plan = [['20', '8563', 'PHYSICAL_SQUAD'], ['24', '8564', 'PHYSICAL_SQUAD']]
for (const [emp, vo, kind] of plan) {
  const demand = ev.demandRows.find(d => d.visitObjectId === vo && d.kindCode === kind)
  await empSel.selectOption(emp)
  await page.getByLabel('Мероприятие', { exact: true }).selectOption(ev.eventId)
  await page.getByLabel('Объект', { exact: true }).selectOption(vo)
  const rowSel = page.getByLabel('Строка потребности', { exact: true })
  if (emp === '20') console.log('строки потребности объекта 1:', (await rowSel.locator('option').allTextContents()).join(' | '))
  await rowSel.selectOption(demand.id)
  if (emp === '20') await shot(page, 'meiram-assignment-form')
  const rp = page.waitForResponse(x => /campaigns\/\d+\/assignments/.test(x.url()) && x.request().method() === 'POST')
  await page.getByRole('button', { name: 'Назначить', exact: true }).click()
  const r = await rp; console.log('POST assignment', emp, '→', vo, r.status(), (await r.text()).slice(0, 100))
  await sleep(800)
}
await page.reload(); await page.waitForLoadState('networkidle'); await sleep(1000)
const t2 = (await main.innerText()).replace(/\n+/g, ' | ')
console.log('после назначений:', t2.slice(t2.indexOf('Объекты и ёмкость'), t2.indexOf('Объекты и ёмкость') + 600))
await shot(page, 'meiram-two-assignments', true)
// повторное назначение того же сотрудника на другой объект того же ОМ — пересечение?
await empSel.selectOption('20'); await page.getByLabel('Мероприятие', { exact: true }).selectOption(ev.eventId); await page.getByLabel('Объект', { exact: true }).selectOption('8564')
await page.getByLabel('Строка потребности', { exact: true }).selectOption(ev.demandRows.find(d => d.visitObjectId === '8564').id); await sleep(400)
console.log('предупреждение о пересечении:', await page.getByText('Период пересекается с существующим назначением сотрудника.', { exact: true }).count(), '| «Назначить» активна:', await page.getByRole('button', { name: 'Назначить', exact: true }).isEnabled())
await shot(page, 'meiram-conflict-warning')
// откат формы: не назначаем второй раз
await page.reload(); await page.waitForLoadState('networkidle'); await sleep(800)
const comment = page.getByLabel('Комментарий при неполном распределении', { exact: true })
console.log('поле комментария недобора:', await comment.count())
await comment.fill('Проходка №1142: департамент выделил 2 физнаряда из 4 — недобор 2, объекты обеспечены по одному посту; группа досмотра идёт статусом')
const hb = page.getByRole('button', { name: 'Передать в расстановку', exact: true })
console.log('кнопка передачи:', await hb.count(), await hb.isEnabled())
const rp = page.waitForResponse(x => /hand-over/.test(x.url()) && x.request().method() === 'POST')
await hb.click()
const r = await rp; console.log('POST hand-over', r.status(), (await r.text()).slice(0, 200))
await sleep(1200)
const c2 = (await api('y_meiram', 'GET', `/api/ops/security-events/forces/campaigns/${run.campaignId}/`)).body
console.log('кампания:', c2.status, 'assignments:', JSON.stringify(c2.assignments?.map(a => [a.employeeId, a.visitObjectId, a.demandRowId?.slice(-6), a.overrideReason])))
const e2 = (await api('y_meiram', 'GET', `/api/ops/security-events/${run.eventId}/`)).body
console.log('forceRoster ОМ:', JSON.stringify(e2.forceRoster?.map(m => [m.employeeId, m.employeeName, m.kindCode, m.visitObjectId])), '| forceHandover:', JSON.stringify(e2.forceHandover).slice(0, 200))
await shot(page, 'meiram-handed-over', true)
await close()
