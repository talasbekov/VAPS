// Handler-уровень (приём Этапа 49): проверяется, что MSW действительно
// СОПОСТАВЛЯЕТ маршрут раздела с URL, который строит клиент. Тест репозитория
// этого не видит (зовёт функции напрямую), тест страницы подменяет handler'ы
// своими — обе половины остаются зелёными при несовпадающем пути.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../../../shared/api/client'
import { ApiError } from '../../../shared/api/errors'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import {
  EVALUATION_REGISTRY_PATH,
  EVALUATION_WORKSPACE_PATH,
  RATING_AUDIT_PATH,
  RATING_EMPLOYEE_DETAIL_PATH,
  evaluationCorrectPath,
  evaluationDetailPath,
  OPERATIONAL_RATINGS_PATH,
  OPERATIONAL_RATING_DYNAMICS_PATH,
  RATING_ANALYTICS_PATH,
  evaluationSubmitPath,
} from '../api/pending-contracts'
import type {
  EvaluationWorkspaceResponse,
  ListOperationalRatingsResponse,
  RatingAnalyticsResponse,
  RatingDynamicsResponse,
  SubmitEvaluationResponse,
  SubmittedEvaluationDetailResponse,
  CorrectEvaluationResponse,
  EvaluationRegistryResponse,
  RatingEmployeeDetailResponse,
  RatingAuditResponse,
} from '../api/pending-contracts'
import { createRatingsHandlers } from './handlers'
import { buildRatingsSeed } from './fixtures'

const CLOCK_ISO = '2026-07-20T08:00:00+05:00'
const VIEWER = 'rating-viewer'
const ANALYST = 'rating-analyst'
const NOBODY = 'nobody-user'
const EVALUATOR = 'demo-event-planner'
const AUDITOR = 'rating-auditor'
const BASE = 'http://localhost'

const adapter = createMemoryPersistence()
const clock = new DemoClock(CLOCK_ISO)
const server = setupServer(...createRatingsHandlers(adapter, clock))

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers(...createRatingsHandlers(adapter, clock)))

beforeEach(async () => {
  const ratings = buildRatingsSeed()
  // Слайс «Настроек» — рукописной формой: импорт чужой фичи запрещён
  // ARCH-FE-013, а сверку этой формы с настоящим сидом ведёт контрактный тест
  // в `app/` (он единственный слой, которому позволено видеть обе фичи).
  const settings = {
    sliceName: 'settings',
    data: {
      sectionVersions: { RATING_POLICY: 'OPERATIONAL-RATING-test.1' },
      settings: [
        {
          settingCode: 'RATING.PERIOD.PARAMETER',
          sectionCode: 'RATING_POLICY',
          groupCode: 'AGGREGATION',
          field: 'PARAMETER',
          value: 105,
        },
        {
          settingCode: 'RATING.MIN_EVALUATIONS.PARAMETER',
          sectionCode: 'RATING_POLICY',
          groupCode: 'AGGREGATION',
          field: 'WARNING_FROM',
          value: 4,
        },
        {
          settingCode: 'RATING.SUPPRESSION_MIN_GROUP.PARAMETER',
          sectionCode: 'RATING_POLICY',
          groupCode: 'PRIVACY',
          field: 'PARAMETER',
          value: 3,
        },
      ],
      changeLog: [],
    },
  }
  await adapter.reset({
    application: 'smart-josparlau',
    schema_version: 34,
    seed_version: 'test-v34',
    scenario: 'normal',
    revision: 0,
    created_at: CLOCK_ISO,
    updated_at: CLOCK_ISO,
    slices: { [ratings.sliceName]: ratings.data, [settings.sliceName]: settings.data },
  })
  registerRbacDirectory([
    { userId: VIEWER, permissions: ['ops.rating.view_aggregate'] },
    { userId: ANALYST, permissions: ['ops.analytics.view'] },
    { userId: NOBODY, permissions: [] },
    { userId: AUDITOR, permissions: ['ops.rating.view_audit'] },
    {
      userId: EVALUATOR,
      permissions: [
        'ops.rating.evaluate',
        'ops.rating.correct',
        'ops.rating.view_correction_chain',
      ],
    },
  ])
})

const client = createApiClient({ baseUrl: BASE, defaultHeaders: { 'X-User-Id': VIEWER } })
const stranger = createApiClient({ baseUrl: BASE, defaultHeaders: { 'X-User-Id': NOBODY } })
const analyst = createApiClient({ baseUrl: BASE, defaultHeaders: { 'X-User-Id': ANALYST } })
const evaluator = createApiClient({ baseUrl: BASE, defaultHeaders: { 'X-User-Id': EVALUATOR } })
const auditor = createApiClient({ baseUrl: BASE, defaultHeaders: { 'X-User-Id': AUDITOR } })

async function statusOf(call: () => Promise<unknown>): Promise<number> {
  try {
    await call()
    return 200
  } catch (error) {
    if (error instanceof ApiError) return error.status
    throw error
  }
}

describe('ratings handlers — сопоставление маршрута', () => {
  it('GET сводки доходит до repository и отдаёт агрегаты', async () => {
    const response = await client.get<ListOperationalRatingsResponse>(OPERATIONAL_RATINGS_PATH)
    expect(response.results.length).toBeGreaterThan(0)
    // Методика доезжает до клиента ЧЕРЕЗ HTTP: репозиторий её отдаёт, а
    // handler не теряет по дороге.
    expect(response.policy?.policyVersion).toBe('OPERATIONAL-RATING-test.1')
  })

  it('без права — 403 конвертом, а не пустым списком', async () => {
    expect(await statusOf(() => stranger.get(OPERATIONAL_RATINGS_PATH))).toBe(403)
  })
})

describe('ratings handlers — динамика (§19.20)', () => {
  it('GET динамики доходит до repository и отдаёт ряд точек', async () => {
    const response = await client.get<RatingDynamicsResponse>(
      `${OPERATIONAL_RATING_DYNAMICS_PATH}?employee=employee-2`,
    )
    // Выбор сотрудника едет ЧЕРЕЗ HTTP query, а не теряется в handler'е:
    // потерянный параметр вернул бы ряд первого сотрудника и остался бы
    // незамеченным — поэтому проверяется именно НЕ первый.
    expect(response.employeeId).toBe('employee-2')
    expect(response.points.length).toBeGreaterThan(0)
    expect(response.boundaries.length).toBeGreaterThan(0)
  })

  it('без права — 403 конвертом, а не пустым рядом', async () => {
    expect(await statusOf(() => stranger.get(OPERATIONAL_RATING_DYNAMICS_PATH))).toBe(403)
  })
})

describe('ratings handlers — аналитика рейтинга (§22.16)', () => {
  it('GET отчёта доходит до repository и отдаёт агрегаты групп', async () => {
    const response = await analyst.get<RatingAnalyticsResponse>(RATING_ANALYTICS_PATH)
    expect(response.figures?.groups.length).toBeGreaterThan(0)
    expect(response.suppressionMinGroupSize).toBe(3)
  })

  it('держателю одной лишь сводки отчёт закрыт — 403 конвертом', async () => {
    expect(await statusOf(() => client.get(RATING_ANALYTICS_PATH))).toBe(403)
  })
})

describe('ratings handlers — рабочее пространство оценивания (§19.14)', () => {
  it('GET заданий доходит до repository, и параметр мероприятия не теряется', async () => {
    const response = await evaluator.get<EvaluationWorkspaceResponse>(
      `${EVALUATION_WORKSPACE_PATH}?event=event-2`,
    )
    // Проверяется НЕ первое мероприятие: потерянный параметр вернул бы очередь
    // первого и остался бы незамеченным.
    expect(response.selectedEvent?.securityEventId).toBe('event-2')
    expect(response.pending.map((item) => item.id)).toEqual(['work-item-5'])
  })

  it('без права оценивания — 403 конвертом, а не пустой очередью', async () => {
    expect(await statusOf(() => client.get(EVALUATION_WORKSPACE_PATH))).toBe(403)
  })

  it('POST отправки сопоставляется со строкой задания и коммитит оценку', async () => {
    const created = await evaluator.post<SubmitEvaluationResponse>(
      evaluationSubmitPath('work-item-5'),
      {
        score: 9,
        basisCode: 'DISCIPLINE',
        basisNote: null,
        comment: null,
        revision: 1,
        idempotencyKey: 'idem-handler-submit',
      },
    )
    expect(created.workItem).toMatchObject({ id: 'work-item-5', status: 'SUBMITTED' })
    const after = await evaluator.get<EvaluationWorkspaceResponse>(
      `${EVALUATION_WORKSPACE_PATH}?event=event-2`,
    )
    expect(after.pending).toEqual([])
    expect(after.submitted.map((item) => item.workItemId)).toEqual(['work-item-5'])
  })

  it('отказ правила формы едет 422 со СВОИМ кодом', async () => {
    try {
      await evaluator.post(evaluationSubmitPath('work-item-5'), {
        score: 5,
        basisCode: 'DISCIPLINE',
        basisNote: null,
        comment: null,
        revision: 1,
        idempotencyKey: 'idem-handler-low',
      })
      expect.unreachable('отправка без комментария к низкой оценке обязана быть отвергнута')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect(error as ApiError).toMatchObject({ status: 422, errorCode: 'COMMENT_REQUIRED' })
    }
  })

  it('чужое задание — 404, и путь строки не перехватывается путём раздела', async () => {
    expect(
      await statusOf(() =>
        evaluator.post(evaluationSubmitPath('work-item-6'), {
          score: 9,
          basisCode: 'DISCIPLINE',
          basisNote: null,
          comment: null,
          revision: 1,
          idempotencyKey: 'idem-handler-foreign',
        }),
      ),
    ).toBe(404)
  })
})

describe('ratings handlers — карточка и исправление оценки (§19.17-19.18)', () => {
  it('GET карточки не перехватывается путём отправки и отдаёт цепочку', async () => {
    const detail = await evaluator.get<SubmittedEvaluationDetailResponse>(
      evaluationDetailPath('work-item-9'),
    )
    expect(detail.submitted.evaluationId).toBe('evaluation-5')
    expect(detail.chain?.map((link) => link.evaluationId)).toEqual([
      'evaluation-4',
      'evaluation-5',
    ])
    expect(detail.canCorrect).toBe(true)
  })

  it('POST исправления сопоставляется со своим путём и коммитит замещающую запись', async () => {
    const detail = await evaluator.get<SubmittedEvaluationDetailResponse>(
      evaluationDetailPath('work-item-9'),
    )
    const corrected = await evaluator.post<CorrectEvaluationResponse>(
      evaluationCorrectPath('work-item-9'),
      {
        score: 10,
        basisCode: 'DISCIPLINE',
        basisNote: null,
        comment: null,
        reason: 'Учтён рапорт старшего смены',
        revision: detail.workItem.revision,
        idempotencyKey: 'idem-handler-correct',
      },
    )
    expect(corrected.submitted.score).toBe(10)
    // Цепочка удлинилась — и это видно через HTTP, а не только в репозитории.
    expect(corrected.chain).toHaveLength(3)
  })

  it('отказ по причине исправления едет 422 со СВОИМ кодом', async () => {
    const detail = await evaluator.get<SubmittedEvaluationDetailResponse>(
      evaluationDetailPath('work-item-9'),
    )
    try {
      await evaluator.post(evaluationCorrectPath('work-item-9'), {
        score: 10,
        basisCode: 'DISCIPLINE',
        basisNote: null,
        comment: null,
        reason: '',
        revision: detail.workItem.revision,
        idempotencyKey: 'idem-handler-1',
      })
      expect.unreachable('исправление без причины обязано быть отвергнуто')
    } catch (error) {
      expect(error as ApiError).toMatchObject({
        status: 422,
        errorCode: 'CORRECTION_REASON_REQUIRED',
      })
    }
  })

  it('без права исправления — 403 конвертом', async () => {
    expect(
      await statusOf(() =>
        client.post(evaluationCorrectPath('work-item-9'), {
          score: 10,
          basisCode: 'DISCIPLINE',
          basisNote: null,
          comment: null,
          reason: 'Попытка без права',
          revision: 3,
          idempotencyKey: 'idem-handler-denied',
        }),
      ),
    ).toBe(403)
  })
})

describe('ratings handlers — реестр итоговых оценок (§19.15-19.17)', () => {
  it('фильтры доезжают до repository параметрами запроса, а не теряются', async () => {
    const response = await client.get<EvaluationRegistryResponse>(
      `${EVALUATION_REGISTRY_PATH}?employee=employee-2&corrected=true`,
    )
    // Оба параметра применены: у employee-2 исправленных записей нет, и
    // потерянный фильтр вернул бы непустой список.
    expect(response.total).toBe(0)
    const onlyEmployee = await client.get<EvaluationRegistryResponse>(
      `${EVALUATION_REGISTRY_PATH}?employee=employee-2`,
    )
    expect(onlyEmployee.total).toBe(4)
  })

  it('страница едет в запросе и возвращается в ответе', async () => {
    const page2 = await client.get<EvaluationRegistryResponse>(
      `${EVALUATION_REGISTRY_PATH}?page=2`,
    )
    expect(page2.page).toBe(2)
    expect(page2.results.length).toBeGreaterThan(0)
  })

  it('карточка агрегата не перехватывается путём сводки', async () => {
    const detail = await client.get<RatingEmployeeDetailResponse>(
      `${RATING_EMPLOYEE_DETAIL_PATH}?employee=employee-3`,
    )
    // Проверяется НЕ первый сотрудник: потерянный параметр вернул бы первого.
    expect(detail.employeeId).toBe('employee-3')
    expect(detail.summary.dataState).toBe('INSUFFICIENT_DATA')
  })

  it('без права — 403 конвертом на обоих путях', async () => {
    expect(await statusOf(() => stranger.get(EVALUATION_REGISTRY_PATH))).toBe(403)
    expect(
      await statusOf(() => stranger.get(`${RATING_EMPLOYEE_DETAIL_PATH}?employee=employee-1`)),
    ).toBe(403)
  })
})

describe('ratings handlers — конфликт редакции (§19.25)', () => {
  it('конфликт едет 409 со СВОИМ кодом и подробностями, а не 422', async () => {
    try {
      await evaluator.post(evaluationCorrectPath('work-item-9'), {
        score: 10,
        basisCode: 'DISCIPLINE',
        basisNote: null,
        comment: null,
        reason: 'Учтён рапорт',
        revision: 99,
        idempotencyKey: 'idem-handler-conflict',
      })
      expect.unreachable('устаревшая редакция обязана быть отвергнута')
    } catch (error) {
      const failure = error as ApiError
      expect(failure).toMatchObject({ status: 409, errorCode: 'EVALUATION_REVISION_MISMATCH' })
      // Подробности доезжают до клиента ЧЕРЕЗ HTTP: без них экран не покажет
      // diff, которого требует §19.25.
      expect(failure.details).toMatchObject({ currentRevision: 3, currentScore: 9 })
      // И код НЕ overridable: общий ConflictDialog для конфликта версии оценки
      // запрещён прямо (§19.25).
      expect((failure as { overridable?: boolean }).overridable).toBe(false)
    }
  })

  it('повтор отправки с тем же ключом через HTTP возвращает прежний результат', async () => {
    const body = {
      score: 9,
      basisCode: 'DISCIPLINE',
      basisNote: null,
      comment: null,
      revision: 1,
      idempotencyKey: 'idem-handler-repeat',
    }
    const first = await evaluator.post<SubmitEvaluationResponse>(
      evaluationSubmitPath('work-item-5'),
      body,
    )
    const second = await evaluator.post<SubmitEvaluationResponse>(
      evaluationSubmitPath('work-item-5'),
      body,
    )
    expect(second.submitted.evaluationId).toBe(first.submitted.evaluationId)
  })
})

describe('ratings handlers — журнал оценивания (§19.27)', () => {
  it('GET журнала доходит до repository и отдаёт сеяные события', async () => {
    const audit = await auditor.get<RatingAuditResponse>(RATING_AUDIT_PATH)
    expect(audit.results.length).toBeGreaterThan(0)
    expect(audit.results.map((entry) => entry.eventCode)).toContain('EVALUATION_CORRECTED')
  })

  it('отправка через HTTP оставляет след в журнале с requestId запроса', async () => {
    await evaluator.post(evaluationSubmitPath('work-item-5'), {
      score: 9,
      basisCode: 'DISCIPLINE',
      basisNote: null,
      comment: null,
      revision: 1,
      idempotencyKey: 'idem-handler-audit',
    })
    const audit = await auditor.get<RatingAuditResponse>(RATING_AUDIT_PATH)
    const entry = audit.results.find((item) => item.requestId === 'idem-handler-audit')
    expect(entry).toMatchObject({ eventCode: 'EVALUATION_SUBMITTED', outcome: 'SUCCESS' })
  })

  it('держателю сводки журнал закрыт — 403 конвертом', async () => {
    expect(await statusOf(() => client.get(RATING_AUDIT_PATH))).toBe(403)
  })
})
