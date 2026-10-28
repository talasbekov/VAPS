"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { OpsAccessDenied } from "@/components/ops-access-denied";
import { DashboardLayout } from "@/components/dashboard-layout";
import { Button } from "@/components/ui/button";
import { AssistantBrief } from "@/features/om-assistant/brief";
import { AssistantBriefingSummary } from "@/features/om-assistant/briefing-summary";
import { AssistantConversation } from "@/features/om-assistant/conversation";
import { AssistantProgress } from "@/features/om-assistant/progress";
import { STAGE_LABEL, STAGE_ORDER } from "@/entities/security-event/model/stage-meta";
import { SECURITY_EVENT_KIND_LABEL } from "@/entities/security-event/model/types";
import { useAssistantAccess, useAssistantCatalogs, useAssistantConfiguration, useAssistantTask, useAssistantTasks, useAssistantWriter } from "@/features/om-assistant/api";
import { ASSISTANT_PATH, assistantDate, assistantTaskTitle, assistantListPage, assistantPageHref, assistantQueuePagination, assistantTaskHref, assistantGuidance, assistantProcessingBusy, draftFromPlan, fieldsFromDraft, isTaskId, reconConfirmed, requestsSent, taskNextAction, taskPresentation, taskSteps,
  type AssistantCatalogs, type AssistantDraft, type AssistantFields, type AssistantTask, type AssistantTaskList } from "@/features/om-assistant/model";

const panel = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900";
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-background px-3 py-2 text-sm text-foreground disabled:opacity-60 dark:border-slate-600";
const label = "block text-sm font-medium";
function count(value: unknown[] | number | undefined) { return Array.isArray(value) ? value.length : typeof value === "number" ? value : null; }

function GatheringPreparation({ task, isHeadquarters }: { task: AssistantTask; isHeadquarters: boolean }) {
  if (!task.event || task.gathering === null) return null;
  const legacy = task.gathering === undefined;
  if (legacy && !["prepared", "awaiting_executor", "awaiting_department_responses", "collecting"].includes(task.status)) return null;
  const state = task.gathering?.state;
  const ready = state === "ready";
  const ambiguous = state === "ambiguous";
  const campaignId = ready && isHeadquarters ? task.gathering?.campaignId : null;
  const heading = legacy ? "Проверьте подготовку распределения" : ready ? "Распределение для подбора подготовлено" : ambiguous ? "Штаб уточняет распределение" : "Штаб готовит распределение";
  const description = legacy
    ? "Перед подбором физического наряда Штаб проверяет, создано ли одно активное распределение с этим ОМ. Сведения о подготовке пока не получены. Департамент может пока ответить количеством."
    : ready
      ? "У ОМ есть одно активное распределение. Начальники управлений формируют общий резерв по запросам департаментов. Назначение на ОМ и объекты выполняет Штаб."
      : ambiguous
        ? "У ОМ несколько активных распределений. Перед подбором физического наряда Штаб должен уточнить, какое использовать. Департамент может пока ответить количеством."
        : "Перед подбором физического наряда Штаб второго департамента создаёт распределение с этим ОМ. Департамент может пока ответить количеством.";
  const workspace = "/employees/?view=forces&tab=collections";
  return <section aria-label="Подготовка физического наряда" className={`mt-4 rounded-xl border p-4 ${ready ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950" : "border-amber-200 bg-amber-50 dark:bg-amber-950"}`}>
    <h3 className="text-sm font-semibold">{heading}</h3><p className="mt-1 text-sm leading-relaxed">{description}</p>
    {isHeadquarters && <Button asChild variant="outline" className="mt-3"><Link href={campaignId ? `${workspace}&campaign=${encodeURIComponent(campaignId)}` : workspace}>
      {campaignId ? "Открыть распределение" : state === "missing" ? "Открыть распределения" : "Проверить распределения"}
    </Link></Button>}
  </section>;
}

export function AssistantTaskCard({ task, canViewEvent, canCommand, isHeadquarters = false, departments = [] }: {
  task: AssistantTask; canViewEvent: boolean; canCommand: boolean; isHeadquarters?: boolean; departments?: AssistantCatalogs["departments"];
}) {
  const presentation = taskPresentation(task);
  const nextAction = taskNextAction(task);
  const sent = requestsSent(task);
  const answerInDialogue = task.processing?.state === "ready" && task.canEdit && task.canMessage === true && assistantGuidance(task).remaining > 0 && !sent;
  const linkedStage = task.status === "event_unavailable" ? undefined : STAGE_ORDER.find(stage => stage === task.event?.stage);
  const departmentNames = new Map(departments.map(row => [row.id, row.name]));
  return <section className={panel} aria-label="Состояние поручения">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{task.event?.code ?? "Поручение сохранено"}</p>
        <h2 className="mt-1 text-xl font-semibold">{assistantTaskTitle(task)}</h2>
        <p className="mt-1 text-sm text-slate-500">{[task.plan.kind ? SECURITY_EVENT_KIND_LABEL[task.plan.kind] : null, task.plan.eventTime].filter(Boolean).join(" · ")}</p></div>
      <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">{presentation.label}</span>
    </div>
    <dl aria-label="Сведения поручения" className="mt-4 grid gap-3 rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-700 sm:grid-cols-3">
      <div><dt className="text-slate-500">Дата ОМ</dt><dd className="font-medium">{assistantDate(task.plan.businessDate)}{task.plan.businessDateEnd && task.plan.businessDateEnd !== task.plan.businessDate ? ` — ${assistantDate(task.plan.businessDateEnd)}` : ""}</dd></div>
      <div><dt className="text-slate-500">{task.plan.briefing?.objects.length ? "Объекты" : "Объект"}</dt><dd className="break-words font-medium">{task.plan.briefing?.objects.length ? `В поручении: ${task.plan.briefing.objects.length}; сведения ниже` : task.plan.objectName || (task.plan.objectId ? "Объект выбран; название недоступно" : "Не указан")}</dd></div>
      <div><dt className="text-slate-500">Людей по поручению</dt><dd className="font-medium">{task.plan.personnelTotal ?? "Не указано"}</dd></div>
    </dl>
    <AssistantBriefingSummary briefing={task.plan.briefing} pending={task.plan.briefingPending} questions={task.questions} />
    <AssistantProgress task={task} />
    <div className="mt-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
      <h3 className="font-semibold">{nextAction.title}</h3>
      <p className="text-sm text-slate-500">Следующий шаг выполняет</p><p className="font-semibold">{nextAction.owner}</p>
      <p className="mt-1 text-sm leading-relaxed">{nextAction.description}</p>
      {answerInDialogue ? <Button asChild variant="outline" className="mt-3"><a href="#assistant-answer" onClick={event => {
        event.currentTarget.ownerDocument.getElementById("assistant-answer")?.querySelector("textarea")?.focus();
      }}>Продолжить диалог</a></Button> : nextAction.canCorrect && <Button asChild variant="outline" className="mt-3"><a href="#assistant-correction" onClick={event => {
        event.currentTarget.ownerDocument.getElementById("assistant-correction")?.setAttribute("open", "");
      }}>Уточнить сведения</a></Button>}
      {task.event && task.status !== "event_unavailable" && <p className="mt-2 text-sm">
        {linkedStage ? <>Текущий этап ОМ: <strong>{STAGE_LABEL[linkedStage]}</strong></> : "Этап ОМ не определён. Проверьте карточку ОМ."}
      </p>}
    </div>
    <GatheringPreparation task={task} isHeadquarters={isHeadquarters} />
    {task.event && <div className="mt-4 flex flex-wrap gap-2">
      {canViewEvent && <Button asChild variant="outline"><Link href={`/security-ops/events/${encodeURIComponent(task.event.id)}/`}>Открыть карточку ОМ</Link></Button>}
      {canCommand && <Button asChild variant="outline"><Link href={`/employees?view=forces&tab=collections&collection=${encodeURIComponent(task.event.id)}`}>Открыть сбор наряда</Link></Button>}
    </div>}
    {task.message.trim() && <details className="mt-4 border-t pt-3">
      <summary className="cursor-pointer text-sm font-semibold">Исходное поручение</summary>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">{task.message}</p>
    </details>}
    <details className="mt-4 border-t pt-3">
      <summary className="cursor-pointer text-sm font-semibold">Ход подготовки</summary>
    <ol aria-label="Подготовка наряда" className="mt-5 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
      {taskSteps(task).map((step, index) => <li key={step.title} aria-current={step.state === "current" ? "step" : undefined}
        className={`rounded-lg border p-3 ${step.state === "done" ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100" : step.state === "current" ? "border-blue-300 bg-blue-50 text-blue-950 dark:bg-blue-950 dark:text-blue-100" : "border-slate-200 text-slate-500 dark:border-slate-700"}`}>
        <span className="mb-1 block text-xs">{step.state === "done" ? index === 0 ? "Сохранены" : "Подтверждено" : step.state === "current" ? "Текущий шаг" : `Шаг ${index + 1}`}</span>{step.title}
      </li>)}
    </ol>
    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      <div><dt className="text-slate-500">Потребность ОМ</dt><dd className="font-medium">{task.status === "awaiting_recon" ? "Не опубликована" : reconConfirmed(task) ? task.event?.forceDemandTotal ?? "Нет сведений" : "Проверяется в карточке ОМ"}</dd></div>
      <div><dt className="text-slate-500">Запрошено</dt><dd className="font-medium">{task.event?.requested ?? "Нет сведений"}</dd></div>
      <div><dt className="text-slate-500">В составе сбора</dt><dd className="font-medium">{task.event?.rosterCount ?? "Нет сведений"}</dd></div>
    </dl>
    </details>
    <p className="mt-2 text-xs text-slate-500">Количество по департаментам задаётся отдельно от общего числа в поручении.</p>
    {!!task.plan.allocations?.length && <div className="mt-4 border-t pt-4">
      <h3 className="text-sm font-semibold">{sent ? "Отправленные количества" : "Предложение запросов"}</h3>
      <ul className="mt-2 space-y-1 text-sm">{task.plan.allocations.map(row => <li key={row.departmentId} className="flex justify-between gap-4">
        <span>{row.departmentName ?? departmentNames.get(row.departmentId) ?? `Департамент ${row.departmentId}`}</span><span className="font-medium tabular-nums">{row.need} чел.</span>
      </li>)}</ul>
      {!sent && <p className="mt-2 text-xs text-slate-500">Предложение сохраняется до отправки. Оно не назначает сотрудников на посты.</p>}
    </div>}
    {task.receipts.filter(receipt => receipt.operation === "send_allocations").map((receipt, index) => {
      const delivery = receipt.result.delivery;
      const missing = count(delivery?.unaddressed); const failed = count(delivery?.undelivered);
      return <div key={index} className="mt-3 rounded-lg border p-3 text-sm" role="status">
        {!delivery?.known ? "Доставка уведомлений не подтверждена. Проверьте ответы в сборе наряда." : <>
          {typeof delivery.notifiedOfficers === "number" ? `Уведомлено ответственных: ${delivery.notifiedOfficers}. ` : "Отправка запросов подтверждена. "}
          {missing !== null && missing > 0 && `Без адресата: ${missing}. `}{failed !== null && failed > 0 && `Не доставлено: ${failed}. `}
        </>}
      </div>;
    })}
    <details className="mt-5 text-sm text-slate-500"><summary className="cursor-pointer">Сохранённые действия и исполнители</summary>
      <dl className="mt-2 space-y-1"><div><dt className="inline">Поручение: </dt><dd className="inline break-all">{task.id}</dd></div>
        <div><dt className="inline">Инициатор: </dt><dd className="inline">{task.initiatedBy}</dd></div>
        {task.receipts.map((receipt, index) => <div key={index}><dt className="inline">{receipt.operation === "create_bulletin" ? "Мероприятие сохранено" : receipt.operation === "send_allocations" ? "Запросы отправлены" : "Действие сохранено"}: </dt><dd className="inline">{receipt.executedBy}, {receipt.createdAt}</dd></div>)}
      </dl>
    </details>
  </section>;
}

function DraftEditor({ draft, onChange, catalogs, metadata, disabled, questions = [], focusMissing = false }: {
  draft: AssistantDraft; onChange: (draft: AssistantDraft) => void; catalogs?: AssistantCatalogs; metadata: boolean; disabled: boolean;
  questions?: AssistantTask["questions"]; focusMissing?: boolean;
}) {
  const field = (key: keyof AssistantDraft, value: string) => onChange({ ...draft, [key]: value });
  // Keep field groups in place while typing. Accepting a saved revision resets
  // their initial focus without discarding the parent-owned draft.
  const [priority] = useState(() => new Set([
    ...questions.map(question => question.field.split(/[.\[]/)[0]),
    ...(["title", "kind", "businessDate"] as const).filter(key => !draft[key].trim()),
  ]));
  const [requestsOpen, setRequestsOpen] = useState(() => draft.allocations.length > 0 || draft.intent === "send" ||
    questions.some(question => /^(allocations|intent)(\.|\[|$)/.test(question.field)));
  const guidance = (key: string) => questions.filter(question => question.field.split(/[.\[]/)[0] === key).map((question, index) =>
    <p key={`${key}-${index}`} className="mt-1 text-xs text-slate-600 dark:text-slate-300">{question.text}</p>);
  const controls = {
    title: <label className={label}>Название<input className={input} value={draft.title} onChange={event => field("title", event.target.value)} maxLength={500} /></label>,
    kind: <label className={label}>Вид ОМ<select className={input} value={draft.kind} onChange={event => field("kind", event.target.value)}><option value="">Выберите вид</option><option value="INTERNAL">{SECURITY_EVENT_KIND_LABEL.INTERNAL}</option><option value="FOREIGN">{SECURITY_EVENT_KIND_LABEL.FOREIGN}</option></select></label>,
    businessDate: <label className={label}>Дата начала<input className={input} type="date" value={draft.businessDate} onChange={event => field("businessDate", event.target.value)} /></label>,
    objectId: <label className={label}>Объект<select className={input} value={draft.objectId} onChange={event => field("objectId", event.target.value)} disabled={!catalogs}><option value="">Выберите объект</option>{catalogs?.objects.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>,
    personnelTotal: <><label className={label}>Людей по поручению<input className={input} inputMode="numeric" maxLength={6} value={draft.personnelTotal} aria-describedby="om-assistant-personnel-total-help" onChange={event => field("personnelTotal", event.target.value)} /></label>
      <p id="om-assistant-personnel-total-help" className="mt-1 text-xs text-slate-500">Общее число из поручения. Количество по департаментам задаётся отдельно; потребность ОМ не меняется.</p></>,
    eventId: <label className={label}>Существующее ОМ, ID (если уже создано)<input className={input} value={draft.eventId} onChange={event => field("eventId", event.target.value)} placeholder="Из адреса карточки ОМ" /></label>,
    businessDateEnd: <label className={label}>Дата окончания (необязательно)<input className={input} type="date" value={draft.businessDateEnd} onChange={event => field("businessDateEnd", event.target.value)} /></label>,
    eventTime: <label className={label}>Время (необязательно)<input className={input} type="time" value={draft.eventTime} onChange={event => field("eventTime", event.target.value)} /></label>,
  };
  type EditableField = keyof typeof controls;
  const basics: EditableField[] = metadata && !draft.eventId ? ["title", "kind", "businessDate", "objectId", "personnelTotal"] : ["personnelTotal"];
  const extras: EditableField[] = !metadata ? [] : draft.eventId ? ["eventId"] : ["eventId", "businessDateEnd", "eventTime"];
  const primary = focusMissing ? [...basics, ...extras].filter(key => priority.has(key)) : basics;
  const recognized = focusMissing ? basics.filter(key => !priority.has(key)) : [];
  const additional = extras.filter(key => !focusMissing || !priority.has(key));
  const editable = new Set<string>([...basics, ...extras, "allocations", "intent"]);
  const otherQuestions = questions.filter(question => !editable.has(question.field.split(/[.\[]/)[0]));
  const renderFields = (keys: EditableField[]) => keys.map(key => <div key={key}>{controls[key]}{guidance(key)}</div>);
  return <fieldset disabled={disabled} className="space-y-4">
    {otherQuestions.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm">{otherQuestions.map((question, index) =>
      <li key={`other-${index}`}>{question.text}</li>)}</ul>}
    {primary.length > 0 && <div className="grid gap-3 sm:grid-cols-2">{renderFields(primary)}</div>}
    {recognized.length > 0 && <details className="border-t pt-3">
      <summary className="cursor-pointer text-sm font-semibold">Изменить распознанные сведения</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{renderFields(recognized)}</div>
    </details>}
    {additional.length > 0 && <details className="border-t pt-3">
      <summary className="cursor-pointer text-sm font-semibold">Дополнительные сведения</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{renderFields(additional)}</div>
    </details>}
    <details className="border-t pt-3" open={requestsOpen} onToggle={event => setRequestsOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-semibold">Запросы по департаментам</summary>
      <div className="mt-3 space-y-3">
    {questions.filter(question => /^(allocations|intent)(\.|\[|$)/.test(question.field)).map((question, index) =>
      <p key={`request-${index}`} className="text-sm text-slate-600 dark:text-slate-300">{question.text}</p>)}
    <label className={label}>Что сделать с запросами<select className={input} value={draft.intent} onChange={event => field("intent", event.target.value)}>
      <option value="prepare">Подготовить без отправки</option><option value="send">Отправить после готовности ОМ через уполномоченного сотрудника</option>
    </select></label>
    <div><h3 className="text-sm font-medium">Количество по департаментам</h3>
      <p className="mt-1 text-xs text-slate-500">Отправка доступна после рекогносцировки. Сотрудников выбирают ответственные департаментов.</p>
      <div className="mt-2 space-y-2">{draft.allocations.map((row, index) => <div key={index} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
        <label className={`${label} min-w-40 flex-1`}>Департамент {index + 1}<select className={input} value={row.departmentId} disabled={!catalogs} onChange={event => onChange({ ...draft, allocations: draft.allocations.map((item, position) => position === index ? { ...item, departmentId: event.target.value } : item) })}>
          <option value="">Выберите департамент</option>{catalogs?.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label className={`${label} w-28`}>Человек<input className={input} inputMode="numeric" value={row.need} onChange={event => onChange({ ...draft, allocations: draft.allocations.map((item, position) => position === index ? { ...item, need: event.target.value } : item) })} /></label>
        <label className={`${label} min-w-44`}>Срок ответа по времени Астаны<input className={input} type="datetime-local" step="1" value={row.dueAt} onChange={event => onChange({ ...draft, allocations: draft.allocations.map((item, position) => position === index ? { ...item, dueAt: event.target.value } : item) })} /></label>
        <Button type="button" variant="ghost" aria-label={`Удалить департамент ${index + 1}`} onClick={() => onChange({ ...draft, allocations: draft.allocations.filter((_, position) => position !== index) })}>Удалить</Button>
      </div>)}</div>
      <Button className="mt-2" type="button" variant="outline" disabled={draft.allocations.length >= 50 || !catalogs} onClick={() => onChange({ ...draft, allocations: [...draft.allocations, { departmentId: "", need: "", dueAt: "" }] })}>Добавить департамент</Button>
    </div>
      </div>
    </details>
  </fieldset>;
}

function TaskCorrection({ task, acknowledged, catalogs, disabled, save }: { task: AssistantTask; acknowledged: AssistantTask | null; catalogs?: AssistantCatalogs; disabled: boolean; save: (fields: AssistantFields, revision: number) => Promise<AssistantTask | undefined> }) {
  const [editor, setEditor] = useState(() => {
    const draft = draftFromPlan(task.plan);
    return { draft, original: draft, revision: task.revision };
  });
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(editor.draft) !== JSON.stringify(editor.original);
  const conflict = dirty && editor.revision < task.revision;
  useEffect(() => {
    // Polling may update the task while someone is typing. Only an untouched
    // editor follows a remote revision automatically; local edits stay mounted.
    setEditor(previous => {
      // A lost-response retry is triggered outside this editor. The writer's
      // trusted onSaved callback acknowledges that same successful own edit.
      if (acknowledged?.id === task.id && acknowledged.revision > previous.revision) {
        const draft = draftFromPlan(acknowledged.plan);
        return { draft, original: draft, revision: acknowledged.revision };
      }
      if (previous.revision >= task.revision || JSON.stringify(previous.draft) !== JSON.stringify(previous.original)) return previous;
      const draft = draftFromPlan(task.plan);
      return { draft, original: draft, revision: task.revision };
    });
  }, [task.id, task.plan, task.revision, acknowledged, dirty]);
  const adoptSaved = (keepLocal: boolean) => {
    const saved = draftFromPlan(task.plan);
    setEditor(previous => ({ draft: keepLocal ? previous.draft : saved, original: saved, revision: task.revision }));
    setError(null);
  };
  if (!task.canEdit || requestsSent(task)) return null;
  const submit = async () => {
    if (disabled || conflict) return;
    try {
      const fields = fieldsFromDraft(editor.draft);
      // Existing event metadata and published demand are immutable here; only the proposal changes.
      const patch = task.event ? { intent: fields.intent, personnelTotal: fields.personnelTotal, allocations: fields.allocations } : fields;
      setError(null);
      const saved = await save(patch, editor.revision);
      if (saved) {
        const draft = draftFromPlan(saved.plan);
        setEditor({ draft, original: draft, revision: saved.revision });
      }
    } catch (value) { setError(value instanceof Error ? value.message : "Проверьте сведения."); }
  };
  return <details id="assistant-correction" tabIndex={-1} className={`${panel} scroll-mt-6`} open={!task.processing && task.questions.length > 0}>
    <summary className="cursor-pointer font-semibold">{task.processing ? "Уточнить сведения вручную" : task.questions.length ? "Уточнить сведения" : "Изменить предложение запросов"}</summary>
    <div className="mt-4">
      {conflict && <div role="status" className="mb-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        <p><strong>Поручение изменилось.</strong> Ваш ввод остался в форме и ещё не отправлен. Проверьте обновлённую карточку выше. Можно загрузить сохранённые сведения или продолжить со своими правками — они заменят предложение инициатора.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={disabled} onClick={() => adoptSaved(false)}>Загрузить сохранённые сведения</Button>
          <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal" disabled={disabled} onClick={() => adoptSaved(true)}>Продолжить с моими правками</Button>
        </div>
      </div>}
      <DraftEditor key={editor.revision} draft={editor.draft} onChange={draft => setEditor(previous => ({ ...previous, draft }))} catalogs={catalogs} metadata={!task.event} disabled={disabled} questions={task.questions} focusMissing={!task.event && task.questions.length > 0} />
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      <Button className="mt-4 h-auto min-h-11 max-w-full whitespace-normal" disabled={disabled || conflict} onClick={() => void submit()}>Сохранить сведения и продолжить</Button>
    </div>
  </details>;
}

export function AssistantWorkspace() {
  const access = useAssistantAccess(); const permissions = useOpsPermissions();
  if (permissions.isLoading) return <p className="p-6" role="status">Проверяем доступ к помощнику…</p>;
  if (!access.allowed) return <OpsAccessDenied what="помощника по ОМ" />;
  return <DashboardLayout><AssistantAuthorizedWorkspace key={access.scope} /></DashboardLayout>;
}

export function AssistantTaskQueue({ data, selectedTaskId, search, isPending, isFetching, isError, refresh, navigate }: {
  data?: AssistantTaskList; selectedTaskId: string | null; search: string | URLSearchParams;
  isPending: boolean; isFetching: boolean; isError: boolean; refresh: () => void; navigate: (href: string) => void;
}) {
  const pagination = assistantQueuePagination(data);
  const blocked = isPending || isFetching || isError;
  return <aside className={`${panel} space-y-3`} aria-label="Поручения">
    <div className="flex items-center justify-between"><h2 className="font-semibold">{data?.isHeadquarters ? "Мои и переданные штабу" : "Мои поручения"}</h2><button className="text-xs text-blue-700 underline dark:text-blue-300" disabled={isFetching} onClick={refresh}>Обновить</button></div>
    {isError ? <div className="space-y-3"><p className="text-sm" role="status">Список поручений недоступен. Обновите данные.</p>
      {assistantListPage(new URLSearchParams(search).get("page")) > 1 && <Button variant="outline" size="sm" disabled={isFetching}
        onClick={() => navigate(assistantPageHref(search, 1))}>На первую страницу</Button>}
    </div> : isPending ? <p className="text-sm" role="status">Загружаем список…</p> : !data?.results.length ? <p className="text-sm text-slate-500">Сохранённые поручения появятся здесь.</p> : <ul className="space-y-2">{data.results.map(row => <li key={row.id}><Link href={assistantTaskHref(row.id, search)} aria-current={row.id === selectedTaskId ? "page" : undefined} className={`block rounded-lg border p-3 text-sm ${row.id === selectedTaskId ? "border-blue-300 bg-blue-50 dark:bg-blue-950" : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"}`}>
      <span className="block font-medium">{assistantTaskTitle(row)}</span>
      <span className="mt-1 block text-xs text-slate-500">{[row.plan.objectName, row.plan.businessDate ? assistantDate(row.plan.businessDate) : null].filter(Boolean).join(" · ")}</span>
      <span className="mt-1 block text-xs text-slate-500">{taskPresentation(row).label}</span>
    </Link></li>)}</ul>}
    {!isPending && !isError && pagination.total > 0 && <p className="text-xs text-slate-500">Всего поручений: {pagination.total}</p>}
    {!isPending && !isError && pagination.pageCount > 1 && <nav className="space-y-2 border-t pt-3" aria-label="Страницы поручений">
      <p className="text-sm" aria-live="polite">Страница {pagination.page} из {pagination.pageCount}</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" aria-label="Предыдущая страница поручений" disabled={blocked || pagination.previousPage === null} onClick={() => pagination.previousPage !== null && navigate(assistantPageHref(search, pagination.previousPage))}>Назад</Button>
        <Button variant="outline" size="sm" aria-label="Следующая страница поручений" disabled={blocked || pagination.nextPage === null} onClick={() => pagination.nextPage !== null && navigate(assistantPageHref(search, pagination.nextPage))}>Далее</Button>
      </div>
    </nav>}
  </aside>;
}

function AssistantAuthorizedWorkspace() {
  const router = useRouter(); const search = useSearchParams();
  const taskParam = search.get("task"); const taskId = isTaskId(taskParam) ? taskParam : null;
  const page = assistantListPage(search.get("page"));
  const eventContext = search.get("event");
  const access = useAssistantAccess(); const permissions = useOpsPermissions();
  const configuration = useAssistantConfiguration(); const catalogs = useAssistantCatalogs();
  const tasks = useAssistantTasks(page); const selected = useAssistantTask(taskId);
  const headquarters = configuration.data?.isHeadquarters ?? tasks.data?.isHeadquarters ?? false;
  const [acknowledged, setAcknowledged] = useState<AssistantTask | null>(null);
  const writer = useAssistantWriter({ access, taskId, readKey: selected.readKey }, task => {
    setAcknowledged(task);
    router.replace(assistantTaskHref(task.id, search.toString()));
  });
  const [message, setMessage] = useState("");
  const [draft, setDraft] = useState(() => draftFromPlan({ eventId: eventContext }));
  const [inputMode, setInputMode] = useState<"text" | "manual">("text");
  const [queueOpen, setQueueOpen] = useState(() => search.has("page"));
  const [formError, setFormError] = useState<string | null>(null);
  const frozen = writer.pending || writer.retryable;
  const mode = configuration.data?.enabled === false ? "manual" : inputMode;
  const task = selected.data;
  const newTask = () => { writer.reset(); setMessage(""); setDraft(draftFromPlan({ eventId: eventContext })); setFormError(null); setQueueOpen(false);
    const params = new URLSearchParams(search.toString()); params.delete("task");
    router.replace(`${ASSISTANT_PATH}${params.size ? `?${params.toString()}` : ""}`); };
  const manual = () => { try { setFormError(null); void writer.create(message, fieldsFromDraft(draft), false); }
    catch (error) { setFormError(error instanceof Error ? error.message : "Проверьте сведения."); } };
  return <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">Охранные мероприятия</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Помощник по ОМ</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">Опишите задачу. Помощник подготовит мероприятие и запросы, покажет, кто продолжает работу и что уже сохранено.</p></div>
      {taskParam && <Button variant="outline" disabled={frozen} onClick={newTask}>Новая задача</Button>}
    </header>
    <div className="grid items-start gap-5">
      <main className="min-w-0 space-y-4">
        {!taskParam && <section className={panel} aria-label="Новое поручение">
          <fieldset disabled={frozen} className="mb-5">
            <legend className="text-sm font-semibold">Как задать поручение</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {([['text', 'Описать задачу'], ['manual', 'Заполнить форму']] as const).map(([value, title]) => <label key={value}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${mode === value ? 'border-blue-400 bg-blue-50 dark:bg-blue-950' : 'border-slate-200 dark:border-slate-700'}`}>
                <input type="radio" name="assistant-input-mode" value={value} checked={mode === value}
                  disabled={frozen || (value === 'text' && configuration.data?.enabled === false)} onChange={() => setInputMode(value)} />{title}
              </label>)}
            </div>
          </fieldset>
          {configuration.data?.enabled === false && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100" role="status">Понимание текста отключено. Заполните форму — поручение можно сохранить и продолжить.</p>}
          {configuration.isError && <p role="status" className="mb-4 text-sm text-amber-700">Не удалось проверить понимание текста. Можно заполнить форму.</p>}
          {mode === "text" ? <>
          <AssistantBrief value={message} onChange={setMessage} disabled={frozen} pending={writer.pending}
            onSubmit={() => void writer.create(message, eventContext ? { eventId: eventContext } : {}, true)} />
          {eventContext && <p className="mt-2 text-sm text-blue-700 dark:text-blue-300">Поручение связано с выбранным ОМ. Его фактические сведения проверит сервер.</p>}
          </> : <DraftEditor draft={draft} onChange={setDraft} catalogs={catalogs.data} metadata disabled={frozen} />}
          {mode === "manual" && <Button className="mt-4 h-auto min-h-11 max-w-full whitespace-normal py-2 text-center" disabled={frozen} onClick={manual}>
            {writer.pending ? "Сохраняем поручение…" : "Сохранить по указанным сведениям"}
          </Button>}
        </section>}
        {taskParam && !taskId && <p className={panel} role="alert">Некорректная ссылка на поручение. Откройте его из списка или начните новую задачу.</p>}
        {taskId && !task && !selected.isError && <p className={panel} role="status">Загружаем поручение…</p>}
        {taskId && selected.isError && <div className={panel} role="alert"><p>{selected.readAccessBlocked ? "Поручение недоступно для текущего пользователя." : "Не удалось обновить поручение. Действия временно недоступны."}</p><Button className="mt-3" variant="outline" onClick={() => void selected.refetch()}>Обновить поручение</Button></div>}
        {task && <>
          {task.processing && <AssistantConversation key={`${access.scope}-${task.id}`} task={task} acknowledged={acknowledged}
            disabled={frozen || !selected.canAct} pending={writer.pending} send={writer.sendMessage} retry={writer.retryProcessing} />}
          {task.interpretationNotice && !task.processing && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100" aria-label="Проверка распознанных сведений">
            <p role="status">Поручение сохранено, но автоматический разбор текста не завершён.</p>
            <p className="mt-2">{requestsSent(task)
              ? "Текущее состояние и результаты действий показаны в карточке ниже."
              : task.canEdit
                ? "Проверьте распознанные значения и заполните недостающие сведения в форме."
                : "Сведения уточняет инициатор поручения. Чтобы проверить изменения, нажмите «Обновить состояние»."}</p>
            <details className="mt-3"><summary className="cursor-pointer">Подробности разбора</summary><p className="mt-2 break-words">{task.interpretationNotice}</p></details>
          </section>}
          <AssistantTaskCard task={task} canViewEvent={permissions.hasPermission("event.view")} canCommand={permissions.hasPermission("forces.command")} isHeadquarters={headquarters} departments={catalogs.data?.departments} />
          {task.questions.length > 0 && !task.processing && (!task.canEdit || requestsSent(task)) && <section className={panel} aria-label="Нужны сведения"><h2 className="font-semibold">Что нужно уточнить</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{task.questions.map((question, index) => <li key={`${question.field}-${index}`}>{question.text}</li>)}</ul>
            {!task.canEdit && <p className="mt-3 text-sm text-slate-500">Сведения уточняет инициатор поручения. Штаб продолжит работу после уточнения.</p>}</section>}
          <TaskCorrection key={`${access.scope}-${task.id}`} task={task} acknowledged={acknowledged} catalogs={catalogs.data} disabled={frozen || !selected.canAct || assistantProcessingBusy(task)} save={(fields, revision) => writer.continueTask(fields, revision)} />
          <div className="flex flex-wrap gap-2">{task.canContinue === true && <Button disabled={frozen || !selected.canAct || assistantProcessingBusy(task) || task.processing?.state === "failed" || assistantGuidance(task).remaining > 0 || task.status === "event_unavailable"} onClick={() => void writer.continueTask()}>{writer.pending ? "Выполняем действие…" : !task.event ? "Создать ОМ от своего имени" : "Выполнить отправку от своего имени"}</Button>}
            <Button variant="outline" disabled={writer.pending || selected.isFetching} onClick={() => { if (!writer.retryable) writer.reset(); void selected.refetch(); void tasks.refetch(); }}>Обновить состояние</Button></div>
          {!task.canEdit && <p className="text-xs text-slate-500">Предложение редактирует инициатор поручения.</p>}
        </>}
        {(formError || writer.error) && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950 dark:bg-red-950 dark:text-red-100" role="alert"><p>{formError ?? writer.error}</p>
          {writer.retryable && <><p className="mt-2">Ответ мог потеряться после сохранения. Повтор вернёт то же поручение и не создаст второе.</p><Button className="mt-3" variant="outline" disabled={writer.pending} onClick={() => void writer.retry()}>Повторить сохранение</Button></>}</div>}
        {catalogs.isError && <p role="status" className="text-sm text-amber-700">Справочники временно недоступны. Обновите их для выбора объекта и департаментов. <button className="underline" onClick={() => void catalogs.refetch()}>Повторить</button></p>}
      </main>
      <details open={queueOpen} onToggle={event => setQueueOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer rounded-xl border bg-background p-4 text-sm font-semibold">Сохранённые поручения</summary>
        <div className="mt-3"><AssistantTaskQueue data={tasks.data} selectedTaskId={taskId} search={search.toString()} isPending={tasks.isPending} isFetching={tasks.isFetching} isError={tasks.isError}
          refresh={() => void tasks.refetch()} navigate={href => router.push(href)} /></div>
      </details>
    </div>
  </div>;
}
