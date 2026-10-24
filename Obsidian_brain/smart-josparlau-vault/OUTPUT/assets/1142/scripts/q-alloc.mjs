import fs from 'node:fs'
import { api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
const fc = await api('y_meiram', 'GET', `/api/ops/security-events/${run.eventId}/force-collection/`)
console.log('allocations:', JSON.stringify(fc.body.allocations?.map(a => ({ id: a.id, dep: a.departmentName ?? a.departmentId, need: a.need, sentAt: a.sentAt, dueAt: a.dueAt, status: a.status, groupDemands: a.groupDemands?.map(g => [g.kindCode ?? g.kind, g.need]) }))))
const a = fc.body.allocations?.[0]
if (a?.sentAt) fs.writeFileSync('run.json', JSON.stringify({ ...run, allocationId: a.id }, null, 2))
