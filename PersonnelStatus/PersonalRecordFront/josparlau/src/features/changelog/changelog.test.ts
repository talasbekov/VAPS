// Стори 10.9 — чистая модель журнала «сообщено → исправлено» (AC-8, AC-10).
//
// 🔴 ЭТОТ ФАЙЛ ОБЯЗАН ПРОГОНЯТЬСЯ И ПОД ОТРИЦАТЕЛЬНОЙ ЗОНОЙ:
//     TZ=America/Anchorage npx vitest run src/features/changelog/changelog.test.ts
// Причина — QA-находка 10.7 (HIGH), повторившая класс 10.5: форматирование
// даты через `new Date(iso)` оставляло 71/71 тестов ЗЕЛЁНЫМИ под зоной гейта
// (+05) и краснело только под минусовой. `new Date('2026-07-19')` парсится как
// UTC-полночь; в America/Anchorage (UTC−8/−9) локальная дата откатывается на
// сутки назад. Машина разработчика в плюсовой зоне баг не увидит.
import { describe, expect, it } from 'vitest'
import type { FixEntry } from './changelog'
import {
  CLOSED_FIXES,
  formatJournalDate,
  sortFixesByRelease,
} from './changelog'

// Фикстуры кириллические и различимы по ВСЕМ полям: одинаковые значения
// сделали бы ассерт порядка вакуумным («сравнение с самим собой», ретро E9).
const FIX_OLD: FixEntry = {
  id: 'fix-001',
  version: '0.1.0',
  releasedAt: '2026-03-04',
  summary: 'Расход дня не сходился после отмены секондмента',
}
const FIX_NEW: FixEntry = {
  id: 'fix-002',
  version: '0.2.0',
  releasedAt: '2026-07-19',
  summary: 'Светофор показывал «нет данных» вместо опоздания',
}

describe('formatJournalDate (AC-10)', () => {
  it('ISO → ДД.ММ.ГГГГ перестановкой строки', () => {
    expect(formatJournalDate('2026-07-19')).toBe('19.07.2026')
  })

  it('однозначная дата не теряет ведущие нули', () => {
    expect(formatJournalDate('2026-01-05')).toBe('05.01.2026')
  })

  it('ПЕРВОЕ ЯНВАРЯ — граница года, на которой ломается Date-реализация', () => {
    // под America/Anchorage `new Date('2026-01-01')` даст 31.12.2025
    expect(formatJournalDate('2026-01-01')).toBe('01.01.2026')
  })

  it('результат НЕ зависит от часового пояса машины', () => {
    // страховка на случай, если прогон под TZ=America/Anchorage забудут:
    // реализация обязана быть чистой перестановкой, а не вычислением
    const iso = '2026-12-31'
    expect(formatJournalDate(iso)).toBe('31.12.2026')
    expect(formatJournalDate(iso)).toBe(
      `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`,
    )
  })
})

describe('sortFixesByRelease (AC-8)', () => {
  it('новые сверху', () => {
    expect(sortFixesByRelease([FIX_OLD, FIX_NEW])).toEqual([FIX_NEW, FIX_OLD])
  })

  it('уже отсортированный список остаётся в том же порядке', () => {
    expect(sortFixesByRelease([FIX_NEW, FIX_OLD])).toEqual([FIX_NEW, FIX_OLD])
  })

  it('🔴 НЕ мутирует вход: фикстура вызывающего не перетасована', () => {
    const input: readonly FixEntry[] = [FIX_OLD, FIX_NEW]
    const sorted = sortFixesByRelease(input)

    expect(input[0]).toBe(FIX_OLD)
    expect(input[1]).toBe(FIX_NEW)
    expect(sorted).not.toBe(input)
  })

  it('равные даты: порядок входа сохраняется (сортировка стабильна)', () => {
    const first: FixEntry = { ...FIX_OLD, id: 'fix-a', summary: 'Первое' }
    const second: FixEntry = { ...FIX_OLD, id: 'fix-b', summary: 'Второе' }

    expect(sortFixesByRelease([first, second]).map((f) => f.id)).toEqual([
      'fix-a',
      'fix-b',
    ])
  })

  it('пустой список → пустой список', () => {
    expect(sortFixesByRelease([])).toEqual([])
  })
})

describe('CLOSED_FIXES — источник по умолчанию', () => {
  it('сегодня пуст: модели багрепорта нет, наполнение — 13.4', () => {
    expect(CLOSED_FIXES).toEqual([])
  })
})
