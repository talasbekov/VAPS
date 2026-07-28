import { describe, expect, it } from 'vitest'
import {
  addDaysIso,
  dayOfMonthLabel,
  startOfWeekIso,
  weekDaysIso,
  weekRangeLabel,
  weekdayShortLabel,
} from './calendar'

// Календарные функции обязаны быть таймзоно-независимыми: файл гоняется и в
// плюсовой зоне разработчика (+05), и в CI. Значения ниже — календарные, не
// «локальные»: если бы внутри появился `new Date(iso)` (парсится как UTC, но
// читается локальными геттерами), в минусовой зоне даты уехали бы на сутки.
describe('calendar', () => {
  describe('addDaysIso', () => {
    it('сдвигает вперёд и назад', () => {
      expect(addDaysIso('2026-07-20', 1)).toBe('2026-07-21')
      expect(addDaysIso('2026-07-20', -1)).toBe('2026-07-19')
      expect(addDaysIso('2026-07-20', 0)).toBe('2026-07-20')
    })

    it('переходит через границу месяца и года', () => {
      expect(addDaysIso('2026-07-31', 1)).toBe('2026-08-01')
      expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
      expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
    })

    it('учитывает високосный февраль', () => {
      expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
      expect(addDaysIso('2028-03-01', -1)).toBe('2028-02-29')
    })

    it('отвергает не-ISO вход, а не молча возвращает NaN-дату', () => {
      expect(() => addDaysIso('20.07.2026', 1)).toThrow(/ГГГГ-ММ-ДД/)
    })
  })

  describe('startOfWeekIso', () => {
    it('неделя начинается с понедельника', () => {
      // 2026-07-20 — понедельник
      expect(startOfWeekIso('2026-07-20')).toBe('2026-07-20')
      expect(startOfWeekIso('2026-07-23')).toBe('2026-07-20')
      // воскресенье принадлежит УХОДЯЩЕЙ неделе, а не следующей
      expect(startOfWeekIso('2026-07-26')).toBe('2026-07-20')
      expect(startOfWeekIso('2026-07-27')).toBe('2026-07-27')
    })
  })

  it('weekDaysIso даёт ровно 7 последовательных дат', () => {
    expect(weekDaysIso('2026-07-20')).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
      '2026-07-25',
      '2026-07-26',
    ])
  })

  it('weekdayShortLabel и dayOfMonthLabel подписывают колонки', () => {
    expect(weekdayShortLabel('2026-07-20')).toBe('пн')
    expect(weekdayShortLabel('2026-07-26')).toBe('вс')
    expect(dayOfMonthLabel('2026-07-05')).toBe('5')
  })

  describe('weekRangeLabel', () => {
    it('внутри одного месяца — «14–20 июля 2026»', () => {
      expect(weekRangeLabel('2026-07-14')).toBe('14–20 июля 2026')
    })

    it('на стыке месяцев печатает оба месяца', () => {
      expect(weekRangeLabel('2026-07-27')).toBe('27 июля – 2 августа 2026')
    })
  })
})
