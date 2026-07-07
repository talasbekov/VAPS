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
const jsFiles = files.filter((f) => /\.(js|mjs|cjs)$/.test(f))
if (jsFiles.length === 0) {
  // stale/зачищенный dist без единого JS — «бюджет 0.0 KB» был бы вакуумным pass
  console.error(
    'size-gate: в dist/ нет ни одного JS-ассета — сборка неполная, сначала vite build',
  )
  process.exit(1)
}
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

// --- 2. no-CDN: внешние URL в ассетах ---
// Матчим http(s)://, ws(s):// И protocol-relative //host; хост локален только при
// ТОЧНОМ совпадении (не localhost.evil.com — прежний \b-lookahead это пропускал).
const EXTERNAL = /(?:https?:|wss?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)/gi
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])
// Загрузочные контексты: атрибуты HTML/SVG (src/srcset/href, регистронезависимо),
// CSS (url()/@import), JSON-манифесты ("src"/"href"/"url":), JS-динамика
// (import()/from/fetch/new URL/WebSocket/xhr.open). Лицензии-комментарии и
// строки-сообщения (напр. react.dev/errors в прод-бандле React) браузером
// не грузятся — их не флагуем.
const LOAD_CONTEXT = new RegExp(
  '(' +
    [
      'src\\s*=\\s*["\']?',
      'srcset\\s*=\\s*["\']?',
      'href\\s*=\\s*["\']?',
      'url\\(\\s*["\']?',
      '@import\\s+["\'(]',
      '["\'](?:src|href|url)["\']\\s*:\\s*["\']',
      'import\\s*\\(\\s*["\']',
      'from\\s+["\']',
      'fetch\\s*\\(\\s*["\']',
      'new\\s+URL\\s*\\(\\s*["\']',
      'WebSocket\\s*\\(\\s*["\']',
      '\\.open\\s*\\(\\s*["\'][a-z]+["\']\\s*,\\s*["\']',
    ].join('|') +
    ')$',
  'i',
)
const offenders = []
const SCAN = /\.(html|css|js|mjs|cjs|svg|webmanifest|json)$/i
for (const f of files.filter((x) => SCAN.test(x))) {
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(EXTERNAL)) {
    if (LOCAL_HOSTS.has(m[1].toLowerCase())) continue
    const scheme = (m[0].match(/^[a-z]+:/i) || [''])[0].toLowerCase()
    const before = text.slice(Math.max(0, m.index - 60), m.index)
    // ws(s):// — всегда сетевой эндпоинт, флагуем без контекста; остальное — по контексту.
    if (scheme === 'ws:' || scheme === 'wss:' || LOAD_CONTEXT.test(before)) {
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
