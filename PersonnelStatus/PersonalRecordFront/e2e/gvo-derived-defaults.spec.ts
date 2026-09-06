/**
 * Поля, которые сводка заполняет САМА, не считаются заполненными (Plane №521).
 *
 * 🔴 ПОЧЕМУ ПРОБА НЕ ЖИВАЯ. Она сверяет ЧИСТОЕ правило мок-слоя со списком в
 * `gvo.py` — ни браузера, ни стенда для этого не нужно. Тот же приём, что у
 * `gvo-unspecified-flags.spec.ts`: без `SMOKE_LIVE` она даёт «passed», а не
 * «skipped», иначе молчание читалось бы как зелень.
 *
 * ЧТО СТЕРЕЖЁТ. `deriveGvoSummary` кладёт в обе даты визита день мероприятия.
 * Для ДОКУМЕНТА это разумное умолчание, для проверки «человек заполнил» —
 * смертельное: по этим путям значение не бывает пустым НИКОГДА. Сервер это
 * закрыл (`gvo.DERIVED_DEFAULT_PATHS` + `_entered_by_hand`), а мок остался на
 * старом правиле — и на мок-стенде правило `[ГВО-07]` снова не
 * воспроизводилось: прогресс показывал «4 из 5», когда не введено ничего, а
 * «Утвердить» была включена. Ровно та болезнь, которую чинил №691 (найдено
 * ревью №825).
 *
 * Список сверяется С ИСХОДНИКОМ СЕРВЕРА, а не пинится вторым руками ведомым
 * перечнем: два ручных списка расходятся молча — именно так дефект и родился.
 *
 * МУТАЦИИ, НА КОТОРЫХ ПРОБА ОБЯЗАНА КРАСНЕТЬ:
 *   • убрать путь из `DERIVED_DEFAULT_PATHS` мока (или добавить лишний);
 *   • вернуть `missingRequiredFields` к проверке «непусто в сводке».
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  DERIVED_DEFAULT_PATHS,
  missingRequiredFields,
} from '../entities/gvo-summary'
import type { GvoSummary } from '../entities/gvo-summary'

const GVO_PY = path.join(
  __dirname,
  '..',
  '..',
  'Personnel-Records',
  'organization_management',
  'apps',
  'ops',
  'gvo.py',
)

/** Что сводка выводит сама: день мероприятия в обеих датах. */
const DERIVED_SUMMARY = {
  country: 'Германия',
  persons: [{ name: 'Шмидт', role: 'охраняемое лицо', facts: [] }],
  arrival: { date: '2026-12-31', time: '', route: '', flight: '', dur: '' },
  departure: { date: '2026-12-31', time: '', route: '', flight: '', dur: '' },
  responsible: 'Абаев А.',
} as unknown as GvoSummary

test.describe('выводимые умолчания сводки ГВО', () => {
  test('список путей совпадает с серверным DERIVED_DEFAULT_PATHS', () => {
    const source = readFileSync(GVO_PY, 'utf8')
    const block = /DERIVED_DEFAULT_PATHS\s*=\s*frozenset\(\{([^}]*)\}\)/.exec(source)
    expect(block, 'в gvo.py не найден DERIVED_DEFAULT_PATHS — проба вакуумна').not.toBeNull()
    const onServer = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort()
    expect(onServer.length, 'серверный список пуст — читать нечего').toBeGreaterThan(0)

    expect([...DERIVED_DEFAULT_PATHS].sort()).toEqual(onServer)
  })

  test('без правки человека выводимые поля числятся НЕзаполненными', () => {
    // Ничего не введено: в сводке даты стоят, но поставила их сама сводка.
    expect(missingRequiredFields(DERIVED_SUMMARY, [], {})).toEqual([
      'Дата прибытия',
      'Дата убытия',
    ])
  })

  test('введённое человеком засчитывается, и только оно', () => {
    const entered = { arrival: { date: '2027-01-05' } }

    expect(missingRequiredFields(DERIVED_SUMMARY, [], entered)).toEqual([
      'Дата убытия',
    ])
  })

  test('галочка «уточняется» снимает требование и с выводимого поля', () => {
    expect(
      missingRequiredFields(DERIVED_SUMMARY, ['arrival.date', 'departure.date'], {}),
    ).toEqual([])
  })
})
