// Чистая модель «Архива дела» — env node (ни React, ни DOM).
import { describe, expect, it } from 'vitest'
import type { SecurityEvent } from '../model/types'
import {
  ORPHAN_POST_TEXT,
  buildArchiveCase,
  buildPostGroups,
  isArchiveOpen,
} from './archiveCase'

function makeEvent(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: 'se-1',
    code: 'ОМ-2026-001',
    title: 'Форум',
    objectId: null,
    objectName: 'Дворец',
    passportBinding: null,
    businessDate: '2026-07-22',
    stage: 'CLOSED',
    readinessPercent: 100,
    forceNeed: 6,
    conflictsCount: 0,
    ownerName: 'Ерланов Д.',
    briefDescription: 'Описание',
    initialTasks: 'Задачи',
    reconChecklist: [
      { id: 'c-1', label: 'Периметр', done: true, result: 'MATCHES', comment: '' },
      { id: 'c-2', label: 'Связь', done: false, result: null, comment: '' },
    ],
    reconSectorPosts: [
      {
        id: 'post-1',
        sector: 'A',
        post: 'Главный вход',
        task: 'Досмотр',
        need: 2,
        requirements: 'Досмотровая подготовка',
        result: 'MATCHES',
        comment: '',
        sourceSectorId: null,
        sourcePostId: null,
        minRating: null,
      },
    ],
    demandRows: [],
    demandApproved: true,
    forceRequests: [],
    placementAssignments: [],
    approvalStatus: 'APPROVED',
    approvalComment: '',
    journalEntries: [],
    closureDirectionSummaries: [{ direction: 'A', summary: 'Без происшествий' }],
    closedAt: '2026-07-22T23:40:00+05:00',
    createdAt: '2026-07-20T08:00:00+05:00',
    updatedAt: '2026-07-22T23:40:00+05:00',
    ...overrides,
  }
}

describe('isArchiveOpen', () => {
  it('дело открыто только у закрытого ОМ', () => {
    expect(isArchiveOpen(makeEvent({ stage: 'CLOSED' }))).toBe(true)
    expect(isArchiveOpen(makeEvent({ stage: 'CONDUCT' }))).toBe(false)
    expect(isArchiveOpen(makeEvent({ stage: 'BULLETIN' }))).toBe(false)
  })
})

describe('buildPostGroups', () => {
  it('пост без назначений остаётся в деле пустой группой', () => {
    const groups = buildPostGroups(makeEvent())
    expect(groups).toHaveLength(1)
    expect(groups[0].post).toBe('Главный вход')
    expect(groups[0].assignees).toEqual([])
    expect(groups[0].need).toBe(2)
  })

  it('несколько назначений на один пост собираются в одну группу с признаком ознакомления', () => {
    const groups = buildPostGroups(
      makeEvent({
        placementAssignments: [
          { id: 'a-1', postId: 'post-1', employeeId: 'e-1', employeeName: 'Иванов И.', acknowledgedAt: '2026-07-21T10:00:00+05:00', ratingOverrideReason: null },
          { id: 'a-2', postId: 'post-1', employeeId: 'e-2', employeeName: 'Петров П.', acknowledgedAt: null, ratingOverrideReason: null },
        ],
      }),
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].assignees.map((a) => [a.name, a.acknowledged])).toEqual([
      ['Иванов И.', true],
      ['Петров П.', false],
    ])
  })

  it('назначение на исчезнувший пост не теряется — отдельная группа в хвосте', () => {
    const groups = buildPostGroups(
      makeEvent({
        placementAssignments: [
          { id: 'a-9', postId: 'post-удалён', employeeId: 'e-9', employeeName: 'Сидоров С.', acknowledgedAt: null, ratingOverrideReason: null },
        ],
      }),
    )
    expect(groups).toHaveLength(2)
    const orphan = groups[groups.length - 1]
    expect(orphan.isOrphan).toBe(true)
    expect(orphan.sector).toBe(ORPHAN_POST_TEXT)
    // Потребность осиротевшей группы не выдумывается.
    expect(orphan.need).toBeNull()
    expect(orphan.assignees.map((a) => a.name)).toEqual(['Сидоров С.'])
  })
})

describe('buildArchiveCase — журнал', () => {
  const journalEntries = [
    { id: 'j-1', type: 'INSTRUCTION' as const, title: 'Инструктаж', description: '', createdAt: '2026-07-22T08:00:00+05:00' },
    { id: 'j-2', type: 'REPLACEMENT' as const, title: 'Замена', description: '', createdAt: '2026-07-22T12:00:00+05:00' },
    { id: 'j-3', type: 'INCIDENT' as const, title: 'Инцидент', description: '', createdAt: '2026-07-22T14:00:00+05:00' },
  ]

  it('замены отделены от журнала штаба, и каждая запись попадает ровно в один список', () => {
    const archive = buildArchiveCase(makeEvent({ journalEntries }))
    expect(archive.replacements.map((e) => e.id)).toEqual(['j-2'])
    expect(archive.journal.map((e) => e.id)).toEqual(['j-1', 'j-3'])
    const seen = [...archive.replacements, ...archive.journal].map((e) => e.id).sort()
    expect(seen).toEqual(['j-1', 'j-2', 'j-3'])
  })
})

describe('buildArchiveCase — итоги закрытия', () => {
  it('направление расчёта без итога закрытия названо явно', () => {
    const archive = buildArchiveCase(
      makeEvent({
        reconSectorPosts: [
          { id: 'p-1', sector: 'A', post: 'Вход', task: '', need: 1, requirements: '', result: null, comment: '', sourceSectorId: null, sourcePostId: null, minRating: null },
          { id: 'p-2', sector: 'B', post: 'Пресс-зона', task: '', need: 1, requirements: '', result: null, comment: '', sourceSectorId: null, sourcePostId: null, minRating: null },
        ],
        closureDirectionSummaries: [{ direction: 'A', summary: 'Без происшествий' }],
      }),
    )
    expect(archive.missingClosureDirections).toEqual(['B'])
    const closure = archive.sections.find((s) => s.key === 'closure')
    expect(closure?.note).toContain('B')
  })

  it('когда итоги есть по всем направлениям — расхождений нет', () => {
    const archive = buildArchiveCase(makeEvent())
    expect(archive.missingClosureDirections).toEqual([])
  })

  it('пустой сектор не считается направлением без итога', () => {
    const archive = buildArchiveCase(
      makeEvent({
        reconSectorPosts: [
          { id: 'p-1', sector: '  ', post: 'Вход', task: '', need: 1, requirements: '', result: null, comment: '', sourceSectorId: null, sourcePostId: null, minRating: null },
        ],
        closureDirectionSummaries: [],
      }),
    )
    expect(archive.missingClosureDirections).toEqual([])
  })
})

describe('buildArchiveCase — карточки разделов', () => {
  it('оценки участников не получают числа вовсе (§35: «0 оценок» — ложь)', () => {
    const ratings = buildArchiveCase(makeEvent()).sections.find(
      (s) => s.key === 'ratings',
    )
    expect(ratings?.count).toBeNull()
    expect(ratings?.note).toContain('не реализованы')
  })

  it('пустые разделы объясняют причину, а не показывают голый ноль', () => {
    const archive = buildArchiveCase(
      makeEvent({
        reconSectorPosts: [],
        reconChecklist: [],
        demandRows: [],
        placementAssignments: [],
        journalEntries: [],
        briefDescription: '',
        initialTasks: '',
      }),
    )
    const notes = Object.fromEntries(
      archive.sections.map((s) => [s.key, { count: s.count, note: s.note }]),
    )
    expect(notes.recon).toEqual({ count: 0, note: 'Посты и секторы не рассчитывались' })
    expect(notes.demand).toEqual({ count: 0, note: 'Потребность не рассчитывалась' })
    expect(notes.placement).toEqual({ count: 0, note: 'Назначений не было' })
    expect(notes.replacements).toEqual({ count: 0, note: 'Замен состава не было' })
    expect(notes.journal).toEqual({ count: 0, note: 'Записей журнала не было' })
    expect(notes.bulletin.note).toBe('Бюллетень не заполнялся до закрытия')
  })

  it('счётчик расстановки считает назначения, включая осиротевшие', () => {
    const archive = buildArchiveCase(
      makeEvent({
        placementAssignments: [
          { id: 'a-1', postId: 'post-1', employeeId: 'e-1', employeeName: 'Иванов И.', acknowledgedAt: null, ratingOverrideReason: null },
          { id: 'a-2', postId: 'нет-такого', employeeId: 'e-2', employeeName: 'Петров П.', acknowledgedAt: null, ratingOverrideReason: null },
        ],
      }),
    )
    const placement = archive.sections.find((s) => s.key === 'placement')
    expect(placement?.count).toBe(2)
    // Потребность и назначено — два независимых числа, не «X из Y».
    expect(placement?.note).toBe('Потребность 2, назначено 2')
  })

  it('чек-лист рекогносцировки считает только отмеченные пункты', () => {
    const recon = buildArchiveCase(makeEvent()).sections.find((s) => s.key === 'recon')
    expect(recon?.note).toBe('Чек-лист 1 из 2, постов 1')
  })
})
