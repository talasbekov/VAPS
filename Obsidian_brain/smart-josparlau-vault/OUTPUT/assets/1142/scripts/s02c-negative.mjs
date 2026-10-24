import fs from 'node:fs'
import { open, shot, sleep } from './walk.mjs'
const run = JSON.parse(fs.readFileSync('run.json', 'utf8'))
for (const who of ['a_esmagambetov', 'observer', 'y_talasbekov']) {
  const { page, close } = await open(who)
  await page.goto(`http://localhost:3106/security-ops/events/`)
  await page.waitForLoadState('networkidle'); await sleep(800)
  const txt = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  console.log(who, '| реестр:', /Доступ закрыт|нет прав|403/i.test(txt) ? 'ДОСТУП ЗАКРЫТ' : 'открыт', '| создать бюллетень:', await page.getByRole('button', { name: /Создать бюллетень/ }).count(), '| текст:', txt.slice(0, 160))
  console.log('   меню слева:', (await page.getByRole('navigation').first().innerText().catch(() => '')).replace(/\n+/g, ' | ').slice(0, 300))
  await shot(page, `${who.replace('_','-')}-registry-access`)
  await page.goto(`http://localhost:3106/employees?view=forces`)
  await page.waitForLoadState('networkidle'); await sleep(800)
  const t2 = (await page.getByRole('main').innerText()).replace(/\n+/g, ' | ')
  console.log('   сбор сил:', /Доступ закрыт|нет прав/i.test(t2) ? 'ДОСТУП ЗАКРЫТ' : 'открыт', '|', t2.slice(0, 120))
  await close()
}
