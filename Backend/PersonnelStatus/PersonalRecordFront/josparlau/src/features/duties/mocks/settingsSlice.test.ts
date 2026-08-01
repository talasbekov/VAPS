// Проекция правил конфликтов из чужого слайса «Настройки» (§8.4/§21.35).
import { describe, expect, it } from 'vitest'
import { readConflictPolicy } from './settingsSlice'

function slice(value: unknown, version: unknown = 'conflict-rules-2026.07.1') {
  return {
    settings: {
      sectionVersions: { CONFLICT_RULES: version },
      settings: [
        {
          settingCode: 'CONFLICT.REST_AFTER_DUTY.MODE',
          sectionCode: 'CONFLICT_RULES',
          value,
        },
      ],
    },
  }
}

describe('readConflictPolicy', () => {
  it('читает действующий режим и версию правил', () => {
    expect(readConflictPolicy(slice('SOFT_OVERRIDE'))).toEqual({
      restAfterDutyMode: 'SOFT_OVERRIDE',
      conflictPolicyVersion: 'conflict-rules-2026.07.1',
    })
  })

  it('без слайса настроек — СТРОГИЙ дефолт §21.35 и версия null', () => {
    // Молча ослабить запрет из-за недоступной политики значило бы пропустить
    // назначение, которое действующая политика могла бы отвергнуть. Версия при
    // этом null: помечать конфликт чужой редакцией правил нельзя.
    expect(readConflictPolicy({})).toEqual({
      restAfterDutyMode: 'HARD_BLOCK',
      conflictPolicyVersion: null,
    })
  })

  it('непонятое значение режима НЕ превращается в «ограничений нет»', () => {
    expect(readConflictPolicy(slice('BEFORE_DUTY')).restAfterDutyMode).toBe('HARD_BLOCK')
    expect(readConflictPolicy(slice(null)).restAfterDutyMode).toBe('HARD_BLOCK')
  })

  it('слайс без версии правил читается как непрочитанная политика целиком', () => {
    // Версия — часть контракта: режим без редакции нечем сверить в протоколе.
    expect(readConflictPolicy(slice('SOFT_OVERRIDE', ''))).toEqual({
      restAfterDutyMode: 'HARD_BLOCK',
      conflictPolicyVersion: null,
    })
  })

  it('запись ЧУЖОГО раздела режимом не считается', () => {
    // Порог наблюдений с тем же кодом поля не должен подменять правило.
    const foreign = {
      settings: {
        conflictPolicyVersion: 'conflict-rules-2026.07.1',
        settings: [
          {
            settingCode: 'CONFLICT.REST_AFTER_DUTY.MODE',
            sectionCode: 'ATTENTION_POLICY',
            value: 'SOFT_OVERRIDE',
          },
        ],
      },
    }
    expect(readConflictPolicy(foreign).restAfterDutyMode).toBe('HARD_BLOCK')
  })
})

