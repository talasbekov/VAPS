// Чистая модель печатной формы расстановки (§9.15). env node — ни DOM, ни сети.
import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from '../../shared/api/errors'
import {
  ACKNOWLEDGED_TEXT,
  EMPTY_CELL,
  NOT_ACKNOWLEDGED_TEXT,
  NOT_ASSIGNED_TEXT,
  NOT_FOUND_TEXT,
  ORPHAN_SECTOR_TEXT,
  PERMISSION_TEXT,
  buildPlacementRows,
  describePlacementFailure,
  parsePlacementDocument,
  placementTotals,
  sentence,
  stageLabel,
} from './placementPrint'

function apiError(message: string, status: number): ApiError {
  return new ApiError({
    message,
    status,
    errorCode: null,
    details: {},
    requestId: null,
  })
}

/** Ответ mock-эндпоинта `/api/ops/security-events/:id/` — узкий срез. */
const EVENT = {
  id: 'se-1',
  code: 'ОМ-2026-014',
  title: 'Визит делегации',
  objectName: 'Резиденция «Ак Орда»',
  businessDate: '2026-07-22',
  ownerName: 'Тастанов Г. К.',
  stage: 'APPROVAL',
  updatedAt: '2026-07-20T09:15:00+05:00',
  reconSectorPosts: [
    {
      id: 'post-1',
      sector: 'Северный сектор',
      post: 'Пост №1 (КПП)',
      task: 'Пропускной режим',
      requirements: 'Допуск формы 2',
      need: 2,
      // Оценочные пометки рекогносцировки — в документ НЕ идут (§19.24).
      result: 'NEEDS_CHANGES',
      comment: 'Замечание проверяющего по посту',
    },
    {
      id: 'post-2',
      sector: 'Южный сектор',
      post: 'Пост №2 (парковка)',
      task: 'Досмотр транспорта',
      requirements: 'Кинолог',
      need: 1,
      result: 'MATCHES',
      comment: '',
    },
  ],
  placementAssignments: [
    {
      id: 'a-1',
      postId: 'post-1',
      employeeId: 'emp-1',
      employeeName: 'Байжанов С. Т.',
      acknowledgedAt: '2026-07-20T08:40:00+05:00',
    },
    {
      id: 'a-2',
      postId: 'post-1',
      employeeId: 'emp-2',
      employeeName: 'Ермеков А. Н.',
      acknowledgedAt: null,
    },
  ],
}

describe('parsePlacementDocument', () => {
  it('разбирает шапку, посты и назначения', () => {
    const doc = parsePlacementDocument(EVENT)
    expect(doc).not.toBeNull()
    expect(doc?.code).toBe('ОМ-2026-014')
    expect(doc?.objectName).toBe('Резиденция «Ак Орда»')
    expect(doc?.ownerName).toBe('Тастанов Г. К.')
    expect(doc?.updatedAt).toBe('2026-07-20T09:15:00+05:00')
    expect(doc?.posts).toHaveLength(2)
    expect(doc?.assignments).toHaveLength(2)
  })

  it('НЕ разбирает оценочные поля постов — они не могут протечь в документ (§19.24)', () => {
    const doc = parsePlacementDocument(EVENT)
    const post = doc?.posts[0]
    expect(post).toBeDefined()
    // Красная проба: если кто-то добавит `result`/`comment` в parsePost,
    // этот ассерт покраснеет раньше, чем поле доедет до вёрстки.
    expect(Object.keys(post as object).sort()).toEqual([
      'id',
      'need',
      'post',
      'requirements',
      'sector',
      'task',
    ])
  })

  it('требование поста и обоснование обхода рейтинга не доезжают до документа (§19.24)', () => {
    // Ответ сервера НАРОЧНО несёт оба новых поля §19.24: требование поста и
    // сохранённое обоснование обхода (в нём написано про рейтинг). В печатную
    // расстановку §19.24 запрещает включать rating и sensitive reasons —
    // проверяется ВЕСЬ JSON документа, а не знакомые ключи.
    const raw = {
      ...EVENT,
      reconSectorPosts: (EVENT.reconSectorPosts as Record<string, unknown>[]).map((post) => ({
        ...post,
        minRating: 8,
      })),
      placementAssignments: (EVENT.placementAssignments as Record<string, unknown>[]).map(
        (assignment) => ({
          ...assignment,
          ratingOverrideReason: 'Рейтинг 7,9 ниже требования, обход подтверждён',
        }),
      ),
    }
    const json = JSON.stringify(parsePlacementDocument(raw))
    expect(json).not.toContain('minRating')
    expect(json).not.toContain('ratingOverrideReason')
    expect(json).not.toContain('7,9')
    expect(json).not.toContain('обход')
  })

  it('возвращает null на теле, которое не карточка ОМ', () => {
    expect(parsePlacementDocument(null)).toBeNull()
    expect(parsePlacementDocument([])).toBeNull()
    expect(parsePlacementDocument('строка')).toBeNull()
    expect(parsePlacementDocument({ code: 'ОМ-1' })).toBeNull() // нет id
  })

  it('переживает отсутствующие/битые массивы — пустые, не падение', () => {
    const doc = parsePlacementDocument({ id: 'se-2' })
    expect(doc?.posts).toEqual([])
    expect(doc?.assignments).toEqual([])
    expect(doc?.code).toBe('')
  })

  it('отбрасывает строки без идентификатора, но сохраняет остальные', () => {
    const doc = parsePlacementDocument({
      id: 'se-3',
      reconSectorPosts: [{ sector: 'Без id' }, { id: 'post-9', sector: 'С id' }],
      placementAssignments: [{ employeeName: 'Без поста' }],
    })
    expect(doc?.posts).toHaveLength(1)
    expect(doc?.posts[0].sector).toBe('С id')
    expect(doc?.assignments).toEqual([])
  })

  it('нечисловая потребность становится 0, а не NaN в документе', () => {
    const doc = parsePlacementDocument({
      id: 'se-4',
      reconSectorPosts: [{ id: 'post-1', need: 'два' }],
    })
    expect(doc?.posts[0].need).toBe(0)
  })
})

describe('buildPlacementRows', () => {
  it('пост с двумя назначениями даёт две строки, потребность — только в первой', () => {
    const rows = buildPlacementRows(parsePlacementDocument(EVENT)!)
    const postOneRows = rows.filter((row) => row.post === 'Пост №1 (КПП)')
    expect(postOneRows).toHaveLength(2)
    expect(postOneRows[0].need).toBe(2)
    expect(postOneRows[0].employeeName).toBe('Байжанов С. Т.')
    expect(postOneRows[0].acknowledgement).toBe(ACKNOWLEDGED_TEXT)
    expect(postOneRows[1].need).toBeNull()
    expect(postOneRows[1].employeeName).toBe('Ермеков А. Н.')
    expect(postOneRows[1].acknowledgement).toBe(NOT_ACKNOWLEDGED_TEXT)
  })

  it('пост без назначений печатается строкой «не назначен» — дырку не прячем', () => {
    const rows = buildPlacementRows(parsePlacementDocument(EVENT)!)
    const postTwo = rows.find((row) => row.post === 'Пост №2 (парковка)')
    expect(postTwo?.employeeName).toBe(NOT_ASSIGNED_TEXT)
    expect(postTwo?.acknowledgement).toBe(EMPTY_CELL)
    expect(postTwo?.need).toBe(1)
  })

  it('назначение на несуществующий пост печатается в хвосте, а не теряется', () => {
    const doc = parsePlacementDocument({
      ...EVENT,
      placementAssignments: [
        ...EVENT.placementAssignments,
        {
          id: 'a-3',
          postId: 'post-удалён',
          employeeId: 'emp-3',
          employeeName: 'Оспанов Д. М.',
          acknowledgedAt: null,
        },
      ],
    })!
    const rows = buildPlacementRows(doc)
    const orphan = rows.at(-1)
    expect(orphan?.employeeName).toBe('Оспанов Д. М.')
    expect(orphan?.sector).toBe(ORPHAN_SECTOR_TEXT)
    expect(orphan?.post).toBe('post-удалён')
    expect(orphan?.need).toBeNull()
  })

  it('порядок строк следует порядку постов рекогносцировки', () => {
    const rows = buildPlacementRows(parsePlacementDocument(EVENT)!)
    expect(rows.map((row) => row.post)).toEqual([
      'Пост №1 (КПП)',
      'Пост №1 (КПП)',
      'Пост №2 (парковка)',
    ])
  })
})

describe('placementTotals', () => {
  it('потребность и назначено считаются независимо', () => {
    expect(placementTotals(parsePlacementDocument(EVENT)!)).toEqual({
      need: 3,
      assigned: 2,
    })
  })

  it('назначение вне рекогносцировки входит в «назначено», но не в потребность', () => {
    const doc = parsePlacementDocument({
      ...EVENT,
      placementAssignments: [
        ...EVENT.placementAssignments,
        { id: 'a-3', postId: 'нет-такого', employeeName: 'Оспанов Д. М.', acknowledgedAt: null },
      ],
    })!
    expect(placementTotals(doc)).toEqual({ need: 3, assigned: 3 })
  })
})

describe('stageLabel', () => {
  it('переводит известный код', () => {
    expect(stageLabel('PLACEMENT')).toBe('Расстановка')
    expect(stageLabel('CLOSED')).toBe('Закрыто')
  })

  it('неизвестный код возвращает дословно, а не выдуманную подпись', () => {
    expect(stageLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })
})

describe('sentence', () => {
  it('не удваивает точку у ФИО, которое ею кончается', () => {
    // Живой демо-ростер: «Ерланов Д.» — наивная склейка давала «Ерланов Д..».
    expect(sentence('Ерланов Д.')).toBe('Ерланов Д.')
  })

  it('добавляет точку там, где её нет', () => {
    expect(sentence('Расстановка')).toBe('Расстановка.')
  })

  it('пустое значение — тире с точкой, а не голая точка', () => {
    expect(sentence('')).toBe('—.')
  })
})

describe('describePlacementFailure', () => {
  it('401 — молчание (RequireAuth уже уводит на /login)', () => {
    expect(describePlacementFailure(apiError('нет', 401)).kind).toBe('silent')
  })

  it('403 и 404 получают фиксированные тексты', () => {
    expect(describePlacementFailure(apiError('x', 403))).toEqual({
      kind: 'permission',
      message: PERMISSION_TEXT,
    })
    expect(describePlacementFailure(apiError('x', 404))).toEqual({
      kind: 'not-found',
      message: NOT_FOUND_TEXT,
    })
  })

  it('сеть и 5xx получают ТЕКСТ, а не тишину — тоста у useQuery нет', () => {
    expect(describePlacementFailure(new NetworkError('соединение потеряно')).message).toContain(
      'соединение потеряно',
    )
    expect(describePlacementFailure(apiError('сервер упал', 500)).kind).toBe('other')
    expect(describePlacementFailure(apiError('сервер упал', 500)).message).not.toBe('')
  })
})
