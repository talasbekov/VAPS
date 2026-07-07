// Канон-самотест стори 8.2 — «зеркало AST-тестов бэка» (ARCH-FE-013).
// src/features и src/shared пусты до 8.4+, поэтому матрица boundaries доказуема
// ТОЛЬКО фикстурами: создаём временные файлы-нарушители, прогоняем eslint через
// Node API и ассертим КОНКРЕТНЫЕ ruleId (урок 8.1: «есть хоть какая-то ошибка» —
// не доказательство; вакуумный pass запрещён). Негативные контроли обязательны
// по КАЖДОМУ разрешённому направлению матрицы — иначе конфиг «всё запрещено»
// тоже прошёл бы (ревью 8.2: одного features→shared было мало).
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { join, relative, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadESLint } from 'eslint'

// fileURLToPath, не URL.pathname — путь репо содержит кириллицу
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')

// PID-суффикс: параллельные прогоны (gate + IDE/второй терминал) не коллидируют
// на фиксированных путях; gitignore/eslint-ignores/tsconfig-exclude матчат __canon_*
const PID = process.pid
const A_NAME = `__canon_a_${PID}__`
const B_NAME = `__canon_b_${PID}__`
const S_NAME = `__canon_s_${PID}__`
const APP_NAME = `__canon_app_${PID}__`
const X_NAME = `__canon_x_${PID}__` // намеренно ВНЕ app/features/shared
const API_NAME = `__canon_api_${PID}__` // ВНУТРИ shared/api: негативный контроль банов HTTP
const A = join(SRC, 'features', A_NAME)
const B = join(SRC, 'features', B_NAME)
const S = join(SRC, 'shared', S_NAME)
const APP = join(SRC, 'app', APP_NAME)
const X = join(SRC, X_NAME)
const API = join(SRC, 'shared', 'api', API_NAME)

const failures = []

function expectRule(results, file, ruleId) {
  const r = results.find((x) => x.filePath.endsWith(file))
  // severity 2 обязательна: канон «error, не warn» — warn прошёл бы мимо гейта
  const hit = r?.messages.some((m) => m.ruleId === ruleId && m.severity === 2)
  if (!hit) {
    const got =
      r?.messages.map((m) => `${m.ruleId}(sev${m.severity})`).join(', ') ||
      'ноль ошибок'
    failures.push(
      `ОЖИДАЛ ${ruleId} со severity=error в ${file}, получил: ${got}`,
    )
  }
}

function expectClean(results, file) {
  const r = results.find((x) => x.filePath.endsWith(file))
  const errs = r?.messages.filter((m) => m.severity === 2) ?? []
  if (errs.length) {
    failures.push(
      `ОЖИДАЛ зелёный ${file}, получил: ${errs.map((m) => m.ruleId).join(', ')}`,
    )
  }
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

function walkDirs(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? [p, ...walkDirs(p)] : []
  })
}

const isCanonFixture = (p) => /__canon_.*__/.test(p)

// Сироты от аварийно прерванных прогонов (kill −9 до finally): tsc/eslint их
// не видят (exclude/ignores), но гигиена дерева — забота самотеста
function precleanOrphans() {
  for (const d of walkDirs(SRC)) {
    if (/^__canon_.*__$/.test(basename(d))) {
      rmSync(d, { recursive: true, force: true })
    }
  }
}

function barrelOffenders() {
  return walk(SRC).filter((f) => /(^|\/)index\.tsx?$/.test(f))
}

// ARCH-FE-013 + TS-only src: .js/.jsx/.mjs/.cjs невидимы для канон-блоков eslint
// (матчат только ts/tsx) — значит, сам факт такого файла в src запрещён
function nonTsOffenders() {
  return walk(SRC).filter((f) => /\.(js|jsx|mjs|cjs)$/.test(f))
}

precleanOrphans()

try {
  mkdirSync(A, { recursive: true })
  mkdirSync(B, { recursive: true })
  mkdirSync(S, { recursive: true })
  mkdirSync(APP, { recursive: true })
  mkdirSync(X, { recursive: true })
  mkdirSync(API, { recursive: true })
  writeFileSync(join(B, 'x.ts'), 'export const b = 1\n')
  writeFileSync(join(S, 'x.ts'), 'export const s = 1\n')
  writeFileSync(join(A, 'base.ts'), 'export const base = 1\n')
  // нарушители
  writeFileSync(
    join(A, 'cross.ts'),
    `import { b } from "../${B_NAME}/x"\nexport const a = b + 1\n`,
  )
  writeFileSync(
    join(A, 'banned.ts'),
    'import type { StoreApi } from "zustand"\nexport type T = StoreApi<unknown>\n',
  )
  // бан-фикстура ВНЕ features: доказывает общий src-блок банов
  // (фикстуры в features исполняют только features-переопределение)
  writeFileSync(
    join(S, 'banned.ts'),
    'import type { StoreApi } from "zustand"\nexport type T = StoreApi<unknown>\n',
  )
  writeFileSync(
    join(A, 'mutation.ts'),
    'import { useMutation } from "@tanstack/react-query"\nexport const m = useMutation\n',
  )
  writeFileSync(
    join(A, 'Hook.tsx'),
    'import { useState } from "react"\n' +
      'export function Probe({ flag }: { flag: boolean }) {\n' +
      '  if (flag) {\n' +
      '    const [x] = useState(0)\n' +
      '    return <span>{x}</span>\n' +
      '  }\n' +
      '  return null\n' +
      '}\n',
  )
  writeFileSync(
    join(S, 'up.ts'),
    `import { b } from "../../features/${B_NAME}/x"\nexport const bad = b\n`,
  )
  // файл вне app/features/shared: сам факт — нарушение (no-unknown-files),
  // импорт В него из известного элемента — no-unknown
  writeFileSync(
    join(X, 'escape.ts'),
    `import { b } from "../features/${B_NAME}/x"\nexport const esc = b\n`,
  )
  writeFileSync(
    join(A, 'uses-unknown.ts'),
    `import { esc } from "../../${X_NAME}/escape"\nexport const u = esc\n`,
  )
  // легальные направления (негативные контроли — ВСЕ разрешённые рёбра матрицы)
  writeFileSync(
    join(A, 'legal.ts'),
    `import { s } from "../../shared/${S_NAME}/x"\nexport const ok = s + 1\n`,
  )
  writeFileSync(
    join(A, 'same.ts'),
    'import { base } from "./base"\nexport const same = base + 1\n',
  )
  writeFileSync(
    join(APP, 'probe.ts'),
    `import { b } from "../../features/${B_NAME}/x"\n` +
      `import { s } from "../../shared/${S_NAME}/x"\n` +
      'export const app = b + s\n',
  )
  // ARCH-FE-015 (8.4): HTTP вне shared/api забанен — краснота по каждому каналу;
  // каждый канал — отдельная фикстура, иначе expectRule докажет соседний канал
  writeFileSync(join(A, 'fetch.ts'), 'export const r = fetch("/api/x")\n')
  writeFileSync(join(A, 'xhr.ts'), 'export const x = new XMLHttpRequest()\n')
  writeFileSync(
    join(A, 'winfetch.ts'),
    'export const w = window.fetch("/api/x")\n' +
      'export const g = globalThis.fetch("/api/x")\n',
  )
  // property-каналы XHR (ревью 8.4): бан глобала обходился через window.XMLHttpRequest
  writeFileSync(
    join(A, 'winxhr.ts'),
    'export const wx = new window.XMLHttpRequest()\n' +
      'export const gx = new globalThis.XMLHttpRequest()\n',
  )
  writeFileSync(
    join(A, 'axios.ts'),
    'import axios from "axios"\nexport const ax = axios\n',
  )
  // негативный контроль: fetch ВНУТРИ shared/api легален — block-scoped ignores
  // остаются активны под ignore:false (гасятся только глобальные) — Ловушка 8
  writeFileSync(
    join(API, 'probe.ts'),
    'export const probe = () => fetch("/api/x")\n',
  )
  // негативный контроль ARCH-FE-015 (8.5): useMutation в features красный
  // (mutation.ts выше), а канонная замена — useApiMutation из shared/api
  // прямым путём (без barrel) — зелёная
  writeFileSync(
    join(A, 'uses-api-mutation.ts'),
    'import { useApiMutation } from "../../shared/api/useApiMutation"\n' +
      'export const hook = useApiMutation\n',
  )
  // негативный контроль (8.6): канонный auth-хук из features прямым путём
  // (shared/auth — новый слот-зеркало core/auth бэка; barrel-index запрещён)
  writeFileSync(
    join(A, 'uses-permissions.ts'),
    'import { usePermissions } from "../../shared/auth/usePermissions"\n' +
      'export const perms = usePermissions\n',
  )
  // ARCH-FE-012 ужесточение (8.7): literal-пути вне routes.ts красные —
  // по каналу на фикстуру (navigate-вызов и JSX-атрибут to); фикстуры в app —
  // тесты из-под правила выведены осознанно (Ловушка 9), app-код им покрыт
  writeFileSync(
    join(APP, 'nav-literal.tsx'),
    'import { useNavigate } from "react-router"\n' +
      'export function Probe() {\n' +
      '  const navigate = useNavigate()\n' +
      '  return (\n' +
      '    <button type="button" onClick={() => navigate("/literal")}>x</button>\n' +
      '  )\n' +
      '}\n',
  )
  writeFileSync(
    join(APP, 'link-literal.tsx'),
    'import { Link } from "react-router"\n' +
      'export function Probe() {\n' +
      '  return <Link to="/literal">x</Link>\n' +
      '}\n',
  )
  // канал path (<Route path="/literal">) — свой селектор, своя фикстура
  // (ревью 8.7: живой пробы Task 12 мало — без фикстуры регресс селектора
  // прошёл бы гейт молча)
  writeFileSync(
    join(APP, 'route-literal.tsx'),
    'import { Route } from "react-router"\n' +
      'export function Probe() {\n' +
      '  return <Route path="/literal" element={null} />\n' +
      '}\n',
  )
  // шаблонный литерал БЕЗ подстановки — тот же literal-канал (обход бана,
  // ревью 8.7): navigate(`/x`) и to={`/x`} красные
  writeFileSync(
    join(APP, 'template-literal.tsx'),
    'import { Link, useNavigate } from "react-router"\n' +
      'export function Probe() {\n' +
      '  const navigate = useNavigate()\n' +
      '  return (\n' +
      '    <div>\n' +
      '      <button type="button" onClick={() => navigate(`/literal`)}>x</button>\n' +
      '      <Link to={`/literal`}>x</Link>\n' +
      '    </div>\n' +
      '  )\n' +
      '}\n',
  )
  // ARCH-FE-014 enforcement (8.7): не-токенный произвол красный
  writeFileSync(
    join(APP, 'custom-class.tsx'),
    'export function Probe() {\n' +
      '  return <div className="__not_a_token_class">x</div>\n' +
      '}\n',
  )
  // негативные контроли 8.7: те же места с константами ROUTES зелёные
  // (+ токен-классы донора не считаются «кастомными»; шаблон С подстановкой
  // ROUTES.* легален — бан только на без-подстановочные литералы)
  writeFileSync(
    join(APP, 'nav-const.tsx'),
    'import { useNavigate } from "react-router"\n' +
      'import { ROUTES } from "../../shared/routes"\n' +
      'export function Probe() {\n' +
      '  const navigate = useNavigate()\n' +
      '  return (\n' +
      '    <div>\n' +
      '      <button type="button" onClick={() => navigate(ROUTES.home)}>x</button>\n' +
      '      <button\n' +
      '        type="button"\n' +
      '        onClick={() => navigate(`${ROUTES.home}?tab=day`)}\n' +
      '      >\n' +
      '        x\n' +
      '      </button>\n' +
      '    </div>\n' +
      '  )\n' +
      '}\n',
  )
  writeFileSync(
    join(APP, 'link-const.tsx'),
    'import { Link } from "react-router"\n' +
      'import { ROUTES } from "../../shared/routes"\n' +
      'export function Probe() {\n' +
      '  return (\n' +
      '    <Link className="bg-sidebar p-2 text-sidebar-foreground" to={ROUTES.home}>\n' +
      '      x\n' +
      '    </Link>\n' +
      '  )\n' +
      '}\n',
  )
  // barrel-фикстура: сканер обязан её увидеть (самопроверка сканера)
  writeFileSync(join(A, 'index.ts'), 'export { ok } from "./legal"\n')
  // не-TS фикстура: сканер TS-only обязан её увидеть (самопроверка сканера)
  writeFileSync(join(A, 'probe.js'), 'export const js = 1\n')

  const ESLint = await loadESLint()
  const eslint = new ESLint({ cwd: ROOT, ignore: false })
  const results = await eslint.lintFiles([
    join(A, '*.{ts,tsx}'),
    join(S, '*.ts'),
    join(APP, '*.{ts,tsx}'),
    join(X, '*.ts'),
    join(API, '*.ts'),
  ])

  // красные: запрещённые рёбра и баны
  expectRule(results, `${A_NAME}/cross.ts`, 'boundaries/dependencies')
  expectRule(
    results,
    `${A_NAME}/banned.ts`,
    '@typescript-eslint/no-restricted-imports',
  )
  expectRule(
    results,
    `${S_NAME}/banned.ts`,
    '@typescript-eslint/no-restricted-imports',
  )
  expectRule(
    results,
    `${A_NAME}/mutation.ts`,
    '@typescript-eslint/no-restricted-imports',
  )
  expectRule(results, `${A_NAME}/Hook.tsx`, 'react-hooks/rules-of-hooks')
  expectRule(results, `${S_NAME}/up.ts`, 'boundaries/dependencies')
  // красные: побег из матрицы размещением файла (ревью 8.2)
  expectRule(results, `${X_NAME}/escape.ts`, 'boundaries/no-unknown-files')
  expectRule(
    results,
    `${A_NAME}/uses-unknown.ts`,
    'boundaries/no-unknown-dependencies',
  )
  // красные: HTTP вне shared/api (ARCH-FE-015, стори 8.4)
  expectRule(results, `${A_NAME}/fetch.ts`, 'no-restricted-globals')
  expectRule(results, `${A_NAME}/xhr.ts`, 'no-restricted-globals')
  expectRule(results, `${A_NAME}/winfetch.ts`, 'no-restricted-properties')
  expectRule(results, `${A_NAME}/winxhr.ts`, 'no-restricted-properties')
  expectRule(
    results,
    `${A_NAME}/axios.ts`,
    '@typescript-eslint/no-restricted-imports',
  )
  // красные: literal-пути вне routes.ts (ARCH-FE-012, стори 8.7)
  expectRule(results, `${APP_NAME}/nav-literal.tsx`, 'no-restricted-syntax')
  expectRule(results, `${APP_NAME}/link-literal.tsx`, 'no-restricted-syntax')
  // канал path и без-подстановочные шаблонные литералы (ревью 8.7)
  expectRule(results, `${APP_NAME}/route-literal.tsx`, 'no-restricted-syntax')
  expectRule(
    results,
    `${APP_NAME}/template-literal.tsx`,
    'no-restricted-syntax',
  )
  // красный: не-токенный classname (ARCH-FE-014, стори 8.7)
  expectRule(
    results,
    `${APP_NAME}/custom-class.tsx`,
    'tailwindcss/no-custom-classname',
  )
  // зелёные: все разрешённые рёбра матрицы
  expectClean(results, `${A_NAME}/legal.ts`) // features → shared
  expectClean(results, `${A_NAME}/same.ts`) // та же фича
  expectClean(results, `${APP_NAME}/probe.ts`) // app → features + shared
  expectClean(results, `${API_NAME}/probe.ts`) // fetch внутри shared/api легален
  expectClean(results, `${A_NAME}/uses-api-mutation.ts`) // канонный хук из features (8.5)
  expectClean(results, `${A_NAME}/uses-permissions.ts`) // канонный auth-хук из features (8.6)
  expectClean(results, `${APP_NAME}/nav-const.tsx`) // navigate(ROUTES.*) и шаблон С подстановкой легальны (8.7)
  expectClean(results, `${APP_NAME}/link-const.tsx`) // to={ROUTES.*} + токен-классы легальны (8.7)

  // сканеры видят свои фикстуры → сканеры живые, не вакуумные
  if (!barrelOffenders().some((f) => f.includes(A_NAME))) {
    failures.push('barrel-сканер НЕ увидел фикстурный index.ts — сканер сломан')
  }
  if (!nonTsOffenders().some((f) => f.includes(A_NAME))) {
    failures.push(
      'TS-only-сканер НЕ увидел фикстурный probe.js — сканер сломан',
    )
  }
} finally {
  rmSync(A, { recursive: true, force: true })
  rmSync(B, { recursive: true, force: true })
  rmSync(S, { recursive: true, force: true })
  rmSync(APP, { recursive: true, force: true })
  rmSync(X, { recursive: true, force: true })
  rmSync(API, { recursive: true, force: true })
}

// реальное дерево (фикстуры параллельных прогонов не считаем):
// баррелей быть не должно (ARCH-FE-013 MUST NOT), src — TS-only
const realBarrels = barrelOffenders().filter((f) => !isCanonFixture(f))
if (realBarrels.length) {
  failures.push(
    `barrel-index в src/ запрещён (ARCH-FE-013): ${realBarrels.map((f) => relative(ROOT, f)).join(', ')}`,
  )
}
const realNonTs = nonTsOffenders().filter((f) => !isCanonFixture(f))
if (realNonTs.length) {
  failures.push(
    `не-TS код в src/ запрещён (канон-блоки eslint видят только ts/tsx): ${realNonTs.map((f) => relative(ROOT, f)).join(', ')}`,
  )
}

if (failures.length) {
  console.error('lint-canon: КАНОН НЕ ДОКАЗАН:')
  failures.forEach((f) => console.error(`  ${f}`))
  process.exit(1)
}
console.log(
  'lint-canon: 18 красных фикстур + 8 негативных контролей + barrel/TS-only-сканы — канон доказан',
)
