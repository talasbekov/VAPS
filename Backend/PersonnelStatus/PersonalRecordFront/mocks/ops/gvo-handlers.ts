// MSW-handlers «Реестр ГВО». Хранится только патч ручных правок по коду ОМ;
// база сводки ВЫВОДИТСЯ ЗДЕСЬ, в мок-слое (mocks/ops/gvo-derive.ts).
//
// С Plane №166 сборку делает сервер, и экраны читают её у него. Мок обязан
// отвечать тем же, иначе он зелен там, где живой бэк отвечал бы иначе, —
// поэтому правило вывода переехало из entities СЮДА: экрану оно больше
// недоступно, и случайно собрать сводку на клиенте уже нельзя.
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
  GVO_SUMMARIES_ASSEMBLED_PATH,
  GVO_SUMMARIES_PATH,
  gvoSectionPatchKeys,
  missingRequiredFields,
  REQUIRED_VISIT_FIELDS,
  UNSPECIFIED,
} from "@/entities/gvo-summary";
import { deriveGvoSummary, mergeGvoSummary } from "./gvo-derive";
import type {
  GvoSummary,
  GvoSummaryPatch,
  GvoSummaryPatchRecord,
  GvoSummaryRow,
  ListGvoSummariesResponse,
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
  wishes: "",
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
  // «Объекты посещения» демо-патчем НЕ кладутся («Реестр ОМ-35.1»): список
  // объектов приходит из таблицы мероприятия, и патч тут был бы вторым
  // списком тех же объектов — ровно то расхождение, которое задача убирает.
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

function saveRecord(
  omCode: string,
  patch: GvoSummaryPatch,
  extra: { unspecified?: string[]; approvedAt?: string | null } = {}
): GvoSummaryPatchRecord {
  const previous = getRecords().find((item) => item.omCode === omCode);
  const record: GvoSummaryPatchRecord = {
    omCode,
    patch,
    updatedAt: nowIso(),
    // Флаги и отметка утверждения ПЕРЕЖИВАЮТ правку патча: помеченное
    // «уточняется» не должно сниматься оттого, что человек сохранил соседний
    // раздел (Plane №691).
    unspecified: extra.unspecified ?? previous?.unspecified ?? [],
    approvedAt:
      extra.approvedAt !== undefined
        ? extra.approvedAt
        : (previous?.approvedAt ?? null),
  };
  const rest = getRecords().filter((item) => item.omCode !== omCode);
  // Пустой патч не хранится: «Вернуть исходные» по последнему разделу обязано
  // возвращать сводку в состояние «Черновик», а не оставлять пустую запись,
  // которую isGvoSummaryFilled прочитает как «Заполнена». Флаги и утверждение
  // держат запись живой наравне с патчем — иначе помеченное «уточняется»
  // исчезало бы вместе с последним сохранённым разделом.
  const empty =
    Object.keys(patch).length === 0 &&
    (record.unspecified ?? []).length === 0 &&
    record.approvedAt === null;
  records = empty ? rest : [...rest, record];
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

/** Строка собранной сводки — то же, что отдаёт сервер по одному ОМ.
 *
 * 🔴 ОБЯЗАТЕЛЬНЫЕ ПОЛЯ СЧИТАЮТСЯ И ЗДЕСЬ (Plane №691). Без `missingRequired`
 * и счётчиков экран визита прятал прогресс (проверка `total > 0`), считал
 * `approveBlocker` пустым и рисовал «Утвердить» ВКЛЮЧЁННОЙ — то есть правило
 * `[ГВО-07]` на мок-стенде не воспроизводилось вовсе, а реестр вырождался в
 * голое «Черновик» без счётчиков.
 */
function assembledRow(event: { code: string }): GvoSummaryRow {
  const record = getRecords().find((item) => item.omCode === event.code);
  const patch = record?.patch ?? {};
  const unspecified = record?.unspecified ?? [];
  const summary = mergeGvoSummary(deriveGvoSummary(event as never), patch);
  const missing = missingRequiredFields(summary, unspecified);
  const approvedAt = record?.approvedAt ?? null;
  return {
    omCode: event.code,
    summary,
    filled: Object.keys(patch).length > 0,
    // Визит (Plane №435): мок держит его у каждой строки — черновик/заполнен.
    visit: {
      status:
        approvedAt !== null
          ? "APPROVED"
          : Object.keys(patch).length > 0
            ? "READY"
            : "DRAFT",
      version: 1,
      protectedPersonId: null,
      unspecified,
      approvedAt,
    },
    unspecified,
    missingRequired: missing,
    requiredTotal: REQUIRED_VISIT_FIELDS.length,
    requiredFilled: REQUIRED_VISIT_FIELDS.length - missing.length,
    updatedAt: record?.updatedAt ?? null,
  };
}

export const gvoHandlers = [
  // Собранные сводки ВСЕХ мероприятий. Порядок по коду — как на сервере.
  // Стоит ПЕРЕД паттерном с `:omCode`: иначе «assembled» уехал бы в него
  // сегментом и мок ответил бы сводкой мероприятия с таким кодом.
  http.get(`*${GVO_SUMMARIES_ASSEMBLED_PATH}`, () =>
    HttpResponse.json<ListGvoSummariesResponse>({
      results: [...readSecurityEventsStore()]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map(assembledRow),
    })
  ),

  http.get(`*${GVO_SUMMARIES_PATH}`, () =>
    HttpResponse.json<ListGvoSummaryPatchesResponse>({ results: getRecords() })
  ),

  http.get(`*${GVO_SUMMARIES_PATH}:omCode/`, ({ params }) => {
    const omCode = decodeCode(params.omCode);
    const event = readSecurityEventsStore().find((item) => item.code === omCode);
    // Мероприятия нет — 404, как на сервере. Пустая сводка читалась бы как
    // «мероприятие есть, но не заполнено», и опечатка в коде выглядела бы
    // рабочим экраном.
    if (event === undefined) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json<GvoSummaryRow>(assembledRow(event));
  }),

  // Паттерны собраны литералом, а не gvoSummaryPatchPath(":omCode"): хелпер
  // кодирует сегмент (кириллица в коде ОМ), и «:omCode» превратился бы в
  // «%3AomCode» — плейсхолдер MSW перестал бы быть плейсхолдером.
  http.patch(`*${GVO_SUMMARIES_PATH}:omCode/`, async ({ params, request }) => {
    const omCode = decodeCode(params.omCode);
    const body = (await request.json()) as UpdateGvoSummaryRequest;
    const merged: GvoSummaryPatch = { ...currentPatch(omCode), ...body.values };
    // Флаги приходят ТЕМ ЖЕ запросом, что и значения: правка нескольких
    // разделов уезжает одним PATCH (Plane №694).
    return HttpResponse.json(
      saveRecord(omCode, merged, {
        ...(body.unspecified === undefined ? {} : { unspecified: body.unspecified }),
        // Правка снимает утверждение (Plane №685): оно относилось к прежнему
        // составу, и оставить его — значит показывать «Утверждён» рядом с
        // другим содержимым.
        approvedAt: null,
      })
    );
  }),

  /**
   * «Утвердить» визит (`[ГВО-07]`) — обработчика НЕ БЫЛО ВОВСЕ (Plane №691).
   * Нажатие уходило в необработанный маршрут, а MSW настроен на
   * `onUnhandledRequest: 'bypass'` и пропускал запрос В СЕТЬ: на мок-стенде
   * кнопка молча била по настоящему серверу либо в никуда.
   *
   * Отказ при незаполненных обязательных полях — тот же, что у сервера: мок,
   * который «утверждает» всегда, зелен ровно там, где правило и живёт.
   */
  http.post(`*${GVO_SUMMARIES_PATH}:omCode/approve/`, ({ params }) => {
    const omCode = decodeCode(params.omCode);
    const event = readSecurityEventsStore().find((item) => item.code === omCode);
    if (event === undefined) {
      return HttpResponse.json({ detail: "Мероприятие не найдено." }, { status: 404 });
    }
    const row = assembledRow(event);
    if ((row.missingRequired ?? []).length > 0) {
      return HttpResponse.json(
        {
          error_code: "VISIT_REQUIRED_FIELDS_MISSING",
          detail: `Заполните обязательные поля: ${(row.missingRequired ?? []).join(", ")}.`,
        },
        { status: 422 }
      );
    }
    if (row.visit?.approvedAt != null) {
      return HttpResponse.json(
        { error_code: "VISIT_ALREADY_APPROVED", detail: "Визит уже утверждён." },
        { status: 422 }
      );
    }
    saveRecord(omCode, currentPatch(omCode), { approvedAt: nowIso() });
    return HttpResponse.json<GvoSummaryRow>(assembledRow(event));
  }),

  http.post(`*${GVO_SUMMARIES_PATH}:omCode/reset/`, async ({ params, request }) => {
    const omCode = decodeCode(params.omCode);
    const body = (await request.json()) as ResetGvoSummaryRequest;
    const next: GvoSummaryPatch = { ...currentPatch(omCode) };
    const keys = gvoSectionPatchKeys(body.section);
    for (const key of keys) {
      delete next[key];
    }
    // Флаги раздела снимаются вместе с его данными (Plane №689): пометка не
    // должна переживать поле, которое поясняла. Принадлежность — по ПЕРВОМУ
    // сегменту пути, как и на сервере.
    const kept = (
      getRecords().find((item) => item.omCode === omCode)?.unspecified ?? []
    ).filter((path) => !keys.includes(path.split(".")[0] as never));
    return HttpResponse.json(
      saveRecord(omCode, next, { unspecified: kept, approvedAt: null })
    );
  }),
];
