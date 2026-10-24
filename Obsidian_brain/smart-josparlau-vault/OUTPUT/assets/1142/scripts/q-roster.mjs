import fs from 'node:fs'
import { api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
const e = (await api('y_meiram', 'GET', `/api/ops/security-events/${run.eventId}/`)).body
console.log('forceRoster:', JSON.stringify(e.forceRoster?.map(m => [m.employeeId, m.employeeName, m.kindCode, m.visitObjectId])))
console.log('посты:', JSON.stringify(e.reconSectorPosts?.map(p => [p.id?.slice(-6), p.visitObjectId, p.name, p.need, p.demandKindCode])))
console.log('объекты:', JSON.stringify(e.visitObjects.map(v => [v.id, v.stage, v.canManagePlacement])))
