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
    for (const { body, offset } of callbackBodies(text)) {
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
