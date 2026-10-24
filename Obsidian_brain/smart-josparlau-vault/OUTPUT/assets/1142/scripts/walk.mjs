import fs from 'node:fs'
import path from 'node:path'
import { chromium, request } from '/home/erda/Музыка/Smart Josparlau/Backend/PersonnelStatus/PersonalRecordFront/node_modules/playwright/index.mjs'

export const APP = 'http://localhost:3106'
export const API = 'http://127.0.0.1:8100'
export const ASSETS = '/home/erda/Музыка/Obsidian_brain/smart-josparlau-vault/OUTPUT/assets/1142'
const PW = fs.readFileSync('/home/erda/.config/vaps/lan-accounts-password', 'utf8').trim()
export const LOG = path.join(ASSETS, 'api-log.jsonl')

export async function login(username) {
  const api = await request.newContext({ baseURL: APP })
  const { csrfToken } = await (await api.get('/api/auth/csrf/')).json()
  const res = await api.post('/api/auth/callback/credentials/', { form: { csrfToken, username, password: PW, json: 'true', redirect: 'false' } })
  if (!res.ok()) throw new Error(`login ${username}: HTTP ${res.status()}`)
  const session = await (await api.get('/api/auth/session/')).json()
  if (!session?.user?.name) throw new Error(`login ${username}: пустая сессия`)
  const state = await api.storageState()
  await api.dispose()
  return state
}

export async function open(username, { headless = true } = {}) {
  const browser = await chromium.launch({ headless })
  const state = await login(username)
  const context = await browser.newContext({ storageState: state, viewport: { width: 1600, height: 1000 }, locale: 'ru-RU' })
  const page = await context.newPage()
  page._who = username
  page.on('response', async (r) => {
    const u = r.url()
    if (!/\/api\//.test(u) || /\/api\/auth\//.test(u)) return
    const m = r.request().method()
    if (m === 'GET' && r.status() < 400) return
    let body = ''
    try { body = (await r.text()).slice(0, 600) } catch {}
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), who: username, m, u: u.replace(APP, '').replace(API, ''), s: r.status(), body }) + '\n')
  })
  page.on('pageerror', (e) => fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), who: username, pageerror: String(e).slice(0, 400) }) + '\n'))
  return { browser, context, page, close: () => browser.close() }
}

let n = fs.existsSync(ASSETS) ? fs.readdirSync(ASSETS).filter((f) => /^\d+-/.test(f)).length : 0
export async function shot(page, name, full = false) {
  n += 1
  const file = path.join(ASSETS, `${String(n).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file, fullPage: full })
  console.log('shot', path.basename(file))
  return file
}

export async function api(username, method, url, data) {
  const r = await fetch(`${API}/api/token/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: PW }) })
  const { access } = await r.json()
  const res = await fetch(`${API}${url}`, { method, headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined })
  let body; try { body = await res.json() } catch { body = null }
  return { status: res.status, body }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
