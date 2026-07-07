// QA-самотест стори 8.3: schema-check.mjs — гейт-чекер, значит его красные
// пути должны быть ДОКАЗАНЫ автоматически, а не проверены однажды руками
// (урок вакуумного pass 8.1/8.2; зеркало lint-canon.test.mjs для 8.2).
// Механика: временное зеркало репо-структуры (schema.yaml + schema.d.ts +
// копия чекера + symlink node_modules) — реальное дерево НЕ мутируется,
// относительные пути чекера (import.meta.url) резолвятся внутри зеркала.
// Плюс contract-проба tsc (канон L258: «мок, противоречащий схеме, не
// компилируется») и гвард .prettierignore (Ловушка 2).
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, не URL.pathname — путь репо содержит кириллицу
const FRONTEND = fileURLToPath(new URL('..', import.meta.url))
const REAL_YAML = fileURLToPath(
  new URL('../../Backend/VAPS/schema.yaml', import.meta.url),
)
const REAL_DTS = join(FRONTEND, 'src', 'shared', 'api', 'schema.d.ts')
const REAL_CHECKER = join(FRONTEND, 'scripts', 'schema-check.mjs')

const failures = []

const tmp = mkdtempSync(join(tmpdir(), 'schema-check-test-'))
const M_FRONT = join(tmp, 'frontend')
const M_YAML = join(tmp, 'Backend', 'VAPS', 'schema.yaml')
const M_DTS = join(M_FRONT, 'src', 'shared', 'api', 'schema.d.ts')
const M_CHECKER = join(M_FRONT, 'scripts', 'schema-check.mjs')
const M_PROBE = join(M_FRONT, 'probe')

// каждый сценарий стартует с нетронутых копий реальных артефактов
function resetFixtures() {
  copyFileSync(REAL_YAML, M_YAML)
  copyFileSync(REAL_DTS, M_DTS)
  copyFileSync(REAL_CHECKER, M_CHECKER)
}

function runChecker() {
  return spawnSync(process.execPath, [M_CHECKER], { encoding: 'utf8' })
}

function runTsc(file) {
  // зеркало влияющих на контракт опций боевого tsconfig.app.json
  // (strict/es2022/bundler/skipLibCheck — Ловушка 6)
  return spawnSync(
    process.execPath,
    [
      join(M_FRONT, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'es2022',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--skipLibCheck',
      file,
    ],
    { cwd: M_FRONT, encoding: 'utf8' },
  )
}

// конкретная подсказка обязательна (урок 8.1: «есть хоть какая-то ошибка» —
// не доказательство): красный не с тем сообщением = сломанный сценарий
function expectRed(name, res, hint) {
  if (res.status === 0) {
    failures.push(`${name}: ожидал КРАСНЫЙ, чекер прошёл зелёным`)
  } else if (!res.stderr.includes(hint)) {
    failures.push(
      `${name}: красный, но без подсказки «${hint}»; stderr: ${res.stderr.trim()}`,
    )
  }
}

function expectGreen(name, res) {
  if (res.status !== 0) {
    failures.push(`${name}: ожидал зелёный, красный: ${res.stderr.trim()}`)
  }
}

try {
  mkdirSync(join(tmp, 'Backend', 'VAPS'), { recursive: true })
  mkdirSync(join(M_FRONT, 'scripts'), { recursive: true })
  mkdirSync(join(M_FRONT, 'src', 'shared', 'api'), { recursive: true })
  mkdirSync(M_PROBE, { recursive: true })
  // CLI openapi-typescript и tsc чекер берёт из настоящего node_modules
  symlinkSync(
    join(FRONTEND, 'node_modules'),
    join(M_FRONT, 'node_modules'),
    'dir',
  )

  // контроль зелёного: нетронутые копии обязаны проходить — иначе красные
  // сценарии ниже ничего не доказывают (сломан сам харнесс зеркала)
  resetFixtures()
  expectGreen('контроль (нетронутые артефакты)', runChecker())

  // AC4: ручная правка schema.d.ts → байтовое расхождение с fresh-regen
  resetFixtures()
  writeFileSync(M_DTS, readFileSync(M_DTS, 'utf8') + '// правка руками\n')
  expectRed(
    'AC4 (ручная правка schema.d.ts)',
    runChecker(),
    'расходится с fresh-regen',
  )

  // AC5: пропавший AUTO-GENERATED-заголовок → отдельный ассерт до regen
  resetFixtures()
  const headerless = readFileSync(M_DTS, 'utf8')
    .split('\n')
    .filter((line) => !line.toLowerCase().includes('auto-generated'))
    .join('\n')
  writeFileSync(M_DTS, headerless)
  expectRed(
    'AC5 (headerless schema.d.ts)',
    runChecker(),
    'AUTO-GENERATED-заголовка',
  )

  // AC3: schema.yaml обновлён (сменился operationId), типы не перегенерены
  resetFixtures()
  writeFileSync(
    M_YAML,
    readFileSync(M_YAML, 'utf8').replace('audit_logs_list', 'audit_logs_probe'),
  )
  expectRed(
    'AC3 (schema.yaml без regen типов)',
    runChecker(),
    'расходится с fresh-regen',
  )

  // AC7: гварды существования/непустоты — внятный красный, не крэш
  resetFixtures()
  rmSync(M_DTS)
  expectRed(
    'AC7 (schema.d.ts отсутствует)',
    runChecker(),
    'run: npm run generate:api',
  )

  resetFixtures()
  writeFileSync(M_YAML, '')
  expectRed('AC7 (schema.yaml пуст)', runChecker(), 'run: make schema')

  // L258/AC6: contract-проба tsc. good — типы схемы юзабельны (реальный путь
  // и реальный тип поля); bad — мок против схемы НЕ компилируется. Employee.id
  // = string/uuid закреплён бэк-тестом test_schema_contract.py (та же пара).
  resetFixtures()
  writeFileSync(
    join(M_PROBE, 'good.ts'),
    "import type { components, paths } from '../src/shared/api/schema'\n" +
      "type Employee = components['schemas']['Employee']\n" +
      "export const id: Employee['id'] = '0000-0000'\n" +
      "export type EmployeesList = paths['/api/core/employees/']['get']\n",
  )
  writeFileSync(
    join(M_PROBE, 'bad.ts'),
    "import type { components } from '../src/shared/api/schema'\n" +
      "type Employee = components['schemas']['Employee']\n" +
      '// мок против схемы: id в схеме string (uuid), не number\n' +
      "export const bad: Employee['id'] = 12345\n",
  )
  const good = runTsc(join(M_PROBE, 'good.ts'))
  if (good.status !== 0) {
    failures.push(
      `tsc-проба good: типы схемы неюзабельны: ${good.stdout.trim()}`,
    )
  }
  const bad = runTsc(join(M_PROBE, 'bad.ts'))
  if (bad.status === 0) {
    failures.push(
      'tsc-проба bad: мок против схемы СКОМПИЛИРОВАЛСЯ — contract-тест L258 вакуумен',
    )
  } else if (!bad.stdout.includes('TS2322')) {
    failures.push(
      `tsc-проба bad: красный, но не TS2322 (не тип-контракт): ${bad.stdout.trim()}`,
    )
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// Ловушка 2: потеря записи в .prettierignore делает первый же `npm run format`
// источником вечного drift-красного (prettier перепишет CLI-вывод)
const prettierIgnore = readFileSync(join(FRONTEND, '.prettierignore'), 'utf8')
if (!prettierIgnore.split('\n').includes('src/shared/api/schema.d.ts')) {
  failures.push(
    '.prettierignore потерял src/shared/api/schema.d.ts (Ловушка 2)',
  )
}

// Д7/AC6: strict — часть contract-ценности tsc (nullable-поля схемы не
// энфорсятся без него); его тихая потеря не красит ни один шаг гейта —
// tsc -b лишь станет мягче, а tsc-пробы выше зеркалят --strict сами
const tsconfigApp = readFileSync(join(FRONTEND, 'tsconfig.app.json'), 'utf8')
if (!/"strict":\s*true/.test(tsconfigApp)) {
  failures.push('tsconfig.app.json потерял "strict": true (Д7/AC6, канон L229)')
}

if (failures.length) {
  console.error('schema-check.test: ГЕЙТ НЕ ДОКАЗАН:')
  failures.forEach((f) => console.error(`  ${f}`))
  process.exit(1)
}
console.log(
  'schema-check.test: контроль зелёного + 5 красных (AC3/AC4/AC5/AC7×2) + tsc-проба L258 + prettierignore/strict-гварды — гейт доказан',
)
