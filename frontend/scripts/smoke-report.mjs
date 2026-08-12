// Сборка markdown-отчёта смоук-обхода из test-results/smoke/*.json.
// Отдельный шаг, а не reporter Playwright: JSON пишется по одному файлу на
// (персона × страница) — прогон можно прервать и досыпать, отчёт пересоберётся
// из того, что реально пройдено, и НЕ соврёт полнотой.
//
// Запуск: node scripts/smoke-report.mjs [> docs/smoke-report.md]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = fileURLToPath(new URL('../smoke-results', import.meta.url))

if (!fs.existsSync(DIR)) {
  console.error('нет smoke-results — обход не запускался')
  process.exit(1)
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))
const rows = []
for (const f of files) {
  const doc = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
  for (const finding of doc.findings) {
    rows.push({ persona: doc.persona, role: doc.role ?? '', ...finding })
  }
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
const personas = [...new Set(rows.map((r) => r.persona))]

const out = []
out.push('# Смоук-обход фронтенда VAPS — связь фронт↔бэк', '')
out.push(`Персон: ${personas.length} (${personas.join(', ')}). Строк обхода: ${rows.length}.`, '')

for (const p of personas) {
  const mine = rows.filter((r) => r.persona === p)
  out.push(`## Персона \`${p}\` — ${mine[0]?.role ?? ''}`, '')
  out.push('| Страница | Элемент | Действие | Запрос к API | Статус | Вердикт |')
  out.push('| --- | --- | --- | --- | --- | --- |')
  for (const r of mine) {
    out.push(
      `| \`${esc(r.page)}\` | ${esc(r.element)} | ${esc(r.action)} | ${esc(r.api)} | ${esc(r.status)} | ${esc(r.verdict)}${r.details ? ` — ${esc(r.details)}` : ''} |`,
    )
  }
  out.push('')
}

const section = (title, pred, empty) => {
  const hit = rows.filter(pred)
  out.push(`## ${title} (${hit.length})`, '')
  if (hit.length === 0) {
    out.push(`_${empty}_`, '')
    return
  }
  for (const r of hit) {
    out.push(`- \`${r.persona}\` \`${r.page}\` → **${esc(r.element)}**: ${esc(r.verdict)}${r.details ? ` — ${esc(r.details)}` : ''}`)
  }
  out.push('')
}

section('Кнопки без реакции', (r) => r.verdict.includes('без реакции'), 'таких нет')
section('Запросы без ответа', (r) => r.verdict.includes('без ответа'), 'таких нет')
section('5xx', (r) => r.verdict.includes('5xx'), 'таких нет')
section('requestfailed (aborted/failed)', (r) => r.verdict.includes('requestfailed'), 'таких нет')
section('4xx', (r) => r.verdict.includes('4xx'), 'таких нет')
section('Ошибки страницы (pageerror)', (r) => r.verdict.includes('pageerror'), 'таких нет')
section('Не нажато / не пройдено', (r) => r.verdict.includes('⏭') || r.verdict.includes('⚠️'), 'всё пройдено')

console.log(out.join('\n'))
