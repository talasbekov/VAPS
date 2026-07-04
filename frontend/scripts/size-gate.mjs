// Гейт-ассерты стори 8.1:
// 1) суммарный gzip всех JS-ассетов dist/ ≤ BUDGET (бюджет контура: 4 ГБ RAM, FF100);
// 2) no-CDN: в dist нет ссылок на внешние хосты (закрытый контур).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

// fileURLToPath, не URL.pathname — путь репо содержит кириллицу (percent-encoding ломает fs)
const DIST = fileURLToPath(new URL('../dist', import.meta.url))
const BUDGET = 300 * 1024 // байт gzip

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

let files
try {
  files = walk(DIST)
} catch {
  console.error(`size-gate: dist/ не найден (${DIST}) — сначала vite build`)
  process.exit(1)
}

// --- 1. Бюджет gzip по JS ---
const jsFiles = files.filter((f) => f.endsWith('.js'))
let total = 0
const rows = []
for (const f of jsFiles) {
  const gz = gzipSync(readFileSync(f)).length
  total += gz
  rows.push(`  ${relative(DIST, f)}  ${(gz / 1024).toFixed(1)} KB gzip`)
}
console.log(`size-gate: JS-ассеты (${jsFiles.length}):`)
rows.forEach((r) => console.log(r))
console.log(
  `size-gate: итого ${(total / 1024).toFixed(1)} KB gzip, бюджет ${BUDGET / 1024} KB`,
)
if (total > BUDGET) {
  console.error('size-gate: БЮДЖЕТ ПРЕВЫШЕН')
  process.exit(1)
}

// --- 2. no-CDN: внешние URL в html/css/js ---
const EXTERNAL = /https?:\/\/(?!localhost\b|127\.0\.0\.1\b)[a-z0-9.-]+/gi
const offenders = []
for (const f of files.filter((x) => /\.(html|css|js)$/.test(x))) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(EXTERNAL)) {
    // ссылки в комментариях-лицензиях и sourcemap-URL не грузятся браузером,
    // но здесь строже: любое вхождение в атрибутах загрузки — стоп.
    // Эвристика: ловим только src=/href=/url(/import c внешним URL.
    const before = text.slice(Math.max(0, m.index - 30), m.index)
    if (/(src\s*=\s*["']?|href\s*=\s*["']?|url\(\s*["']?|@import\s+["'(]|import\s*\(\s*["'])$/.test(before)) {
      offenders.push(`  ${relative(DIST, f)}: ${m[0]}`)
    }
  }
}
if (offenders.length) {
  console.error('size-gate: найдены внешние загрузки (no-CDN нарушен):')
  offenders.forEach((o) => console.error(o))
  process.exit(1)
}
console.log('size-gate: no-CDN чисто, гейт пройден')
