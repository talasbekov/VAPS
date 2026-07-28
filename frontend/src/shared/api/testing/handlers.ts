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

type TrafficLightTreeResponse =
  paths['/api/operations/traffic-light/tree/']['get']['responses']['200']['content']['application/json']

type TrafficLightDivisionResponse =
  paths['/api/operations/traffic-light/division/']['get']['responses']['200']['content']['application/json']

type IssuedExpenseReportResponse =
  paths['/api/operations/expense-reports/']['get']['responses']['200']['content']['application/json']

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

// Дефолт светофора (стори 10.4): ПУСТОЕ дерево. Обязателен, а не опционален —
// `app-layout.qa.test.tsx:140-151` монтирует `/organization`, и после подмены
// заглушки живым экраном незамоканный GET валит чужой тест по
// onUnhandledRequest: 'error' (по инфраструктуре, не по логике; тот же урок,
// что дал GET daily-submissions в 10.3). Пустой список = «нет данных» —
// нейтральный дефолт, который ничего не утверждает про цвета.
export const trafficLightTreeFixture: TrafficLightTreeResponse = {
  business_date: '2026-07-19',
  nodes: [],
}

// Story 10.3b: per-division светофор с drift (10.3c) — нейтральный дефолт
// GREEN/drift:null. Обязателен по тому же уроку, что дефолт tree выше:
// `DaySubmissionPanel` теперь запрашивает этот роут на любом сданном дне —
// без дефолта каждый тест daily-grid, доходящий до «День сдан», ловил бы
// onUnhandledRequest: 'error' по инфраструктуре, а не по логике сценария.
export const divisionTrafficLightFixture: TrafficLightDivisionResponse = {
  status: 'GREEN',
  late: false,
  drift: null,
}

// Выпущенный расход (стори 10.5, +3 поля стори 10.5b) — 14 полей
// `IssuedExpenseReportSerializer`. Типизация против paths[…] держит фикстуру
// честной — расхождение с бэком `tsc` не даст (AC-0 «б»).
export const issuedExpenseReportFixture: IssuedExpenseReportResponse = {
  id: 'b2c3d4e5-f607-4819-a2b3-c4d5e6f70819',
  doc_type: 'EXPENSE',
  number: 247,
  year: 2026,
  business_date: '2026-07-19',
  division_id: '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
  submission_id: 512,
  submission_version: 3,
  status: 'ISSUED',
  attachment_id: 'c3d4e5f6-0718-492a-b3c4-d5e6f7081920',
  sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  // v1 — первый выпуск дня: reason "" и supersedes null (10.5b семантика).
  reason: '',
  supersedes_number: null,
  supersedes_year: null,
}

// 404 чтения — ШТАТНЫЙ ответ «за эту дату не выпускалось» (views.py:293-301),
// а НЕ отказ. Тот же код `ENTITY_NOT_FOUND` бэк отдаёт и на фантомный
// division_id — на POST это «Подразделение не найдено», на GET «не выпускался»;
// разводит их не код, а метод (AC-3/AC-5).
export const expenseNotIssuedEnvelope: ErrorEnvelope = {
  error_code: 'ENTITY_NOT_FOUND',
  message: 'Расход за дату не выпущен.',
  details: {
    division_id: '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
    business_date: '2026-07-19',
  },
  request_id: null,
  timestamp: TIMESTAMP,
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

// Story 10.5a: 409 НЕ overridable (тот же класс, что `conflictStateEnvelope`
// выше) — обход не ретраится, это ОТДЕЛЬНОЕ действие с ОТДЕЛЬНЫМ телом.
export const tomorrowBlockAlreadyOverriddenEnvelope: ErrorEnvelope = {
  error_code: 'TOMORROW_BLOCK_ALREADY_OVERRIDDEN',
  message: 'Обход блокировки на эту дату уже существует.',
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
  // 200 (стори 10.3): состояние дня — НЕЙТРАЛЬНЫЙ дефолт «день не сдан».
  // Обязателен, а не опционален: панель сдачи монтирует useQuery на этот путь,
  // и при onUnhandledRequest: 'error' без дефолта падают все тесты экрана,
  // которые выбирают подразделение (16 штук) — по инфраструктуре, а не по
  // логике. Конверт — LimitOffsetPagination (limit/offset, НЕ page).
  // Типом paths[...] не аннотируется намеренно: схема этих путей тел не несёт
  // («No response body», Решение №3 стори) — аннотировать нечем.
  http.get('*/api/operations/daily-submissions/', () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  // 200 (стори 10.4): каскадное дерево светофора — пустой дефолт (см. выше).
  // Предикат с '*' обязателен: в env node без location относительный
  // '/api/…' МОЛЧА не матчится против абсолютного URL запроса.
  http.get('*/api/operations/traffic-light/tree/', () =>
    HttpResponse.json(trafficLightTreeFixture),
  ),
  // 200 (стори 10.3b): per-division светофор с drift — нейтральный дефолт
  // (см. фикстуру выше).
  http.get('*/api/operations/traffic-light/division/', () =>
    HttpResponse.json(divisionTrafficLightFixture),
  ),
  // 200 (стори 10.6a/10.6b): свежесть сводки — нейтральный дефолт
  // NOT_SUMMARY (большинство сдач — обычные, не сводки; это ОСНОВНОЙ путь).
  http.get('*/api/operations/daily-submissions/freshness/', () =>
    HttpResponse.json({ status: 'NOT_SUMMARY', superseded: [], missing: [], unpinned: [] }),
  ),
  // 404 (стори 10.5): расход за дату НЕ выпускался — нейтральный дефолт.
  // Обязателен, а не опционален: `app-layout.qa.test.tsx` монтирует `/reports`,
  // и после подмены заглушки живым экраном любой незамоканный GET валит чужой
  // тест по onUnhandledRequest: 'error' (урок 10.3/10.4). Дефолт «не выпущен»
  // ничего не утверждает про выпуск и не рисует кнопку скачивания.
  http.get('*/api/operations/expense-reports/', () =>
    HttpResponse.json(expenseNotIssuedEnvelope, { status: 404 }),
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
  // 200 (стори 10.6c): деталь версии (13 полей) — нейтральный дефолт,
  // reason/sanction пустые (неисправленная версия). Обязателен: разворот
  // версии монтирует `useQuery` на этот путь при клике, и при
  // onUnhandledRequest: 'error' незамоканный запрос свалил бы любой тест,
  // разворачивающий строку без явного `server.use`.
  // ⚠️ `:id([0-9]+)` — ЧИСЛОВОЙ constraint обязателен (не просто `:id`):
  // Django-pk целочисленный, а без ограничения этот паттерн МОЛЧА поглотил бы
  // `/daily-submissions/freshness/` (10.6a/10.6b) — тот же класс коллизии,
  // что project-memory предупреждает про MSW path collision. server.use()-
  // оверрайды в тестах ставятся ПОВЕРХ дефолтов и переупорядочивают
  // приоритет — без числового constraint override этого роута в любом тесте
  // 10.6c тихо перехватил бы freshness-запросы того же теста.
  http.get('*/api/operations/daily-submissions/:id([0-9]+)/', () =>
    HttpResponse.json({
      id: 1,
      division_id: '00000000-0000-0000-0000-000000000000',
      business_date: '2026-01-01',
      version: 1,
      is_current: true,
      event: 'CHANGED',
      submitted_by: 'operator-1',
      submitted_at: '2026-01-01T08:00:00+05:00',
      late: false,
      snapshot: {},
      reason: '',
      sanction: '',
      triggered_by_status_id: null,
    }),
  ),
  // Story 10.5a: дефолт-отказ 409 «уже обойдено» — нейтральный дефолт, не
  // тихий успех (обход НЕ должен успевать в тестах, которые его не настроили
  // явно; тот же приём, что дефолт amend выше).
  http.post('*/api/operations/expense-reports/override-tomorrow-block/', () =>
    HttpResponse.json(tomorrowBlockAlreadyOverriddenEnvelope, { status: 409 }),
  ),
  // Story 10.5c: журнал выпусков — нейтральный пустой дефолт (незамоканный
  // роут не должен ронять чужие тесты `onUnhandledRequest: 'error'`, тот же
  // урок, что дефолты daily-submissions/traffic-light).
  http.get('*/api/operations/expense-reports/journal/', () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  // Story 10.5e: чтение за период — нейтральный пустой дефолт (запрос
  // отложенный, но `ExpensePeriodPanel` монтируется всегда при выбранном
  // подразделении — незамоканный роут не должен ронять чужие тесты).
  http.get('*/api/operations/expense-reports/period/', () =>
    HttpResponse.json({ pages: [] }),
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
