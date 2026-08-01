// Чтение ЧУЖОГО слайса `objects` из общего demo-снапшота (§8.4).
//
// Зачем: §9.6 требует, чтобы дежурство ссылалось на
// `objectId`/`passportVersionId`/`sectorId`/`postId`. Версии паспорта живут в
// `features/objects`, импорт оттуда красный по ARCH-FE-013 — а join двух
// агрегатов делает СЕРВЕР, не клиент. Здесь и есть этот серверный join:
// mock-repository читает соседний слайс из того же снапшота по имени, через
// рукописную узкую проекцию (`DutyObjectProjection` в lib/passportBinding).
//
// Инвариант: ТОЛЬКО ЧТЕНИЕ. Ни одна операция duties не пишет в слайс
// `objects` — §9.6 «дежурство не редактирует паспорт». Гвард — тест в
// repository.test.ts.
import type { DutyObjectProjection } from '../lib/passportBinding'

export const OBJECTS_SLICE_NAME = 'objects'

/**
 * Пустой массив, а не исключение, когда слайса нет: unit-тест сеет только
 * свой слайс — тогда «связь не установлена», а не падение всего плана.
 */
export function readObjectsProjection(
  slices: Readonly<Record<string, unknown>>,
): DutyObjectProjection[] {
  const slice = slices[OBJECTS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') {
    return []
  }
  const objects = (slice as { objects?: unknown }).objects
  return Array.isArray(objects) ? (objects as DutyObjectProjection[]) : []
}

export function findObjectById(
  slices: Readonly<Record<string, unknown>>,
  objectId: string,
): DutyObjectProjection | null {
  return readObjectsProjection(slices).find((object) => object.id === objectId) ?? null
}

export function findObjectByName(
  objects: readonly DutyObjectProjection[],
  name: string,
): DutyObjectProjection | null {
  return objects.find((object) => object.name === name) ?? null
}
