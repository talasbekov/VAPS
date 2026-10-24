import fs from 'node:fs'
import { open, shot, sleep, api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
const V1 = run.visits[0].id, V2 = run.visits[1].id
const urlOf = (v) => `http://localhost:3106/security-ops/events/${run.eventId}?visit=${v}`
const state = async (who, V) => { const e = (await api(who, 'GET', `/api/ops/security-events/${run.eventId}/`)).body; return { e, v: e.visitObjects.find(x => x.id === V) } }
// A) замечания на этапе согласования (объект 1, старший)
{
  const { page, close } = await open('u_musakhan')
  await page.goto(urlOf(V1)); await page.waitForLoadState('networkidle'); await sleep(1500)
  const t = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  const k = t.indexOf('Замечания'); console.log('замечания (согласование):', t.slice(k, k + 400))
  const resolved = page.getByRole('button', { name: 'Устранено', exact: true })
  const disagree = page.getByRole('button', { name: /Не согласен/ })
  console.log('«Устранено»:', await resolved.count(), '| «Не согласен»:', await disagree.count(), '| все кнопки замечаний:', (await page.locator('[data-slot*="remark"]').getByRole('button').allInnerTexts().catch(() => [])).join('|'))
  await shot(page, 'musakhan-remarks-on-approval', true)
  if (await disagree.count()) {
    await disagree.first().click(); await sleep(400)
    const dd = page.getByRole('dialog')
    console.log('окно «Не согласен»:', (await dd.innerText().catch(() => 'нет диалога')).replace(/\n+/g, ' | ').slice(0, 200))
    const ta = dd.getByRole('textbox'); if (await ta.count()) await ta.first().fill('Проходка №1142: позывной в бланк не печатается — указан в комментарии поста')
    const ok = dd.getByRole('button', { name: /Отправить|Сохранить|Подтвердить|Ответить/ }).last(); if (await ok.count()) await ok.click(); await sleep(800)
  }
  let guard = 0
  while (await resolved.count() && guard++ < 3) { const rp = page.waitForResponse(x => /remark/.test(x.url()) && x.request().method() === 'POST'); await resolved.first().click(); const r = await rp; console.log('POST remark', r.url().replace(/^.*\/api/, '/api'), r.status()); await sleep(800) }
  const { v } = await state('u_musakhan', V1)
  console.log('замечания после:', JSON.stringify(v.approvalRemarks?.map(x => [x.status, x.answer ?? x.reply ?? x.resolution])), '| doc:', v.documentStatus, 'v', v.documentVersion)
  await shot(page, 'musakhan-remarks-resolved', true)
  await close()
}
// B) две подписи объекта 1
for (const who of ['m_turmagambetov', 'a_rakhymzhanov']) {
  const { page, close } = await open(who)
  await page.goto(urlOf(V1)); await page.waitForLoadState('networkidle'); await sleep(1500)
  const row = page.getByRole('row').filter({ hasText: `учётка ${who}` })
  const rp = page.waitForResponse(x => /decide/.test(x.url()) && x.request().method() === 'POST')
  await row.getByRole('button', { name: 'Согласовать', exact: true }).click()
  const r = await rp; console.log(who, 'POST decide', r.status(), (await r.text()).slice(0, 160)); await sleep(1200)
  const { v } = await state(who, V1)
  console.log('  объект 1:', v.stage, v.documentStatus, 'v', v.documentVersion, '| маршрут:', JSON.stringify(v.approvalRoute?.map(x => [x.username, x.status, x.signature?.versionNumber, x.signature?.name ?? x.signature?.fullName])))
  await shot(page, `${who.replace('_', '-')}-signed-object1`, true)
  await close()
}
// C) объект 2: старший m_turmagambetov выбирает k_baglanov, отправляет; подписи k_baglanov и a_rakhymzhanov
{
  const { page, close } = await open('m_turmagambetov')
  await page.goto(urlOf(V2)); await page.waitForLoadState('networkidle'); await sleep(1500)
  const sel = page.getByRole('combobox', { name: 'Выберите согласующего из руководства второго департамента', exact: true })
  const opts = await sel.locator('option').allTextContents(); console.log('кандидаты для объекта 2 (сам старший исключён?):', opts.join(' | '))
  await sel.selectOption({ label: opts.find(o => /k_baglanov/.test(o)) })
  await page.getByRole('button', { name: 'Назначить первым согласующим', exact: true }).click(); await sleep(1000)
  const rp = page.waitForResponse(x => /approval\/send/.test(x.url()) && x.request().method() === 'POST')
  await page.getByRole('button', { name: 'Отправить на согласование', exact: true }).click(); const r = await rp; console.log('объект 2 send', r.status()); await sleep(1000)
  await shot(page, 'turmagambetov-object2-sent', true)
  await close()
}
for (const who of ['k_baglanov', 'a_rakhymzhanov']) {
  const { page, close } = await open(who)
  await page.goto(urlOf(V2)); await page.waitForLoadState('networkidle'); await sleep(1500)
  const row = page.getByRole('row').filter({ hasText: `учётка ${who}` })
  const rp = page.waitForResponse(x => /decide/.test(x.url()) && x.request().method() === 'POST')
  await row.getByRole('button', { name: 'Согласовать', exact: true }).click()
  const r = await rp; console.log(who, 'объект 2 decide', r.status(), (await r.text()).slice(0, 120)); await sleep(1200)
  await shot(page, `${who.replace('_', '-')}-signed-object2`, true)
  await close()
}
const { e } = await state('y_meiram', V1)
console.log('ИТОГ: ОМ', e.stage, '| объекты:', JSON.stringify(e.visitObjects.map(v => [v.id, v.stage, v.documentStatus, v.documentVersion])))
