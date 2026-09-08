/**
 * Элемент списка не возвращается фрагментом без ключа (Plane №485).
 *
 * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. Ключ нужен САМОМУ элементу списка. Сокращённая запись
 * фрагмента (`<>`) атрибутов не принимает вовсе — `key` на неё не повесить, —
 * а полная (`<Fragment>`) принимает, и её так же легко оставить без ключа.
 * Ключи на внутренних строках не заменяют ни того, ни другого: React ругается
 * «Each child in a list should have a unique key», а при смене состава списка
 * группы перерисовываются лишний раз.
 *
 * Предупреждение в консоли здесь дороже, чем кажется: полный прогон требует
 * смотреть на консоль браузера, и постоянное жёлтое обесценивает эту
 * проверку — туда перестают смотреть.
 *
 * ПРОБА ЧИТАЕТ ИСХОДНИКИ, А НЕ ЭКРАН, и потому не требует `SMOKE_LIVE`:
 * предупреждение React видно только в консоли конкретного экрана с
 * конкретными данными, а класс ошибки виден в тексте. Так же устроена сверка
 * покрытия маршрутов (`route-map-coverage`).
 *
 * 🔴 ПЕРЕПИСАНА С РЕГУЛЯРКИ НА РАЗБОР (ревью №825). Первая редакция искала
 * одну синтаксическую форму — `=> (<>` — и потому:
 *   • ЗЕЛЕНЕЛА НА МУТАЦИИ СОБСТВЕННОЙ ПРАВКИ: снять `key` из
 *     `<Fragment key={…}>` в `ForceCollectionCard` — React ругается тем же
 *     самым, проба молчит;
 *   • не видела блочного тела (`.map(x => { return <>…</> })`), тернарника,
 *     `&&`, `.flatMap`, `function (x) {…}` — то есть восьми форм из девяти;
 *   • не имела нижней границы прочитанного: список каталогов был белым, а
 *     исчезнувший каталог пропускался молча — переезд `features/` сделал бы
 *     пробу вечнозелёной (ровно класс №841).
 * Теперь корень колбэка ищется разбором по балансу скобок, ветки тернарника и
 * `&&` разбираются каждая, а число прочитанных файлов проверяется ассертом.
 *
 * ЧЕГО СТОРОЖ НЕ ЛОВИТ И НЕ ОБЕЩАЕТ: элемент списка, собранный в переменную
 * выше по телу колбэка и возвращённый по имени (`const body = <>…</>; return
 * body`), и любой возврат из вложенной функции, которая не является колбэком
 * `map`. Разбор без AST дотуда не достаёт, и обещать это было бы враньём.
 *
 * 🔴 КОММЕНТАРИИ И СТРОКИ МАСКИРУЮТСЯ ДО ПОИСКА `.map(` (ревью №825,
 * 08.09.2026). Разбор корня колбэка честно снимает комментарий МЕЖДУ стрелкой
 * и телом (`skipGap`) — но САМ поиск `.map(`/`.flatMap(` (`callbackBodies`)
 * шёл по СЫРОМУ тексту файла: `// items.map(x => <>{x}</>)` в комментарии,
 * `` `items.map(x => <>{x}</>)` `` в JSDoc-примере или строковом литерале
 * находились и разбирались как настоящий код. Первый же пример «как не надо
 * делать» сделал бы сторожа постоянно красным — и красным неправильно.
 * `maskNonCode` заменяет комментарии и содержимое строк/шаблонных литералов
 * пробелами (переводы строк и длина текста не меняются, поэтому номера строк
 * не едут), а код внутри `${…}` шаблонного литерала остаётся кодом.
 */
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/** Каталоги, куда сторож не ходит: чужой код и сборочный мусор. */
const SKIP = new Set(['node_modules', '.next', '.next-build', '.next-mock', '.git', 'e2e'])

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsxFiles(full))
    else if (entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Пробелы и комментарии — всё, что может стоять между стрелкой и корнем.
 *  Комментарий учитывается не для красоты: без него разбор пропускал бы ровно
 *  то место, где стоит объяснение правки. */
function skipGap(text: string, at: number): number {
  let i = at
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i += 1
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      continue
    }
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end + 1
      continue
    }
    return i
  }
}

/** Открывающий тег фрагмента без ключа — либо `<>`, либо `<Fragment …>` /
 *  `<React.Fragment …>`, в котором нет `key`. */
function keylessFragmentAt(text: string, at: number): boolean {
  if (text.startsWith('<>', at)) return true
  const named = /^<(?:React\.)?Fragment(?=[\s/>])/.exec(text.slice(at, at + 40))
  if (named === null) return false
  const close = text.indexOf('>', at)
  if (close === -1) return false
  return !/\bkey\s*=/.test(text.slice(at, close))
}

/**
 * Позиции «отсюда начинается возвращаемое значение» внутри колбэка: сразу за
 * стрелкой, сразу за `return`, и — рекурсивно — каждая ветка тернарника и
 * правая часть `&&`/`||` на верхнем уровне такого значения.
 */
function returnPositions(body: string): number[] {
  const starts: number[] = []
  for (const hit of body.matchAll(/=>|(?<![\w$])return(?![\w$])/g)) {
    starts.push(hit.index! + hit[0].length)
  }
  const out: number[] = []
  for (const start of starts) {
    let i = skipGap(body, start)
    while (body[i] === '(') i = skipGap(body, i + 1)
    out.push(i)
    // Ветки условного выражения — тоже возвращаемые значения. Идём по
    // верхнему уровню до конца выражения и берём то, что стоит за `?`, `:`,
    // `&&`, `||`.
    let depth = 0
    for (let j = i; j < body.length; j += 1) {
      const ch = body[j]
      if (ch === '(' || ch === '[' || ch === '{') depth += 1
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth -= 1
        if (depth < 0) break
      } else if (depth === 0) {
        if (ch === ';') break
        if (ch === '?' || ch === ':') out.push(skipGap(body, j + 1))
        else if (body.startsWith('&&', j) || body.startsWith('||', j)) {
          out.push(skipGap(body, j + 2))
          j += 1
        }
      }
    }
  }
  return out
}

/**
 * Комментарии и содержимое строк/шаблонных литералов заменяются пробелами —
 * длина и переводы строк не меняются, поэтому смещения и номера строк
 * остаются верными для ИСХОДНОГО текста. Код внутри `${…}` шаблонного
 * литерала не маскируется: там может стоять настоящий `.map(`.
 */
function maskNonCode(text: string): string {
  const out = text.split('')
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i += 1) if (out[i] !== '\n') out[i] = ' '
  }
  let i = 0
  while (i < text.length) {
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i)
      blank(i, end === -1 ? text.length : end)
      i = end === -1 ? text.length : end
      continue
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? text.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1
      blank(i, Math.min(j + 1, text.length))
      i = j + 1
      continue
    }
    if (ch === '`') {
      // Шаблонный литерал: маскируется САМ ТЕКСТ, а `${…}` — рекурсивно код,
      // не маскируется (там может стоять настоящий `.map(`).
      let j = i + 1
      let segStart = i
      while (j < text.length && text[j] !== '`') {
        if (text[j] === '\\') {
          j += 2
          continue
        }
        if (text.startsWith('${', j)) {
          blank(segStart, j)
          let depth = 1
          j += 2
          while (j < text.length && depth > 0) {
            if (text[j] === '{') depth += 1
            else if (text[j] === '}') depth -= 1
            j += 1
          }
          segStart = j
          continue
        }
        j += 1
      }
      blank(segStart, Math.min(j, text.length))
      i = Math.min(j + 1, text.length)
      continue
    }
    i += 1
  }
  return out.join('')
}

/** Тело колбэка, переданного в `.map(` / `.flatMap(` / `Children.map(`. */
function callbackBodies(text: string): { body: string; offset: number }[] {
  const out: { body: string; offset: number }[] = []
  for (const hit of text.matchAll(/\.(?:flatMap|map)\(/g)) {
    const open = hit.index! + hit[0].length - 1
    let depth = 0
    let end = -1
    for (let i = open; i < text.length; i += 1) {
      const ch = text[i]
      if (ch === '(') depth += 1
      else if (ch === ')') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) continue
    out.push({ body: text.slice(open + 1, end), offset: open + 1 })
  }
  return out
}

test('элемент списка не возвращается фрагментом без ключа', () => {
  const root = path.join(__dirname, '..')
  const files = tsxFiles(root)
  // 🔴 НИЖНЯЯ ГРАНИЦА. Без неё переезд каталогов делает сторожа вечнозелёным
  // молча — тот же класс, ради которого заведена №841. Порог занижен нарочно:
  // он отвечает на вопрос «проба вообще что-нибудь прочитала», а не «сколько
  // именно файлов сегодня в дереве».
  expect(files.length, 'сторож не нашёл исходников — читать нечего').toBeGreaterThan(100)
  const known = path.join(root, 'features', 'force-collections', 'ui', 'ForceCollectionCard.tsx')
  expect(
    files,
    'файла, ради которого заведён сторож, нет в обходе — проба вакуумна',
  ).toContain(known)

  const guilty: string[] = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    // Поиск `.map(`/`.flatMap(` идёт по МАСКИРОВАННОМУ тексту — комментарий
    // и строковый пример не должны находиться как настоящий вызов. Смещения
    // те же, что у `text`: маска не меняет длину и переводы строк.
    for (const { body, offset } of callbackBodies(maskNonCode(text))) {
      for (const at of returnPositions(body)) {
        if (!keylessFragmentAt(body, at)) continue
        const line = text.slice(0, offset + at).split('\n').length
        guilty.push(`${path.relative(root, file)}:${line}`)
      }
    }
  }
  expect(
    [...new Set(guilty)].sort(),
    'элемент списка возвращён фрагментом без ключа: ключ нужен САМОМУ элементу ' +
      'списка — используйте <Fragment key={…}>',
  ).toEqual([])
})

test('пример без ключа в комментарии, JSDoc или строке не обвиняется', () => {
  /**
   * 🔴 ЧТО ЭТО СТЕРЕЖЁТ (ревью №825 по №485, 08.09.2026). До маскировки
   * `callbackBodies` искал `.map(` по СЫРОМУ тексту: комментарий, JSDoc-пример
   * «как не надо делать» и строковый литерал с тем же текстом обвинялись как
   * настоящий код. Первый же такой пример превратил бы сторожа в постоянно
   * красный, и красным неправильно.
   *
   * КРАСНАЯ ПРОБА: убери `maskNonCode` из вызова `callbackBodies` в самом
   * тесте выше — эти пять форм снова попадут в список виновных.
   */
  const samples = [
    '// items.map(x => <>{x}</>)',
    '/* items.map(x => <>{x}</>) */',
    '/**\n * Example: items.map(x => <>{x}</>)\n */',
    'const doc = "items.map(x => <>{x}</>)"',
    'const doc = `items.map(x => <>{x}</>)`',
  ]
  for (const sample of samples) {
    const guilty: string[] = []
    const masked = maskNonCode(sample)
    for (const { body, offset } of callbackBodies(masked)) {
      for (const at of returnPositions(body)) {
        if (keylessFragmentAt(body, at)) guilty.push(`${offset}:${at}`)
      }
    }
    expect(guilty, `ложно обвинён пример: ${sample}`).toEqual([])
  }

  // Обратная сторона: код внутри `${…}` шаблонного литерала — настоящий, и
  // маска не должна его прятать.
  const real = 'const x = `${items.map(x => <>{x}</>)}`'
  const guiltyReal: string[] = []
  for (const { body, offset } of callbackBodies(maskNonCode(real))) {
    for (const at of returnPositions(body)) {
      if (keylessFragmentAt(body, at)) guiltyReal.push(`${offset}:${at}`)
    }
  }
  expect(guiltyReal, 'настоящий вызов внутри ${…} маска спрятала').not.toEqual([])
})
