// Демо-сид «Объекты и паспорта» (синтетические данные, адаптированы из
// donor-фикстур Smart Josparlau). Все четыре состояния актуальности
// достижимы: свежая публикация (FRESH), две без публикаций
// (NO_PUBLISHED_VERSION), датированные под DUE_SOON и OVERDUE.
// Даты считаются от бизнес-даты через addDays, не литералами.
import { addDays } from "@/entities/security-object";
import type {
  ObjectSector,
  PassportFreshnessPolicy,
  SecurityObject,
  UnavailableMetric,
} from "@/entities/security-object";

/** Политика актуальности: в мок-слое живёт как данные «с сервера». */
export const DEMO_FRESHNESS_POLICY: PassportFreshnessPolicy = {
  version: "policy-v1",
  verificationIntervalDays: 120,
  dueSoonPercent: 25,
};

/** KPI прототипа, которых модель объекта не даёт — приходят с причиной. */
export const UNAVAILABLE_OBJECT_KPI: UnavailableMetric[] = [
  {
    code: "OPEN_REMARKS",
    label: "Есть открытые замечания",
    reason:
      "Замечания по объекту не моделируются: у объекта есть паспорт, секторы и посты, но нет журнала замечаний — считать было бы нечего.",
  },
  {
    code: "MISSING_REQUIRED_SCHEME",
    label: "Нет обязательной схемы",
    reason:
      "Схемы и документы объекта требуют blob-хранилища, которого в demo-срезе нет.",
  },
];

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function buildSectors(
  rows: ReadonlyArray<{
    name: string;
    posts: ReadonlyArray<{ name: string; task: string; requirements: string }>;
  }>
): ObjectSector[] {
  return rows.map((row) => ({
    id: nextId("sector"),
    name: row.name,
    posts: row.posts.map((post) => ({ id: nextId("post"), ...post })),
  }));
}

function snapshotSectors(sectors: ObjectSector[]): ObjectSector[] {
  // глубокая копия: правка действующей редакции не должна переписывать версию
  return sectors.map((sector) => ({
    ...sector,
    posts: sector.posts.map((post) => ({ ...post })),
  }));
}

export function buildObjectsFixtures(
  now: string,
  businessDate: string
): SecurityObject[] {
  const palaceSectors = buildSectors([
    {
      name: "Сектор A",
      posts: [
        {
          name: "КПП-1",
          task: "Контроль въезда/выезда",
          requirements: "Допуск «Объект A», рост от 175 см",
        },
        {
          name: "Пост 2",
          task: "Периметр, южная сторона",
          requirements: "Допуск «Объект A»",
        },
      ],
    },
    {
      name: "Штаб",
      posts: [
        {
          name: "Офицер связи",
          task: "Координация постов",
          requirements: "Звание не ниже капитана",
        },
      ],
    },
  ]);
  const dueSoonSectors = buildSectors([
    {
      name: "Сектор A",
      posts: [
        {
          name: "КПП-1",
          task: "Контроль въезда",
          requirements: "Допуск «Резиденция»",
        },
      ],
    },
  ]);
  const overdueSectors = buildSectors([
    {
      name: "Периметр",
      posts: [
        { name: "Пост 1", task: "Наблюдение", requirements: "Допуск «Комплекс»" },
      ],
    },
  ]);

  const palaceId = nextId("obj");
  const dueSoonId = nextId("obj");
  const overdueId = nextId("obj");

  return [
    {
      id: palaceId,
      name: "Дворец Независимости",
      code: "OBJ-001",
      type: "Государственное учреждение",
      region: "г. Астана",
      address: "пр. Мангилик Ел, 55",
      objectState: "ACTIVE",
      passportState: "GREEN",
      ownership: "GUARDED",
      hasSecurityEvents: true,
      sectors: palaceSectors,
      passportVersions: [
        {
          id: `${palaceId}-passport-v1`,
          versionNumber: 1,
          effectiveFrom: businessDate,
          publishedAt: now,
          publishedBy: "demo-seed",
          note: "Первичная публикация паспорта объекта.",
          sectors: snapshotSectors(palaceSectors),
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: nextId("obj"),
      name: "Дом Министерств",
      code: "OBJ-002",
      type: "Государственное учреждение",
      region: "г. Астана",
      address: "пр. Мангилик Ел, 8",
      objectState: "ACTIVE",
      passportState: "YELLOW",
      ownership: "GUARDED",
      hasSecurityEvents: true,
      sectors: buildSectors([
        {
          name: "Сектор A",
          posts: [
            {
              name: "КПП-1",
              task: "Контроль въезда/выезда",
              requirements: "Допуск «Объект B»",
            },
          ],
        },
      ]),
      passportVersions: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: nextId("obj"),
      name: "Астана Арена",
      code: "OBJ-003",
      type: "Спортивный объект",
      region: "г. Астана",
      address: "ул. Туран, 32",
      objectState: "ACTIVE",
      passportState: "RED",
      ownership: "OWN",
      hasSecurityEvents: false,
      sectors: [],
      passportVersions: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: dueSoonId,
      name: "Резиденция «Ак Орда»",
      code: "OBJ-004",
      type: "Государственное учреждение",
      region: "г. Астана",
      address: "ул. Мангилик Ел, 1",
      objectState: "ACTIVE",
      passportState: "GREEN",
      ownership: "OWN",
      hasSecurityEvents: true,
      sectors: dueSoonSectors,
      passportVersions: [
        {
          id: `${dueSoonId}-passport-v1`,
          versionNumber: 1,
          // 110 суток назад при интервале политики 120 → срок близко
          effectiveFrom: addDays(businessDate, -110),
          publishedAt: now,
          publishedBy: "demo-seed",
          note: "Плановая публикация паспорта.",
          sectors: snapshotSectors(dueSoonSectors),
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: overdueId,
      name: "Комплекс «Казмедиа»",
      code: "OBJ-005",
      type: "Медиа-объект",
      region: "г. Астана",
      address: "ул. Кунаева, 4",
      objectState: "ACTIVE",
      passportState: "YELLOW",
      ownership: "GUARDED",
      hasSecurityEvents: false,
      sectors: overdueSectors,
      passportVersions: [
        {
          id: `${overdueId}-passport-v1`,
          versionNumber: 1,
          // 200 суток назад при интервале 120 → срок проверки прошёл
          effectiveFrom: addDays(businessDate, -200),
          publishedAt: now,
          publishedBy: "demo-seed",
          note: "Публикация прошлого периода.",
          sectors: snapshotSectors(overdueSectors),
        },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];
}
