// MSW-фикстуры протокола §36 (расположение — канон L440). 2xx-фикстуры
// типизированы paths-типами schema.d.ts: мок, противоречащий схеме, не
// компилируется (tsc = contract-тест, L258/L634). Конверт ошибок
// эндпоинт-агностичен, а статусных эндпоинтов в схеме ещё нет (bulk 3.8 не в
// роутинге) — поэтому 409-overridable фикстура протокольная, на существующем
// пути (Д8). Пути и методы — реальные из schema.d.ts; префикс '*' в предикатах —
// origin-агностичность: в node (без location) относительный '/api/…' НЕ матчится
// против абсолютного URL запроса (уточнение Ловушки 1).
import { http, HttpResponse } from 'msw'
import type { paths } from '../schema'
import type { ErrorEnvelope } from '../errors'

type EmployeesListResponse =
  paths['/api/core/employees/']['get']['responses']['200']['content']['application/json']

type MyPermissionsResponse =
  paths['/api/operations/my-permissions/']['get']['responses']['200']['content']['application/json']

const TIMESTAMP = '2026-07-07T12:00:00+05:00'

// Права оператора (коды — из seed_operations.py, 8.6)
export const myPermissionsFixture: MyPermissionsResponse = {
  permissions: ['daily_report.mark_update', 'status.view'],
}

// Wildcard `*` = ADMIN (PermissionService.has_permission)
export const adminPermissionsFixture: MyPermissionsResponse = {
  permissions: ['*'],
}

export const employeesListFixture: EmployeesListResponse = {
  count: 1,
  next: null,
  previous: null,
  results: [
    {
      id: '3f6f0c2e-9b1a-4d7c-8e2f-5a6b7c8d9e0f',
      iin: '900101300123',
      full_name: 'Иванов Иван Иванович',
      last_name: 'Иванов',
      first_name: 'Иван',
      middle_name: 'Иванович',
      rank_code: 'MAJOR',
      rank_index: 10,
      position_code: 'ENGINEER',
      division: '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
      personnel_number: 'A-1024',
      employment_status: 'WORKING',
    },
  ],
}

export const validationEnvelope: ErrorEnvelope = {
  error_code: 'VALIDATION_ERROR',
  message: 'Проверьте заполнение формы.',
  details: { iin: ['Обязательное поле.'], rank_code: ['Неизвестное звание.'] },
  request_id: null,
  timestamp: TIMESTAMP,
}

export const businessRuleEnvelope: ErrorEnvelope = {
  error_code: 'BUSINESS_DATE_OUT_OF_WINDOW',
  message: 'business_date вне окна первичной сдачи.',
  details: { business_date: '2026-07-01' },
  request_id: 'req-8-4-test',
  timestamp: TIMESTAMP,
}

export const conflictOverridableEnvelope: ErrorEnvelope = {
  error_code: 'STATUS_OVERLAP_WARNING',
  message: 'Ручной статус пересекает soft-статус.',
  details: {
    conflicts: [
      {
        conflict_code: 'UNAVAILABLE_STATUS_CONFLICT',
        employee_id: '3f6f0c2e-9b1a-4d7c-8e2f-5a6b7c8d9e0f',
      },
    ],
  },
  request_id: null,
  timestamp: TIMESTAMP,
}

export const conflictStateEnvelope: ErrorEnvelope = {
  error_code: 'DAY_ALREADY_SUBMITTED',
  message: 'Подразделение уже сдало этот день.',
  details: {},
  request_id: null,
  timestamp: TIMESTAMP,
}

// 401 всегда AUTH_REQUIRED (exception_handler L43-48: TOKEN_INVALID не эмитится)
export const authRequiredEnvelope: ErrorEnvelope = {
  error_code: 'AUTH_REQUIRED',
  message: 'Требуется аутентификация.',
  details: {},
  request_id: null,
  timestamp: TIMESTAMP,
}

// 403: право не выдано ЛИБО запрос вовсе без credential (Ловушка 1: на проводе
// отсутствие credential даёт 403, а не 401)
export const permissionDeniedEnvelope: ErrorEnvelope = {
  error_code: 'PERMISSION_DENIED',
  message: 'Недостаточно прав.',
  details: {},
  request_id: null,
  timestamp: TIMESTAMP,
}

export const serverEnvelope: ErrorEnvelope = {
  error_code: 'INTERNAL_ERROR',
  message: 'Внутренняя ошибка сервера.',
  details: {},
  request_id: null,
  timestamp: TIMESTAMP,
}

export const badGatewayHtml =
  '<html><body><h1>502 Bad Gateway</h1><hr>nginx</body></html>'

export const handlers = [
  // 200: типизированное тело как есть (snake_case, L429)
  http.get('*/api/core/employees/', () =>
    HttpResponse.json(employeesListFixture),
  ),
  // 200: права текущего пользователя (8.6); вариант ['*'] — server.use в тестах
  http.get('*/api/operations/my-permissions/', () =>
    HttpResponse.json(myPermissionsFixture),
  ),
  // 204: реальный 204-ответ схемы (operations_user_roles_destroy)
  http.delete(
    '*/api/operations/user-roles/:id/',
    () => new HttpResponse(null, { status: 204 }),
  ),
  // 400: форма — details несёт DRF-ошибки по полям
  http.post('*/api/core/employees/', () =>
    HttpResponse.json(validationEnvelope, { status: 400 }),
  ),
  // 422: бизнес — живой код этого пути (BUSINESS_DATE_OUT_OF_WINDOW)
  http.post('*/api/operations/daily-submissions/', () =>
    HttpResponse.json(businessRuleEnvelope, { status: 422 }),
  ),
  // 409 overridable: протокольная фикстура на существующем пути (Д8).
  // Override-aware (8.5): повтор с ДВУМЯ полями протокола (Д1, зеркало kwargs
  // status_service) → 201 c echo-телом; иначе — 409. Живого override-эндпоинта
  // в API нет — контракт протокольный (Д8-прецедент 8.4).
  http.post('*/api/operations/temporary-duty/', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    const overridden =
      body.override === true &&
      typeof body.override_reason === 'string' &&
      body.override_reason.trim() !== ''
    if (overridden) {
      return HttpResponse.json(body, { status: 201 })
    }
    return HttpResponse.json(conflictOverridableEnvelope, { status: 409 })
  }),
  // 409 НЕ overridable: state-конфликт (протокольная, Д8)
  http.post('*/api/operations/daily-submissions/:id/amend/', () =>
    HttpResponse.json(conflictStateEnvelope, { status: 409 }),
  ),
  // 500 с конвертом
  http.get('*/api/audit/logs/', () =>
    HttpResponse.json(serverEnvelope, { status: 500 }),
  ),
  // 502 от nginx: HTML, конверта нет — парсер не должен падать вторично
  http.get(
    '*/api/notifications/',
    () =>
      new HttpResponse(badGatewayHtml, {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
  ),
  // сетевой обрыв: HTTP-ответа нет вовсе
  http.get('*/api/core/divisions/', () => HttpResponse.error()),
]
