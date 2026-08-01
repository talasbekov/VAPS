import { describe, expect, it } from 'vitest'
import {
  findThresholdOrderViolation,
  formatSettingValue,
  nextPolicyVersion,
  validateReason,
  validateSettingValue,
} from './policy'
import type { ChoiceSetting, NumericSetting } from '../model/types'

function setting(overrides: Partial<NumericSetting> = {}): NumericSetting {
  return {
    settingCode: 'ATTENTION.X.PARAMETER',
    kind: 'NUMBER',
    sectionCode: 'ATTENTION_POLICY',
    groupCode: 'X',
    field: 'PARAMETER',
    safeLabel: 'Допуск',
    description: '',
    valueType: 'DAYS',
    value: 3,
    minValue: 1,
    maxValue: 30,
    updatedAt: null,
    updatedBy: null,
    editable: true,
    lockedReason: null,
    ...overrides,
  }
}

function choice(overrides: Partial<ChoiceSetting> = {}): ChoiceSetting {
  return {
    settingCode: 'CONFLICT.REST_AFTER_DUTY.MODE',
    kind: 'CHOICE',
    sectionCode: 'CONFLICT_RULES',
    groupCode: 'REST_AFTER_DUTY',
    field: 'MODE',
    safeLabel: 'Режим обязательного отдыха',
    description: '',
    valueType: 'MODE',
    value: 'SOFT_OVERRIDE',
    options: [
      { value: 'HARD_BLOCK', safeLabel: 'Жёсткий запрет', description: '' },
      { value: 'SOFT_OVERRIDE', safeLabel: 'Обход с обоснованием', description: '' },
    ],
    updatedAt: null,
    updatedBy: null,
    editable: true,
    lockedReason: null,
    ...overrides,
  }
}

describe('nextPolicyVersion', () => {
  it('двигает последний числовой сегмент, сохраняя префикс методики', () => {
    expect(nextPolicyVersion('attention-policy-2026.07.1')).toBe('attention-policy-2026.07.2')
    expect(nextPolicyVersion('attention-policy-2026.07.9')).toBe('attention-policy-2026.07.10')
  })

  it('без числового хвоста добавляет его, а не заменяет строку', () => {
    expect(nextPolicyVersion('attention-policy')).toBe('attention-policy.2')
  })

  it('всегда возвращает ЗНАЧЕНИЕ, отличное от исходного', () => {
    // Инвариант, ради которого функция существует: снимок §22.11 несёт версию,
    // и неизменившаяся версия означала бы «методика прежняя» — то есть ложь.
    for (const current of ['attention-policy-2026.07.1', 'x.0', 'plain', 'a.b.7']) {
      expect(nextPolicyVersion(current)).not.toBe(current)
    }
  })
})

describe('validateSettingValue', () => {
  it('пропускает целое в диапазоне', () => {
    expect(validateSettingValue(setting(), 5)).toEqual({})
  })

  it('отвергает нечисло, дробное и выход за границы', () => {
    expect(validateSettingValue(setting(), '5').value).toBeDefined()
    expect(validateSettingValue(setting(), 2.5).value).toBeDefined()
    expect(validateSettingValue(setting(), 0).value).toBeDefined()
    expect(validateSettingValue(setting(), 31).value).toBeDefined()
  })

  it('границы диапазона включительны', () => {
    expect(validateSettingValue(setting(), 1)).toEqual({})
    expect(validateSettingValue(setting(), 30)).toEqual({})
  })

  it('диапазон берётся ИЗ ЗАПИСИ, а не из общей константы', () => {
    const percent = setting({ valueType: 'PERCENT', minValue: 10, maxValue: 90 })
    expect(validateSettingValue(percent, 5).value).toBeDefined()
    expect(validateSettingValue(percent, 90)).toEqual({})
  })
})

describe('validateReason', () => {
  it('требует объяснение не короче десяти символов', () => {
    expect(validateReason('коротко').reason).toBeDefined()
    expect(validateReason('   ').reason).toBeDefined()
    expect(validateReason(undefined).reason).toBeDefined()
    expect(validateReason('Порог занижен приказом')).toEqual({})
  })

  it('длина считается ПОСЛЕ обрезки пробелов', () => {
    expect(validateReason(`   ${'я'.repeat(9)}   `).reason).toBeDefined()
  })
})

describe('findThresholdOrderViolation', () => {
  const warning = setting({
    settingCode: 'ATTENTION.Y.WARNING_FROM',
    groupCode: 'Y',
    field: 'WARNING_FROM',
    value: 18,
  })
  const critical = setting({
    settingCode: 'ATTENTION.Y.CRITICAL_FROM',
    groupCode: 'Y',
    field: 'CRITICAL_FROM',
    value: 34,
  })
  const settings = [warning, critical, setting()]

  it('нарушение видно только В ПАРЕ: значение само по себе законно', () => {
    // 40 внутри диапазона 1..30? нет — здесь диапазон не проверяется вовсе:
    // это ДРУГАЯ проверка, и она обязана срабатывать на соседнем значении.
    expect(findThresholdOrderViolation(settings, 'ATTENTION.Y.WARNING_FROM', 40)).toMatch(
      /не может быть выше/,
    )
    expect(findThresholdOrderViolation(settings, 'ATTENTION.Y.WARNING_FROM', 30)).toBeNull()
  })

  it('работает и со стороны критического порога', () => {
    expect(findThresholdOrderViolation(settings, 'ATTENTION.Y.CRITICAL_FROM', 10)).toMatch(
      /не может быть выше/,
    )
    expect(findThresholdOrderViolation(settings, 'ATTENTION.Y.CRITICAL_FROM', 18)).toBeNull()
  })

  it('равенство порогов допустимо', () => {
    expect(findThresholdOrderViolation(settings, 'ATTENTION.Y.WARNING_FROM', 34)).toBeNull()
  })

  it('допуск (PARAMETER) парой не связан и нарушения не даёт', () => {
    expect(findThresholdOrderViolation(settings, 'ATTENTION.X.PARAMETER', 29)).toBeNull()
  })

  it('детектор без второго порога нарушения не даёт', () => {
    const lonely = [
      setting({
        settingCode: 'ATTENTION.Z.WARNING_FROM',
        groupCode: 'Z',
        field: 'WARNING_FROM',
        value: 53,
      }),
    ]
    expect(findThresholdOrderViolation(lonely, 'ATTENTION.Z.WARNING_FROM', 700)).toBeNull()
  })

  it('пороги СОСЕДНЕГО детектора в проверку не попадают', () => {
    const mixed = [
      warning,
      critical,
      setting({
        settingCode: 'ATTENTION.W.CRITICAL_FROM',
        groupCode: 'W',
        field: 'CRITICAL_FROM',
        value: 2,
      }),
    ]
    // 30 выше чужого критического (2), но своего (34) — не выше.
    expect(findThresholdOrderViolation(mixed, 'ATTENTION.Y.WARNING_FROM', 30)).toBeNull()
  })
})

describe('правила конфликтов — значение-режим (§21.35)', () => {
  it('принимает только вариант из СПИСКА, пришедшего с записью', () => {
    expect(validateSettingValue(choice(), 'HARD_BLOCK')).toEqual({})
    // Код вне списка — режим, которого не знает ни один потребитель политики.
    expect(validateSettingValue(choice(), 'BEFORE_DUTY').value).toBeDefined()
    // Число режимом не является, даже если оно «похоже» на индекс варианта.
    expect(validateSettingValue(choice(), 1).value).toBeDefined()
  })

  it('числовые правила режимом не подменяются', () => {
    expect(validateSettingValue(setting(), 'HARD_BLOCK').value).toBeDefined()
  })

  it('журнал получает ПОДПИСЬ варианта, а не его код', () => {
    // §29 «old/new» читает человек: «SOFT_OVERRIDE → HARD_BLOCK» требовало бы
    // от него знания кодов, а собирать подпись на экране значило бы держать
    // словарь режимов в двух местах.
    expect(formatSettingValue(choice(), 'HARD_BLOCK')).toBe('Жёсткий запрет')
    expect(formatSettingValue(setting(), 5)).toBe('5')
  })

  it('порядок порогов к режимам не применяется — сравнивать нечего', () => {
    expect(
      findThresholdOrderViolation([choice()], 'CONFLICT.REST_AFTER_DUTY.MODE', 'HARD_BLOCK'),
    ).toBeNull()
  })
})
