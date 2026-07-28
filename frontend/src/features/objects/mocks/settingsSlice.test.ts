// Проекция политики свежести паспорта из чужого слайса «Настройки» (§8.4/§21.7).
import { describe, expect, it } from 'vitest'
import { FALLBACK_FRESHNESS_POLICY, readFreshnessPolicy } from './settingsSlice'

function slice(interval: unknown, dueSoon: unknown, version: unknown = 'passport-freshness-2026.07.1') {
  return {
    settings: {
      sectionVersions: { PASSPORT_FRESHNESS: version },
      settings: [
        {
          settingCode: 'PASSPORT.FRESHNESS.PARAMETER',
          sectionCode: 'PASSPORT_FRESHNESS',
          value: interval,
        },
        {
          settingCode: 'PASSPORT.FRESHNESS.WARNING_FROM',
          sectionCode: 'PASSPORT_FRESHNESS',
          value: dueSoon,
        },
      ],
    },
  }
}

describe('readFreshnessPolicy', () => {
  it('читает интервал, порог и версию своего раздела', () => {
    expect(readFreshnessPolicy(slice(200, 35))).toEqual({
      version: 'passport-freshness-2026.07.1',
      verificationIntervalDays: 200,
      dueSoonPercent: 35,
    })
  })

  it('без слайса настроек версия ГОВОРИТ О СЕБЕ, а не выдаёт себя за действующую', () => {
    // §21.7 требует `freshnessPolicyVersion` в каждом результате именно для
    // сверки методики: пометить расчёт действующей редакцией, не прочитав её,
    // значило бы соврать.
    const policy = readFreshnessPolicy({})
    expect(policy).toEqual(FALLBACK_FRESHNESS_POLICY)
    expect(policy.version).toContain('unresolved')
  })

  it('нечисловое и неположительное значение не принимается', () => {
    // Интервал в 0 дней объявил бы просроченными ВСЕ паспорта разом, а строка
    // «120» пришла бы из формы, минующей серверную валидацию.
    expect(readFreshnessPolicy(slice(0, 20)).verificationIntervalDays).toBe(120)
    expect(readFreshnessPolicy(slice('120', 20)).verificationIntervalDays).toBe(120)
    expect(readFreshnessPolicy(slice(200, -5)).dueSoonPercent).toBe(20)
  })

  it('запись ЧУЖОГО раздела политикой паспорта не считается', () => {
    const foreign = {
      settings: {
        sectionVersions: { PASSPORT_FRESHNESS: 'passport-freshness-2026.07.1' },
        settings: [
          {
            settingCode: 'PASSPORT.FRESHNESS.PARAMETER',
            sectionCode: 'ATTENTION_POLICY',
            value: 999,
          },
        ],
      },
    }
    expect(readFreshnessPolicy(foreign).verificationIntervalDays).toBe(120)
  })

  it('слайс без версии раздела читается как непрочитанная политика целиком', () => {
    expect(readFreshnessPolicy(slice(200, 35, ''))).toEqual(FALLBACK_FRESHNESS_POLICY)
  })
})

