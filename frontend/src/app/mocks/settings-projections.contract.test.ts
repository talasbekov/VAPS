// Контракт demo-снапшота: узкие проекции ЧИТАЮТ реальный слайс «Настройки».
//
// Зачем отдельный файл и почему именно в `app/`. Фичи читают чужие слайсы
// рукописными проекциями через `unknown` — импорт между фичами запрещён
// (ARCH-FE-013), поэтому граница «владелец → потребитель» НЕ ТИПИЗИРОВАНА.
// Следствие: переименование поля у владельца компилируется зелёным, а
// потребитель молча падает на дефолт. Юнит-тесты обеих сторон при этом
// остаются зелёными — у каждого своя фикстура.
//
// Так и случилось на Этапе 51: `policyVersion`/`conflictPolicyVersion` стали
// картой `sectionVersions`, гейт был зелёным, и разрыв поймал только живой
// e2e. Здесь собраны ВСЕ потребители политики против ТОГО САМОГО сида, который
// уезжает в demo-снапшот, — расхождение краснеет сразу и по имени фичи.
//
// `app/` — единственный слой, которому позволено видеть несколько фич сразу
// (здесь же живёт `compose-seed.ts`), поэтому проверка целостности снапшота
// принадлежит ему, а не какой-то одной фиче.
import { describe, expect, it } from 'vitest'
import { buildSettingsSeed } from '../../features/settings/mocks/fixtures'
import { readConflictPolicy } from '../../features/duties/mocks/settingsSlice'
import { readFreshnessPolicy } from '../../features/objects/mocks/settingsSlice'
import {
  readAnalyticsCustomPeriodLimit,
  readAttentionPolicy,
  readRestAfterDutyMode,
} from '../../features/service-analytics/mocks/settingsSlice'
import { readReportLimits } from '../../features/service-reports/mocks/settingsSlice'
import { REPORT_TYPES } from '../../features/service-reports/mocks/fixtures'

const { sliceName, data } = buildSettingsSeed()
const slices = { [sliceName]: data }

describe('проекции слайса «Настройки» понимают его реальную форму', () => {
  it('планирование дежурств читает правила конфликтов §21.35', () => {
    const policy = readConflictPolicy(slices)
    expect(policy.conflictPolicyVersion).not.toBeNull()
    expect(policy.restAfterDutyMode).toBe('SOFT_OVERRIDE')
  })

  it('реестр объектов читает политику свежести паспорта §21.7', () => {
    const policy = readFreshnessPolicy(slices)
    // Версия-заглушка означала бы, что слайс не прочитан.
    expect(policy.version).not.toContain('unresolved')
    expect(policy.verificationIntervalDays).toBe(120)
    expect(policy.dueSoonPercent).toBe(20)
  })

  it('аналитика службы читает пороги наблюдений §22.11 и тот же режим отдыха', () => {
    const policy = readAttentionPolicy(slices)
    expect(policy).not.toBeNull()
    expect(policy?.byDetector.get('ACKNOWLEDGEMENT_MISSING')?.parameter).toBe(3)
    expect(policy?.byDetector.get('CONFLICT_SHARE')?.warningFrom).toBe(18)
    // Один и тот же факт для двух потребителей: разойтись они не имеют права.
    expect(readRestAfterDutyMode(slices)).toBe(readConflictPolicy(slices).restAfterDutyMode)
  })

  it('аналитика службы читает предел произвольного периода §22.5', () => {
    const limit = readAnalyticsCustomPeriodLimit(slices)
    expect(limit).not.toBeNull()
    expect(limit?.maxDays).toBe(62)
    // Редакция СВОЯ, не общая с наблюдениями: иначе правка предела объявляла бы
    // изменившейся методику блока «Требует внимания».
    expect(limit?.policyVersion).toBe(data.sectionVersions.ANALYTICS_LIMITS)
    expect(limit?.policyVersion).not.toBe(data.sectionVersions.ATTENTION_POLICY)
  })

  it('отчётный реестр читает предел периода и срок хранения §22.5/§22.22', () => {
    const limits = readReportLimits(slices)
    // Ключ карты — код ТИПА отчёта, и проверяется он по РЕАЛЬНОМУ реестру
    // типов: заведённый тип без записи политики не формируется вовсе, и
    // узнать об этом лучше здесь, чем на экране.
    for (const type of REPORT_TYPES) {
      expect(limits.maxPeriodDaysByType.get(type.reportTypeCode)).toEqual(expect.any(Number))
    }
    expect(limits.maxPeriodDaysByType.get('PERSONNEL_EXPENSE')).toBe(92)
    expect(limits.retentionDays).toBe(21)
    expect(limits.policyVersion).toBe(data.sectionVersions.REPORT_LIMITS)
  })

  it('каждый раздел сида имеет свою редакцию — общих версий нет', () => {
    const versions = Object.values(data.sectionVersions)
    expect(new Set(versions).size).toBe(versions.length)
  })
})
