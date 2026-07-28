// Demo-сид «Объекты и паспорта» (§8.7: только синтетические данные).
import type { SeedContext } from '../../../shared/testing/mock-runtime/seed-context'
import { addDays } from '../lib/passportFreshness'
import type {
  ObjectSector,
  PassportFreshnessPolicy,
  SecurityObject,
  SecurityPost,
} from '../model/types'

export interface ObjectsSlice {
  objects: SecurityObject[]
  /** §21.7 «срок актуальности приходит от policy» — настройка живёт в ДАННЫХ,
   * а не константой в коде, и у неё есть версия (см. `PassportFreshness`). */
  freshnessPolicy: PassportFreshnessPolicy
}

/** Интервал НАМЕРЕННО не 90 дней: §21.7 приводит «Паспорт старше 90 дней»
 * как пример того, чего делать нельзя, и совпадение значения скрыло бы
 * захардкоженный период, если бы он где-то остался. */
export const PASSPORT_FRESHNESS_POLICY: PassportFreshnessPolicy = {
  version: 'passport-freshness-v1',
  verificationIntervalDays: 120,
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

  // §21.7: все ЧЕТЫРЕ состояния актуальности должны быть достижимы в демо, а
  // не только те, что вышли случайно. «Дворец» опубликован сегодня → FRESH,
  // два объекта без публикаций → NO_PUBLISHED_VERSION; эти два добавлены с
  // ДАТИРОВАННЫМИ публикациями под DUE_SOON и OVERDUE.
  //
  // ⚠️ Даты считаются от бизнес-даты через `addDays`, а не литералами: при
  // смене сценария демо literal-даты разъехались бы с DemoClock молча.
  const dueSoonId = ctx.ids.next('object')
  const overdueId = ctx.ids.next('object')
  const dueSoonSectors = buildSectors(ctx, [
    {
      name: 'Сектор A',
      posts: [{ name: 'КПП-1', task: 'Контроль въезда', requirements: 'Допуск «Резиденция»' }],
    },
  ])
  const overdueSectors = buildSectors(ctx, [
    {
      name: 'Периметр',
      posts: [{ name: 'Пост 1', task: 'Наблюдение', requirements: 'Допуск «Комплекс»' }],
    },
  ])
  objects.push(
    {
      id: dueSoonId,
      name: 'Резиденция «Ак Орда»',
      code: 'OBJ-004',
      type: 'Государственное учреждение',
      region: 'г. Астана',
      address: 'ул. Мангилик Ел, 1',
      objectState: 'ACTIVE',
      passportState: 'GREEN',
      sectors: dueSoonSectors,
      passportVersions: [
        {
          id: `${dueSoonId}-passport-v1`,
          versionNumber: 1,
          // 110 суток назад при интервале политики 120 → срок близко.
          effectiveFrom: addDays(now.slice(0, 10), -110),
          publishedAt: now,
          publishedBy: 'demo-seed',
          note: 'Плановая публикация паспорта.',
          sectors: dueSoonSectors.map((sector) => ({
            ...sector,
            posts: sector.posts.map((post) => ({ ...post })),
          })),
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: overdueId,
      name: 'Комплекс «Казмедиа»',
      code: 'OBJ-005',
      type: 'Медиа-объект',
      region: 'г. Астана',
      address: 'ул. Кунаева, 4',
      objectState: 'ACTIVE',
      passportState: 'YELLOW',
      sectors: overdueSectors,
      passportVersions: [
        {
          id: `${overdueId}-passport-v1`,
          versionNumber: 1,
          // 200 суток назад при интервале 120 → срок проверки прошёл.
          effectiveFrom: addDays(now.slice(0, 10), -200),
          publishedAt: now,
          publishedBy: 'demo-seed',
          note: 'Публикация прошлого периода.',
          sectors: overdueSectors.map((sector) => ({
            ...sector,
            posts: sector.posts.map((post) => ({ ...post })),
          })),
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
  )

  return {
    sliceName: 'objects',
    data: { objects, freshnessPolicy: PASSPORT_FRESHNESS_POLICY },
  }
}
