/**
 * Галочка «уточняется» стоит там, где флаг действует (Plane №517, №518).
 *
 * 🔴 ПОЧЕМУ ПРОБА НЕ ЖИВАЯ. Она сверяет ЧИСТУЮ спеку разделов — ни браузера,
 * ни стенда для этого не нужно. Тот же приём, что у `ru-plural.spec.ts`: без
 * `SMOKE_LIVE` она даёт «passed», а не «skipped», иначе молчание читалось бы
 * как зелень.
 *
 * ЧТО СТЕРЕЖЁТ. Флаги «уточняется» хранятся ОДНИМ списком у визита
 * (`visit.unspecified`) и читаются сервером как ПУТИ — документом
 * (`documents_summary.document_values`) и проверкой обязательных полей
 * (`REQUIRED_VISIT_FIELDS`). Отсюда два правила, которые эта проба и держит:
 *
 * 1) путь флага уникален на весь документ. Пока флаг писался именем поля
 *    формы, «Прибытие» и «Убытие» делили ключ `time`, а «Состав ГВО» и
 *    «Ответственный» — ключ `resp`: пометил одно — пометилось другое (№517);
 * 2) галочка не рисуется у поля, чей путь не читает никто. У ФИО лица, его
 *    должности и названия группы пути нет вовсе, а голые `name`/`role` ещё и
 *    общие у всех лиц и всех групп сразу — галочка там стояла и не делала
 *    ничего (№518).
 */
import { expect, test } from '@playwright/test'
import { REQUIRED_VISIT_FIELDS, gvoSectionSpec } from '../entities/gvo-summary'
import type { GvoSection } from '../entities/gvo-summary'

const WHOLE_SECTIONS: GvoSection[] = [
  'head',
  'persons',
  'arrival',
  'departure',
  'org',
  'groups',
  'resp',
  'transport',
]

const LIST_SECTIONS: GvoSection[] = ['person:0', 'person:1', 'group:0', 'group:1']

/**
 * Пути, которые сервер действительно спрашивает: места подстановки документа
 * (`documents_summary.document_values`) плюс обязательные поля визита.
 *
 * Список ПИН, а не источник: он обязан совпадать с сервером, и расхождение —
 * дефект. Держать его здесь дешевле, чем гонять живой стенд ради одного
 * набора строк; клиент уже держит рядом `REQUIRED_VISIT_FIELDS` по той же
 * причине.
 */
const PATHS_THE_SERVER_READS = new Set<string>([
  'country',
  'persons',
  'arrival.date',
  'arrival.time',
  'arrival.route',
  'arrival.flight',
  'arrival.dur',
  'departure.date',
  'departure.time',
  'departure.route',
  'departure.flight',
  'departure.dur',
  'stay.place',
  'stay.room',
  'sbChief',
  'weapons',
  'wishes',
  'obVariant',
  'radio',
  'responsible',
])

test.describe('«уточняется»: где стоит галочка', () => {
  test('обязательные поля визита сервер тоже читает по пути', () => {
    for (const { path } of REQUIRED_VISIT_FIELDS) {
      expect(PATHS_THE_SERVER_READS.has(path), path).toBe(true)
    }
  })

  test('галочка стоит только у поля, чей путь кто-то читает', () => {
    const shown: string[] = []
    for (const section of [...WHOLE_SECTIONS, ...LIST_SECTIONS]) {
      for (const field of gvoSectionSpec(section).fields) {
        if (field.flaggable) shown.push(field.path)
      }
    }
    expect(shown.length).toBeGreaterThan(0)
    for (const path of shown) {
      expect(PATHS_THE_SERVER_READS.has(path), path).toBe(true)
    }
  })

  test('у ФИО, должности и названия группы галочки нет', () => {
    for (const section of LIST_SECTIONS) {
      for (const field of gvoSectionSpec(section).fields) {
        expect(field.flaggable, `${section}/${field.key}`).toBe(false)
      }
    }
  })

  test('путь флага не делится между двумя разными полями', () => {
    // Одно и то же поле сводки может стоять в двух разделах — «Ответственный»
    // показан и в «Составе ГВО», и в своём разделе. Тогда и путь, и имя поля
    // совпадают, и это не столкновение. Столкновение — когда путь один, а
    // поля РАЗНЫЕ: ровно это и было у `time` в «Прибытии» и «Убытии».
    const owner = new Map<string, string>()
    const seen: string[] = []
    for (const section of WHOLE_SECTIONS) {
      for (const field of gvoSectionSpec(section).fields) {
        if (!field.flaggable) continue
        seen.push(`${section}/${field.key}`)
        const previous = owner.get(field.path)
        expect(
          previous === undefined || previous === field.key,
          `путь ${field.path} делят поля ${previous} и ${field.key} (${section})`
        ).toBe(true)
        owner.set(field.path, field.key)
      }
    }
    // Проба не пустая: разделы действительно отдают поля с галочкой, и среди
    // них есть тёзки — `date`, `time`, `route` у «Прибытия» и «Убытия».
    expect(seen).toContain('arrival/time')
    expect(seen).toContain('departure/time')
    expect(owner.get('arrival.time')).toBe('time')
    expect(owner.get('departure.time')).toBe('time')
  })
})
