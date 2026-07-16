// Story 10.4 — чистые функции светофор-дерева (Task 6): сборка леса из
// плоского parent_id-списка (Д1), фильтр «только отстающие» (AC-10),
// маппинг статус→текст (AC-8, 5 значений + defensive unknown), константа
// polling-интервала (Д4 — одно место).
import { describe, expect, it } from 'vitest'

import {
  buildForest,
  laggardsOnly,
  REFRESH_INTERVAL_MS,
  statusMeta,
} from './trafficTree'
import type { TrafficTreeNode } from './trafficTree'

function node(
  id: string,
  parentId: string | null,
  status: string,
  late = false,
): TrafficTreeNode {
  return {
    division_id: id,
    name: `Узел ${id}`,
    parent_id: parentId,
    status,
    late,
  }
}

describe('buildForest', () => {
  it('корни = parent_id null, дети под родителем в порядке ответа', () => {
    const nodes = [
      node('a', null, 'RED'),
      node('a1', 'a', 'GREEN'),
      node('a2', 'a', 'YELLOW'),
      node('a1x', 'a1', 'RED'),
      node('b', null, 'NEUTRAL'),
    ]
    const forest = buildForest(nodes)
    expect(forest.map((t) => t.node.division_id)).toEqual(['a', 'b'])
    const a = forest[0]
    expect(a.children.map((t) => t.node.division_id)).toEqual(['a1', 'a2'])
    expect(a.children[0].children.map((t) => t.node.division_id)).toEqual([
      'a1x',
    ])
    expect(forest[1].children).toEqual([])
  })

  it('defensive: сирота (parent_id вне ответа) поднимается в корни, не теряется', () => {
    const forest = buildForest([
      node('a', null, 'GREEN'),
      node('orphan', 'missing', 'RED'),
    ])
    expect(forest.map((t) => t.node.division_id)).toEqual(['a', 'orphan'])
  })

  it('пустой список → пустой лес', () => {
    expect(buildForest([])).toEqual([])
  })
})

describe('laggardsOnly', () => {
  it('GREEN/NEUTRAL скрыты, RED/YELLOW/UNKNOWN остаются (каскадный статус)', () => {
    const forest = buildForest([
      node('red', null, 'RED'),
      node('red-green', 'red', 'GREEN'),
      node('red-yellow', 'red', 'YELLOW'),
      node('red-unknown', 'red', 'UNKNOWN'),
      node('green', null, 'GREEN'),
      node('neutral', null, 'NEUTRAL'),
    ])
    const filtered = laggardsOnly(forest)
    expect(filtered.map((t) => t.node.division_id)).toEqual(['red'])
    expect(filtered[0].children.map((t) => t.node.division_id)).toEqual([
      'red-yellow',
      'red-unknown',
    ])
  })

  it('полностью зелёный лес → пусто', () => {
    const forest = buildForest([node('a', null, 'GREEN')])
    expect(laggardsOnly(forest)).toEqual([])
  })

  it('defensive: неизвестная строка статуса НЕ скрывается («не знаю» честнее)', () => {
    const forest = buildForest([node('weird', null, 'PURPLE')])
    expect(laggardsOnly(forest)).toHaveLength(1)
  })
})

describe('statusMeta', () => {
  it.each([
    ['GREEN', 'сдано и сходится', false],
    ['YELLOW', 'расход разошёлся', true],
    ['RED', 'не сдано', true],
    ['NEUTRAL', 'нет данных', false],
    ['UNKNOWN', 'неопределён', true],
  ])('%s → «%s», laggard=%s', (status, label, laggard) => {
    const meta = statusMeta(status)
    expect(meta.label).toBe(label)
    expect(meta.laggard).toBe(laggard)
  })

  it('defensive: неизвестный статус → «неопределён», laggard', () => {
    const meta = statusMeta('PURPLE')
    expect(meta.label).toBe('неопределён')
    expect(meta.laggard).toBe(true)
  })
})

describe('REFRESH_INTERVAL_MS', () => {
  it('интервал опроса — 60 секунд (Д4, константа в одном месте)', () => {
    expect(REFRESH_INTERVAL_MS).toBe(60_000)
  })
})
