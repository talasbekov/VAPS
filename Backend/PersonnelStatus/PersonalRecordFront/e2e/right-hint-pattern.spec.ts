/**
 * Причина, по которой действие закрыто правом, ДОСТИЖИМА и сказана ОДИН РАЗ
 * (Plane №801).
 *
 * 🔴 ПОЧЕМУ ПРОБА НЕ ЖИВАЯ. Она читает ИСХОДНИКИ и отвечает на два вопроса:
 * не вернулась ли связка «`disabled` по праву + `title` с причиной» и не
 * начала ли обёртка `RightGate` печатать причину у каждой кнопки. Живой прогон
 * на первое не годится вовсе — подсказки на выключенной кнопке не видно НИ ПРИ
 * КАКОМ поведении браузера, ровно поэтому дефект и жил незамеченным. Тот же
 * приём, что у `route-map-coverage` и `ru-plural-single-rule`; без `SMOKE_LIVE`
 * даёт «passed», а не «skipped».
 *
 * 🔴 ЧТО ИЗМЕНИЛОСЬ ПОСЛЕ РЕВЮ (06.09.2026, задача №825). Прежняя проба
 * искала `title={access.reason(` регулярным выражением и смотрела в список из
 * четырёх файлов. Оба решения оказались дырявыми:
 *   — prettier переносит длинное выражение на следующую строку, и запись
 *     становится `title={\n  access.reason(…)`. Регулярка её не видела, а
 *     живой пример был прямо в стерегомом файле — `PlacementStage.tsx`,
 *     кнопка назначения кандидата на пост;
 *   — список экранов пропускал `AcknowledgementStage.tsx`, где та же связка
 *     стояла ДВАЖДЫ.
 * Теперь проба разбирает содержимое `title={…}` по БАЛАНСУ СКОБОК (перенос
 * строки ей безразличен) и идёт по ВСЕМ исходникам раздела, а не по списку.
 */
import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')

/** Каталоги исходников экрана; `node_modules` и сборки сюда не попадают. */
const SOURCE_DIRS = ['app', 'components', 'entities', 'features', 'shared', 'widgets']

function sourceFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (entry.endsWith('.tsx')) {
        found.push(full)
      }
    }
  }
  for (const dir of SOURCE_DIRS) walk(join(ROOT, dir))
  return found
}

/**
 * Содержимое каждого `title={…}` файла — по балансу фигурных скобок, а не по
 * регулярке: выражение внутри бывает в несколько строк, с тернарником и с
 * вложенными `{}` (шаблонные строки, объекты стилей).
 */
/**
 * Стоит ли `title` внутри тега, у которого есть `disabled` (Plane №912).
 *
 * Границы тега берутся от ближайшего `<` слева до закрывающей `>` справа с
 * учётом вложенных `{…}`: атрибуты бывают многострочными и с выражениями.
 */
function withinDisabledTag(source: string, at: number): boolean {
  const open = source.lastIndexOf('<', at)
  if (open === -1) return false
  let depth = 0
  let end = open
  for (; end < source.length; end += 1) {
    const ch = source[end]
    if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    else if (ch === '>' && depth === 0) break
  }
  return /\bdisabled\b/.test(source.slice(open, end))
}

function titleExpressions(source: string): string[] {
  const found: string[] = []
  const marker = 'title={'
  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
    // 🔴 ВИНОВАТ ТОЛЬКО `title` НА ВЫКЛЮЧАЕМОМ ЭЛЕМЕНТЕ (Plane №912).
    // Правило №777 про то, что браузер подавляет подсказку на ВЫКЛЮЧЕННОЙ
    // кнопке. У обычного `<span>` подсказка работает, и требовать от него
    // видимой строки значило бы чинить то, что не сломано: проверено на
    // `analytics/operations` — там `title` висит на подписи «нет данных».
    if (!withinDisabledTag(source, at)) continue
    let depth = 0
    let end = at + marker.length - 1
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    found.push(source.slice(at, end + 1))
  }
  return found
}

test.describe('причина отказа по праву', () => {
  test('`title` больше не несёт причину отказа по праву — ни в одном экране', () => {
    const guilty: string[] = []
    for (const path of sourceFiles()) {
      const source = readFileSync(path, 'utf8')
      for (const expression of titleExpressions(source)) {
        // 🔴 СТОРОЖ ИСКАЛ ТОЛЬКО ОДНО ИМЯ — И ПРОПУСКАЛ ЦЕЛЫЙ ЭКРАН (найдено
        // ревью №825). Отбор шёл по подстроке `.reason(`, а на экране
        // согласования та же функция названа `reasonUnless(` — точки перед
        // `reason` нет, и семь выключенных кнопок с невидимой подсказкой
        // проходили мимо сторожа молча. Сторож с такой слепой зоной хуже
        // отсутствия: он зеленеет ровно на том случае, который в неё попал.
        //
        // Отбор теперь по СМЫСЛУ выражения, а не по имени вызова: подсказка
        // виновата, если в ней вычисляется причина отказа по праву — как бы
        // ни звалась функция. Ложная тревога здесь дешевле пропуска: она
        // разбирается чтением одной строки, а пропуск живёт годами.
        // 🔴 ПРИЧИНА БЫВАЕТ СВОЙСТВОМ, А НЕ ВЫЗОВОМ (Plane №912). Отбор шёл
        // по `reason(` — то есть по ВЫЗОВУ функции, — и обращение к полю
        // (`deniedReason`, `action.reason`) сторож пропускал целиком. Два
        // места жили дефектом №777 при полностью зелёном стороже: кнопка
        // раскрытия показателя в аналитике и кнопки действий в истории
        // отчётов. Это ровно та же слепая зона, из-за которой сторож уже
        // расширяли в №825 — тогда причина звалась `reasonUnless(`.
        //
        // Теперь виновато любое `title`, где встречается слово `reason` в
        // любом написании: и вызов, и свойство, и константа. Ложная тревога
        // здесь дешевле пропуска — она разбирается чтением одной строки.
        const carriesRightReason =
          /reason/i.test(expression) || /RIGHT_REASON|REASON\[/.test(expression)
        if (!carriesRightReason) continue
        guilty.push(`${path.slice(ROOT.length + 1)}: ${expression.split('\n')[0].trim()}…`)
      }
    }
    expect(
      guilty,
      'мёртвая подсказка: на выключенной кнопке `title` не показывается — причина должна быть видимой строкой через RightGate',
    ).toEqual([])
  })

  test('причина объявлена связью с кнопкой, а не отдельным текстом', () => {
    // Каждая обёртка `RightGate` обязана отдать идентификатор кнопке: иначе
    // читалка прочла бы причину как текст рядом, неизвестно о чём.
    for (const path of sourceFiles()) {
      const source = readFileSync(path, 'utf8')
      const gates = (source.match(/<RightGate\s/g) ?? []).length
      if (gates === 0) continue
      const described = (source.match(/aria-describedby=\{describedBy\}/g) ?? []).length
      expect(
        described,
        `${path.slice(ROOT.length + 1)}: обёрток ${gates}, а связей с кнопкой ${described}`,
      ).toBe(gates)
    }
  })

  test('обёртка молчит, когда право есть', () => {
    // Правило самой обёртки: пустая причина — ни строки на экране и
    // `undefined` вместо идентификатора. Иначе у тех, кому всё можно,
    // появилась бы пустая подпись под каждой кнопкой.
    const source = readFileSync(join(ROOT, 'shared/ui/right-gate.tsx'), 'utf8')
    expect(source).toContain('if (text === "") return <>{children(undefined)}</>')
  })

  test('причина не повторяется у каждой кнопки: обёртка ссылается на общий блок', () => {
    // 🔴 Вторая половина №801. На «Расстановке» две обёртки стоят ВНУТРИ цикла
    //    по назначенным: на шести назначенных прежняя обёртка печатала
    //    двенадцать одинаковых строк, и ещё одну — общая подпись шага.
    //    Теперь текст говорит блок `AccessHints`, а обёртка внутри него только
    //    ссылается. Мутация «убрать короткое замыкание» краснит эту пробу.
    const source = readFileSync(join(ROOT, 'shared/ui/right-gate.tsx'), 'utf8')
    expect(
      source,
      'RightGate снова печатает причину у каждой кнопки — экран станет частоколом',
    ).toContain('if (sharedId !== undefined) return <>{children(sharedId)}</>')

    // Экраны, где обёрток БОЛЬШЕ ОДНОЙ, обязаны иметь общий блок причин:
    // иначе повтор вернётся сам собой.
    for (const path of sourceFiles()) {
      const source = readFileSync(path, 'utf8')
      const gates = (source.match(/<RightGate\s/g) ?? []).length
      if (gates < 2) continue
      expect(
        source,
        `${path.slice(ROOT.length + 1)}: обёрток ${gates}, а общего блока причин нет — причина повторится ${gates} раз`,
      ).toContain('<AccessHints')
    }
  })
})
