// Мок-слой обратной связи (§28): видимость обращений, серверное вырезание
// закрытого содержания, область поиска, страницы, создание/отправка черновика,
// карточка с лентой-диффом, разбор и закрытие с ответом автору.
//
// Демо-персона хоста — demo-admin с wildcard: права разбора, внутренних
// заметок и чтения конфиденциального содержания есть. Живым закрытием при
// этом остаётся чужой ЧЕРНОВИК: §28 держит его отдельным статусом, и никакое
// право его не открывает — отправки не было.
import { http, HttpResponse } from "msw";
import {
  CLOSED_LOCK_REASON,
  FEEDBACK_CLOSE_PATH_PATTERN,
  FEEDBACK_COMMENTS_PATH_PATTERN,
  FEEDBACK_DETAIL_PATH_PATTERN,
  FEEDBACK_PAGE_SIZE,
  FEEDBACK_REQUESTS_PATH,
  FEEDBACK_SUBMIT_PATH_PATTERN,
  FEEDBACK_TRIAGE_PATH_PATTERN,
  INTERNAL_NOTE_REASON,
  REPLY_REASON,
  RESTRICTED_REASON,
  TRIAGE_REASON,
  UNAVAILABLE_CAPABILITIES,
  UNAVAILABLE_CARD_BLOCKS,
  allowedTransitions,
  buildStats,
  commentVisibleTo,
  diffEvents,
  eventVisibleTo,
  feedbackPageCount,
  matchesFilters,
  pageOf,
  previewOf,
  sortRequests,
} from "@/entities/ops-feedback";
import type {
  AddFeedbackCommentRequest,
  CloseFeedbackRequest,
  CreateFeedbackRequest,
  FeedbackAction,
  FeedbackComment,
  FeedbackDetailResponse,
  FeedbackDuplicateLink,
  FeedbackEvent,
  FeedbackRegistry,
  FeedbackRequest,
  FeedbackRequestView,
  FeedbackStatusCode,
  FeedbackTypeCode,
  ListFeedbackResponse,
  TriageFeedbackRequest,
} from "@/entities/ops-feedback";

const STORE_KEY = "ops-mock-feedback";

/** Актор мок-стенда. Wildcard-права: triage, internal_note, view_confidential. */
const ACTOR = "demo-admin";

interface FeedbackState {
  requests: FeedbackRequest[];
  comments: FeedbackComment[];
  events: FeedbackEvent[];
  registry: FeedbackRegistry;
  seq: number;
}

/** Справочник §28 целиком: подписи, порядок и карта переходов — в данных. */
const FEEDBACK_REGISTRY: FeedbackRegistry = {
  types: [
    { code: "BUG", label: "Ошибка" },
    { code: "WRONG_DATA", label: "Неверные данные" },
    { code: "UX", label: "UX" },
    { code: "IDEA", label: "Идея" },
    { code: "ACCESS", label: "Доступ" },
    { code: "HELP", label: "Помощь" },
  ],
  priorities: [
    { code: "LOW", label: "Низкий" },
    { code: "NORMAL", label: "Обычный" },
    { code: "HIGH", label: "Высокий" },
    { code: "CRITICAL", label: "Критический" },
  ],
  statuses: [
    { code: "DRAFT", label: "Черновик" },
    { code: "NEW", label: "Новое" },
    { code: "IN_REVIEW", label: "На рассмотрении" },
    { code: "NEED_INFO", label: "Нужна информация" },
    { code: "ACCEPTED", label: "Принято в работу" },
    { code: "PLANNED", label: "Запланировано" },
    { code: "FIXED", label: "Исправлено" },
    { code: "RELEASED", label: "Реализовано" },
    { code: "REJECTED", label: "Отклонено" },
    { code: "CLOSED", label: "Закрыто" },
    { code: "DUPLICATE", label: "Дубликат" },
  ],
  // Модули — разделы, которые в нативном порте РЕАЛЬНО существуют.
  modules: [
    { moduleCode: "SECURITY_EVENTS", label: "Реестр ОМ" },
    { moduleCode: "DUTIES", label: "План дежурств" },
    { moduleCode: "OBJECTS", label: "Объекты и паспорта" },
    { moduleCode: "RATINGS", label: "Оперативный рейтинг" },
    { moduleCode: "ANALYTICS", label: "Аналитика службы" },
    { moduleCode: "REPORTS", label: "Отчёты службы" },
    { moduleCode: "OTHER", label: "Другое" },
  ],
  // Из терминальных статусов переходов нет вовсе — это и есть замок.
  statusTransitions: [
    { from: "DRAFT", to: ["NEW"] },
    { from: "NEW", to: ["IN_REVIEW", "NEED_INFO", "REJECTED", "DUPLICATE"] },
    { from: "IN_REVIEW", to: ["NEED_INFO", "ACCEPTED", "REJECTED", "DUPLICATE"] },
    { from: "NEED_INFO", to: ["IN_REVIEW", "REJECTED"] },
    { from: "ACCEPTED", to: ["PLANNED", "REJECTED"] },
    { from: "PLANNED", to: ["FIXED", "REJECTED"] },
    { from: "FIXED", to: ["RELEASED"] },
    { from: "RELEASED", to: ["CLOSED"] },
    { from: "REJECTED", to: [] },
    { from: "CLOSED", to: [] },
    { from: "DUPLICATE", to: [] },
  ],
  terminalStatuses: ["CLOSED", "REJECTED", "DUPLICATE"],
  registryVersion: "feedback-registry-2026.07.2",
};

const PLANNER = { userId: "demo-event-planner", safeLabel: "Организатор ОМ" };
const ANALYST = { userId: "demo-analyst", safeLabel: "Аналитик" };
const OBJECTS_ADMIN = { userId: "demo-objects-admin", safeLabel: "Ведение объектов" };

const MAX_SUBJECT = 160;
const MAX_DESCRIPTION = 4000;

function nowIso(): string {
  return new Date().toISOString();
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * Сеяные обращения: девять — три страницы по четыре, последняя неполная.
 * Среди них чужой ЧЕРНОВИК (не виден никому, кроме автора), чужое
 * КОНФИДЕНЦИАЛЬНОЕ, обращение с согласием на техническую информацию и
 * признанный дубликат со ссылкой на оригинал.
 */
function seedRequests(): FeedbackRequest[] {
  return [
    {
      feedbackId: "fb-1001",
      subject: "Не открывается карточка мероприятия по прямой ссылке",
      description:
        "При переходе по ссылке из уведомления карточка мероприятия показывает пустой экран, приходится открывать реестр и искать мероприятие заново.",
      typeCode: "BUG",
      priorityCode: "HIGH",
      statusCode: "IN_REVIEW",
      moduleCode: "SECURITY_EVENTS",
      expectedResult: "Карточка открывается сразу по ссылке.",
      reproductionSteps:
        "1. Открыть уведомление. 2. Нажать ссылку. 3. Увидеть пустой экран.",
      attachments: [
        { fileName: "ekran.png", sizeBytes: 184_320, mimeType: "image/png" },
      ],
      contact: "вн. 12-45",
      confidential: false,
      relatedRoute: "/security-ops/events",
      technicalInfo: {
        appRevision: "port-2.5.0",
        viewport: "1440×900",
        platform: "desktop",
        capturedAt: minutesAgo(600),
      },
      // Разобранное: рабочий приоритет НИЖЕ заявленного — совпадение скрыло бы,
      // что это разные поля.
      workingPriorityCode: "NORMAL",
      assignee: OBJECTS_ADMIN,
      duplicateOfId: null,
      author: PLANNER,
      createdAt: minutesAgo(600),
      submittedAt: minutesAgo(600),
      updatedAt: minutesAgo(600),
    },
    {
      feedbackId: "fb-1002",
      subject: "В плане дежурств путается подпись состояния",
      description:
        "Две соседние колонки подписаны похоже, из-за этого приходится сверяться с легендой на каждой строке.",
      typeCode: "UX",
      priorityCode: "NORMAL",
      statusCode: "ACCEPTED",
      moduleCode: "DUTIES",
      expectedResult: "Подписи колонок различаются с первого взгляда.",
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: "/security-ops/duties",
      technicalInfo: null,
      workingPriorityCode: null,
      assignee: null,
      duplicateOfId: null,
      author: OBJECTS_ADMIN,
      createdAt: minutesAgo(540),
      submittedAt: minutesAgo(540),
      updatedAt: minutesAgo(540),
    },
    {
      feedbackId: "fb-confidential",
      subject: "Обращение по доступу",
      description:
        "Прошу разобраться с доступом: список подразделений отображается не тому сотруднику, что нарушает разграничение.",
      typeCode: "ACCESS",
      priorityCode: "CRITICAL",
      statusCode: "NEW",
      moduleCode: "OTHER",
      expectedResult: "Доступ ограничен своим подразделением.",
      reproductionSteps:
        "Открыть список подразделений под учётной записью без права.",
      attachments: [
        { fileName: "vypiska.pdf", sizeBytes: 51_200, mimeType: "application/pdf" },
      ],
      contact: "личный приём",
      confidential: true,
      relatedRoute: "/organization",
      technicalInfo: null,
      workingPriorityCode: null,
      assignee: null,
      duplicateOfId: null,
      author: OBJECTS_ADMIN,
      createdAt: minutesAgo(480),
      submittedAt: minutesAgo(480),
      updatedAt: minutesAgo(480),
    },
    // Чужой ЧЕРНОВИК: не виден никому, кроме автора, — даже обладателю права
    // видеть все обращения (отправки не было).
    {
      feedbackId: "fb-draft-foreign",
      subject: "Черновик обращения аналитика",
      description: "Не дописано: нужно приложить пример выгрузки.",
      typeCode: "IDEA",
      priorityCode: "LOW",
      statusCode: "DRAFT",
      moduleCode: "ANALYTICS",
      expectedResult: null,
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: "/security-ops/analytics",
      technicalInfo: null,
      workingPriorityCode: null,
      assignee: null,
      duplicateOfId: null,
      author: ANALYST,
      createdAt: minutesAgo(420),
      submittedAt: null,
      updatedAt: minutesAgo(420),
    },
    {
      feedbackId: "fb-1005",
      subject: "Добавить фильтр по объекту в аналитику",
      description:
        "Сейчас приходится выгружать отчёт целиком, чтобы посмотреть один объект.",
      typeCode: "IDEA",
      priorityCode: "NORMAL",
      statusCode: "PLANNED",
      moduleCode: "ANALYTICS",
      expectedResult: "Фильтр по объекту на экране аналитики.",
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: "/security-ops/analytics",
      technicalInfo: null,
      workingPriorityCode: null,
      assignee: null,
      duplicateOfId: null,
      author: ANALYST,
      createdAt: minutesAgo(360),
      submittedAt: minutesAgo(360),
      updatedAt: minutesAgo(360),
    },
    {
      feedbackId: "fb-1006",
      subject: "Неверный пост в снимке паспорта",
      description:
        "В снимке паспорта объекта пост назван старым именем, хотя версия уже новая.",
      typeCode: "WRONG_DATA",
      priorityCode: "HIGH",
      statusCode: "FIXED",
      moduleCode: "OBJECTS",
      expectedResult: "Снимок содержит имя поста действующей версии.",
      reproductionSteps: "Открыть дежурство, привязанное к версии 1.",
      attachments: [],
      contact: "вн. 12-45",
      confidential: false,
      relatedRoute: "/security-ops/objects",
      technicalInfo: null,
      workingPriorityCode: null,
      assignee: null,
      duplicateOfId: null,
      author: PLANNER,
      createdAt: minutesAgo(300),
      submittedAt: minutesAgo(300),
      updatedAt: minutesAgo(300),
    },
    {
      feedbackId: "fb-1007",
      subject: "Как отменить смену без удаления",
      description: "Не нашёл, где отменить смену так, чтобы она осталась в плане.",
      typeCode: "HELP",
      priorityCode: "LOW",
      statusCode: "CLOSED",
      moduleCode: "DUTIES",
      expectedResult: null,
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: "/security-ops/duties",
      technicalInfo: null,
      workingPriorityCode: null,
      assignee: null,
      duplicateOfId: null,
      author: OBJECTS_ADMIN,
      createdAt: minutesAgo(240),
      submittedAt: minutesAgo(240),
      updatedAt: minutesAgo(240),
    },
    {
      feedbackId: "fb-1008",
      subject: "Повтор обращения про карточку мероприятия",
      description:
        "То же, что уже сообщали: карточка не открывается по прямой ссылке.",
      typeCode: "BUG",
      priorityCode: "NORMAL",
      statusCode: "DUPLICATE",
      moduleCode: "SECURITY_EVENTS",
      expectedResult: null,
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: "/security-ops/events",
      technicalInfo: null,
      workingPriorityCode: null,
      assignee: null,
      // Признанный дубликат обязан указывать НА ЧТО.
      duplicateOfId: "fb-1001",
      author: OBJECTS_ADMIN,
      createdAt: minutesAgo(180),
      submittedAt: minutesAgo(180),
      updatedAt: minutesAgo(180),
    },
    {
      feedbackId: "fb-1009",
      subject: "Просьба вернуть сортировку по дате",
      description:
        "После обновления список стал сортироваться иначе, привычный порядок пропал.",
      typeCode: "UX",
      priorityCode: "NORMAL",
      statusCode: "REJECTED",
      moduleCode: "OTHER",
      expectedResult: null,
      reproductionSteps: null,
      attachments: [],
      contact: null,
      confidential: false,
      relatedRoute: null,
      technicalInfo: null,
      workingPriorityCode: null,
      assignee: null,
      duplicateOfId: null,
      author: PLANNER,
      createdAt: minutesAgo(120),
      submittedAt: minutesAgo(120),
      updatedAt: minutesAgo(120),
    },
  ];
}

function seedComments(): FeedbackComment[] {
  return [
    {
      commentId: "fbc-1",
      feedbackId: "fb-1001",
      kind: "PUBLIC_REPLY",
      body: "Приняли в работу, воспроизвели на тестовом контуре. Сообщим, когда исправим.",
      author: OBJECTS_ADMIN,
      createdAt: minutesAgo(560),
    },
    {
      commentId: "fbc-2",
      feedbackId: "fb-1001",
      kind: "INTERNAL_NOTE",
      body: "Причина — регрессия маршрутизации в конфигурации редиректов.",
      author: OBJECTS_ADMIN,
      createdAt: minutesAgo(555),
    },
  ];
}

function seedEvents(): FeedbackEvent[] {
  const base = {
    feedbackId: "fb-1001",
    actor: PLANNER,
    fieldCode: null,
    oldValue: null,
    newValue: null,
  };
  return [
    { ...base, eventId: "fbe-1", kind: "CREATED", at: minutesAgo(600) },
    { ...base, eventId: "fbe-2", kind: "SUBMITTED", at: minutesAgo(600) },
    {
      ...base,
      eventId: "fbe-3",
      kind: "ASSIGNED",
      actor: OBJECTS_ADMIN,
      at: minutesAgo(570),
      fieldCode: "assignee",
      oldValue: null,
      newValue: OBJECTS_ADMIN.userId,
    },
    {
      ...base,
      eventId: "fbe-4",
      kind: "STATUS_CHANGED",
      actor: OBJECTS_ADMIN,
      at: minutesAgo(565),
      fieldCode: "statusCode",
      oldValue: "NEW",
      newValue: "IN_REVIEW",
    },
    {
      ...base,
      eventId: "fbe-5",
      kind: "PUBLIC_REPLY_ADDED",
      actor: OBJECTS_ADMIN,
      at: minutesAgo(560),
    },
    {
      ...base,
      eventId: "fbe-6",
      kind: "INTERNAL_NOTE_ADDED",
      actor: OBJECTS_ADMIN,
      at: minutesAgo(555),
    },
  ];
}

function buildSeed(): FeedbackState {
  return {
    requests: seedRequests(),
    comments: seedComments(),
    events: seedEvents(),
    registry: {
      ...FEEDBACK_REGISTRY,
      types: [...FEEDBACK_REGISTRY.types],
      priorities: [...FEEDBACK_REGISTRY.priorities],
      statuses: [...FEEDBACK_REGISTRY.statuses],
      modules: [...FEEDBACK_REGISTRY.modules],
    },
    seq: 0,
  };
}

let state: FeedbackState | null = null;

function getState(): FeedbackState {
  if (state === null) {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      state = raw === null ? buildSeed() : (JSON.parse(raw) as FeedbackState);
    } catch {
      state = buildSeed();
    }
  }
  return state;
}

function persist(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // квота/приватный режим
  }
}

function nextId(prefix: string): string {
  const s = getState();
  s.seq += 1;
  return `${prefix}-${s.seq}-${Date.now()}`;
}

function errorEnvelope(errorCode: string, message: string, status: number) {
  return HttpResponse.json(
    {
      error_code: errorCode,
      message,
      details: {},
      request_id: null,
      timestamp: nowIso(),
    },
    { status }
  );
}

function notFound(entityId: string) {
  return errorEnvelope("ENTITY_NOT_FOUND", "Обращение не найдено.", 404);
}

// ── Правила видимости ────────────────────────────────────────────────────

function isOwn(request: FeedbackRequest): boolean {
  return request.author.userId === ACTOR;
}

/** Черновик — единственное, что НЕ открывается правом «видеть все»: показать
 * неотправленный текст значило бы отдать его без ведома написавшего. */
function isVisible(request: FeedbackRequest): boolean {
  if (isOwn(request)) return true;
  if (request.statusCode === "DRAFT") return false;
  // wildcard-право ops.feedback.view_all у демо-персоны есть
  return true;
}

/** Демо-персона держит ops.feedback.view_confidential — содержание видно;
 * контракт вырезания сохранён формой полей (restrictedReason и т.д.). */
function contentVisible(request: FeedbackRequest): boolean {
  if (!request.confidential) return true;
  if (isOwn(request)) return true;
  return true; // wildcard: view_confidential
}

/** Проекция наружу: тема/тип/статус/модуль видимы и у конфиденциального —
 * закрыто именно СОДЕРЖАНИЕ. */
function project(request: FeedbackRequest): FeedbackRequestView {
  const visible = contentVisible(request);
  return {
    feedbackId: request.feedbackId,
    subject: request.subject,
    typeCode: request.typeCode,
    priorityCode: request.priorityCode,
    statusCode: request.statusCode,
    moduleCode: request.moduleCode,
    authorLabel: request.author.safeLabel,
    createdAt: request.createdAt,
    submittedAt: request.submittedAt,
    confidential: request.confidential,
    workingPriorityCode: request.workingPriorityCode,
    assigneeLabel: request.assignee?.safeLabel ?? null,
    assigneeUserId: request.assignee?.userId ?? null,
    isOwn: isOwn(request),
    description: visible ? request.description : null,
    // Превью — производное описания, вырезается ВМЕСТЕ с ним.
    descriptionPreview: visible ? previewOf(request.description) : null,
    expectedResult: visible ? request.expectedResult : null,
    reproductionSteps: visible ? request.reproductionSteps : null,
    contact: visible ? request.contact : null,
    relatedRoute: visible ? request.relatedRoute : null,
    attachments: visible ? request.attachments : null,
    technicalInfo: visible ? request.technicalInfo : null,
    restrictedReason: visible ? null : RESTRICTED_REASON,
  };
}

function isTerminal(request: FeedbackRequest, s: FeedbackState): boolean {
  return s.registry.terminalStatuses.includes(request.statusCode);
}

/** Действия карточки: замок закрытого — ПЕРВЫМ и одинаково для всех действий. */
function buildActions(request: FeedbackRequest, s: FeedbackState): FeedbackAction[] {
  const closed = isTerminal(request, s);
  const draft = request.statusCode === "DRAFT";

  function action(
    code: FeedbackAction["code"],
    allowed: boolean,
    reason: string
  ): FeedbackAction {
    if (closed) return { code, available: false, reason: CLOSED_LOCK_REASON };
    if (draft) {
      return {
        code,
        available: false,
        reason: "Обращение ещё не отправлено: черновик не разбирают и не комментируют.",
      };
    }
    return allowed
      ? { code, available: true, reason: null }
      : { code, available: false, reason };
  }

  // Демо-персона wildcard: разбор и внутренние заметки доступны; причины
  // остаются в контракте — их печатает карточка при отказе замка.
  return [
    action("ADD_PUBLIC_REPLY", true, REPLY_REASON),
    action("ADD_INTERNAL_NOTE", true, INTERNAL_NOTE_REASON),
    action("TRIAGE", true, TRIAGE_REASON),
    action("CLOSE", true, TRIAGE_REASON),
  ];
}

function duplicateLink(
  request: FeedbackRequest,
  s: FeedbackState
): FeedbackDuplicateLink | null {
  if (request.duplicateOfId === null) return null;
  const target = s.requests.find((item) => item.feedbackId === request.duplicateOfId);
  // Тема оригинала — только если он сам видим смотрящему.
  if (target === undefined || !isVisible(target)) {
    return {
      feedbackId: request.duplicateOfId,
      subject: null,
      hiddenReason: "Обращение-оригинал недоступно смотрящему.",
    };
  }
  return { feedbackId: target.feedbackId, subject: target.subject, hiddenReason: null };
}

/** Единственная точка записи изменений карточки: дифф «до/после» + явные
 * события комментариев. Операции о ленте не знают. */
function commitChange(
  s: FeedbackState,
  before: FeedbackRequest,
  after: FeedbackRequest,
  extraEvents: FeedbackEvent["kind"][],
  at: string
): void {
  const actor = { userId: ACTOR, safeLabel: ACTOR };
  const changes = diffEvents(
    {
      statusCode: before.statusCode,
      workingPriorityCode: before.workingPriorityCode,
      assigneeUserId: before.assignee?.userId ?? null,
      duplicateOfId: before.duplicateOfId,
    },
    {
      statusCode: after.statusCode,
      workingPriorityCode: after.workingPriorityCode,
      assigneeUserId: after.assignee?.userId ?? null,
      duplicateOfId: after.duplicateOfId,
    },
    s.registry.terminalStatuses
  );
  const events: FeedbackEvent[] = [
    ...extraEvents.map((kind) => ({
      eventId: nextId("fbe"),
      feedbackId: after.feedbackId,
      kind,
      actor,
      at,
      fieldCode: null,
      oldValue: null,
      newValue: null,
    })),
    ...changes.map((change) => ({
      eventId: nextId("fbe"),
      feedbackId: after.feedbackId,
      kind: change.kind,
      actor,
      at,
      fieldCode: change.fieldCode,
      oldValue: change.oldValue,
      newValue: change.newValue,
    })),
  ];
  s.requests = s.requests.map((item) =>
    item.feedbackId === after.feedbackId ? after : item
  );
  s.events = [...s.events, ...events];
}

function requireOpen(request: FeedbackRequest, s: FeedbackState): string | null {
  if (isTerminal(request, s)) return CLOSED_LOCK_REASON;
  if (request.statusCode === "DRAFT")
    return "Черновик не разбирают и не комментируют: он ещё не отправлен.";
  return null;
}

// ── Handlers ─────────────────────────────────────────────────────────────

export const feedbackHandlers = [
  // §28 list: сводка по всему видимому набору, фильтры и страницы на сервере.
  http.get(`*${FEEDBACK_REQUESTS_PATH}`, ({ request }) => {
    const s = getState();
    const params = new URL(request.url).searchParams;
    const all = sortRequests(s.requests);
    const visible = all.filter(isVisible);
    const mine =
      params.get("mine") === "true" ? visible.filter((r) => isOwn(r)) : visible;

    const filters = {
      search: params.get("search") ?? "",
      typeCode: (params.get("type") ?? undefined) as FeedbackTypeCode | undefined,
      statusCode: (params.get("status") ?? undefined) as
        | FeedbackStatusCode
        | undefined,
      moduleCode: params.get("module") ?? undefined,
    };
    const matched = mine.filter((request) =>
      matchesFilters(request, filters, contentVisible(request))
    );

    const requestedPage = Number(params.get("page") ?? "1") || 1;
    const total = feedbackPageCount(matched.length, FEEDBACK_PAGE_SIZE);
    // Страница за пределами набора — отдаём последнюю, а не ошибку.
    const page = Math.min(Math.max(1, requestedPage), total);

    const response: ListFeedbackResponse = {
      results: pageOf(matched, page, FEEDBACK_PAGE_SIZE).map(project),
      stats: buildStats(
        visible,
        s.registry.statuses.map((entry) => entry.code)
      ),
      registry: s.registry,
      page,
      pageSize: FEEDBACK_PAGE_SIZE,
      pageCount: total,
      totalMatched: matched.length,
      totalVisible: visible.length,
      unavailableCapabilities: UNAVAILABLE_CAPABILITIES.map((item) => ({ ...item })),
      serverTime: nowIso(),
    };
    return HttpResponse.json(response);
  }),

  // §28 create: черновик или новое.
  http.post(`*${FEEDBACK_REQUESTS_PATH}`, async ({ request }) => {
    const body = (await request.json()) as CreateFeedbackRequest;
    const s = getState();
    if (body.subject.trim() === "") {
      return errorEnvelope("VALIDATION_ERROR", "Тема обращения обязательна.", 422);
    }
    if (body.subject.length > MAX_SUBJECT) {
      return errorEnvelope(
        "VALIDATION_ERROR",
        `Тема длиннее ${MAX_SUBJECT} символов.`,
        422
      );
    }
    if (body.description.trim() === "") {
      return errorEnvelope("VALIDATION_ERROR", "Описание обращения обязательно.", 422);
    }
    if (body.description.length > MAX_DESCRIPTION) {
      return errorEnvelope(
        "VALIDATION_ERROR",
        `Описание длиннее ${MAX_DESCRIPTION} символов.`,
        422
      );
    }
    // Коды сверяются со СПРАВОЧНИКОМ: сюда приходит тело запроса, а не наш код.
    if (!s.registry.types.some((entry) => entry.code === body.typeCode)) {
      return errorEnvelope("VALIDATION_ERROR", "Неизвестный тип обращения.", 422);
    }
    if (!s.registry.priorities.some((entry) => entry.code === body.priorityCode)) {
      return errorEnvelope("VALIDATION_ERROR", "Неизвестный приоритет.", 422);
    }
    if (!s.registry.modules.some((entry) => entry.moduleCode === body.moduleCode)) {
      return errorEnvelope("VALIDATION_ERROR", "Неизвестный модуль.", 422);
    }

    const now = nowIso();
    const draft = body.saveAsDraft;
    const created: FeedbackRequest = {
      feedbackId: nextId("feedback"),
      subject: body.subject.trim(),
      description: body.description.trim(),
      typeCode: body.typeCode,
      priorityCode: body.priorityCode,
      statusCode: draft ? "DRAFT" : "NEW",
      moduleCode: body.moduleCode,
      expectedResult: body.expectedResult,
      reproductionSteps: body.reproductionSteps,
      // §28 «attachment metadata»: запись собирается ПОИМЁННО — содержимому
      // файла, даже приехавшему в теле, места неоткуда взяться.
      attachments: body.attachments.map((file) => ({
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
      })),
      contact: body.contact,
      confidential: body.confidential,
      relatedRoute: body.relatedRoute,
      // Согласие решает СЕРВЕР: присланная без согласия техническая
      // информация не сохраняется.
      technicalInfo: body.includeTechnicalInfo ? body.technicalInfo : null,
      // Разбор не начинался: не копия заявленного, а отсутствие решения.
      workingPriorityCode: null,
      assignee: null,
      duplicateOfId: null,
      author: { userId: ACTOR, safeLabel: ACTOR },
      createdAt: now,
      submittedAt: draft ? null : now,
      updatedAt: now,
    };
    s.requests = [...s.requests, created];
    s.events = [
      ...s.events,
      {
        eventId: nextId("fbe"),
        feedbackId: created.feedbackId,
        kind: "CREATED",
        actor: created.author,
        at: now,
        fieldCode: null,
        oldValue: null,
        newValue: null,
      },
      ...(draft
        ? []
        : [
            {
              eventId: nextId("fbe"),
              feedbackId: created.feedbackId,
              kind: "SUBMITTED" as const,
              actor: created.author,
              at: now,
              fieldCode: null,
              oldValue: null,
              newValue: null,
            },
          ]),
    ];
    persist();
    return HttpResponse.json(created);
  }),

  // §28 «Черновик» → «Новое»: только СВОЙ черновик.
  http.post(`*${FEEDBACK_SUBMIT_PATH_PATTERN}`, ({ params }) => {
    const feedbackId = decodeURIComponent(params.feedbackId as string);
    const s = getState();
    const request = s.requests.find((item) => item.feedbackId === feedbackId);
    // Невидимое — 404: отказ по праву подтвердил бы существование.
    if (request === undefined || !isVisible(request) || !isOwn(request)) {
      return notFound(feedbackId);
    }
    if (request.statusCode !== "DRAFT") {
      return errorEnvelope("FEEDBACK_ALREADY_SUBMITTED", "Обращение уже отправлено.", 422);
    }
    const now = nowIso();
    const next: FeedbackRequest = {
      ...request,
      statusCode: "NEW",
      submittedAt: now,
      updatedAt: now,
    };
    s.requests = s.requests.map((item) =>
      item.feedbackId === feedbackId ? next : item
    );
    s.events = [
      ...s.events,
      {
        eventId: nextId("fbe"),
        feedbackId,
        kind: "SUBMITTED",
        actor: { userId: ACTOR, safeLabel: ACTOR },
        at: now,
        fieldCode: null,
        oldValue: null,
        newValue: null,
      },
    ];
    persist();
    return HttpResponse.json(next);
  }),

  // §28 detail: комментарии (внутренние — по праву; wildcard видит).
  http.post(`*${FEEDBACK_COMMENTS_PATH_PATTERN}`, async ({ params, request }) => {
    const feedbackId = decodeURIComponent(params.feedbackId as string);
    const body = (await request.json()) as AddFeedbackCommentRequest;
    const s = getState();
    const found = s.requests.find((item) => item.feedbackId === feedbackId);
    if (found === undefined || !isVisible(found)) return notFound(feedbackId);
    const lock = requireOpen(found, s);
    if (lock !== null) return errorEnvelope("FEEDBACK_CLOSED", lock, 422);
    if (body.body.trim() === "") {
      return errorEnvelope("VALIDATION_ERROR", "Комментарий пуст.", 422);
    }
    const now = nowIso();
    const comment: FeedbackComment = {
      commentId: nextId("fbc"),
      feedbackId,
      kind: body.kind,
      body: body.body.trim(),
      author: { userId: ACTOR, safeLabel: ACTOR },
      createdAt: now,
    };
    commitChange(
      s,
      found,
      { ...found, updatedAt: now },
      [body.kind === "PUBLIC_REPLY" ? "PUBLIC_REPLY_ADDED" : "INTERNAL_NOTE_ADDED"],
      now
    );
    s.comments = [...s.comments, comment];
    persist();
    return HttpResponse.json({ feedbackId });
  }),

  // §28 detail: разбор одной операцией.
  http.post(`*${FEEDBACK_TRIAGE_PATH_PATTERN}`, async ({ params, request }) => {
    const feedbackId = decodeURIComponent(params.feedbackId as string);
    const body = (await request.json()) as TriageFeedbackRequest;
    const s = getState();
    const found = s.requests.find((item) => item.feedbackId === feedbackId);
    if (found === undefined || !isVisible(found)) return notFound(feedbackId);
    const lock = requireOpen(found, s);
    if (lock !== null) return errorEnvelope("FEEDBACK_CLOSED", lock, 422);

    let next: FeedbackRequest = { ...found, updatedAt: nowIso() };
    if (body.statusCode !== undefined) {
      // Переход сверяется с КАРТОЙ справочника.
      if (!allowedTransitions(s.registry, found.statusCode).includes(body.statusCode)) {
        return errorEnvelope(
          "FEEDBACK_TRANSITION_NOT_ALLOWED",
          "Такой переход статуса не разрешён справочником.",
          422
        );
      }
      // Закрытие — отдельная операция со своим публичным ответом.
      if (s.registry.terminalStatuses.includes(body.statusCode)) {
        return errorEnvelope(
          "FEEDBACK_USE_CLOSE",
          "Закрытие обращения оформляется отдельным действием с ответом автору.",
          422
        );
      }
      next = { ...next, statusCode: body.statusCode };
    }
    if (body.assigneeUserId !== undefined) {
      next = {
        ...next,
        assignee:
          body.assigneeUserId === null
            ? null
            : { userId: body.assigneeUserId, safeLabel: body.assigneeUserId },
      };
    }
    if (body.workingPriorityCode !== undefined) {
      if (
        body.workingPriorityCode !== null &&
        !s.registry.priorities.some((entry) => entry.code === body.workingPriorityCode)
      ) {
        return errorEnvelope("VALIDATION_ERROR", "Неизвестный приоритет.", 422);
      }
      next = { ...next, workingPriorityCode: body.workingPriorityCode };
    }
    commitChange(s, found, next, [], nowIso());
    persist();
    return HttpResponse.json({ feedbackId });
  }),

  // §28 detail: закрытие с обязательным ответом автору.
  http.post(`*${FEEDBACK_CLOSE_PATH_PATTERN}`, async ({ params, request }) => {
    const feedbackId = decodeURIComponent(params.feedbackId as string);
    const body = (await request.json()) as CloseFeedbackRequest;
    const s = getState();
    const found = s.requests.find((item) => item.feedbackId === feedbackId);
    if (found === undefined || !isVisible(found)) return notFound(feedbackId);
    const lock = requireOpen(found, s);
    if (lock !== null) return errorEnvelope("FEEDBACK_CLOSED", lock, 422);

    if (!s.registry.terminalStatuses.includes(body.statusCode)) {
      return errorEnvelope(
        "VALIDATION_ERROR",
        "Закрыть обращение можно только терминальным статусом.",
        422
      );
    }
    if (!allowedTransitions(s.registry, found.statusCode).includes(body.statusCode)) {
      return errorEnvelope(
        "FEEDBACK_TRANSITION_NOT_ALLOWED",
        "Такой переход статуса не разрешён справочником.",
        422
      );
    }
    if (body.publicReply.trim() === "") {
      return errorEnvelope("VALIDATION_ERROR", "Закрытие сопровождается ответом автору.", 422);
    }
    let duplicateOfId = found.duplicateOfId;
    if (body.statusCode === "DUPLICATE") {
      const targetId = body.duplicateOfId ?? null;
      if (targetId === null) {
        return errorEnvelope(
          "VALIDATION_ERROR",
          "Признание дубликатом требует указать обращение-оригинал.",
          422
        );
      }
      if (targetId === found.feedbackId) {
        return errorEnvelope(
          "VALIDATION_ERROR",
          "Обращение не может быть дубликатом самого себя.",
          422
        );
      }
      // Оригинал обязан быть ВИДИМ закрывающему.
      const target = s.requests.find((item) => item.feedbackId === targetId);
      if (target === undefined || !isVisible(target)) return notFound(targetId);
      duplicateOfId = targetId;
    }

    const now = nowIso();
    const next: FeedbackRequest = {
      ...found,
      statusCode: body.statusCode,
      duplicateOfId,
      updatedAt: now,
    };
    const comment: FeedbackComment = {
      commentId: nextId("fbc"),
      feedbackId,
      kind: "PUBLIC_REPLY",
      body: body.publicReply.trim(),
      author: { userId: ACTOR, safeLabel: ACTOR },
      createdAt: now,
    };
    commitChange(s, found, next, ["PUBLIC_REPLY_ADDED"], now);
    s.comments = [...s.comments, comment];
    persist();
    return HttpResponse.json({ feedbackId });
  }),

  // §28 detail: карточка. Регистрируется ПОСЛЕ подпутей — но методы и число
  // сегментов различают их и так; путь :feedbackId/ матчится только на один
  // сегмент.
  http.get(`*${FEEDBACK_DETAIL_PATH_PATTERN}`, ({ params }) => {
    const feedbackId = decodeURIComponent(params.feedbackId as string);
    const s = getState();
    const request = s.requests.find((item) => item.feedbackId === feedbackId);
    if (request === undefined || !isVisible(request)) return notFound(feedbackId);

    // Демо-персона видит внутренние заметки (wildcard ops.feedback.internal_note).
    const internal = true;
    const response: FeedbackDetailResponse = {
      request: project(request),
      comments: s.comments
        .filter((comment) => comment.feedbackId === feedbackId)
        .filter((comment) => commentVisibleTo(comment.kind, internal))
        .sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1))
        .map((comment) => ({
          commentId: comment.commentId,
          kind: comment.kind,
          body: comment.body,
          authorLabel: comment.author.safeLabel,
          createdAt: comment.createdAt,
        })),
      timeline: s.events
        .filter((event) => event.feedbackId === feedbackId)
        .filter((event) => eventVisibleTo(event.kind, internal))
        .sort((left, right) => (left.at < right.at ? -1 : 1))
        .map((event) => ({
          eventId: event.eventId,
          kind: event.kind,
          actorLabel: event.actor.safeLabel,
          at: event.at,
          fieldCode: event.fieldCode,
          oldValue: event.oldValue,
          newValue: event.newValue,
        })),
      actions: buildActions(request, s),
      allowedStatuses: allowedTransitions(s.registry, request.statusCode),
      // Кандидаты — те, кто УЖЕ участвовал в обращениях: справочника
      // сотрудников поддержки в demo-срезе нет.
      assigneeCandidates: [
        ...new Map(
          s.requests
            .flatMap((item) => (item.assignee === null ? [] : [item.assignee]))
            .concat(s.comments.map((comment) => comment.author))
            .map((person) => [person.userId, person])
        ).values(),
      ],
      duplicateOf: duplicateLink(request, s),
      registry: s.registry,
      unavailableBlocks: UNAVAILABLE_CARD_BLOCKS.map((item) => ({ ...item })),
      serverTime: nowIso(),
    };
    return HttpResponse.json(response);
  }),
];
