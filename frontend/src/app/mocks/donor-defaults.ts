// Нейтральные mock-дефолты ДОНОРСКОЙ линии PersonnelStatus (§8.2 композиция —
// уровень app). Живой прогон Этапа 71 показал: mock-режим Smart Josparlau
// поднимает ВЕСЬ AppLayout, а донорские экраны (/, /organization,
// /daily-expense, /reports) и общий колокольчик дёргают эндпоинты, которых в
// demo-компоузе не было вовсе → `onUnhandledRequest: 'error'` отвечал 500
// «Request Handler Error»: вечная «Загрузка…», потоп ретраев в консоли и
// мёртвые разделы.
//
// ПРИНЦИП: дефолт либо честно ПУСТ («данных нет» — и это правда: линия Расхода
// в demo не ведётся), либо честно ОТКАЗЫВАЕТ named-конвертом (мутации линии
// требуют backend PersonnelStatus, которого здесь нет). Ни один дефолт не
// изображает успех операции, которой не было (§35).
//
// Это НЕ переиспользование `shared/api/testing/handlers.ts`: те фикстуры —
// протокольные пробы для тестов обработчиков ошибок (500/502/сетевой обрыв),
// в живом demo им делать нечего.
import { HttpResponse, http, ws } from 'msw'
import type { HttpHandler, WebSocketHandler } from 'msw'
import { DIVISIONS } from '../../features/personnel/mocks/fixtures'

const EMPTY_PAGE = { count: 0, next: null, previous: null, results: [] }

function demoUnavailableEnvelope(message: string) {
  return {
    error_code: 'DEMO_BACKEND_UNAVAILABLE',
    message,
    details: {},
    request_id: null,
    timestamp: new Date().toISOString(),
  }
}

const LINE_UNAVAILABLE_TEXT =
  'Операция линии «Расход» требует backend PersonnelStatus — в demo-режиме Smart Josparlau он не поднимается. Данные не изменены.'

export function donorDefaultHandlers(): (HttpHandler | WebSocketHandler)[] {
  return [
    // Колокольчик уведомлений (донорский контракт, GET-only): уведомлений
    // линии в demo не существует — пустая страница, а не 500 с ретрай-потопом.
    http.get('*/api/notifications/', () => HttpResponse.json(EMPTY_PAGE)),
    // WS-канал уведомлений: соединение принимается и молчит. Без обработчика
    // MSW печатал ошибку на каждый reconnect.
    ws.link('ws://*/ws/notifications/*').addEventListener('connection', () => {
      // Событий нет намеренно: push-уведомления линии в demo не происходят.
    }),

    // Дерево светофора «Подразделения»: те же подразделения, что отдаёт
    // /api/core/divisions (один источник — фикстуры personnel), состояние
    // NEUTRAL — канонический «Нет данных» самого контракта. Красить demo-цвета
    // значило бы выдумать сдачу дня, которой не было.
    http.get('*/api/operations/traffic-light/tree/', () =>
      HttpResponse.json({
        business_date: '2026-07-20',
        nodes: DIVISIONS.map((division) => ({
          division_id: division.id,
          name: division.name,
          parent_id: null,
          status: 'NEUTRAL',
          late: false,
        })),
      }),
    ),

    // Сдача дня: сдач не было — пустая страница, панель честно показывает
    // «день не сдавался», а не крутится вечно.
    http.get('*/api/operations/daily-submissions/', () => HttpResponse.json(EMPTY_PAGE)),
    http.post('*/api/operations/daily-submissions/', () =>
      HttpResponse.json(demoUnavailableEnvelope(LINE_UNAVAILABLE_TEXT), { status: 422 }),
    ),
    http.post('*/api/operations/daily-submissions/:id/amend/', () =>
      HttpResponse.json(demoUnavailableEnvelope(LINE_UNAVAILABLE_TEXT), { status: 422 }),
    ),

    // Правки статусов сетки «Расход дня»: мутация линии — named-отказ, не 500.
    http.post('*/api/operations/statuses/bulk/', () =>
      HttpResponse.json(demoUnavailableEnvelope(LINE_UNAVAILABLE_TEXT), { status: 422 }),
    ),

    // Официальный расход: за любую дату «не выпускался» — штатный 404 самого
    // контракта (ENTITY_NOT_FOUND на GET = «не выпущен», не отказ).
    http.get('*/api/operations/expense-reports/', () =>
      HttpResponse.json(
        {
          error_code: 'ENTITY_NOT_FOUND',
          message: 'Расход за дату не выпущен.',
          details: {},
          request_id: null,
          timestamp: new Date().toISOString(),
        },
        { status: 404 },
      ),
    ),
    http.post('*/api/operations/expense-reports/', () =>
      HttpResponse.json(demoUnavailableEnvelope(LINE_UNAVAILABLE_TEXT), { status: 422 }),
    ),
  ]
}
