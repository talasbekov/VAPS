"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { assistantGuidance, assistantProcessingBusy, type AssistantTask } from "@/features/om-assistant/model";

export function AssistantConversation({ task, acknowledged, disabled, pending, send, retry }: {
  task: AssistantTask; acknowledged: AssistantTask | null; disabled: boolean; pending: boolean;
  send: (message: string, revision: number) => Promise<AssistantTask | undefined>;
  retry: () => Promise<AssistantTask | undefined>;
}) {
  const id = useId();
  const guidance = assistantGuidance(task);
  const current = pending ? null : guidance.current;
  const questionId = guidance.current?.id ?? null;
  const input = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(() => ({ text: "", revision: task.revision, questionId }));
  const submitted = useRef<{ text: string; revision: number; messageIds: Set<string> } | null>(null);
  useEffect(() => {
    const sent = submitted.current;
    if (sent && acknowledged?.id === task.id && acknowledged.revision > sent.revision &&
      acknowledged.messages?.some(message => message.role === "user" && message.text === sent.text && !sent.messageIds.has(message.id))) {
      setDraft(previous => previous.text === sent.text && previous.revision === sent.revision ? { ...previous, text: "" } : previous);
      submitted.current = null;
    }
  }, [acknowledged, task.id]);
  const busy = assistantProcessingBusy(task);
  const processing = task.processing;
  const failed = processing?.state === "failed";
  const locked = disabled || pending || busy || failed || !task.canEdit || task.canMessage !== true;
  const conflict = !!draft.text.trim() && (draft.revision !== task.revision || draft.questionId !== questionId);
  const allDeferred = guidance.remaining > 0 && !guidance.current && guidance.deferred === guidance.remaining;
  const status = pending ? "Сохраняем сообщение…"
    : processing?.state === "queued" ? "Сообщение сохранено. Ожидает обработки."
    : processing?.state === "running" ? "Помощник обрабатывает сообщение…"
    : failed ? "Не удалось обработать сообщение. Переписка и прежние сведения сохранены."
    : guidance.feedback?.trim() ? guidance.feedback
    : allDeferred ? "Оставшиеся вопросы отложены. Для продолжения нужны ответы."
    : current ? "Уточним сведения по одному вопросу. Остальные ответы уже сохранены."
    : "Ответ готов. Проверьте распознанные сведения и следующий шаг.";
  const messages = task.messages?.length ? task.messages
    : task.message ? [{ id: "initial", role: "user", text: task.message, createdAt: "" }] : [];
  const options = current?.choices ?? [];
  const canChoose = !locked && !draft.text.trim();
  function choose(text: string) {
    // Choices prepare a reviewable message. They never send or replace a draft.
    if (!canChoose) return;
    setDraft({ text, revision: task.revision, questionId });
    input.current?.focus();
  }
  async function submit() {
    if (locked || conflict || !draft.text.trim()) return;
    const { text, revision } = draft;
    submitted.current = { text, revision, messageIds: new Set(task.messages?.map(message => message.id)) };
    const saved = await send(text, revision);
    if (saved) {
      setDraft(previous => previous.text === text && previous.revision === revision ? { ...previous, text: "" } : previous);
      submitted.current = null;
    }
  }
  return <section aria-label="Переписка по поручению" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
    <h2 className="text-lg font-semibold">Диалог по поручению</h2>
    <div className="mt-3 text-sm" role="status" aria-live="polite"><p>{status}</p>
      {processing?.error && <p className="mt-1 break-words text-amber-800 dark:text-amber-200">{processing.error}</p>}
      {task.interpretationNotice && task.interpretationNotice !== processing?.error && <p className="mt-2 break-words text-amber-800 dark:text-amber-200">{task.interpretationNotice}</p>}
      {processing?.retryable && task.canEdit && <Button className="mt-2" variant="outline" disabled={disabled || pending} onClick={() => void retry()}>Повторить обработку</Button>}
    </div>
    {guidance.remaining > 0 && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
      Осталось уточнений: {guidance.remaining}{guidance.deferred > 0 && <> · Отложено: {guidance.deferred}</>}
    </p>}
    {current && <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950" aria-label="Текущий вопрос" aria-live="polite">
      <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">Текущий вопрос</p>
      <h3 id={`${id}-question`} className="mt-2 whitespace-pre-wrap break-words text-lg font-semibold leading-relaxed">{current.text}</h3>
    </div>}
    <form id="assistant-answer" tabIndex={-1} className="mt-4 scroll-mt-6" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor={id} className="text-sm font-semibold">{current && task.guidance ? "Ваш ответ" : "Сообщение помощнику"}</label>
      {(!pending && !busy && !failed && (options.length > 0 || current?.canDefer || allDeferred)) && <div className="mt-2">
        <div className="flex flex-wrap gap-2" aria-label="Варианты ответа">
          {options.map((choice, index) => <Button key={`${choice.value}-${index}`} type="button" variant="outline" disabled={!canChoose}
            className="h-auto min-h-11 max-w-full whitespace-normal text-left" onClick={() => choose(choice.value)}>{choice.label}</Button>)}
          {current?.canDefer && <Button type="button" variant="outline" disabled={!canChoose}
            className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => choose("Пока не знаю")}>Пока не знаю</Button>}
          {allDeferred && <Button type="button" variant="outline" disabled={!canChoose}
            className="h-auto min-h-11 max-w-full whitespace-normal" onClick={() => choose("Вернуться к отложенным вопросам")}>Вернуться к отложенным вопросам</Button>}
        </div>
        <p className="mt-2 text-xs text-slate-500">Вариант подставится в пустое поле. Проверьте ответ и отправьте его.</p>
      </div>}
      <textarea ref={input} id={id} value={draft.text} onChange={event => {
        const text = event.target.value;
        setDraft(previous => ({ text, revision: previous.text.trim() ? previous.revision : task.revision,
          questionId: previous.text.trim() ? previous.questionId : questionId }));
      }} disabled={locked} maxLength={4000}
        aria-describedby={[current ? `${id}-question` : "", `${id}-hint`, conflict && !locked ? `${id}-conflict` : ""].filter(Boolean).join(" ")}
        placeholder={current?.placeholder ?? (current && task.guidance ? "Напишите ответ своими словами" : "Уточните дату, объект, количество или состав запроса")}
        className="mt-2 min-h-24 w-full resize-y rounded-xl border border-input bg-background p-3 text-base disabled:opacity-60" />
      <p id={`${id}-hint`} className="mt-2 text-xs leading-relaxed text-slate-500">
        {task.guidance ? "Можно ответить коротко, сообщить сразу несколько фактов или исправить прежние сведения."
          : "Укажите в сообщении, что именно вы уточняете, и название объекта. Можно сообщить сразу несколько фактов."}
        {current?.canDefer && " Если пока не знаете, отложите вопрос. Он останется обязательным для продолжения."}
      </p>
      {conflict && !locked && <div id={`${id}-conflict`} className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100" role="status">
        <p>Поручение изменилось, пока вы набирали ответ. Ваш текст сохранён в поле. Перечитайте текущий вопрос перед отправкой.</p>
        <Button type="button" variant="outline" className="mt-2 h-auto min-h-11 max-w-full whitespace-normal"
          onClick={() => setDraft(previous => ({ ...previous, revision: task.revision, questionId }))}>Проверил вопрос — использовать мой ответ</Button>
      </div>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={locked || conflict || !draft.text.trim()}>{pending ? "Сохраняем сообщение…" : current && task.guidance ? "Отправить ответ" : "Отправить сообщение"}</Button>
        <p className="max-w-lg text-xs text-slate-500">Сообщение уточняет проект. Создание ОМ и отправка запросов выполняются отдельной кнопкой от вашего имени.</p>
      </div>
      {!task.canEdit && <p className="mt-2 text-xs text-slate-500">Переписку продолжает инициатор поручения.</p>}
      {task.canEdit && !busy && !failed && task.canMessage !== true && <p className="mt-2 text-xs text-slate-500">Новые сообщения недоступны. Проверьте состояние поручения; сведения можно уточнить вручную.</p>}
    </form>
    {task.questions.length > 0 && <details className="mt-5 border-t pt-3 text-sm">
      <summary className="cursor-pointer font-semibold">{task.guidance ? "Все недостающие сведения" : `Все вопросы (${task.questions.length})`}</summary>
      <p className="mt-2 text-xs text-slate-500">Для продолжения нужны ответы на все вопросы, включая отложенные.</p>
      <ul className="mt-2 list-disc space-y-2 pl-5">{task.questions.map((question, index) => <li key={`${question.field}-${index}`}>{question.text}</li>)}</ul>
    </details>}
    {messages.length > 0 && <details className="mt-4 border-t pt-3 text-sm">
      <summary className="cursor-pointer font-semibold">История диалога ({messages.length})</summary>
      <ol aria-label="История сообщений" className="mt-3 max-h-80 space-y-3 overflow-y-auto">
        {messages.map(message => <li key={message.id} className={`rounded-xl p-3 ${message.role === "user" ? "bg-slate-100 dark:bg-slate-800" : "border border-blue-100 dark:border-blue-900"}`}>
          <p className="text-xs font-semibold text-slate-500">{message.role === "user" ? task.canEdit ? "Вы" : "Инициатор" : "Помощник"}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{message.text}</p>
        </li>)}
      </ol>
    </details>}
  </section>;
}
