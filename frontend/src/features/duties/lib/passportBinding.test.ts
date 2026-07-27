// @vitest-environment node
// Чистая модель привязки дежурства к версии паспорта (§9.6) — без DOM.
import { describe, expect, it } from 'vitest'
import {
  bindDutyPost,
  firstPostOfVersion,
  isBindingStale,
  resolveApplicableVersion,
} from './passportBinding'
import type { DutyObjectProjection } from './passportBinding'

const OBJECT: DutyObjectProjection = {
  id: 'object-1',
  name: 'Дворец Независимости',
  code: 'OBJ-001',
  passportVersions: [
    {
      id: 'v1',
      versionNumber: 1,
      effectiveFrom: '2026-01-01',
      sectors: [
        { id: 'sector-a', name: 'Сектор A', posts: [{ id: 'post-1', name: 'КПП-1' }] },
      ],
    },
    {
      id: 'v2',
      versionNumber: 2,
      effectiveFrom: '2026-07-01',
      sectors: [
        { id: 'sector-a', name: 'Сектор A', posts: [{ id: 'post-9', name: 'КПП-1 (новый)' }] },
      ],
    },
  ],
}

describe('resolveApplicableVersion', () => {
  it('берёт последнюю по номеру версию среди действующих на дату', () => {
    expect(resolveApplicableVersion(OBJECT, '2026-07-24')?.id).toBe('v2')
  })

  it('не берёт версию, вступающую в силу ПОЗЖЕ даты дежурства', () => {
    expect(resolveApplicableVersion(OBJECT, '2026-06-30')?.id).toBe('v1')
  })

  it('версия, действующая ровно с даты дежурства, уже применима', () => {
    expect(resolveApplicableVersion(OBJECT, '2026-07-01')?.id).toBe('v2')
  })

  it('null, когда ни одна версия ещё не действует — вызывающий обязан объяснить причину', () => {
    expect(resolveApplicableVersion(OBJECT, '2025-12-31')).toBeNull()
  })

  it('null у объекта вовсе без опубликованных версий', () => {
    expect(resolveApplicableVersion({ ...OBJECT, passportVersions: [] }, '2026-07-24')).toBeNull()
  })
})

describe('firstPostOfVersion', () => {
  it('пропускает пустой сектор и берёт первый пост следующего', () => {
    const version = {
      id: 'v3',
      versionNumber: 3,
      effectiveFrom: '2026-01-01',
      sectors: [
        { id: 'sector-empty', name: 'Пустой', posts: [] },
        { id: 'sector-b', name: 'Сектор B', posts: [{ id: 'post-5', name: 'Пост 5' }] },
      ],
    }
    expect(firstPostOfVersion(version)).toEqual({
      sector: version.sectors[1],
      post: version.sectors[1].posts[0],
    })
  })

  it('null, когда постов нет ни в одном секторе', () => {
    expect(
      firstPostOfVersion({ id: 'v4', versionNumber: 4, effectiveFrom: '2026-01-01', sectors: [] }),
    ).toBeNull()
  })
})

describe('bindDutyPost', () => {
  it('снимает objectId/versionId/sectorId/postId — минимум §9.6', () => {
    const version = OBJECT.passportVersions[0]
    expect(bindDutyPost(OBJECT, version, 'sector-a', 'post-1', '2026-07-24T08:00:00+05:00')).toEqual(
      {
        objectId: 'object-1',
        objectName: 'Дворец Независимости',
        versionId: 'v1',
        versionNumber: 1,
        effectiveFrom: '2026-01-01',
        sectorId: 'sector-a',
        sectorName: 'Сектор A',
        postId: 'post-1',
        postName: 'КПП-1',
        boundAt: '2026-07-24T08:00:00+05:00',
      },
    )
  })

  it('null, когда пост в ЭТОЙ версии отсутствует — «какой-нибудь» пост не подставляется', () => {
    // post-1 есть только в v1; в v2 его нет.
    expect(
      bindDutyPost(OBJECT, OBJECT.passportVersions[1], 'sector-a', 'post-1', 'now'),
    ).toBeNull()
  })

  it('null, когда сектора нет в версии', () => {
    expect(bindDutyPost(OBJECT, OBJECT.passportVersions[0], 'sector-x', 'post-1', 'now')).toBeNull()
  })
})

describe('isBindingStale', () => {
  const binding = bindDutyPost(OBJECT, OBJECT.passportVersions[0], 'sector-a', 'post-1', 'now')!

  it('устарела, когда действует версия НОВЕЕ привязанной', () => {
    expect(isBindingStale(binding, OBJECT.passportVersions[1])).toBe(true)
  })

  it('не устарела, когда действует ровно привязанная версия', () => {
    expect(isBindingStale(binding, OBJECT.passportVersions[0])).toBe(false)
  })

  it('не устарела, когда действующей версии на дату нет вовсе', () => {
    expect(isBindingStale(binding, null)).toBe(false)
  })
})
