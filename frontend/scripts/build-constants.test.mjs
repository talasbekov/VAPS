// QA-добор стори 10.9 (workflow qa-generate-e2e-tests) — ГЕЙТ ШВА ВЕРСИИ.
//
// ═══ ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ ═══
// `scripts/build-constants.ts` — единственная точка, через которую версия и sha
// попадают в бандл (AC-1), и адрес, на который смотрит стори 12.2. На момент
// QA-прохода его контракт не проверял НИ ОДИН автотест: `vite.config.ts:test`
// собирает только `src/**/*.test.{ts,tsx}`, а сам шов живёт в `scripts/`.
// Всё, что о нём известно, было доказано РУЧНОЙ красной пробой (AC-13, мутации
// №7 и №9) — то есть одноразово и невоспроизводимо.
//
// Цена пробела измерима. Мутация №9 спеки (снят `JSON.stringify`) покраснела
// на sha `dee419f` только потому, что `dee419f` — валидный JS-идентификатор и
// vitest умер на загрузке define'ов. Таблица AC-1 прямо говорит, что симптом
// зависит от того, как СЕГОДНЯ выглядит короткий sha:
//   '0.1.0'   → сборка падает          (громко)
//   'deadbee' → голый идентификатор    (молча-фатально)
//   '1234567' → ЧИСЛО в бандле         (молча-НЕВЕРНО, всё зелёное)
// На коммите с числовым sha тот же дефект прошёл бы гейт целиком. Ассерт ниже
// от sha не зависит вовсе — он проверяет ФОРМУ значения, а не её везение.
//
// ═══ ПОЧЕМУ .mjs В scripts/, А НЕ vitest В src/ ═══
// Прецедент и enforcement уже есть: `lint-canon.test.mjs` и
// `schema-check.test.mjs` — самостоятельные node-скрипты цепочки `gate`, и
// `vite.config.ts:35-36` дословно объясняет, что `scripts/*.test.mjs` намеренно
// вне `include` vitest. Тест в `src/` пришлось бы импортировать через `../../`
// наружу слоя — это `boundaries/no-unknown-dependencies` (ARCH-FE-013).
// Node 22.12+ (engines) снимает .ts-типы сам — импорт шва работает напрямую.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildDefine } from './build-constants.ts'

// fileURLToPath, не URL.pathname — путь репо содержит кириллицу (ловушка 7 из 8.8)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SEAM_URL = pathToFileURL(join(ROOT, 'scripts', 'build-constants.ts')).href

const failures = []

function check(label, condition, detail = '') {
  if (!condition) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

/**
 * Разбор значения define обратно в строку.
 *
 * Через try/catch, а не голым `JSON.parse`: на реализации БЕЗ `JSON.stringify`
 * значение приезжает голым текстом (`0.1.0`, `dee419f`, пустая строка), и
 * голый разбор уронил бы прогон SyntaxError'ом ДО печати списка находок —
 * гейт краснел бы верно, но не сообщал бы, что именно сломано. Сентинел
 * оставляет диагностику на месте (поймано красной пробой P1 этого файла).
 */
function parseDefine(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return Symbol.for('vaps.define.unparseable')
  }
}

// Гейт может прийти с уже выставленными переменными (их и подставит 12.2).
// Снимаем на время прогона и возвращаем в конце — иначе ветка фолбэка
// оказалась бы недостижимой ИМЕННО там, где её важнее всего проверить.
const SAVED = {
  VAPS_APP_VERSION: process.env.VAPS_APP_VERSION,
  VAPS_BUILD_SHA: process.env.VAPS_BUILD_SHA,
}
function clearEnv() {
  delete process.env.VAPS_APP_VERSION
  delete process.env.VAPS_BUILD_SHA
}
function restoreEnv() {
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const CWD_AT_START = process.cwd()
const KEYS = ['__APP_VERSION__', '__BUILD_SHA__']

// ─── 1. JSON.stringify: define подставляет ТЕКСТ, а не строку (AC-1) ────────
// Ассерт держится за форму значения, а не за сегодняшний sha. Числовой sha —
// ровно та строка таблицы AC-1, что проходит молча и НЕВЕРНО: '1234567' без
// обёртки уезжает в бандл числом, сборка зелёная, `сборка 1234567` в футере
// выглядит правдоподобно. Отсюда явный ассерт на кавычки.
clearEnv()
process.env.VAPS_APP_VERSION = '9.9.9'
process.env.VAPS_BUILD_SHA = '1234567'
{
  const define = buildDefine()
  for (const key of KEYS) {
    check(
      `${key}: значение не обёрнуто JSON.stringify`,
      typeof define[key] === 'string' && define[key].startsWith('"'),
      `получено ${JSON.stringify(define[key])} — define подставит это как выражение, а не как строку`,
    )
  }
  check(
    '__APP_VERSION__ не разбирается обратно в исходную строку',
    parseDefine(define.__APP_VERSION__) === '9.9.9',
  )
  check(
    '__BUILD_SHA__ не разбирается обратно в исходную строку',
    parseDefine(define.__BUILD_SHA__) === '1234567',
    'числовой sha без кавычек уехал бы в бандл ЧИСЛОМ — таблица AC-1, «молча-неверный»',
  )
  // негативный контроль: голое значение НЕ должно совпадать с обёрнутым,
  // иначе ассерт выше был бы вакуумным на любой реализации
  check(
    'обёртка неотличима от голого значения',
    define.__BUILD_SHA__ !== '1234567',
  )
}

// ─── 2. Приоритет источников: env → фолбэк (AC-1) ───────────────────────────
// 12.2 подставит РОВНО эти переменные. Перепутанное имя или проигнорированный
// env не краснит сегодня ничего — фолбэк на package.json выглядит «работающим».
clearEnv()
process.env.VAPS_APP_VERSION = '42.0.1'
check(
  'VAPS_APP_VERSION не имеет приоритета над package.json',
  parseDefine(buildDefine().__APP_VERSION__) === '42.0.1',
)

clearEnv()
{
  const pkgVersion = JSON.parse(
    readFileSync(join(ROOT, 'package.json'), 'utf8'),
  ).version
  check(
    'без env версия не берётся из package.json',
    parseDefine(buildDefine().__APP_VERSION__) === pkgVersion,
    `ожидали ${pkgVersion}`,
  )
  // фолбэк не должен быть пустым: пустая версия отрендерилась бы как «Версия »
  check('версия-фолбэк пуста', pkgVersion !== '' && pkgVersion !== undefined)
}

// ─── 3. `??`, а не `||`: явно пустая переменная — осознанное значение ────────
// Шов документирует это отдельным абзацем. На `||` пустой VAPS_BUILD_SHA молча
// провалился бы в git-фолбэк, и 12.2 не смогла бы сказать «sha неизвестен».
clearEnv()
process.env.VAPS_BUILD_SHA = ''
check(
  'пустой VAPS_BUILD_SHA не сохраняется (реализация на `||`, а не `??`)',
  parseDefine(buildDefine().__BUILD_SHA__) === '',
  'пустая переменная провалилась в git-фолбэк',
)

// ─── 4. Положительный контроль: в репозитории sha РЕАЛЬНЫЙ ──────────────────
// Без него тест «вне git → пусто» был бы вакуумным: реализация, всегда
// возвращающая '', прошла бы его не поморщившись.
clearEnv()
check(
  'в git-репозитории sha пуст или не похож на короткий sha',
  // String(): parseDefine отдаёт Symbol на неразбираемом значении, а
  // RegExp.test приводит аргумент неявно и упал бы TypeError'ом до отчёта
  /^[0-9a-f]{7,40}$/.test(String(parseDefine(buildDefine().__BUILD_SHA__))),
  `получено ${buildDefine().__BUILD_SHA__}`,
)

// ─── 5. Сборка ВНЕ git: пустой sha, без падения и без шума в stderr (AC-1) ──
// Прямой Given/Then спеки, не покрытый ничем. `gitSha()` наследует cwd
// процесса, поэтому каталог вне репозитория воспроизводит контур 12.2 точно.
const OUTSIDE = mkdtempSync(join(tmpdir(), 'vaps-build-constants-'))
try {
  clearEnv()
  process.chdir(OUTSIDE)
  let outsideDefine
  let threw = null
  try {
    outsideDefine = buildDefine()
  } catch (error) {
    threw = error
  }
  check(
    'сборка вне git падает вместо пустого sha',
    threw === null,
    threw ? String(threw) : '',
  )
  if (threw === null) {
    check(
      'вне git __BUILD_SHA__ не пустая строка',
      parseDefine(outsideDefine.__BUILD_SHA__) === '',
      `получено ${outsideDefine.__BUILD_SHA__}`,
    )
    // версия обязана уцелеть: путь к package.json абсолютный (import.meta.url),
    // а не относительный к cwd — иначе вне git отвалилась бы и она
    check(
      'вне git потеряна и версия (путь к package.json зависит от cwd)',
      parseDefine(outsideDefine.__APP_VERSION__) !== '',
    )
  }
} finally {
  process.chdir(CWD_AT_START)
  rmSync(OUTSIDE, { recursive: true, force: true })
  restoreEnv()
}

// ─── 5-бис. Вне git шов МОЛЧИТ: ни строки в stderr ──────────────────────────
// Шапка шва называет `stdio: ['ignore','pipe','ignore']` «не украшением»:
// без глушения КАЖДАЯ сборка вне git печатает `fatal: not a git repository`.
// Ассертить это можно только из отдельного процесса — внутри текущего execSync
// пишет в унаследованный дескриптор, и перехватывать нечего. spawnSync, а не
// execFileSync: на успешном прогоне execFileSync отдаёт лишь stdout, и ассерт
// на stderr оказался бы вакуумным.
{
  const NOISE = mkdtempSync(join(tmpdir(), 'vaps-build-constants-noise-'))
  const childEnv = { ...process.env }
  delete childEnv.VAPS_APP_VERSION
  delete childEnv.VAPS_BUILD_SHA
  try {
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const m = await import(${JSON.stringify(SEAM_URL)}); console.log(m.buildDefine().__BUILD_SHA__)`,
      ],
      { cwd: NOISE, encoding: 'utf8', env: childEnv },
    )
    check(
      'вызов шва вне git завершился ненулевым кодом',
      child.status === 0,
      String(child.stderr ?? '').trim(),
    )
    check(
      'шов шумит в stderr вне git (stdio не заглушён)',
      String(child.stderr ?? '').trim() === '',
      `stderr: ${String(child.stderr ?? '').trim()}`,
    )
    check(
      'вне git дочерний процесс отдал не пустой sha',
      String(child.stdout ?? '').trim() === '""',
      `stdout: ${String(child.stdout ?? '').trim()}`,
    )
  } finally {
    rmSync(NOISE, { recursive: true, force: true })
  }
}

// ─── 6. define объявлен в ОБОИХ vite-конфигах (AC-2) ────────────────────────
// 🔴 Это единственный ГЕЙТОВЫЙ детектор мутации №7. Спека честно записала, что
// забытый define в `vite.e2e.config.ts` оставляет ЗЕЛЁНЫМИ и `npm run gate`, и
// `npm run build:e2e`, а ловит его только Playwright — который в гейт НЕ входит
// (инцидент 10.6: сломанный e2e-ассерт остаётся зелёным гейтом). То есть до
// этого файла дефект «харнес падает ReferenceError при монтировании» проезжал
// весь автоматический контур незамеченным.
const CONFIGS = [
  ['vite.config.ts', true],
  ['vite.e2e.config.ts', false],
]
for (const [name, isFactory] of CONFIGS) {
  const url = pathToFileURL(join(ROOT, name)).href
  const mod = await import(url)
  const resolved = isFactory
    ? await mod.default({ mode: 'production', command: 'build' })
    : mod.default
  const define = resolved?.define
  check(`${name}: нет define вовсе`, define !== undefined && define !== null)
  if (define) {
    for (const key of KEYS) {
      check(
        `${name}: define не объявляет ${key}`,
        typeof define[key] === 'string',
        'харнес/бандл упадёт ReferenceError при монтировании AppLayout',
      )
      check(
        `${name}: ${key} не обёрнут JSON.stringify`,
        typeof define[key] === 'string' && define[key].startsWith('"'),
      )
    }
  }
}

// ─── 7. Версия синхронна между package.json и package-lock.json (AC-11) ─────
// Рассинхрон молчалив: `deps-gate.mjs` сканирует lock только на банённые
// пакеты и версию корня не смотрит вовсе.
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))
  check(
    'package-lock.json: корневая version разошлась с package.json',
    lock.version === pkg.version,
    `lock=${lock.version} package=${pkg.version}`,
  )
  check(
    'package-lock.json: packages[""].version разошлась с package.json',
    lock.packages?.['']?.version === pkg.version,
    `lock=${lock.packages?.['']?.version} package=${pkg.version}`,
  )
  check(
    'версия фронта не semver из трёх частей (architecture.md#L145)',
    /^\d+\.\d+\.\d+$/.test(pkg.version),
    `получено ${pkg.version}`,
  )
}

restoreEnv()

if (failures.length) {
  console.error('build-constants: ШОВ ВЕРСИИ НЕ ДОКАЗАН:')
  failures.forEach((f) => console.error(`  ${f}`))
  process.exit(1)
}
console.log(
  'build-constants: обёртка define + приоритет env + сборка вне git + define в ОБОИХ конфигах + синхронность версии — шов доказан',
)
