import fs from 'node:fs'
import { open, shot, sleep, api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
let e = (await api('m_turmagambetov', 'GET', `/api/ops/security-events/${run.eventId}/`)).body
console.log('назначения:', JSON.stringify(e.placementAssignments?.map(a => [a.employeeId, a.postId?.slice(-6)])), '| объект 2:', e.visitObjects[1].stage)
if (e.visitObjects[1].stage === 'PLACEMENT') {
  const { page, close } = await open('m_turmagambetov')
  await page.goto(`http://localhost:3106/security-ops/events/${run.eventId}?visit=${run.visits[1].id}`)
  await page.waitForLoadState('networkidle'); await sleep(1500)
  const rp = page.waitForResponse(x => /placement\/complete/.test(x.url()) && x.request().method() === 'POST')
  await page.getByRole('button', { name: 'Завершить расстановку', exact: true }).click()
  await sleep(600)
  const dlg = page.getByRole('dialog')
  if (await dlg.count()) { console.log('диалог:', (await dlg.innerText()).replace(/\n+/g, ' | ').slice(0, 200)); const ok = dlg.getByRole('button', { name: /Завершить|Подтвердить/ }).last(); if (await ok.count()) await ok.click() }
  const r = await rp; console.log('POST placement/complete obj2', r.status(), (await r.text()).slice(0, 80))
  await sleep(1000)
  await shot(page, 'turmagambetov-placement-completed', true)
  await close()
}
// шаг 10: объект 1, старший u_musakhan
{
  const { page, close } = await open('u_musakhan')
  await page.goto(`http://localhost:3106/security-ops/events/${run.eventId}?visit=${run.visits[0].id}`)
  await page.waitForLoadState('networkidle'); await sleep(1500)
  const region = page.getByRole('region', { name: 'Согласование расстановки', exact: true })
  console.log('регион согласования:', await region.count())
  const t = (await region.innerText()).replace(/\n+/g, ' | ')
  console.log('этап:', t.slice(0, 700))
  await shot(page, 'musakhan-approval-start', true)
  const sel = page.getByRole('combobox', { name: 'Выберите согласующего из руководства второго департамента', exact: true })
  console.log('кандидаты:', (await sel.locator('option').allTextContents()).join(' | '))
  await sel.selectOption({ label: (await sel.locator('option').allTextContents()).find(o => /Сапарова/.test(o)) })
  await shot(page, 'musakhan-approver-chosen')
  const rp = page.waitForResponse(x => /approval\/route/.test(x.url()) && x.request().method() === 'POST')
  await page.getByRole('button', { name: 'Назначить первым согласующим', exact: true }).click()
  const r = await rp; console.log('POST route/select', r.status(), (await r.text()).slice(0, 100)); await sleep(1000)
  console.log('маршрут на экране:', (await region.innerText()).replace(/\n+/g, ' | ').slice(0, 600))
  await shot(page, 'musakhan-route-set', true)
  const rp2 = page.waitForResponse(x => /approval\/send/.test(x.url()) && x.request().method() === 'POST')
  await page.getByRole('button', { name: 'Отправить на согласование', exact: true }).click()
  const r2 = await rp2; console.log('POST approval/send', r2.status(), (await r2.text()).slice(0, 100)); await sleep(1200)
  e = (await api('u_musakhan', 'GET', `/api/ops/security-events/${run.eventId}/`)).body
  const v = e.visitObjects[0]
  console.log('объект 1:', v.stage, v.documentStatus, 'v', v.documentVersion, '| маршрут:', JSON.stringify(v.approvalRoute?.map(r => [r.name, r.username, r.status])))
  await shot(page, 'musakhan-sent-for-approval', true)
  await close()
}
