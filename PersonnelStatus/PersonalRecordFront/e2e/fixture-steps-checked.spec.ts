/**
 * Статический сторож: шаг подготовки живой пробы не имеет права молчать
 * (Plane №812, формулировка уточнена №813).
 *
 * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. Фикстура — цепочка вызовов, и каждый следующий шаг имеет
 * смысл только при успехе предыдущего. Когда серверное правило меняется
 * (`recon/complete/` начинает отвечать 422), молчащая фикстура идёт дальше, ОМ
 * остаётся на прежнем этапе, и проба падает через десять строк с «элемент не
 * найден». Настоящая причина не печатается нигде: за 05.09.2026 три сессии
 * независимо разбирали одну поломку по симптомам.
 *
 * ПРОВЕРЯЮТСЯ НЕ ВСЕ ВЫЗОВЫ, А ШАГИ-ПЕРЕХОДЫ (`TRANSITION_STEPS` в
 * `fixture-step.ts`). Требовать проверки от каждого `post` нельзя: в живых
 * пробах есть шаги, где отказ ОЖИДАЕМ и сам является предметом (действие без
 * права, повторное закрытие, черновик с неверным полем). Сторож, краснеющий и
 * там, был бы заглушён построчными исключениями и перестал бы ловить что-либо.
 *
 * ДВЕ ЗАКОННЫЕ ФОРМЫ ПРОВЕРКИ, и обе приняты:
 *   1. помощник спеки зовёт `assertStep` — тогда проверены ВСЕ его вызовы
 *      сразу (так сделаны четырнадцать живых спек);
 *   2. проверка на месте вызова — `const r = await call(…)` и следом
 *      `expect(r.status, …).toBe(200)` (так сделан `status-event-link`).
 *
 * Проба НИЧЕГО НЕ ЗАПУСКАЕТ — читает исходники спек, поэтому `SMOKE_LIVE` ей
 * не нужен и без переменной она даёт «passed», а не «skipped»: сторож, который
 * молча скипается, — это сторож, которого нет (тот же довод, что у
 * `route-map-coverage.spec.ts`, Plane №319).
 */
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { TRANSITION_STEPS } from './fixture-step'

const HERE = __dirname

/** Спеки, ещё не переведённые на проверяющий шаг. ПУСТО — и обязано остаться:
 *  строка сюда не дописывается, она чинится. */
const KNOWN_SILENT: readonly string[] = []

interface Offence {
  file: string
  line: number
  text: string
}

function liveSpecs(): string[] {
  return fs
    .readdirSync(HERE)
    .filter((name) => name.endsWith('.spec.ts'))
    .filter((name) => fs.readFileSync(path.join(HERE, name), 'utf8').includes('SMOKE_LIVE'))
}

function transitionCalls(source: string): { line: number; text: string }[] {
  const lines = source.split('\n')
  const found: { line: number; text: string }[] = []
  lines.forEach((raw, index) => {
    const text = raw.trim()
    if (text.startsWith('//') || text.startsWith('*')) return
    if (!TRANSITION_STEPS.some((step) => text.includes(step))) return
    // Вызов, а не упоминание пути в строке сравнения или в комментарии.
    if (!/\b(post|patch|put|call|fetch|request)\s*[([]/.test(text)) return
    found.push({ line: index + 1, text })
  })
  return found
}

/** Проверка НА МЕСТЕ: результат присвоен и рядом стоит `expect` про статус. */
function checkedInPlace(lines: string[], index: number): boolean {
  const statement = lines[index]!.trim()
  const assigned = /^(const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(statement)
  if (assigned === null) return false
  const name = assigned[2]!
  const window = lines.slice(index, index + 8).join('\n')
  return new RegExp(`expect\\(\\s*${name}\\b`).test(window)
}

function silentSpecs(): Record<string, Offence[]> {
  const guilty: Record<string, Offence[]> = {}
  for (const file of liveSpecs()) {
    const source = fs.readFileSync(path.join(HERE, file), 'utf8')
    const calls = transitionCalls(source)
    if (calls.length === 0) continue
    // Форма 1: помощник спеки проверяет ответ сам.
    if (source.includes('./fixture-step')) continue
    // Форма 2: каждый переход проверен на месте.
    const lines = source.split('\n')
    const offences = calls
      .filter((call) => !checkedInPlace(lines, call.line - 1))
      .map((call) => ({ file, line: call.line, text: call.text.slice(0, 90) }))
    if (offences.length > 0) guilty[file] = offences
  }
  return guilty
}

test('шаги-переходы живых фикстур проверяют ответ (Plane №812, №813)', () => {
  const guilty = silentSpecs()
  const offenders = Object.keys(guilty)
    .filter((file) => !KNOWN_SILENT.includes(file))
    .sort()

  expect(
    offenders,
    'живые спеки делают шаги-переходы, не глядя на ответ сервера. ' +
      'Отбитый шаг уводит пробу падать через десять строк и в другом месте, ' +
      'а код и тело отказа не печатаются нигде. Лечится одной строкой: ' +
      "`await assertStep(res, method, path)` в помощнике спеки.\n" +
      offenders
        .map((file) => `${file}: ${guilty[file]!.map((o) => `строка ${o.line}`).join(', ')}`)
        .join('\n'),
  ).toEqual([])
})

test('список молчащих спек не переживает починку', () => {
  const guilty = silentSpecs()
  const stale = KNOWN_SILENT.filter((file) => guilty[file] === undefined)
  expect(
    stale,
    'в списке известных молчащих спек остались файлы, которые уже проверяют ' +
      'ответ — уберите их, иначе сторож ослаблен молча',
  ).toEqual([])
})

test('сторож действительно читает живые спеки, а не пустоту', () => {
  /**
   * 🔴 Обе проверки выше сравнивают списки с пустыми, и опечатка в пути или
   * слишком узкий отбор сделали бы их вечнозелёными. Здесь названы нижние
   * границы: живых спек десятки, переходы в них находятся, и находятся именно
   * в тех файлах, где фикстура заведомо ведёт ОМ по этапам.
   */
  const specs = liveSpecs()
  expect(specs.length).toBeGreaterThan(50)
  const withSteps = specs.filter(
    (file) => transitionCalls(fs.readFileSync(path.join(HERE, file), 'utf8')).length > 0,
  )
  expect(withSteps.length).toBeGreaterThan(8)
  expect(withSteps).toContain('acknowledgement-stage.spec.ts')
  expect(withSteps).toContain('approval-stage.spec.ts')
})
