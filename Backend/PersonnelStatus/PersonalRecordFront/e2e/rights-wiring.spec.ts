/**
 * Право, объявленное экраном, ДЕЙСТВИТЕЛЬНО гейтит его кнопки (Plane №859).
 *
 * 🔴 ОТКУДА ЭТА ПРОБА. Коммит `e4057664` откатил фикс авторизации №572
 * вместе с ОБЕИМИ его пробами: наблюдателю на экране согласования снова
 * показывали четыре включённых действия по замечаниям, а он получал 403.
 * Гейт после отката был зелёным не потому, что дыры не было, — а потому, что
 * проба, которая бы её нашла, к тому моменту уже не существовала.
 *
 * 🔴 ЧЕГО НЕ ХВАТАЛО ПОСЛЕ ВОССТАНОВЛЕНИЯ. `approval-rights-rules.spec.ts`
 * вернули, и он снова стережёт ВЫЧИСЛЕНИЕ прав: кому какое поле достаётся.
 * Но ПРИМЕНЕНИЕ права к кнопке он не проверяет вовсе. Замерено мутацией
 * 06.09.2026: убрать `!rights.answerRemarks` из `disabled` одной кнопки —
 * `approval-rights-rules` даёт 5 passed, `right-hint-pattern` даёт 4 passed,
 * весь гейт зелёный. То есть ровно ту половину №572, которая и уехала,
 * по-прежнему не стерёг никто.
 *
 * ПРОБА ЧИТАЕТ ИСХОДНИКИ, а не браузер, по той же причине, что
 * `right-hint-pattern`: «кнопка не слушает право» не видно НИ ПРИ КАКОМ
 * поведении браузера, если смотреть чужими глазами — она просто нажимается, а
 * 403 приходит с сервера. Без `SMOKE_LIVE` даёт «passed», а не «skipped».
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')

/**
 * Сколько РАЗ каждое право обязано стоять в `disabled` своего экрана.
 *
 * 🔴 ЧИСЛО, А НЕ «ХОТЯ БЫ ОДИН РАЗ». У права бывает несколько кнопок (у
 * ответа на замечание их четыре), и правило «упомянуто где-нибудь» пропустило
 * бы снятие гейта с трёх из четырёх — то есть ровно дефект №572, только чуть
 * тише. Число — ратчет: упало — гейт сняли, выросло — появилась новая кнопка,
 * и её надо осознанно внести сюда.
 */
const WIRED_RIGHTS: { file: string; counts: Record<string, number> }[] = [
  {
    file: 'features/security-event-stages/ui/ApprovalStage.tsx',
    counts: {
      // Отправить и отозвать список на согласование.
      send: 2,
      // Ответить на замечание: четыре действия одной строки замечания.
      answerRemarks: 4,
      approve: 1,
      returnBack: 2,
    },
  },
]

/**
 * Права, которые экран объявляет, но НИ ОДНОЙ кнопкой не гейтит, — с причиной.
 *
 * Список именно поимённый, а не «остальные не проверяем»: право, исчезнувшее
 * из `disabled` молча, и право, которого там нет ОСОЗНАННО, — разные вещи, и
 * различить их может только тот, кто знает почему.
 */
const UNWIRED_RIGHTS = new Map<string, string>([
  [
    'manageRoute',
    'форма добавления согласующего выключена литералом `&& false` (Plane №702) — ' +
      'гейтить нечего, право остаётся только в подсказке `AccessHints`',
  ],
])

/** Содержимое каждого `disabled={…}` — по балансу скобок: выражение бывает
 *  многострочным и с вложенными `{}`. Регулярка на этом и ломалась в №912. */
function disabledExpressions(source: string): string[] {
  const found: string[] = []
  const marker = 'disabled={'
  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
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

function countRights(source: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const expression of disabledExpressions(source)) {
    for (const [, name] of expression.matchAll(/\brights\.([a-zA-Z]+)/g)) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return counts
}

test.describe('право гейтит кнопку, а не только объясняется', () => {
  test('каждое право стоит в `disabled` столько раз, сколько у него кнопок', () => {
    for (const { file, counts } of WIRED_RIGHTS) {
      const source = readFileSync(join(ROOT, file), 'utf8')
      const actual = countRights(source)
      for (const [right, expected] of Object.entries(counts)) {
        expect(
          actual.get(right) ?? 0,
          `${file}: право «${right}» гейтит ${actual.get(right) ?? 0} кнопок вместо ${expected} — ` +
            'либо с кнопки сняли гейт (это дефект №572), либо кнопку добавили и ' +
            'забыли внести в WIRED_RIGHTS',
        ).toBe(expected)
      }
    }
  })

  test('право, объявленное интерфейсом, либо гейтит, либо названо исключением', () => {
    // 🔴 ИНТЕРФЕЙС — ОДНА СТОРОНА ИЗ ФАЙЛА, А НЕ СПИСОК РУКАМИ (урок №801 и
    // №319): перечень прав берётся из самого исходника, поэтому новое поле
    // `ApprovalRights` попадает под проверку в тот же день, когда появилось.
    const file = WIRED_RIGHTS[0].file
    const source = readFileSync(join(ROOT, file), 'utf8')
    const block = source.slice(
      source.indexOf('export interface ApprovalRights {'),
      source.indexOf('}', source.indexOf('export interface ApprovalRights {')),
    )
    const declared = [...block.matchAll(/^\s*([a-zA-Z]+):\s*boolean;/gm)].map(([, name]) => name)
    expect(declared.length, 'интерфейс прав не разобран — проба смотрит в пустоту').toBeGreaterThan(3)

    const wired = new Set(Object.keys(WIRED_RIGHTS[0].counts))
    const orphans = declared.filter((name) => !wired.has(name) && !UNWIRED_RIGHTS.has(name))
    expect(
      orphans,
      'право объявлено, но ни одной кнопки не гейтит и в исключения не внесено: ' +
        'либо подключите его к `disabled`, либо назовите причину в UNWIRED_RIGHTS',
    ).toEqual([])
  })

  test('сторож не гниёт: подключённое право снимается из исключений', () => {
    const source = readFileSync(join(ROOT, WIRED_RIGHTS[0].file), 'utf8')
    const actual = countRights(source)
    const stale = [...UNWIRED_RIGHTS.keys()].filter((name) => (actual.get(name) ?? 0) > 0)
    expect(
      stale,
      'право теперь гейтит кнопку — снимите его из UNWIRED_RIGHTS и внесите в WIRED_RIGHTS',
    ).toEqual([])
  })

  test('сторож читает настоящий экран, а не пустоту', () => {
    // Без этой пробы оба ассерта выше сравнивали бы пустое с пустым, если
    // файл переименуют или разбор `disabled={…}` сломается (урок №825).
    const source = readFileSync(join(ROOT, WIRED_RIGHTS[0].file), 'utf8')
    expect(disabledExpressions(source).length, 'на экране не найдено ни одного `disabled`').toBeGreaterThan(8)
    expect(countRights(source).size, 'ни одно право не найдено в `disabled`').toBeGreaterThan(2)
  })
})
