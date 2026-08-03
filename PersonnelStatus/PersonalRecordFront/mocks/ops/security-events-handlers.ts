// MSW-handlers «Охранные мероприятия»: список с фильтрами/пагинацией,
// создание с привязкой версии паспорта по бизнес-дате, деталь,
// bindable-objects. Сид строится от живого стора объектов (не литеральные id).
// Персист — sessionStorage (sidebar ходит по <a>, полная перезагрузка).
import { http, HttpResponse } from "msw";
import {
  bindPassportVersion,
  resolveApplicableVersion,
  BINDABLE_OBJECTS_PATH,
  SECURITY_EVENTS_PATH,
  securityEventDetailPath,
} from "@/entities/security-event";
import type {
  BindableObject,
  CreateSecurityEventRequest,
  ListSecurityEventsResponse,
  SecurityEvent,
  SecurityEventStage,
} from "@/entities/security-event";
import { readObjectsStore } from "./objects-handlers";

const STORE_KEY = "ops-mock-security-events";

/** Шаблон чек-листа рекогносцировки нового ОМ. */
const RECON_CHECKLIST_TEMPLATE = [
  "Подъездные пути и парковка",
  "Периметр и ограждение",
  "Входные группы и КПП",
  "Пути эвакуации",
  "Связь и электропитание",
];

function nowIso(): string {
  return new Date().toISOString();
}

function businessDate(): string {
  return nowIso().slice(0, 10);
}

function emptyEvent(
  id: string,
  code: string,
  title: string,
  objectId: string | null,
  objectName: string,
  date: string,
  now: string
): SecurityEvent {
  return {
    id,
    code,
    title,
    objectId,
    objectName,
    passportBinding: null,
    businessDate: date,
    stage: "BULLETIN",
    readinessPercent: 0,
    forceNeed: 0,
    conflictsCount: 0,
    ownerName: "demo-admin",
    briefDescription: "",
    initialTasks: "",
    reconChecklist: RECON_CHECKLIST_TEMPLATE.map((label, index) => ({
      id: `${id}-checklist-${index}`,
      label,
      done: false,
      result: null,
      comment: "",
    })),
    reconSectorPosts: [],
    demandRows: [],
    demandApproved: false,
    forceRequests: [],
    placementAssignments: [],
    approvalStatus: "PENDING",
    approvalComment: "",
    journalEntries: [],
    closureDirectionSummaries: [],
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Демо-сид: три ОМ на объектах реестра в разных стадиях. */
function buildSeed(): SecurityEvent[] {
  const now = nowIso();
  const date = businessDate();
  const objects = readObjectsStore();
  const year = date.slice(0, 4);
  const withPassport = objects.find((o) => o.passportVersions.length > 0);
  const second = objects[1];
  const third = objects[2] ?? second;

  const events: SecurityEvent[] = [];

  if (withPassport !== undefined) {
    const e1 = emptyEvent(
      "se-1",
      `ОМ-${year}-1`,
      "Визит иностранной делегации",
      withPassport.id,
      withPassport.name,
      date,
      now
    );
    const applicable = resolveApplicableVersion(withPassport, date);
    if (applicable !== null) {
      e1.passportBinding = bindPassportVersion(withPassport, applicable, now);
    }
    e1.stage = "PLACEMENT";
    e1.readinessPercent = 65;
    e1.forceNeed = 24;
    e1.conflictsCount = 1;
    e1.briefDescription = "Обеспечение безопасности визита делегации.";
    e1.initialTasks = "Усиление постов, проверка периметра.";
    events.push(e1);
  }

  if (second !== undefined) {
    const e2 = emptyEvent(
      "se-2",
      `ОМ-${year}-2`,
      "Республиканское совещание",
      second.id,
      second.name,
      date,
      now
    );
    e2.stage = "BULLETIN";
    e2.readinessPercent = 10;
    e2.forceNeed = 12;
    events.push(e2);
  }

  if (third !== undefined) {
    const e3 = emptyEvent(
      "se-3",
      `ОМ-${year}-3`,
      "Спортивное мероприятие (архив)",
      third.id,
      third.name,
      "2026-07-15",
      now
    );
    e3.stage = "CLOSED";
    e3.readinessPercent = 100;
    e3.forceNeed = 40;
    e3.closedAt = "2026-07-16T18:00:00.000Z";
    events.push(e3);
  }

  return events;
}

let events: SecurityEvent[] | null = null;

function loadPersisted(): SecurityEvent[] | null {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    return raw === null ? null : (JSON.parse(raw) as SecurityEvent[]);
  } catch {
    return null;
  }
}

function persist(next: SecurityEvent[]): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // квота/приватный режим — живём в памяти документа
  }
}

function getEvents(): SecurityEvent[] {
  if (events === null) {
    events = loadPersisted() ?? buildSeed();
    persist(events);
  }
  return events;
}

function addEvent(created: SecurityEvent): void {
  events = [...getEvents(), created];
  persist(events);
}

function errorEnvelope(
  errorCode: string,
  message: string,
  details: Record<string, unknown>,
  status: number
) {
  return HttpResponse.json(
    {
      error_code: errorCode,
      message,
      details,
      request_id: null,
      timestamp: nowIso(),
    },
    { status }
  );
}

export const securityEventsHandlers = [
  // bindable-objects раньше детали: паттерн :id/ иначе съедает этот путь
  http.get(`*${BINDABLE_OBJECTS_PATH}`, () => {
    const results: BindableObject[] = readObjectsStore().map((object) => ({
      id: object.id,
      name: object.name,
      code: object.code,
      publishedVersionCount: object.passportVersions.length,
    }));
    return HttpResponse.json({ results });
  }),

  http.get(`*${SECURITY_EVENTS_PATH}`, ({ request }) => {
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
    const stage = url.searchParams.get("stage") as SecurityEventStage | null;
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const pageSize = Number(url.searchParams.get("page_size") ?? "20") || 20;

    let filtered = [...getEvents()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    if (stage) {
      filtered = filtered.filter((e) => e.stage === stage);
    }
    if (search !== "") {
      filtered = filtered.filter((e) =>
        `${e.title} ${e.code} ${e.objectName} ${e.ownerName}`
          .toLowerCase()
          .includes(search)
      );
    }
    const start = (page - 1) * pageSize;
    const response: ListSecurityEventsResponse = {
      count: filtered.length,
      next: start + pageSize < filtered.length ? String(page + 1) : null,
      previous: page > 1 ? String(page - 1) : null,
      results: filtered.slice(start, start + pageSize),
    };
    return HttpResponse.json(response);
  }),

  http.get(`*${securityEventDetailPath(":id")}`, ({ params }) => {
    const id = params.id as string;
    const found = getEvents().find((e) => e.id === id);
    if (found === undefined) {
      return errorEnvelope(
        "ENTITY_NOT_FOUND",
        "Мероприятие не найдено.",
        { id },
        404
      );
    }
    return HttpResponse.json(found);
  }),

  http.post(`*${SECURITY_EVENTS_PATH}`, async ({ request }) => {
    const body = (await request.json()) as CreateSecurityEventRequest;
    const fieldErrors: Record<string, string[]> = {};
    if (body.title.trim() === "") {
      fieldErrors.title = ["Обязательное поле."];
    }
    if (body.objectId.trim() === "") {
      fieldErrors.objectId = ["Обязательное поле."];
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.businessDate)) {
      fieldErrors.businessDate = ["Укажите дату в формате ГГГГ-ММ-ДД."];
    }
    const object =
      readObjectsStore().find((o) => o.id === body.objectId) ?? null;
    if (Object.keys(fieldErrors).length === 0 && object === null) {
      fieldErrors.objectId = ["Объект не найден в реестре."];
    }
    if (Object.keys(fieldErrors).length > 0) {
      return errorEnvelope(
        "VALIDATION_ERROR",
        "Проверьте заполнение формы.",
        fieldErrors,
        400
      );
    }

    const now = nowIso();
    const all = getEvents();
    const id = `se-${all.length + 1}-${Math.floor(Math.random() * 1000)}`;
    const created = emptyEvent(
      id,
      `ОМ-${body.businessDate.slice(0, 4)}-${all.length + 1}`,
      body.title.trim(),
      object!.id,
      object!.name,
      body.businessDate,
      now
    );
    // версия паспорта выбирается по бизнес-дате ОМ; её отсутствие — не ошибка
    // создания, расчёт постов будет ручным (карточка скажет об этом)
    const applicable = resolveApplicableVersion(object!, body.businessDate);
    if (applicable !== null) {
      created.passportBinding = bindPassportVersion(object!, applicable, now);
    }
    addEvent(created);
    return HttpResponse.json(created, { status: 201 });
  }),
];
