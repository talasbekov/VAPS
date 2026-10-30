"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { opsApiClient } from "@/lib/ops-api";
import { createRoleChat, type ChatReply } from "./chat-model";
import styles from "./assistant-dock.module.css";

export function RoleChat({ owner, submission, question, onQuestionSent, onPending, onPrepareTask }: {
  owner: string; submission: number; question: string; onQuestionSent: () => void;
  onPending: (pending: boolean) => void; onPrepareTask?: (message: string) => void;
}) {
  const latest = useRef(owner); latest.current = owner;
  const mounted = useRef(true); const [, render] = useState(0);
  const controller = useRef<ReturnType<typeof createRoleChat> | null>(null);
  if (!controller.current) controller.current = createRoleChat({ getOwner: () => mounted.current ? latest.current : "",
    onChange: () => { if (mounted.current) render(value => value + 1); },
    send: (body, authorize) => opsApiClient.post<ChatReply>("/api/ops/assistant/tasks/", body, authorize) });
  const chat = controller.current, state = chat.snapshot();
  const [draft, setDraft] = useState(""); const lastSubmission = useRef(0); const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; queueMicrotask(() => { if (!mounted.current) chat.dispose(); }); }; }, [chat]);
  useEffect(() => {
    if (submission > lastSubmission.current) {
      lastSubmission.current = submission;
      if (question.trim()) { void chat.ask(question); onQuestionSent(); }
    }
  }, [submission, question, chat, onQuestionSent]);
  useEffect(() => { onPending(state.pending); return () => onPending(false); }, [state.pending, onPending]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [state.turns, state.pending]);
  const send = () => { if (draft.trim() && !state.pending) { void chat.ask(draft); setDraft(""); } };
  return <div className={styles.chat}>
    {!!state.turns.length && <button type="button" className={styles.taskLink} disabled={state.pending} onClick={() => { chat.newConversation(); setDraft(""); }}>Новый диалог</button>}
    <div className={styles.messages} role="log" aria-label="Диалог с помощником" aria-live="polite">
      {!state.turns.length && <div className={styles.welcome}><h3>Чем помочь в работе?</h3><p>Спросите о работе в Smart Josparlau или запросите текущие данные в пределах ваших прав и подразделения.</p><p>Например: «Какие ОМ сегодня?», «Покажи статусы сотрудников», «Сколько сотрудников по статусам?» или «Покажи мой профиль».</p><p>{onPrepareTask ? "Для создания ОМ используйте вкладку поручений — действия требуют отдельного подтверждения." : "Действия выполняются в рабочих разделах в пределах назначенных прав."}</p></div>}
      {state.turns.map((turn, index) => <article key={index} className={styles.turn}>
        <p className={styles.question}><span className="sr-only">Вы: </span>{turn.question}</p>
        {turn.reply && <div className={styles.reply}>
          <p className={styles.replyMode}>{turn.reply.mode === "llm" ? "Ответ ИИ по документации" : turn.reply.mode === "data" ? "Текущие данные системы" : "Справка по документации"}</p>
          {turn.reply.conversationReset && <p className={styles.notice}>Контекст предыдущего разговора истёк или изменился. Начат новый диалог в пределах текущих прав.</p>}
          {turn.reply.notice && <p className={styles.notice}>{turn.reply.notice}</p>}
          <p className={styles.answer}>{turn.reply.answer}</p>
          {turn.reply.readOnly?.rows.some(row => typeof row.href === "string") && <ul className={styles.sources} aria-label="Записи ответа">
            {turn.reply.readOnly.rows.filter(row => typeof row.href === "string").map((row, index) => <li key={String(row.id ?? index)}><Link href={String(row.href)}>Открыть: {String(row.code ?? row.name ?? row.title ?? row.id)}</Link></li>)}
          </ul>}
          {turn.reply.readOnly?.hasNext && index === state.turns.length - 1 && <button type="button" className={styles.taskLink} disabled={state.pending} onClick={() => void chat.ask("Следующая страница")}>Следующая страница</button>}
          {!!turn.reply.roleContext.scopes.length && <p className={styles.scope}>Ваша область: {turn.reply.roleContext.scopes.join(" · ")}</p>}
          {!!turn.reply.sources.length && <details className={styles.sources}><summary>Источники ответа</summary>
            <ul>{turn.reply.sources.map(source => <li key={source.id}><strong>{source.title}</strong><span>{source.document} · {source.section}</span>
              {source.href && <Link href={source.href}>Открыть раздел</Link>}</li>)}</ul>
          </details>}
          {onPrepareTask && <button type="button" className={styles.taskLink} onClick={() => onPrepareTask(turn.question)}>Начать новое поручение по этому вопросу</button>}
        </div>}
        {turn.error && <p className={styles.notice} role="alert">{turn.error}</p>}
      </article>)}
      {state.pending && <p className={styles.pending} role="status">Готовим ответ по доступной документации…</p>}
      {state.error && <button type="button" className={styles.taskLink} onClick={() => void chat.retry()} disabled={state.pending}>Повторить вопрос</button>}
      <div ref={bottom} />
    </div>
    <form className={styles.chatForm} aria-label="Вопрос помощнику" onSubmit={event => { event.preventDefault(); send(); }}>
      <label className="sr-only" htmlFor="role-chat-question">Вопрос по системе</label>
      <textarea id="role-chat-question" rows={2} maxLength={4000} value={draft} disabled={state.pending}
        onChange={event => setDraft(event.target.value)} placeholder="Спросите о работе в системе…"
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); send(); } }} />
      <button type="submit" disabled={state.pending || !draft.trim()}>Отправить вопрос</button>
    </form>
  </div>;
}
