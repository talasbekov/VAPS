/**
 * Текст отказа диалога «Выделить машину» — Plane №967.
 *
 * Живое наблюдение 07.09.2026: заказчик под acc_dir_head_d2 пять раз нажимал
 * «выделить машину» на ОМ 7917, каждый раз получал 403 (нет права), а тост
 * отвечал «Сервис временно недоступен. Попробуйте ещё раз» — сообщение,
 * которое врёт про отказ прав и провоцирует бессмысленный повтор.
 *
 * Проба чистая (без стенда): зовёт `allocationErrorMessage` напрямую.
 * Красна, если 403 перестанет получать свой текст или сольётся с сетевым
 * отказом.
 */
import { expect, test } from '@playwright/test'

import { OpsApiError, OpsNetworkError, OpsServerError } from '../lib/ops-errors'
import { allocationErrorMessage } from '../features/event-vehicles/lib/allocation-error-message'

function apiError(status: number, message: string) {
  return new OpsApiError({
    status,
    errorCode: '',
    message,
    details: {},
    requestId: null,
  })
}

test.describe('диалог «Выделить машину»: текст отказа', () => {
  test('403 говорит про право, а не про сеть', () => {
    const message = allocationErrorMessage(apiError(403, 'PERMISSION_DENIED'))
    expect(message).toBe('Нет права выделять транспорт на это мероприятие.')
  })

  test('4xx с телом показывает сообщение сервера', () => {
    const message = allocationErrorMessage(apiError(404, 'Мероприятие не найдено'))
    expect(message).toBe('Мероприятие не найдено')
  })

  test('5xx остаётся общим сетевым текстом', () => {
    const message = allocationErrorMessage(
      new OpsServerError({ status: 500, errorCode: null, message: 'boom', details: {}, requestId: null }),
    )
    expect(message).toBe('Сервис временно недоступен. Попробуйте ещё раз.')
  })

  test('обрыв сети остаётся общим текстом', () => {
    const message = allocationErrorMessage(new OpsNetworkError('Сеть недоступна'))
    expect(message).toBe('Сервис временно недоступен. Попробуйте ещё раз.')
  })
})
