/**
 * Элемент списка не возвращается сокращённым фрагментом `<>` (Plane №485).
 *
 * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. Ключ нужен САМОМУ элементу списка, а сокращённая
 * запись фрагмента атрибутов не принимает вовсе — `key` на неё не повесить.
 * Ключи на внутренних строках его не заменяют: React ругается «Each child in
 * a list should have a unique key», а при смене состава списка группы
 * перерисовываются лишний раз.
 *
 * Предупреждение в консоли здесь дороже, чем кажется: полный прогон требует
 * смотреть на консоль браузера, и постоянное жёлтое обесценивает эту
 * проверку — туда перестают смотреть.
 *
 * ПРОБА ЧИТАЕТ ИСХОДНИКИ, А НЕ ЭКРАН, и потому не требует `SMOKE_LIVE`:
 * предупреждение React видно только в консоли конкретного экрана с
 * конкретными данными, а класс ошибки виден в тексте. Так же устроена сверка
 * покрытия маршрутов (`route-map-coverage`).
 */
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const ROOTS = ['app', 'features', 'widgets', 'components', 'entities', 'shared']

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsxFiles(full))
    else if (entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Пробел, перевод строки или комментарий — всё, что может стоять между
 *  стрелкой и корневым элементом. Комментарий учитывается не для красоты:
 *  без него разбор пропускал бы ровно то место, где стоит объяснение правки. */
const GAP = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*`

/** `.map(… => (<>` и `.map(… => <>` — фрагмент как КОРЕНЬ элемента списка. */
const KEYLESS_IN_MAP = new RegExp(
  String.raw`\.map\(` + GAP + String.raw`(?:async` + GAP + String.raw`)?\(?[^)=]*\)?` +
    GAP + String.raw`=>` + GAP + String.raw`\(?` + GAP + String.raw`<>`,
  'g',
)

test('элемент списка не возвращается фрагментом без ключа', () => {
  const root = path.join(__dirname, '..')
  const guilty: string[] = []
  for (const dir of ROOTS) {
    const full = path.join(root, dir)
    if (!fs.existsSync(full)) continue
    for (const file of tsxFiles(full)) {
      const text = fs.readFileSync(file, 'utf8')
      for (const hit of text.matchAll(KEYLESS_IN_MAP)) {
        const line = text.slice(0, hit.index).split('\n').length
        guilty.push(`${path.relative(root, file)}:${line}`)
      }
    }
  }
  expect(
    guilty,
    'элемент списка возвращён сокращённым фрагментом: ключ повесить не на что — ' +
      'используйте <Fragment key={…}>',
  ).toEqual([])
})
