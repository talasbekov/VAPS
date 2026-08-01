// @vitest-environment node
// Sensitive identity (§20.27) — чистая модель.
import { describe, expect, it } from 'vitest'
import {
  DISCLOSURE_TTL_MINUTES,
  MIN_PURPOSE_LENGTH,
  disclosureExpiry,
  isDisclosureActive,
  isValidPurpose,
  maskIin,
} from './identity'

describe('maskIin (§20.27 «ИИН по умолчанию маскирован»)', () => {
  it('оставляет ровно четыре последние цифры', () => {
    expect(maskIin('800101300123')).toBe('••••••••0123')
    expect(maskIin('800101300123')).not.toContain('8001')
  })

  it('длина маски не выдаёт длину значения', () => {
    // Нестандартно короткий и нестандартно длинный ИИН дают маску одной длины —
    // иначе по маске можно было бы судить о самом значении.
    expect(maskIin('12345').length).toBe(maskIin('800101300123').length)
    expect(maskIin('8001013001239999').length).toBe(maskIin('800101300123').length)
  })

  it('значение короче хвоста не показывается вовсе', () => {
    expect(maskIin('123')).toBe('••••••••••••')
    expect(maskIin('123')).not.toContain('1')
  })
})

describe('цель раскрытия (§20.27 purpose)', () => {
  it('пустая строка, пробелы и «-» целью не являются', () => {
    expect(isValidPurpose('')).toBe(false)
    expect(isValidPurpose('   ')).toBe(false)
    expect(isValidPurpose('-')).toBe(false)
    expect(isValidPurpose('нужно')).toBe(false)
  })

  it('содержательная цель принимается, порог — MIN_PURPOSE_LENGTH', () => {
    expect(isValidPurpose('a'.repeat(MIN_PURPOSE_LENGTH))).toBe(true)
    expect(isValidPurpose('a'.repeat(MIN_PURPOSE_LENGTH - 1))).toBe(false)
    expect(isValidPurpose('Сверка данных при оформлении допуска')).toBe(true)
  })
})

describe('срок полномочия (§20.27 authority period)', () => {
  it('срок считается от момента раскрытия и конечен', () => {
    const at = '2026-07-20T08:00:00.000Z'
    expect(disclosureExpiry(at)).toBe(
      new Date(Date.parse(at) + DISCLOSURE_TTL_MINUTES * 60_000).toISOString(),
    )
  })

  it('раскрытие перестаёт действовать ровно на границе срока', () => {
    const expires = '2026-07-20T08:15:00.000Z'
    expect(isDisclosureActive(expires, '2026-07-20T08:14:59.000Z')).toBe(true)
    expect(isDisclosureActive(expires, expires)).toBe(false)
    expect(isDisclosureActive(expires, '2026-07-20T08:15:01.000Z')).toBe(false)
  })
})
