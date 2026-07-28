// MSW handlers личного состава. Два РАЗНЫХ класса маршрутов в одном файле:
//
//   `/api/core/*`          — существующие (`existing`, НЕ pending-contract)
//                            кадровые эндпоинты доноров: в dev:mock backend не
//                            запущен, и мы мочим их такими, какие они есть —
//                            полный `iin` в ответе это ИХ контракт
//                            (ARCH-FE-011, типы из схемы, переписывать чужой
//                            контракт под свои требования нельзя);
//   `/api/ops/personnel/*` — СОБСТВЕННЫЕ ресурсы Smart Josparlau: безопасная
//                            проекция (§20.29) и раскрытие sensitive identity
//                            (§20.27/§20.28/§20.33).
//
// Экраны Smart Josparlau ходят ТОЛЬКО во вторую группу — см. шапку
// api/pending-contracts.ts. Донорские маршруты остаются замоченными, потому
// что demo-режим обязан отвечать на всё, что может спросить донорский код.
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import { DIVISIONS, EMPLOYEES, POSITIONS, RANKS } from './fixtures'
import {
  createPersonnelRepository,
  RepositoryBusinessRuleError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'
import {
  PERSONNEL_DIRECTORY_PATH,
  personnelDisclosePath,
  personnelDisclosureLogPath,
  personnelEntryPath,
} from '../api/pending-contracts'
import type { DiscloseIdentityRequest } from '../api/pending-contracts'

function envelope(clock: DemoClock, code: string, message: string): ErrorEnvelope {
  return { error_code: code, message, details: {}, request_id: null, timestamp: clock.now() }
}

function mapRepositoryError(error: unknown, clock: DemoClock): Response | null {
  if (error instanceof RepositoryPermissionError) {
    return HttpResponse.json(envelope(clock, 'PERMISSION_DENIED', 'Недостаточно прав.'), {
      status: 403,
    })
  }
  if (error instanceof RepositoryNotFoundError) {
    return HttpResponse.json(envelope(clock, 'ENTITY_NOT_FOUND', 'Сотрудник не найден.'), {
      status: 404,
    })
  }
  if (error instanceof RepositoryBusinessRuleError) {
    return HttpResponse.json(envelope(clock, error.errorCode, error.message), { status: 422 })
  }
  return null
}

export function createPersonnelHandlers(adapter: PersistenceAdapter, clock: DemoClock) {
  const repository = createPersonnelRepository(adapter, clock)

  return [
    http.get(`*${PERSONNEL_DIRECTORY_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listPersonnel(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
    http.get(`*${personnelEntryPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.getPersonnelEntry(String(params.id), actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
    http.post(`*${personnelDisclosePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const body = (await request.json()) as DiscloseIdentityRequest
      try {
        return HttpResponse.json(
          await repository.discloseIdentity(String(params.id), body, actorUserId),
        )
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),
    http.get(`*${personnelDisclosureLogPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listDisclosures(String(params.id), actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock) ?? HttpResponse.error()
      }
    }),

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
}
