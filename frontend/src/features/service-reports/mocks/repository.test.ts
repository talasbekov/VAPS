// Repository отчётного реестра: асинхронная работа (§22.21), immutable
// артефакт (§22.22), скачивание с повторной проверкой (§22.23), server-side
// masking (§22.24).
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import {
  createServiceReportsRepository,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'
import { REPORT_TYPES, RETENTION_POLICY } from './fixtures'

const OPERATOR = 'operator-user'
const SENSITIVE_OPERATOR = 'sensitive-user'
const NOBODY = 'nobody-user'

const NOTE = 'Личное обстоятельство сотрудника'
const OVERRIDE = 'Некем заменить, приказ №5'
const PERIOD = { from: '2026-07-01', to: '2026-07-31' }

function seedEnvelope(): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 20,
    seed_version: 'test-v20',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: {
      serviceReports: {
        jobs: [],
        artifacts: [],
        reportTypes: [...REPORT_TYPES],
        retentionPolicy: { ...RETENTION_POLICY },
      },
      duties: {
        shifts: [
          {
            id: 'duty-1',
            businessDate: '2026-07-20',
            employeeName: 'Ерланов Д.',
            stateCode: 'PLANNED',
            note: NOTE,
            overrideReason: OVERRIDE,
            target: { safeLabel: 'Дворец Независимости' },
            passportBinding: { sectorName: 'Сектор A', postName: 'КПП-1' },
          },
          {
            id: 'duty-2',
            businessDate: '2026-08-05',
            employeeName: 'Абишев Н.',
            stateCode: 'PLANNED',
            note: null,
            overrideReason: null,
            target: { safeLabel: 'Дворец Независимости' },
            passportBinding: null,
          },
        ],
      },
    },
  }
}

async function setup() {
  const adapter = createMemoryPersistence()
  await adapter.reset(seedEnvelope())
  const clock = new DemoClock('2026-07-20T08:00:00+05:00')
  return { repository: createServiceReportsRepository(adapter, clock), adapter, clock }
}

/** Доводит работу до COMPLETED через опросы реестра — ровно так, как это
 * делает экран (§22.21: состояние продвигает сервер). */
async function runToCompletion(
  repository: ReturnType<typeof createServiceReportsRepository>,
  actor = OPERATOR,
) {
  let response = await repository.listReportJobs(actor)
  for (let step = 0; step < 5; step += 1) {
    if (response.results[0]?.state === 'COMPLETED') break
    response = await repository.listReportJobs(actor)
  }
  return response
}

beforeEach(() => {
  registerRbacDirectory([
    { userId: OPERATOR, permissions: ['ops.report.generate'] },
    {
      userId: SENSITIVE_OPERATOR,
      permissions: ['ops.report.generate', 'ops.report.export_sensitive'],
    },
    { userId: NOBODY, permissions: [] },
  ])
})

const BASE_REQUEST = {
  reportTypeCode: 'PERSONNEL_EXPENSE',
  format: 'CSV' as const,
  from: PERIOD.from,
  to: PERIOD.to,
  sensitive: false,
  idempotencyKey: 'key-1',
}

describe('права (§22.26/§20.32)', () => {
  it('без права запуска отчёта закрыты и типы, и реестр, и создание', async () => {
    const { repository } = await setup()
    await expect(repository.listReportTypes(NOBODY)).rejects.toThrow(RepositoryPermissionError)
    await expect(repository.listReportJobs(NOBODY)).rejects.toThrow(RepositoryPermissionError)
    await expect(repository.createReportJob(BASE_REQUEST, NOBODY)).rejects.toThrow(
      RepositoryPermissionError,
    )
  })

  it('право запускать отчёт НЕ даёт права на sensitive export', async () => {
    const { repository } = await setup()
    await expect(
      repository.createReportJob({ ...BASE_REQUEST, sensitive: true }, OPERATOR),
    ).rejects.toThrow(RepositoryPermissionError)
    await expect(
      repository.createReportJob({ ...BASE_REQUEST, sensitive: true }, SENSITIVE_OPERATOR),
    ).resolves.toMatchObject({ sensitive: true })
  })

  it('отсутствие sensitive-права не подменяется ошибкой периода', async () => {
    const { repository } = await setup()
    // Период заведомо неверный И права нет: пользователь обязан узнать про
    // право, а не пойти чинить период.
    await expect(
      repository.createReportJob(
        { ...BASE_REQUEST, sensitive: true, from: '2026-07-31', to: '2026-07-01' },
        OPERATOR,
      ),
    ).rejects.toThrow(RepositoryPermissionError)
  })

  it('доступность sensitive export приходит В ОТВЕТЕ и зависит от актора', async () => {
    const { repository } = await setup()
    expect((await repository.listReportTypes(OPERATOR)).canExportSensitive).toBe(false)
    expect((await repository.listReportTypes(SENSITIVE_OPERATOR)).canExportSensitive).toBe(true)
  })
})

describe('параметры отчёта (§22.19)', () => {
  it('период вне формата и перевёрнутый период отклоняются', async () => {
    const { repository } = await setup()
    await expect(
      repository.createReportJob({ ...BASE_REQUEST, from: '20.07.2026' }, OPERATOR),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PERIOD' })
    await expect(
      repository.createReportJob({ ...BASE_REQUEST, from: '2026-07-31', to: '2026-07-01' }, OPERATOR),
    ).rejects.toMatchObject({ errorCode: 'INVALID_PERIOD' })
  })

  it('глубина периода ограничена ПОЛИТИКОЙ отчёта, а не числом в коде', async () => {
    const { repository } = await setup()
    const limit = REPORT_TYPES[0].maxPeriodDays
    // Ровно предел — проходит; предел + 1 день — нет.
    const atLimit = new Date(Date.UTC(2026, 6, 1) + (limit - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const overLimit = new Date(Date.UTC(2026, 6, 1) + limit * 86_400_000)
      .toISOString()
      .slice(0, 10)
    await expect(
      repository.createReportJob({ ...BASE_REQUEST, from: '2026-07-01', to: atLimit }, OPERATOR),
    ).resolves.toMatchObject({ state: 'PENDING' })
    await expect(
      repository.createReportJob(
        { ...BASE_REQUEST, from: '2026-07-01', to: overLimit, idempotencyKey: 'key-2' },
        OPERATOR,
      ),
    ).rejects.toMatchObject({ errorCode: 'PERIOD_TOO_LONG' })
  })

  it('неизвестный тип и неподдерживаемый формат отклоняются по-разному', async () => {
    const { repository } = await setup()
    await expect(
      repository.createReportJob({ ...BASE_REQUEST, reportTypeCode: 'GHOST' }, OPERATOR),
    ).rejects.toMatchObject({ errorCode: 'UNKNOWN_REPORT_TYPE' })
    await expect(
      repository.createReportJob(
        { ...BASE_REQUEST, format: 'XLSX' as unknown as 'CSV' },
        OPERATOR,
      ),
    ).rejects.toMatchObject({ errorCode: 'UNSUPPORTED_FORMAT' })
  })
})

describe('асинхронная работа (§22.21)', () => {
  it('работа создаётся В ОЖИДАНИИ: ни артефакта, ни прогресса', async () => {
    const { repository } = await setup()
    const job = await repository.createReportJob(BASE_REQUEST, OPERATOR)
    expect(job).toMatchObject({ state: 'PENDING', artifactId: null, progressPercent: null })
    // Success до COMPLETED показывать нечего — артефакта нет и в реестре.
    expect((await repository.listReportJobs(OPERATOR)).artifacts).toHaveLength(0)
  })

  it('состояния идут PENDING → PROCESSING → COMPLETED и артефакт приходит вместе с COMPLETED', async () => {
    const { repository } = await setup()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    const states: string[] = []
    for (let step = 0; step < 3; step += 1) {
      states.push((await repository.listReportJobs(OPERATOR)).results[0].state)
    }
    expect(states).toEqual(['PROCESSING', 'COMPLETED', 'COMPLETED'])

    const final = await repository.listReportJobs(OPERATOR)
    expect(final.results[0].artifactId).not.toBeNull()
    expect(final.artifacts).toHaveLength(1)
  })

  it('идемпотентность: тот же ключ не создаёт вторую работу', async () => {
    const { repository } = await setup()
    const first = await repository.createReportJob(BASE_REQUEST, OPERATOR)
    const second = await repository.createReportJob(BASE_REQUEST, OPERATOR)
    expect(second.reportJobId).toBe(first.reportJobId)
    expect((await repository.listReportJobs(OPERATOR)).results).toHaveLength(1)
  })

  it('другой ключ создаёт вторую работу — осознанный повтор возможен', async () => {
    const { repository } = await setup()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    await repository.createReportJob({ ...BASE_REQUEST, idempotencyKey: 'key-2' }, OPERATOR)
    expect((await repository.listReportJobs(OPERATOR)).results).toHaveLength(2)
  })

  it('завершённая работа не пересчитывается опросом: артефакт immutable (§22.22)', async () => {
    const { repository } = await setup()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    const completed = await runToCompletion(repository)
    const first = completed.artifacts[0]
    const again = await repository.listReportJobs(OPERATOR)
    expect(again.artifacts).toHaveLength(1)
    expect(again.artifacts[0]).toEqual(first)
  })
})

describe('маскирование и безопасная проекция (§22.24)', () => {
  it('в реестре НЕТ содержимого артефакта и ссылки на файл', async () => {
    const { repository } = await setup()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    const response = await runToCompletion(repository)
    const payload = JSON.stringify(response)
    expect(payload).not.toContain('Ерланов Д.')
    expect(payload).not.toContain('content')
    expect(payload).not.toContain('http')
    // Метаданные при этом на месте — проекция безопасная, а не пустая.
    expect(response.artifacts[0]).toMatchObject({ fileSize: expect.any(Number), available: true })
  })

  it('обычный экспорт не содержит скрытых полей, sensitive — содержит', async () => {
    const { repository } = await setup()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    await runToCompletion(repository)
    const plain = await repository.downloadArtifact('artifact-report-job-1-1', OPERATOR)
    expect(plain.content).toContain('Ерланов Д.')
    expect(plain.content).not.toContain(NOTE)
    expect(plain.content).not.toContain(OVERRIDE)

    await repository.createReportJob(
      { ...BASE_REQUEST, sensitive: true, idempotencyKey: 'key-2' },
      SENSITIVE_OPERATOR,
    )
    await runToCompletion(repository, SENSITIVE_OPERATOR)
    const jobs = await repository.listReportJobs(SENSITIVE_OPERATOR)
    const sensitiveArtifact = jobs.artifacts.find((artifact) => artifact.sensitive)
    const sensitiveFile = await repository.downloadArtifact(
      sensitiveArtifact?.artifactId ?? '',
      SENSITIVE_OPERATOR,
    )
    expect(sensitiveFile.content).toContain(NOTE)
    expect(sensitiveFile.content).toContain(OVERRIDE)
  })

  it('отчёт берёт только строки периода — соседний месяц не попадает', async () => {
    const { repository } = await setup()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    await runToCompletion(repository)
    const file = await repository.downloadArtifact('artifact-report-job-1-1', OPERATOR)
    expect(file.content).toContain('2026-07-20')
    expect(file.content).not.toContain('2026-08-05')
    expect(file.content).not.toContain('Абишев Н.')
  })

  it('генерация НИЧЕГО не меняет в чужом слайсе дежурств', async () => {
    const { repository, adapter } = await setup()
    const before = JSON.stringify((await adapter.load())?.slices.duties)
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    await runToCompletion(repository)
    expect(JSON.stringify((await adapter.load())?.slices.duties)).toBe(before)
  })
})

describe('скачивание (§22.23)', () => {
  it('повторно проверяет право: без права запуска файл не отдаётся', async () => {
    const { repository } = await setup()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    await runToCompletion(repository)
    await expect(
      repository.downloadArtifact('artifact-report-job-1-1', NOBODY),
    ).rejects.toThrow(RepositoryPermissionError)
  })

  it('sensitive-артефакт требует sensitive-права ПОВТОРНО, на скачивании', async () => {
    const { repository } = await setup()
    await repository.createReportJob(
      { ...BASE_REQUEST, sensitive: true },
      SENSITIVE_OPERATOR,
    )
    await runToCompletion(repository, SENSITIVE_OPERATOR)
    // Право могли отозвать после генерации — артефакт при этом остался.
    await expect(
      repository.downloadArtifact('artifact-report-job-1-1', OPERATOR),
    ).rejects.toThrow(RepositoryPermissionError)
  })

  it('истёкший артефакт не отдаётся, причина названа кодом', async () => {
    const { repository, clock } = await setup()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    await runToCompletion(repository)
    clock.advanceMs((RETENTION_POLICY.retentionDays + 1) * 86_400_000)
    await expect(
      repository.downloadArtifact('artifact-report-job-1-1', OPERATOR),
    ).rejects.toMatchObject({ errorCode: 'ARTIFACT_EXPIRED' })
    // И в реестре он помечен недоступным с причиной, а не исчез.
    const response = await repository.listReportJobs(OPERATOR)
    expect(response.artifacts[0]).toMatchObject({ available: false, unavailableReason: 'EXPIRED' })
  })

  it('несуществующий артефакт — 404', async () => {
    const { repository } = await setup()
    await expect(repository.downloadArtifact('artifact-ghost', OPERATOR)).rejects.toThrow(
      RepositoryNotFoundError,
    )
  })
})

describe('видимость истории (§22.25)', () => {
  it('работа со скрытыми полями невидима без права на sensitive export', async () => {
    const { repository } = await setup()
    await repository.createReportJob(
      { ...BASE_REQUEST, sensitive: true, idempotencyKey: 'sensitive-1' },
      SENSITIVE_OPERATOR,
    )
    await runToCompletion(repository, SENSITIVE_OPERATOR)

    const owner = await repository.listReportJobs(SENSITIVE_OPERATOR)
    expect(owner.results).toHaveLength(1)
    expect(owner.artifacts).toHaveLength(1)

    // У соседа без права её нет ВООБЩЕ: ни строки, ни артефакта, ни следа в
    // счётчике — параметры и автор сами говорят, кого выгружали целиком.
    const other = await repository.listReportJobs(OPERATOR)
    expect(other.results).toHaveLength(0)
    expect(other.artifacts).toHaveLength(0)
    expect(other.totalVisible).toBe(0)
  })

  it('повтор чужой невидимой работы отвечает «не найдено», а не «нет прав»', async () => {
    const { repository } = await setup()
    const hidden = await repository.createReportJob(
      { ...BASE_REQUEST, sensitive: true, idempotencyKey: 'sensitive-2' },
      SENSITIVE_OPERATOR,
    )
    await expect(
      repository.rerunReportJob(hidden.reportJobId, 'RETRY', OPERATOR),
    ).rejects.toThrow(RepositoryNotFoundError)
  })

  it('фильтр не останавливает продвижение скрытых им работ', async () => {
    const { repository } = await setup()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    // Читаем реестр ТОЛЬКО через фильтр, под который работа не попадает: если
    // ступень выполнялась бы лишь для показанных строк, она застряла бы в
    // очереди навсегда.
    for (let step = 0; step < 4; step += 1) {
      await repository.listReportJobs(OPERATOR, { state: 'FAILED' })
    }
    const all = await repository.listReportJobs(OPERATOR)
    expect(all.results[0].state).toBe('COMPLETED')
  })

  it('фильтры по состоянию и по автору применяет сервер', async () => {
    const { repository } = await setup()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    await runToCompletion(repository)

    expect((await repository.listReportJobs(OPERATOR, { state: 'COMPLETED' })).results).toHaveLength(1)
    expect((await repository.listReportJobs(OPERATOR, { state: 'PENDING' })).results).toHaveLength(0)
    expect((await repository.listReportJobs(OPERATOR, { mine: true })).results).toHaveLength(1)
    // Чужой смотрит ту же работу: она видима (не sensitive), но не «его».
    const foreign = await repository.listReportJobs(SENSITIVE_OPERATOR, { mine: true })
    expect(foreign.results).toHaveLength(0)
    // …и «ничего не нашлось» отличимо от «ничего не запускали».
    expect(foreign.totalVisible).toBe(1)
  })

  it('артефакты отфильтрованных работ тоже не приезжают', async () => {
    const { repository } = await setup()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    await runToCompletion(repository)
    const filtered = await repository.listReportJobs(OPERATOR, { state: 'PENDING' })
    expect(filtered.artifacts).toHaveLength(0)
  })
})

describe('повтор и новая редакция (§22.25)', () => {
  async function completedJob(repository: ReturnType<typeof createServiceReportsRepository>) {
    const job = await repository.createReportJob(BASE_REQUEST, OPERATOR)
    await runToCompletion(repository)
    return job
  }

  it('повтор при пригодном артефакте не создаёт работу, а отдаёт готовый', async () => {
    const { repository } = await setup()
    const job = await completedJob(repository)
    const result = await repository.rerunReportJob(job.reportJobId, 'RETRY', OPERATOR)
    expect(result).toMatchObject({ reused: true, artifactId: `artifact-${job.reportJobId}` })
    expect((await repository.listReportJobs(OPERATOR)).results).toHaveLength(1)
  })

  it('новая редакция собирается ВСЕГДА и получает следующий номер', async () => {
    const { repository } = await setup()
    const job = await completedJob(repository)
    const result = await repository.rerunReportJob(job.reportJobId, 'NEW_REVISION', OPERATOR)
    expect(result.reused).toBe(false)
    const response = await runToCompletion(repository)
    expect(response.results).toHaveLength(2)
    const revisions = response.artifacts.map((artifact) => artifact.revision).sort()
    expect(revisions).toEqual([1, 2])
    // Повтор ПОСЛЕ новой редакции отдаёт именно свежую.
    const retried = await repository.rerunReportJob(job.reportJobId, 'RETRY', OPERATOR)
    expect(retried.artifactId).toBe(`artifact-${result.reportJobId}`)
  })

  it('повтор истёкшего артефакта собирает заново', async () => {
    const { repository, clock } = await setup()
    const job = await completedJob(repository)
    clock.set('2026-09-20T08:00:00+05:00')
    const result = await repository.rerunReportJob(job.reportJobId, 'RETRY', OPERATOR)
    expect(result).toMatchObject({ reused: false, artifactId: null })
  })

  it('незавершённая работа не повторяется и не даёт редакции', async () => {
    const { repository } = await setup()
    const job = await repository.createReportJob(BASE_REQUEST, OPERATOR)
    await expect(
      repository.rerunReportJob(job.reportJobId, 'RETRY', OPERATOR),
    ).rejects.toMatchObject({ errorCode: 'JOB_NOT_FINISHED' })
    await expect(
      repository.rerunReportJob(job.reportJobId, 'NEW_REVISION', OPERATOR),
    ).rejects.toMatchObject({ errorCode: 'NO_BASE_REVISION' })
  })

  it('автор повтора — тот, кто повторил, а не автор исходной работы', async () => {
    const { repository } = await setup()
    const job = await completedJob(repository)
    await repository.rerunReportJob(job.reportJobId, 'NEW_REVISION', SENSITIVE_OPERATOR)
    const response = await repository.listReportJobs(SENSITIVE_OPERATOR)
    const rerun = response.results.find((entry) => entry.reportJobId !== job.reportJobId)
    expect(rerun?.createdBy.userId).toBe(SENSITIVE_OPERATOR)
    // Ключ идемпотентности новый: старый вернул бы исходную работу.
    expect(rerun?.idempotencyKey).not.toBe(job.idempotencyKey)
  })
})

describe('сбой сборки (§22.21)', () => {
  /**
   * Снимок, в котором смена не той формы, что ждёт проекция отчёта. Это ровно
   * тот риск, о котором предупреждает `dutiesSlice.ts`: узкая рукописная
   * проекция чужого слайса протухает при его изменении. ОТСУТСТВИЕ слайса
   * сбоем НЕ является — там отчёт честно выходит пустым.
   */
  async function setupWithBrokenSource() {
    const adapter = createMemoryPersistence()
    const envelope = seedEnvelope()
    ;(envelope.slices as Record<string, unknown>).duties = { shifts: [null] }
    await adapter.reset(envelope)
    const clock = new DemoClock('2026-07-20T08:00:00+05:00')
    return { repository: createServiceReportsRepository(adapter, clock) }
  }

  it('работа падает СОСТОЯНИЕМ, а не исключением, и реестр остаётся читаемым', async () => {
    const { repository } = await setupWithBrokenSource()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    const response = await runToCompletion(repository)
    const failed = response.results[0]
    expect(failed.state).toBe('FAILED')
    expect(failed.failureCode).toBe('ASSEMBLY_FAILED')
    expect(failed.completedAt).not.toBeNull()
    expect(response.artifacts).toHaveLength(0)
  })

  it('сообщение о сбое безопасное: ни имени слайса, ни текста исключения', async () => {
    const { repository } = await setupWithBrokenSource()
    await repository.createReportJob(BASE_REQUEST, OPERATOR)
    const message = (await runToCompletion(repository)).results[0].safeFailureMessage ?? ''
    expect(message).not.toBe('')
    expect(message).not.toMatch(/duties|слайс|mock-runtime|compose-seed/i)
  })

  it('упавшая работа даёт ошибку и повтор, но не файл и не редакцию', async () => {
    const { repository } = await setupWithBrokenSource()
    const job = await repository.createReportJob(BASE_REQUEST, OPERATOR)
    const response = await runToCompletion(repository)
    const actions = Object.fromEntries(
      (response.actions[0]?.actions ?? []).map((action) => [action.code, action.available]),
    )
    expect(actions).toMatchObject({ VIEW_ERROR: true, RETRY: true, DOWNLOAD: false, NEW_REVISION: false })
    // Повтор упавшей работы разрешён и создаёт новую (готового артефакта нет).
    await expect(
      repository.rerunReportJob(job.reportJobId, 'RETRY', OPERATOR),
    ).resolves.toMatchObject({ reused: false })
  })
})
