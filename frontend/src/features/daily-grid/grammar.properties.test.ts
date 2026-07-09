// Story 9.3 — property-based свойства грамматики (fast-check) поверх
// НЕИЗМЕННОГО transition (9.2). Три инварианта §3.3 контракта 9.1 на
// произвольных последовательностях клавиш. Чистая функция → node-env, быстро.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { transition } from './grammar'
import {
  CELL_STATES,
  KEY_TYPES,
  type Action,
  type Bounds,
  type CellState,
  type ColumnKind,
  type Key,
} from './grammar.types'

// Фиксированный сид (воспроизводимость гейта — без флейка) + профили ci/full.
const SEED = 0x9a3
const NUM_RUNS = process.env.FC_PROFILE === 'full' ? 1000 : 100
const OPTS = { seed: SEED, numRuns: NUM_RUNS } as const

const ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'OPEN_EDIT',
  'OPEN_PERIOD',
  'TYPE_AHEAD',
  'LIST_MOVE',
  'COMMIT',
  'RESTORE_PRE_EDIT',
  'MOVE',
  'OVERRIDE_RETRY',
  'CLOSE_DIALOG',
  'NOOP',
])

const COLUMN_KINDS: readonly ColumnKind[] = [
  'readonly',
  'status',
  'period',
  'flag',
]
const NON_CHAR = KEY_TYPES.filter((t) => t !== 'Char')

const keyArb: fc.Arbitrary<Key> = fc.oneof(
  fc.constantFrom(...NON_CHAR).map((type) => ({ type }) as Key),
  fc
    .string({ minLength: 1, maxLength: 1 })
    .map((char) => ({ type: 'Char', char }) as Key),
)

const columnKindArb = fc.constantFrom(...COLUMN_KINDS)

const boundsArb: fc.Arbitrary<Bounds> = fc
  .integer({ min: 1, max: 8 })
  .chain((cols) =>
    fc.record({
      rows: fc.integer({ min: 1, max: 8 }),
      cols: fc.constant(cols),
      columnKinds: fc.array(columnKindArb, {
        minLength: cols,
        maxLength: cols,
      }),
    }),
  )

interface Start {
  bounds: Bounds
  state: CellState
  position: { row: number; col: number }
}

const startArb: fc.Arbitrary<Start> = boundsArb.chain((bounds) =>
  fc.record({
    bounds: fc.constant(bounds),
    state: fc.constantFrom(...CELL_STATES),
    position: fc.record({
      row: fc.integer({ min: 0, max: bounds.rows - 1 }),
      col: fc.integer({ min: 0, max: bounds.cols - 1 }),
    }),
  }),
)

describe('грамматика — property-based (§3.3)', () => {
  it('инв.1+2: на произвольной свёртке фокус в границах, нажатия не теряются, детерминизм', () => {
    fc.assert(
      fc.property(
        startArb,
        fc.array(keyArb, { maxLength: 50 }),
        (start, keys) => {
          let state = start.state
          let position = start.position
          const bounds = start.bounds
          for (const key of keys) {
            const input = { state, position, bounds, key }
            const r = transition(input)
            // инв.2 — нажатие не теряется: определённый, валидный, детерминированный
            expect(transition(input)).toEqual(r)
            expect(ACTIONS.has(r.action)).toBe(true)
            expect(CELL_STATES).toContain(r.nextState)
            // инв.1 — фокус в границах после каждого шага
            expect(r.nextPosition.row).toBeGreaterThanOrEqual(0)
            expect(r.nextPosition.row).toBeLessThan(bounds.rows)
            expect(r.nextPosition.col).toBeGreaterThanOrEqual(0)
            expect(r.nextPosition.col).toBeLessThan(bounds.cols)
            // позиция/состояние переносятся в следующий шаг (bounds постоянен)
            state = r.nextState
            position = r.nextPosition
          }
        },
      ),
      OPTS,
    )
  })

  it('инв.3: Esc в EDIT/PERIOD_EDIT → RESTORE_PRE_EDIT, NAVIGATE, та же позиция', () => {
    fc.assert(
      fc.property(
        startArb,
        fc.constantFrom('EDIT', 'PERIOD_EDIT'),
        (start, editState) => {
          const r = transition({
            state: editState as CellState,
            position: start.position,
            bounds: start.bounds,
            key: { type: 'Esc' },
          })
          expect(r.action).toBe('RESTORE_PRE_EDIT')
          expect(r.nextState).toBe('NAVIGATE')
          expect(r.nextPosition).toEqual(start.position)
        },
      ),
      OPTS,
    )
  })
})
