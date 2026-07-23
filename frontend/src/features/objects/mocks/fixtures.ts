// Demo-сид «Объекты и паспорта» (§8.7: только синтетические данные).
import type { SeedContext } from '../../../shared/testing/mock-runtime/seed-context'
import type { ObjectSector, SecurityObject, SecurityPost } from '../model/types'

export interface ObjectsSlice {
  objects: SecurityObject[]
}

function buildPosts(
  ctx: SeedContext,
  rows: ReadonlyArray<Omit<SecurityPost, 'id'>>,
): SecurityPost[] {
  return rows.map((row) => ({ id: ctx.ids.next('object-post'), ...row }))
}

function buildSectors(
  ctx: SeedContext,
  rows: ReadonlyArray<{ name: string; posts: ReadonlyArray<Omit<SecurityPost, 'id'>> }>,
): ObjectSector[] {
  return rows.map((row) => ({
    id: ctx.ids.next('object-sector'),
    name: row.name,
    posts: buildPosts(ctx, row.posts),
  }))
}

export function buildObjectsSeed(ctx: SeedContext): { sliceName: string; data: ObjectsSlice } {
  const now = ctx.clock.now()
  const objects: SecurityObject[] = [
    {
      id: ctx.ids.next('object'),
      name: 'Дворец Независимости',
      code: 'OBJ-001',
      type: 'Государственное учреждение',
      region: 'г. Астана',
      address: 'пр. Мангилик Ел, 55',
      objectState: 'ACTIVE',
      passportState: 'GREEN',
      sectors: buildSectors(ctx, [
        {
          name: 'Сектор A',
          posts: [
            { name: 'КПП-1', task: 'Контроль въезда/выезда', requirements: 'Допуск «Объект A», рост от 175 см' },
            { name: 'Пост 2', task: 'Периметр, южная сторона', requirements: 'Допуск «Объект A»' },
          ],
        },
        {
          name: 'Штаб',
          posts: [{ name: 'Офицер связи', task: 'Координация постов', requirements: 'Звание не ниже капитана' }],
        },
      ]),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('object'),
      name: 'Дом Министерств',
      code: 'OBJ-002',
      type: 'Государственное учреждение',
      region: 'г. Астана',
      address: 'пр. Мангилик Ел, 8',
      objectState: 'ACTIVE',
      passportState: 'YELLOW',
      sectors: buildSectors(ctx, [
        {
          name: 'Сектор A',
          posts: [{ name: 'КПП-1', task: 'Контроль въезда/выезда', requirements: 'Допуск «Объект B»' }],
        },
      ]),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ctx.ids.next('object'),
      name: 'Астана Арена',
      code: 'OBJ-003',
      type: 'Спортивный объект',
      region: 'г. Астана',
      address: 'ул. Туран, 32',
      objectState: 'ACTIVE',
      passportState: 'RED',
      sectors: [],
      createdAt: now,
      updatedAt: now,
    },
  ]
  return { sliceName: 'objects', data: { objects } }
}
