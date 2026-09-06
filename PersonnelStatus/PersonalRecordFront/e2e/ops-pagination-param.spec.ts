/**
 * Списки раздела ОМ спрашиваются `limit`, а не `page_size` (Plane №870, №321).
 *
 * 🔴 ЧТО СТЕРЕЖЁМ. Раздел ОМ пагинируется `LimitOffsetPagination`
 * (`DefaultPagination`, `default_limit=50`) — она понимает `limit`/`offset`, а
 * `page_size` ИГНОРИРУЕТ и молча отдаёт умолчание. Замерено 06.09.2026 на
 * живой ручке `/api/operations/status-types/`:
 *
 *     ?page_size=5 → 19 строк (все, параметр не применён)
 *     ?limit=5     → 5 строк
 *
 * Молчание и есть дефект: попросивший всё получает часть и не может отличить
 * «больше нет» от «больше не дали».
 *
 * 🔴 ПОЧЕМУ ПРОБА, А НЕ КОММЕНТАРИЙ. Комментарий об этой ловушке уже стоял в
 * `lib/api.ts` (разбор №321) — и вызов двумястами строк НИЖЕ, в том же файле,
 * всё равно был написан с `page_size`. Слова не удержали; `page_size` —
 * правильное имя почти на всех остальных ручках проекта, и следующий, кто
 * напишет вызов по образцу соседней строки, наступит туда же.
 *
 * Приём тот же, что у `right-hint-pattern`, `own-fixture-pattern` и
 * `route-map-coverage`: проба читает ИСХОДНИКИ и без `SMOKE_LIVE` даёт
 * «passed», а не «skipped», — иначе сторож молча пропускался бы.
 */
import { expect, test } from '@playwright/test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')

/** Каталоги БОЕВОГО кода. Здесь исключений нет и быть не должно. */
const PRODUCTION_DIRS = [
  'app',
  'components',
  'entities',
  'features',
  'hooks',
  'lib',
  'shared',
  'widgets',
  'mocks',
]

/**
 * 🔴 ХРАПОВИК ТОЛЬКО ДЛЯ ПРОБ, а не разрешение. На 06.09.2026 пробы несут 65
 * таких вызовов в 32 файлах — они тоже получают 50 строк вместо запрошенных, и
 * это уже стоило разбора: комментарий в `bulletin-stage` объясняет пропажу
 * своей фикстуры словами «реестр стенда перевалил за page_size», хотя параметр
 * не применяется вовсе и потолок берётся из умолчания.
 *
 * Сметать 32 файла заодно с боевой правкой нельзя: половину держат соседние
 * сессии. Долг вынесен карточкой Plane №872; список сюда НЕ дописывается — он
 * только сокращается, и `сторож не гниёт` краснеет на файле, который больше
 * не нарушает.
 */
const KNOWN_PROBE_CALLS = new Map<string, number>([
  // ПУСТ с 06.09.2026: оба настоящих нарушителя (`daily-expense`,
  // `status-catalog-source`) починены здесь же. Пустым и обязан остаться —
  // новая строка сюда не дописывается, она чинится.
])

/**
 * Адрес раздела ОМ ищется В СТРОКОВЫХ ЛИТЕРАЛАХ, а не в тексте файла.
 *
 * 🔴 ПОЧЕМУ НЕ «СНЯТЬ КОММЕНТАРИИ РЕГУЛЯРКОЙ», как было в первых двух
 * редакциях (найдено ревью, Plane №873). Снятие блочных комментариев проходом
 * `/\*[\s\S]*?\*\//g` считает началом комментария ЛЮБОЕ `/*` — а оно
 * встречается и внутри строк. В `lib/api.ts:1815` стоит HTTP-заголовок
 * `accept: "*\/*"`, и его `/*` открывало псевдо-блок до ближайшего настоящего
 * `*\/` двумя сотнями строк ниже.
 *
 * ЗАМЕР: из `lib/api.ts` при такой очистке выпадало 400 строк — то есть
 * сторож слеп ровно на том файле, ради которого написан. Проверено вставкой
 * одной и той же строки: на строке 100 сторож краснеет, на строке 1900 —
 * зелёный.
 *
 * Порядок проходов тут не спасает вовсе: строковый литерал с `//` или `/*`
 * внутри ломает любой. Поэтому исходник РАЗБИРАЕТСЯ ПО СОСТОЯНИЯМ — код,
 * строчный комментарий, блочный комментарий, строковый литерал, — и вопрос
 * задаётся правильный: «адрес лежит в строке КОДА или это текст ПРО адрес».
 * Докстрока с примером в разбор не попадает сама собой, без отдельной очистки.
 */
function stringLiterals(source: string): string[] {
  const found: string[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i += 1
      let value = ''
      while (i < source.length && source[i] !== quote) {
        // Экранирование: `\"` внутри строки её не закрывает, и `\\` не
        // экранирует следующий символ.
        if (source[i] === '\\') {
          value += source[i] + (source[i + 1] ?? '')
          i += 2
          continue
        }
        value += source[i]
        i += 1
      }
      i += 1
      found.push(value)
      continue
    }
    i += 1
  }
  return found
}

/**
 * Строка-адрес `/api/operations/`, спрошенная через `page_size`.
 *
 * 🔴 ТОЛЬКО `operations`, НО НЕ `ops` — И ЭТО ГЛАВНОЕ В ПРОБЕ (найдено ревью).
 * Два пространства имён раздела пагинируются ПО-РАЗНОМУ, и правило у них
 * ПРОТИВОПОЛОЖНОЕ. Замерено на живом стенде 06.09.2026:
 *
 *     /api/ops/security-events/?page_size=3   → 3 строки   ?limit=3 → 20
 *     /api/ops/personnel/?page_size=3         → 3 строки   ?limit=3 → 100
 *     /api/operations/status-types/?page_size=3 → 19 строк  ?limit=3 → 3
 *
 * `/api/ops/` пагинируется ВРУЧНУЮ (`api/views.py`, свои `page`/`page_size`),
 * а `LimitOffsetPagination` живёт только у `/api/operations/`. Первая редакция
 * этой пробы ловила `(?:operations|ops)` и требовала `limit` от обоих — то
 * есть требовала сломать 62 рабочих вызова: на `/api/ops/` `limit` не
 * применяется, и страница схлопнулась бы до умолчания.
 */
const OPS_WITH_PAGE_SIZE = /\/api\/operations\/[^\n]*page_size/

function countIn(text: string): number {
  return stringLiterals(text).filter((value) => OPS_WITH_PAGE_SIZE.test(value)).length
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

test.describe('пагинация раздела ОМ', () => {
  test('боевой код не спрашивает списки раздела через page_size', () => {
    const offenders: string[] = []
    for (const dir of PRODUCTION_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const found = countIn(readFileSync(file, 'utf8'))
        if (found > 0) offenders.push(`${file.slice(ROOT.length + 1)}: ${found}`)
      }
    }
    expect(
      offenders,
      '`/api/operations/` игнорирует `page_size` и молча отдаёт умолчание — ' +
        'спрашивайте `limit` (Plane №870, замер: ?page_size=5 → 19 строк, ' +
        '?limit=5 → 5). ⚠️ У `/api/ops/` правило ОБРАТНОЕ: там работает ' +
        '`page_size`, а `limit` игнорируется — эти адреса трогать НЕ надо',
    ).toEqual([])
  })

  test('пробы тоже не спрашивают /api/operations/ через page_size', () => {
    // 🔴 ДЫРА, ЗАКРЫТАЯ ПОСЛЕ РЕВЮ: прежде эта половина сторожа перебирала
    // ТОЛЬКО храповик, то есть новый нарушитель СРЕДИ ПРОБ не ловился ничем —
    // сторож был зелёным по построению ровно для тех файлов, которых в списке
    // нет. Теперь обходятся все спеки.
    //
    // Свой файл исключён намеренно: образцы в пробе разбора — предмет
    // проверки, а не долг.
    const offenders = readdirSync(__dirname)
      .filter((name) => name.endsWith('.ts') && name !== 'ops-pagination-param.spec.ts')
      .map((name) => ({ name, count: countIn(readFileSync(join(__dirname, name), 'utf8')) }))
      .filter(({ name, count }) => count > 0 && !KNOWN_PROBE_CALLS.has(name))
    expect(
      offenders,
      '`/api/operations/` игнорирует `page_size` — спрашивайте `limit`. ' +
        '⚠️ адреса `/api/ops/` сюда НЕ относятся: там правило обратное',
    ).toEqual([])
  })

  test('сторож не гниёт: починенная проба снимается из списка', () => {
    const stale: string[] = []
    const grown: string[] = []
    for (const [name, known] of KNOWN_PROBE_CALLS) {
      const found = countIn(readFileSync(join(__dirname, name), 'utf8'))
      if (found === 0) stale.push(name)
      if (found > known) grown.push(`${name}: было ${known}, стало ${found}`)
    }
    expect(stale, 'проба больше не нарушает — снимите её из KNOWN_PROBE_CALLS').toEqual([])
    expect(grown, 'в известной пробе вызовов СТАЛО БОЛЬШЕ — это новая беда').toEqual([])
  })

  test('разбор действительно отличает код от текста про код', () => {
    // 🔴 ПРОБА ПРО САМОГО СТОРОЖА (предложено ревью, Plane №873; приём из
    // №834 и №842). Считающий сторож умеет быть зелёным ПО ПОСТРОЕНИЮ —
    // обойдя пустоту или ослепнув на середине файла. Здесь проверяется
    // главное умение разбора на образцах, где прежние редакции ошибались.
    const sample = [
      'const headers = { accept: "*/*" }',            // НЕ открывает блок
      'const real = "/api/ops/personnel/?page_size=1"',
      '// в комментарии: /api/ops/personnel/?page_size=1',
      '/* в блоке: /api/ops/personnel/?page_size=1 */',
      'const tpl = `${BASE}/api/ops/personnel/?search=${f("x")}&page_size=1`',
      "const after = '/api/operations/status-types/?page_size=200'",
    ].join('\n')

    expect(
      countIn(sample),
      'разбор обязан посчитать ОДНУ строку кода — `/api/operations/` после ' +
        'заголовка "*/*"; адреса `/api/ops/` правилу не подлежат (там ' +
        '`page_size` работает), а две строки в комментариях не считаются',
    ).toBe(1)
  })

  test('сторож обошёл дерево, а не пустоту', () => {
    // Нижние границы, а не точные числа: точные пришлось бы править каждой
    // новой спекой, и правка превратилась бы в подгонку. Границы ловят то,
    // ради чего проба стоит: обход, который вернул ноль файлов или ноль строк.
    let files = 0
    let literals = 0
    for (const dir of [...PRODUCTION_DIRS, 'e2e']) {
      for (const file of walk(join(ROOT, dir))) {
        files += 1
        literals += stringLiterals(readFileSync(file, 'utf8')).length
      }
    }
    expect(files, 'сторож не нашёл исходников — обход сломан').toBeGreaterThan(200)
    expect(literals, 'разбор не нашёл строковых литералов — он ослеп').toBeGreaterThan(5000)
  })
})
