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
  // Паспорт «Дворца Независимости» уже публиковался — история версий не должна
  // начинаться с нуля у КАЖДОГО объекта (иначе read-only просмотр версии
  // недостижим, пока кто-нибудь не опубликует руками). Снимок — та же
  // редакция, что действует: ровно это и делает `publishPassportVersion`.
  const palaceSectors = buildSectors(ctx, [
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
  ])
  const palaceId = ctx.ids.next('object')
  const objects: SecurityObject[] = [
    {
      id: palaceId,
      name: 'Дворец Независимости',
      code: 'OBJ-001',
      type: 'Государственное учреждение',
      region: 'г. Астана',
      address: 'пр. Мангилик Ел, 55',
      objectState: 'ACTIVE',
      passportState: 'GREEN',
      sectors: palaceSectors,
      passportVersions: [
        {
          id: `${palaceId}-passport-v1`,
          versionNumber: 1,
          effectiveFrom: now.slice(0, 10),
          publishedAt: now,
          publishedBy: 'demo-seed',
          note: 'Первичная публикация паспорта объекта.',
          // Глубокая копия — тот же инвариант неизменяемости, что в repository:
          // правка действующей редакции не должна переписывать версию.
          sectors: palaceSectors.map((sector) => ({
            ...sector,
            posts: sector.posts.map((post) => ({ ...post })),
          })),
        },
      ],
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
      passportVersions: [],
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
      passportVersions: [],
      createdAt: now,
      updatedAt: now,
    },
  ]
  return { sliceName: 'objects', data: { objects } }
}
