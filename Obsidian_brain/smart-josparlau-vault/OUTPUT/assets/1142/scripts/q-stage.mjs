import fs from 'node:fs'
import { api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
const e = (await api('k_baglanov', 'GET', `/api/ops/security-events/${run.eventId}/`)).body
console.log('ОМ:', e.stage, '| объекты:', JSON.stringify(e.visitObjects.map(v => [v.id, v.stage])), '| ack:', JSON.stringify(e.placementAssignments?.map(a => [a.employeeId, a.acknowledgedVia])))
