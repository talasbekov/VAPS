/**
 * Мутирующая проба заводит СВОЮ фикстуру безусловно, а не берёт стендовую
 * (Plane №822).
 *
 * 🔴 ПОЧЕМУ ПРОБА НЕ ЖИВАЯ. Она читает ИСХОДНИКИ, потому что стерегомая беда
 * на живом прогоне ПРОЯВЛЯЕТСЯ ЧЕРЕЗ РАЗ — в том и дефект. Антишаблон
 * выглядит так:
 *
 *     let event = suitable(await events(token))
 *     if (event === undefined) {
 *       await prepareEvent(token)      // ← подготовка ВНУТРИ if
 *       event = suitable(await events(token))
 *     }
 *
 * «Возьми первое подходящее, а заведи своё только если не нашлось». На чистой
 * базе он заводит своё и зелен; на живом стенде берёт ЧУЖОЕ мероприятие и
 * правит его. Стенд один на все сессии, соседняя ведёт тот же ОМ своим путём —
 * и падение выглядит ровно тем симптомом, который проба стережёт, то есть
 * врёт про дефект. Замерено 05.09.2026 на `recon-stage`: ✓ ✘ ✓ ✘ без единой
 * правки кода.
 *
 * Приём тот же, что у `right-hint-pattern`, `route-map-coverage` и
 * `ru-plural-single-rule`: без `SMOKE_LIVE` даёт «passed», а не «skipped», —
 * иначе сторож молча пропускался бы и читался как зелень.
 *
 * ЧИТАЮЩИЕ ПРОБЫ ЭТОТ СТОРОЖ НЕ ТРОГАЕТ. Им первое подходящее по-прежнему
 * годится: они ничего не меняют. Признак — подготовка ВНУТРИ условия, а не
 * само обращение к реестру.
 */
import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const E2E = __dirname

/**
 * 🔴 ХРАПОВИК, А НЕ РАЗРЕШЕНИЕ. Здесь перечислено то, что нарушало правило в
 * момент написания сторожа (06.09.2026, замер: шесть файлов, пятнадцать мест).
 * Список существует ровно затем, чтобы сторож был зелёным СЕГОДНЯ и краснел на
 * ЗАВТРАШНЕМ нарушении.
 *
 * НОВАЯ СТРОКА СЮДА НЕ ДОПИСЫВАЕТСЯ — она чинится. А починенная снимается:
 * `сторож не гниёт` краснеет на файле, который больше не нарушает, поэтому
 * оставить его здесь «на всякий случай» нельзя.
 *
 * Кто снимает: `acknowledgement-stage` снят в Ш-2, `approval-stage` — в Ш-3.
 * Остальные планом №822 НЕ покрыты и живут здесь до Plane №853:
 * `approval-print`, `approval-rights`, `bulletin-stage`, остаток
 * `recon-stage` и `placement-pool` (Ш-4 берёт `placement-stage` — это ДРУГОЙ
 * файл, и спутать их легко).
 */
const KNOWN_LAZY_PREPARATION = new Map<string, number>([
  // ПУСТ с 06.09.2026 (Plane №853): последние шесть файлов переведены на своё.
  // Пустым и обязан остаться — новая строка сюда не дописывается, она чинится.
])

/**
 * Комментарии выбрасываются ДО разбора.
 *
 * 🔴 БЕЗ ЭТОГО СТОРОЖ ЛОВИТ САМ СЕБЯ: антишаблон выписан примером в шапке
 * этого файла, и первый же прогон объявил нарушителем сторожа. Заодно
 * снимается ложная тревога на закомментированном коде — он не выполняется, и
 * чужого мероприятия не берёт.
 *
 * Разбор нарочно грубый (строки не разбираются): `//` и `/* … *\/` внутри
 * строкового литерала здесь не встречаются, а усложнять сторож ради случая,
 * которого нет, значит завести в нём собственный дефект.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Тело `if (X === undefined) { … }` — по БАЛАНСУ СКОБОК, а не регуляркой:
 * перенос строки prettier'ом такому разбору безразличен (урок №801). */
function lazyPreparations(raw: string): number {
  const source = withoutComments(raw)
  let count = 0
  const opener = /if \([A-Za-z_$][\w$]* === undefined\) \{/g
  let match: RegExpExecArray | null
  while ((match = opener.exec(source)) !== null) {
    const start = source.indexOf('{', match.index)
    let depth = 0
    for (let i = start; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') {
        depth -= 1
        if (depth === 0) {
          if (/\bprepare\w*\(/.test(source.slice(start, i + 1))) count += 1
          break
        }
      }
    }
  }
  return count
}

function specs(): string[] {
  return readdirSync(E2E).filter((name) => name.endsWith('.spec.ts'))
}

test.describe('своя фикстура у мутирующих проб', () => {
  test('подготовка не прячется внутрь условия', () => {
    const offenders = specs()
      .map((name) => ({ name, count: lazyPreparations(readFileSync(join(E2E, name), 'utf8')) }))
      .filter(({ name, count }) => count > 0 && !KNOWN_LAZY_PREPARATION.has(name))
    expect(
      offenders,
      'подготовка фикстуры стоит внутри `if (… === undefined)` — значит проба ' +
        'возьмёт чужое мероприятие, когда подходящее найдётся на стенде. ' +
        'Заводить своё надо БЕЗУСЛОВНО (Plane №822)',
    ).toEqual([])
  })

  test('сторож не гниёт: починенное снимается из списка', () => {
    const stale: string[] = []
    const grown: string[] = []
    for (const [name, known] of KNOWN_LAZY_PREPARATION) {
      const count = lazyPreparations(readFileSync(join(E2E, name), 'utf8'))
      if (count === 0) stale.push(name)
      if (count > known) grown.push(`${name}: было ${known}, стало ${count}`)
    }
    expect(stale, 'файл больше не нарушает — снимите его из KNOWN_LAZY_PREPARATION').toEqual([])
    expect(grown, 'в известном файле нарушений СТАЛО БОЛЬШЕ — это новая, а не старая беда').toEqual([])
  })
})
