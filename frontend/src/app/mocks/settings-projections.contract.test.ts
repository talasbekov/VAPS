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
  readAttentionPolicy,
  readRestAfterDutyMode,
} from '../../features/service-analytics/mocks/settingsSlice'

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
})
