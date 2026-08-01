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

// Record<Action, true> — компайл-исчерпываемость (ревью 9.3): новый вариант
// Action не пройдёт мимо набора молча (Set<Action> принимал и подмножество).
const ACTION_FLAGS: Record<Action, true> = {
  OPEN_EDIT: true,
  OPEN_PERIOD: true,
  TYPE_AHEAD: true,
  LIST_MOVE: true,
  COMMIT: true,
  RESTORE_PRE_EDIT: true,
  MOVE: true,
  OVERRIDE_RETRY: true,
  CLOSE_DIALOG: true,
  NOOP: true,
}
const ACTIONS: ReadonlySet<Action> = new Set(
  Object.keys(ACTION_FLAGS) as Action[],
)

const COLUMN_KINDS: readonly ColumnKind[] = [
  'readonly',
  'status',
  'period',
  'flag',
]

// Все не-Char клавиши бес-payload — литералы под `satisfies` вместо `as Key`
// (ревью 9.3: cast пропустил бы будущий payload-несущий вариант молча);
// полнота против KEY_TYPES закреплена рантайм-тестом ниже.
const NON_CHAR_KEYS = [
  { type: 'Enter' },
  { type: 'Tab' },
  { type: 'ShiftTab' },
  { type: 'Esc' },
  { type: 'ArrowUp' },
  { type: 'ArrowDown' },
  { type: 'ArrowLeft' },
  { type: 'ArrowRight' },
] as const satisfies readonly Key[]

// Язык операторов — кириллица (type-ahead статусов): дефолтный ASCII-юнит
// fast-check её не генерирует вовсе (ревью 9.3) → явный пул + общий генератор.
const CHAR_POOL = 'абвгдежзиклмнопрстуфхцчшщъыьэюяё0123456789 -.abcxyz'
const charArb = fc.oneof(
  fc.constantFrom(...CHAR_POOL),
  fc.string({ minLength: 1, maxLength: 1 }),
)

const keyArb: fc.Arbitrary<Key> = fc.oneof(
  fc.constantFrom<Key>(...NON_CHAR_KEYS),
  charArb.map((char): Key => ({ type: 'Char', char })),
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
  it('генератор покрывает все типы клавиш (синк NON_CHAR_KEYS ↔ KEY_TYPES)', () => {
    expect(new Set([...NON_CHAR_KEYS.map((k) => k.type), 'Char'])).toEqual(
      new Set(KEY_TYPES),
    )
  })

  // Вход в CONFLICT задаёт грид по 409 (Д3-9.2), не грамматика → в свёртке
  // CONFLICT встречается только стартовым префиксом; полное покрытие
  // state×key×kind несёт exhaustive-таблица grammar.test.ts.
  it('инв.1+2: на произвольной свёртке фокус в границах, нажатия дают контрактный эффект, детерминизм, чистота', () => {
    fc.assert(
      fc.property(
        startArb,
        fc.array(keyArb, { minLength: 1, maxLength: 50 }),
        (start, keys) => {
          let state = start.state
          let position = start.position
          const bounds = start.bounds
          for (const key of keys) {
            const input = { state, position, bounds, key }
            const posSnap = { ...position }
            const r = transition(input)
            // детерминизм СТРОГО (toEqual не отличил бы seed:undefined от
            // отсутствия seed) + чистота: вход не мутирован (на неё опирается 9.4)
            expect(transition(input)).toStrictEqual(r)
            expect(position).toEqual(posSnap)
            expect(ACTIONS.has(r.action)).toBe(true)
            expect(CELL_STATES).toContain(r.nextState)
            // инв.1 — фокус в границах после каждого шага
            expect(r.nextPosition.row).toBeGreaterThanOrEqual(0)
            expect(r.nextPosition.row).toBeLessThan(bounds.rows)
            expect(r.nextPosition.col).toBeGreaterThanOrEqual(0)
            expect(r.nextPosition.col).toBeLessThan(bounds.cols)
            // инв.2 — «нажатия не теряются» ПО СУЩЕСТВУ (ревью 9.3: слабая
            // форма «результат валиден» пропускала вечно-NOOP заглушку):
            // эффект-классы контракта §3.2 без дублирования всей таблицы.
            const kind = bounds.columnKinds[position.col] ?? 'readonly'
            if (state === 'NAVIGATE') {
              if (key.type === 'ArrowDown' || key.type === 'ArrowUp') {
                expect(r.action).toBe('MOVE')
                const dRow = r.nextPosition.row - position.row
                const interior =
                  key.type === 'ArrowDown'
                    ? position.row < bounds.rows - 1
                    : position.row > 0
                if (!interior) expect(dRow).toBe(0)
                else if (key.type === 'ArrowDown')
                  expect(dRow).toBeGreaterThan(0)
                else expect(dRow).toBeLessThan(0)
              }
              if (key.type === 'ArrowRight' || key.type === 'ArrowLeft') {
                expect(r.action).toBe('MOVE')
                const dCol = r.nextPosition.col - position.col
                const interior =
                  key.type === 'ArrowRight'
                    ? position.col < bounds.cols - 1
                    : position.col > 0
                if (!interior) expect(dCol).toBe(0)
                else if (key.type === 'ArrowRight')
                  expect(dCol).toBeGreaterThan(0)
                else expect(dCol).toBeLessThan(0)
              }
              if (key.type === 'Char' && kind === 'status') {
                expect(r.action).toBe('TYPE_AHEAD')
                expect(r.seed).toBe(key.char)
                expect(r.nextState).toBe('EDIT')
              }
              if (key.type === 'Enter' && kind === 'status')
                expect(r.action).toBe('OPEN_EDIT')
              if (key.type === 'Enter' && kind === 'period')
                expect(r.action).toBe('OPEN_PERIOD')
            }
            if (state === 'EDIT' && key.type === 'Char') {
              expect(r.action).toBe('TYPE_AHEAD')
              expect(r.seed).toBe(key.char)
            }
            // инв.3-дрейф (ревью 9.3): внутри правки позиция стоит на месте
            // до COMMIT — иначе Esc «вернул» бы фокус в уехавшую ячейку.
            if (
              (state === 'EDIT' || state === 'PERIOD_EDIT') &&
              r.action !== 'COMMIT'
            )
              expect(r.nextPosition).toEqual(position)
            // позиция/состояние переносятся в следующий шаг (bounds постоянен)
            state = r.nextState
            position = r.nextPosition
          }
        },
      ),
      OPTS,
    )
  })

  it('самоисцеление входа: позиция вне границ (сжатие грида, отрицательные/overflow) → результат в границах', () => {
    // Единственное поведение, добавленное d13fed8, лежало ВНЕ property-
    // пространства (startArb генерировал только валидные старты); отрицательные
    // координаты и overflow по col не были покрыты нигде (ревью 9.3).
    fc.assert(
      fc.property(
        boundsArb,
        fc.constantFrom(...CELL_STATES),
        fc.record({
          row: fc.integer({ min: -5, max: 15 }),
          col: fc.integer({ min: -5, max: 15 }),
        }),
        keyArb,
        (bounds, state, position, key) => {
          const r = transition({ state, position, bounds, key })
          expect(r.nextPosition.row).toBeGreaterThanOrEqual(0)
          expect(r.nextPosition.row).toBeLessThan(bounds.rows)
          expect(r.nextPosition.col).toBeGreaterThanOrEqual(0)
          expect(r.nextPosition.col).toBeLessThan(bounds.cols)
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
