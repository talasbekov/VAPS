// Чистая модель привязки к версии паспорта (§9.6) — env node (ни React, ни DOM).
import { describe, expect, it } from 'vitest'
import type { PassportVersionProjection, SecurityObjectProjection } from './passportBinding'
import {
  bindPassportVersion,
  isBindingStale,
  resolveApplicableVersion,
} from './passportBinding'

function version(
  versionNumber: number,
  effectiveFrom: string,
): PassportVersionProjection {
  return {
    id: `v-${versionNumber}`,
    versionNumber,
    effectiveFrom,
    sectors: [],
  }
}

function object(versions: PassportVersionProjection[]): SecurityObjectProjection {
  return {
    id: 'object-1',
    name: 'Дворец Независимости',
    code: 'OBJ-001',
    passportVersions: versions,
  }
}

describe('resolveApplicableVersion', () => {
  it('возвращает null, когда у объекта нет ни одной опубликованной версии', () => {
    expect(resolveApplicableVersion(object([]), '2026-08-01')).toBeNull()
  })

  it('возвращает null, когда все версии вступают в силу ПОЗЖЕ даты мероприятия', () => {
    const applicable = resolveApplicableVersion(
      object([version(1, '2026-09-01'), version(2, '2026-10-01')]),
      '2026-08-31',
    )
    expect(applicable).toBeNull()
  })

  it('берёт последнюю по номеру среди действующих на дату, а не последнюю опубликованную', () => {
    const applicable = resolveApplicableVersion(
      object([version(1, '2026-01-01'), version(2, '2026-07-01'), version(3, '2026-09-01')]),
      '2026-08-15',
    )
    expect(applicable?.versionNumber).toBe(2)
  })

  it('версия, вступающая в силу РОВНО в дату мероприятия, уже действует', () => {
    const applicable = resolveApplicableVersion(
      object([version(1, '2026-01-01'), version(2, '2026-08-15')]),
      '2026-08-15',
    )
    expect(applicable?.versionNumber).toBe(2)
  })

  it('при задним числом опубликованной версии выигрывает БОЛЬШИЙ номер, а не последняя в массиве', () => {
    // v2 действует с января, v1 — с марта: так бывает, когда более новую
    // редакцию ввели задним числом. Наивное «взять последнюю подходящую»
    // вернуло бы v1 — устаревшую редакцию.
    const versions = [version(2, '2026-01-01'), version(1, '2026-03-01')]
    expect(resolveApplicableVersion(object(versions), '2026-08-15')?.versionNumber).toBe(2)
  })
})

describe('bindPassportVersion', () => {
  it('снимок несёт имя объекта на момент привязки, а не ссылку на объект', () => {
    const source = object([version(1, '2026-01-01')])
    const binding = bindPassportVersion(source, source.passportVersions[0], '2026-08-01T10:00:00Z')

    expect(binding).toEqual({
      objectId: 'object-1',
      objectName: 'Дворец Независимости',
      versionId: 'v-1',
      versionNumber: 1,
      effectiveFrom: '2026-01-01',
      boundAt: '2026-08-01T10:00:00Z',
    })

    // Переименование объекта после привязки не переписывает снимок: архив и
    // печатные формы обязаны показывать имя, под которым мероприятие велось.
    source.name = 'Переименован'
    expect(binding.objectName).toBe('Дворец Независимости')
  })
})

describe('isBindingStale', () => {
  const binding = bindPassportVersion(
    object([version(2, '2026-07-01')]),
    version(2, '2026-07-01'),
    '2026-07-10T00:00:00Z',
  )

  it('не устарела, когда действует та же версия', () => {
    expect(isBindingStale(binding, version(2, '2026-07-01'))).toBe(false)
  })

  it('устарела, когда опубликована и уже действует более новая версия', () => {
    expect(isBindingStale(binding, version(3, '2026-08-01'))).toBe(true)
  })

  it('не устарела при отсутствии действующей версии — это другой случай (§9.6), не «устарела»', () => {
    expect(isBindingStale(binding, null)).toBe(false)
  })
})
