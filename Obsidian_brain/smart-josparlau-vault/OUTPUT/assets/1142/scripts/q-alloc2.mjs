import fs from 'node:fs'
import { api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
const a = (await api('a_raiymzhanov', 'GET', `/api/ops/security-events/forces/requests/${encodeURIComponent(run.allocationId)}/`)).body.allocation
console.log(JSON.stringify({ status: a.status, submittedAt: a.submittedAt, submittedLate: a.submittedLate, members: a.members?.map(m => [m.employeeId, m.employeeName ?? m.name, m.kindCode, m.roleCode]) }))
const c = await api('y_meiram', 'GET', `/api/ops/security-events/forces/campaigns/${run.campaignId}/`)
console.log('кампания:', c.body.status, 'pool:', JSON.stringify(c.body.pool?.map(p => [p.employeeId, p.employeeName, p.kindCode])), '| events[0].demandRows:', JSON.stringify(c.body.events?.[0]?.demandRows?.map(d => [d.id, d.visitObjectId, d.kindCode, d.need])), '| visitObjects:', JSON.stringify(c.body.events?.[0]?.visitObjects?.map(v => [v.visitObjectId, v.name ?? v.objectName])))
