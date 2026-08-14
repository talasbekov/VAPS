// MSW-handlers каталога охраняемых лиц. Своего бэкенда у справочника нет
// вовсе (см. lib/api-gaps.ts), поэтому handlers регистрируются безусловно,
// без пер-доменного live-переключателя.
//
// Ведущая «*» в паттерне обязательна: в dev клиент бьёт по абсолютному
// BACKEND_URL (http://localhost:8100), и относительный путь резолвился бы от
// origin документа (:3106) — запрос молча ушёл бы в сеть мимо мока.
import { http, HttpResponse } from "msw";
import { PROTECTED_PERSONS_PATH } from "@/entities/protected-person";
import type {
  ListProtectedPersonsResponse,
  ProtectedPerson,
} from "@/entities/protected-person";

/** Каталог прототипа: состав и формулировки перенесены дословно. */
const CATALOG: ProtectedPerson[] = [
  {
    id: "pp-1",
    name: "Оспанов Бахыт Дюсенбаевич",
    callsign: "Сокол",
    category: "OURS",
    bio: "Государственный служащий высшего звена, куратор международных визитов. Под охраной с 2019 года.",
  },
  {
    id: "pp-2",
    name: "Салимова Гульнара Ержановна",
    callsign: "Гранит",
    category: "OURS",
    bio: "Руководитель аппарата, регулярный участник протокольных мероприятий республиканского уровня.",
  },
  {
    id: "pp-3",
    name: "Ахметов Тимур Болатович",
    callsign: "Беркут",
    category: "OURS",
    bio: "Член правительственной делегации, курирует вопросы регионального взаимодействия.",
  },
  {
    id: "pp-4",
    name: "James Miller",
    callsign: "Дельта-1",
    category: "FOREIGN",
    bio: "Глава иностранной делегации. Визит согласован по линии МИД, повышенные требования к сопровождению.",
  },
  {
    id: "pp-5",
    name: "Hassan Al-Farsi",
    callsign: "Оазис",
    category: "FOREIGN",
    bio: "Официальный представитель иностранного государства, прибывает с собственной группой сопровождения.",
  },
];

export const protectedPersonsHandlers = [
  http.get(`*${PROTECTED_PERSONS_PATH}`, () =>
    HttpResponse.json<ListProtectedPersonsResponse>({ results: CATALOG })
  ),
];
