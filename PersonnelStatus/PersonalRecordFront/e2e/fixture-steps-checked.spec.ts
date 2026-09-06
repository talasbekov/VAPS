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
// 🔴 ХРАПОВИК — ДОЛГ, А НЕ РАЗРЕШЕНИЕ. Строка сюда не дописывается «чтобы
// стало зелено»: она чинится. Проба «список не переживает починку» краснеет на
// записи, которая больше не нарушение, поэтому оставить её молча нельзя.
//
// 06.09.2026 список ПУСТ. `placement-stage.spec.ts` (два непроверенных
// `placement/assign/` в помощниках `assignTo`) стоял здесь ровно столько,
// сколько файл держала соседняя сессия; как только она его отпустила, шаги
// проверены, и запись снята. Пустым список и обязан остаться.
const KNOWN_SILENT: readonly string[] = []

interface Offence {
  file: string
  line: number
  text: string
}

/**
 * 🔴 ЧИТАЮТСЯ ВСЕ ФАЙЛЫ `e2e/`, А НЕ ТОЛЬКО СПЕКИ (найдено ревью, задача
 * №825). Прежде брались только `*.spec.ts` — и ОБЩАЯ фикстура трёх спек
 * (`prepare-events.ts`) была невидима сторожу ПО УСТРОЙСТВУ. Между тем именно
 * в ней шли `recon/complete/` и `recon/import-from-passport/` без проверки
 * ответа, то есть карточка была не закрыта ровно там, где фикстура общая и
 * цена ошибки втрое выше.
 *
 * Отбор по `SMOKE_LIVE` тоже снят: у помощника этой переменной нет вовсе —
 * живым его делает то, что он ходит в API стенда. Признак теперь — наличие
 * самих шагов-переходов в тексте, и он же отсеивает чистые пробы.
 */
function liveSources(): string[] {
  const skip = new Set(['fixture-step.ts', 'fixture-steps-checked.spec.ts'])
  return fs
    .readdirSync(HERE)
    .filter((name) => name.endsWith('.ts') && !skip.has(name))
    // 🔴 МОК-ПРОБЫ СЮДА НЕ ВХОДЯТ, И ЭТО ПРЯМО ПО №813. Они ходят не в стенд,
    //    а в мок-сервер, и код ответа у них — ПРЕДМЕТ проверки, а не признак
    //    успеха подготовки: `expect(result.declineStatus).toEqual(200)`,
    //    `expect(result.emptyStatus).toEqual(400)`. Сторож, требующий
    //    `assertStep` и там, покраснел бы на честных пробах, и его начали бы
    //    глушить построчными исключениями — ровно тот исход, о котором №813
    //    предупреждает.
    .filter(
      (name) => !fs.readFileSync(path.join(HERE, name), 'utf8').includes('SMOKE_MOCK_APP'),
    )
}

function transitionCalls(source: string): { line: number; text: string }[] {
  const lines = source.split('\n')
  const found: { line: number; text: string }[] = []
  // 🔴 ВЫЗОВ СКЛЕИВАЕТСЯ ИЗ ПРОДОЛЖЕНИЙ (замерено мутацией 06.09.2026).
  //    Сторож смотрел по одной строке, и вызов, у которого имя на одной
  //    строке, а адрес на следующей, был невидим совсем — а именно так его
  //    и переносит форматирование, когда строка становится длинной. Мутация
  //    «снять проверку у одного шага» оставалась зелёной ровно поэтому.
  //    Склейка идёт до баланса скобок, не дальше пяти строк: этого хватает
  //    любому вызову фикстуры и не сливает соседние операторы в один.
  const joined = lines.map((raw, index) => {
    let text = raw
    let depth = 0
    for (const char of raw) {
      if (char === '(' || char === '[') depth += 1
      else if (char === ')' || char === ']') depth -= 1
    }
    let ahead = index
    while (depth > 0 && ahead < lines.length - 1 && ahead - index < 5) {
      ahead += 1
      const next = lines[ahead]!
      text += ' ' + next.trim()
      for (const char of next) {
        if (char === '(' || char === '[') depth += 1
        else if (char === ')' || char === ']') depth -= 1
      }
    }
    return text
  })
  // 🔴 ПУТЬ, СПРЯТАННЫЙ В ПЕРЕМЕННУЮ, ТОЖЕ ВИДЕН (Plane №857). Запись
  //    `const path = \`/api/…/placement/assign/\`` + `request.post(\`${API}${path}\`)`
  //    разносит путь и вызов по РАЗНЫМ операторам, и склейка продолжений не
  //    помогает: шаг становился сторожу невидим. Это не теория — первая
  //    редакция правки №854 была написана именно так и спрятала сама себя,
  //    а поймала это мутация, а не глаза. Собираем однострочные объявления
  //    строк и подставляем их в места употребления. Один уровень: вложенной
  //    сборки путей в фикстурах не встречается, а больше и не нужно —
  //    предмет проверки прежний, «виден ли путь в тексте вызова».
  const literals = new Map<string, string>()
  for (const line of lines) {
    const declared = /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[`'"]([^`'"]*)[`'"]\s*;?\s*$/.exec(
      line,
    )
    if (declared !== null) literals.set(declared[1]!, declared[2]!)
  }
  const expand = (text: string): string => {
    let out = text
    for (const [name, value] of literals) {
      if (!out.includes(name)) continue
      out = out.split('${' + name + '}').join(value)
    }
    return out
  }

  joined.forEach((rawLine, index) => {
    const raw = expand(rawLine)
    const text = raw.trim()
    if (text.startsWith('//') || text.startsWith('*')) return
    if (!TRANSITION_STEPS.some((step) => text.includes(step))) return
    // Вызов, а не упоминание пути в строке сравнения или в комментарии.
    // 🔴 ИМЯ ВЫЗОВА — С ЛЮБОЙ ПРИСТАВКОЙ И В ЛЮБОМ РЕГИСТРЕ (найдено ревью,
    //    задача №825). Прежняя запись с `\\b` и без флага регистра не видела
    //    `apiCall(` — а в `department-requests.spec.ts` именно так и зовут,
    //    причём без проверки статуса: `recon/import-from-passport/` и
    //    `recon/complete/` шли мимо сторожа.
    if (!/[A-Za-z_$]*(post|patch|put|call|fetch|request)\s*[([]/i.test(text)) return
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
  // Окно шире восьми строк: с тех пор как сторож склеивает многострочные
  // вызовы, сам вызов занимает до шести строк, и проверка статуса оказывается
  // за прежней границей. Замерено: `approval-route` (намеренный 422) и
  // `forces-gathering` (проверка 200 на месте) попадали в нарушители, хотя
  // проверены обе — ложное обвинение, из-за которого сторожа и начинают
  // глушить.
  const window = lines.slice(index, index + 18).join('\n')
  // 🔴 ПРЕДМЕТ ПРОВЕРКИ — «ОТВЕТ ПРОЧИТАН», А НЕ «СТОИТ `expect`». Шаг, чей
  //    ответ читают (`res.ok()`, `res.status`) и по нему принимают решение,
  //    молчащим не является: №812 ровно про то, что ответ не смотрят ВОВСЕ.
  //    Живой пример — добор поста до расчёта: отказ там ОЖИДАЕМ (свободный
  //    человек мог оказаться занят), цикл считает удачные и в конце проверяет
  //    ИТОГ (`expect(taken, 'пост не набран…')`). Требовать `assertStep` и там
  //    значило бы ронять честную подготовку — то, о чём предупреждает №813.
  return new RegExp(`(expect\\(\\s*${name}\\b|\\b${name}\\.(ok\\(\\)|status\\b))`).test(window)
}

/**
 * Проверка ПОМОЩНИКОМ: в теле функции, где стоит вызов, есть `assertStep`.
 *
 * Тело ищется по отступу: строка объявления функции и всё, что глубже её, —
 * до первой строки с отступом не больше. Разбирать TypeScript ради этого
 * незачем: у всех помощников в `e2e/` тело оформлено обычными отступами.
 */
/**
 * Имена помощников, которые проверяют ответ САМИ, — и имена, связанные с ними.
 *
 * 🔴 ЗАЧЕМ ЭТО, А НЕ ПРОСТО «ЕСТЬ ЛИ `assertStep` В ФАЙЛЕ» (задача №825).
 * Освобождение на весь файл сводило сторожа к поиску подстроки: спека с тремя
 * помощниками, где проверку получил один, проходила целиком. Освобождение
 * только по ТЕЛУ вызывающей функции — другая крайность: общая фикстура зовёт
 * `call(...)`, а проверка стоит внутри `standCall`, то есть в другом файле и
 * в другой функции.
 *
 * Поэтому собираются два множества: (1) функции, в чьём теле есть
 * `assertStep`; (2) имена, которым присвоен результат вызова такой функции
 * (`const call = standCall(token)`). Вызов через любое из них считается
 * проверенным.
 */
function assertingNames(source: string, lines: string[]): Set<string> {
  const names = new Set<string>()
  const indentOf = (line: string): number => line.length - line.trimStart().length
  lines.forEach((line, index) => {
    const declared =
      /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line) ??
      /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/.exec(line)
    if (declared === null) return
    const base = indentOf(line)
    let end = index
    while (end < lines.length - 1) {
      const next = lines[end + 1]!
      if (next.trim() !== '' && indentOf(next) <= base && !/^\s*[)}\]]/.test(next)) break
      end += 1
    }
    if (lines.slice(index, end + 1).join('\n').includes('assertStep')) names.add(declared[1]!)
  })
  // Импортированные помощники, чья проверка стоит у них внутри.
  if (/import\s*\{[^}]*standCall[^}]*\}/.test(source)) names.add('standCall')
  // Связанные имена: `const call = standCall(token)`.
  for (const line of lines) {
    const bound = /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(line)
    if (bound !== null && names.has(bound[2]!)) names.add(bound[1]!)
  }
  // И ПАРАМЕТРЫ, чей тип — возврат такого помощника: `prepareSent(call:
  // ReturnType<typeof caller>)`. Так написаны спеки согласования, и без этого
  // правила сторож обвинял бы их, хотя проверка у них стоит.
  const byType = /([A-Za-z_$][\w$]*)\s*:\s*ReturnType<typeof\s+([A-Za-z_$][\w$]*)>/g
  for (const match of source.matchAll(byType)) {
    if (names.has(match[2]!)) names.add(match[1]!)
  }
  return names
}

function checkedByHelper(lines: string[], index: number): boolean {
  const indentOf = (line: string): number => line.length - line.trimStart().length
  // 🔴 БЛИЖАЙШАЯ ОБЪЕМЛЮЩАЯ ФУНКЦИЯ, А НЕ ВЕРХНЕУРОВНЕВАЯ (замерено мутацией
  //    06.09.2026). Первая версия шла вверх до отступа НОЛЬ — а живые спеки
  //    целиком лежат внутри `test.describe(`, и «телом» оказывался весь файл:
  //    любой `assertStep` где угодно в нём освобождал любой шаг. То есть
  //    освобождение на файл вернулось бы через заднюю дверь. Мутация «снять
  //    проверку у ОДНОГО шага в файле, где есть другие» оставалась зелёной.
  const target = indentOf(lines[index] ?? '')
  let start = index
  while (start > 0) {
    const line = lines[start]!
    if (
      line.trim() !== '' &&
      indentOf(line) < target &&
      /(\bfunction\b|=>\s*\{?$|=>\s*\{)/.test(line)
    ) {
      break
    }
    start -= 1
  }
  const base = indentOf(lines[start] ?? '')
  // 🔴 БЛОК КОНЧАЕТСЯ НА СВОЕЙ ЗАКРЫВАЮЩЕЙ СКОБКЕ (замерено мутацией
  //    06.09.2026). Прежняя редакция пропускала строки, начинающиеся с
  //    закрывающей скобки, — и «телом» помощника оказывалось всё, что за ним
  //    следует: `assertStep` из СОСЕДНЕГО помощника освобождал этот. Мутация
  //    «снять проверку у одного из двух одинаковых помощников» оставалась
  //    зелёной, то есть освобождение на файл возвращалось ещё одной дорогой.
  let end = index
  while (end < lines.length - 1) {
    const line = lines[end + 1]!
    end += 1
    if (line.trim() !== '' && indentOf(line) <= base) break
  }
  return lines.slice(start, end + 1).join('\n').includes('assertStep')
}

function silentSpecs(): Record<string, Offence[]> {
  const guilty: Record<string, Offence[]> = {}
  for (const file of liveSources()) {
    const source = fs.readFileSync(path.join(HERE, file), 'utf8')
    const calls = transitionCalls(source)
    if (calls.length === 0) continue
    // 🔴 ОСВОБОЖДЕНИЕ — НЕ НА ФАЙЛ, А НА ФУНКЦИЮ (найдено ревью, задача
    //    №825). Здесь стояло `if (source.includes('./fixture-step')) continue`
    //    — то есть весь файл проходил, если строка импорта в нём просто
    //    ЕСТЬ. Замерено ревьюером: сторож находил переходы в 13 спеках и все
    //    13 освобождал этой строкой, а вторая форма (проверка на месте) не
    //    имела ни одного пользователя и не проверялась вовсе. Живой пример
    //    пропуска — `approval-stage.spec.ts`: сырой `fetch` на
    //    `placement/complete/` без единой проверки в файле, где `assertStep`
    //    зовут из другого помощника.
    //
    //    Теперь смотрится ТЕЛО ФУНКЦИИ, в котором стоит вызов: если в нём
    //    есть `assertStep` — шаг проверен помощником; иначе он обязан быть
    //    проверен на месте.
    const lines = source.split('\n')
    const asserting = assertingNames(source, lines)
    const offences = calls
      .filter((call) => {
        const callee = /([A-Za-z_$][\w$]*)\s*\(/.exec(call.text)
        if (callee !== null && asserting.has(callee[1]!)) return false
        return !checkedInPlace(lines, call.line - 1) && !checkedByHelper(lines, call.line - 1)
      })
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
  const sources = liveSources()
  expect(sources.length).toBeGreaterThan(50)
  const withSteps = sources.filter(
    (file: string) => transitionCalls(fs.readFileSync(path.join(HERE, file), 'utf8')).length > 0,
  )
  expect(withSteps.length).toBeGreaterThan(8)
  expect(withSteps).toContain('acknowledgement-stage.spec.ts')
  expect(withSteps).toContain('approval-stage.spec.ts')
  // 🔴 И ПОМОЩНИК ТОЖЕ — не только спеки (найдено ревью, задача №825): пока
  //    сторож читал одни `*.spec.ts`, общая фикстура трёх спек была невидима
  //    ему по устройству.
  expect(withSteps, 'общая фикстура снова вне поля зрения сторожа').toContain(
    'prepare-events.ts',
  )
})
