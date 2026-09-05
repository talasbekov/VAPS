/**
 * Правило русского склонения по числу живёт в ОДНОМ месте (Plane №783).
 *
 * 🔴 ЧТО ЭТО СТЕРЕЖЁТ. Правило простое, и именно поэтому его пишут заново
 * каждый раз, когда понадобилось. Написанное девять раз, оно девять раз и
 * расходится: в бейдже реестра 21 давало «21 замечание», а в уведомлении о
 * ТОМ ЖЕ возврате — «21 замечаний» (№585); уведомление о запросе сил не
 * склоняло вовсе и печатало «Выделите 1 сотрудников» (№562). Две поверхности
 * говорили про одно число по-разному, и человек читает это как сбой системы,
 * а не как небрежность текста.
 *
 * Одной правкой класс ошибки не закрывается: следующий автор напишет копию
 * снова — она короче импорта и работает. Поэтому сторож, а не только правка;
 * тем же приёмом закрыты ключи списков (`react-list-keys`) и пути снимков
 * (`check-shot-paths`).
 *
 * ПРИЗНАК — `% 100` В ВЫРАЖЕНИИ. Второй остаток нужен ровно для одного:
 * отличить одиннадцать-четырнадцать («одиннадцать замечаниЙ») от их хвостов
 * (1-4, просящих «замечание/замечания»). В коде портала он больше ни для
 * чего не встречается, поэтому признак точный и не ловит здоровый код.
 *
 * 🔴 ЧЕСТНО ПРО ГРАНИЦУ. Сторож ловит ВЕРНУЮ копию правила. Копия БЕЗ `% 100`
 * — тернарник «1 → одно, иначе → другое» — ему не видна, а это как раз тот
 * дефект, которым обернулись №585 и №562. Разбирать «похоже ли это на
 * склонение» по формам слов значило бы гадать; здесь проверяется то, что
 * проверяется точно, и граница названа вслух, а не выдана за покрытие.
 *
 * ПРОБА ЧИТАЕТ ИСХОДНИКИ, А НЕ ЭКРАН, и потому не требует `SMOKE_LIVE`.
 */
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

import { ASSIGNMENTS, DAYS, EVENTS, EVENTS_OF, ruCount, ruPlural } from '../lib/ru-plural'

const ROOTS = ['app', 'features', 'widgets', 'components', 'entities', 'shared', 'hooks', 'lib']

/** Единственный дом правила. Путь от корня фронта. */
const HOME = path.join('lib', 'ru-plural.ts')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...sources(full))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Позиции `% 100`, которые НЕ являются арифметикой: они стоят в строке или в
 * комментарии.
 *
 * Без этой проверки сторож обвинил бы `backgroundSize: "200% 100%"` и подпись
 * «--card в светлой теме = 0 0% 100%»: там те же символы значат проценты CSS,
 * а не остаток от деления. Сторож, который кричит на здоровый код, снимают
 * через неделю — так сказано в шапке `check-shot-paths.mjs`, и это ровно тот
 * же случай.
 *
 * 🔴 РАЗБОР ИДЁТ ПО ВСЕМУ ФАЙЛУ, А НЕ ПОСТРОЧНО. Первая редакция смотрела
 * только начало СВОЕЙ строки — и пропустила блочный комментарий, открытый
 * четырьмя строками выше (`persons/page.tsx`): в самой строке ни `/*`, ни
 * кавычки нет, и объяснение про токен темы поехало в обвинение.
 */
function arithmeticHits(text: string): number[] {
  const out: number[] = []
  let quote: string | null = null
  let block = false
  let lineComment = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (lineComment) {
      if (ch === '\n') lineComment = false
      continue
    }
    if (block) {
      if (ch === '*' && next === '/') {
        block = false
        i += 1
      }
      continue
    }
    if (quote !== null) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && next === '/') {
      lineComment = true
      i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      block = true
      i += 1
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '%' && /^%\s*100\b/.test(text.slice(i))) out.push(i)
  }
  return out
}

test('правило склонения по числу написано один раз, а не скопировано', () => {
  const root = path.join(__dirname, '..')
  const guilty: string[] = []
  for (const dir of ROOTS) {
    const full = path.join(root, dir)
    if (!fs.existsSync(full)) continue
    for (const file of sources(full)) {
      const relative = path.relative(root, file)
      if (relative === HOME) continue
      const text = fs.readFileSync(file, 'utf8')
      for (const at of arithmeticHits(text)) {
        guilty.push(`${relative}:${text.slice(0, at).split('\n').length}`)
      }
    }
  }

  expect(
    guilty,
    `своя копия правила склонения (импортируйте ruPlural/ruCount из lib/ru-plural.ts):\n${guilty.join('\n')}`,
  ).toEqual([])
})

/**
 * Раз правило одно, ему и цена одна: ошибка в нём разъезжается теперь ПО
 * ВСЕМУ порталу разом. Проверяются числа, на которых ломались копии, — и
 * прежде всего второй десяток: тернарник без `% 100` проходит 1, 2 и 5 и
 * падает ровно на 11 и 21 (Plane №585).
 */
test('общее правило верно на числах, на которых ломались копии', () => {
  const forms = EVENTS
  expect(ruPlural(1, forms), 'единица').toBe('мероприятие')
  expect(ruPlural(2, forms), 'двойка').toBe('мероприятия')
  expect(ruPlural(5, forms), 'пятёрка').toBe('мероприятий')
  expect(ruPlural(0, forms), 'ноль — как «много»').toBe('мероприятий')
  // Второй десяток целиком просит третью форму, вопреки своим хвостам.
  for (const teen of [11, 12, 13, 14]) {
    expect(ruPlural(teen, forms), `${teen} — второй десяток`).toBe('мероприятий')
  }
  expect(ruPlural(21, forms), '21 — хвост 1 вне второго десятка').toBe('мероприятие')
  expect(ruPlural(22, forms), '22 — хвост 2 вне второго десятка').toBe('мероприятия')
  expect(ruPlural(111, forms), '111 — второй десяток внутри сотни').toBe('мероприятий')

  // Число и слово вместе — так это читают со страницы.
  expect(ruCount(2, ASSIGNMENTS)).toBe('2 назначения')
  expect(ruCount(5, DAYS)).toBe('5 дней')

  // 🔴 РОДИТЕЛЬНЫЙ ПАДЕЖ — ОТДЕЛЬНЫЕ ФОРМЫ, А НЕ ОШИБКА В ТАБЛИЦЕ. «из двух
  // мероприятиЙ» ровно так же родительный, как «из пяти»: падеж задаёт
  // предлог, а не число. Одна копия обслуживала обе грамматики и в
  // именительной врала («Участие в ОМ: 2 мероприятий»).
  expect(ruPlural(1, EVENTS_OF), 'из 1 …').toBe('мероприятия')
  expect(ruPlural(2, EVENTS_OF), 'из 2 …').toBe('мероприятий')
  expect(ruPlural(5, EVENTS_OF), 'из 5 …').toBe('мероприятий')
})
