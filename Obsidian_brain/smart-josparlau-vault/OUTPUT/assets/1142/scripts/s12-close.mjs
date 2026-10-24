import fs from 'node:fs'
import { open, shot, sleep, api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
const ev = async (who) => (await api(who, 'GET', `/api/ops/security-events/${run.eventId}/`)).body
const plan = [['u_musakhan', 0, '8', 'Проходка №1142: пост держал уверенно, замечание по связи устранил сам'], ['m_turmagambetov', 1, '9', 'Проходка №1142: въезд контролировал без замечаний']]
for (const [who, idx, score, comment] of plan) {
  const V = run.visits[idx].id
  const { page, close } = await open(who)
  await page.goto(`http://localhost:3106/security-ops/events/${run.eventId}?visit=${V}`); await page.waitForLoadState('networkidle'); await sleep(1500)
  const panel = page.locator('[data-slot="evaluation-panel"]')
  console.log(who, '| панель оценок:', await panel.count(), (await panel.innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 400))
  await shot(page, `${who.replace('_', '-')}-conduct-start`, true)
  // индивидуальная оценка: ищем селект/кнопки шкалы у сотрудника
  const scoreCtl = panel.getByRole('combobox').or(panel.getByRole('spinbutton')).or(panel.getByRole('button', { name: new RegExp(`^${score}$`) }))
  console.log('  элементов оценки:', await scoreCtl.count(), '| кнопки панели:', (await panel.getByRole('button').allInnerTexts()).join(' | ').slice(0, 200))
  const rowBtn = panel.getByRole('button', { name: /Оценить|Поставить оценку|Байжанов|Есимов/ })
  if (await rowBtn.count()) { await rowBtn.first().click(); await sleep(500) }
  const d = page.getByRole('dialog')
  if (await d.count()) {
    console.log('  окно оценки:', (await d.innerText()).replace(/\n+/g, ' | ').slice(0, 300))
    const sb = d.getByRole('button', { name: new RegExp(`^${score}$`) }); const cb = d.getByRole('combobox'); const nb = d.getByRole('spinbutton')
    if (await sb.count()) await sb.first().click(); else if (await cb.count()) await cb.first().selectOption(score); else if (await nb.count()) await nb.first().fill(score)
    const ta = d.getByRole('textbox'); if (await ta.count()) await ta.last().fill(comment)
    await shot(page, `${who.replace('_', '-')}-score-dialog`)
    const rp = page.waitForResponse(x => /evaluat|score/.test(x.url()) && x.request().method() === 'POST')
    await d.getByRole('button', { name: /Сохранить|Оценить|Подтвердить/ }).last().click(); const r = await rp; console.log('  POST оценка', r.url().replace(/^.*\/api/, '/api'), r.status(), (await r.text()).slice(0, 100)); await sleep(800)
  } else console.log('  окна оценки нет — шкала прямо в панели?')
  console.log('  прогресс:', (await page.locator('[data-slot="evaluation-progress"]').innerText().catch(() => '—')))
  // инцидент
  const inc = page.locator('[data-slot="incidents-panel"]')
  await inc.getByRole('button', { name: '+ Добавить', exact: true }).click(); await sleep(400)
  const form = inc.locator('[data-slot="incident-form"]')
  await form.getByLabel('Время', { exact: true }).fill(`${run.date}T11:00`)
  const postSel = form.getByLabel('Пост', { exact: true }); console.log('  посты инцидента:', (await postSel.locator('option').allTextContents()).join(' | '))
  await postSel.selectOption({ index: 1 })
  await form.getByLabel('Описание *', { exact: true }).fill(`Проходка №1142: проверка связи на объекте ${idx + 1}`)
  await form.getByLabel('Принятые меры', { exact: true }).fill('Связь со старшим подтверждена')
  await shot(page, `${who.replace('_', '-')}-incident-form`, true)
  await form.getByRole('button', { name: 'Записать инцидент', exact: true }).click(); await sleep(800)
  // закрыть объект
  const closeBtn = page.getByRole('button', { name: 'Закрыть объект', exact: true })
  console.log('  «Закрыть объект»:', await closeBtn.count(), await closeBtn.count() ? await closeBtn.isEnabled() : '')
  await closeBtn.click(); await sleep(500)
  const cd = page.getByRole('dialog')
  console.log('  окно закрытия:', (await cd.innerText()).replace(/\n+/g, ' | ').slice(0, 300))
  const ta = cd.getByRole('textbox'); if (await ta.count()) await ta.first().fill(`Проходка №1142: объект ${idx + 1} отработан без происшествий`)
  await shot(page, `${who.replace('_', '-')}-close-dialog`)
  const rp = page.waitForResponse(x => /close/.test(x.url()) && x.request().method() === 'POST')
  await cd.getByRole('button', { name: /Закрыть объект|Подтвердить/ }).last().click(); const r = await rp; console.log('  POST close', r.status(), (await r.text()).slice(0, 100)); await sleep(1200)
  const e = await ev(who)
  console.log('  объект:', e.visitObjects[idx].stage, '| ОМ:', e.stage)
  await shot(page, `${who.replace('_', '-')}-object-closed`, true)
  await close()
}
const e = await ev('y_meiram')
console.log('ИТОГ: ОМ', e.stage, e.statusLabel, '| объекты:', JSON.stringify(e.visitObjects.map(v => [v.id, v.stage, v.closedAt?.slice(0, 16)])), '| оценки:', JSON.stringify(e.evaluations ?? e.evaluationSummary ?? null)?.slice(0, 200))
