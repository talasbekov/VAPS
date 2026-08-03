// Story 10.4 — чистая модель дерева светофора (env node: ни React, ни сети).
//
// Мишень сюиты — ровно те инварианты, которые бэк уже держит своими тестами, а
// клиент обязан продублировать, потому что он рендерит НЕ то, что бэк считает,
// а то, что доехало по проводу:
//   - разбор мусора не роняет экран (AC-9);
//   - сирота становится корнем, цикл A→B→A не вешает вкладку (AC-9,
//     паритет с `traffic_light.py:321,326`);
//   - precedence свёртки — дословное зеркало `_PRECEDENCE`/`_worst`
//     (`traffic_light.py:181-214`), включая ПУСТОЙ вход → NEUTRAL;
//   - фильтр показывает ветку к отстающему, а не только прячет зелёное (AC-6).
//
// Фикстуры кириллические намеренно: кириллица кусала дважды за E9.
import { describe, expect, it } from 'vitest'

import {
  buildTree,
  filterLagging,
  isLagging,
  laggingAncestors,
  parseTrafficLightTree,
  STATUS_LABEL,
  TRAFFIC_LIGHT_STATUSES,
  visibleNodeCount,
  worstStatus,
} from './trafficLight'
import type { TrafficLightNode, TrafficLightStatus } from './trafficLight'

const ROOT = '11111111-1111-4111-8111-111111111111'
const CHILD = '22222222-2222-4222-8222-222222222222'
const GRAND = '33333333-3333-4333-8333-333333333333'
const GREAT = '44444444-4444-4444-8444-444444444444'

function node(over: Partial<TrafficLightNode> & { division_id: string }): TrafficLightNode {
  return {
    name: 'Подразделение',
    parent_id: null,
    status: 'GREEN',
    late: false,
    ...over,
  }
}

describe('parseTrafficLightTree — тотальный защитный разбор (AC-9)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['строка', 'мусор'],
    ['число', 42],
    ['пустой объект', {}],
    ['nodes не массив', { nodes: 'x' }],
    ['nodes null', { nodes: null }],
    ['голый массив (конверта нет)', [{ division_id: ROOT }]],
  ])('%s → пустой список, без throw', (_label, raw) => {
    expect(parseTrafficLightTree(raw)).toEqual([])
  })

  it('узел без валидного division_id отбрасывается, соседи выживают', () => {
    const parsed = parseTrafficLightTree({
      business_date: '2026-07-19',
      nodes: [
        { division_id: '', name: 'Пустой id', parent_id: null, status: 'RED', late: false },
        { division_id: 42, name: 'Не строка', parent_id: null, status: 'RED', late: false },
        { name: 'Без поля вовсе', parent_id: null, status: 'RED', late: false },
        null,
        'мусор',
        { division_id: ROOT, name: 'Штаб', parent_id: null, status: 'RED', late: false },
      ],
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].division_id).toBe(ROOT)
    expect(parsed[0].name).toBe('Штаб')
  })

  it('неизвестная строка status → UNKNOWN, а НЕ throw и НЕ «GREEN по умолчанию»', () => {
    const parsed = parseTrafficLightTree({
      nodes: [
        { division_id: ROOT, name: 'Штаб', parent_id: null, status: 'ЗЕЛЁНЫЙ', late: false },
        { division_id: CHILD, name: 'Рота', parent_id: ROOT, status: null, late: false },
        { division_id: GRAND, name: 'Взвод', parent_id: ROOT, late: false },
      ],
    })

    expect(parsed.map((n) => n.status)).toEqual(['UNKNOWN', 'UNKNOWN', 'UNKNOWN'])
    // Именно UNKNOWN, а не GREEN: «не знаю» честнее, чем «всё ок»
    // (traffic_light.py:_worst — UNKNOWN на вершине precedence).
    expect(parsed.every((n) => n.status !== 'GREEN')).toBe(true)
  })

  it('отсутствующий/нестрогий late → false; не-строковое имя → пустая строка', () => {
    const parsed = parseTrafficLightTree({
      nodes: [
        { division_id: ROOT, name: 'Штаб', parent_id: null, status: 'RED' },
        { division_id: CHILD, name: 42, parent_id: null, status: 'RED', late: 'да' },
        { division_id: GRAND, name: 'Взвод', parent_id: null, status: 'RED', late: true },
      ],
    })

    expect(parsed[0].late).toBe(false)
    expect(parsed[1].late).toBe(false)
    expect(parsed[1].name).toBe('')
    expect(parsed[2].late).toBe(true)
  })

  it('parent_id не-строка → null (узел станет корнем, а не потеряется)', () => {
    const parsed = parseTrafficLightTree({
      nodes: [{ division_id: ROOT, name: 'Штаб', parent_id: 7, status: 'GREEN', late: false }],
    })

    expect(parsed[0].parent_id).toBeNull()
  })

  it('все пять статусов схемы проходят разбор дословно', () => {
    const parsed = parseTrafficLightTree({
      nodes: TRAFFIC_LIGHT_STATUSES.map((status, i) => ({
        division_id: `0000000${i}-0000-4000-8000-000000000000`,
        name: `Узел ${status}`,
        parent_id: null,
        status,
        late: false,
      })),
    })

    expect(parsed.map((n) => n.status)).toEqual([...TRAFFIC_LIGHT_STATUSES])
  })
})

describe('buildTree — иерархия из плоского списка (AC-9)', () => {
  it('строит дерево по parent_id', () => {
    const tree = buildTree([
      node({ division_id: ROOT, name: 'Штаб' }),
      node({ division_id: CHILD, name: 'Рота', parent_id: ROOT }),
      node({ division_id: GRAND, name: 'Взвод', parent_id: CHILD }),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0].division_id).toBe(ROOT)
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children[0].division_id).toBe(CHILD)
    expect(tree[0].children[0].children[0].division_id).toBe(GRAND)
    expect(tree[0].children[0].children[0].children).toEqual([])
  })

  it('сирота (родителя нет в ответе) становится корнем, а не пропадает', () => {
    const tree = buildTree([
      node({ division_id: ROOT, name: 'Штаб' }),
      node({ division_id: CHILD, name: 'Рота-сирота', parent_id: 'нет-такого-id' }),
    ])

    expect(tree.map((n) => n.division_id).sort()).toEqual([ROOT, CHILD].sort())
    // RBAC-сужение делает это штатным случаем: видимый корень может иметь
    // непустой parent вне скоупа актора.
  })

  it('цикл A→B→A обрывается: ни зависания, ни бесконечной рекурсии', () => {
    const tree = buildTree([
      node({ division_id: ROOT, name: 'А', parent_id: CHILD }),
      node({ division_id: CHILD, name: 'Б', parent_id: ROOT }),
    ])

    // Оба узла присутствуют ровно по разу — цикл не размножил их и не съел.
    const seen: string[] = []
    const walk = (nodes: typeof tree, depth: number): void => {
      expect(depth).toBeLessThan(10) // страховка от «тест зависает вместо падения»
      for (const n of nodes) {
        seen.push(n.division_id)
        walk(n.children, depth + 1)
      }
    }
    walk(tree, 0)

    expect(seen).toHaveLength(2)
    expect([...seen].sort()).toEqual([ROOT, CHILD].sort())
  })

  it('самоссылка A→A не вешает обход', () => {
    const tree = buildTree([node({ division_id: ROOT, name: 'Сам себе родитель', parent_id: ROOT })])

    expect(tree).toHaveLength(1)
    expect(tree[0].children).toEqual([])
  })

  it('дубль division_id не удваивает узел', () => {
    const tree = buildTree([
      node({ division_id: ROOT, name: 'Штаб' }),
      node({ division_id: ROOT, name: 'Штаб-дубль' }),
    ])

    expect(tree).toHaveLength(1)
  })

  it('пустой вход → пустое дерево', () => {
    expect(buildTree([])).toEqual([])
  })
})

describe('worstStatus — зеркало _PRECEDENCE/_worst (traffic_light.py:181-214)', () => {
  // NEUTRAL(0) < GREEN(1) < YELLOW(2) < RED(3) < UNKNOWN(4)
  it.each<[TrafficLightStatus, TrafficLightStatus, TrafficLightStatus]>([
    ['NEUTRAL', 'GREEN', 'GREEN'],
    ['NEUTRAL', 'YELLOW', 'YELLOW'],
    ['NEUTRAL', 'RED', 'RED'],
    ['NEUTRAL', 'UNKNOWN', 'UNKNOWN'],
    ['GREEN', 'YELLOW', 'YELLOW'],
    ['GREEN', 'RED', 'RED'],
    ['GREEN', 'UNKNOWN', 'UNKNOWN'],
    ['YELLOW', 'RED', 'RED'],
    ['YELLOW', 'UNKNOWN', 'UNKNOWN'],
    ['RED', 'UNKNOWN', 'UNKNOWN'],
  ])('%s + %s → %s (и в обратном порядке)', (a, b, expected) => {
    expect(worstStatus(a, b)).toBe(expected)
    expect(worstStatus(b, a)).toBe(expected)
  })

  it.each(TRAFFIC_LIGHT_STATUSES)('%s сам с собой → он же (идемпотентность)', (status) => {
    expect(worstStatus(status, status)).toBe(status)
  })

  it('ПУСТОЙ вход → NEUTRAL, а не undefined (бэк: max(..., default=NEUTRAL))', () => {
    // Без этого пункта worstStatus() вернул бы undefined и МОЛЧА прошёл бы все
    // тесты выше — они пустой вход не задевают.
    expect(worstStatus()).toBe('NEUTRAL')
  })

  it('NEUTRAL нейтрален: только NEUTRAL → NEUTRAL', () => {
    expect(worstStatus('NEUTRAL', 'NEUTRAL', 'NEUTRAL')).toBe('NEUTRAL')
  })

  it('UNKNOWN на вершине: не маскируется ни красным, ни зелёным', () => {
    expect(worstStatus('GREEN', 'RED', 'UNKNOWN', 'NEUTRAL', 'YELLOW')).toBe('UNKNOWN')
  })
})

describe('isLagging / STATUS_LABEL', () => {
  it('отстающие — ровно RED, YELLOW, UNKNOWN', () => {
    expect(isLagging('RED')).toBe(true)
    expect(isLagging('YELLOW')).toBe(true)
    expect(isLagging('UNKNOWN')).toBe(true)
    expect(isLagging('GREEN')).toBe(false)
    // NEUTRAL — «нечего сдавать», не отставание: попади он в отстающие,
    // фильтр показывал бы пустые подразделения как проблему.
    expect(isLagging('NEUTRAL')).toBe(false)
  })

  it('у каждого из пяти статусов есть непустая текст-метка (AC-3)', () => {
    for (const status of TRAFFIC_LIGHT_STATUSES) {
      expect(STATUS_LABEL[status]).toBeTruthy()
    }
    expect(new Set(Object.values(STATUS_LABEL)).size).toBe(TRAFFIC_LIGHT_STATUSES.length)
  })
})

describe('filterLagging — фильтр «только отстающие» (AC-6)', () => {
  const tree = buildTree([
    node({ division_id: ROOT, name: 'Штаб', status: 'RED' }),
    node({ division_id: CHILD, name: 'Первая рота', parent_id: ROOT, status: 'GREEN' }),
    node({ division_id: GRAND, name: 'Вторая рота', parent_id: ROOT, status: 'RED' }),
    node({ division_id: GREAT, name: 'Взвод связи', parent_id: GRAND, status: 'RED' }),
  ])

  it('зелёное поддерево скрыто целиком', () => {
    const filtered = filterLagging(tree)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].children.map((n) => n.division_id)).toEqual([GRAND])
    expect(filtered[0].children.map((n) => n.name)).not.toContain('Первая рота')
  })

  it('ветка к красному листу сохранена вместе с предками', () => {
    const filtered = filterLagging(tree)

    expect(filtered[0].children[0].children.map((n) => n.division_id)).toEqual([GREAT])
  })

  it('NEUTRAL-узел отстающим НЕ считается и скрывается', () => {
    const withNeutral = buildTree([
      node({ division_id: ROOT, name: 'Штаб', status: 'RED' }),
      node({ division_id: CHILD, name: 'Резерв', parent_id: ROOT, status: 'NEUTRAL' }),
    ])

    expect(filterLagging(withNeutral)[0].children).toEqual([])
  })

  it('зелёный предок с красным потомком остаётся видимым (фильтр ПОКАЗЫВАЕТ, не только прячет)', () => {
    // Каскад такого не эмитит, но клиент обязан пережить рассинхрон, а не
    // потерять красный лист под «неотстающим» предком.
    const inconsistent = buildTree([
      node({ division_id: ROOT, name: 'Штаб', status: 'GREEN' }),
      node({ division_id: CHILD, name: 'Рота', parent_id: ROOT, status: 'RED' }),
    ])
    const filtered = filterLagging(inconsistent)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].children.map((n) => n.division_id)).toEqual([CHILD])
  })

  it('отстающих нет → пустой результат (экран покажет пустое состояние)', () => {
    const allGreen = buildTree([
      node({ division_id: ROOT, name: 'Штаб', status: 'GREEN' }),
      node({ division_id: CHILD, name: 'Рота', parent_id: ROOT, status: 'GREEN' }),
    ])

    expect(filterLagging(allGreen)).toEqual([])
  })
})

describe('laggingAncestors — авто-раскрытие до отстающего (AC-6)', () => {
  it('красный лист на глубине 3 даёт всех трёх предков', () => {
    const tree = buildTree([
      node({ division_id: ROOT, name: 'Штаб', status: 'GREEN' }),
      node({ division_id: CHILD, name: 'Рота', parent_id: ROOT, status: 'GREEN' }),
      node({ division_id: GRAND, name: 'Взвод', parent_id: CHILD, status: 'GREEN' }),
      node({ division_id: GREAT, name: 'Отделение', parent_id: GRAND, status: 'RED' }),
    ])

    const ancestors = laggingAncestors(tree)

    expect(ancestors.has(ROOT)).toBe(true)
    expect(ancestors.has(CHILD)).toBe(true)
    expect(ancestors.has(GRAND)).toBe(true)
    // Сам отстающий лист раскрывать нечего — детей у него нет.
    expect(ancestors.has(GREAT)).toBe(false)
  })

  it('отстающих нет → пустое множество', () => {
    const tree = buildTree([
      node({ division_id: ROOT, name: 'Штаб', status: 'GREEN' }),
      node({ division_id: CHILD, name: 'Рота', parent_id: ROOT, status: 'GREEN' }),
    ])

    expect(laggingAncestors(tree).size).toBe(0)
  })

  it('зелёная ветка-соседка в множество не попадает', () => {
    const tree = buildTree([
      node({ division_id: ROOT, name: 'Штаб', status: 'RED' }),
      node({ division_id: CHILD, name: 'Зелёная рота', parent_id: ROOT, status: 'GREEN' }),
      node({ division_id: GRAND, name: 'Красная рота', parent_id: ROOT, status: 'RED' }),
      node({ division_id: GREAT, name: 'Взвод', parent_id: GRAND, status: 'RED' }),
    ])

    const ancestors = laggingAncestors(tree)

    expect(ancestors.has(ROOT)).toBe(true)
    expect(ancestors.has(GRAND)).toBe(true)
    expect(ancestors.has(CHILD)).toBe(false)
  })
})

describe('visibleNodeCount — детерминированный счётчик для перф-бюджета (AC-4)', () => {
  const tree = buildTree([
    node({ division_id: ROOT, name: 'Штаб' }),
    node({ division_id: CHILD, name: 'Рота', parent_id: ROOT }),
    node({ division_id: GRAND, name: 'Взвод', parent_id: CHILD }),
  ])

  it('ничего не раскрыто → видны только корни', () => {
    expect(visibleNodeCount(tree, new Set())).toBe(1)
  })

  it('раскрыт корень → корень + его дети', () => {
    expect(visibleNodeCount(tree, new Set([ROOT]))).toBe(2)
  })

  it('раскрыта вся цепочка → все узлы', () => {
    expect(visibleNodeCount(tree, new Set([ROOT, CHILD]))).toBe(3)
  })

  it('раскрытие узла под свёрнутым предком не добавляет видимых', () => {
    expect(visibleNodeCount(tree, new Set([CHILD, GRAND]))).toBe(1)
  })
})
