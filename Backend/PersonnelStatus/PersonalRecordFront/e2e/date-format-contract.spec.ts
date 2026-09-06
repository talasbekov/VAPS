/**
 * `formatIsoDate` не применяется к МЕТКЕ МОМЕНТА (Plane №560, №581).
 *
 * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. `formatIsoDate` намеренно НЕ разбирает часовой пояс —
 * он срезает префикс `ГГГГ-ММ-ДД` (`shared/lib/date.ts`), и это верно только
 * для полей `DateField`, приходящих датой без времени. Над меткой момента
 * (`…T…+00:00`, `_now_iso()`, `Clock.now().isoformat()`) тот же срез даёт
 * UTC-день: в поясе +05 всё, что случилось после 19:00 по местному, печатается
 * ВЧЕРАШНИМ днём.
 *
 * Класс закрывали трижды подряд тремя одинаковыми живыми пробами по 150 строк
 * (№560 — «Запрошено» в заявке департаменту, №581 — момент передачи, доводка
 * ревью №825 — «Ознакомлен» в профиле и «Посчитан» в справке рейтинга), и
 * каждый раз оставались незамеченными соседние места. Сторож дешевле четвёртой
 * копии: он читает исходники и не требует ни стенда, ни `SMOKE_LIVE` — без
 * переменной даёт «passed», а не «skipped» (тот же приём, что у
 * `right-hint-pattern` и `react-list-keys`).
 *
 * ПРАВИЛО ОТБОРА. Виновным считается `formatIsoDate(…)` / `formatIsoDateLong(…)`,
 * чей аргумент — имя, оканчивающееся на `At` (`notifiedAt`, `calculatedAt`,
 * `acknowledgedAt`), либо к которому применён срез `.slice(0, 10)` /
 * `.split("T")[0]`. Именно эти две формы и дали все четыре случая.
 *
 * ЧЕГО СТОРОЖ НЕ ЛОВИТ И НЕ ОБЕЩАЕТ: поле-момент, названное не на `At`
 * (`updated`, `moment`), и значение, положенное в переменную выше по телу.
 * Разбор без AST дотуда не достаёт, и обещать это было бы враньём.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const SKIP = new Set(['node_modules', '.next', '.next-build', '.next-mock', '.git', 'e2e'])

/**
 * Имена на `At`, которые ВСЁ РАВНО дата без времени, — поимённо и с причиной.
 * Список поимённый нарочно: «разрешить всё, что похоже» вернуло бы дефект.
 */
const ALLOWED = new Map<string, string>([
  ['periodStartsAt', 'DateField (models_rating.py) — период оценки, дата без времени'],
  ['periodEndsAt', 'DateField (models_rating.py) — период оценки, дата без времени'],
  ['evaluatedAt', 'DateField (models_rating.py) — день оценки, дата без времени'],
])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSafe(dir)) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full)
  }
  return out
}

function readdirSafe(dir: string) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:fs').readdirSync(dir, { withFileTypes: true }) as {
    name: string
    isDirectory: () => boolean
  }[]
}

/** `formatIsoDate(<аргумент>` — аргумент до первой запятой или скобки. */
const CALL = /\bformatIsoDate(?:Long)?\(\s*([^,)]*)/g

test.describe('формат даты соответствует форме поля', () => {
  const ROOT = path.join(__dirname, '..')
  const files = sourceFiles(ROOT)

  test('formatIsoDate не стоит над меткой момента', () => {
    // Нижняя граница: без неё переезд каталогов делает сторожа вечнозелёным
    // молча (класс №841).
    expect(files.length, 'сторож не нашёл исходников — читать нечего').toBeGreaterThan(100)

    const guilty: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const hit of text.matchAll(CALL)) {
        const arg = hit[1].trim()
        const sliced = /\.slice\(\s*0\s*,\s*10\s*\)|\.split\(\s*["']T["']\s*\)\s*\[\s*0\s*\]/.test(arg)
        const named = /(?:^|[.\s(])([A-Za-z_$][\w$]*At)\b/.exec(arg)
        const suspect = named === null ? null : named[1]
        if (!sliced && (suspect === null || ALLOWED.has(suspect))) continue
        const line = text.slice(0, hit.index).split('\n').length
        guilty.push(`${path.relative(ROOT, file)}:${line}: formatIsoDate(${arg})`)
      }
    }
    expect(
      [...new Set(guilty)].sort(),
      'formatIsoDate срезает UTC-префикс и над меткой момента печатает ' +
        'вчерашний день после 19:00 по местному — зовите formatIsoDateTime',
    ).toEqual([])
  })

  test('исключения из списка ВСЁ ЕЩЁ нарушали бы правило', () => {
    // Храповик: как только поле перестанет использоваться, исключение обязано
    // уйти из списка, а не жить вечно «на всякий случай».
    const all = files.map((file) => readFileSync(file, 'utf8')).join('\n')
    for (const [name, why] of ALLOWED) {
      expect(
        new RegExp(`\\bformatIsoDate(?:Long)?\\([^,)]*\\b${name}\\b`).test(all),
        `исключение «${name}» (${why}) больше никем не используется — снимите его`,
      ).toBe(true)
    }
  })
})

/**
 * Местная дата не считается срезом UTC (Plane №927).
 *
 * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. `new Date().toISOString()` отдаёт UTC, и в поясе +05
 * между 00:00 и 05:00 по местному срез первых десяти символов даёт ВЧЕРАШНИЙ
 * день. Ловушка описана в `e2e/business-date.ts` (Plane №373) — но правило там
 * написано для ПРОБ, а нарушено было в боевом коде реестра ОМ: месяц-якорь
 * календаря выбирался по вчерашней дате.
 *
 * ГРАНИЦА ОТБОРА НАЗВАНА ЧЕСТНО. Виноват только срез от «СЕЙЧАС»
 * (`new Date().toISOString().slice(`). Полная метка момента
 * (`new Date().toISOString()` без среза) законна — это и есть момент, а не
 * день. Законна и арифметика над разобранной строкой-датой через
 * `Date.UTC(...)`: там в UTC кладут уже известные части, и обратный срез
 * возвращает их же — таких мест в разделе шесть, и у каждого стоит свой
 * комментарий.
 */
test.describe('местная дата', () => {
  // Свой обход исходников:  соседнего блока живёт в его области
  // видимости, а тащить его наружу значило бы связать два разных правила.
  const ROOT = path.join(__dirname, '..')
  const files = sourceFiles(ROOT)

  /**
   * Текст без комментариев — иначе сторож ловит СВОЙ ЖЕ разбор.
   *
   * Поймано запуском: в `shared/lib/date.ts` запрещённая форма стоит в
   * докстроке как пример того, чего делать нельзя, и сторож объявил её
   * нарушением. Правило, которое нельзя объяснить словами рядом с кодом, —
   * плохое правило.
   *
   * Комментарии вырезаются, а не «сдвигаются в пробелы»: номера строк
   * считаются по исходному тексту до вырезания (см. `lineOf`).
   */
  const withoutComments = (text: string): string =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (line, head) => head + ' '.repeat(line.length - head.length))

  test('день не берётся срезом UTC от «сейчас»', () => {
    const guilty: string[] = []
    for (const file of files) {
      const text = withoutComments(readFileSync(file, 'utf8'))
      for (const hit of text.matchAll(/new Date\(\)\.toISOString\(\)\s*\.\s*slice\(/g)) {
        const line = text.slice(0, hit.index).split('\n').length
        guilty.push(`${path.relative(ROOT, file)}:${line}`)
      }
    }
    expect(
      guilty.sort(),
      'день считается срезом UTC: в поясе +05 с 00:00 до 05:00 это вчера — ' +
        'зовите localIsoDate из shared/lib/date',
    ).toEqual([])
  })
})
