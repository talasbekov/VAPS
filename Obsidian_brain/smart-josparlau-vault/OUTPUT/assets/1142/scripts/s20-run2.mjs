import fs from 'node:fs'
import { open, shot, sleep, api } from './walk.mjs'
const R = fs.existsSync('run2.json') ? JSON.parse(fs.readFileSync('run2.json', 'utf8')) : { date: '2026-10-12', stage: 0 }
const save = (patch) => { Object.assign(R, patch); fs.writeFileSync('run2.json', JSON.stringify(R, null, 2)) }
const ev = async (who) => (await api(who, 'GET', `/api/ops/security-events/${R.eventId}/`)).body
const idxOf = async (who, surname, id) => (await api(who, 'GET', '/api/ops/personnel/?search=' + encodeURIComponent(surname) + '&page_size=50')).body.results.findIndex(x => String(x.id) === id)
const APP = 'http://localhost:3106'
async function stage(n, name, fn) { if (R.stage >= n) return; console.log(`\n== ${n}. ${name}`); await fn(); save({ stage: n }) }

await stage(1, 'u_musakhan создаёт ОМ-2', async () => {
  const { page, close } = await open('u_musakhan')
  await page.goto(`${APP}/security-ops/events/`); await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
  const d = page.getByRole('dialog')
  await d.getByRole('button', { name: 'Внутреннее', exact: true }).click()
  await d.getByLabel('Дата начала').fill(R.date); await d.getByLabel('Дата окончания').fill(R.date); await d.getByLabel('Время', { exact: true }).fill('09:00')
  await d.getByLabel('Охраняемые лица').click(); await d.getByLabel('Охраняемые лица').fill('OL-2'); await sleep(700)
  await d.getByRole('listbox').getByRole('option').filter({ hasText: /^OL-2(?!\d)/ }).first().getByRole('button').click()
  await d.getByLabel('Название ОМ').fill('Проходка №1142 — второй ОМ (оценки)')
  const chief = d.getByLabel('Старший наряда'); await chief.first().click(); await chief.first().fill('Оралбаев'); await sleep(900)
  const idx = await idxOf('u_musakhan', 'Оралбаев', '162'); await d.getByRole('button', { name: /Оралбаев/ }).nth(idx).click()
  await sleep(400); await shot(page, 'r2-create')
  await d.getByRole('button', { name: 'Создать бюллетень', exact: true }).click()
  await page.waitForURL(/\/security-ops\/events\/\d+/, { timeout: 20000 })
  const id = new URL(page.url()).pathname.split('/').filter(Boolean).at(-1)
  const e = (await api('u_musakhan', 'GET', `/api/ops/security-events/${id}/`)).body
  console.log('создано', id, e.code, 'chief', e.chiefEmployeeId); save({ eventId: id, code: e.code })
  await close()
})
await stage(2, 'k_baglanov: объект, старший объекта, рекогносцировка открыта', async () => {
  const { page, close } = await open('k_baglanov')
  await page.goto(`${APP}/security-ops/events?search=${encodeURIComponent('второй ОМ (оценки)')}`); await page.waitForLoadState('networkidle'); await sleep(800)
  const row = page.getByRole('row').filter({ hasText: R.code }).first()
  await row.getByRole('button', { name: `Действия ${R.code}` }).click(); await sleep(300)
  await page.getByRole('menuitem', { name: /Добавить объект/ }).click(); await sleep(800)
  const d = page.getByRole('dialog'); await d.getByRole('checkbox', { name: /Стенд: объект с готовым паспортом/ }).check()
  await d.getByRole('button', { name: /^Добавить \(1\)$/ }).click(); await sleep(1200)
  await page.goto(`${APP}/security-ops/events?search=${encodeURIComponent('второй ОМ (оценки)')}`); await page.waitForLoadState('networkidle'); await sleep(800)
  const row2 = page.getByRole('row').filter({ hasText: R.code }).first()
  const exp = row2.getByRole('button', { name: /^Развернуть объекты/ }); if (await exp.count()) { await exp.click(); await sleep(800) }
  await page.getByRole('button', { name: 'Назначить старшего объекта Стенд: объект с готовым паспортом', exact: true }).click()
  const dd = page.getByRole('dialog'); await dd.getByLabel('Поиск сотрудника').fill('Тасмагамбетов'); await sleep(900)
  const idx = await idxOf('k_baglanov', 'Тасмагамбетов', '164'); await dd.getByRole('button', { name: /Тасмагамбетов/ }).nth(idx).click()
  await dd.getByRole('button', { name: 'Назначить', exact: true }).click(); await sleep(800)
  await page.goto(`${APP}/security-ops/events/${R.eventId}/`); await page.waitForLoadState('networkidle'); await sleep(800)
  await page.getByRole('button', { name: 'Открыть рекогносцировку', exact: true }).click(); await sleep(1200)
  const e = await ev('k_baglanov'); console.log('объекты:', JSON.stringify(e.visitObjects.map(v => [v.id, v.stage, v.chiefEmployeeId]))); save({ visitId: e.visitObjects[0].id })
  await shot(page, 'r2-objects'); await close()
})
await stage(3, 'u_musakhan: рекогносцировка (3 поста физнаряда по 1)', async () => {
  const { page, close } = await open('u_musakhan')
  await page.goto(`${APP}/security-ops/events/${R.eventId}?visit=${R.visitId}`); await page.waitForLoadState('networkidle'); await sleep(1000)
  const st = page.getByRole('region', { name: 'Рекогносцировка объекта' })
  await st.getByRole('button', { name: 'Импорт из паспорта', exact: true }).click(); await sleep(1200)
  for (const item of await st.locator('[data-slot="recon-check-item"]').all()) await item.getByRole('button', { name: 'Норма', exact: true }).click()
  const posts = await st.getByLabel('Пост', { exact: true }).evaluateAll(i => i.map(x => x.value))
  for (let i = 0; i < posts.length; i++) {
    await st.getByLabel('Потребность', { exact: true }).nth(i).fill('1')
    await st.getByLabel(`Подробнее: ${posts[i]}`, { exact: true }).click()
    await st.getByLabel(`Вид потребности: ${posts[i]}`, { exact: true }).selectOption('PHYSICAL_SQUAD')
    await st.getByLabel(`Спецификация потребности: ${posts[i]}`, { exact: true }).fill('Охрана')
  }
  await st.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click(); await sleep(900)
  await st.getByRole('button', { name: 'Завершить рекогносцировку →', exact: true }).click(); await sleep(400)
  await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click(); await sleep(1200)
  const e = await ev('u_musakhan'); console.log('объект:', e.visitObjects[0].stage, 'need', e.visitObjects[0].reconForceRequest)
  await shot(page, 'r2-recon-done'); await close()
})
await stage(4, 'y_meiram: запрос 3 у Первого департамента + распределение', async () => {
  const { page, close } = await open('y_meiram')
  await page.goto(`${APP}/employees?collection=${R.eventId}&businessDate=${R.date}`); await page.waitForLoadState('networkidle'); await sleep(1000)
  await page.getByRole('main').getByRole('button', { name: 'Департамент', exact: true }).click(); await sleep(300)
  await page.getByLabel('Департамент, строка 1', { exact: true }).selectOption('631')
  await page.getByLabel('Сколько человек, строка 1', { exact: true }).fill('3')
  await page.getByRole('button', { name: 'Отправить запросы', exact: true }).click(); await sleep(400)
  await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click(); await sleep(1500)
  const fc = (await api('y_meiram', 'GET', `/api/ops/security-events/${R.eventId}/force-collection/`)).body
  const a = fc.allocations[0]; console.log('заявка:', a.id, a.need, !!a.sentAt); save({ allocationId: a.id })
  await page.goto(`${APP}/employees?view=forces&businessDate=${R.date}`); await page.waitForLoadState('networkidle'); await sleep(800)
  await page.getByRole('button', { name: 'Новое распределение', exact: true }).click(); await sleep(300)
  await page.getByLabel('Название', { exact: true }).fill('Проходка №1142 — распределение 2')
  await page.getByRole('checkbox', { name: new RegExp(R.code) }).first().check()
  await page.getByRole('button', { name: 'Создать распределение', exact: true }).click(); await page.waitForURL(/campaign=/, { timeout: 15000 })
  save({ campaignId: new URL(page.url()).searchParams.get('campaign') }); console.log('кампания', R.campaignId)
  await shot(page, 'r2-campaign'); await close()
})
await stage(5, 'a_raiymzhanov: ответ 1 из 3, квота управлению, отправка', async () => {
  const { page, close } = await open('a_raiymzhanov')
  await page.goto(`${APP}/employees?request=${encodeURIComponent(R.allocationId)}&businessDate=${R.date}`); await page.waitForLoadState('networkidle'); await sleep(1200)
  await page.locator('#answer-allocating').fill('1'); await page.locator('#answer-comment').fill('Проходка №1142-2: остальные на дежурстве')
  await page.getByRole('button', { name: 'Сохранить ответ', exact: true }).click(); await sleep(900)
  await page.locator('#quota-632').fill('1')
  const sq = page.getByRole('button', { name: 'Сохранить раскладку', exact: true }); if (await sq.count()) { await sq.click(); await sleep(700) }
  await page.getByRole('button', { name: 'Отправить в управления', exact: true }).click(); await sleep(400)
  await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click(); await sleep(1200)
  await shot(page, 'r2-responsible-sent'); await close()
})
await stage(6, 'n_meldebekov: Байжанов в резерв', async () => {
  const { page, close } = await open('n_meldebekov')
  await page.goto(`${APP}/statuses?forcesRequest=${encodeURIComponent(R.allocationId)}`); await page.waitForLoadState('networkidle'); await sleep(1200)
  const banner = page.getByRole('status', { name: `Запрос на ${R.code}`, exact: true })
  await page.getByPlaceholder('Поиск по ФИО, отделу, должности...').fill('Байжанов'); await sleep(900)
  await page.getByRole('row').filter({ hasText: 'Байжанов' }).first().getByRole('checkbox').check()
  await banner.getByRole('button', { name: /Добавить в общий резерв/ }).first().click(); await sleep(1200)
  console.log('отчёт:', await banner.locator('[data-slot="select-report"]').innerText().catch(() => '—'))
  await shot(page, 'r2-head-selected'); await close()
})
await stage(7, 'a_raiymzhanov: список в штаб', async () => {
  const { page, close } = await open('a_raiymzhanov')
  await page.goto(`${APP}/employees?request=${encodeURIComponent(R.allocationId)}&businessDate=${R.date}`); await page.waitForLoadState('networkidle'); await sleep(1500)
  await page.getByRole('button', { name: 'Отправить список в штаб', exact: true }).click(); await sleep(400)
  await page.getByRole('dialog').getByRole('button', { name: 'Отправить', exact: true }).click(); await sleep(1200)
  const a = (await api('a_raiymzhanov', 'GET', `/api/ops/security-events/forces/requests/${encodeURIComponent(R.allocationId)}/`)).body.allocation
  console.log('submitted:', !!a.submittedAt, a.members?.length); await close()
})
await stage(8, 'y_meiram: назначение и передача', async () => {
  const { page, close } = await open('y_meiram')
  await page.goto(`${APP}/employees?campaign=${R.campaignId}&businessDate=${R.date}`); await page.waitForLoadState('networkidle'); await sleep(1200)
  const c = (await api('y_meiram', 'GET', `/api/ops/security-events/forces/campaigns/${R.campaignId}/`)).body; const e = c.events[0]
  await page.getByLabel('Сотрудник', { exact: true }).selectOption('20'); await page.getByLabel('Мероприятие', { exact: true }).selectOption(e.eventId)
  await page.getByLabel('Объект', { exact: true }).selectOption(R.visitId); await page.getByLabel('Строка потребности', { exact: true }).selectOption(e.demandRows[0].id)
  await page.getByRole('button', { name: 'Назначить', exact: true }).click(); await sleep(1000)
  await page.reload(); await page.waitForLoadState('networkidle'); await sleep(800)
  await page.getByLabel('Комментарий при неполном распределении', { exact: true }).fill('Проходка №1142-2: выделен один из трёх')
  await page.getByRole('button', { name: 'Передать в расстановку', exact: true }).click(); await sleep(1500)
  console.log('кампания:', (await api('y_meiram', 'GET', `/api/ops/security-events/forces/campaigns/${R.campaignId}/`)).body.status)
  await shot(page, 'r2-handover'); await close()
})
await stage(9, 'u_musakhan: расстановка, снять 2 пустых поста, завершить, согласующий, отправить', async () => {
  const { page, close } = await open('u_musakhan')
  await page.goto(`${APP}/security-ops/events/${R.eventId}?visit=${R.visitId}`); await page.waitForLoadState('networkidle'); await sleep(1500)
  await page.getByRole('button', { name: 'Распределить автоматически', exact: true }).click(); await sleep(600)
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить распределение', exact: true }).click(); await sleep(1200)
  for (const p of ['Пост 2', 'Пост 3']) {
    const b = page.getByRole('button', { name: new RegExp(`Снять пост.*${p}`) }); if (!(await b.count())) continue
    await b.first().click(); await sleep(400); await page.getByRole('dialog').getByRole('button', { name: /Снять/ }).last().click(); await sleep(900)
  }
  await page.getByRole('button', { name: 'Завершить расстановку', exact: true }).click(); await sleep(800)
  const sh = page.getByRole('dialog'); if (await sh.count()) { const ov = sh.getByRole('button', { name: 'Подтвердить оверрайд', exact: true }); if (await ov.count()) { await sh.getByRole('textbox').fill('Проходка №1142-2: недобор'); await ov.click() } }
  await sleep(1200)
  const sel = page.getByRole('combobox', { name: 'Выберите согласующего из руководства второго департамента', exact: true })
  await sel.selectOption({ label: (await sel.locator('option').allTextContents()).find(o => /m_turmagambetov/.test(o)) })
  await page.getByRole('button', { name: 'Назначить первым согласующим', exact: true }).click(); await sleep(900)
  await page.getByRole('button', { name: 'Отправить на согласование', exact: true }).click(); await sleep(1200)
  const e = await ev('u_musakhan'); console.log('объект:', e.visitObjects[0].stage, e.visitObjects[0].documentStatus, JSON.stringify(e.placementAssignments?.map(a => a.employeeId)))
  await shot(page, 'r2-sent-approval'); await close()
})
await stage(10, 'подписи m_turmagambetov → a_rakhymzhanov', async () => {
  for (const who of ['m_turmagambetov', 'a_rakhymzhanov']) {
    const { page, close } = await open(who)
    await page.goto(`${APP}/security-ops/events/${R.eventId}?visit=${R.visitId}`); await page.waitForLoadState('networkidle'); await sleep(1500)
    await page.getByRole('row').filter({ hasText: `учётка ${who}` }).getByRole('button', { name: 'Согласовать', exact: true }).click(); await sleep(1500)
    const e = await ev(who); console.log(who, '→', e.visitObjects[0].stage, e.visitObjects[0].documentStatus); await close()
  }
})
await stage(11, 'y_talasbekov ознакомлен, k_baglanov завершает', async () => {
  { const { page, close } = await open('y_talasbekov')
    await page.goto(`${APP}/security-ops/profile`); await page.waitForLoadState('networkidle'); await sleep(1500)
    const item = page.getByRole('listitem').filter({ hasText: 'второй ОМ (оценки)' })
    await item.first().getByRole('button', { name: 'Ознакомлен, заступлю', exact: true }).click(); await sleep(1200)
    await shot(page, 'r2-self-ack'); await close() }
  { const { page, close } = await open('k_baglanov')
    await page.goto(`${APP}/security-ops/events/${R.eventId}/`); await page.waitForLoadState('networkidle'); await sleep(1500)
    await page.getByRole('button', { name: 'Завершить ознакомление', exact: true }).click(); await sleep(1500)
    const e = await ev('k_baglanov'); console.log('ОМ:', e.stage); await close() }
})
await stage(12, 'u_musakhan: оценка 8 + комментарий, закрытие', async () => {
  const { page, close } = await open('u_musakhan')
  await page.goto(`${APP}/security-ops/events/${R.eventId}?visit=${R.visitId}`); await page.waitForLoadState('networkidle'); await sleep(1500)
  const panel = page.locator('[data-slot="evaluation-panel"]')
  const rp = page.waitForResponse(x => /evaluat|score|conduct/.test(x.url()) && x.request().method() === 'POST')
  await panel.getByRole('button', { name: '8', exact: true }).first().click()
  const r = await rp; console.log('оценка POST', r.url().replace(/^.*\/api/, '/api'), r.status(), (await r.text()).slice(0, 120)); await sleep(1000)
  console.log('прогресс:', await page.locator('[data-slot="evaluation-progress"]').innerText().catch(() => '—'), '| панель:', (await panel.innerText()).replace(/\n+/g, ' | ').slice(0, 300))
  const cm = panel.getByRole('textbox'); if (await cm.count()) { await cm.first().fill('Проходка №1142-2: пост держал уверенно'); await cm.first().press('Tab'); await sleep(800) }
  await shot(page, 'r2-scored', true)
  await page.getByRole('button', { name: 'Закрыть объект', exact: true }).click(); await sleep(500)
  const cd = page.getByRole('dialog'); console.log('окно закрытия:', (await cd.innerText()).replace(/\n+/g, ' | ').slice(0, 200))
  await cd.getByRole('button', { name: /Подтвердить закрытие/ }).click(); await sleep(1500)
  const e = await ev('u_musakhan'); console.log('ОМ:', e.stage, '| объект:', e.visitObjects[0].stage)
  await shot(page, 'r2-closed', true); await close()
})
await stage(13, 'проверка: реестр оценок, профиль сотрудника (История), аналитика мероприятий', async () => {
  const reg = await api('acc_admin', 'GET', '/api/ops/evaluation-registry/?employee=20')
  console.log('реестр (admin):', reg.status, JSON.stringify(reg.body.results?.filter(r => r.eventNumber === R.code).map(r => [r.eventNumber, r.score, r.aggregateRating, r.evaluatedAt?.slice(0, 16), r.participated]))?.slice(0, 300))
  { const { page, close } = await open('y_talasbekov')
    await page.goto(`${APP}/security-ops/profile`); await page.waitForLoadState('networkidle'); await sleep(1500)
    console.log('шапка:', (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ').slice(0, 350))
    await page.getByRole('tab', { name: 'История', exact: true }).click(); await sleep(1200)
    const t = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | '); const k = t.indexOf('История'); console.log('История:', t.slice(k, k + 600))
    await shot(page, 'r2-profile-history', true); await close() }
  for (const who of ['n_meldebekov', 'acc_admin']) {
    const { page, close } = await open(who)
    await page.goto(`${APP}/security-ops/profile/20`); await page.waitForLoadState('networkidle'); await sleep(1500)
    console.log(who, 'видит профиль Байжанова:', (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ').slice(0, 300))
    await shot(page, `r2-${who.replace('_', '-')}-sees-profile-20`, true); await close()
  }
  { const { page, close } = await open('acc_admin')
    await page.goto(`${APP}/security-ops/analytics`); await page.waitForLoadState('networkidle'); await sleep(2000)
    await page.getByRole('tab', { name: /Аналитика мероприятий/ }).or(page.getByRole('button', { name: /Аналитика мероприятий/ })).first().click(); await sleep(2500)
    const t = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
    console.log('Аналитика мероприятий:', t.slice(0, 500)); const k = t.indexOf(R.code); console.log('ОМ-2 в аналитике:', k >= 0 ? t.slice(k - 30, k + 300) : 'НЕТ')
    await shot(page, 'r2-admin-event-analytics', true)
    await page.getByRole('tab', { name: /Аналитика рейтинга/ }).or(page.getByRole('button', { name: /Аналитика рейтинга/ })).first().click(); await sleep(2500)
    const t2 = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | '); console.log('Аналитика рейтинга:', t2.slice(t2.indexOf('Аналитика рейтинга'), t2.indexOf('Аналитика рейтинга') + 400))
    await shot(page, 'r2-admin-rating-analytics', true); await close() }
})
console.log('\nГОТОВО', JSON.stringify(R))
