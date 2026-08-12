// Сборка markdown-отчёта смоук-обхода из smoke-results/*.json.
// Отдельный шаг, а не reporter Playwright: JSON пишется по одному файлу на
// (персона × страница) — прогон можно прервать и досыпать, отчёт пересоберётся
// из того, что реально пройдено, и НЕ соврёт полнотой.
//
// Запуск: node scripts/smoke-report.mjs [> ../../../docs/smoke-old-stack.md]
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
out.push('# Смоук-обход портала (старый стек) — связь фронт↔бэк', '')
out.push('Стенд: Django `:8100` (Personnel-Records) + Next `:3106` (PersonalRecordFront).', '')
out.push(`Персон: ${personas.length} (${personas.join(', ')}). Строк обхода: ${rows.length}.`, '')
// Границы метода печатаются В ОТЧЁТЕ, а не живут в голове у того, кто его
// запускал: без этого абзаца «⚪ без реакции» читается как список дефектов, а
// половина строк там — слепота самого обхода.
out.push('## Как читать', '')
out.push(
  '- `⚪ без реакции` — ни запроса, ни навигации, ни изменения сигнатуры экрана.',
  '  Сигнатура — это `pathname+search`, длина `innerText`, число узлов DOM и число',
  '  модалок. Она СЛЕПА к чисто визуальным переключениям: свернуть сайдбар',
  '  (`translate-x`), сменить тему (класс на `<html>`), подсветить активную вкладку.',
  '  Такие кнопки попадают в «без реакции» ЗАКОННО работая — проверять глазами.',
  '- Клик по УЖЕ активной вкладке тоже даёт «без реакции»: это не дефект.',
  '- `🟡 4xx` на POST/PATCH после клика по «Сохранить»/«Добавить» в пустой форме —',
  '  это серверная валидация, то есть работающий контракт, а не поломка.',
  '- `⏭ не нажат` — деструктивное действие или скачивание файла: обход их не',
  '  трогает намеренно, они НЕ проверены.',
  '- Деструктивные и скачивающие кнопки не нажимались, поэтому «зелено» по',
  '  разделу НЕ означает, что удаление/выгрузка работают.',
  '',
)

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
    out.push(
      `- \`${r.persona}\` \`${r.page}\` → **${esc(r.element)}**: ${esc(r.verdict)}${r.details ? ` — ${esc(r.details)}` : ''}`,
    )
  }
  out.push('')
}

section('Кнопки без реакции', (r) => r.verdict.includes('без реакции'), 'таких нет')
section('Запросы без ответа', (r) => r.verdict.includes('без ответа'), 'таких нет')
section('5xx', (r) => r.verdict.includes('5xx'), 'таких нет')
section('requestfailed (aborted/failed)', (r) => r.verdict.includes('requestfailed'), 'таких нет')
section('4xx', (r) => r.verdict.includes('4xx'), 'таких нет')
section('Ошибки страницы (pageerror)', (r) => r.verdict.includes('pageerror'), 'таких нет')
section('Отбито на экран входа', (r) => r.verdict.includes('выкинуло'), 'таких нет')
section('Гвард закрыл (нет прав)', (r) => r.verdict.includes('🔒'), 'таких нет')
section('Не нажато / не пройдено', (r) => r.verdict.includes('⏭') || r.verdict.includes('⚠️'), 'всё пройдено')

console.log(out.join('\n'))
