import { open, shot, sleep, api } from './walk.mjs'
for (const who of ['m_turmagambetov', 'y_meiram', 'acc_admin']) {
  const { page, close } = await open(who)
  await page.goto('http://localhost:3106/security-ops/analytics'); await page.waitForLoadState('networkidle'); await sleep(2500)
  const a = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  console.log(who, '| аналитика ОМ:', a.slice(0, 350))
  if (!/Доступ закрыт/.test(a)) { await shot(page, `${who.replace('_', '-')}-analytics`, true); const t = a; const k = t.indexOf('ОМ-2026-45'); console.log('  ОМ-2026-45 в аналитике:', k >= 0 ? t.slice(k - 50, k + 250) : 'НЕТ') }
  await page.goto('http://localhost:3106/security-ops/ratings/workspace'); await page.waitForLoadState('networkidle'); await sleep(2000)
  const r = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  console.log('  рейтинги:', r.slice(0, 250))
  if (!/Доступ закрыт/.test(r)) await shot(page, `${who.replace('_', '-')}-ratings-workspace`, true)
  await close()
}
