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
/**
 * Метка момента печатается ЧЕРЕЗ ОБЩИЙ МОДУЛЬ, а не инлайном (Plane №932).
 *
 * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. Соседний блок этого файла ловит виновных ПО ВЫЗОВАМ
 * `formatIsoDate*` с аргументом на `At`. В обходном варианте таких вызовов
 * нет вовсе: момент печатается `new Date(<поле>).toLocaleString(...)`, формат
 * при этом совпадает — и правка выглядит косметической. Но обход модуля
 * теряет ЗАЩИТУ: `new Date` от неразбираемой строки даёт `Invalid Date`, и
 * `toLocaleString` печатает её человеку буквально. `formatIsoDateTime` и
 * `formatIsoDayTime` заведены по №730 ровно от этого и отдают «—».
 *
 * Класс подтверждён делом: №926 закрыла одно такое место в `ConductStage`, а
 * на 170 строк ниже в ТОМ ЖЕ файле жило второе — то есть сторож давал зелень
 * и читался как «класс закрыт», пока мимо него проходил целый способ записи.
 *
 * ГРАНИЦА ОТБОРА НАЗВАНА ЧЕСТНО. Виноват `new Date(<имя на At>).toLocale*` —
 * то есть СЕРВЕРНОЕ поле-момент. Числовые метки клиента исключены поимённо:
 * `dataUpdatedAt` у React Query это `number` (проверено по типам пакета), и
 * `Invalid Date` из числа не получается — требовать для них модуль значило бы
 * ловить исправный код.
 *
 * ЧЕГО НЕ ЛОВИТ И НЕ ОБЕЩАЕТ: поле-момент, названное не на `At`, и значение,
 * положенное в переменную выше по телу, — разбор без AST дотуда не достаёт.
 */
test.describe('метка момента', () => {
  const ROOT = path.join(__dirname, '..')
  const files = sourceFiles(ROOT)

  /**
   * Имена, которые НЕ являются серверной меткой момента, — поимённо.
   *
   * 🔴 ИСКЛЮЧЕНИЕ ДЕЙСТВУЕТ ТОЛЬКО НА ГОЛЫЙ ИДЕНТИФИКАТОР (ревью №825 по
   * №932, 08.09.2026): `updatedAt` как локальная переменная командного
   * центра — число; `event.updatedAt`, `object.updatedAt` и ещё шесть
   * сущностей носят его серверной ISO-строкой, и завтрашний
   * `new Date(event.updatedAt).toLocaleString(...)` — ровно тот дефект, ради
   * которого сторож заведён. Раньше сравнение шло по последнему сегменту
   * пути и стирало это различие.
   */
  const NOT_A_SERVER_MOMENT = new Map<string, string>([
    ['dataUpdatedAt', 'React Query: число миллисекунд, не ISO-строка'],
    ['updatedAt', 'в командном центре это Math.max(dataUpdatedAt, …) — тоже число'],
  ])

  /**
   * 🔴 `dataUpdatedAt` НЕ НУЖНО «ГОЛЫМ» (доводка ревью №825/№932 по №1011).
   * `NOT_A_SERVER_MOMENT` исключает по голому имени намеренно: `event.updatedAt`
   * — реальная серверная ISO-строка, и совпадение по последнему сегменту пути
   * стёрло бы это различие (ровно тот дефект, что чинили в №932). Но
   * `dataUpdatedAt` — не `updatedAt`: это ИМЯ ПОЛЯ React Query, а не общее
   * название по сущностям, и `query.dataUpdatedAt` — то же самое число, что и
   * голый `dataUpdatedAt`. `query.dataUpdatedAt > 0 ? new Date(query.
   * dataUpdatedAt).toLocaleTimeString(…)` (`app/security-ops/analytics/
   * operations/page.tsx`) сторож считал виновным, хотя `Invalid Date` тут не
   * бывает никогда.
   */
  const UNAMBIGUOUS_NUMERIC_FIELDS = new Set(['dataUpdatedAt'])

  test('момент не печатается инлайном мимо общего модуля', () => {
    const guilty: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const hit of text.matchAll(
        /new Date\(\s*([A-Za-z_$][\w$.]*At)\s*\)\s*\.\s*toLocale/g,
      )) {
        const ident = hit[1] ?? ''
        // Только голое имя: `x.updatedAt` — поле сущности, а не локальное число.
        if (!ident.includes('.') && NOT_A_SERVER_MOMENT.has(ident)) continue
        // `…dataUpdatedAt` — исключение и С НАМЕСПЕЙСОМ: имя однозначно.
        const lastSegment = ident.includes('.') ? ident.split('.').pop() ?? '' : ''
        if (UNAMBIGUOUS_NUMERIC_FIELDS.has(lastSegment)) continue
        const line = text.slice(0, hit.index).split('\n').length
        guilty.push(`${path.relative(ROOT, file)}:${line}: ${hit[1]}`)
      }
    }
    expect(
      guilty.sort(),
      'метка момента печатается инлайном: обход модуля теряет защиту от ' +
        'Invalid Date — зовите formatIsoDateTime или formatIsoDayTime',
    ).toEqual([])
  })

  /**
   * Файлы со СВОЕЙ копией форматера момента — поимённо и с причиной.
   *
   * 🔴 ПОЧЕМУ ОНИ ЗДЕСЬ, А НЕ ПОЧИНЕНЫ ТЕМ ЖЕ ЗАХОДОМ. Копия
   * (`Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU")`)
   * от `Invalid Date` ЗАЩИЩАЕТ — то есть боевого дефекта тут нет, — но
   * отдаёт человеку СЫРУЮ ISO-строку вместо «—», и печатает секунды, которых
   * у модуля нет. Свод к модулю меняет ВИД на восьми экранах сразу: это
   * правка вида, ей нужен свой заход со снимками, а не прицеп к стерегущей
   * пробе. Заведена отдельной карточкой.
   *
   * Список закрыт: НОВАЯ копия сторожем не пройдёт.
   */
  // Все восемь копий сведены к модулю (Plane №935, 07.09.2026): список пуст,
  // и первая же новая копия — красная. Храповик ниже при пустом списке
  // ничего не проверяет, и это правильно: проверять нечего.
  const OWN_FORMATTER_COPIES = new Map<string, string>([])

  /**
   * 🔴 ИМЯ ПЕРЕМЕННОЙ — НЕ ЧАСТЬ ПРАВИЛА (Plane №1011, ревью коммита
   * `639efe94` по №935). Было `\bparsed\.getTime\(\)\b` буквально: копия
   * `const d = new Date(v); Number.isNaN(d.getTime()) ? v : d.toLocaleString(…)`
   * сторожа не будила — она с тем же дефектом, просто переменная не
   * называется `parsed`. Список признанных копий пуст, и сторож — ЕДИНСТВЕННАЯ
   * защита: восемь снятых копий вернулись бы под другим именем незамеченными.
   */
  const OWN_FORMATTER_COPY_PATTERN =
    /Number\.isNaN\(\s*(\w+)\.getTime\(\)\s*\)\s*\?\s*\w+\s*:\s*\1\.toLocaleString/

  test('сторож ловит копию под любым именем переменной', () => {
    const named = 'Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU")'
    const renamed = 'Number.isNaN(d.getTime()) ? v : d.toLocaleString("ru-RU")'
    expect(OWN_FORMATTER_COPY_PATTERN.test(named), 'исходное имя `parsed` больше не ловится').toBe(true)
    expect(OWN_FORMATTER_COPY_PATTERN.test(renamed), 'копия под чужим именем переменной проходит незамеченной').toBe(true)
  })

  test('новая копия форматера момента не заводится', () => {
    const guilty: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      if (!OWN_FORMATTER_COPY_PATTERN.test(text)) continue
      const relative = path.relative(ROOT, file)
      if (OWN_FORMATTER_COPIES.has(relative)) continue
      guilty.push(relative)
    }
    expect(
      guilty.sort(),
      'заведена ЕЩЁ ОДНА копия форматера момента: она отдаёт сырую ISO-строку ' +
        'вместо «—» и печатает секунды — зовите formatIsoDateTime',
    ).toEqual([])
  })

  test('перечисленные копии всё ещё на месте', () => {
    // Храповик: свели копию к модулю — строка обязана уйти из списка, иначе
    // он через полгода описывает то, чего нет.
    for (const [relative, why] of OWN_FORMATTER_COPIES) {
      const text = readFileSync(path.join(ROOT, relative), 'utf8')
      expect(
        OWN_FORMATTER_COPY_PATTERN.test(text),
        `${relative} (${why}) больше не держит своей копии — снимите строку`,
      ).toBe(true)
    }
  })

  test('исключения ВСЁ ЕЩЁ существуют и всё ещё не серверные', () => {
    // Храповик: имя, которое перестало встречаться, обязано уйти из списка,
    // иначе он через полгода читается как «эти места сломаны, но их не чинят».
    const all = files.map((file) => readFileSync(file, 'utf8')).join('\n')
    for (const [name, why] of NOT_A_SERVER_MOMENT) {
      expect(
        new RegExp(`new Date\\(\\s*[\\w$.]*\\b${name}\\b`).test(all),
        `исключение «${name}» (${why}) больше не встречается — снимите его`,
      ).toBe(true)
    }
  })
})

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
