import fs from 'node:fs'
import { open, shot, sleep, api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
const ev = async (who) => (await api(who, 'GET', `/api/ops/security-events/${run.eventId}/`)).body
// 0) кто в листе ознакомления
let e = await ev('y_meiram')
console.log('назначения на посты:', JSON.stringify(e.placementAssignments?.map(a => [a.employeeId, a.employeeName, a.acknowledgedAt, a.declinedAt])))
// 1) сотрудник сам
{
  const { page, close } = await open('y_talasbekov')
  await page.goto('http://localhost:3106/security-ops/profile'); await page.waitForLoadState('networkidle'); await sleep(1500)
  console.log('профиль:', (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ').slice(0, 300))
  const tab = page.getByRole('tab', { name: /Мои назначения/ }); if (await tab.count()) await tab.click()
  await sleep(600)
  const item = page.getByRole('listitem').filter({ hasText: 'Проходка №1142' })
  console.log('карточка назначения:', await item.count(), (await item.first().innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 300))
  await shot(page, 'talasbekov-my-assignment', true)
  console.log('кнопки:', (await item.first().getByRole('button').allInnerTexts()).join(' | '))
  const rp = page.waitForResponse(x => /acknowledge/.test(x.url()) && x.request().method() === 'POST')
  await item.first().getByRole('button', { name: 'Ознакомлен, заступлю', exact: true }).click()
  const r = await rp; console.log('POST acknowledge', r.status(), (await r.text()).slice(0, 100)); await sleep(1000)
  console.log('после:', (await item.first().innerText()).replace(/\n+/g, ' | ').slice(0, 200))
  await shot(page, 'talasbekov-acknowledged', true)
  await close()
}
// 2) начальник управления за сотрудника без учётки (Есимов, 24)
{
  const { page, close } = await open('n_meldebekov')
  await page.goto('http://localhost:3106/security-ops/profile/24'); await page.waitForLoadState('networkidle'); await sleep(1500)
  const item = page.getByRole('listitem').filter({ hasText: 'Проходка №1142' })
  console.log('карточка Есимова у начальника:', await item.count(), '| кнопки:', (await item.first().getByRole('button').allInnerTexts()).join(' | '))
  await shot(page, 'meldebekov-esimov-profile', true)
  await item.first().getByRole('button', { name: 'Ознакомлен лично', exact: true }).click(); await sleep(500)
  const d = page.getByRole('dialog')
  console.log('окно:', (await d.innerText()).replace(/\n+/g, ' | ').slice(0, 300))
  const ok = d.getByRole('button', { name: 'Подтвердить ознакомление', exact: true })
  console.log('кнопка до заполнения:', await ok.isEnabled())
  await d.getByLabel('Способ доведения *', { exact: true }).fill('Проходка №1142: личный инструктаж в кабинете начальника управления 12.09.2026')
  await d.getByLabel('Основание отсутствия учётной записи *', { exact: true }).fill('Проходка №1142: учётная запись сотруднику не выдана')
  await shot(page, 'meldebekov-personal-ack-dialog')
  const rp = page.waitForResponse(x => /acknowledge/.test(x.url()) && x.request().method() === 'POST')
  await ok.click(); const r = await rp; console.log('POST acknowledge (personal)', r.status(), (await r.text()).slice(0, 120)); await sleep(1000)
  await shot(page, 'meldebekov-personal-acknowledged', true)
  await close()
}
e = await ev('y_meiram')
console.log('лист после:', JSON.stringify(e.placementAssignments?.map(a => [a.employeeId, a.acknowledgedVia, a.acknowledgedBy, a.acknowledgementMethod?.slice(0, 30)])))
// 3) старший объекта: кнопка завершения недоступна?
{
  const { page, close } = await open('u_musakhan')
  await page.goto(`http://localhost:3106/security-ops/events/${run.eventId}?visit=${run.visits[0].id}`); await page.waitForLoadState('networkidle'); await sleep(1500)
  const t = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  const k = t.indexOf('Ознакомились'); console.log('этап ознакомления:', t.slice(k, k + 300))
  const btn = page.getByRole('button', { name: 'Завершить ознакомление', exact: true })
  console.log('у старшего объекта «Завершить ознакомление»:', await btn.count(), await btn.count() ? (await btn.isEnabled() ? 'enabled' : 'disabled') : '')
  await shot(page, 'musakhan-ack-stage-object-chief', true)
  await close()
}
// 4) старший наряда завершает
{
  const { page, close } = await open('k_baglanov')
  await page.goto(`http://localhost:3106/security-ops/events/${run.eventId}/`); await page.waitForLoadState('networkidle'); await sleep(1500)
  const btn = page.getByRole('button', { name: 'Завершить ознакомление', exact: true })
  console.log('у старшего наряда:', await btn.count(), await btn.count() ? (await btn.isEnabled() ? 'enabled' : 'disabled') : '')
  await shot(page, 'baglanov-ack-stage', true)
  await btn.click(); await sleep(500)
  const d = page.getByRole('dialog')
  if (await d.count()) { console.log('окно:', (await d.innerText()).replace(/\n+/g, ' | ').slice(0, 200)); const ta = d.getByRole('textbox'); if (await ta.count()) await ta.first().fill('Проходка №1142: все ознакомлены'); }
  const rp = page.waitForResponse(x => /acknowledgement\/complete/.test(x.url()) && x.request().method() === 'POST')
  if (await d.count()) await d.getByRole('button', { name: /Завершить|Подтвердить/ }).last().click()
  const r = await rp; console.log('POST acknowledgement/complete', r.status(), (await r.text()).slice(0, 100)); await sleep(1200)
  e = await ev('k_baglanov')
  console.log('ОМ:', e.stage, '| объекты:', JSON.stringify(e.visitObjects.map(v => [v.id, v.stage])))
  await shot(page, 'baglanov-conduct', true)
  await close()
}
