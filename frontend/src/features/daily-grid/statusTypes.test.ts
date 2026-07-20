// Story 10.2 (QA-добор) — инварианты каталога статус-типов. Окружение node:
// константа, DOM не нужен.
//
// Каталог — ЗЕРКАЛО seed-справочника бэка (seed_statuses.STATUS_TYPES, 17
// типов). Полноценно сверить его с бэком отсюда нельзя (читать Backend/** из
// фронт-теста = связать сюиты двух стеков), и это by design: при дрейфе бэк
// ответит ошибкой на неизвестный status_type_code — отказ громкий. Здесь
// проверяются те свойства каталога, поломка которых НЕ громкая, а тихая:
// дубль кода, выпавший DEFAULT_STATUS, недопереведённая подпись.
import { describe, expect, it } from 'vitest'

import { DEFAULT_STATUS } from './prefill'
import { STATUS_TYPE_OPTIONS } from './statusTypes'

describe('STATUS_TYPE_OPTIONS — зеркало seed-каталога', () => {
  it('17 типов в порядке приоритета seed: от SICK_LEAVE до IN_SERVICE', () => {
    expect(STATUS_TYPE_OPTIONS).toHaveLength(17)
    // Крайние точки порядка приоритета (seed_statuses.py:11-32): самый сильный
    // факт — первым, derived «В строю» — последним. Порядок виден оператору в
    // выпадашке статуса, и это не косметика: ритуал «правь отклонения» ждёт
    // частые причины сверху.
    expect(STATUS_TYPE_OPTIONS[0]).toEqual({
      code: 'SICK_LEAVE',
      label: 'На больничном',
    })
    expect(STATUS_TYPE_OPTIONS.at(-1)).toEqual({
      code: 'IN_SERVICE',
      label: 'В строю',
    })
  })

  it('коды уникальны — дубль дал бы два <option> с одним value', () => {
    const codes = STATUS_TYPE_OPTIONS.map((option) => option.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('DEFAULT_STATUS каталогом покрыт — иначе преднабор рисует СЫРОЙ код', () => {
    // Грид ищет подпись по коду и при промахе показывает сам код
    // (DailyGrid.tsx:177). Выпади IN_SERVICE из каталога — весь преднабор
    // (все строки!) молча превратился бы в «IN_SERVICE» вместо «В строю»,
    // а выпадашка не дала бы вернуть строку в исходное состояние.
    const codes = STATUS_TYPE_OPTIONS.map((option) => option.code)
    expect(codes).toContain(DEFAULT_STATUS)
  })

  it('подписи русские и непустые — латиница выдала бы недопереведённый каталог', () => {
    // Интерфейс русский (architecture.md#L63). Урок E9: латинская фикстура даёт
    // «зелёный тест на сломанном», поэтому проверяем ПОДПИСИ, а не длину.
    for (const option of STATUS_TYPE_OPTIONS) {
      expect(option.label.trim()).not.toBe('')
      expect(option.label).toMatch(/[А-Яа-яЁё]/)
    }
  })

  it('коды — UPPER_SNAKE, как в seed (кириллица/пробел уехали бы в payload)', () => {
    for (const option of STATUS_TYPE_OPTIONS) {
      expect(option.code).toMatch(/^[A-Z][A-Z_]*$/)
    }
  })
})
