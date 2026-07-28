// Уровни иерархии ОМ (§22.15) и распределение по lifecycle (§22.13).
import { describe, expect, it } from 'vitest'
import {
  OPS_COLUMNS,
  UNBOUND_OBJECT_ID,
  buildEventCard,
  columnsFor,
  directionId,
  directionRows,
  lifecycleDistribution,
  objectRows,
  postRows,
} from './operations'
import type { OpsSourceEvent, OpsSourcePost } from './operations'
import { OPS_LIFECYCLE_REGISTRY } from '../mocks/fixtures'

function post(overrides: Partial<OpsSourcePost> = {}): OpsSourcePost {
  return {
    postId: 'post-1',
    sectorLabel: 'A',
    sourceSectorId: null,
    postLabel: 'Главный вход',
    need: 4,
    assigned: 2,
    acknowledged: 1,
    ...overrides,
  }
}

function event(overrides: Partial<OpsSourceEvent> = {}): OpsSourceEvent {
  return {
    id: 'event-1',
    code: 'ОМ-001',
    title: 'Форум',
    objectId: 'object-1',
    objectName: 'Дворец Независимости',
    businessDate: '2026-07-22',
    stageCode: 'PLACEMENT',
    readinessPercent: 82,
    conflictsCount: 2,
    demandApproved: true,
    demandNeedTotal: 10,
    requestedTotal: 8,
    allocatedTotal: 6,
    incidentsCount: 1,
    closedAt: null,
    posts: [post()],
    ...overrides,
  }
}

function cellValue(row: { cells: { code: string; value: number | null }[] }, code: string) {
  return row.cells.find((cell) => cell.code === code)?.value
}

describe('колонки уровня (§22.15)', () => {
  it('«запрошено», «выделено» и «назначено» — РАЗНЫЕ колонки и нигде не складываются', () => {
    const codes = columnsFor('ALL').map((column) => column.code)
    expect(codes).toContain(OPS_COLUMNS.requested.code)
    expect(codes).toContain(OPS_COLUMNS.allocated.code)
    expect(codes).toContain(OPS_COLUMNS.assigned.code)

    const row = objectRows([event()])[0]
    // Три разных числа остаются тремя: 8 запрошено, 6 выделено, 2 назначено.
    expect(cellValue(row, OPS_COLUMNS.requested.code)).toBe(8)
    expect(cellValue(row, OPS_COLUMNS.allocated.code)).toBe(6)
    expect(cellValue(row, OPS_COLUMNS.assigned.code)).toBe(2)
  })

  it('на уровне поста колонки «запрошено»/«выделено» не появляются вовсе', () => {
    // Пустая колонка читалась бы как ноль запрошенных на пост, а запрос сил
    // ведётся по группам мероприятия, а не по постам.
    const codes = columnsFor('POST').map((column) => column.code)
    expect(codes).not.toContain(OPS_COLUMNS.requested.code)
    expect(codes).not.toContain(OPS_COLUMNS.allocated.code)
  })
})

describe('группировка по объекту (§22.15 «связывай по стабильным ID»)', () => {
  it('ОМ без объекта в реестре лежат в СВОЕЙ корзине, а не склеиваются по названию', () => {
    const rows = objectRows([
      event({ id: 'e1', objectId: null, objectName: 'Резиденция' }),
      event({ id: 'e2', objectId: null, objectName: 'Резиденция' }),
      event({ id: 'e3', objectId: 'object-1', objectName: 'Дворец Независимости' }),
    ])

    const unbound = rows.find((row) => row.rowId === UNBOUND_OBJECT_ID)
    expect(unbound?.safeLabel).toContain('вне реестра')
    expect(cellValue(unbound!, OPS_COLUMNS.events.code)).toBe(2)
    // Название «Резиденция» в подписи корзины НЕ появляется: два ОМ с
    // одинаковым именем объекта не объявлены одним объектом.
    expect(unbound?.safeLabel).not.toContain('Резиденция')
  })

  it('только УТВЕРЖДЁННАЯ потребность попадает в измерение', () => {
    const rows = objectRows([
      event({ id: 'e1', demandApproved: true, demandNeedTotal: 10 }),
      event({ id: 'e2', demandApproved: false, demandNeedTotal: 99 }),
    ])
    // 99 — черновик, а не обязательство.
    expect(cellValue(rows[0], OPS_COLUMNS.demandNeed.code)).toBe(10)
  })
})

describe('направления (§22.15)', () => {
  it('одинаково названный сектор в РАЗНЫХ ОМ — два разных направления', () => {
    const first = directionId('event-1', post({ sectorLabel: 'A' }))
    const second = directionId('event-2', post({ sectorLabel: 'A' }))
    expect(first).not.toBe(second)
  })

  it('строка из паспорта и ручная строка одного сектора не сливаются', () => {
    const rows = directionRows(
      event({
        posts: [
          post({ postId: 'p1', sectorLabel: 'A', sourceSectorId: 'sector-77' }),
          post({ postId: 'p2', sectorLabel: 'A', sourceSectorId: null }),
        ],
      }),
    )
    expect(rows).toHaveLength(2)
    // Ручное направление НЕ выдаёт себя за сектор паспорта.
    expect(rows.some((row) => row.safeLabel.includes('без связи с паспортом'))).toBe(true)
  })

  it('посты фильтруются по идентификатору направления, а не по имени сектора', () => {
    const source = event({
      posts: [
        post({ postId: 'p1', sectorLabel: 'A', sourceSectorId: 'sector-77' }),
        post({ postId: 'p2', sectorLabel: 'A', sourceSectorId: null }),
      ],
    })
    const rows = postRows(source, directionId(source.id, source.posts[0]))
    expect(rows.map((row) => row.rowId)).toEqual(['p1'])
  })
})

describe('распределение по lifecycle (§22.13)', () => {
  it('корзины берутся из реестра, а незнакомый код называется отдельно', () => {
    const { buckets, unknownCodes } = lifecycleDistribution(
      [event({ id: 'e1', stageCode: 'PLACEMENT' }), event({ id: 'e2', stageCode: 'ВЫДУМАННАЯ' })],
      OPS_LIFECYCLE_REGISTRY,
    )

    expect(buckets).toHaveLength(OPS_LIFECYCLE_REGISTRY.length)
    expect(buckets.find((bucket) => bucket.stateCode === 'PLACEMENT')?.count).toBe(1)
    // Незнакомый код не растворился ни в одной корзине — сумма корзин меньше
    // числа мероприятий, и расхождение названо вслух.
    expect(buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(1)
    expect(unknownCodes).toEqual(['ВЫДУМАННАЯ'])
  })
})

describe('карточка ОМ (§22.15)', () => {
  it('невыводимые поля приходят с причиной, а не нулём', () => {
    const card = buildEventCard(event(), OPS_LIFECYCLE_REGISTRY)
    const byCode = new Map(card.facts.map((fact) => [fact.code, fact]))

    for (const code of ['REVISION', 'ACTUAL', 'CLOSURE_READY']) {
      expect(byCode.get(code)?.unavailableReason).not.toBeNull()
    }
    // «Фактически участвовало» не приравнено к назначенным.
    expect(byCode.get('ACTUAL')?.displayValue).toBe('нет данных')
    expect(byCode.get('ASSIGNED')?.displayValue).toBe('2')
  })

  it('состояние вне реестра названо кодом, а не подставлено соседним', () => {
    const card = buildEventCard(event({ stageCode: 'ВЫДУМАННАЯ' }), OPS_LIFECYCLE_REGISTRY)
    const lifecycle = card.facts.find((fact) => fact.code === 'LIFECYCLE')
    expect(lifecycle?.displayValue).toContain('ВЫДУМАННАЯ')
    expect(lifecycle?.displayValue).toContain('Lifecycle Registry')
  })
})
