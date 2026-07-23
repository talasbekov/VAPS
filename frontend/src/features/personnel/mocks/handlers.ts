// MSW handlers для существующих (`existing`, НЕ pending-contract) кадровых
// эндпоинтов доноров — в dev:mock demo-режиме backend не запущен, поэтому
// эти маршруты нужно замочить самим (§8.2: composeHandlers "по мере Этапа
// 2+", реестр раньше был пуст для core/*). Единая страница без пролистывания
// (demo-масштаб) — реальный backend отдаёт постраничный ответ той же формы.
import { http, HttpResponse } from 'msw'
import { DIVISIONS, EMPLOYEES, POSITIONS, RANKS } from './fixtures'

export const personnelHandlers = [
  http.get('*/api/core/employees/', () =>
    HttpResponse.json({ count: EMPLOYEES.length, next: null, previous: null, results: EMPLOYEES }),
  ),
  http.get('*/api/core/employees/:id/', ({ params }) => {
    const employee = EMPLOYEES.find((e) => e.id === params.id)
    if (employee === undefined) {
      return HttpResponse.json({ detail: 'Не найдено.' }, { status: 404 })
    }
    return HttpResponse.json(employee)
  }),
  http.get('*/api/core/divisions/', () =>
    HttpResponse.json({ count: DIVISIONS.length, next: null, previous: null, results: DIVISIONS }),
  ),
  http.get('*/api/core/positions/', () =>
    HttpResponse.json({ count: POSITIONS.length, next: null, previous: null, results: POSITIONS }),
  ),
  http.get('*/api/core/ranks/', () =>
    HttpResponse.json({ count: RANKS.length, next: null, previous: null, results: RANKS }),
  ),
]
