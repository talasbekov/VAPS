import fs from 'node:fs'
import { open, shot, sleep, api } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
{
  const { page, close } = await open('y_talasbekov')
  await page.goto('http://localhost:3106/security-ops/profile'); await page.waitForLoadState('networkidle'); await sleep(1500)
  console.log('шапка профиля:', (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ').slice(0, 400))
  const hist = page.getByRole('tab', { name: /История/ }); if (await hist.count()) await hist.click(); await sleep(1000)
  const t = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  const k = t.indexOf('История'); console.log('история:', t.slice(k, k + 500))
  await shot(page, 'talasbekov-profile-history', true)
  await close()
}
{
  const { page, close } = await open('k_baglanov')
  await page.goto(`http://localhost:3106/security-ops/events?search=${encodeURIComponent('Проходка №1142')}`); await page.waitForLoadState('networkidle'); await sleep(1200)
  const row = page.getByRole('row').filter({ hasText: run.code }).first()
  console.log('строка реестра:', (await row.innerText()).replace(/\n+/g, ' | ').slice(0, 300))
  await shot(page, 'baglanov-registry-closed')
  await page.goto(`http://localhost:3106/security-ops/events/${run.eventId}/`); await page.waitForLoadState('networkidle'); await sleep(1500)
  const t = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  console.log('карточка закрытого ОМ:', t.slice(0, 500))
  console.log('кнопки архива/дела:', (await page.getByRole('main').getByRole('button').allInnerTexts()).filter(s => /Скачать|дело|PDF|Архив/i.test(s)).join(' | '), '| ссылки:', (await page.getByRole('main').getByRole('link').allInnerTexts()).filter(s => /Скачать|дело|PDF|Архив/i.test(s)).join(' | '))
  await shot(page, 'baglanov-closed-event-card', true)
  await page.goto('http://localhost:3106/security-ops/analytics'); await page.waitForLoadState('networkidle'); await sleep(2000)
  const a = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  console.log('аналитика ОМ:', a.slice(0, 600))
  await shot(page, 'baglanov-analytics', true)
  await close()
}
