import fs from 'node:fs'
import { open, shot, sleep, api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
const V = run.visits[0].id
const url = `http://localhost:3106/security-ops/events/${run.eventId}?visit=${V}`
const state = async (who) => { const e = (await api(who, 'GET', `/api/ops/security-events/${run.eventId}/`)).body; const v = e.visitObjects.find(x => x.id === V); return { e, v } }
// 1) второй подписант пытается подписать раньше первого
{
  const { page, close } = await open('a_rakhymzhanov')
  await page.goto(url); await page.waitForLoadState('networkidle'); await sleep(1500)
  const region = page.getByRole('region', { name: 'Согласование расстановки', exact: true })
  console.log('a_rakhymzhanov видит регион:', await region.count())
  const myRow = page.getByRole('row').filter({ hasText: 'a_rakhymzhanov' })
  console.log('строка второго подписанта:', await myRow.count(), '| кнопки:', (await myRow.getByRole('button').allInnerTexts()).join('|'), '| текст:', (await myRow.innerText().catch(() => '')).replace(/\n+/g, ' · ').slice(0, 200))
  await shot(page, 'rakhymzhanov-before-first-signature', true)
  const r = await api('a_rakhymzhanov', 'GET', `/api/ops/security-events/${run.eventId}/`)
  const route = r.body.visitObjects.find(x => x.id === V).approvalRoute
  const second = route[1]
  const dec = await api('a_rakhymzhanov', 'POST', `/api/ops/security-events/${run.eventId}/approval/route/${second.id}/decide/`, { decision: 'APPROVED', comment: '', visitObjectId: V })
  console.log('попытка второй подписи раньше первой (API):', dec.status, JSON.stringify(dec.body).slice(0, 160))
  await close()
}
// 2) первый согласующий возвращает с двумя замечаниями
{
  const { page, close } = await open('m_turmagambetov')
  await page.goto(url); await page.waitForLoadState('networkidle'); await sleep(1500)
  const row = page.getByRole('row').filter({ hasText: 'учётка m_turmagambetov' })
  console.log('строка первого подписанта:', await row.count(), '| кнопки:', (await row.getByRole('button').allInnerTexts()).join('|'))
  await shot(page, 'turmagambetov-approval-pending', true)
  await row.getByRole('button', { name: 'Вернуть', exact: true }).click(); await sleep(500)
  const d = page.getByRole('dialog')
  console.log('окно возврата:', (await d.innerText()).replace(/\n+/g, ' | ').slice(0, 400))
  await d.getByLabel('Общая причина *', { exact: true }).fill('Проходка №1142: уточнить действия при недоборе и запись по посту периметра')
  for (const n of [1, 2]) {
    await d.getByRole('button', { name: '+ Замечание', exact: true }).click()
    await d.getByLabel(`Текст замечания ${n}`, { exact: true }).fill(n === 1 ? 'Проходка №1142: описать порядок усиления поста КПП' : 'Проходка №1142: дописать в комментарий поста 1 позывной старшего')
  }
  const postSel = d.getByLabel('Пост замечания 2', { exact: true })
  console.log('посты для замечания:', (await postSel.locator('option').allTextContents()).join(' | '))
  await postSel.selectOption({ index: 1 })
  const urgent = d.getByRole('checkbox', { name: /Срочно/ }).or(d.getByLabel(/Срочно/))
  console.log('флаг «Срочно»:', await urgent.count())
  if (await urgent.count()) await urgent.first().check().catch(() => {})
  await shot(page, 'turmagambetov-return-dialog', true)
  const rp = page.waitForResponse(x => /approval\/(return|route)/.test(x.url()) && x.request().method() === 'POST')
  await d.getByRole('button', { name: 'Подтвердить возврат', exact: true }).click()
  const r = await rp; console.log('POST return', r.status(), (await r.text()).slice(0, 100)); await sleep(1200)
  const { v } = await state('m_turmagambetov')
  console.log('после возврата:', v.stage, v.approvalStatus, 'v', v.documentVersion, '| замечания:', JSON.stringify(v.approvalRemarks?.map(x => [x.id?.slice(-4), x.status, x.urgent, x.postId?.slice(-6)])), '| маршрут:', JSON.stringify(v.approvalRoute?.map(x => [x.username, x.status])))
  await shot(page, 'turmagambetov-returned', true)
  await close()
}
// 3) старший объекта исправляет и отправляет повторно
{
  const { page, close } = await open('u_musakhan')
  await page.goto(url); await page.waitForLoadState('networkidle'); await sleep(1500)
  await shot(page, 'musakhan-after-return', true)
  const t = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  const k = t.indexOf('Замечани'); console.log('замечания на экране:', t.slice(k, k + 500))
  // правка комментария к посту 1
  const post1 = page.getByRole('button', { name: /Пост 1/ }).first(); if (await post1.count()) await post1.click()
  const comment = page.getByRole('textbox', { name: 'Комментарий к посту', exact: true })
  if (await comment.count()) { await comment.fill('Проходка №1142: старший поста — позывной «Гранит-1»; при недоборе усиление от КПП'); await page.getByRole('button', { name: 'Сохранить', exact: true }).click(); await sleep(800) }
  // замечания: одно «Устранено», второе — «Не согласен» с ответом
  const resolved = page.getByRole('button', { name: 'Устранено', exact: true })
  const disagree = page.getByRole('button', { name: /Не согласен/ })
  console.log('кнопок «Устранено»:', await resolved.count(), '| «Не согласен»:', await disagree.count())
  if (await disagree.count()) {
    await disagree.first().click(); await sleep(400)
    const dd = page.getByRole('dialog')
    if (await dd.count()) { console.log('окно несогласия:', (await dd.innerText()).replace(/\n+/g, ' | ').slice(0, 200)); const ta = dd.getByRole('textbox'); if (await ta.count()) await ta.first().fill('Проходка №1142: позывной старшего поста в бланке не печатается — указан в комментарии поста'); await dd.getByRole('button', { name: /Отправить|Сохранить|Подтвердить/ }).last().click(); await sleep(800) }
  }
  while (await resolved.count()) { const c = await resolved.count(); await resolved.first().click(); await sleep(600); if (await resolved.count() === c) break }
  await shot(page, 'musakhan-remarks-answered', true)
  const fin = page.getByRole('button', { name: 'Завершить расстановку', exact: true })
  console.log('«Завершить расстановку»:', await fin.count())
  if (await fin.count()) {
    await fin.click(); await sleep(600)
    const sh = page.getByRole('dialog'); const ov = sh.getByRole('button', { name: 'Подтвердить оверрайд', exact: true })
    if (await ov.count()) { await sh.getByRole('textbox').fill('Проходка №1142, версия 2: недобор КПП сохраняется до усиления'); await ov.click(); await sleep(1000) }
  }
  const send = page.getByRole('button', { name: 'Отправить на согласование', exact: true })
  console.log('«Отправить на согласование»:', await send.count(), await send.count() ? await send.isEnabled() : '')
  const rp = page.waitForResponse(x => /approval\/send/.test(x.url()) && x.request().method() === 'POST')
  await send.click(); const r = await rp; console.log('POST send v2', r.status(), (await r.text()).slice(0, 100)); await sleep(1200)
  const { v } = await state('u_musakhan')
  console.log('v2:', v.stage, v.documentStatus, 'v', v.documentVersion, '| версии:', JSON.stringify(v.documentVersions?.map(x => [x.number, x.status])), '| замечания:', JSON.stringify(v.approvalRemarks?.map(x => [x.status, x.answer ?? x.reply])), '| маршрут:', JSON.stringify(v.approvalRoute?.map(x => [x.username, x.status])))
  await shot(page, 'musakhan-v2-sent', true)
  await close()
}
