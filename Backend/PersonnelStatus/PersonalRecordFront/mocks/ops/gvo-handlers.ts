// MSW-handlers «Реестр ГВО». Хранится только патч ручных правок по коду ОМ —
// база сводки выводится на клиенте из бюллетеня (entities/gvo-summary).
// С 20.08.2026 у раздела есть живой бэк (/api/ops/gvo-summaries/): домен
// `gvo` живой по умолчанию, handlers регистрируются только когда домен
// возвращён на мок (NEXT_PUBLIC_OPS_MOCK_DOMAINS) — см. mocks/ops/handlers.ts.
// Персист — sessionStorage: сайдбар ходит по <a>, то есть полной перезагрузкой.
//
// Ведущая «*» в паттернах обязательна: в dev клиент бьёт по абсолютному
// BACKEND_URL (http://localhost:8100), и относительный путь резолвился бы от
// origin документа (:3106) — запрос молча ушёл бы в сеть мимо мока.
import { http, HttpResponse } from "msw";
import {
  GVO_SUMMARIES_PATH,
  gvoSectionPatchKeys,
  UNSPECIFIED,
} from "@/entities/gvo-summary";
import type {
  GvoSummary,
  GvoSummaryPatch,
  GvoSummaryPatchRecord,
  ListGvoSummaryPatchesResponse,
  ResetGvoSummaryRequest,
  UpdateGvoSummaryRequest,
} from "@/entities/gvo-summary";
import { isOpsSecurityEventsLive } from "@/lib/ops-env";
import { readSecurityEventsStore } from "./security-events-handlers";

const STORE_KEY = "ops-mock-gvo-summaries";

/**
 * Демонстрационная сводка «Черногория» — восстановлена из рабочего документа
 * «Сводные данные ОЛ Черногория» и служит эталоном состава полей.
 * Кладётся ПАТЧЕМ на первое мероприятие мок-реестра: свой код ОМ у мока свой
 * («ОМ-2026-1»), литеральный код прототипа не совпал бы ни с одним ОМ.
 */
const MONTENEGRO_PATCH: GvoSummaryPatch = {
  country: "Черногория",
  persons: [
    {
      name: "Яков Милатович",
      role: "Президент Черногории",
      facts: [
        {
          key: "Дата и место рождения",
          value: "07.12.1986 г. (39 лет), г. Подгорица, Черногория",
        },
        { key: "Группа крови", value: "А (II) Rh +" },
        { key: "Рост", value: "185 см" },
        { key: "Размер обуви", value: "43" },
        {
          key: "Ограничения в питании",
          value: "тунец, баранина, свежее мясо, майонез",
        },
        {
          key: "Предпочтения в питании",
          value: "курица, рыба, телятина, стейк полной прожарки",
        },
        { key: "Аллергии", value: "отсутствуют" },
      ],
    },
    {
      name: "Милена Милатович",
      role: "Супруга Президента Черногории",
      facts: [
        {
          key: "Дата и место рождения",
          value: "03.07.1989 г. (36 лет), г. Подгорица, Черногория",
        },
        { key: "Группа крови", value: "О (I) Rh +" },
        { key: "Рост", value: "175 см" },
        { key: "Размер обуви", value: "39" },
        { key: "Ограничения в питании", value: "отсутствуют" },
        { key: "Аллергии", value: "отсутствуют" },
      ],
    },
  ],
  arrival: {
    date: "18.06.2026",
    time: "19:55 ч.",
    route: "гг. Подгорица — Астана",
    flight: "а/к «Air Astana» KC 638",
    dur: "время в полёте 5:40 часа",
  },
  departure: {
    date: "21.06.2026",
    time: "06:00 ч.",
    route: "гг. Астана — Подгорица",
    flight: "а/к «Air Astana» KC 637",
    dur: "время в полёте 6:30 часа",
  },
  meet: [
    "Зам. Премьер-Министра — МИИЦР Ж. Мадиев",
    "Зам. Руководителя Администрации Президента А. Жанасова",
    "Зам. Министра иностранных дел А. Исетов",
    "Посол РК в РЧ Д. Батрашев",
    "Зам. Акима г. Астана Е. Глотов",
  ],
  farewell: [
    "Зам. Премьер-Министра — МИИЦР Ж. Мадиев",
    "Зам. Министра иностранных дел А. Исетов",
    "Посол РК в РЧ Д. Батрашев",
    "Зам. Акима г. Астана Е. Глотов",
  ],
  stay: { place: "отель Hilton Astana, объект «Мейрам»", room: "№ 1827" },
  delegation: [
    "ПГ (17.06.2026 г.) — 3 чел. (из них 1 сотр. СБ), рейс TK 448 а/к «Turkish Airlines» по маршруту гг. Стамбул — Астана",
    "ОГ (28.06.2026 г.) — 13 чел. (из них 2 сотр. СБ)",
  ],
  sbChief: "Руководитель службы безопасности Президента Черногории — Иван Фемич",
  weapons:
    "Безопасность — 3 сотрудника СБ Президента и супруги Черногории (без вооружения)",
  wishes: UNSPECIFIED,
  obVariant: "трасса № 2, объекты № 1",
  radio: "В-1 / В-12 / С-12",
  responsible: { name: "Шитов", callsign: "2-9", role: "ответственный" },
  groups: [
    {
      name: "ГВО «Черногория»",
      members: [
        { name: "Булатаев", callsign: "2-27", role: "старший ГВО" },
        { name: "Байболов", callsign: "7-41", role: "прикреплённый" },
        { name: "Төкен", callsign: "2-50", role: "ответственный за кортеж" },
        { name: "Жоланов", callsign: "31-63", role: "офицер охраны" },
        { name: "Тлеубекұлы", callsign: "3-62", role: "офицер охраны" },
        { name: "Бусин", callsign: "11-36", role: "водитель VIP" },
        { name: "Сызыдков", callsign: "11-40", role: "водитель S1" },
        { name: "Шарбек", callsign: "11-42", role: "водитель S2" },
        { name: "Хафиз", callsign: "11-16", role: "водитель R" },
        { name: "Мусин", callsign: "SR-230", role: "БГ «Sardar»" },
        { name: "Тазабек", callsign: "3-48", role: "«99»" },
        { name: "Анарбеков", callsign: "7-56", role: "МУС «Астана»" },
        {
          name: "Воронько",
          callsign: "7-128",
          role: "комплекс БВС «Купол» (водитель)",
        },
        {
          name: "Исимбетов",
          callsign: "7-116",
          role: "комплекс БВС «Купол» (оператор)",
        },
      ],
    },
    {
      name: "ГВО «Черногория-1»",
      members: [
        { name: "Джансеркеев", callsign: "11-12", role: "старший ГВО" },
        { name: "Шайменова", callsign: "2-73", role: "прикреплённый" },
        { name: "Уаильденов", callsign: "11-35", role: "водитель VIP-1" },
        { name: "Есимов", callsign: "11-44", role: "водитель S3" },
      ],
    },
  ],
  transport: [
    {
      code: "VIP",
      car: "Mercedes-Benz Pullman S600 W222, 2019 г.в.",
      note: "бронь, гостевой парк",
    },
    {
      code: "VIP-1",
      car: "Mercedes-Benz S580 W223, 2022 г.в.",
      note: "не бронь, УДП",
    },
    { code: "R", car: "Mercedes-Benz S580 W223, 2023 г.в.", note: "не бронь, УДП" },
  ],
  visits: [
    {
      day: "18.06.2026",
      weekday: "четверг",
      items: [
        { obj: "Мейрам", note: "«ночь» — Офис" },
        { obj: "Сапар", note: "Тлесов, позывной 2-14" },
      ],
    },
    {
      day: "19.06.2026",
      weekday: "пятница",
      items: [
        { obj: "Мейрам", note: "«день» — Мейрам, позывной 2-20" },
        { obj: "Тарлан", note: "Мухамадиев, позывной 2-13" },
        { obj: "Зангер", note: "Битен, позывной 2-32" },
        { obj: "МФЦА", note: "Асаинов, позывной 2-12" },
        { obj: "Алем-Ай", note: "Тлесов, позывной 2-14" },
        { obj: "Мейрам (ужин)", note: "Мейрам, позывной 2-20" },
        { obj: "Мейрам", note: "«ночь» — Офис" },
      ],
    },
    {
      day: "20.06.2026",
      weekday: "суббота",
      items: [
        { obj: "Мейрам", note: "«день» — Жиенбай, позывной 2-26" },
        { obj: "Мұражай", note: "Битен, позывной 2-32" },
        { obj: "MNU", note: "Асаинов, позывной 2-12" },
        { obj: "Аргымак", note: "Мухамадиев, позывной 2-13" },
        { obj: "Жетису (обед)", note: "Қыран" },
        { obj: "Мейрам", note: "«ночь» — Офис" },
      ],
    },
    {
      day: "21.06.2026",
      weekday: "воскресенье",
      items: [{ obj: "Сапар", note: "Тлесов, позывной 2-14" }],
    },
  ],
};

function nowIso(): string {
  return new Date().toISOString();
}

function buildSeed(): GvoSummaryPatchRecord[] {
  // Живой реестр ОМ мок не видит: его коды приходят с бэка, привязать к ним
  // демо-сводку нечем. Значит, на живых данных правок изначально нет — так и
  // должно быть, все сводки стартуют черновиками.
  if (isOpsSecurityEventsLive()) return [];
  const first = readSecurityEventsStore()[0];
  if (first === undefined) return [];
  return [{ omCode: first.code, patch: MONTENEGRO_PATCH, updatedAt: nowIso() }];
}

let records: GvoSummaryPatchRecord[] | null = null;

function loadPersisted(): GvoSummaryPatchRecord[] | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw === null ? null : (JSON.parse(raw) as GvoSummaryPatchRecord[]);
  } catch {
    return null;
  }
}

function persist(next: GvoSummaryPatchRecord[]): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // квота/приватный режим — живём в памяти документа
  }
}

function getRecords(): GvoSummaryPatchRecord[] {
  if (records === null) {
    records = loadPersisted() ?? buildSeed();
    persist(records);
  }
  return records;
}

function saveRecord(omCode: string, patch: GvoSummaryPatch): GvoSummaryPatchRecord {
  const record: GvoSummaryPatchRecord = {
    omCode,
    patch,
    updatedAt: nowIso(),
  };
  const rest = getRecords().filter((item) => item.omCode !== omCode);
  // Пустой патч не хранится: «Вернуть исходные» по последнему разделу обязано
  // возвращать сводку в состояние «Черновик», а не оставлять пустую запись,
  // которую isGvoSummaryFilled прочитает как «Заполнена».
  records = Object.keys(patch).length === 0 ? rest : [...rest, record];
  persist(records);
  return record;
}

function currentPatch(omCode: string): GvoSummaryPatch {
  return getRecords().find((item) => item.omCode === omCode)?.patch ?? {};
}

/** Код ОМ в пути закодирован (кириллица) — обратно его читаем сами. */
function decodeCode(raw: string | readonly string[] | undefined): string {
  const value = typeof raw === "string" ? raw : "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export const gvoHandlers = [
  http.get(`*${GVO_SUMMARIES_PATH}`, () =>
    HttpResponse.json<ListGvoSummaryPatchesResponse>({ results: getRecords() })
  ),

  // Паттерны собраны литералом, а не gvoSummaryPatchPath(":omCode"): хелпер
  // кодирует сегмент (кириллица в коде ОМ), и «:omCode» превратился бы в
  // «%3AomCode» — плейсхолдер MSW перестал бы быть плейсхолдером.
  http.patch(`*${GVO_SUMMARIES_PATH}:omCode/`, async ({ params, request }) => {
    const omCode = decodeCode(params.omCode);
    const body = (await request.json()) as UpdateGvoSummaryRequest;
    const merged: GvoSummaryPatch = { ...currentPatch(omCode), ...body.values };
    return HttpResponse.json(saveRecord(omCode, merged));
  }),

  http.post(`*${GVO_SUMMARIES_PATH}:omCode/reset/`, async ({ params, request }) => {
    const omCode = decodeCode(params.omCode);
    const body = (await request.json()) as ResetGvoSummaryRequest;
    const next: GvoSummaryPatch = { ...currentPatch(omCode) };
    for (const key of gvoSectionPatchKeys(body.section)) {
      delete next[key];
    }
    return HttpResponse.json(saveRecord(omCode, next));
  }),
];
