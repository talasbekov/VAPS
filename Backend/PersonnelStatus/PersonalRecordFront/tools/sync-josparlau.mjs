// Синхронизация josparlau/src из ЕДИНСТВЕННОГО источника — frontend/src
// (Этап M3). Копия — генерируемый артефакт: править её руками нельзя, дрейф
// ловится режимом --check. Host-специфика кодифицирована здесь целиком:
//  • host-files/ — канонические host-версии малых файлов (env/mode/version);
//  • PATCHES — точечные replace для App.tsx и FeedbackPage (Vite-литералы →
//    host-глобал); несовпадение якоря роняет синк громко, а не молча.
import { execSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = path.dirname(fileURLToPath(new URL('.', import.meta.url)))
const REPO = path.resolve(HOST, '../../..')
const SRC = path.join(REPO, 'frontend/src')
const DST = path.join(HOST, 'josparlau/src')
const HOST_FILES = path.join(HOST, 'tools/host-files')

const PATCHES = [
  {
    file: 'app/App.tsx',
    replaces: [
      [
        "import { getFrontendEnv } from '../shared/config/env'",
        "import { getFrontendEnv } from '../shared/config/env'\nimport { JOSPARLAU_BASENAME, JOSPARLAU_MODE } from '../shared/config/mode'",
      ],
      [
        "const showDemoToolbar = import.meta.env.MODE === 'mock' && env.demoToolsEnabled",
        "const showDemoToolbar = JOSPARLAU_MODE === 'mock' && env.demoToolsEnabled",
      ],
      ['    <BrowserRouter>', '    <BrowserRouter basename={JOSPARLAU_BASENAME}>'],
    ],
  },
  {
    file: 'features/feedback/pages/FeedbackPage.tsx',
    prepend: "import { JOSPARLAU_MODE } from '../../../shared/config/mode'\n",
    replaces: [['appRevision: import.meta.env.MODE,', 'appRevision: JOSPARLAU_MODE,']],
  },
]

function applyHostSpecifics(dst) {
  rmSync(path.join(dst, 'app/main.tsx'), { force: true })
  rmSync(path.join(dst, 'vite-env.d.ts'), { force: true })
  cpSync(path.join(HOST_FILES, 'shared-config/env.ts'), path.join(dst, 'shared/config/env.ts'))
  cpSync(path.join(HOST_FILES, 'shared-config/mode.ts'), path.join(dst, 'shared/config/mode.ts'))
  cpSync(path.join(HOST_FILES, 'version.ts'), path.join(dst, 'shared/version.ts'))
  for (const patch of PATCHES) {
    const target = path.join(dst, patch.file)
    let content = readFileSync(target, 'utf8')
    for (const [from, to] of patch.replaces) {
      if (!content.includes(from)) {
        throw new Error(`sync-josparlau: якорь не найден в ${patch.file}: ${from}`)
      }
      content = content.replaceAll(from, to)
    }
    if (patch.prepend) {
      // Перед ПЕРВОЙ import-строкой: шапка-комментарий файла остаётся шапкой.
      content = content.replace(/^import /m, patch.prepend + 'import ')
    }
    writeFileSync(target, content)
  }
}

function buildInto(dst) {
  rmSync(dst, { recursive: true, force: true })
  cpSync(SRC, dst, { recursive: true })
  applyHostSpecifics(dst)
}

const checkMode = process.argv.includes('--check')
if (checkMode) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'josparlau-sync-'))
  try {
    buildInto(tmp)
    execSync(`diff -r "${tmp}" "${DST}"`, { stdio: 'inherit' })
    console.log('sync-josparlau: копия соответствует источнику')
  } catch {
    console.error(
      'sync-josparlau: ДРЕЙФ — josparlau/src разошёлся с frontend/src. Запусти node tools/sync-josparlau.mjs',
    )
    process.exit(1)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
} else {
  if (!existsSync(SRC)) throw new Error('sync-josparlau: не найден источник frontend/src')
  buildInto(DST)
  console.log('sync-josparlau: josparlau/src пересобран из frontend/src')
}
