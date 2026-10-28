import { dutyTimestampForInput, dutyTimestampForSave } from "@/features/employee-status-update/model/duty-intervals";
import { STAGE_ORDER } from "@/entities/security-event/model/stage-meta";

export const ASSISTANT_PERMISSIONS = ["event.create", "event.bulletin", "event.manage", "forces.command"] as const;
export const ASSISTANT_PATH = "/security-ops/assistant";
export const ASSISTANT_GROUP = "ops-assistant";

export interface AssistantAllocation { departmentId: string; departmentName?: string; need: number; dueAt?: string | null }
export interface AssistantFields {
  title?: string | null; businessDate?: string | null; businessDateEnd?: string | null;
  eventTime?: string | null; kind?: "INTERNAL" | "FOREIGN" | null; objectId?: string | null;
  eventId?: string | null; personnelTotal?: number | null; intent?: "prepare" | "send"; allocations?: AssistantAllocation[];
}
export interface AssistantBriefingPost {
  number: number; subpostCount?: number | null; need?: number | null;
  subposts?: { number: number; need?: number | null }[];
}
export interface AssistantBriefingObject {
  name: string; objectId?: string | null; chiefName?: string | null; chiefEmployeeId?: string | null;
  sectorCount?: number | null;
  sectors: { number: number; postCount?: number | null; posts: AssistantBriefingPost[] }[];
  personnelNeed?: number | null; needStatus: "known" | "unknown"; checklistChecked?: boolean | null;
  checklistResults?: { id: string; state: "NORMAL" | "REMARK" | "UNCHECKED"; comment?: string | null }[];
}
export interface AssistantBriefing {
  objects: AssistantBriefingObject[];
  protectedPersons: { code?: string | null; name?: string | null; country?: string | null;
    createIfMissing?: boolean; personId?: string | null }[];
  issues?: { field: string; text: string }[];
}
export interface AssistantBriefingPending { objectId?: string | null; objectName?: string | null; action: string; reason: string }
export interface AssistantPlan extends AssistantFields {
  objectName?: string | null; briefing?: AssistantBriefing | null; briefingPending?: AssistantBriefingPending[] | null;
}
export interface AssistantReceipt {
  operation: string; executedBy: string; createdAt: string;
  result: { delivery?: { known: boolean; notifiedOfficers?: number; unaddressed?: unknown[] | number; undelivered?: unknown[] | number }; [key: string]: unknown };
}
export interface AssistantGuidanceQuestion {
  id: string; field: string; text: string; placeholder?: string;
  choices?: { label: string; value: string }[]; canDefer?: boolean;
}
export interface AssistantGuidance {
  current: AssistantGuidanceQuestion | null; remaining: number; deferred: number; feedback?: string;
}
export interface AssistantTask {
  messages?: { id: string; role: "user" | "assistant"; text: string; requestKey: string; createdAt: string }[];
  processing?: { state: "queued" | "running" | "ready" | "failed"; attempt: number; error: string | null; retryable: boolean };
  canMessage?: boolean;
  id: string; initiatedBy: string; message: string; revision: number; status: string; delegated: boolean; canEdit: boolean; canContinue?: boolean;
  questions: { field: string; text: string }[]; interpretationNotice: string | null; plan: AssistantPlan;
  guidance?: AssistantGuidance;
  gathering?: { state: "missing" | "ready" | "ambiguous"; campaignId: string | null } | null;
  event: { id: string; code: string; title: string; stage: string; forceDemandTotal: number | null; requested: number; rosterCount: number;
    progress?: { collectionClosed?: boolean; need: number | null; collected: number; remaining: number | null;
      departments: { id: string; name: string; requested: number; responded: number | null; status: string; overdue: boolean }[] } } | null;
  receipts: AssistantReceipt[]; updatedAt: string;
}
export function assistantProcessingBusy(task: AssistantTask | undefined): boolean {
  return task?.processing?.state === "queued" || task?.processing?.state === "running";
}
export function assistantGuidance(task: AssistantTask): AssistantGuidance {
  const legacy = task.questions[0];
  return {
    // A null server question means the remaining questions are deferred. Do not
    // substitute the first blocker or revive an old question during processing.
    current: assistantProcessingBusy(task) || task.processing?.state === "failed" ? null
      : task.guidance ? task.guidance.current : legacy ? { ...legacy, id: `legacy:${legacy.field}` } : null,
    remaining: Math.max(task.questions.length, task.guidance?.remaining ?? 0),
    deferred: task.guidance?.deferred ?? 0,
    feedback: task.processing?.state === "ready" ? task.guidance?.feedback : undefined,
  };
}
export interface AssistantCatalogs { objects: { id: string; name: string }[]; departments: { id: string; name: string }[] }
export interface AssistantConfiguration { enabled: boolean; provider: string | null; model: string | null; isHeadquarters: boolean }
export interface AssistantTaskList {
  results: AssistantTask[]; isHeadquarters: boolean;
  page?: number; pageCount?: number; total?: number; nextPage?: number | null; previousPage?: number | null;
}
export interface AssistantDraft {
  title: string; businessDate: string; businessDateEnd: string; eventTime: string; kind: string; objectId: string; eventId: string;
  personnelTotal: string; intent: "prepare" | "send"; allocations: { departmentId: string; need: string; dueAt: string }[];
}
export function isTaskId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function assistantTaskHref(id: string, context: string | URLSearchParams = ""): string {
  const params = new URLSearchParams(context); params.set("task", id);
  return `${ASSISTANT_PATH}?${params.toString()}`;
}
export function assistantListPage(value: string | null | undefined): number {
  if (!value || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value); return Number.isSafeInteger(page) ? page : 1;
}
export function assistantPageHref(context: string | URLSearchParams, page: number): string {
  const params = new URLSearchParams(context);
  if (page > 1) params.set("page", String(page)); else params.delete("page");
  return `${ASSISTANT_PATH}${params.size ? `?${params.toString()}` : ""}`;
}
export function assistantQueuePagination(data?: AssistantTaskList) {
  if (data && Number.isSafeInteger(data.page) && Number.isSafeInteger(data.pageCount) && Number.isSafeInteger(data.total) &&
    data.page! >= 1 && data.pageCount! >= data.page! && data.total! >= 0) {
    const page = data.page!; const pageCount = data.pageCount!;
    return { page, pageCount, total: data.total!,
      nextPage: Number.isSafeInteger(data.nextPage) && data.nextPage! > page && data.nextPage! <= pageCount ? data.nextPage! : null,
      previousPage: Number.isSafeInteger(data.previousPage) && data.previousPage! >= 1 && data.previousPage! < page ? data.previousPage! : null };
  }
  // Older servers expose a single, bounded list without a page contract.
  return { page: 1, pageCount: 1, total: data?.results.length ?? 0, nextPage: null, previousPage: null };
}
export function draftFromPlan(plan: AssistantPlan = {}): AssistantDraft {
  return { title: plan.title ?? "", businessDate: plan.businessDate ?? "", businessDateEnd: plan.businessDateEnd ?? "",
    eventTime: plan.eventTime ?? "", kind: plan.kind ?? "", objectId: plan.objectId ?? "", eventId: plan.eventId ?? "",
    personnelTotal: plan.personnelTotal == null ? "" : String(plan.personnelTotal),
    intent: plan.intent ?? "prepare", allocations: (plan.allocations ?? []).map(row => ({ departmentId: row.departmentId,
      need: String(row.need), dueAt: row.dueAt ? dutyTimestampForInput(row.dueAt) : "" })) };
}
function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function assistantDate(value: string | null | undefined): string {
  if (!value || !validDate(value)) return "Нужно уточнить";
  return `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;
}
export function assistantTaskTitle(task: AssistantTask): string {
  const title = task.event?.title?.trim() || task.plan.title?.trim();
  if (title && title !== "Уточнение поручения") return title;
  if (task.plan.objectName?.trim()) return `Наряд: ${task.plan.objectName.trim()}`;
  return task.message.trim().slice(0, 120) || "Уточнение поручения";
}
export function fieldsFromDraft(draft: AssistantDraft): AssistantFields {
  if (typeof draft.personnelTotal !== "string" || (draft.personnelTotal !== "" &&
    (!/^\d+$/.test(draft.personnelTotal) || Number(draft.personnelTotal) < 1 || Number(draft.personnelTotal) > 100000))) {
    throw Error("Людей по поручению: укажите целое количество от 1 до 100000.");
  }
  if (draft.allocations.length > 50) throw Error("Допускается не более 50 департаментов.");
  for (const date of [draft.businessDate, draft.businessDateEnd]) if (date && !validDate(date)) throw Error("Укажите существующую календарную дату.");
  if (draft.businessDate && draft.businessDateEnd && draft.businessDateEnd < draft.businessDate) throw Error("Дата окончания раньше даты начала.");
  if (draft.eventTime && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(draft.eventTime)) throw Error("Укажите время в формате ЧЧ:ММ.");
  const departments = new Set<string>();
  const allocations = draft.allocations.filter(row => row.departmentId || row.need || row.dueAt).map(row => {
    if (!row.departmentId || !/^\d+$/.test(row.need) || Number(row.need) < 1 || Number(row.need) > 100000) throw Error("Выберите департамент и целое количество от 1 до 100000.");
    if (departments.has(row.departmentId)) throw Error("Укажите каждый департамент один раз.");
    departments.add(row.departmentId);
    return { departmentId: row.departmentId, need: Number(row.need), ...(row.dueAt ? { dueAt: dutyTimestampForSave(row.dueAt) } : {}) };
  });
  const fields: AssistantFields = { intent: draft.intent, personnelTotal: draft.personnelTotal === "" ? null : Number(draft.personnelTotal), allocations };
  if (draft.eventId.trim()) fields.eventId = draft.eventId.trim();
  else {
    if (draft.title.trim()) fields.title = draft.title.trim();
    if (draft.businessDate) fields.businessDate = draft.businessDate;
    fields.businessDateEnd = draft.businessDateEnd || null;
    fields.eventTime = draft.eventTime || null;
    if (draft.kind === "INTERNAL" || draft.kind === "FOREIGN") fields.kind = draft.kind;
    fields.objectId = draft.objectId || null;
  }
  return fields;
}
const STATUS: Record<string, { label: string; owner: string; description: string }> = {
  needs_information: { label: "Нужны сведения", owner: "Инициатор поручения", description: "Уточните сведения ниже, затем продолжите подготовку." },
  awaiting_recon: { label: "Ожидается рекогносцировка", owner: "Назначенные старшие объектов", description: "В карточке ОМ нужно завершить осмотр и опубликовать потребность. Запросы ещё не отправлены." },
  awaiting_executor: { label: "Ожидается штаб", owner: "Штаб второго департамента", description: "Запросы ещё не отправлены. Сотрудник штаба продолжит поручение со своим правом отправки." },
  prepared: { label: "Подготовлено", owner: "Инициатор поручения", description: "Предложение сохранено. Для отправки запросов нужно явно выбрать отправку и продолжить." },
  awaiting_department_responses: { label: "Ожидаются ответы департаментов", owner: "Ответственные департаментов", description: "Запросы отправлены. Департаменты выделяют сотрудников в резерв сбора." },
  collecting: { label: "Состав собирается", owner: "Штаб второго департамента", description: "Ответы поступают в сбор наряда. Передайте собранный состав на расстановку в обычном рабочем разделе." },
  placement: { label: "Передано на расстановку", owner: "Назначенные старшие объектов", description: "Распределите сотрудников по постам в карточке ОМ." },
  awaiting_approval: { label: "Ожидается согласование", owner: "Согласующие по маршруту ОМ", description: "Подписи выполняются в карточке ОМ. Продолжение поручения не заменяет подпись." },
  completed: { label: "Подготовка выполнена", owner: "Участники текущего этапа ОМ", description: "Работа помощника выполнена в объёме поручения. Текущий этап и подписи проверяйте в карточке ОМ." },
  event_unavailable: { label: "ОМ недоступно", owner: "Инициатор поручения", description: "Связанное мероприятие недоступно. Обновите данные или обратитесь к администратору доступа." },
};
export function taskPresentation(task: AssistantTask) {
  return STATUS[task.status] ?? { label: "Проверьте состояние", owner: "Инициатор поручения", description: "Обновите данные и проверьте текущий этап в карточке ОМ." };
}
const CLARIFICATION_FIELDS: Record<string, string> = {
  title: "название", kind: "вид ОМ", businessDate: "дату начала", businessDateEnd: "дату окончания",
  eventTime: "время", objectId: "объект", eventId: "существующее ОМ", personnelTotal: "число людей",
  allocations: "количества по департаментам", intent: "действие с запросами",
  briefing: "сведения об объектах и охраняемых лицах",
};
export function taskNextAction(task: AssistantTask): { title: string; owner: string; description: string; canCorrect: boolean } {
  const presentation = taskPresentation(task);
  if (assistantProcessingBusy(task)) return { title: "Обработка сообщения", owner: "Помощник", description: "Сообщение сохранено. Можно закрыть страницу и вернуться к результату позже.", canCorrect: false };
  if (task.processing?.state === "failed") return { title: "Повторить обработку или уточнить вручную", owner: "Инициатор поручения", description: "Прежний план сохранён. Повторите обработку сообщения или проверьте сведения вручную.", canCorrect: task.canEdit && !requestsSent(task) };
  const guidance = assistantGuidance(task);
  if (task.processing?.state === "ready" && !task.event && task.canContinue && !guidance.remaining) return { title: "Создать ОМ по распознанным сведениям", owner: "Инициатор поручения", description: "Проверьте проект и нажмите «Создать ОМ от своего имени». Сообщения ещё не создали мероприятие и не отправили запросы.", canCorrect: task.canEdit };
  if (task.guidance && guidance.remaining > 0 && task.canEdit && task.canMessage !== true && !requestsSent(task)) return {
    title: "Уточните сведения вручную", owner: "Инициатор поручения", description: "Новые сообщения недоступны. Сведения сохранены; проверьте состояние поручения или уточните их вручную.", canCorrect: true,
  };
  if (task.guidance && guidance.remaining > 0 && !requestsSent(task)) return task.canEdit
    ? { title: guidance.current ? "Ответьте на вопрос помощника" : "Вернитесь к отложенным вопросам", owner: "Инициатор поручения", description: "Остальные сведения сохранены. Продолжите диалог сообщением; неизвестные сведения ещё требуют уточнения.", canCorrect: false }
    : { title: "Инициатор уточняет сведения", owner: "Инициатор поручения", description: "Для продолжения нужны ответы на оставшиеся вопросы. После уточнения обновите состояние поручения.", canCorrect: false };
  const hasQuestions = task.questions.length > 0 && !requestsSent(task);
  if (hasQuestions) {
    const names = [...new Set(task.questions.map(question => CLARIFICATION_FIELDS[question.field.split(/[.\[]/)[0]] ?? "сведения поручения"))];
    const fields = names.length < 2 ? names[0] : `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
    return task.canEdit
      ? { title: `Уточните ${fields}`, owner: "Инициатор поручения", description: task.processing ? "Остальные сведения уже сохранены. Ответьте сообщением в диалоге или уточните их вручную." : "Остальные сведения уже сохранены. Дополните форму ниже и продолжите подготовку.", canCorrect: true }
      : { title: "Инициатор уточняет сведения", owner: "Инициатор поручения", description: `Нужно уточнить ${fields}. После уточнения обновите состояние поручения.`, canCorrect: false };
  }
  const titles: Record<string, string> = {
    needs_information: "Проверьте сведения поручения",
    awaiting_recon: "Завершить осмотр и опубликовать потребность",
    awaiting_executor: task.canContinue === true ? "Отправьте подготовленные запросы" : "Дождаться отправки запросов штабом",
    prepared: "Выбрать отправку подготовленных запросов",
    awaiting_department_responses: "Получить ответы департаментов",
    collecting: "Проверить состав и передать на расстановку",
    placement: "Распределить сотрудников по постам",
    awaiting_approval: "Получить подписи по маршруту ОМ",
    completed: "Проверить итог в карточке ОМ",
    event_unavailable: "Проверить доступ к связанному ОМ",
  };
  return { title: titles[task.status] ?? "Обновить состояние поручения", owner: presentation.owner, description: presentation.description, canCorrect: false };
}
export function requestsSent(task: AssistantTask): boolean { return task.receipts.some(row => row.operation === "send_allocations"); }
export function reconConfirmed(task: AssistantTask): boolean {
  return requestsSent(task) || ["prepared", "awaiting_executor", "awaiting_department_responses", "collecting", "placement", "awaiting_approval", "completed"].includes(task.status);
}
export function taskSteps(task: AssistantTask): { title: string; state: "done" | "current" | "waiting" }[] {
  const sent = requestsSent(task);
  const later = ["placement", "awaiting_approval", "completed"].includes(task.status);
  const recon = reconConfirmed(task);
  const stage = task.status === "event_unavailable" ? undefined : task.event?.stage;
  const placementPassed = STAGE_ORDER.findIndex(known => known === stage) > STAGE_ORDER.indexOf("PLACEMENT");
  return [
    { title: "Сведения об ОМ", state: task.event ? "done" : "current" },
    { title: "Рекогносцировка", state: recon || sent || later ? "done" : task.event ? "current" : "waiting" },
    { title: "Запросы", state: sent ? "done" : recon ? "current" : "waiting" },
    { title: "Ответы", state: sent && later ? "done" : sent ? "current" : "waiting" },
    { title: "Расстановка", state: stage === "PLACEMENT" ? "current" : placementPassed ? "done" : "waiting" },
  ];
}
