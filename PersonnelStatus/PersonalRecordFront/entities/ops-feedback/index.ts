// Обратная связь раздела ОМ (§28) — нативный порт из Smart Josparlau:
// обращение пользователя — тип, приоритет, статус, модуль, вложения
// (МЕТАДАННЫЕ), контакт, признак конфиденциальности и техническая информация
// по согласию автора. Коды — в типах (контракт §28), подписи и порядок — в
// данных (справочник приходит с сервера).

// ── Модель ───────────────────────────────────────────────────────────────

export type FeedbackTypeCode = "BUG" | "WRONG_DATA" | "UX" | "IDEA" | "ACCESS" | "HELP";

/** Приоритет, ЗАЯВЛЕННЫЙ автором. Рабочий приоритет — другое поле и другой
 * владелец: его назначает разбирающий. */
export type FeedbackPriorityCode = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

/** §28 «Статусы» — все одиннадцать. */
export type FeedbackStatusCode =
  | "DRAFT"
  | "NEW"
  | "IN_REVIEW"
  | "NEED_INFO"
  | "ACCEPTED"
  | "PLANNED"
  | "FIXED"
  | "RELEASED"
  | "REJECTED"
  | "CLOSED"
  | "DUPLICATE";

/** §28 «attachment metadata» — РОВНО метаданные: blob-хранилища нет,
 * содержимое файла не читается вообще. */
export interface FeedbackAttachmentMeta {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}

/** Техническая информация — ТОЛЬКО по явному согласию автора. Без согласия
 * поля нет вовсе (null), а не пустой объект. */
export interface FeedbackTechnicalInfo {
  appRevision: string;
  viewport: string;
  platform: string;
  capturedAt: string;
}

export interface FeedbackAuthor {
  userId: string;
  safeLabel: string;
}

/** Обращение, КАК ОНО ЛЕЖИТ В СТОРЕ. Наружу едет проекция FeedbackRequestView. */
export interface FeedbackRequest {
  feedbackId: string;
  subject: string;
  description: string;
  typeCode: FeedbackTypeCode;
  priorityCode: FeedbackPriorityCode;
  statusCode: FeedbackStatusCode;
  moduleCode: string;
  expectedResult: string | null;
  reproductionSteps: string | null;
  attachments: FeedbackAttachmentMeta[];
  contact: string | null;
  /** Закрывает СОДЕРЖАНИЕ обращения, но не тему. */
  confidential: boolean;
  /** Экран, о котором обращение, — предмет, а не телеметрия. */
  relatedRoute: string | null;
  technicalInfo: FeedbackTechnicalInfo | null;
  /** Рабочий приоритет — null до разбора. */
  workingPriorityCode: FeedbackPriorityCode | null;
  assignee: FeedbackAuthor | null;
  /** Заполняется только вместе со статусом DUPLICATE. */
  duplicateOfId: string | null;
  author: FeedbackAuthor;
  createdAt: string;
  /** null у черновика — отсутствие события, а не ноль. */
  submittedAt: string | null;
  updatedAt: string;
}

/** Два ВИДА комментария, а не флаг «приватный»: разные читатели, разные права
 * на запись и разная судьба в ленте. */
export type FeedbackCommentKind = "PUBLIC_REPLY" | "INTERNAL_NOTE";

export interface FeedbackComment {
  commentId: string;
  feedbackId: string;
  kind: FeedbackCommentKind;
  body: string;
  author: FeedbackAuthor;
  createdAt: string;
}

/** §28 «timeline» + «audit» — ОДНА лента: событие несёт и вид, и old/new. */
export type FeedbackEventKind =
  | "CREATED"
  | "SUBMITTED"
  | "STATUS_CHANGED"
  | "ASSIGNED"
  | "WORKING_PRIORITY_SET"
  | "PUBLIC_REPLY_ADDED"
  | "INTERNAL_NOTE_ADDED"
  | "MARKED_DUPLICATE"
  | "CLOSED";

export interface FeedbackEvent {
  eventId: string;
  feedbackId: string;
  kind: FeedbackEventKind;
  actor: FeedbackAuthor;
  at: string;
  fieldCode: string | null;
  oldValue: string | null;
  newValue: string | null;
}

/** Действия карточки считает СЕРВЕР — по статусу, правам и замку закрытого. */
export type FeedbackActionCode =
  | "ADD_PUBLIC_REPLY"
  | "ADD_INTERNAL_NOTE"
  | "TRIAGE"
  | "CLOSE";

export interface FeedbackAction {
  code: FeedbackActionCode;
  available: boolean;
  reason: string | null;
}

export interface FeedbackDictionaryEntry<TCode extends string> {
  code: TCode;
  label: string;
}

export interface FeedbackModuleEntry {
  moduleCode: string;
  label: string;
}

/** Справочник §28: подписи, порядок и КАРТА ПЕРЕХОДОВ — в данных. */
export interface FeedbackRegistry {
  types: FeedbackDictionaryEntry<FeedbackTypeCode>[];
  priorities: FeedbackDictionaryEntry<FeedbackPriorityCode>[];
  statuses: FeedbackDictionaryEntry<FeedbackStatusCode>[];
  modules: FeedbackModuleEntry[];
  statusTransitions: { from: FeedbackStatusCode; to: FeedbackStatusCode[] }[];
  terminalStatuses: FeedbackStatusCode[];
  registryVersion: string;
}

// ── Пути API (pending-контракт) ──────────────────────────────────────────

export const FEEDBACK_REQUESTS_PATH = "/api/ops/feedback-requests/";

export function feedbackDetailPath(id: string): string {
  return `${FEEDBACK_REQUESTS_PATH}${encodeURIComponent(id)}/`;
}
export function feedbackSubmitPath(id: string): string {
  return `${FEEDBACK_REQUESTS_PATH}${encodeURIComponent(id)}/submit/`;
}
export function feedbackCommentsPath(id: string): string {
  return `${FEEDBACK_REQUESTS_PATH}${encodeURIComponent(id)}/comments/`;
}
/** Разбор — ОДНА операция: ответственный, приоритет и статус решаются вместе. */
export function feedbackTriagePath(id: string): string {
  return `${FEEDBACK_REQUESTS_PATH}${encodeURIComponent(id)}/triage/`;
}
export function feedbackClosePath(id: string): string {
  return `${FEEDBACK_REQUESTS_PATH}${encodeURIComponent(id)}/close/`;
}
// Шаблоны для MSW — литералами (фабрика энкодит ":" в %3A).
export const FEEDBACK_DETAIL_PATH_PATTERN = "/api/ops/feedback-requests/:feedbackId/";
export const FEEDBACK_SUBMIT_PATH_PATTERN =
  "/api/ops/feedback-requests/:feedbackId/submit/";
export const FEEDBACK_COMMENTS_PATH_PATTERN =
  "/api/ops/feedback-requests/:feedbackId/comments/";
export const FEEDBACK_TRIAGE_PATH_PATTERN =
  "/api/ops/feedback-requests/:feedbackId/triage/";
export const FEEDBACK_CLOSE_PATH_PATTERN =
  "/api/ops/feedback-requests/:feedbackId/close/";

// ── Контракты ответов ────────────────────────────────────────────────────

export interface FeedbackNotice {
  code: string;
  label: string;
  reason: string;
}

/** Обращение В ОТВЕТЕ: содержание конфиденциального может ОТСУТСТВОВАТЬ —
 * вырезано на сервере, а не спрятано вёрсткой. */
export interface FeedbackRequestView {
  feedbackId: string;
  subject: string;
  typeCode: FeedbackTypeCode;
  priorityCode: FeedbackPriorityCode;
  statusCode: FeedbackStatusCode;
  moduleCode: string;
  authorLabel: string;
  createdAt: string;
  submittedAt: string | null;
  confidential: boolean;
  /** Решение службы об обращении — конфиденциальность его не закрывает. */
  workingPriorityCode: FeedbackPriorityCode | null;
  assigneeLabel: string | null;
  assigneeUserId: string | null;
  /** Решает сервер. */
  isOwn: boolean;
  /** Всё ниже — содержание: у закрытого приходит null целиком. */
  description: string | null;
  /** Производное описания — вырезается ВМЕСТЕ с ним. */
  descriptionPreview: string | null;
  expectedResult: string | null;
  reproductionSteps: string | null;
  contact: string | null;
  relatedRoute: string | null;
  attachments: FeedbackAttachmentMeta[] | null;
  technicalInfo: FeedbackTechnicalInfo | null;
  restrictedReason: string | null;
}

export interface ListFeedbackResponse {
  results: FeedbackRequestView[];
  /** §28 «stats» — по всему видимому набору, не по странице. */
  stats: FeedbackStats;
  registry: FeedbackRegistry;
  page: number;
  pageSize: number;
  pageCount: number;
  totalMatched: number;
  /** «Ничего не нашлось» и «обращений ещё нет» — разные сообщения. */
  totalVisible: number;
  unavailableCapabilities: FeedbackNotice[];
  serverTime: string;
}

/** Фильтры применяет СЕРВЕР: закрытые строки до браузера не доезжают. */
export interface ListFeedbackFilters {
  search?: string;
  typeCode?: FeedbackTypeCode;
  statusCode?: FeedbackStatusCode;
  moduleCode?: string;
  page?: number;
  mine?: boolean;
}

export type CreateFeedbackRequest = {
  subject: string;
  description: string;
  typeCode: FeedbackTypeCode;
  priorityCode: FeedbackPriorityCode;
  moduleCode: string;
  expectedResult: string | null;
  reproductionSteps: string | null;
  contact: string | null;
  confidential: boolean;
  relatedRoute: string | null;
  attachments: FeedbackAttachmentMeta[];
  /** ЯВНОЕ согласие автора на техническую информацию. */
  includeTechnicalInfo: boolean;
  technicalInfo: FeedbackTechnicalInfo | null;
  /** «Черновик» — отдельный статус, а не несохранённая форма. */
  saveAsDraft: boolean;
};

export type CreateFeedbackResponse = FeedbackRequest;
export type SubmitFeedbackResponse = FeedbackRequest;

/** Внутренние заметки в ответ тому, кому они не видны, не попадают ВООБЩЕ. */
export interface FeedbackCommentView {
  commentId: string;
  kind: FeedbackCommentKind;
  body: string;
  authorLabel: string;
  createdAt: string;
}

export interface FeedbackEventView {
  eventId: string;
  kind: FeedbackEventKind;
  actorLabel: string;
  at: string;
  fieldCode: string | null;
  oldValue: string | null;
  newValue: string | null;
}

export interface FeedbackDuplicateLink {
  feedbackId: string;
  /** null, если оригинал смотрящему не виден. */
  subject: string | null;
  hiddenReason: string | null;
}

export interface FeedbackDetailResponse {
  request: FeedbackRequestView;
  comments: FeedbackCommentView[];
  timeline: FeedbackEventView[];
  actions: FeedbackAction[];
  /** Считает сервер по карте переходов справочника. */
  allowedStatuses: FeedbackStatusCode[];
  assigneeCandidates: { userId: string; safeLabel: string }[];
  duplicateOf: FeedbackDuplicateLink | null;
  registry: FeedbackRegistry;
  unavailableBlocks: FeedbackNotice[];
  serverTime: string;
}

export type AddFeedbackCommentRequest = {
  feedbackId: string;
  kind: FeedbackCommentKind;
  body: string;
};

export type TriageFeedbackRequest = {
  feedbackId: string;
  /** undefined — «не трогать»; null — «снять». */
  assigneeUserId?: string | null;
  workingPriorityCode?: FeedbackPriorityCode | null;
  statusCode?: FeedbackStatusCode;
};

export type CloseFeedbackRequest = {
  feedbackId: string;
  /** Только терминальный статус справочника. */
  statusCode: FeedbackStatusCode;
  /** Обязателен для DUPLICATE. */
  duplicateOfId?: string | null;
  /** §28: закрытие сопровождается публичным ответом автору. */
  publicReply: string;
};

export type FeedbackMutationResponse = { feedbackId: string };

// ── Чистая логика (серверная сторона мока) ───────────────────────────────

/** Причина, по которой содержание конфиденциального обращения вырезано. */
export const RESTRICTED_REASON =
  "Обращение помечено автором как конфиденциальное: содержание доступно автору и обладателю права ops.feedback.view_confidential.";

export const UNAVAILABLE_CAPABILITIES: readonly FeedbackNotice[] = [
  {
    code: "ATTACHMENT_CONTENT",
    label: "Содержимое вложений",
    reason:
      "Blob-хранилища в проекте нет. §28 требует «attachment metadata» — сохраняются имя, размер и тип файла; содержимое не читается и не передаётся, поэтому и скачать вложение нельзя.",
  },
  {
    code: "NOTIFY_AUTHOR",
    label: "Уведомление автора об ответе",
    reason:
      "Канал уведомлений раздела ОМ несёт события оценивания; события обратной связи появятся в нём, когда у обращений появится реальный бэкенд с consumer'ом — сеять их в мок значило бы обещать доставку, которой нет.",
  },
];

/**
 * §28 «search»: область поиска — ТОЛЬКО видимые смотрящему поля. Поиск по
 * вырезанному описанию выдал бы его содержимое фактом совпадения.
 */
export function matchesSearch(
  request: FeedbackRequest,
  query: string,
  contentVisible: boolean
): boolean {
  const needle = query.trim().toLocaleLowerCase("ru");
  if (needle === "") return true;
  if (request.subject.toLocaleLowerCase("ru").includes(needle)) return true;
  if (!contentVisible) return false;
  return request.description.toLocaleLowerCase("ru").includes(needle);
}

export const PREVIEW_LENGTH = 120;

/** Превью — производное описания, вырезается вместе с ним. */
export function previewOf(description: string): string {
  const single = description.replace(/\s+/gu, " ").trim();
  if (single.length <= PREVIEW_LENGTH) return single;
  return `${single.slice(0, PREVIEW_LENGTH).trimEnd()}…`;
}

/** Порядок задаёт СЕРВЕР: недавние сверху, tie-breaker по id — без него две
 * записи одной миллисекунды «съезжали» бы между страницами. */
export function sortRequests(
  requests: readonly FeedbackRequest[]
): FeedbackRequest[] {
  return [...requests].sort((left, right) => {
    if (left.createdAt !== right.createdAt)
      return left.createdAt < right.createdAt ? 1 : -1;
    return left.feedbackId < right.feedbackId ? -1 : 1;
  });
}

/** Размер страницы намеренно мал: иначе пагинация жила бы непроверенной. */
export const FEEDBACK_PAGE_SIZE = 4;

export function pageOf<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function feedbackPageCount(total: number, pageSize: number): number {
  // Ноль строк — всё равно одна (пустая) страница.
  return Math.max(1, Math.ceil(total / pageSize));
}

export interface FeedbackStatusCount {
  statusCode: FeedbackStatusCode;
  count: number;
}

export interface FeedbackStats {
  byStatus: FeedbackStatusCount[];
  total: number;
}

/** §28 «stats» — по всему видимому набору, до фильтров и страниц; порядок
 * статусов — из справочника. */
export function buildStats(
  requests: readonly FeedbackRequest[],
  order: readonly FeedbackStatusCode[]
): FeedbackStats {
  const counts = new Map<FeedbackStatusCode, number>();
  for (const request of requests) {
    counts.set(request.statusCode, (counts.get(request.statusCode) ?? 0) + 1);
  }
  return {
    byStatus: order.map((statusCode) => ({
      statusCode,
      count: counts.get(statusCode) ?? 0,
    })),
    total: requests.length,
  };
}

export interface FeedbackFilterValues {
  search: string;
  typeCode?: FeedbackTypeCode;
  statusCode?: FeedbackStatusCode;
  moduleCode?: string;
}

export function matchesFilters(
  request: FeedbackRequest,
  filters: FeedbackFilterValues,
  contentVisible: boolean
): boolean {
  if (filters.typeCode !== undefined && request.typeCode !== filters.typeCode)
    return false;
  if (filters.statusCode !== undefined && request.statusCode !== filters.statusCode)
    return false;
  if (filters.moduleCode !== undefined && request.moduleCode !== filters.moduleCode)
    return false;
  return matchesSearch(request, filters.search, contentVisible);
}

// ── Карточка (§28 detail) ────────────────────────────────────────────────

export const CLOSED_LOCK_REASON =
  "Обращение закрыто: изменения и комментарии в закрытое обращение не добавляются.";

export const INTERNAL_NOTE_REASON =
  "Внутренняя заметка требует отдельного права ops.feedback.internal_note: право отвечать автору его не включает.";

export const TRIAGE_REASON =
  "Разбор обращения требует права ops.feedback.triage: право читать обращения его не включает.";

export const REPLY_REASON =
  "Публичный ответ пишет разбирающий обращение (ops.feedback.triage) или его автор.";

export const UNAVAILABLE_CARD_BLOCKS: readonly FeedbackNotice[] = [
  {
    code: "ATTACHMENT_CONTENT",
    label: "Содержимое вложений",
    reason:
      "Blob-хранилища в проекте нет: карточка показывает имя, размер и тип файла. Кнопки скачивания нет — скачивать нечего.",
  },
  {
    code: "SLA",
    label: "Срок реакции",
    reason:
      "Политики сроков (SLA) в модели нет, а срок, посчитанный по умолчанию, был бы обещанием, которого никто не давал.",
  },
  {
    code: "LINKED_ENTITY",
    label: "Связанная сущность",
    reason:
      "«Related screen» карточка показывает маршрутом, с которого обращение завели. Связь с конкретной записью в модели не хранится: восстанавливать её по тексту значило бы угадывать.",
  },
];

/** Кто может читать внутренние заметки — отдельное право. */
export function commentVisibleTo(
  kind: FeedbackCommentKind,
  canSeeInternal: boolean
): boolean {
  return kind === "PUBLIC_REPLY" || canSeeInternal;
}

/** Событие внутренней заметки скрывается ЦЕЛИКОМ, а не «без текста»: строка
 * без текста всё равно сообщила бы автору, что о нём что-то написали. */
export function eventVisibleTo(
  kind: FeedbackEventKind,
  canSeeInternal: boolean
): boolean {
  return kind !== "INTERNAL_NOTE_ADDED" || canSeeInternal;
}

export interface FeedbackFieldChange {
  fieldCode: string;
  oldValue: string | null;
  newValue: string | null;
  kind: FeedbackEventKind;
}

function valueOf(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value;
}

/**
 * Лента пишется ДИФФОМ в единственной точке: операции меняют поля, ничего не
 * зная о ленте, — забытое ручное событие молча оставило бы аудит неполным.
 */
export function diffEvents(
  before: {
    statusCode: FeedbackStatusCode;
    workingPriorityCode: string | null;
    assigneeUserId: string | null;
    duplicateOfId: string | null;
  },
  after: typeof before,
  terminalStatuses: readonly FeedbackStatusCode[]
): FeedbackFieldChange[] {
  const changes: FeedbackFieldChange[] = [];
  if (before.statusCode !== after.statusCode) {
    changes.push({
      fieldCode: "statusCode",
      oldValue: before.statusCode,
      newValue: after.statusCode,
      // Закрытие — отдельный вид события, а не «ещё одна смена статуса».
      kind: terminalStatuses.includes(after.statusCode) ? "CLOSED" : "STATUS_CHANGED",
    });
  }
  if (valueOf(before.workingPriorityCode) !== valueOf(after.workingPriorityCode)) {
    changes.push({
      fieldCode: "workingPriorityCode",
      oldValue: valueOf(before.workingPriorityCode),
      newValue: valueOf(after.workingPriorityCode),
      kind: "WORKING_PRIORITY_SET",
    });
  }
  if (valueOf(before.assigneeUserId) !== valueOf(after.assigneeUserId)) {
    changes.push({
      fieldCode: "assignee",
      oldValue: valueOf(before.assigneeUserId),
      newValue: valueOf(after.assigneeUserId),
      kind: "ASSIGNED",
    });
  }
  if (valueOf(before.duplicateOfId) !== valueOf(after.duplicateOfId)) {
    changes.push({
      fieldCode: "duplicateOfId",
      oldValue: valueOf(before.duplicateOfId),
      newValue: valueOf(after.duplicateOfId),
      kind: "MARKED_DUPLICATE",
    });
  }
  return changes;
}

/** Допустимые следующие статусы — из справочника, а не из кода. */
export function allowedTransitions(
  registry: {
    statusTransitions: { from: FeedbackStatusCode; to: FeedbackStatusCode[] }[];
  },
  from: FeedbackStatusCode
): FeedbackStatusCode[] {
  return registry.statusTransitions.find((entry) => entry.from === from)?.to ?? [];
}
