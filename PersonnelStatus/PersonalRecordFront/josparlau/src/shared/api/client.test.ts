// Тесты транспорта и парсинга §36 (AC 1–6). Все ассерты ошибок — instanceof
// И kind-дискриминант И поля конверта (Ловушка 10: не constructor.name).
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import type { paths } from './schema'
import { createApiClient } from './client'
import {
  ApiError,
  BusinessRuleError,
  ConflictError,
  NetworkError,
  ServerError,
  ValidationError,
} from './errors'
import type { ErrorEnvelope } from './errors'
import {
  businessRuleEnvelope,
  conflictOverridableEnvelope,
  conflictStateEnvelope,
  employeesListFixture,
  serverEnvelope,
  validationEnvelope,
} from './testing/handlers'
import { server } from './testing/server'

// Ловушка 1: относительный URL в node не парсится — тестовому клиенту нужен
// абсолютный origin; MSW-предикаты '*/api/…' (см. handlers.ts) матчат любой origin.
const client = createApiClient({ baseUrl: 'http://localhost' })

async function expectRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    return err
  }
  throw new Error('ожидали reject, промис зарезолвился')
}

function envelope(
  error_code: string,
  message: string,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return {
    error_code,
    message,
    details,
    request_id: null,
    timestamp: '2026-07-07T12:00:00+05:00',
  }
}

type EmployeesPage =
  paths['/api/core/employees/']['get']['responses']['200']['content']['application/json']
type Employee = EmployeesPage['results'][number]

describe('apiClient транспорт (AC 1)', () => {
  it('200: типизированное тело как есть, snake_case без трансформаций (L429)', async () => {
    const page = await client.get<EmployeesPage>('/api/core/employees/')
    expect(page).toEqual(employeesListFixture)
    expect(page.results[0]).toHaveProperty('personnel_number', 'A-1024')
    expect(page.results[0]).toHaveProperty('rank_code', 'MAJOR')
    expect(page.results[0]).not.toHaveProperty('personnelNumber')
  })

  it('204: undefined без попытки .json()', async () => {
    await expect(
      client.del('/api/operations/user-roles/7/'),
    ).resolves.toBeUndefined()
  })
})

// Механика запроса (Task 3): сериализация, заголовки, каждый метод фабрики.
// Капчер — массив (не let-переменная): tsc сужает let к initializer и не видит
// присваивание в замыкании MSW-хендлера.
describe('apiClient механика запроса (Task 3)', () => {
  const employeeFixture: Employee = employeesListFixture.results[0]

  it('POST: тело сериализуется в JSON, Content-Type: application/json, 2xx-тело возвращается', async () => {
    const captured: Array<{ contentType: string | null; body: unknown }> = []
    server.use(
      http.post('*/api/core/employees/', async ({ request }) => {
        captured.push({
          contentType: request.headers.get('content-type'),
          body: await request.json(),
        })
        return HttpResponse.json(employeeFixture, { status: 201 })
      }),
    )
    const created = await client.post<Employee>('/api/core/employees/', {
      iin: '900101300123',
      last_name: 'Иванов',
    })
    expect(created).toEqual(employeeFixture)
    expect(captured).toEqual([
      {
        contentType: 'application/json',
        body: { iin: '900101300123', last_name: 'Иванов' },
      },
    ])
  })

  it('запрос без тела: Content-Type не выставляется', async () => {
    const captured: Array<string | null> = []
    server.use(
      http.get('*/api/core/employees/', ({ request }) => {
        captured.push(request.headers.get('content-type'))
        return HttpResponse.json(employeesListFixture)
      }),
    )
    await client.get<EmployeesPage>('/api/core/employees/')
    expect(captured).toEqual([null])
  })

  it('defaultHeaders прикладываются к запросу (Д6 — точка расширения 8.6)', async () => {
    const withHeaders = createApiClient({
      baseUrl: 'http://localhost',
      defaultHeaders: { 'X-User-Id': 'qa-8-4' },
    })
    const captured: Array<string | null> = []
    server.use(
      http.get('*/api/core/employees/', ({ request }) => {
        captured.push(request.headers.get('x-user-id'))
        return HttpResponse.json(employeesListFixture)
      }),
    )
    await withHeaders.get<EmployeesPage>('/api/core/employees/')
    expect(captured).toEqual(['qa-8-4'])
  })

  it('PATCH: метод и тело доходят до сервера, 200-тело возвращается типизированным', async () => {
    const captured: Array<unknown> = []
    server.use(
      http.patch('*/api/core/employees/:id/', async ({ request }) => {
        captured.push(await request.json())
        return HttpResponse.json(employeeFixture)
      }),
    )
    const updated = await client.patch<Employee>(
      `/api/core/employees/${employeeFixture.id}/`,
      { personnel_number: 'A-1024' },
    )
    expect(updated).toEqual(employeeFixture)
    expect(captured).toEqual([{ personnel_number: 'A-1024' }])
  })
})

describe('DomainError-парсинг конверта §36 (AC 2–6)', () => {
  it('400 → ValidationError с полями конверта (AC 2)', async () => {
    const err = await expectRejection(
      client.post('/api/core/employees/', { iin: '' }),
    )
    expect(err).toBeInstanceOf(ValidationError)
    expect(err).toBeInstanceOf(ApiError)
    const e = err as ValidationError
    expect(e.kind).toBe('validation')
    expect(e.status).toBe(400)
    expect(e.errorCode).toBe('VALIDATION_ERROR')
    expect(e.message).toBe(validationEnvelope.message)
    expect(e.details).toEqual(validationEnvelope.details)
    expect(e.requestId).toBeNull()
  })

  it('422 → BusinessRuleError, НЕ ValidationError (AC 3, Д2)', async () => {
    const err = await expectRejection(
      client.post('/api/operations/daily-submissions/', {
        business_date: '2026-07-01',
      }),
    )
    expect(err).toBeInstanceOf(BusinessRuleError)
    expect(err).not.toBeInstanceOf(ValidationError)
    const e = err as BusinessRuleError
    expect(e.kind).toBe('business_rule')
    expect(e.status).toBe(422)
    expect(e.errorCode).toBe('BUSINESS_DATE_OUT_OF_WINDOW')
    expect(e.details).toEqual(businessRuleEnvelope.details)
    expect(e.requestId).toBe('req-8-4-test')
  })

  it('409 overridable-код → ConflictError overridable=true + details.conflicts (AC 4)', async () => {
    const err = await expectRejection(
      client.post('/api/operations/temporary-duty/', {}),
    )
    expect(err).toBeInstanceOf(ConflictError)
    const e = err as ConflictError
    expect(e.kind).toBe('conflict')
    expect(e.status).toBe(409)
    expect(e.errorCode).toBe('STATUS_OVERLAP_WARNING')
    expect(e.overridable).toBe(true)
    expect(e.details).toEqual(conflictOverridableEnvelope.details)
    expect(e.details.conflicts).toBeDefined()
  })

  it('409 не-overridable код → ConflictError overridable=false (AC 4)', async () => {
    const err = await expectRejection(
      client.post('/api/operations/daily-submissions/42/amend/', {}),
    )
    expect(err).toBeInstanceOf(ConflictError)
    const e = err as ConflictError
    expect(e.kind).toBe('conflict')
    expect(e.errorCode).toBe('DAY_ALREADY_SUBMITTED')
    expect(e.overridable).toBe(false)
    expect(e.details).toEqual(conflictStateEnvelope.details)
  })

  it('500 с конвертом → ServerError (AC 5)', async () => {
    const err = await expectRejection(client.get('/api/audit/logs/'))
    expect(err).toBeInstanceOf(ServerError)
    const e = err as ServerError
    expect(e.kind).toBe('server')
    expect(e.status).toBe(500)
    expect(e.errorCode).toBe('INTERNAL_ERROR')
    expect(e.message).toBe(serverEnvelope.message)
  })

  it('502 text/html без конверта → ServerError без вторичного исключения (AC 5)', async () => {
    const err = await expectRejection(client.get('/api/notifications/'))
    expect(err).toBeInstanceOf(ServerError)
    const e = err as ServerError
    expect(e.kind).toBe('server')
    expect(e.status).toBe(502)
    expect(e.errorCode).toBeNull()
    expect(e.details).toEqual({})
  })

  it('сетевой обрыв → NetworkError вне ApiError-иерархии (AC 5, Д7)', async () => {
    const err = await expectRejection(client.get('/api/core/divisions/'))
    expect(err).toBeInstanceOf(NetworkError)
    expect(err).not.toBeInstanceOf(ApiError)
    const e = err as NetworkError
    expect(e.kind).toBe('network')
    // диагностика: метод+путь в message, исходный сбой fetch — в cause
    expect(e.message).toContain('GET /api/core/divisions/')
    expect(e.cause).toBeInstanceOf(TypeError)
  })

  // Ловушка 3 («конверт ≠ гарантия») для спец-статусов: без конверта деградация
  // идёт в базовый ApiError ДО switch по статусу — сабкласс не выбирается
  it.each([400, 409, 422])(
    '%i без конверта (text/plain) → базовый ApiError, не сабкласс (AC 6)',
    async (status) => {
      server.use(
        http.get(
          '*/api/operations/my-permissions/',
          () =>
            new HttpResponse('Ошибка без конверта', {
              status,
              headers: { 'Content-Type': 'text/plain' },
            }),
        ),
      )
      const err = await expectRejection(
        client.get('/api/operations/my-permissions/'),
      )
      expect(err).toBeInstanceOf(ApiError)
      expect(err).not.toBeInstanceOf(ValidationError)
      expect(err).not.toBeInstanceOf(ConflictError)
      expect(err).not.toBeInstanceOf(BusinessRuleError)
      const e = err as ApiError
      expect(e.kind).toBe('api')
      expect(e.status).toBe(status)
      expect(e.errorCode).toBeNull()
      expect(e.details).toEqual({})
    },
  )

  it.each([
    ['401', 'AUTH_REQUIRED', 'Отсутствуют учётные данные.'],
    ['403', 'PERMISSION_DENIED', 'Нет права на действие.'],
    ['404', 'ENTITY_NOT_FOUND', 'Ресурс не найден.'],
  ])(
    '%s с конвертом → базовый ApiError, не сабкласс (AC 6)',
    async (status, code, message) => {
      server.use(
        http.get('*/api/operations/my-permissions/', () =>
          HttpResponse.json(envelope(code, message), {
            status: Number(status),
          }),
        ),
      )
      const err = await expectRejection(
        client.get('/api/operations/my-permissions/'),
      )
      expect(err).toBeInstanceOf(ApiError)
      const e = err as ApiError
      expect(e.kind).toBe('api') // базовый класс, не сабкласс
      expect(e.status).toBe(Number(status))
      expect(e.errorCode).toBe(code)
      expect(e.message).toBe(message)
    },
  )

  it('405 DRF-native без конверта → базовый ApiError, errorCode null, message из статуса (AC 6)', async () => {
    server.use(
      http.get('*/api/core/staffing-slots/', () =>
        HttpResponse.json(
          { detail: 'Method "GET" not allowed.' },
          { status: 405, statusText: 'Method Not Allowed' },
        ),
      ),
    )
    const err = await expectRejection(client.get('/api/core/staffing-slots/'))
    expect(err).toBeInstanceOf(ApiError)
    const e = err as ApiError
    expect(e.kind).toBe('api')
    expect(e.status).toBe(405)
    expect(e.errorCode).toBeNull()
    expect(e.message).toBe('HTTP 405 Method Not Allowed')
    expect(e.details).toEqual({})
  })
})

// ── Бинарный канал getBlob (стори 10.5, AC-7) ───────────────────────────────
// Первый бинарный путь в проекте: `get` безусловно делает response.json()
// (client.ts:57) и на .docx упал бы SyntaxError'ом вместо файла.
describe('getBlob: бинарное тело мимо response.json() (10.5 AC-7)', () => {
  const DOWNLOAD_PATH = '/api/documents/attachments/abc/download/'

  it('200 → blob с телом и имя файла из Content-Disposition filename* (UTF-8)', async () => {
    server.use(
      http.get(
        `*${DOWNLOAD_PATH}`,
        () =>
          // Кириллица на проводе приезжает percent-encoded — ровно так её
          // ставит content_disposition_header(True, attachment.original_name).
          new HttpResponse(new Blob(['PKdocx-bytes']), {
            status: 200,
            headers: {
              'Content-Disposition':
                "attachment; filename=\"expense.docx\"; filename*=UTF-8''%D1%80%D0%B0%D1%81%D1%85%D0%BE%D0%B4_2026-07-19.docx",
            },
          }),
      ),
    )
    const result = await client.getBlob(DOWNLOAD_PATH)
    expect(result.blob).toBeInstanceOf(Blob)
    expect(await result.blob.text()).toBe('PKdocx-bytes')
    // decodeURIComponent обязателен: без него файл сохранится с процентами
    expect(result.filename).toBe('расход_2026-07-19.docx')
  })

  it('Content-Disposition без filename* → null (фолбэк строит фича, не транспорт)', async () => {
    server.use(
      http.get(
        `*${DOWNLOAD_PATH}`,
        () =>
          new HttpResponse(new Blob(['x']), {
            status: 200,
            headers: { 'Content-Disposition': 'attachment' },
          }),
      ),
    )
    expect((await client.getBlob(DOWNLOAD_PATH)).filename).toBeNull()
  })

  it('заголовка Content-Disposition нет вовсе → null, а не исключение', async () => {
    server.use(
      http.get(`*${DOWNLOAD_PATH}`, () => new HttpResponse(new Blob(['x']))),
    )
    expect((await client.getBlob(DOWNLOAD_PATH)).filename).toBeNull()
  })

  it('403 → типизированный ApiError через parseErrorResponse, НЕ пустой блоб', async () => {
    // Живой разрыв прав: роль OMD имеет daily_report.generate, но не
    // document.view (seed_operations.py:51-55) — 403 обязан приехать ошибкой.
    server.use(
      http.get(`*${DOWNLOAD_PATH}`, () =>
        HttpResponse.json(envelope('PERMISSION_DENIED', 'Недостаточно прав.'), {
          status: 403,
        }),
      ),
    )
    const err = await expectRejection(client.getBlob(DOWNLOAD_PATH))
    expect(err).toBeInstanceOf(ApiError)
    const e = err as ApiError
    expect(e.status).toBe(403)
    expect(e.errorCode).toBe('PERMISSION_DENIED')
  })

  it('обрыв сети → NetworkError (вне иерархии ApiError)', async () => {
    server.use(http.get(`*${DOWNLOAD_PATH}`, () => HttpResponse.error()))
    const err = await expectRejection(client.getBlob(DOWNLOAD_PATH))
    expect(err).toBeInstanceOf(NetworkError)
    expect(err).not.toBeInstanceOf(ApiError)
  })

  it('шлёт мутабельные defaultHeaders: X-User-Id подхватывается на КАЖДЫЙ запрос', async () => {
    // Голый <a href> этих заголовков не несёт и дал бы 403 — поэтому канал
    // обязан идти через тот же спред {...defaultHeaders}, что и `get`.
    const headers: Record<string, string> = {}
    const authed = createApiClient({
      baseUrl: 'http://localhost',
      defaultHeaders: headers,
    })
    let seen: string | null = 'not-called'
    server.use(
      http.get(`*${DOWNLOAD_PATH}`, ({ request }) => {
        seen = request.headers.get('X-User-Id')
        return new HttpResponse(new Blob(['x']))
      }),
    )
    // Заголовок появляется ПОСЛЕ создания клиента — как это делает credential.ts
    headers['X-User-Id'] = 'user-42'
    await authed.getBlob(DOWNLOAD_PATH)
    expect(seen).toBe('user-42')
  })
})
