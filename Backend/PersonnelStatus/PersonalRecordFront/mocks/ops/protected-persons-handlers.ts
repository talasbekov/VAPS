// MSW-handlers каталога охраняемых лиц. С 20.08.2026 у справочника есть
// живой бэк (/api/ops/protected-persons/): домен `protected-persons` живой
// по умолчанию, handlers регистрируются только когда домен возвращён на мок
// (NEXT_PUBLIC_OPS_MOCK_DOMAINS) — см. mocks/ops/handlers.ts.
//
// Ведущая «*» в паттерне обязательна: в dev клиент бьёт по абсолютному
// BACKEND_URL (http://localhost:8100), и относительный путь резолвился бы от
// origin документа (:3106) — запрос молча ушёл бы в сеть мимо мока.
import { http, HttpResponse } from "msw";
import { PROTECTED_PERSONS_PATH } from "@/entities/protected-person";
import { readEventsStore } from "./security-events-handlers";
import type {
  CreateProtectedPersonRequest,
  ListProtectedPersonsResponse,
  ProtectedPerson,
} from "@/entities/protected-person";

/** Каталог прототипа: состав и формулировки перенесены дословно. */
export const PROTECTED_PERSONS_CATALOG: ProtectedPerson[] = [
  {
    id: "pp-1",
    code: "OL-1",
    name: "Оспанов Бахыт Дюсенбаевич",
    callsign: "Сокол",
    category: "OURS",
    bio: "Государственный служащий высшего звена, куратор международных визитов. Под охраной с 2019 года.",
    photoUrl: null,
    country: "Казахстан",
    position: "",
    facts: [],
  },
  {
    id: "pp-2",
    code: "OL-2",
    name: "Салимова Гульнара Ержановна",
    callsign: "Гранит",
    category: "OURS",
    bio: "Руководитель аппарата, регулярный участник протокольных мероприятий республиканского уровня.",
    photoUrl: null,
    country: "Казахстан",
    position: "",
    facts: [],
  },
  {
    id: "pp-3",
    code: "OL-3",
    name: "Ахметов Тимур Болатович",
    callsign: "Беркут",
    category: "OURS",
    bio: "Член правительственной делегации, курирует вопросы регионального взаимодействия.",
    photoUrl: null,
    country: "Казахстан",
    position: "",
    facts: [],
  },
  {
    id: "pp-4",
    code: "OL-4",
    name: "James Miller",
    callsign: "Дельта-1",
    category: "FOREIGN",
    bio: "Глава иностранной делегации. Визит согласован по линии МИД, повышенные требования к сопровождению.",
    photoUrl: null,
    country: "США",
    position: "Глава делегации",
    facts: [],
  },
  {
    id: "pp-5",
    code: "OL-5",
    name: "Hassan Al-Farsi",
    callsign: "Оазис",
    category: "FOREIGN",
    bio: "Официальный представитель иностранного государства, прибывает с собственной группой сопровождения.",
    photoUrl: null,
    country: "Оман",
    position: "Заместитель Премьер-министра по экономическим вопросам",
    facts: [],
  },
];

export const protectedPersonsHandlers = [
  // История ОМ лица (Plane №38). ПЕРЕД списком: путь списка иначе съел бы
  // `/{id}/history/` более ранним совпадением.
  //
  // Мок собирает её из своего же стора мероприятий по тем же правилам, что
  // сервер: только ЗАКРЫТЫЕ ОМ, и объекты — только те, где названо ЭТО лицо.
  // Шаблон написан руками, а не собран помощником (Plane №795): у
  // `protectedPersonHistoryPath` внутри `encodeURIComponent`, и на `":id"`
  // выходит `%3Aid` — литерал вместо параметра, обработчик недостижим.
  http.get(`*${PROTECTED_PERSONS_PATH}:id/history/`, ({ params }) => {
    const id = params.id as string;
    const rows = readEventsStore()
      .filter((event) => event.stage === "CLOSED")
      .map((event) => ({
        event,
        objects: event.visitObjects.filter(
          (visit) => visit.protectedPersonId === id
        ),
      }))
      .filter(
        ({ event, objects }) =>
          objects.length > 0 || event.protectedPersonId === id
      )
      .map(({ event, objects }) => ({
        eventId: event.id,
        code: event.code,
        title: event.title,
        kind: event.kind,
        businessDate: event.businessDate,
        businessDateEnd: event.businessDateEnd,
        closedAt: event.closedAt,
        chiefName: event.chiefName,
        objects: objects.map((visit) => ({
          visitObjectId: visit.id,
          objectId: visit.objectId,
          objectName: visit.objectName,
          visitDay: visit.visitDay,
          note: visit.note,
        })),
      }))
      // Новые сверху: историю читают от последнего.
      .sort((a, b) =>
        a.businessDate === b.businessDate
          ? b.code.localeCompare(a.code)
          : b.businessDate.localeCompare(a.businessDate)
      );
    return HttpResponse.json({ results: rows });
  }),

  http.get(`*${PROTECTED_PERSONS_PATH}`, () =>
    HttpResponse.json<ListProtectedPersonsResponse>({
      results: PROTECTED_PERSONS_CATALOG,
    })
  ),

  // Заведение лица с экрана (Plane №951) — паритет с сервером: пустое имя и
  // чужая категория отбиваются 400, а не ложатся в каталог молча.
  http.post(`*${PROTECTED_PERSONS_PATH}`, async ({ request }) => {
    const body = (await request.json()) as CreateProtectedPersonRequest;
    const name = (body.name ?? "").trim();
    const details: Record<string, string[]> = {};
    if (name === "") details.name = ["Обязательное поле."];
    if (body.category !== "OURS" && body.category !== "FOREIGN") {
      details.category = ["Категория — «Наши» или «Иностранные»."];
    }
    if (Object.keys(details).length > 0) {
      return HttpResponse.json(
        { error_code: "VALIDATION_ERROR", message: "Проверьте поля лица.", details },
        { status: 400 }
      );
    }
    const id = `pp-${PROTECTED_PERSONS_CATALOG.length + 1}`;
    const person: ProtectedPerson = {
      id,
      code: `OL-${PROTECTED_PERSONS_CATALOG.length + 1}`,
      name,
      callsign: (body.callsign ?? "").trim(),
      category: body.category,
      bio: (body.bio ?? "").trim(),
      photoUrl: null,
      // Данные образца (Plane №952) — паритет с сервером: пустые строки
      // отбрасываются.
      country: (body.country ?? "").trim(),
      position: (body.position ?? "").trim(),
      facts: (body.facts ?? [])
        .map((row) => ({ key: row.key.trim(), value: row.value.trim() }))
        .filter((row) => row.key !== ""),
    };
    PROTECTED_PERSONS_CATALOG.push(person);
    return HttpResponse.json(person, { status: 201 });
  }),

  // Снимок лица (Plane №951): мок не хранит байты — кладёт data-URL, чтобы
  // карточка на мок-стенде показала снимок, а не заглушку.
  http.post(`*${PROTECTED_PERSONS_PATH}:id/photo/`, async ({ params, request }) => {
    const person = PROTECTED_PERSONS_CATALOG.find((row) => row.id === params.id);
    if (person === undefined) {
      return HttpResponse.json({ detail: "Охраняемое лицо не найдено." }, { status: 404 });
    }
    const form = await request.formData();
    const file = form.get("photo");
    if (!(file instanceof File) || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
      return HttpResponse.json(
        {
          error_code: "VALIDATION_ERROR",
          message: "Проверьте файл снимка.",
          details: { photo: ["Допустимы JPEG, PNG или WebP."] },
        },
        { status: 400 }
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    person.photoUrl = `data:${file.type};base64,${btoa(binary)}`;
    return HttpResponse.json(person);
  }),
];
