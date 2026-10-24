import { api } from './walk.mjs'
const r = await api('acc_admin', 'GET', '/api/ops/personnel/?page_size=300')
console.log('status', r.status, 'count', r.body?.count ?? r.body?.results?.length)
const rows = r.body.results
console.log('fields:', Object.keys(rows[0]).join(','))
const d1 = rows.filter(x => /Первый департамент/.test(JSON.stringify(x)) )
for (const x of rows.filter(x => [20,21,22,23,162,163,164].includes(Number(x.id)))) console.log('KEY', x.id, x.name ?? x.fullName, '|', x.unit ?? x.division ?? x.divisionName, '| divId', x.divisionId, '| acct', x.hasAccount ?? x.userId ?? x.username)
console.log('--- по Первому управлению (divisionId 632):')
for (const x of rows.filter(x => String(x.divisionId) === '632' || /Первое управление/.test(String(x.unit)))) console.log(x.id, x.name ?? x.fullName, '|', x.unit, '| acct', x.hasAccount ?? x.userId ?? x.username, '| rating', x.aggregateRating)
