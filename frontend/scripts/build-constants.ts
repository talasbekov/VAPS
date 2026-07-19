// Стори 10.9 — ШОВ ВЕРСИИ. Единственная точка, откуда версия и sha сборки
// попадают в бандл. Читается ОБОИМИ vite-конфигами: vite.config.ts (прод +
// vitest) и vite.e2e.config.ts (харнесы e2e). Дублировать значения запрещено.
//
// ═══════════════════════════════════════════════════════════════════════════
// 👉 СЮДА СМОТРИТ СТОРИ 12.2 (air-gap-бандл + manifest.json)
// ═══════════════════════════════════════════════════════════════════════════
// AC эпика 10.9 говорит «текущая версия из manifest», но `manifest.json` —
// артефакт стори 12.2 (epics.md#L1286-1288, architecture.md#L560-561), и в
// дереве его СЕГОДНЯ нет: `deploy/scripts/` не существует, а единственный
// бандлер `deploy/spike-1.9/build-bundle.sh:3-4` дословно отказывается его
// делать. Эндпоинта версии тоже нет (schema.yaml: 0 совпадений на
// health|/version|/about|/meta).
//
// Поэтому 10.9 строит ШОВ, а не источник. Значения приходят build-time через
// переменные окружения, фолбэк держит dev-сборку живой:
//
//     VAPS_APP_VERSION → __APP_VERSION__   (фолбэк: version из package.json)
//     VAPS_BUILD_SHA   → __BUILD_SHA__     (фолбэк: git rev-parse, затем '')
//
// 12.2 обязана экспортировать в окружение сборки фронта РОВНО те значения,
// которые запишет в `manifest.json`. Тогда её AC «фронт того же sha»
// выполняется без единой правки фронта — ни одна строка ниже не меняется.
//
// 🔴 Рантайм-чтение манифеста (fetch/XHR) ЗАПРЕЩЕНО: eslint.config.js:211-249
// банит оба канала вне `src/shared/api`, а `apiClient` типизирован по
// `schema.d.ts`, где такого пути нет (ARCH-FE-011).
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// fileURLToPath, а НЕ URL.pathname — путь репозитория содержит кириллицу
// (ловушка 7 из 8.8, повторена в трёх gate-скриптах).
//
// readFileSync + JSON.parse, а НЕ `import pkg from '../package.json'`:
// `resolveJsonModule` в tsconfig.node.json отсутствует — прямой импорт JSON
// не скомпилируется под `tsc -b`.
const PACKAGE_JSON_PATH = fileURLToPath(
  new URL('../package.json', import.meta.url),
)

function packageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'))
  const version =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { version?: unknown }).version
      : undefined
  return typeof version === 'string' ? version : ''
}

/**
 * Короткий sha текущего коммита; вне git — пустая строка, сборка НЕ падает.
 *
 * Прецедент происхождения — `deploy/spike-1.9/build-bundle.sh:12`
 * (`git rev-parse --short HEAD 2>/dev/null || echo unknown`). Отличие
 * осознанное: ПУСТАЯ СТРОКА вместо `'unknown'` — чтобы «неизвестно» не
 * пришлось рендерить пользователю и чтобы литерал не дублировался в двух слоях.
 *
 * 🔴 `stdio: ['ignore', 'pipe', 'ignore']` — не украшение: без глушения stderr
 * КАЖДАЯ сборка вне git печатает `fatal: not a git repository`.
 */
function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim()
  } catch {
    return ''
  }
}

/**
 * Объект для Vite `define`.
 *
 * 🔴 ЗНАЧЕНИЯ ОБЯЗАНЫ БЫТЬ ОБЁРНУТЫ `JSON.stringify`: `define` подставляет
 * ТЕКСТ, а не строку. Без обёртки поведение зависит от того, как сегодня
 * выглядит короткий sha (проверено на vite 7.3.6 этого репозитория):
 *   '0.1.0'   → сборка ПАДАЕТ: Invalid define value
 *   'deadbee' → сборка ЗЕЛЁНАЯ, в бандл уходит голый идентификатор → ReferenceError
 *   '1234567' → сборка ЗЕЛЁНАЯ, в бандл уходит ЧИСЛО
 * То есть баг то громкий, то молча-фатальный, то молча-неверный — «у меня
 * собралось» не доказывает ничего.
 *
 * Приоритет источников — env → фолбэк, ровно в этом порядке. `??`, а не `||`:
 * явно выставленная пустая переменная — осознанное значение вызывающего
 * (для sha пустая строка и есть штатное «неизвестно»).
 */
export function buildDefine(): Record<string, string> {
  const version = process.env.VAPS_APP_VERSION ?? packageVersion()
  const sha = process.env.VAPS_BUILD_SHA ?? gitSha()

  return {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_SHA__: JSON.stringify(sha),
  }
}
