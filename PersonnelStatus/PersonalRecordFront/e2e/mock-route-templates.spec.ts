/**
 * Шаблон мок-маршрута достижим: в пути нет закодированного двоеточия
 * (Plane №795).
 *
 * 🔴 ЧТО ЭТО СТЕРЕЖЁТ И ПОЧЕМУ ЭТО ХУЖЕ ОБЫЧНОЙ ОПЕЧАТКИ. Шаблоны маршрутов
 * мока естественно собирать теми же помощниками, что и адреса клиента:
 * `securityEventRemarkResolvePath(':id', ':remarkId')`. Но помощник КОДИРУЕТ
 * идентификатор — на подстановке выходит `…/remarks/%3AremarkId/resolve/`,
 * то есть ЛИТЕРАЛ вместо параметра MSW. Обработчик после этого не совпадает
 * ни с одним запросом.
 *
 * Несовпавший обработчик ведёт себя КАК ОТСУТСТВУЮЩИЙ: запрос уходит в сеть,
 * мок-проба зелена (ответ-то есть, из живого бэка), а правила внутри
 * обработчика не выполняются вовсе. В №569 так молча не работали две правки
 * сразу — автозавершение этапа и версия документа решаемого объекта: обе
 * лежали в коде и не исполнялись, а ответ на замечание в мок-режиме уходил в
 * живой бэкенд и получал `PERMISSION_DENIED`.
 *
 * Помощников, кодирующих параметр, СЕМНАДЦАТЬ. Как шаблон мок-маршрута был
 * использован один — и хватило. Ничто не мешает следующему взять любой из
 * шестнадцати оставшихся, поэтому сторож, а не одна правка.
 *
 * ПРОБА ЧИТАЕТ ЗАРЕГИСТРИРОВАННЫЕ ОБРАБОТЧИКИ, А НЕ ИСХОДНИКИ: у каждого
 * MSW-обработчика есть `info.path` — уже собранная строка, ровно та, по
 * которой пойдёт сравнение. Разбор текста угадывал бы, а здесь смотрится
 * результат. Живой стек не нужен, как и сверке маршрутов
 * (`route-map-coverage`).
 *
 * НАБОРЫ ИМПОРТИРУЮТСЯ НАПРЯМУЮ, а не через `composeOpsHandlers()`: та
 * отдаёт лишь домены, включённые переменной окружения, и недостижимый
 * шаблон в выключенном домене остался бы невидимым до первого включения.
 */
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

import { accessHandlers } from '../mocks/ops/access-handlers'
import { analyticsHandlers } from '../mocks/ops/analytics-handlers'
import { auditHandlers } from '../mocks/ops/audit-store'
import { dictionariesHandlers } from '../mocks/ops/dictionaries-handlers'
import { dutiesHandlers } from '../mocks/ops/duties-handlers'
import { feedbackHandlers } from '../mocks/ops/feedback-handlers'
import { geoHandlers } from '../mocks/ops/geo-handlers'
import { gvoHandlers } from '../mocks/ops/gvo-handlers'
import { legalDocumentsHandlers } from '../mocks/ops/legal-documents-handlers'
import { objectsHandlers } from '../mocks/ops/objects-handlers'
import { protectedPersonsHandlers } from '../mocks/ops/protected-persons-handlers'
import { ratingsHandlers } from '../mocks/ops/ratings-handlers'
import { reportsHandlers } from '../mocks/ops/reports-handlers'
import { securityEventsHandlers } from '../mocks/ops/security-events-handlers'
import { settingsHandlers } from '../mocks/ops/settings-store'

//: Каталог наборов и файл, из которого каждый приехал.
/**
 * Наборы обработчиков — ключом стоит ИМЯ ФАЙЛА, а не короткое слово
 * (Plane №834).
 *
 * 🔴 ЗАЧЕМ ИМЕННО ФАЙЛ. Список наборов ведётся руками, и это его слабое
 * место: появится `mocks/ops/vehicles-handlers.ts`, его впишут в
 * `composeOpsHandlers` и забудут вписать сюда — весь новый домен окажется без
 * сторожа, и ничего не покраснеет. Самопроверка «обработчиков больше ста» от
 * этого не спасает: порог стоит на ОБЩЕЕ число (сейчас 138), и потеря целого
 * набора — access (16), ratings (15), duties (15) — его не пробивает.
 *
 * Ключ-файл позволяет спросить у файловой системы прямо: «каждый ли файл
 * каталога, где есть регистрация `http.*`, попал под сторожа». Приём взят у
 * соседней пробы `route-map-coverage.spec.ts`, которая нарочно берёт одну
 * сторону из файловой системы, чтобы новая страница не могла ускользнуть.
 */
const SETS: ReadonlyArray<readonly [string, readonly unknown[]]> = [
  ['access-handlers.ts', accessHandlers],
  ['analytics-handlers.ts', analyticsHandlers],
  ['audit-store.ts', auditHandlers],
  ['dictionaries-handlers.ts', dictionariesHandlers],
  ['duties-handlers.ts', dutiesHandlers],
  ['feedback-handlers.ts', feedbackHandlers],
  ['geo-handlers.ts', geoHandlers],
  ['gvo-handlers.ts', gvoHandlers],
  ['legal-documents-handlers.ts', legalDocumentsHandlers],
  ['objects-handlers.ts', objectsHandlers],
  ['protected-persons-handlers.ts', protectedPersonsHandlers],
  ['ratings-handlers.ts', ratingsHandlers],
  ['reports-handlers.ts', reportsHandlers],
  ['security-events-handlers.ts', securityEventsHandlers],
  ['settings-store.ts', settingsHandlers],
]

/**
 * Шаблон маршрута обработчика — строкой, ровно та, по которой пойдёт
 * сравнение MSW.
 *
 * 🔴 ВОЗВРАЩАЕТ `null`, А НЕ ПУСТУЮ СТРОКУ (Plane №834). Прежняя редакция
 * приводила значение к строке через `String(info?.path ?? '')`, и это делало
 * сторожа слепым молча: переименуй MSW поле `info.path` или попади в набор
 * не-`http` обработчик — все пути стали бы пустыми строками, список виновных
 * остался бы пустым, счётчик прежним, и проба вечно печатала бы «1 passed»,
 * не проверяя ничего. Ровно тот отказ, ради которого сторож и заведён, — на
 * этаж выше.
 */
function pathOf(handler: unknown): string | null {
  const info = (handler as { info?: { path?: unknown } }).info
  return typeof info?.path === 'string' && info.path !== '' ? info.path : null
}

test('в шаблонах мок-маршрутов нет закодированного двоеточия', () => {
  const encoded: string[] = []
  const unreadable: string[] = []
  const withoutStar: string[] = []
  let counted = 0
  for (const [file, handlers] of SETS) {
    for (const handler of handlers) {
      counted += 1
      const template = pathOf(handler)
      if (template === null) {
        unreadable.push(`${file}: обработчик №${counted}`)
        continue
      }
      // `%3A` в любом регистре: `encodeURIComponent` даёт верхний, но чужой
      // код мог закодировать и вручную.
      if (/%3a/i.test(template)) encoded.push(`${file}: ${template}`)
      // 🔴 ВЕДУЩАЯ «*» — ВТОРАЯ ПОЛОВИНА ТОГО ЖЕ КЛАССА (Plane №834). Без неё
      // запрос по абсолютному адресу бэкенда уходит мимо мока в сеть — тот же
      // симптом, что у кодированного двоеточия: обработчик есть, ответ есть,
      // а правила внутри него не выполняются. Требование записано в шапке
      // `protected-persons-handlers.ts`; здесь оно закреплено проверкой.
      if (!template.startsWith('*')) withoutStar.push(`${file}: ${template}`)
    }
  }

  // Сторож без обработчиков — не сторож: пустой список прошёл бы молча, а
  // именно так выглядит сломанный импорт.
  expect(counted, 'обработчиков не найдено — проба ничего не проверила').toBeGreaterThan(100)
  expect(
    unreadable,
    `у обработчика не читается шаблон маршрута — форма MSW изменилась, и сторож ослеп:\n${unreadable.join('\n')}`,
  ).toEqual([])
  expect(
    encoded,
    `шаблон собран помощником, кодирующим параметр, — обработчик недостижим:\n${encoded.join('\n')}`,
  ).toEqual([])
  expect(
    withoutStar,
    `шаблон без ведущей «*» — запрос по абсолютному адресу уйдёт мимо мока:\n${withoutStar.join('\n')}`,
  ).toEqual([])
})

test('каждый файл обработчиков мока попал под сторожа', () => {
  // 🔴 ОДНА СТОРОНА БЕРЁТСЯ ИЗ ФАЙЛОВОЙ СИСТЕМЫ (Plane №834, приём из
  // `route-map-coverage.spec.ts`). Пока обе стороны вели руками, новый набор
  // обработчиков мог остаться без сторожа, и узнать об этом было неоткуда:
  // проба продолжала печатать «1 passed».
  const directory = path.join(__dirname, '..', 'mocks', 'ops')
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.ts'))
    .filter((name) =>
      /\bhttp\.(get|post|put|patch|delete)\b/.test(
        fs.readFileSync(path.join(directory, name), 'utf8'),
      ),
    )
    .sort()
  const covered = new Set(SETS.map(([file]) => file))

  // Обход каталога обязан что-то находить: пустой список — это сломанный
  // путь, и он прошёл бы молча, как и всё остальное в этой пробе.
  expect(files.length, 'в каталоге мока не найдено файлов с обработчиками').toBeGreaterThan(10)
  expect(
    files.filter((name) => !covered.has(name)),
    'файл обработчиков не перечислен в SETS — его маршруты не стережёт никто',
  ).toEqual([])
  // И обратное: имя в SETS, которому не соответствует файл, — след переезда,
  // после которого набор молча выпал из проверки.
  expect(
    [...covered].filter((name) => !files.includes(name)),
    'в SETS есть файл, которого нет в каталоге (или в нём не осталось обработчиков)',
  ).toEqual([])
})
