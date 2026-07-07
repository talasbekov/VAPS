// Гейт-ассерт стори 8.2 (ARCH-FE-010, второй слой enforcement):
// eslint ловит ИМПОРТ запрещённого пакета, этот скрипт — его УСТАНОВКУ
// (`npm i zustand` без единого импорта). Скан package-lock.json ловит
// и транзитивные вхождения (runtime CSS-in-JS в бандле — нарушение
// независимо от того, кто его притащил).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BANNED_PACKAGES, BANNED_SCOPES } from './banned-packages.mjs'

// fileURLToPath, не URL.pathname — путь репо содержит кириллицу
const LOCK = fileURLToPath(new URL('../package-lock.json', import.meta.url))

let lock
try {
  lock = JSON.parse(readFileSync(LOCK, 'utf8'))
} catch {
  console.error(`deps-gate: package-lock.json не найден/не парсится (${LOCK})`)
  process.exit(1)
}

const entries = Object.entries(lock.packages ?? {}).filter(([k]) => k)
if (entries.length === 0) {
  // пустой lock = вакуумный pass, а не чистота
  console.error(
    'deps-gate: в package-lock.json нет записей packages — lock повреждён?',
  )
  process.exit(1)
}

const isBanned = (name) =>
  BANNED_PACKAGES.includes(name) ||
  BANNED_SCOPES.some((s) => name.startsWith(`${s}/`))

const offenders = []
for (const [key, entry] of entries) {
  // ключи вида node_modules/<name> и node_modules/a/node_modules/<name>
  const idx = key.lastIndexOf('node_modules/')
  if (idx === -1) continue
  const name = key.slice(idx + 'node_modules/'.length)
  if (isBanned(name)) {
    offenders.push(`  ${name} (${key})`)
    continue
  }
  // npm-алиас (`npm i x@npm:zustand`): ключ node_modules/x, реальное имя — в поле name
  if (entry?.name && entry.name !== name && isBanned(entry.name)) {
    offenders.push(`  ${entry.name} (алиас ${key})`)
  }
}

if (offenders.length) {
  console.error(
    'deps-gate: запрещённые каноном ARCH-FE пакеты в package-lock.json:',
  )
  offenders.forEach((o) => console.error(o))
  process.exit(1)
}
console.log(
  `deps-gate: чисто (${entries.length} пакетов lock против ${BANNED_PACKAGES.length} имён + ${BANNED_SCOPES.length} scope-банов)`,
)
