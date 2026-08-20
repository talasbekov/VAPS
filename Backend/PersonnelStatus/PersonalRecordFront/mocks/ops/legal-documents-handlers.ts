// MSW-handlers нормативной базы ОМ. С 21.08.2026 у справочника есть живой
// бэк (/api/ops/legal-documents/): домен `legal-documents` живой по
// умолчанию, handlers регистрируются только при возврате домена на мок
// (NEXT_PUBLIC_OPS_MOCK_DOMAINS) — см. mocks/ops/handlers.ts.
//
// Ведущая «*» в паттерне обязательна: в dev клиент бьёт по абсолютному
// BACKEND_URL (http://localhost:8100), и относительный путь резолвился бы от
// origin документа (:3106) — запрос молча ушёл бы в сеть мимо мока.
import { http, HttpResponse } from "msw";
import { LEGAL_DOCUMENTS_PATH } from "@/entities/legal-document";
import type {
  LegalDocument,
  ListLegalDocumentsResponse,
} from "@/entities/legal-document";

/**
 * Каталог прототипа: состав, номера и формулировки перенесены дословно.
 * fileUrl у всех null — файлов нормативки в системе нет, и подставлять сюда
 * правдоподобную ссылку значило бы нарисовать работающую кнопку «Скачать».
 */
const CATALOG: LegalDocument[] = [
  {
    id: "ld-1",
    kind: "LAW",
    code: "№ 174-V ЗРК",
    title: "О государственной охране",
    description:
      "Основы правового статуса охраняемых лиц, полномочия и порядок организации охранных мероприятий.",
    revision: "актуален с 02.2024",
    status: "IN_FORCE",
    pages: 48,
    fileUrl: null,
  },
  {
    id: "ld-2",
    kind: "LAW",
    code: "№ 380-V ЗРК",
    title: "О национальной безопасности",
    description:
      "Общие принципы обеспечения безопасности при проведении охранных мероприятий.",
    revision: "актуален с 06.2023",
    status: "IN_FORCE",
    pages: 62,
    fileUrl: null,
  },
  {
    id: "ld-3",
    kind: "ORDER",
    code: "Приказ № 112",
    title: "Об утверждении Инструкции по организации ОМ",
    description:
      "Порядок бюллетеня, рекогносцировки, расстановки сил и закрытия мероприятия.",
    revision: "обновлён 03.2025",
    status: "IN_FORCE",
    pages: 34,
    fileUrl: null,
  },
  {
    id: "ld-4",
    kind: "ORDER",
    code: "Приказ № 89",
    title: "О нормах расстановки постов",
    description:
      "Нормативы плотности постов, минимального состава смены и резерва.",
    revision: "обновлён 11.2024",
    status: "IN_FORCE",
    pages: 19,
    fileUrl: null,
  },
  {
    id: "ld-5",
    kind: "REGULATION",
    code: "Регламент СШ-04",
    title: "Регламент работы штаба при ОМ",
    description:
      "Ведение журнала штаба, порядок фиксации инцидентов и санкционирования замен.",
    revision: "обновлён 01.2026",
    status: "IN_FORCE",
    pages: 15,
    fileUrl: null,
  },
  {
    id: "ld-6",
    kind: "REGULATION",
    code: "Регламент СГ-02",
    title: "Регламент согласования и подписания ЭЦП",
    description:
      "Требования к проверке конфликтов версии перед подписанием расстановки.",
    revision: "обновлён 09.2024",
    status: "IN_FORCE",
    pages: 11,
    fileUrl: null,
  },
  {
    id: "ld-7",
    kind: "INSTRUCTION",
    code: "Инструкция И-17",
    title: "Действия при инциденте на посту",
    description:
      "Алгоритм фиксации, эскалации и передачи ответственному при нарушении режима.",
    revision: "обновлён 04.2025",
    status: "IN_FORCE",
    pages: 9,
    fileUrl: null,
  },
  {
    id: "ld-8",
    kind: "INSTRUCTION",
    code: "Инструкция И-05",
    title: "Инструктаж и ознакомление личного состава",
    description:
      "Порядок подтверждения ознакомления с назначением перед заступлением.",
    revision: "обновлён 07.2023",
    status: "UNDER_REVIEW",
    pages: 7,
    fileUrl: null,
  },
];

export const legalDocumentsHandlers = [
  http.get(`*${LEGAL_DOCUMENTS_PATH}`, () =>
    HttpResponse.json<ListLegalDocumentsResponse>({ results: CATALOG })
  ),
];
