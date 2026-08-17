// MSW-handlers «Охранные мероприятия»: список с фильтрами/пагинацией,
// создание с привязкой версии паспорта по бизнес-дате, деталь,
// bindable-objects. Сид строится от живого стора объектов (не литеральные id).
// Персист — sessionStorage (sidebar ходит по <a>, полная перезагрузка).
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
  securityEventBulletinCompletePath,
  securityEventBulletinPath,
  securityEventClosePath,
  securityEventDemandApprovePath,
  securityEventDetailPath,
  securityEventForceAllocationPath,
  securityEventForcesCompletePath,
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
  AddJournalEntryRequest,
  AssignPlacementRequest,
  BindableObject,
  CloseSecurityEventRequest,
  CreateSecurityEventRequest,
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
  StaffingDemandRow,
  UpdateBulletinRequest,
  UpdateDemandRequest,
  UpdateForceAllocationRequest,
  UpdateReconRequest,
} from "@/entities/security-event";
import { readObjectsStore } from "./objects-handlers";
import { findPersonnel, PERSONNEL_ROSTER } from "./fixtures/personnel";
import { appendAudit } from "./audit-store";

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
  events = getEvents().map((e) => (e.id === updated.id ? updated : e));
  persist(events);
  return updated;
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
    appendAudit({
      action: "security_event.create",
      entityType: "SecurityEvent",
      entityId: created.code,
      newValue: { title: created.title, businessDate: created.businessDate },
    });
    return HttpResponse.json(created, { status: 201 });
  }),

  // ── Кадровый снимок для расстановки ────────────────────────────────────
  http.get(`*${OPS_PERSONNEL_PATH}`, () =>
    HttpResponse.json({ results: PERSONNEL_ROSTER })
  ),

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
    // пустой бюллетень не завершается: рекогносцировке не с чем работать
    if (event.briefDescription.trim() === "" || event.initialTasks.trim() === "") {
      return businessRuleError(
        "BULLETIN_INCOMPLETE",
        "Заполните и сохраните описание и первичные задачи, прежде чем завершать этап."
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
    const sectorPosts: ReconSectorPost[] = body.sectorPosts.map((row) => ({
      ...row,
      sector: row.sector.trim(),
      post: row.post.trim(),
      task: row.task.trim(),
      requirements: row.requirements.trim(),
      comment: row.comment.trim(),
    }));
    return HttpResponse.json(
      saveEvent({
        ...event,
        reconChecklist: checklist,
        reconSectorPosts: sectorPosts,
        updatedAt: nowIso(),
      })
    );
  }),

  http.post(`*${securityEventReconImportPath(":id")}`, ({ params }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    if (event.stage !== "RECON") {
      return businessRuleError(
        "RECON_STAGE_REQUIRED",
        "Расчёт постов формируется на этапе рекогносцировки."
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
    const alreadyImported = new Set(
      event.reconSectorPosts
        .map((row) => row.sourcePostId)
        .filter((sourcePostId): sourcePostId is string => sourcePostId !== null)
    );
    const now = nowIso();
    let counter = 0;
    const added: ReconSectorPost[] = [];
    for (const sector of version.sectors) {
      for (const post of sector.posts) {
        if (alreadyImported.has(post.id)) continue;
        counter += 1;
        added.push({
          id: `${event.id}-imported-${now}-${counter}`,
          sector: sector.name,
          post: post.name,
          task: post.task,
          // паспорт описывает пост, а не численность на мероприятие: 1 —
          // минимально допустимое значение, его уточняет старший наряда
          need: 1,
          requirements: post.requirements,
          result: null,
          comment: "",
          sourceSectorId: sector.id,
          sourcePostId: post.id,
          minRating: null,
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
        updatedAt: now,
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
    return HttpResponse.json(
      saveEvent({ ...event, stage: "DEMAND", readinessPercent: 30, updatedAt: nowIso() })
    );
  }),

  // ── Потребность ────────────────────────────────────────────────────────
  http.post(
    `*${securityEventDemandApprovePath(":id")}`,
    async ({ params, request }) => {
      const { event, response } = findEvent(params.id as string);
      if (event === null) return response;
      const body = (await request.json()) as UpdateDemandRequest;
      const fieldErrors: Record<string, string[]> = {};
      body.rows.forEach((row, index) => {
        if (row.sector.trim() === "")
          fieldErrors[`rows.${index}.sector`] = ["Обязательное поле."];
        if (row.task.trim() === "")
          fieldErrors[`rows.${index}.task`] = ["Обязательное поле."];
        if (row.group.trim() === "")
          fieldErrors[`rows.${index}.group`] = ["Выберите группу."];
        if (row.need < 1)
          fieldErrors[`rows.${index}.need`] = ["Должно быть не меньше 1."];
      });
      if (Object.keys(fieldErrors).length > 0) return validationError(fieldErrors);
      if (body.rows.length === 0) {
        return businessRuleError(
          "DEMAND_ROWS_EMPTY",
          "Добавьте хотя бы одну строку потребности."
        );
      }
      if (event.stage !== "DEMAND") {
        return businessRuleError(
          "INVALID_STAGE_TRANSITION",
          "Потребность можно утвердить только на этапе «Потребность»."
        );
      }
      const rows: StaffingDemandRow[] = body.rows.map((row) => ({
        ...row,
        sector: row.sector.trim(),
        task: row.task.trim(),
        shift: row.shift.trim(),
        group: row.group.trim(),
        requirements: row.requirements.trim(),
        comment: row.comment.trim(),
      }));
      const forceNeed = rows.reduce((sum, row) => sum + row.need, 0);
      return HttpResponse.json(
        saveEvent({
          ...event,
          demandRows: rows,
          demandApproved: true,
          forceRequests: aggregateForceRequests(event.id, rows),
          forceNeed,
          stage: "FORCES",
          readinessPercent: 45,
          updatedAt: nowIso(),
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

  http.post(`*${securityEventForcesCompletePath(":id")}`, ({ params }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    if (event.stage !== "FORCES") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Выделение сил можно завершить только на этапе «Запрос сил»."
      );
    }
    if (
      event.forceRequests.length === 0 ||
      !event.forceRequests.every((r) => r.allocatedCount >= r.requestedCount)
    ) {
      return businessRuleError(
        "FORCE_ALLOCATION_INCOMPLETE",
        "Не все запросы полностью выделены."
      );
    }
    return HttpResponse.json(
      saveEvent({ ...event, stage: "PLACEMENT", readinessPercent: 60, updatedAt: nowIso() })
    );
  }),

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
        acknowledgedAt: null,
        // обоснование сохраняется только при реально возникшем предупреждении
        ratingOverrideReason:
          ratingConflictMessage === null ? null : overrideReason,
      };
      return HttpResponse.json(
        saveEvent({
          ...event,
          placementAssignments: [...event.placementAssignments, assignment],
          updatedAt: nowIso(),
        })
      );
    }
  ),

  http.post(`*${securityEventPlacementCompletePath(":id")}`, ({ params }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    if (event.stage !== "PLACEMENT") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Расстановку можно завершить только на этапе «Расстановка»."
      );
    }
    // пост укомплектован при хотя бы одном назначении (упрощённое правило)
    const assignedPostIds = new Set(event.placementAssignments.map((a) => a.postId));
    const unstaffed = event.reconSectorPosts.filter(
      (p) => !assignedPostIds.has(p.id)
    );
    if (event.reconSectorPosts.length === 0 || unstaffed.length > 0) {
      return businessRuleError("PLACEMENT_INCOMPLETE", "Не все посты укомплектованы.");
    }
    return HttpResponse.json(
      saveEvent({ ...event, stage: "APPROVAL", readinessPercent: 75, updatedAt: nowIso() })
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
          ...event,
          placementAssignments: event.placementAssignments.filter(
            (a) => a.id !== assignmentId
          ),
          updatedAt: nowIso(),
        })
      );
    }
  ),

  // ── Согласование ───────────────────────────────────────────────────────
  http.post(`*${securityEventApprovalApprovePath(":id")}`, ({ params }) => {
    const { event, response } = findEvent(params.id as string);
    if (event === null) return response;
    if (event.stage !== "APPROVAL") {
      return businessRuleError(
        "INVALID_STAGE_TRANSITION",
        "Согласовать расстановку можно только на этапе «Согласование»."
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
