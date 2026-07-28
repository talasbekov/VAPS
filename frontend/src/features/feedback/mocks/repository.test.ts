// Repository обратной связи (§28): видимость обращений и черновиков,
// серверное вырезание закрытого содержания, область поиска, страницы,
// создание и отправка.
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import { FEEDBACK_REGISTRY } from './fixtures'
import {
  createFeedbackRepository,
  RepositoryBusinessRuleError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'
import type { CreateFeedbackRequest } from '../api/pending-contracts'
import type { FeedbackRequest } from '../model/types'

const AUTHOR = 'author-user'
const OTHER_AUTHOR = 'other-author-user'
const READER = 'reader-user'
const CONFIDENTIAL_READER = 'confidential-reader-user'
const SUPPORT = 'support-user'
const NOBODY = 'nobody-user'

/** Слово живёт ТОЛЬКО в описании конфиденциального обращения — ни в теме, ни
 * где-либо ещё в наборе. На нём проверяется область поиска. */
const SECRET_WORD = 'журавль'

function request(overrides: Partial<FeedbackRequest> & { feedbackId: string }): FeedbackRequest {
  return {
    subject: 'Тема обращения',
    description: 'Описание обращения',
    typeCode: 'BUG',
    priorityCode: 'NORMAL',
    statusCode: 'NEW',
    moduleCode: 'DUTIES',
    expectedResult: null,
    reproductionSteps: null,
    attachments: [],
    contact: null,
    confidential: false,
    relatedRoute: null,
    technicalInfo: null,
    author: { userId: OTHER_AUTHOR, safeLabel: OTHER_AUTHOR },
    createdAt: '2026-07-20T07:00:00+05:00',
    submittedAt: '2026-07-20T07:00:00+05:00',
    updatedAt: '2026-07-20T07:00:00+05:00',
    ...overrides,
  }
}

function seedEnvelope(requests: FeedbackRequest[]): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 24,
    seed_version: 'test-v24',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: {
      feedback: {
        requests,
        registry: {
          ...FEEDBACK_REGISTRY,
          types: [...FEEDBACK_REGISTRY.types],
          priorities: [...FEEDBACK_REGISTRY.priorities],
          statuses: [...FEEDBACK_REGISTRY.statuses],
          modules: [...FEEDBACK_REGISTRY.modules],
        },
      },
    },
  }
}

async function setup(requests: FeedbackRequest[] = []) {
  const adapter = createMemoryPersistence()
  await adapter.reset(seedEnvelope(requests))
  const clock = new DemoClock('2026-07-20T08:00:00+05:00')
  return { repository: createFeedbackRepository(adapter, clock), adapter, clock }
}

const CREATE_BODY: CreateFeedbackRequest = {
  subject: 'Не работает фильтр',
  description: 'Фильтр по объекту сбрасывается при переходе на вторую страницу.',
  typeCode: 'BUG',
  priorityCode: 'HIGH',
  moduleCode: 'DUTIES',
  expectedResult: 'Фильтр сохраняется.',
  reproductionSteps: '1. Задать фильтр. 2. Перейти на страницу 2.',
  contact: 'вн. 10-10',
  confidential: false,
  relatedRoute: '/duties',
  attachments: [{ fileName: 'shot.png', sizeBytes: 2048, mimeType: 'image/png' }],
  includeTechnicalInfo: false,
  technicalInfo: null,
  saveAsDraft: false,
}

beforeEach(() => {
  registerRbacDirectory([
    { userId: AUTHOR, permissions: ['ops.feedback.view', 'ops.feedback.create'] },
    { userId: OTHER_AUTHOR, permissions: ['ops.feedback.view', 'ops.feedback.create'] },
    { userId: READER, permissions: ['ops.feedback.view', 'ops.feedback.view_all'] },
    {
      userId: CONFIDENTIAL_READER,
      permissions: ['ops.feedback.view', 'ops.feedback.view_all', 'ops.feedback.view_confidential'],
    },
    {
      userId: SUPPORT,
      permissions: ['ops.feedback.view', 'ops.feedback.view_all', 'ops.feedback.create'],
    },
    { userId: NOBODY, permissions: [] },
  ])
})

describe('видимость обращений (§28)', () => {
  it('без права чтения реестр не отдаётся вовсе', async () => {
    const { repository } = await setup([request({ feedbackId: 'fb-1' })])
    await expect(repository.listFeedback(NOBODY)).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('без права видеть чужие обращения смотрящий видит только свои', async () => {
    const { repository } = await setup([
      request({ feedbackId: 'fb-own', author: { userId: AUTHOR, safeLabel: AUTHOR } }),
      request({ feedbackId: 'fb-foreign' }),
    ])
    const response = await repository.listFeedback(AUTHOR)
    expect(response.results.map((r) => r.feedbackId)).toEqual(['fb-own'])
    expect(response.totalVisible).toBe(1)
  })

  it('право видеть все обращения открывает чужие', async () => {
    const { repository } = await setup([
      request({ feedbackId: 'fb-own', author: { userId: AUTHOR, safeLabel: AUTHOR } }),
      request({ feedbackId: 'fb-foreign' }),
    ])
    const response = await repository.listFeedback(READER)
    expect(response.results.map((r) => r.feedbackId).sort()).toEqual(['fb-foreign', 'fb-own'])
  })

  it('ЧУЖОЙ ЧЕРНОВИК не открывается даже правом видеть все обращения', async () => {
    const { repository } = await setup([
      request({ feedbackId: 'fb-draft', statusCode: 'DRAFT', submittedAt: null }),
      request({ feedbackId: 'fb-sent' }),
    ])
    const response = await repository.listFeedback(CONFIDENTIAL_READER)
    expect(response.results.map((r) => r.feedbackId)).toEqual(['fb-sent'])
  })

  it('свой черновик автор видит', async () => {
    const { repository } = await setup([
      request({
        feedbackId: 'fb-draft',
        statusCode: 'DRAFT',
        submittedAt: null,
        author: { userId: AUTHOR, safeLabel: AUTHOR },
      }),
    ])
    const response = await repository.listFeedback(AUTHOR)
    expect(response.results.map((r) => r.feedbackId)).toEqual(['fb-draft'])
    expect(response.results[0].isOwn).toBe(true)
  })
})

describe('конфиденциальное обращение (§28 create «confidential»)', () => {
  const CONFIDENTIAL = request({
    feedbackId: 'fb-secret',
    subject: 'Обращение по доступу',
    description: `Прошу разобраться: ${SECRET_WORD} виден не тому сотруднику.`,
    confidential: true,
    expectedResult: 'Доступ ограничен.',
    reproductionSteps: 'Открыть список.',
    contact: 'личный приём',
    relatedRoute: '/organization',
    attachments: [{ fileName: 'vypiska.pdf', sizeBytes: 1024, mimeType: 'application/pdf' }],
    technicalInfo: {
      appRevision: 'demo',
      viewport: '1440×900',
      platform: 'desktop',
      capturedAt: '2026-07-20T07:00:00+05:00',
    },
  })

  it('строка видна, а содержание вырезано СЕРВЕРОМ вместе со всеми производными', async () => {
    const { repository } = await setup([CONFIDENTIAL])
    const response = await repository.listFeedback(READER)
    const [row] = response.results

    // Строка остаётся реестром: тема, тип, приоритет, статус и модуль видны.
    expect(row.subject).toBe('Обращение по доступу')
    expect(row.confidential).toBe(true)
    expect(row.restrictedReason).not.toBeNull()

    // Содержание отсутствует В ОТВЕТЕ, а не спрятано в вёрстке.
    expect(row.description).toBeNull()
    expect(row.descriptionPreview).toBeNull()
    expect(row.expectedResult).toBeNull()
    expect(row.reproductionSteps).toBeNull()
    expect(row.contact).toBeNull()
    expect(row.relatedRoute).toBeNull()
    expect(row.attachments).toBeNull()
    expect(row.technicalInfo).toBeNull()

    // Проверка по ВСЕМУ ответу, а не по знакомым ключам: закрытое значение
    // могло уехать производным полем, о котором ассерт не знает.
    expect(JSON.stringify(response)).not.toContain(SECRET_WORD)
  })

  it('обладателю отдельного права содержание приходит целиком', async () => {
    const { repository } = await setup([CONFIDENTIAL])
    const [row] = (await repository.listFeedback(CONFIDENTIAL_READER)).results
    expect(row.description).toContain(SECRET_WORD)
    expect(row.descriptionPreview).toContain(SECRET_WORD)
    expect(row.restrictedReason).toBeNull()
  })

  it('автор видит своё конфиденциальное обращение без отдельного права', async () => {
    const { repository } = await setup([
      { ...CONFIDENTIAL, author: { userId: AUTHOR, safeLabel: AUTHOR } },
    ])
    const [row] = (await repository.listFeedback(AUTHOR)).results
    expect(row.description).toContain(SECRET_WORD)
    expect(row.restrictedReason).toBeNull()
  })

  it('поиск НЕ находит по вырезанному описанию — иначе совпадение выдаёт его содержимое', async () => {
    const { repository } = await setup([CONFIDENTIAL])
    const hidden = await repository.listFeedback(READER, { search: SECRET_WORD })
    expect(hidden.results).toHaveLength(0)
    expect(hidden.totalMatched).toBe(0)

    // Тот же запрос у того, кому содержание видно, находит обращение — значит
    // предыдущая проверка не пуста: слово в наборе есть.
    const visible = await repository.listFeedback(CONFIDENTIAL_READER, { search: SECRET_WORD })
    expect(visible.results.map((r) => r.feedbackId)).toEqual(['fb-secret'])
  })

  it('поиск по ТЕМЕ работает и у закрытого обращения', async () => {
    const { repository } = await setup([CONFIDENTIAL])
    const response = await repository.listFeedback(READER, { search: 'по доступу' })
    expect(response.results.map((r) => r.feedbackId)).toEqual(['fb-secret'])
  })
})

describe('фильтры, сводка и страницы (§28 list)', () => {
  const MANY = [
    request({ feedbackId: 'fb-a', statusCode: 'NEW', createdAt: '2026-07-20T07:09:00+05:00' }),
    request({ feedbackId: 'fb-b', statusCode: 'NEW', createdAt: '2026-07-20T07:08:00+05:00' }),
    request({
      feedbackId: 'fb-c',
      statusCode: 'FIXED',
      typeCode: 'UX',
      createdAt: '2026-07-20T07:07:00+05:00',
    }),
    request({ feedbackId: 'fb-d', statusCode: 'CLOSED', createdAt: '2026-07-20T07:06:00+05:00' }),
    request({
      feedbackId: 'fb-e',
      statusCode: 'NEW',
      moduleCode: 'OBJECTS',
      createdAt: '2026-07-20T07:05:00+05:00',
    }),
  ]

  it('порядок задаёт сервер: сначала недавние', async () => {
    const { repository } = await setup(MANY)
    const response = await repository.listFeedback(READER)
    // Пять элементов при странице в четыре: порядок различает больше одной
    // правдоподобной сортировки, а не совпадает случайно (двух элементов для
    // такой проверки почти всегда мало).
    expect(response.results.map((r) => r.feedbackId)).toEqual(['fb-a', 'fb-b', 'fb-c', 'fb-d'])
  })

  it('при равном времени порядок задаёт идентификатор, а не порядок в хранилище', async () => {
    // Обе записи созданы в одну миллисекунду сценарного времени, а в слайсе
    // лежат в ОБРАТНОМ идентификаторам порядке: без tie-breaker'а выдача
    // повторила бы порядок хранения и «съезжала» бы между страницами.
    const { repository } = await setup([
      request({ feedbackId: 'fb-z', createdAt: '2026-07-20T07:00:00+05:00' }),
      request({ feedbackId: 'fb-a', createdAt: '2026-07-20T07:00:00+05:00' }),
      request({ feedbackId: 'fb-m', createdAt: '2026-07-20T07:00:00+05:00' }),
    ])
    const response = await repository.listFeedback(READER)
    expect(response.results.map((r) => r.feedbackId)).toEqual(['fb-a', 'fb-m', 'fb-z'])
  })

  it('вторая страница отдаёт остаток, а не повтор первой', async () => {
    const { repository } = await setup(MANY)
    const second = await repository.listFeedback(READER, { page: 2 })
    expect(second.results.map((r) => r.feedbackId)).toEqual(['fb-e'])
    expect(second.page).toBe(2)
    expect(second.pageCount).toBe(2)
  })

  it('страница за пределами набора отдаёт последнюю, а не пустоту', async () => {
    const { repository } = await setup(MANY)
    const response = await repository.listFeedback(READER, { page: 99 })
    expect(response.page).toBe(2)
    expect(response.results).toHaveLength(1)
  })

  it('сводка считается по ВСЕМУ видимому набору, а не по странице и не по фильтру', async () => {
    const { repository } = await setup(MANY)
    const filtered = await repository.listFeedback(READER, { statusCode: 'FIXED' })
    expect(filtered.results).toHaveLength(1)
    // Фильтр сузил выдачу до одной строки, сводка осталась по всему набору.
    const newCount = filtered.stats.byStatus.find((entry) => entry.statusCode === 'NEW')
    expect(newCount?.count).toBe(3)
    expect(filtered.stats.total).toBe(5)
    expect(filtered.totalMatched).toBe(1)
    expect(filtered.totalVisible).toBe(5)
  })

  it('сводка перечисляет ВСЕ статусы справочника, включая нулевые', async () => {
    const { repository } = await setup(MANY)
    const response = await repository.listFeedback(READER)
    expect(response.stats.byStatus).toHaveLength(FEEDBACK_REGISTRY.statuses.length)
    const rejected = response.stats.byStatus.find((entry) => entry.statusCode === 'REJECTED')
    expect(rejected?.count).toBe(0)
  })

  it('фильтр по типу и модулю применяет сервер', async () => {
    const { repository } = await setup(MANY)
    expect(
      (await repository.listFeedback(READER, { typeCode: 'UX' })).results.map((r) => r.feedbackId),
    ).toEqual(['fb-c'])
    expect(
      (await repository.listFeedback(READER, { moduleCode: 'OBJECTS' })).results.map(
        (r) => r.feedbackId,
      ),
    ).toEqual(['fb-e'])
  })

  it('«только мои» отбирает по актору запроса, а не по переданному значению', async () => {
    const { repository } = await setup([
      request({ feedbackId: 'fb-own', author: { userId: READER, safeLabel: READER } }),
      request({ feedbackId: 'fb-foreign' }),
    ])
    const response = await repository.listFeedback(READER, { mine: true })
    expect(response.results.map((r) => r.feedbackId)).toEqual(['fb-own'])
    // Видимый набор при этом не сузился — сводка считает всё, что доступно.
    expect(response.totalVisible).toBe(2)
  })
})

describe('создание обращения (§28 create)', () => {
  it('без права создания обращение не заводится', async () => {
    const { repository } = await setup()
    await expect(repository.createFeedback(CREATE_BODY, READER)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })

  it('созданное обращение получает статус «Новое» и время отправки', async () => {
    const { repository } = await setup()
    const created = await repository.createFeedback(CREATE_BODY, AUTHOR)
    expect(created.statusCode).toBe('NEW')
    expect(created.submittedAt).not.toBeNull()
    expect(created.author.userId).toBe(AUTHOR)
  })

  it('«сохранить без отправки» даёт ЧЕРНОВИК без времени отправки', async () => {
    const { repository } = await setup()
    const created = await repository.createFeedback(
      { ...CREATE_BODY, saveAsDraft: true },
      AUTHOR,
    )
    expect(created.statusCode).toBe('DRAFT')
    expect(created.submittedAt).toBeNull()
  })

  it('вложение сохраняется МЕТАДАННЫМИ: содержимое из тела запроса не оседает нигде', async () => {
    const { repository, adapter } = await setup()
    await repository.createFeedback(
      {
        ...CREATE_BODY,
        attachments: [
          // Поле с содержимым в контракте не описано — но тело запроса
          // приходит извне, и сервер обязан его не сохранить.
          {
            fileName: 'shot.png',
            sizeBytes: 2048,
            mimeType: 'image/png',
            content: 'iVBORw0KGgoSECRETPAYLOAD',
          } as never,
        ],
      },
      AUTHOR,
    )
    const envelope = await adapter.load()
    expect(JSON.stringify(envelope)).not.toContain('SECRETPAYLOAD')
    const stored = (envelope?.slices.feedback as { requests: FeedbackRequest[] }).requests
    expect(stored[0].attachments).toEqual([
      { fileName: 'shot.png', sizeBytes: 2048, mimeType: 'image/png' },
    ])
  })

  it('без согласия техническая информация НЕ сохраняется, даже если приехала в теле', async () => {
    const { repository } = await setup()
    const created = await repository.createFeedback(
      {
        ...CREATE_BODY,
        includeTechnicalInfo: false,
        technicalInfo: {
          appRevision: 'demo',
          viewport: '1440×900',
          platform: 'desktop',
          capturedAt: '2026-07-20T08:00:00+05:00',
        },
      },
      AUTHOR,
    )
    // Именно `null`, а не пустой объект: пустой читался бы как «собрали и
    // ничего не нашли».
    expect(created.technicalInfo).toBeNull()
  })

  it('при согласии техническая информация сохраняется', async () => {
    const { repository } = await setup()
    const created = await repository.createFeedback(
      {
        ...CREATE_BODY,
        includeTechnicalInfo: true,
        technicalInfo: {
          appRevision: 'demo',
          viewport: '1440×900',
          platform: 'desktop',
          capturedAt: '2026-07-20T08:00:00+05:00',
        },
      },
      AUTHOR,
    )
    expect(created.technicalInfo?.viewport).toBe('1440×900')
  })

  it('коды сверяются со справочником, а не только с типом', async () => {
    const { repository } = await setup()
    await expect(
      repository.createFeedback({ ...CREATE_BODY, moduleCode: 'NO_SUCH_MODULE' }, AUTHOR),
    ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
    await expect(
      repository.createFeedback({ ...CREATE_BODY, typeCode: 'NO_SUCH_TYPE' as never }, AUTHOR),
    ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
  })

  it('пустая тема и пустое описание отклоняются', async () => {
    const { repository } = await setup()
    await expect(
      repository.createFeedback({ ...CREATE_BODY, subject: '   ' }, AUTHOR),
    ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
    await expect(
      repository.createFeedback({ ...CREATE_BODY, description: '' }, AUTHOR),
    ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
  })

  it('созданное обращение видно автору сразу из реестра', async () => {
    const { repository } = await setup()
    await repository.createFeedback(CREATE_BODY, AUTHOR)
    const response = await repository.listFeedback(AUTHOR)
    expect(response.results.map((r) => r.subject)).toEqual([CREATE_BODY.subject])
  })
})

describe('отправка черновика (§28 «Черновик» → «Новое»)', () => {
  async function withDraft() {
    return setup([
      request({
        feedbackId: 'fb-draft',
        statusCode: 'DRAFT',
        submittedAt: null,
        author: { userId: AUTHOR, safeLabel: AUTHOR },
      }),
      request({ feedbackId: 'fb-foreign-draft', statusCode: 'DRAFT', submittedAt: null }),
      request({ feedbackId: 'fb-sent' }),
    ])
  }

  it('свой черновик уходит в «Новое» и получает время отправки', async () => {
    const { repository, adapter } = await withDraft()
    const updated = await repository.submitFeedback('fb-draft', AUTHOR)
    expect(updated.statusCode).toBe('NEW')
    expect(updated.submittedAt).not.toBeNull()

    // Персистентность проверяется ИЗ ХРАНИЛИЩА, а не по возвращённому объекту.
    const envelope = await adapter.load()
    const stored = (envelope?.slices.feedback as { requests: FeedbackRequest[] }).requests
    expect(stored.find((r) => r.feedbackId === 'fb-draft')?.statusCode).toBe('NEW')
  })

  it('чужой черновик — 404, а не отказ по праву', async () => {
    const { repository } = await withDraft()
    await expect(
      repository.submitFeedback('fb-foreign-draft', AUTHOR),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError)
  })

  it('несуществующее обращение — тот же 404', async () => {
    const { repository } = await withDraft()
    await expect(repository.submitFeedback('fb-nope', AUTHOR)).rejects.toBeInstanceOf(
      RepositoryNotFoundError,
    )
  })

  it('ЧУЖОЕ видимое обращение — тоже 404, а не «уже отправлено»', async () => {
    // Обращение видно (право видеть все) и отправлено — то есть проверка
    // статуса отказала бы и сама. Но её отказ назвал бы состояние ЧУЖОЙ
    // записи, подтвердив, что она существует и уже отправлена. Владелец
    // отказа здесь один — «не твоё», и он отвечает 404.
    const { repository } = await setup([request({ feedbackId: 'fb-foreign-sent' })])
    await expect(repository.submitFeedback('fb-foreign-sent', SUPPORT)).rejects.toBeInstanceOf(
      RepositoryNotFoundError,
    )
  })

  it('повторная отправка уже отправленного обращения отклоняется правилом', async () => {
    const { repository } = await setup([
      request({ feedbackId: 'fb-sent', author: { userId: AUTHOR, safeLabel: AUTHOR } }),
    ])
    await expect(repository.submitFeedback('fb-sent', AUTHOR)).rejects.toBeInstanceOf(
      RepositoryBusinessRuleError,
    )
  })
})

describe('§35 — что раздел не делает', () => {
  it('причины приходят с сервера и называют каждую нереализованную возможность', async () => {
    const { repository } = await setup()
    const response = await repository.listFeedback(AUTHOR)
    const codes = response.unavailableCapabilities.map((item) => item.code)
    expect(codes).toContain('ATTACHMENT_CONTENT')
    expect(codes).toContain('WORKING_PRIORITY')
    expect(codes).toContain('TRIAGE_LIFECYCLE')
    for (const item of response.unavailableCapabilities) {
      expect(item.reason.length).toBeGreaterThan(40)
    }
  })
})
