// Чтение ЧУЖОГО слайса `objects` из общего demo-снапшота (§8.4).
//
// Зачем вообще: §9.6 требует, чтобы расстановка ссылалась на
// `objectId`/`passportVersionId`/`sectorId`/`postId`. Версии паспорта живёт в
// `features/objects`, импорт оттуда красный по ARCH-FE-013 — а join двух
// агрегатов делает СЕРВЕР, не клиент. Здесь и есть этот серверный join:
// mock-repository читает соседний слайс из того же снапшота по имени, через
// рукописную узкую проекцию (`SecurityObjectProjection` в lib/passportBinding).
// Тот же осознанный приём, что в печатной форме (FRONTEND_DECISIONS A58).
//
// Инвариант: ТОЛЬКО ЧТЕНИЕ. Ни одна операция security-events не записывает в
// слайс `objects` — §9.6 «event-specific изменение поста не редактирует
// паспорт автоматически». Гвард — тест в repository.test.ts.
import type { SecurityObjectProjection } from '../lib/passportBinding'

export const OBJECTS_SLICE_NAME = 'objects'

/**
 * Достаёт объекты из карты слайсов. Пустой массив, а не исключение, когда
 * слайса нет: `objects` может быть не засеян (unit-тест сеет только свой
 * слайс) — тогда «связь не установлена», а не падение всей карточки ОМ.
 */
export function readObjectsProjection(
  slices: Readonly<Record<string, unknown>>,
): SecurityObjectProjection[] {
  const slice = slices[OBJECTS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') {
    return []
  }
  const objects = (slice as { objects?: unknown }).objects
  return Array.isArray(objects) ? (objects as SecurityObjectProjection[]) : []
}

export function findObjectById(
  slices: Readonly<Record<string, unknown>>,
  objectId: string,
): SecurityObjectProjection | null {
  return readObjectsProjection(slices).find((object) => object.id === objectId) ?? null
}

export function findObjectByCode(
  slices: Readonly<Record<string, unknown>>,
  code: string,
): SecurityObjectProjection | null {
  return readObjectsProjection(slices).find((object) => object.code === code) ?? null
}
