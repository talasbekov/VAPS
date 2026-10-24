import fs from 'node:fs'
import { api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
const e = (await api('y_meiram', 'GET', `/api/ops/security-events/${run.eventId}/`)).body
console.log('журнал:', JSON.stringify(e.journalEntries?.map(j => [j.type, j.title?.slice(0, 50), j.postId?.slice(-6)])))
console.log('закрытие объектов:', JSON.stringify(e.visitObjects.map(v => [v.id, v.closingComment?.slice(0, 40), v.closureSummary])))
const reg = await api('acc_admin', 'GET', '/api/ops/evaluation-registry/?employee=20')
console.log('реестр оценок Байжанова (admin):', reg.status, JSON.stringify(reg.body).slice(0, 300))
const sc = await api('u_musakhan', 'POST', `/api/ops/security-events/${run.eventId}/evaluations/score/`, { visitObjectId: run.visits[0].id, employeeId: '20', score: 8, comment: 'после закрытия' })
console.log('оценка после закрытия:', sc.status, JSON.stringify(sc.body).slice(0, 200))
const my = await api('y_talasbekov', 'GET', '/api/ops/security-events/my-assignments/')
console.log('my-assignments Байжанова:', my.status, JSON.stringify(my.body).slice(0, 300))
const hist = await api('y_talasbekov', 'GET', '/api/ops/security-events/my-history/')
console.log('my-history:', hist.status, JSON.stringify(hist.body).slice(0, 300))
