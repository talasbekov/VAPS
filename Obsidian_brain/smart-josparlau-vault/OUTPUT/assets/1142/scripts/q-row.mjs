import fs from 'node:fs'
import { open, sleep } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
const { page, close } = await open('u_musakhan')
await page.goto(`http://localhost:3106/security-ops/events?search=${encodeURIComponent('Проходка №1142')}`)
await page.waitForLoadState('networkidle'); await sleep(1000)
const row = page.getByRole('row').filter({ hasText: run.code })
console.log('rows', await row.count())
for (const b of await row.getByRole('button').all()) console.log('btn:', JSON.stringify(await b.getAttribute('aria-label')), '|', (await b.innerText()).replace(/\n/g,' ').slice(0,60))
console.log('links:', (await row.getByRole('link').allInnerTexts()).join(' | '))
await close()
