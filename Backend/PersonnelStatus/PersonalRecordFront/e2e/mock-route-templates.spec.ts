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

/** Все наборы поимённо: новый набор добавляется сюда же, одной строкой. */
const SETS: ReadonlyArray<readonly [string, readonly unknown[]]> = [
  ['access', accessHandlers],
  ['analytics', analyticsHandlers],
  ['audit', auditHandlers],
  ['dictionaries', dictionariesHandlers],
  ['duties', dutiesHandlers],
  ['feedback', feedbackHandlers],
  ['geo', geoHandlers],
  ['gvo', gvoHandlers],
  ['legal-documents', legalDocumentsHandlers],
  ['objects', objectsHandlers],
  ['protected-persons', protectedPersonsHandlers],
  ['ratings', ratingsHandlers],
  ['reports', reportsHandlers],
  ['security-events', securityEventsHandlers],
  ['settings', settingsHandlers],
]

function pathOf(handler: unknown): string {
  const info = (handler as { info?: { path?: unknown } }).info
  return typeof info?.path === 'string' ? info.path : String(info?.path ?? '')
}

test('в шаблонах мок-маршрутов нет закодированного двоеточия', () => {
  const guilty: string[] = []
  let counted = 0
  for (const [name, handlers] of SETS) {
    for (const handler of handlers) {
      counted += 1
      const path = pathOf(handler)
      // `%3A` в любом регистре: `encodeURIComponent` даёт верхний, но чужой
      // код мог закодировать и вручную.
      if (/%3a/i.test(path)) guilty.push(`${name}: ${path}`)
    }
  }

  // Сторож без обработчиков — не сторож: пустой список прошёл бы молча, а
  // именно так выглядит сломанный импорт.
  expect(counted, 'обработчиков не найдено — проба ничего не проверила').toBeGreaterThan(100)
  expect(
    guilty,
    `шаблон собран помощником, кодирующим параметр, — обработчик недостижим:\n${guilty.join('\n')}`,
  ).toEqual([])
})
