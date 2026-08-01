// MSW handlers — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import { SETTINGS_PATH, SETTING_CHANGES_PATH } from '../api/pending-contracts'
import type { UpdateSettingRequest } from '../api/pending-contracts'
import {
  createSettingsRepository,
  RepositoryBusinessRuleError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
  RepositoryValidationError,
} from './repository'

function envelope(
  clock: DemoClock,
  errorCode: string,
  message: string,
  details: Record<string, unknown> = {},
): ErrorEnvelope {
  return { error_code: errorCode, message, details, request_id: null, timestamp: clock.now() }
}

function mapRepositoryError(error: unknown, clock: DemoClock, entityId: string): Response | null {
  if (error instanceof RepositoryPermissionError) {
    return HttpResponse.json(envelope(clock, 'PERMISSION_DENIED', 'Недостаточно прав.'), {
      status: 403,
    })
  }
  if (error instanceof RepositoryNotFoundError) {
    return HttpResponse.json(
      envelope(clock, 'ENTITY_NOT_FOUND', 'Настройка не найдена.', { settingCode: entityId }),
      { status: 404 },
    )
  }
  if (error instanceof RepositoryValidationError) {
    // 400 = ФОРМА (§36): details по полям.
    return HttpResponse.json(
      envelope(clock, 'VALIDATION_ERROR', 'Проверьте заполнение формы.', error.fieldErrors),
      { status: 400 },
    )
  }
  if (error instanceof RepositoryBusinessRuleError) {
    // 422 = БИЗНЕС (§36). Обхода нет намеренно: и «значение не изменилось», и
    // «порог предупреждения выше критического» — не мягкие конфликты,
    // подтверждать причиной тут нечего.
    return HttpResponse.json(envelope(clock, error.errorCode, error.message), { status: 422 })
  }
  return null
}

export function createSettingsHandlers(adapter: PersistenceAdapter, clock: DemoClock) {
  const repository = createSettingsRepository(adapter, clock)

  return [
    http.get(`*${SETTING_CHANGES_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listChangeLog(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.get(`*${SETTINGS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listSettings(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    // Паттерн собирается ШАБЛОНОМ, а не `settingPath(':settingCode')`: фабрика
    // пути делает `encodeURIComponent`, и двоеточие параметра превратилось бы
    // в `%3AsettingCode` — handler молча не совпал бы ни с одним запросом
    // (поймано живым прогоном: PATCH уходил в onUnhandledRequest).
    http.patch(`*${SETTINGS_PATH}:settingCode/`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const settingCode = decodeURIComponent(params.settingCode as string)
      try {
        const body = (await request.json()) as UpdateSettingRequest
        return HttpResponse.json(
          await repository.updateSetting(settingCode, body, actorUserId),
        )
      } catch (error) {
        return mapRepositoryError(error, clock, settingCode) ?? HttpResponse.error()
      }
    }),
  ]
}
