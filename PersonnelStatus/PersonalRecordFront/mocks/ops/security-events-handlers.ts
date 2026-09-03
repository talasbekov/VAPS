// MSW-handlers «Охранные мероприятия»: список с фильтрами/пагинацией,
// создание с привязкой версии паспорта по бизнес-дате, деталь,
// bindable-objects. Сид строится от живого стора объектов (не литеральные id).
// Персист — sessionStorage (sidebar ходит по <a>, полная перезагрузка).
//
// 🔴 МОК ЗЕРКАЛИТ ПРАВИЛА СЕРВЕРА, а не свои представления о них. Разошедшийся
// мок зелен там, где живой стек ведёт себя иначе, — и находят это не тестом, а
// через несколько задач (Plane №45: мок полгода требовал объект при создании
// ОМ, хотя бэк сделал его необязательным 24.08, и сценарий «бюллетень без
// маршрута» на моке был невоспроизводим).
//
// Правила создания, снятые с `create_event` (`apps/ops/security_events.py`):
// название обязательно; тип обязателен и только INTERNAL/FOREIGN; дата — ISO;
// дата окончания, если есть, — ISO и НЕ раньше начала; время, если есть, —
// ЧЧ:ММ; локация не длиннее 255; охраняемое лицо и старший — из справочников;
// объект НЕОБЯЗАТЕЛЕН, но выдуманный id отбивается. ОМ с объектом стартует с
// «Рекогносцировки» и получает объект посещения, без объекта — с «Бюллетеня» и
// без него. Меняется правило на сервере — правится и здесь, в тот же заход.
import { http, HttpResponse } from "msw";
import {
  bindPassportVersion,
  resolveApplicableVersion,
  BINDABLE_OBJECTS_PATH,
  OPS_PERSONNEL_PATH,
  SECURITY_EVENTS_PATH,
  securityEventAcknowledgePath,
  securityEventAcknowledgementCompletePath,
  securityEventApprovalApprovePath,
  securityEventApprovalReturnPath,
  securityEventApprovalRoutePath,
  securityEventApprovalSendPath,
  securityEventApprovalWithdrawPath,
  securityEventRemarkResolvePath,
  securityEventBulletinCompletePath,
  securityEventBulletinPath,
  securityEventClosePath,
  securityEventStagePath,
  securityEventDetailPath,
  securityEventForceAllocationPath,
  securityEventForcesSplitPath,
  securityEventJournalPath,
  securityEventPlacementAssignPath,
  securityEventPlacementCompletePath,
  securityEventPlacementUnassignPath,
  securityEventReconCompletePath,
  securityEventReconImportPath,
  securityEventReconPath,
  securityEventReplaceAssignmentPath,
  NO_PUBLISHED_VERSION_TEXT,
} from "@/entities/security-event";
import type {
  AddApproverRequest,
  AddJournalEntryRequest,
  AssignPlacementRequest,
  BindableObject,
  CloseSecurityEventRequest,
  CreateSecurityEventRequest,
  DecideApproverRequest,
  MoveApproverRequest,
  ResolveRemarkRequest,
  ForceAllocationRow,
  ForceRequest,
  JournalEntry,
  ListSecurityEventsResponse,
  PlacementAssignment,
  ReconChecklistItem,
  ReconSectorPost,
  ReplaceAssignmentRequest,
  ReturnPlacementRequest,
  SecurityEvent,
  SecurityEventStage,
  SplitForceDemandRequest,
  StaffingDemandRow,
  UpdateBulletinRequest,
  UpdateForceAllocationRequest,
  UpdateReconRequest,
} from "@/entities/security-event";
import { readObjectsStore } from "./objects-handlers";
import {
  findPersonnel,
  personnelDayStatus,
  personnelRowOn,
  personnelRating,
  RATING_BAND_MATCHES,
  PERSONNEL_ROSTER,
} from "./fixtures/personnel";
import { PROTECTED_PERSONS_CATALOG } from "./protected-persons-handlers";
import { appendAudit } from "./audit-store";

/** Подпись автозаявки на силы — порт `AUTO_FORCE_REQUEST_GROUP` бэкенда
 * (Plane №110). Не название пула, а источник числа: заявка одна на
 * мероприятие и говорит, откуда взялась. */
const AUTO_FORCE_REQUEST_GROUP = "По расчёту рекогносцировки";

/** Окно, в котором живёт сбор сил, — порт `_ALLOCATION_STAGES` бэкенда. */
const COLLECTION_STAGES: readonly SecurityEventStage[] = [
  "DEMAND",
  "FORCES",
  "PLACEMENT",
];

/** Свести числа автозаявки с фактом сбора — порт `_sync_auto_force_request`.
 *
 * Трогается ТОЛЬКО автозаявка: у мероприятий, которые вели числами по группам,
 * эти строки заполнял человек, и пересчёт затёр бы его работу. */
function syncAutoForceRequest(
  requests: SecurityEvent["forceRequests"],
  accepted: number,
  split = false
): SecurityEvent["forceRequests"] {
  if (requests.length !== 1 || requests[0].group !== AUTO_FORCE_REQUEST_GROUP) {
    return requests;
  }
  const requested = requests[0].requestedCount;
  const status =
    accepted >= requested && requested > 0
      ? "ALLOCATED"
      : accepted > 0
        ? "PARTIALLY_ALLOCATED"
        : split
          ? "SENT"
          : "NOT_SENT";
  return [{ ...requests[0], allocatedCount: accepted, status }];
}


const STORE_KEY = "ops-mock-security-events";

/** Шаблон чек-листа рекогносцировки нового ОМ. */
const RECON_CHECKLIST_TEMPLATE = [
  "Подъездные пути и парковка",
  "Периметр и ограждение",
  "Входные группы и КПП",
  "Пути эвакуации",
  "Связь и электропитание",
];

// Идентификаторы строк расчёта постов выдаёт СЕРВЕР (порт правила бэка,
// Plane №30): клиентская пометка не сохранённой строки живёт в памяти вкладки
// и после перезагрузки повторяется, а назначение по повторённому id уезжает в
// первый совпавший пост. Id сохраняется, только если он уже принадлежит этому
// ОМ и в этой правке встречается впервые.
function newPostId(): string {
  return `post-${Math.random().toString(16).slice(2, 14)}`;
}

function normalizePostIds<T extends { id: string; parentPostId?: string }>(
  rows: T[],
  knownIds: Set<string>
): T[] {
  const used = new Set<string>();
  const remap = new Map<string, string>();
  const normalized = rows.map((row) => {
    const original = (row.id ?? "").trim();
    let id = original;
    if (id === "" || !knownIds.has(id) || used.has(id)) {
      id = newPostId();
      while (used.has(id) || knownIds.has(id)) id = newPostId();
    }
    used.add(id);
    if (original !== "" && !remap.has(original)) remap.set(original, id);
    return { ...row, id };
  });
  // Подпост ссылается на родителя его же id, и родитель мог приехать в этой
  // же правке — ссылка на клиентское имя не пережила бы сохранение.
  return normalized.map((row) => {
    const parent = (row.parentPostId ?? "").trim();
    return parent !== "" && remap.has(parent)
      ? { ...row, parentPostId: remap.get(parent) as string }
      : row;
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Подпись расстановки: ЧТО именно согласуют. Сортированная — порядок
 * назначений в списке деталь хранения, а не факт о составе (порт правила
 * сервера, «ОМ-37.3»). */
function placementSignature(event: SecurityEvent): string {
  return [...event.placementAssignments]
    .map((item) => `${item.postId}:${item.employeeId}`)
    .sort()
    .join(";");
}

/** Снимки, зафиксированные отправкой на согласование. Живут рядом с моком, а
 * не в самом мероприятии: сервер их наружу не отдаёт, и поле в контракте было
 * бы выдумкой мока. */
const approvalSnapshots = new Map<string, string>();

/** Событие с пересчитанным признаком «расстановка изменилась после отправки».
 * Зовётся отовсюду, где меняется состав. */
function withStaleFlag(event: SecurityEvent): SecurityEvent {
  const snapshot = approvalSnapshots.get(event.id);
  return mirrorApproval({
    ...event,
    approvalStale:
      snapshot !== undefined && snapshot !== placementSignature(event),
  });
}

/**
 * Согласование мероприятия отражается в его объект посещения (Plane №411).
 *
 * У сервера правда живёт в ОБЪЕКТЕ, а поля мероприятия — вид первого объекта.
 * В мире мока объект у мероприятия ровно ОДИН (`emptyEvent` заводит его вместе
 * с ОМ), и потому обе картины совпадают до последнего поля — зеркало здесь
 * даёт клиенту ту же форму, что и сервер, не заводя в моке вторую реализацию
 * правил согласования. Как только у мока появятся ОМ с двумя объектами, это
 * место придётся переписать по-настоящему — и падать оно начнёт заметно, а не
 * молча: маршруты объектов совпадут там, где обязаны различаться.
 *
 * `documentVersion` НЕ трогается: у мероприятия такого поля нет вовсе, номер
 * растит только отправка на согласование.
 */
function mirrorApproval(event: SecurityEvent): SecurityEvent {
  return {
    ...event,
    visitObjects: event.visitObjects.map((visit) => ({
      ...visit,
      // Этап объекта в мире мока равен этапу мероприятия: объект у ОМ ровно
      // один, и наименьшая стадия среди одного — она сама (Plane №412).
      stage: event.stage,
      closedAt: event.closedAt,
      approvalStatus: event.approvalStatus,
      approvalComment: event.approvalComment,
      approvalRoute: event.approvalRoute,
      approvalRemarks: event.approvalRemarks,
      approvalStale: event.approvalStale,
    })),
  };
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
    // Транспорт на мероприятие не выделен: машины ставит в кортеж человек,
    // и подставлять их за него мок не вправе (Plane №215).
    vehicles: [],
    // Объект бюллетеня — он же первый (и единственный) объект посещения:
    // сервер заводит его вместе с ОМ, мок повторяет это, чтобы раскрытие
    // строки реестра не выглядело пустым.
    visitObjects: [
      {
        id: `${id}-visit-1`,
        objectId,
        objectName,
        passportBinding: null,
        protectedPersonId: null,
        protectedPersonName: "",
        position: 0,
        // Пустой день — «в дату мероприятия»: у свежего ОМ объект один, и
        // называть день второй раз незачем.
        visitDay: null,
        note: "",
        // Старший объекта не назначен: у свежего ОМ маршрут только заведён.
        chiefEmployeeId: null,
        chiefName: "",
        placementNeed: 0,
        placementAssigned: 0,
        deputies: [],
        // Этап объекта (Plane №412): у свежего ОМ он тот же, что у
        // мероприятия, — этапы ещё не начинались.
        stage: "BULLETIN",
        closedAt: null,
        // Согласование объекта (Plane №411) — свежий объект ничего ещё не
        // согласовывал, и версии документа у него нет: 0 значит «не
        // отправлялся», а не «версия ноль».
        approvalStatus: "PENDING",
        approvalComment: "",
        approvalRoute: [],
        approvalRemarks: [],
        approvalStale: false,
        documentVersion: 0,
      },
    ],
    businessDate: date,
    businessDateEnd: null,
    kind: null,
    eventTime: null,
    protectedPersonId: null,
    protectedPersonName: "",
    // Список лиц бюллетеня (Plane №188): у свежего ОМ он пуст ровно так же,
    // как пусто главное лицо. Мок обязан нести поле контракта — иначе экран,
    // читающий его, падал бы только на моке.
    protectedPersons: [],
    location: "",
    chiefEmployeeId: null,
    chiefName: "",
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
    reconForceRequest: 0,
    reconForceRequestedAt: null,
    demandRows: [],
    demandApproved: false,
    forceRequests: [],
    forceAllocation: [],
    forceRoster: [],
    forceDemandTotal: 0,
    placementAssignments: [],
    approvalStatus: "PENDING",
    approvalComment: "",
    approvalRoute: [],
    approvalRemarks: [],
    approvalStale: false,
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

/** Стор мероприятий для соседних мок-модулей: историю ОМ собирают карточки
 * лица и объекта, и второй копии стора у них быть не должно. */
export function readEventsStore(): SecurityEvent[] {
  return getEvents();
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

/** Read-доступ для соседних слайсов (справочники считают связи журнала). */
export function readSecurityEventsStore(): SecurityEvent[] {
  return getEvents();
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

function validationError(fieldErrors: Record<string, unknown>) {
  return errorEnvelope(
    "VALIDATION_ERROR",
    "Проверьте заполнение формы.",
    fieldErrors,
    400
  );
}

/** 422 — нарушение бизнес-правила (жёсткое, без обхода). */
function businessRuleError(code: string, message: string) {
  return errorEnvelope(code, message, {}, 422);
}

/** 409 — мягкий конфликт: SOFT_CONFLICT_DETECTED включает путь ConflictDialog. */
function softConflict(message: string, conflicts: Record<string, unknown>[]) {
  return errorEnvelope("SOFT_CONFLICT_DETECTED", message, { conflicts }, 409);
}

function saveEvent(updated: SecurityEvent): SecurityEvent {
  // `forceDemandTotal` — ВЫВОД, а не поле: сервер считает его при каждой
  // выдаче. В моке он пересчитывается здесь, на общем пути сохранения, иначе
  // каждая ручка обязана была бы помнить про него — и первая же забывшая
  // отдала бы клиенту раскладку с нулевой потребностью.
  const withTotal: SecurityEvent = mirrorApproval({
    ...updated,
    forceDemandTotal: updated.reconForceRequest || updated.forceNeed,
  });
  events = getEvents().map((e) => (e.id === withTotal.id ? withTotal : e));
  persist(events);
  return withTotal;
}

/** Либо ОМ, либо готовый 404-ответ — вызывающий обязан проверить `response`. */
function findEvent(id: string):
  | { event: SecurityEvent; response: null }
  | { event: null; response: Response } {
  const found = getEvents().find((e) => e.id === id);
  if (found === undefined) {
    return {
      event: null,
      response: errorEnvelope(
        "ENTITY_NOT_FOUND",
        "Мероприятие не найдено.",
        { id },
        404
      ),
    };
  }
  return { event: found, response: null };
}

/** Агрегация утверждённой потребности в запросы силам — по группам. */
function aggregateForceRequests(
  eventId: string,
  rows: StaffingDemandRow[]
): ForceRequest[] {
  const byGroup = new Map<string, number>();
  for (const row of rows) {
    byGroup.set(row.group, (byGroup.get(row.group) ?? 0) + row.need);
  }
  return [...byGroup.entries()].map(([group, requestedCount], index) => ({
    id: `${eventId}-force-request-${index}-${group}`,
    group,
    requestedCount,
    allocatedCount: 0,
    status: "NOT_SENT",
    comment: "",
  }));
}

/** Срок сдачи списка по умолчанию — за сутки до начала мероприятия (№287).
 *  Время ОМ мок не держит, поэтому началом считается полночь — как и на
 *  сервере, когда `eventTime` не заполнен. */
function defaultDueAt(businessDate: string): string {
  const start = new Date(`${businessDate}T00:00:00`);
  start.setDate(start.getDate() - 1);
  return start.toISOString();
}

/** Срок вышел, а список не отправлен. Отправленная и принятая заявка
 *  просроченной не считается: список уже у штаба. */
function isOverdue(status: string, dueAt: string | null | undefined): boolean {
  if (status === "SUBMITTED" || status === "ACCEPTED") return false;
  if (!dueAt) return false;
  return new Date(dueAt).getTime() < Date.now();
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
    const stage = url.searchParams.get("stage");
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const pageSize = Number(url.searchParams.get("page_size") ?? "20") || 20;

    let filtered = [...getEvents()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    if (stage) {
      // Список стадий через запятую — порт правила бэка (Plane №110): ленты
      // сбора сил спрашивают окно из трёх стадий одним запросом.
      const wanted = new Set(
        stage.split(",").map((part) => part.trim()).filter((part) => part !== "")
      );
      filtered = filtered.filter((e) => wanted.has(e.stage));
    }
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const owner = url.searchParams.get("owner") ?? "";
    if (from !== "") filtered = filtered.filter((e) => e.businessDate >= from);
    if (to !== "") filtered = filtered.filter((e) => e.businessDate <= to);
    if (owner !== "") filtered = filtered.filter((e) => e.ownerName === owner);
    if (search !== "") {
      filtered = filtered.filter((e) =>
        `${e.title} ${e.code} ${e.objectName} ${e.ownerName}`
          .toLowerCase()
          .includes(search)
      );
    }
    const start = (page - 1) * pageSize;
    const response: ListSecurityEventsResponse = {
      // Значения фильтра «ответственный» приходят с сервера — мок повторяет
      // форму конверта, иначе экран падал бы на живом ответе иначе, чем здесь.
      owners: [
        ...new Set(
          getEvents()
            .map((event) => event.ownerName)
            .filter((name) => name !== "")
        ),
      ].sort(),
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
    // Объект НЕОБЯЗАТЕЛЕН (решение заказчика 24.08, порт правила бэка, Plane
    // №45): бюллетень заводят, когда маршрут ещё не согласован, а объекты
    // дописывают позже кнопкой у строки реестра. Мок отбивал такое создание —
    // и сценарий «бюллетень без маршрута» на моке был невоспроизводим.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.businessDate)) {
      fieldErrors.businessDate = ["Укажите дату в формате ГГГГ-ММ-ДД."];
    }
    if (body.kind !== "INTERNAL" && body.kind !== "FOREIGN") {
      fieldErrors.kind = ["Обязательное поле."];
    }
    // Окончание: формат И порядок дат. Порядок мок не проверял вовсе, а бэк
    // проверяет — «окончание раньше начала» это не пустое поле, а неверный
    // факт: из такой пары нельзя посчитать ни продолжительность, ни убытие.
    const rawEnd = (body.businessDateEnd ?? "").trim();
    if (rawEnd !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawEnd)) {
        fieldErrors.businessDateEnd = ["Укажите дату в формате ГГГГ-ММ-ДД."];
      } else if (rawEnd < body.businessDate) {
        fieldErrors.businessDateEnd = ["Дата окончания раньше даты начала."];
      }
    }
    const rawTime = body.eventTime ?? "";
    if (rawTime !== "" && !/^\d{2}:\d{2}$/.test(rawTime)) {
      fieldErrors.eventTime = ["Укажите время в формате ЧЧ:ММ."];
    }
    if ((body.location ?? "").trim().length > 255) {
      fieldErrors.location = ["Не длиннее 255 символов."];
    }
    // Лиц может быть НЕСКОЛЬКО (Plane №188), и старое одиночное поле
    // принимается по-прежнему — ровно как на сервере: прислали список — он
    // главнее, нет — работает одиночное. Мок повторяет ЭТО правило, а не своё:
    // разойдясь, он зеленел бы там, где бэк отвечает отказом.
    const rawPersons: string[] =
      body.protectedPersonIds ??
      ((body.protectedPersonId ?? "") === "" ? [] : [body.protectedPersonId!]);
    const persons: { id: string; name: string }[] = [];
    const unknownPersons: string[] = [];
    for (const raw of rawPersons) {
      const id = (raw ?? "").trim();
      if (id === "" || persons.some((p) => p.id === id)) continue;
      const found = PROTECTED_PERSONS_CATALOG.find((p) => p.id === id) ?? null;
      if (found === null) unknownPersons.push(id);
      else persons.push({ id: found.id, name: found.name });
    }
    if (unknownPersons.length > 0) {
      fieldErrors[
        body.protectedPersonIds === undefined
          ? "protectedPersonId"
          : "protectedPersonIds"
      ] = [
        "Охраняемое лицо не найдено в справочнике: " +
          unknownPersons.join(", "),
      ];
    }
    // Главное — ПЕРВОЕ НАЗВАННОЕ, как на сервере.
    const person = persons.length > 0 ? persons[0]! : null;
    const rawChief = body.chiefEmployeeId ?? "";
    const chief = rawChief === "" ? null : (findPersonnel(rawChief) ?? null);
    if (rawChief !== "" && chief === null) {
      fieldErrors.chiefEmployeeId = ["Сотрудник не найден."];
    }
    const rawObject = (body.objectId ?? "").trim();
    const object =
      rawObject === ""
        ? null
        : (readObjectsStore().find((o) => o.id === rawObject) ?? null);
    // Отказ ТОЛЬКО на НЕСУЩЕСТВУЮЩЕМ объекте: пустой — это «не выбран», а
    // выдуманный id — ошибка, и молчать о ней нельзя.
    if (rawObject !== "" && object === null) {
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
      object === null ? null : object.id,
      // Пустое имя — «объект не выбран», а не «объект без названия»: экраны
      // различают это словами (порт правила бэка).
      object === null ? "" : object.name,
      body.businessDate,
      now
    );
    // Объект посещения заводится вместе с бюллетенем — но только если объект
    // ВЫБРАН: у ОМ без объекта раскрытие строки честно пусто, и там же стоит
    // кнопка их добавить.
    if (object === null) created.visitObjects = [];
    created.businessDateEnd =
      body.businessDateEnd === undefined || body.businessDateEnd === ""
        ? null
        : body.businessDateEnd;
    created.kind = body.kind;
    created.eventTime = rawTime === "" ? null : rawTime;
    created.protectedPersonId = person === null ? null : person.id;
    created.protectedPersonName = person === null ? "" : person.name;
    // Вывод сортируется ПО ИМЕНИ — как это делает сервер: у связи своего
    // порядка нет, и мок, отдающий «как легло», расходился бы с бэком в
    // порядке строк, то есть в том, что видно глазами.
    created.protectedPersons = [...persons].sort((a, b) =>
      a.name.localeCompare(b.name, "ru")
    );
    created.location = (body.location ?? "").trim();
    created.chiefEmployeeId = chief === null ? null : chief.id;
    created.chiefName = chief === null ? "" : chief.name;
    // версия паспорта выбирается по бизнес-дате ОМ; её отсутствие — не ошибка
    // создания, расчёт постов будет ручным (карточка скажет об этом)
    const applicable =
      object === null
        ? null
        : resolveApplicableVersion(object, body.businessDate);
    if (object !== null && applicable !== null) {
      created.passportBinding = bindPassportVersion(object, applicable, now);
    }
    // ОМ С ОБЪЕКТОМ открывается СРАЗУ рекогносцировкой (порт правила бэка,
    // Plane «Реестр ОМ-5»): в эталоне это первый шаг цепочки. Без объекта
    // осматривать нечего — ОМ остаётся на бюллетене.
    created.stage = object === null ? "BULLETIN" : "RECON";
    created.readinessPercent = object === null ? 0 : 15;
    addEvent(created);
    appendAudit({
      action: "security_event.create",
      entityType: "SecurityEvent",
      entityId: created.code,
      newValue: { title: created.title, businessDate: created.businessDate },
    });
    return HttpResponse.json(created, { status: 201 });
  }),

  // ── Кадровый список: поиск и страницы (Plane №61) ──────────────────────
  //
  // Мок обязан отвечать ТАК ЖЕ, как живая ручка: пока он отдавал весь список
  // и молча игнорировал `search`/`page`, на моке поиск «работал» всегда и
  // страницы не кончались — то есть мок был зелен там, где живой стек ведёт
  // себя иначе.
  http.get(`*${OPS_PERSONNEL_PATH}`, ({ request }) => {
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
    const found =
      search === ""
        ? PERSONNEL_ROSTER
        : PERSONNEL_ROSTER.filter((person) =>
            `${person.name} ${person.rankLabel} ${person.unit}`
              .toLowerCase()
              .includes(search)
          );
    const page = Math.max(Number(url.searchParams.get("page") ?? "1") || 1, 1);
    // Потолок страницы тот же, что у сервера: размер страницы назначает не
    // спросивший.
    const pageSize = Math.min(
      Math.max(Number(url.searchParams.get("page_size") ?? "20") || 20, 1),
      100
    );
    const start = (page - 1) * pageSize;
    // Статус — только на СПРОШЕННУЮ дату, как у сервера: без параметра оба
    // поля остаются null и означают «не спрашивали» (Plane №65, «Р-2»).
    const businessDate = (url.searchParams.get("business_date") ?? "").trim();

    // Рейтинг: отбор и порядок делает СЕРВЕР по всей выборке (Plane №67,
    // РЙ-4/РЙ-5), и мок обязан повторять это правило — мок, который отбирает
    // по-своему, зеленеет на контракте, которого нет.
    //
    // Право здесь не проверяется: в мок-режиме гейта прав нет вовсе, и
    // изображать отказ значило бы выдумать поведение. Отсутствие поля у
    // бесправного проверяется живой пробой, а не моком.
    const band = (url.searchParams.get("rating_band") ?? "").trim();
    const ordering = (url.searchParams.get("ordering") ?? "").trim();
    let selected = found;
    if (band !== "") {
      const matches = RATING_BAND_MATCHES[band];
      if (matches === undefined) {
        return errorEnvelope(
          "VALIDATION_ERROR",
          "Проверьте заполнение формы.",
          { rating_band: ["Неизвестная полоса рейтинга."] },
          400
        );
      }
      // Отбор ДО постранички — в этом вся задача РЙ-5.
      selected = selected.filter((person) => matches(personnelRating(person.id)));
    }
    if (ordering === "rating") {
      // Порядок по ВСЕЙ выборке; безоценочные в конец (`null` — не ноль),
      // второй ключ — имя, иначе страницы «плавали» бы.
      selected = [...selected].sort((a, b) => {
        const left = personnelRating(a.id);
        const right = personnelRating(b.id);
        if (left === null && right === null) return a.name.localeCompare(b.name, "ru");
        if (left === null) return 1;
        if (right === null) return -1;
        return right - left || a.name.localeCompare(b.name, "ru");
      });
    }
    return HttpResponse.json({
      results: selected.slice(start, start + pageSize).map((row) => ({
        ...personnelRowOn(row, businessDate),
        aggregateRating: personnelRating(row.id),
      })),
      count: selected.length,
      next: start + pageSize < selected.length ? String(page + 1) : null,
      previous: page > 1 ? String(page - 1) : null,
    });
  }),

  // ── Бюллетень ──────────────────────────────────────────────────────────
  http.patch(`*${securityEventBulletinPath(":id")}`, async ({ params, request }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    const body = (await request.json()) as UpdateBulletinRequest;
    const fieldErrors: Record<string, string[]> = {};
    if (body.briefDescription.trim() === "") {
      fieldErrors.briefDescription = ["Обязательное поле."];
    }
    if (body.initialTasks.trim() === "") {
      fieldErrors.initialTasks = ["Обязательное поле."];
    }
    if (Object.keys(fieldErrors).length > 0) return validationError(fieldErrors);
    return HttpResponse.json(
      saveEvent({
        ...event,
        briefDescription: body.briefDescription.trim(),
        initialTasks: body.initialTasks.trim(),
        updatedAt: nowIso(),
      })
    );
  }),

  http.post(`*${securityEventBulletinCompletePath(":id")}`, ({ params }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    if (event.stage !== "BULLETIN") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Бюллетень можно завершить только на этапе «Бюллетень»."
      );
    }
    // гейт держит ОБЪЕКТ, а не текст: осматривать нечего ровно тогда, когда
    // объекта нет (порт правила бэка, Plane «Реестр ОМ-5»)
    const hasObject =
      event.objectId !== null || (event.visitObjects ?? []).length > 0;
    if (
      !hasObject &&
      (event.briefDescription.trim() === "" || event.initialTasks.trim() === "")
    ) {
      return businessRuleError(
        "BULLETIN_INCOMPLETE",
        "Заполните и сохраните описание и первичные задачи либо добавьте объект посещения, прежде чем открывать рекогносцировку."
      );
    }
    return HttpResponse.json(
      saveEvent({ ...event, stage: "RECON", readinessPercent: 15, updatedAt: nowIso() })
    );
  }),

  // ── Рекогносцировка ────────────────────────────────────────────────────
  http.patch(`*${securityEventReconPath(":id")}`, async ({ params, request }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    const body = (await request.json()) as UpdateReconRequest;
    const fieldErrors: Record<string, string[]> = {};
    body.checklist.forEach((item, index) => {
      if (item.result === "NEEDS_CHANGES" && item.comment.trim() === "") {
        fieldErrors[`checklist.${index}.comment`] = ["Укажите комментарий."];
      }
    });
    body.sectorPosts.forEach((row, index) => {
      if (row.sector.trim() === "")
        fieldErrors[`sectorPosts.${index}.sector`] = ["Обязательное поле."];
      if (row.post.trim() === "")
        fieldErrors[`sectorPosts.${index}.post`] = ["Обязательное поле."];
      if (row.need < 1)
        fieldErrors[`sectorPosts.${index}.need`] = ["Должно быть не меньше 1."];
    });
    if (Object.keys(fieldErrors).length > 0) return validationError(fieldErrors);
    const checklist: ReconChecklistItem[] = body.checklist.map((item) => ({
      ...item,
      comment: item.comment.trim(),
    }));
    const knownIds = new Set(event.reconSectorPosts.map((row) => row.id));
    const sectorPosts: ReconSectorPost[] = normalizePostIds(
      body.sectorPosts.map((row) => ({
        ...row,
        sector: row.sector.trim(),
        post: row.post.trim(),
        task: row.task.trim(),
        // Смена — свойство поста (Plane №123): порт правила сервера.
        shift: (row.shift ?? "").trim(),
        requirements: row.requirements.trim(),
        comment: row.comment.trim(),
      })),
      knownIds
    );
    return HttpResponse.json(
      saveEvent({
        ...event,
        reconChecklist: checklist,
        reconSectorPosts: sectorPosts,
        // «Нет ключа» — не «ноль»: без этого правка расчёта постов стирала бы
        // запрос штабу (порт правила бэка, Plane «Реестр ОМ-23»).
        reconForceRequest:
          body.forceRequest === undefined
            ? event.reconForceRequest
            : body.forceRequest,
        updatedAt: nowIso(),
      })
    );
  }),

  http.post(`*${securityEventReconImportPath(":id")}`, async ({ params, request }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    if (event.stage !== "RECON") {
      return businessRuleError(
        "RECON_STAGE_REQUIRED",
        "Расчёт постов формируется на этапе рекогносцировки."
      );
    }
    // Импорт идёт из паспорта ОБЪЕКТА ПОСЕЩЕНИЯ (Plane №408): мок повторяет
    // правило сервера, иначе контракт зелен на одной стороне и врёт про другую.
    const body = (await request.json().catch(() => ({}))) as {
      visitObjectId?: string;
    };
    const visits = [...event.visitObjects].sort(
      (a, b) => a.position - b.position
    );
    if (visits.length === 0) {
      return businessRuleError(
        "VISIT_OBJECT_REQUIRED",
        "У мероприятия нет объектов посещения: добавьте объект — посты расчёта принадлежат ему, а не мероприятию."
      );
    }
    const target =
      body.visitObjectId === undefined || body.visitObjectId === ""
        ? visits.length > 1
          ? null
          : visits[0]
        : (visits.find((v) => v.id === body.visitObjectId) ?? undefined);
    if (target === null) {
      return businessRuleError(
        "VISIT_OBJECT_REQUIRED",
        "У мероприятия несколько объектов посещения — выберите, для какого импортировать посты."
      );
    }
    if (target === undefined) {
      return businessRuleError(
        "VISIT_OBJECT_NOT_FOUND",
        "Объект посещения не найден в этом мероприятии."
      );
    }
    const binding = event.passportBinding;
    if (binding === null) {
      return businessRuleError("NO_PASSPORT_VERSION", NO_PUBLISHED_VERSION_TEXT);
    }
    const object = readObjectsStore().find((o) => o.id === binding.objectId);
    const version =
      object?.passportVersions.find((v) => v.id === binding.versionId) ?? null;
    if (version === null) {
      return businessRuleError(
        "PASSPORT_VERSION_NOT_FOUND",
        "Привязанная версия паспорта недоступна — обратитесь к владельцу объекта."
      );
    }
    // импорт ДОБАВЛЯЕТ строки, не заменяет расчёт; повторный импорт не плодит
    // дубли — пост, уже пришедший из этой версии, пропускается
    // Повтор считается В ПРЕДЕЛАХ ОБЪЕКТА: один пост паспорта у двух объектов
    // посещения — два разных поста расчёта, а не дубль.
    const alreadyImported = new Set(
      event.reconSectorPosts
        .filter((row) => (row.visitObjectId ?? null) === target.id)
        .map((row) => row.sourcePostId)
        .filter((sourcePostId): sourcePostId is string => sourcePostId !== null)
    );
    const added: ReconSectorPost[] = [];
    for (const sector of version.sectors) {
      for (const post of sector.posts) {
        if (alreadyImported.has(post.id)) continue;
        added.push({
          id: newPostId(),
          sector: sector.name,
          post: post.name,
          task: post.task,
          // паспорт описывает пост, а не численность на мероприятие: 1 —
          // минимально допустимое значение, его уточняет старший наряда
          need: 1,
          // Смены в паспорте объекта нет: он описывает пост вообще, а смена —
          // про конкретное мероприятие. Заполняет старший наряда.
          shift: "",
          requirements: post.requirements,
          result: null,
          comment: "",
          sourceSectorId: sector.id,
          sourcePostId: post.id,
          minRating: null,
          visitObjectId: target.id,
        });
      }
    }
    if (added.length === 0) {
      return businessRuleError(
        "NOTHING_TO_IMPORT",
        "Все посты этой версии паспорта уже в расчёте."
      );
    }
    return HttpResponse.json(
      saveEvent({
        ...event,
        reconSectorPosts: [...event.reconSectorPosts, ...added],
        updatedAt: nowIso(),
      })
    );
  }),

  http.post(`*${securityEventReconCompletePath(":id")}`, ({ params }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    if (event.stage !== "RECON") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Рекогносцировку можно завершить только на этапе «Рекогносцировка»."
      );
    }
    if (!event.reconChecklist.every((item) => item.done)) {
      return businessRuleError(
        "RECON_CHECKLIST_INCOMPLETE",
        "Не все пункты чек-листа отмечены выполненными."
      );
    }
    if (event.reconSectorPosts.length === 0) {
      return businessRuleError(
        "RECON_SECTOR_POSTS_EMPTY",
        "Добавьте хотя бы один пост, прежде чем завершать этап."
      );
    }
    // Штабу уходит РАСЧЁТ ПО ПОСТАМ: запроса личного состава на этапе больше
    // нет (Plane №64). Уже сохранённый ручной ввод не затирается — порт
    // правила бэка.
    const requestedFromPosts = event.reconSectorPosts.reduce(
      (sum, row) => sum + Math.max(row.need || 0, 0),
      0
    );
    // Стадии «Потребность» и «Запрос сил» проходит сервер сам (Plane №110):
    // форм у них больше нет, и завершение осмотра выводит ОМ на «Расстановку».
    // Потребность собирается из расчёта постов, заявка на силы — одна.
    const demandRows = event.reconSectorPosts.map((post, index) => ({
      id: `demand-${index + 1}`,
      sector: post.sector,
      task: post.task !== "" ? post.task : post.post,
      shift: "",
      need: Math.max(post.need || 0, 0),
      group: "",
      requirements: post.requirements,
      comment: "",
    }));
    const forceNeed = demandRows.reduce((sum, row) => sum + row.need, 0);
    return HttpResponse.json(
      saveEvent({
        ...event,
        stage: "PLACEMENT",
        readinessPercent: 60,
        demandRows,
        demandApproved: true,
        forceNeed,
        forceRequests:
          forceNeed > 0
            ? [
                {
                  id: "force-request-1",
                  group: AUTO_FORCE_REQUEST_GROUP,
                  requestedCount: forceNeed,
                  allocatedCount: 0,
                  status: "NOT_SENT" as const,
                  comment: "",
                },
              ]
            : [],
        reconForceRequest:
          event.reconForceRequest < 1 ? requestedFromPosts : event.reconForceRequest,
        // Момент отправки штабу ставит ЗАВЕРШЕНИЕ этапа, а не правка расчёта.
        reconForceRequestedAt: nowIso(),
        updatedAt: nowIso(),
      })
    );
  }),

  // Обработчик `demand/approve` СНЯТ вместе с ручкой (Plane №149): мок
  // повторяет сервер, а на сервере этого пути больше нет.

  // ── Раскладка потребности по департаментам (Plane №73, СС-1) ───────────
  //
  // Стоит ВЫШЕ ручки выделения сил: та ловит `forces/:requestId/`, и слово
  // `allocation` для неё — такой же id (метод другой, но соседство слишком
  // близкое, чтобы полагаться на него молча).
  http.post(
    `*${securityEventForcesSplitPath(":id")}`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as SplitForceDemandRequest;
      const rows = body.rows ?? [];
      // «Расстановка» в окне сбора с Plane №110 — порт `_ALLOCATION_STAGES`.
      if (!COLLECTION_STAGES.includes(event.stage)) {
        return businessRuleError(
          "INVALID_STAGE_TRANSITION",
          "Раскладывать потребность можно после рекогносцировки и до согласования расстановки."
        );
      }
      const fieldErrors: Record<string, string[]> = {};
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        const key = String(row.departmentId ?? "").trim();
        if (key === "")
          fieldErrors[`rows.${index}.departmentId`] = ["Выберите департамент."];
        else if (seen.has(key))
          fieldErrors[`rows.${index}.departmentId`] = [
            "Департамент уже есть в раскладке.",
          ];
        seen.add(key);
        if (row.need < 1)
          fieldErrors[`rows.${index}.need`] = ["Должно быть не меньше 1."];
      });
      if (Object.keys(fieldErrors).length > 0) return validationError(fieldErrors);

      const total = event.reconForceRequest || event.forceNeed;
      const requested = rows.reduce((sum, row) => sum + row.need, 0);
      if (total > 0 && requested > total) {
        return businessRuleError(
          "ALLOCATION_OVER_DEMAND",
          `Разложено ${requested} человек при потребности ${total} — уберите лишних.`
        );
      }

      const previous = new Map(
        event.forceAllocation.map((row) => [row.departmentId, row])
      );
      const dropped = event.forceAllocation.filter(
        (row) => !seen.has(row.departmentId) && row.status !== "DRAFT"
      );
      if (dropped.length > 0) {
        return businessRuleError(
          "ALLOCATION_LOCKED",
          `Заявка уже ушла в департамент (${dropped
            .map((row) => row.departmentName || "—")
            .join(", ")}) — снять его из раскладки нельзя.`
        );
      }

      const forceAllocation: ForceAllocationRow[] = rows.map((row) => {
        const key = String(row.departmentId).trim();
        const kept = previous.get(key);
        return {
          id: kept?.id ?? `force-allocation-${key}-${nowIso()}`,
          departmentId: key,
          // Имя департамента на сервере берётся из справочника подразделений;
          // мок ops его не держит, поэтому здесь стоит ЗАМЕТНАЯ подстановка, а
          // не выдумка похожего названия: правила проверяются мок-пробами,
          // подписи — живым стендом.
          departmentName: kept?.departmentName ?? `Департамент ${key}`,
          need: row.need,
          status: kept?.status ?? "DRAFT",
          comment: (row.comment ?? "").trim(),
          // Срок сдачи списка — порт правила бэка (Plane №287): задан штабом —
          // берём его, не задан — прежний, а у новой строки «за сутки до
          // начала ОМ». Мок обязан нести поле: контракт проверяется мок-пробой,
          // и молчащий здесь мок зелен ровно тогда, когда клиент читает то,
          // чего сервер не отдаёт.
          dueAt: row.dueAt ?? kept?.dueAt ?? defaultDueAt(event.businessDate),
          overdue: isOverdue(
            kept?.status ?? "DRAFT",
            row.dueAt ?? kept?.dueAt ?? defaultDueAt(event.businessDate)
          ),
          submittedLate: kept?.submittedLate ?? false,
          notifiedAt: kept?.notifiedAt ?? null,
          submittedAt: kept?.submittedAt ?? null,
          decidedAt: kept?.decidedAt ?? null,
          decisionComment: kept?.decisionComment ?? "",
          directorates: kept?.directorates ?? [],
          members: kept?.members ?? [],
        };
      });
      return HttpResponse.json(
        saveEvent({
          ...event,
          forceAllocation,
          // Раскладка есть — значит заявка ушла из «не отправлена»: порт
          // правила бэка (Plane №110).
          forceRequests: syncAutoForceRequest(
            event.forceRequests,
            event.forceRoster.length,
            forceAllocation.length > 0
          ),
          updatedAt: nowIso(),
        })
      );
    }
  ),

  // ── Оповещение управлений (Plane №73, СС-2) ────────────────────────────
  //
  // Справочника подразделений мок ops не держит, поэтому управления здесь
  // ПОДСТАВНЫЕ и названы так вслух: предмет мок-пробы — правила (стадия,
  // незнакомая заявка, момент у уже оповещённых), а имена проверяет живой стенд.
  // 🔴 Путь собирается ВРУЧНУЮ, а не хелпером: `securityEventForcesNotifyPath`
  // прогоняет id заявки через `encodeURIComponent` (в нём живут `+` и `:` из
  // отметки времени), и плейсхолдер `:allocationId` превратился бы в
  // `%3AallocationId` — такой обработчик не сматчится НИКОГДА и молча пропустит
  // запрос на живой бэк.
  // Раскладка квоты департамента по управлениям (Plane №272, Ш-1). Мок-слой
  // ведётся В ТОТ ЖЕ ЗАХОД, что и сервер: отставший мок зелен и там, где
  // сервер отвечает 422, — так после №237 в нём почти сутки не было
  // справочника ролей наряда, и «ролей нет» читалось как состояние системы.
  http.post(
    `*${securityEventForcesSplitPath(":id")}:allocationId/split/`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const allocationId = params.allocationId as string;
      if (!COLLECTION_STAGES.includes(event.stage)) {
        return businessRuleError(
          "INVALID_STAGE_TRANSITION",
          "Делить квоту между управлениями можно после рекогносцировки и до согласования расстановки."
        );
      }
      const target = event.forceAllocation.find((row) => row.id === allocationId);
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Заявка департаменту не найдена.",
          { id: allocationId },
          404
        );
      }
      if (target.status !== "DRAFT") {
        return businessRuleError(
          "DIRECTORATE_QUOTAS_LOCKED",
          "Управления уже запрошены — квоты правятся до запроса. Чтобы изменить раскладку, отзовите список."
        );
      }
      const body = (await request.json()) as {
        rows?: { divisionId?: string; need?: number }[];
      };
      const rows = body.rows ?? [];
      const known = new Set(target.directorates.map((row) => row.divisionId));
      for (const [index, row] of rows.entries()) {
        if (row.divisionId === undefined || !known.has(row.divisionId)) {
          return validationError({
            [`rows.${index}.divisionId`]: ["Управление не найдено в департаменте."],
          });
        }
      }
      const total = rows.reduce((sum, row) => sum + Number(row.need ?? 0), 0);
      if (total > target.need) {
        return businessRuleError(
          "DIRECTORATE_QUOTA_OVERFLOW",
          `Разложено ${total} при квоте департамента ${target.need} — лишних ${total - target.need}.`
        );
      }
      const needOf = new Map(rows.map((row) => [row.divisionId, Number(row.need ?? 0)]));
      const directorates = target.directorates.map((row) => ({
        ...row,
        // Не названному квота не обнуляется — как на сервере.
        need: needOf.get(row.divisionId) ?? row.need ?? 0,
      }));
      const forceAllocation: ForceAllocationRow[] = event.forceAllocation.map((row) =>
        row.id === allocationId ? { ...row, directorates } : row
      );
      return HttpResponse.json(
        saveEvent({ ...event, forceAllocation, updatedAt: nowIso() })
      );
    }
  ),

  http.post(
    `*${securityEventForcesSplitPath(":id")}:allocationId/notify/`,
    ({ params }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const allocationId = params.allocationId as string;
      // «Расстановка» в окне сбора с Plane №110 — порт `_ALLOCATION_STAGES`.
      if (!COLLECTION_STAGES.includes(event.stage)) {
        return businessRuleError(
          "INVALID_STAGE_TRANSITION",
          "Оповещать управления можно после рекогносцировки и до согласования расстановки."
        );
      }
      const target = event.forceAllocation.find((row) => row.id === allocationId);
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Заявка департаменту не найдена.",
          { id: allocationId },
          404
        );
      }
      const now = nowIso();
      const directorates = [
        { divisionId: `${target.departmentId}-1`, name: "Управление №1" },
        { divisionId: `${target.departmentId}-2`, name: "Управление №2" },
      ].map((item) => {
        const kept = target.directorates.find(
          (row) => row.divisionId === item.divisionId
        );
        return {
          id: kept?.id ?? `force-directorate-${item.divisionId}`,
          divisionId: item.divisionId,
          name: item.name,
          // Квота управления (Plane №272, Ш-1). Оповещение её НЕ трогает:
          // раскладывает департамент отдельной ручкой, а оповещение только
          // рассылает. Не заведена — ноль, как и у бэкфилла на сервере.
          need: kept?.need ?? 0,
          // «Выделено» (Ш-2) сервер считает НА ЧТЕНИИ по подразделениям
          // выделенных. В моке подразделений нет вовсе — считать не по чему,
          // и мок отдаёт 0 ЧЕСТНО, а не выдумывает число: выдуманное
          // расходилось бы с живым сервером и читалось бы как правда.
          assigned: kept?.assigned ?? 0,
          // Момент у уже оповещённого не переписывается — как на сервере.
          notifiedAt: kept?.notifiedAt ?? now,
        };
      });
      const forceAllocation: ForceAllocationRow[] = event.forceAllocation.map(
        (row) =>
          row.id === allocationId
            ? {
                ...row,
                directorates,
                status: row.status === "DRAFT" ? "NOTIFIED" : row.status,
                notifiedAt: row.notifiedAt ?? now,
              }
            : row
      );
      return HttpResponse.json(
        saveEvent({ ...event, forceAllocation, updatedAt: nowIso() })
      );
    }
  ),

  // ── Выделенные управлением люди (Plane №73, СС-3) ──────────────────────
  //
  // Статуса привлечения мок НЕ ставит: домена статусов у него нет вовсе, и
  // подделка статуса врала бы про главное правило шага. Проверяются здесь те
  // правила, что живут в самом мероприятии: стадия, незнакомая заявка и
  // запрет второго выделения одного человека.
  http.post(
    `*${securityEventForcesSplitPath(":id")}:allocationId/members/`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const allocationId = params.allocationId as string;
      const body = (await request.json()) as { employeeId: string };
      // «Расстановка» в окне сбора с Plane №110 — порт `_ALLOCATION_STAGES`.
      if (!COLLECTION_STAGES.includes(event.stage)) {
        return businessRuleError(
          "INVALID_STAGE_TRANSITION",
          "Выделять людей можно после рекогносцировки и до согласования расстановки."
        );
      }
      const target = event.forceAllocation.find((row) => row.id === allocationId);
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Заявка департаменту не найдена.",
          { id: allocationId },
          404
        );
      }
      const person = findPersonnel(body.employeeId);
      if (person === undefined) {
        return validationError({ employeeId: ["Сотрудник не найден."] });
      }
      const taken = event.forceAllocation.find((row) =>
        row.members.some((member) => member.employeeId === body.employeeId)
      );
      if (taken !== undefined) {
        return businessRuleError(
          "DOUBLE_ASSIGNMENT",
          `${person.name} уже выделен(а) на это мероприятие департаментом «${taken.departmentName}».`
        );
      }
      const forceAllocation: ForceAllocationRow[] = event.forceAllocation.map(
        (row) =>
          row.id === allocationId
            ? {
                ...row,
                members: [
                  ...row.members,
                  {
                    employeeId: body.employeeId,
                    name: person.name,
                    divisionId: "",
                    divisionName: person.unit,
                    addedAt: nowIso(),
                  },
                ],
              }
            : row
      );
      return HttpResponse.json(
        saveEvent({ ...event, forceAllocation, updatedAt: nowIso() })
      );
    }
  ),

  http.delete(
    `*${securityEventForcesSplitPath(":id")}:allocationId/members/:employeeId/`,
    ({ params }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const allocationId = params.allocationId as string;
      const employeeId = params.employeeId as string;
      const target = event.forceAllocation.find((row) => row.id === allocationId);
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Заявка департаменту не найдена.",
          { id: allocationId },
          404
        );
      }
      if (!target.members.some((member) => member.employeeId === employeeId)) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Выделенный сотрудник не найден в заявке.",
          { id: employeeId },
          404
        );
      }
      const forceAllocation: ForceAllocationRow[] = event.forceAllocation.map(
        (row) =>
          row.id === allocationId
            ? {
                ...row,
                members: row.members.filter(
                  (member) => member.employeeId !== employeeId
                ),
              }
            : row
      );
      return HttpResponse.json(
        saveEvent({ ...event, forceAllocation, updatedAt: nowIso() })
      );
    }
  ),

  // ── Отправка списка штабу и её отзыв (Plane №73, СС-4) ─────────────────
  http.post(
    `*${securityEventForcesSplitPath(":id")}:allocationId/submit/`,
    ({ params }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const target = event.forceAllocation.find(
        (row) => row.id === (params.allocationId as string)
      );
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Заявка департаменту не найдена.",
          { id: params.allocationId as string },
          404
        );
      }
      if (target.status !== "NOTIFIED" && target.status !== "RETURNED") {
        return businessRuleError(
          "ALLOCATION_NOT_SUBMITTABLE",
          "Отправить список может департамент, которому заявку уже передали и который её ещё не отправил."
        );
      }
      if (target.members.length === 0) {
        return businessRuleError(
          "ALLOCATION_EMPTY",
          "Никто не выделен — отправлять нечего."
        );
      }
      return HttpResponse.json(
        saveEvent({
          ...event,
          forceAllocation: event.forceAllocation.map((row) =>
            row.id === target.id
              ? { ...row, status: "SUBMITTED", submittedAt: nowIso() }
              : row
          ),
          updatedAt: nowIso(),
        })
      );
    }
  ),

  http.post(
    `*${securityEventForcesSplitPath(":id")}:allocationId/withdraw/`,
    ({ params }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const target = event.forceAllocation.find(
        (row) => row.id === (params.allocationId as string)
      );
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Заявка департаменту не найдена.",
          { id: params.allocationId as string },
          404
        );
      }
      if (target.status !== "SUBMITTED") {
        return businessRuleError(
          "ALLOCATION_NOT_WITHDRAWABLE",
          "Отозвать можно только отправленный и ещё не решённый список."
        );
      }
      return HttpResponse.json(
        saveEvent({
          ...event,
          forceAllocation: event.forceAllocation.map((row) =>
            row.id === target.id
              ? { ...row, status: "NOTIFIED", submittedAt: null }
              : row
          ),
          updatedAt: nowIso(),
        })
      );
    }
  ),

  // ── Решение штаба по списку (Plane №73, СС-5) ──────────────────────────
  http.post(
    `*${securityEventForcesSplitPath(":id")}:allocationId/accept/`,
    ({ params }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const target = event.forceAllocation.find(
        (row) => row.id === (params.allocationId as string)
      );
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Заявка департаменту не найдена.",
          { id: params.allocationId as string },
          404
        );
      }
      if (target.status !== "SUBMITTED") {
        return businessRuleError(
          "ALLOCATION_NOT_DECIDABLE",
          "Решать можно только по отправленному списку."
        );
      }
      const now = nowIso();
      const known = new Set(event.forceRoster.map((row) => row.employeeId));
      const incoming = target.members
        .filter((member) => !known.has(member.employeeId))
        .map((member) => ({
          employeeId: member.employeeId,
          name: member.name,
          divisionId: member.divisionId,
          divisionName: member.divisionName,
          departmentId: target.departmentId,
          departmentName: target.departmentName,
          acceptedAt: now,
          // Статус дня — как у сервера, рядом с человеком: состав и есть
          // источник кандидатов подбора (Plane №65, «Р-2»).
          ...personnelDayStatus(member.employeeId),
        }));
      const roster = [...event.forceRoster, ...incoming];
      return HttpResponse.json(
        saveEvent({
          ...event,
          forceRoster: roster,
          forceAllocation: event.forceAllocation.map((row) =>
            row.id === target.id
              ? {
                  ...row,
                  status: "ACCEPTED",
                  decidedAt: now,
                  decisionComment: "",
                }
              : row
          ),
          // Числа автозаявки сводит с составом сервер — порт
          // `_sync_auto_force_request` (Plane №110): без него лента штаба
          // показывала бы вечный недобор при собранном составе.
          forceRequests: syncAutoForceRequest(event.forceRequests, roster.length),
          updatedAt: now,
        })
      );
    }
  ),

  http.post(
    `*${securityEventForcesSplitPath(":id")}:allocationId/return/`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as { reason?: string };
      const reason = (body.reason ?? "").trim();
      if (reason === "") {
        return validationError({ reason: ["Обязательное поле."] });
      }
      const target = event.forceAllocation.find(
        (row) => row.id === (params.allocationId as string)
      );
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Заявка департаменту не найдена.",
          { id: params.allocationId as string },
          404
        );
      }
      if (target.status !== "SUBMITTED") {
        return businessRuleError(
          "ALLOCATION_NOT_DECIDABLE",
          "Решать можно только по отправленному списку."
        );
      }
      const now = nowIso();
      return HttpResponse.json(
        saveEvent({
          ...event,
          forceAllocation: event.forceAllocation.map((row) =>
            row.id === target.id
              ? {
                  ...row,
                  status: "RETURNED",
                  decidedAt: now,
                  decisionComment: reason,
                  submittedAt: null,
                }
              : row
          ),
          updatedAt: now,
        })
      );
    }
  ),

  // ── Выделение сил ──────────────────────────────────────────────────────
  http.patch(
    `*${securityEventForceAllocationPath(":id", ":requestId")}`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const requestId = params.requestId as string;
      const body = (await request.json()) as UpdateForceAllocationRequest;
      if (body.allocatedCount < 0) {
        return validationError({
          allocatedCount: ["Не может быть отрицательным."],
        });
      }
      const target = event.forceRequests.find((r) => r.id === requestId);
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Запрос сил не найден.",
          { id: requestId },
          404
        );
      }
      const forceRequests: ForceRequest[] = event.forceRequests.map((r) => {
        if (r.id !== requestId) return r;
        const status: ForceRequest["status"] =
          body.allocatedCount === 0
            ? "SENT"
            : body.allocatedCount < r.requestedCount
              ? "PARTIALLY_ALLOCATED"
              : "ALLOCATED";
        return {
          ...r,
          allocatedCount: body.allocatedCount,
          status,
          comment: body.comment.trim(),
        };
      });
      return HttpResponse.json(
        saveEvent({ ...event, forceRequests, updatedAt: nowIso() })
      );
    }
  ),

  // Обработчик `forces/complete` СНЯТ вместе с ручкой (Plane №149).

  // ── Расстановка ────────────────────────────────────────────────────────
  http.post(
    `*${securityEventPlacementAssignPath(":id")}`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as AssignPlacementRequest;
      const employee = findPersonnel(body.employeeId);
      if (employee === undefined) {
        return validationError({ employeeId: ["Сотрудник не найден."] });
      }
      const post = event.reconSectorPosts.find((p) => p.id === body.postId);
      if (post === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Пост не найден.",
          { id: body.postId },
          404
        );
      }
      // Состав мероприятия (Plane №73, СС-6): у ОМ, прошедшего «Сбор сил»,
      // на посты ставят только принятых штабом. Пустой состав — прежний путь,
      // правило не включается.
      if (
        event.forceRoster.length > 0 &&
        !event.forceRoster.some((member) => member.employeeId === body.employeeId)
      ) {
        return businessRuleError(
          "NOT_IN_ROSTER",
          `${employee.name} не в составе мероприятия — на посты ставят тех, кого штаб принял в «Сборе сил».`
        );
      }
      // hard-правило: сотрудник не может занимать два поста одного ОМ
      const alreadyOnAnotherPost = event.placementAssignments.some(
        (a) => a.employeeId === body.employeeId && a.postId !== body.postId
      );
      if (alreadyOnAnotherPost) {
        return businessRuleError(
          "DOUBLE_ASSIGNMENT",
          `${employee.name} уже назначен(а) на другой пост этого мероприятия.`
        );
      }
      // мягкое предупреждение по требованию рейтинга — ПОСЛЕ жёстких правил:
      // обходить обоснованием можно только назначение, которое иначе
      // состоялось бы. Данных рейтинга в мок-слое нет — предупреждение
      // «данных нет», не молчаливое «соответствует».
      const overrideReason =
        body.override === true ? (body.override_reason ?? "").trim() : "";
      let ratingConflictMessage: string | null = null;
      if (post.minRating !== null) {
        ratingConflictMessage =
          "Данных рейтинга для проверки требования поста нет.";
        if (overrideReason === "") {
          return softConflict(ratingConflictMessage, [
            {
              conflict_code: "RATING_DATA_MISSING",
              severity: "WARNING",
              employee_id: body.employeeId,
              message: ratingConflictMessage,
            },
          ]);
        }
      }
      const assignment: PlacementAssignment = {
        id: `${event.id}-assignment-${event.placementAssignments.length + 1}`,
        postId: body.postId,
        employeeId: body.employeeId,
        employeeName: employee.name,
        // Роль наряда (Plane №239): мок принимает её так же, как сервер, —
        // иначе экран в мок-режиме зеленел бы, а на живом стенде роль
        // терялась бы молча.
        roleCode: (body as { roleCode?: string }).roleCode ?? null,
        // Секция бланка (Plane №242) — по тому же доводу, что и роль: мок,
        // молчащий о поле, зеленил бы экран, у которого на живом стенде
        // вторая координата теряется.
        sectionCode: (body as { sectionCode?: string }).sectionCode ?? null,
        // Подразделение и статус дня — сервер считает их на чтении (Plane
        // №65, «Р-1»); мок повторяет форму ответа, иначе экран зелен на моке
        // и пуст на живом стенде.
        divisionName: employee.unit,
        ...personnelDayStatus(employee.id),
        // Старший сектора назначается отдельной ручкой; поставленный на пост
        // старшим по умолчанию не становится (Plane №65, «Р-4»).
        isSectorSenior: false,
        acknowledgedAt: null,
        // обоснование сохраняется только при реально возникшем предупреждении
        ratingOverrideReason:
          ratingConflictMessage === null ? null : overrideReason,
      };
      return HttpResponse.json(
        saveEvent({
          ...withStaleFlag({
            ...event,
            placementAssignments: [...event.placementAssignments, assignment],
          }),
          updatedAt: nowIso(),
        })
      );
    }
  ),

  // Старший сектора (Plane №65, «Р-4»): один на сектор, как у сервера.
  http.post(
    // Шаблон СОБИРАЕТСЯ ВРУЧНУЮ: построитель пути прогоняет id назначения
    // через encodeURIComponent, и `:assignmentId` превратился бы в
    // `%3AassignmentId` — обработчик не сматчился бы никогда (та же яма, что
    // у маршрута согласования, карточка №82).
    `*${SECURITY_EVENTS_PATH}:id/placement/:assignmentId/senior/`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const assignmentId = decodeURIComponent(params.assignmentId as string);
      const target = event.placementAssignments.find((a) => a.id === assignmentId);
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Назначение не найдено.",
          { id: assignmentId },
          404
        );
      }
      const post = event.reconSectorPosts.find((p) => p.id === target.postId);
      if (post === undefined) {
        return businessRuleError(
          "POST_NOT_FOUND",
          "Пост назначения не найден — сектор определить нечем."
        );
      }
      const body = (await request.json().catch(() => ({}))) as {
        senior?: boolean;
      };
      const senior = body.senior ?? true;
      const sectorOf = (assignmentPostId: string) =>
        event.reconSectorPosts.find((p) => p.id === assignmentPostId)?.sector ?? "";
      return HttpResponse.json(
        saveEvent({
          ...event,
          placementAssignments: event.placementAssignments.map((a) =>
            a.id === assignmentId
              ? { ...a, isSectorSenior: senior }
              : sectorOf(a.postId) === post.sector
                ? { ...a, isSectorSenior: false }
                : a
          ),
          updatedAt: nowIso(),
        })
      );
    }
  ),

  // Завершение расстановки — `[РАС-06]` (Plane №396). Недобор МЯГКИЙ: 409
  // `PLACEMENT_UNDERSTAFFED`, повтор с `override`+`override_reason` проходит
  // тем же протоколом, что и обход предупреждения по рейтингу при назначении.
  // Документ получает версию 1 ЗДЕСЬ, а не при первой отправке (Ш-5, №411) —
  // порт правила сервера, а не вторая его копия.
  http.post(
    `*${securityEventPlacementCompletePath(":id")}`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      if (event.stage !== "PLACEMENT") {
        return businessRuleError(
          "INVALID_STAGE_TRANSITION",
          "Расстановку можно завершить только на этапе «Расстановка»."
        );
      }
      const body = (await request.json().catch(() => ({}))) as {
        override?: boolean;
        override_reason?: string;
      };
      // пост укомплектован при хотя бы одном назначении (упрощённое правило)
      const assignedPostIds = new Set(event.placementAssignments.map((a) => a.postId));
      const unstaffed = event.reconSectorPosts.filter(
        (p) => !assignedPostIds.has(p.id)
      );
      if (event.reconSectorPosts.length === 0) {
        return businessRuleError("PLACEMENT_INCOMPLETE", "Не все посты укомплектованы.");
      }
      if (unstaffed.length > 0) {
        const reason = (body.override_reason ?? "").trim();
        if (!(body.override === true && reason !== "")) {
          const noun = unstaffed.length === 1 ? "пост" : "постов";
          return errorEnvelope(
            "PLACEMENT_UNDERSTAFFED",
            `${unstaffed.length} ${noun} без людей. Завершить с недобором?`,
            { unfilledCount: unstaffed.length },
            409
          );
        }
      }
      return HttpResponse.json(
        saveEvent({
          ...event,
          stage: "APPROVAL",
          readinessPercent: 75,
          visitObjects: event.visitObjects.map((visit) => ({
            ...visit,
            documentVersion: Math.max(visit.documentVersion, 1),
          })),
          updatedAt: nowIso(),
        })
      );
  }),

  http.delete(
    `*${securityEventPlacementUnassignPath(":id", ":assignmentId")}`,
    ({ params }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const assignmentId = params.assignmentId as string;
      return HttpResponse.json(
        saveEvent({
          ...withStaleFlag({
            ...event,
            placementAssignments: event.placementAssignments.filter(
              (a) => a.id !== assignmentId
            ),
          }),
          updatedAt: nowIso(),
        })
      );
    }
  ),

  // ── Согласование ───────────────────────────────────────────────────────
  //
  // Маршрут согласующих, отправка и замечания — порт правил сервера
  // (`apps/ops/security_events.py`, задача заказчика «ОМ-37.3»). Согласуют не
  // «мероприятие вообще», а КОНКРЕТНУЮ расстановку: отправка фиксирует снимок
  // состава, изменение состава после отправки сбрасывает согласование.
  http.post(
    `*${securityEventApprovalRoutePath(":id")}`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as AddApproverRequest;
      if ((body.name ?? "").trim() === "") {
        return validationError({ name: ["Обязательное поле."] });
      }
      const numbers = event.approvalRoute.map((a) =>
        Number(a.id.split("-").pop() ?? 0)
      );
      const next = numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
      return HttpResponse.json(
        saveEvent({
          ...event,
          approvalRoute: [
            ...event.approvalRoute,
            {
              id: `approver-${next}`,
              name: body.name.trim(),
              unit: (body.unit ?? "").trim(),
              position: (body.position ?? "").trim(),
              // «Не отправлено»: человека внесли в маршрут, но расстановку
              // ему ещё не присылали — решать нечего.
              status: "NOT_SENT",
              decidedAt: null,
              comment: "",
            },
          ],
          updatedAt: nowIso(),
        })
      );
    }
  ),

  http.post(
    // 🔴 Путь собирается ВРУЧНУЮ (Plane №82): `securityEventApproverPath`
    // прогоняет идентификатор согласующего через `encodeURIComponent`, и
    // плейсхолдер `:approverId` превращался в `%3AapproverId` — обработчик не
    // сматчивался НИКОГДА, а запрос молча уходил на живой бэк. Та же яма уже
    // была у заявки сбора сил, см. выше.
    `*${securityEventApprovalRoutePath(":id")}:approverId/move/`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as MoveApproverRequest;
      const route = [...event.approvalRoute];
      const index = route.findIndex((a) => a.id === params.approverId);
      if (index === -1) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Согласующий не найден.",
          { id: params.approverId },
          404
        );
      }
      const target = body.direction === "UP" ? index - 1 : index + 1;
      // Край списка — не ошибка, а «дальше некуда».
      if (target >= 0 && target < route.length) {
        [route[index], route[target]] = [route[target]!, route[index]!];
      }
      return HttpResponse.json(
        saveEvent({ ...event, approvalRoute: route, updatedAt: nowIso() })
      );
    }
  ),

  http.post(`*${securityEventApprovalSendPath(":id")}`, ({ params }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    // Снимок фиксируется ИМЕННО отправкой: до неё согласовывать нечего, и
    // сравнивать состав не с чем.
    approvalSnapshots.set(event.id, placementSignature(event));
    if (event.stage !== "APPROVAL") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Отправить на согласование можно только на этапе «Согласование»."
      );
    }
    if (event.approvalRoute.length === 0) {
      return businessRuleError(
        "APPROVAL_ROUTE_EMPTY",
        "Маршрут согласования пуст — добавьте хотя бы одного согласующего."
      );
    }
    if (event.placementAssignments.length === 0) {
      return businessRuleError(
        "PLACEMENT_EMPTY",
        "Расстановка пуста — согласовывать нечего."
      );
    }
    return HttpResponse.json(
      saveEvent({
        ...event,
        approvalRoute: event.approvalRoute.map((approver) => ({
          ...approver,
          status: "PENDING" as const,
          decidedAt: null,
          // Причина возврата остаётся: она объясняет, что чинили. «Без
          // замечаний» от прошлого состава — нет.
          comment: approver.status === "RETURNED" ? approver.comment : "",
        })),
        approvalStale: false,
        // ВЕРСИЮ ДОКУМЕНТА РАСТИТ ОТПРАВКА (Plane №411): версия — это состав,
        // под которым подписываются, а не каждое движение человека по постам.
        // Отзыв её не откатывает: состав уже уходил людям, и выдать двум
        // разным составам один номер значило бы соврать в документе.
        visitObjects: event.visitObjects.map((visit) => ({
          ...visit,
          documentVersion: visit.documentVersion + 1,
        })),
        updatedAt: nowIso(),
      })
    );
  }),

  http.post(`*${securityEventApprovalWithdrawPath(":id")}`, ({ params }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    if (event.stage !== "APPROVAL") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Отозвать с согласования можно только на этапе «Согласование»."
      );
    }
    // Принятые решения отзыв не отменяет: стирать чужое решение значило бы
    // переписывать историю.
    return HttpResponse.json(
      saveEvent({
        ...event,
        approvalRoute: event.approvalRoute.map((approver) =>
          approver.status === "PENDING"
            ? { ...approver, status: "NOT_SENT" as const }
            : approver
        ),
        updatedAt: nowIso(),
      })
    );
  }),

  http.post(
    `*${securityEventRemarkResolvePath(":id", ":remarkId")}`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as ResolveRemarkRequest;
      const found = event.approvalRemarks.some((r) => r.id === params.remarkId);
      if (!found) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Замечание не найдено.",
          { id: params.remarkId },
          404
        );
      }
      return HttpResponse.json(
        saveEvent({
          ...event,
          approvalRemarks: event.approvalRemarks.map((remark) =>
            remark.id === params.remarkId
              ? {
                  ...remark,
                  resolved: body.resolved,
                  resolvedAt: body.resolved ? nowIso() : null,
                }
              : remark
          ),
          updatedAt: nowIso(),
        })
      );
    }
  ),

  http.post(
    `*${securityEventApprovalRoutePath(":id")}:approverId/decide/`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as DecideApproverRequest;
      const target = event.approvalRoute.find((a) => a.id === params.approverId);
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Согласующий не найден.",
          { id: params.approverId },
          404
        );
      }
      if (body.decision !== "APPROVED" && body.decision !== "RETURNED") {
        return validationError({ decision: ["Допустимо APPROVED или RETURNED."] });
      }
      const comment = (body.comment ?? "").trim();
      if (body.decision === "RETURNED" && comment === "") {
        return validationError({ comment: ["Укажите причину возврата."] });
      }
      if (target.status === "NOT_SENT") {
        return businessRuleError(
          "APPROVAL_NOT_SENT",
          "Расстановка не отправлена на согласование — решать нечего."
        );
      }
      const now = nowIso();
      const route = event.approvalRoute.map((approver) =>
        approver.id === target.id
          ? {
              ...approver,
              status: body.decision,
              decidedAt: now,
              // При согласовании комментарий не спрашивают — пустая графа
              // читалась бы как «забыли написать».
              comment: body.decision === "RETURNED" ? comment : "Без замечаний",
            }
          : approver
      );
      const remarks =
        body.decision === "RETURNED"
          ? [
              ...event.approvalRemarks,
              {
                id: `remark-${event.approvalRemarks.length + 1}-${target.id}`,
                approverId: target.id,
                author: target.name,
                createdAt: now,
                text: comment,
                resolved: false,
                resolvedAt: null,
              },
            ]
          : event.approvalRemarks;
      return HttpResponse.json(
        saveEvent({
          ...event,
          approvalRoute: route,
          approvalRemarks: remarks,
          updatedAt: now,
        })
      );
    }
  ),

  http.delete(
    `*${securityEventApprovalRoutePath(":id")}:approverId/`,
    ({ params }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const route = event.approvalRoute.filter(
        (a) => a.id !== params.approverId
      );
      if (route.length === event.approvalRoute.length) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Согласующий не найден.",
          { id: params.approverId },
          404
        );
      }
      return HttpResponse.json(
        saveEvent({ ...event, approvalRoute: route, updatedAt: nowIso() })
      );
    }
  ),

  http.post(`*${securityEventApprovalApprovePath(":id")}`, ({ params }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    if (event.stage !== "APPROVAL") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Согласовать расстановку можно только на этапе «Согласование»."
      );
    }
    // Условия завершения — из эталона; у каждого свой текст, потому что
    // чинятся они по-разному.
    if (event.approvalRoute.length === 0) {
      return businessRuleError(
        "APPROVAL_ROUTE_EMPTY",
        "Маршрут согласования пуст — добавьте согласующих и отправьте им расстановку."
      );
    }
    if (event.approvalStale) {
      return businessRuleError(
        "APPROVAL_STALE",
        "Расстановка изменилась после отправки — отправьте её на повторное согласование."
      );
    }
    if (event.approvalRoute.some((a) => a.status === "RETURNED")) {
      return businessRuleError(
        "APPROVAL_RETURNED",
        "Есть возврат на доработку — устраните замечания и отправьте расстановку повторно."
      );
    }
    if (event.approvalRoute.some((a) => a.status !== "APPROVED")) {
      return businessRuleError(
        "APPROVAL_INCOMPLETE",
        event.approvalRoute.some((a) => a.status === "PENDING")
          ? "Не все согласующие приняли решение."
          : "Расстановка не отправлена на согласование."
      );
    }
    if (event.approvalRemarks.some((remark) => !remark.resolved)) {
      return businessRuleError(
        "APPROVAL_REMARKS_OPEN",
        "Есть неустранённые замечания — закройте их перед завершением этапа."
      );
    }
    // утверждение сразу открывает «Ознакомление», без отдельного клика
    return HttpResponse.json(
      saveEvent({
        ...event,
        stage: "ACKNOWLEDGEMENT",
        approvalStatus: "APPROVED",
        approvalComment: "",
        readinessPercent: 85,
        updatedAt: nowIso(),
      })
    );
  }),

  http.post(
    `*${securityEventApprovalReturnPath(":id")}`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as ReturnPlacementRequest;
      if (body.comment.trim() === "") {
        return validationError({ comment: ["Укажите причину возврата."] });
      }
      if (event.stage !== "APPROVAL") {
        return businessRuleError(
          "INVALID_STAGE_TRANSITION",
          "Вернуть на доработку можно только на этапе «Согласование»."
        );
      }
      return HttpResponse.json(
        saveEvent({
          ...event,
          stage: "PLACEMENT",
          approvalStatus: "RETURNED",
          approvalComment: body.comment.trim(),
          readinessPercent: 60,
          updatedAt: nowIso(),
        })
      );
    }
  ),

  // ── Ознакомление ───────────────────────────────────────────────────────
  http.post(
    `*${securityEventAcknowledgePath(":id", ":assignmentId")}`,
    ({ params }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const assignmentId = params.assignmentId as string;
      const target = event.placementAssignments.find((a) => a.id === assignmentId);
      if (target === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Назначение не найдено.",
          { id: assignmentId },
          404
        );
      }
      return HttpResponse.json(
        saveEvent({
          ...event,
          placementAssignments: event.placementAssignments.map((a) =>
            a.id === assignmentId ? { ...a, acknowledgedAt: nowIso() } : a
          ),
          updatedAt: nowIso(),
        })
      );
    }
  ),

  http.post(
    `*${securityEventAcknowledgementCompletePath(":id")}`,
    ({ params }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      if (event.stage !== "ACKNOWLEDGEMENT") {
        return businessRuleError(
          "INVALID_STAGE_TRANSITION",
          "Ознакомление можно завершить только на этапе «Ознакомление»."
        );
      }
      if (!event.placementAssignments.every((a) => a.acknowledgedAt !== null)) {
        return businessRuleError(
          "ACKNOWLEDGEMENT_INCOMPLETE",
          "Не все назначенные сотрудники подтвердили ознакомление."
        );
      }
      return HttpResponse.json(
        saveEvent({ ...event, stage: "CONDUCT", readinessPercent: 95, updatedAt: nowIso() })
      );
    }
  ),

  // ── Проведение ─────────────────────────────────────────────────────────
  http.post(
    `*${securityEventJournalPath(":id")}`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as AddJournalEntryRequest;
      if (body.title.trim() === "") {
        return validationError({ title: ["Обязательное поле."] });
      }
      if (event.stage !== "CONDUCT") {
        return businessRuleError(
          "INVALID_STAGE_TRANSITION",
          "Журнал штаба доступен только на этапе «Проведение»."
        );
      }
      const entry: JournalEntry = {
        id: `${event.id}-journal-${event.journalEntries.length + 1}`,
        type: body.type,
        title: body.title.trim(),
        description: body.description.trim(),
        createdAt: nowIso(),
      };
      return HttpResponse.json(
        saveEvent({
          ...event,
          journalEntries: [entry, ...event.journalEntries],
          updatedAt: nowIso(),
        })
      );
    }
  ),

  http.post(
    `*${securityEventReplaceAssignmentPath(":id")}`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as ReplaceAssignmentRequest;
      if (body.reasonCode.trim() === "") {
        return validationError({ reasonCode: ["Обязательное поле."] });
      }
      const incoming = findPersonnel(body.incomingEmployeeId);
      if (incoming === undefined) {
        return validationError({ incomingEmployeeId: ["Сотрудник не найден."] });
      }
      if (event.stage !== "CONDUCT") {
        return businessRuleError(
          "INVALID_STAGE_TRANSITION",
          "Замена доступна только на этапе «Проведение»."
        );
      }
      const outgoing = event.placementAssignments.find(
        (a) => a.id === body.assignmentId
      );
      if (outgoing === undefined) {
        return errorEnvelope(
          "ENTITY_NOT_FOUND",
          "Назначение не найдено.",
          { id: body.assignmentId },
          404
        );
      }
      const alreadyOnAnotherPost = event.placementAssignments.some(
        (a) =>
          a.employeeId === body.incomingEmployeeId && a.postId !== outgoing.postId
      );
      if (alreadyOnAnotherPost) {
        return businessRuleError(
          "DOUBLE_ASSIGNMENT",
          `${incoming.name} уже назначен(а) на другой пост этого мероприятия.`
        );
      }
      const post = event.reconSectorPosts.find((p) => p.id === outgoing.postId);
      const incomingAssignment: PlacementAssignment = {
        id: `${event.id}-assignment-${event.placementAssignments.length + 1}`,
        postId: outgoing.postId,
        employeeId: body.incomingEmployeeId,
        employeeName: incoming.name,
        // Замена на посту наследует роль наряда: место в бланке остаётся тем
        // же, меняется только человек (Plane №239).
        roleCode: outgoing.roleCode ?? null,
        // Секция наследуется вместе с ролью: место в бланке остаётся тем же.
        sectionCode: outgoing.sectionCode ?? null,
        divisionName: incoming.unit,
        ...personnelDayStatus(incoming.id),
        isSectorSenior: false,
        acknowledgedAt: null,
        // замена в ходе проведения — не расстановка: обхода не было
        ratingOverrideReason: null,
      };
      const journalEntry: JournalEntry = {
        id: `${event.id}-journal-${event.journalEntries.length + 1}`,
        type: "REPLACEMENT",
        title: `Замена: ${post?.post ?? outgoing.postId}`,
        description: `${outgoing.employeeName} → ${incoming.name} — причина: ${body.reasonCode.trim()}`,
        createdAt: nowIso(),
      };
      return HttpResponse.json(
        saveEvent({
          ...event,
          placementAssignments: [
            ...event.placementAssignments.filter((a) => a.id !== body.assignmentId),
            incomingAssignment,
          ],
          journalEntries: [journalEntry, ...event.journalEntries],
          updatedAt: nowIso(),
        })
      );
    }
  ),

  // ── Перевод на любой этап (админ) ──────────────────────────────────────
  // Зеркало override_stage бэкенда: без него мок-слой отвечал бы 404 на живую
  // ручку, и режим просмотра выглядел бы сломанным ровно там, где его удобнее
  // всего разбирать. Право здесь не проверяется — мок прав не знает вовсе
  // (гейт живёт на сервере и в гварде экрана).
  http.post(`*${securityEventStagePath(":id")}`, async ({ params, request }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    const body = (await request.json()) as { stage?: string };
    const readiness: Record<string, number> = {
      BULLETIN: 0,
      RECON: 15,
      DEMAND: 30,
      APPROVAL: 75,
      ACKNOWLEDGEMENT: 85,
      CONDUCT: 95,
    };
    const target = body.stage ?? "";
    // CLOSED сюда не входит намеренно — закрывают по итогам направлений.
    if (!(target in readiness)) {
      return validationError({ stage: ["Недопустимый этап для перевода."] });
    }
    if (event.stage === target) return HttpResponse.json(event);
    appendAudit({
      action: "security_event.stage_override",
      entityType: "SecurityEvent",
      entityId: event.code,
      oldValue: { stage: event.stage },
      newValue: { stage: target },
    });
    return HttpResponse.json(
      saveEvent({
        ...event,
        stage: target as typeof event.stage,
        readinessPercent: readiness[target],
        // Выход из закрытия снимает штамп закрытия — как на сервере.
        closedAt: event.stage === "CLOSED" ? null : event.closedAt,
        updatedAt: nowIso(),
      })
    );
  }),

  // ── Закрытие ───────────────────────────────────────────────────────────
  http.post(
    `*${securityEventClosePath(":id")}`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as CloseSecurityEventRequest;
      const fieldErrors: Record<string, string[]> = {};
      body.directionSummaries.forEach((d, index) => {
        if (d.summary.trim() === "") {
          fieldErrors[`directionSummaries.${index}.summary`] = [
            "Обязательное поле.",
          ];
        }
      });
      if (Object.keys(fieldErrors).length > 0) return validationError(fieldErrors);
      if (event.stage !== "CONDUCT") {
        return businessRuleError(
          "INVALID_STAGE_TRANSITION",
          "Закрыть ОМ можно только на этапе «Проведение»."
        );
      }
      // итоги ВСЕХ направлений обязательны — не частичное закрытие
      const directions = new Set(event.reconSectorPosts.map((p) => p.sector));
      const covered = new Set(body.directionSummaries.map((d) => d.direction));
      const missing = [...directions].filter((d) => !covered.has(d));
      if (missing.length > 0) {
        return businessRuleError(
          "CLOSURE_DIRECTIONS_INCOMPLETE",
          `Не хватает итогов направлений: ${missing.join(", ")}.`
        );
      }
      appendAudit({
        action: "security_event.close",
        entityType: "SecurityEvent",
        entityId: event.code,
        oldValue: { stage: event.stage },
        newValue: { stage: "CLOSED" },
      });
      return HttpResponse.json(
        saveEvent({
          ...event,
          stage: "CLOSED",
          readinessPercent: 100,
          closureDirectionSummaries: body.directionSummaries.map((d) => ({
            direction: d.direction,
            summary: d.summary.trim(),
          })),
          closedAt: nowIso(),
          updatedAt: nowIso(),
        })
      );
    }
  ),
];
