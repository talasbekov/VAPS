import { api } from './walk.mjs'
const ev = await api('acc_admin', 'GET', '/api/ops/security-events/?page_size=500')
const dates = new Set()
for (const e of ev.body.results ?? []) { dates.add(e.businessDate); if (e.businessDateEnd) dates.add(e.businessDateEnd) }
console.log('events', ev.body.count ?? ev.body.results?.length, 'busy dates sample', [...dates].filter(d => d >= '2026-10-01').sort().slice(0, 40).join(' '))
const objs = await api('acc_admin', 'GET', '/api/ops/security-events/bindable-objects/')
for (const o of objs.body.results) console.log('OBJ', o.id, o.name, 'published', o.publishedVersionCount)
const ol = await api('acc_admin', 'GET', '/api/ops/protected-persons/?page_size=5')
console.log('OL status', ol.status, (ol.body.results ?? []).slice(0, 3).map(p => [p.id, p.name ?? p.fullName, p.code]))
