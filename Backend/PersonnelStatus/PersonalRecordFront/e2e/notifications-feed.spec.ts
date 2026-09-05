/**
 * Чистые функции ленты колокольчика (Plane №563).
 *
 * 🔴 ПОЧЕМУ ПРОБА НЕ ЖИВАЯ И НЕ ТРЕБУЕТ `SMOKE_LIVE`. Она проверяет функции,
 * которые не ходят в сеть, — привязка к стенду сделала бы её медленной и
 * мигающей. Тот же приём, что у `route-map-coverage.spec.ts`: без переменной
 * окружения проба даёт «passed», а не «skipped», иначе молчание читалось бы
 * как зелень.
 */
import { expect, test } from '@playwright/test'
import { notificationKey, type Notification } from '../features/notifications/api/notifications-api'

/**
 * Ключ строки в ленте колокольчика (Plane №563).
 *
 * Проба стоит рядом со склонением по той же причине: обе про ЧИСТЫЕ функции
 * ленты уведомлений, обе не требуют ни браузера, ни стенда, и обе стерегут то,
 * что ломается молча.
 */
test.describe('ключ строки в ленте', () => {
  test('совпавшие номера из разных таблиц дают РАЗНЫЕ ключи', () => {
    // Колокольчик сводит легаси-ленту и ленту раздела ОМ; их первичные ключи
    // нумеруются независимо, поэтому пара строк с одним номером — обычное
    // дело, а не редкость.
    const row = (id: number, source: 'legacy' | 'ops'): Notification => ({
      id,
      notification_type: 'X',
      title: `строка ${source} ${id}`,
      message: '',
      link: null,
      is_read: false,
      created_at: '2026-09-05T00:00:00Z',
      source,
    })
    // 🔴 Мутация, на которой проба обязана краснеть: вернуть `String(n.id)`.
    expect(notificationKey(row(7, 'legacy'))).not.toBe(notificationKey(row(7, 'ops')))
    // Ключ строки не меняется от вызова к вызову — иначе `AnimatePresence`
    // считал бы каждую перерисовку заменой всего списка.
    expect(notificationKey(row(7, 'ops'))).toBe(notificationKey(row(7, 'ops')))
    // И остаётся различающим внутри одного источника.
    expect(notificationKey(row(7, 'ops'))).not.toBe(notificationKey(row(8, 'ops')))
  })
})
