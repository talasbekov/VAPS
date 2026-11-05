"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { currentOpsAuthorityStamp } from "@/lib/ops-write-authority";
import { ASSISTANT_PERMISSIONS } from "@/features/om-assistant/model";
import { AssistantAuthorizedWorkspace } from "@/features/om-assistant/workspace";
import { openDock, submitDock, visibleDock, type DockState } from "./model";
import { RoleChat } from "./chat";
import styles from "./assistant-dock.module.css";

interface DockContext extends DockState {
  available: boolean; openPanel(): void; closePanel(): void; setMessage(value: string): void;
  submit(): void; selectTask(value: string | null): void; selectPage(value: number): void; setBlocked(value: boolean): void;
  setChatPending(value: boolean): void; showView(value: "chat" | "tasks"): void; prepareTask(message: string): void;
  setTaskMessage(message: string): void;
}
const Context = createContext<DockContext | null>(null);

export function GlobalAssistantProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const access = useOpsPermissions();
  const pathname = usePathname();
  const client = useQueryClient();
  const authority = currentOpsAuthorityStamp(client, session?.user?.id ?? null);
  const available = status === "authenticated" && !!authority && !access.isLoading && !access.error && access.permissions !== undefined;
  const owner = available ? authority! : "";
  const [raw, setRaw] = useState<DockState | null>(null);
  const state = visibleDock(raw, owner);
  const opener = useRef<HTMLElement | null>(null);
  const update = useCallback((patch: Partial<DockState>) => setRaw(previous => ({ ...visibleDock(previous, owner), ...patch })), [owner]);
  const setMessage = useCallback((message: string) => update({ message }), [update]);
  const setTaskMessage = useCallback((taskMessage: string) => update({ taskMessage }), [update]);
  const selectTask = useCallback((taskId: string | null) => update({ taskId }), [update]);
  const selectPage = useCallback((page: number) => update({ page }), [update]);
  const setBlocked = useCallback((blocked: boolean) => setRaw(previous => previous?.owner === owner ? { ...previous, blocked } : previous), [owner]);
  const setChatPending = useCallback((chatPending: boolean) => setRaw(previous => previous?.owner === owner ? { ...previous, chatPending } : previous), [owner]);
  const showView = useCallback((view: "chat" | "tasks") => update({ view }), [update]);
  const prepareTask = useCallback((message: string) => setRaw(previous => {
    const current = visibleDock(previous, owner); if (current.blocked) return previous;
    return { ...current, view: "tasks", taskMessage: message, taskId: null, page: 1, taskGeneration: (current.taskGeneration ?? 0) + 1 };
  }), [owner]);
  const rememberFocus = () => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
  const openPanel = () => { if (available) { rememberFocus(); setRaw(openDock(state, owner, pathname, ASSISTANT_PERMISSIONS.some(access.hasPermission))); } };
  const closePanel = () => { update({ open: false }); const target = opener.current;
    requestAnimationFrame(() => { if (target?.isConnected) target.focus(); else document.querySelector<HTMLElement>('[aria-label="Открыть ИИ-помощника"]')?.focus(); }); };
  const submit = () => { if (!available) return; const next = submitDock(state, owner, state.message); if (next) { rememberFocus(); setRaw(next); } };
  // Keep only the current authority's conversation. The derived value already
  // hides old content synchronously, before this cleanup effect can run.
  useEffect(() => { setRaw(previous => visibleDock(previous, owner)); }, [owner]);
  return <Context.Provider value={{ ...state, available, openPanel, closePanel, setMessage, setTaskMessage, submit, selectTask, selectPage, setBlocked, setChatPending, showView, prepareTask }}>
    {children}
    {available && state.visited && <Suspense fallback={null}><AssistantPanel key={owner} /></Suspense>}
  </Context.Provider>;
}

export function AssistantLauncher() {
  const dock = useContext(Context);
  if (!dock?.available) return null;
  return <button type="button" className={styles.launcher} aria-label="Открыть ИИ-помощника" aria-expanded={dock.open} aria-controls="global-assistant-panel" onClick={dock.openPanel} title="ИИ-помощник Smart Josparlau">
    <Sparkles size={18} aria-hidden /><span>ИИ-помощник</span>
  </button>;
}

function AssistantPanel() {
  const dock = useContext(Context)!; const access = useOpsPermissions(); const panel = useRef<HTMLElement>(null);
  const canUseTasks = ASSISTANT_PERMISSIONS.some(access.hasPermission);
  const view = canUseTasks && dock.view === "tasks" ? "tasks" : "chat";
  const [tasksVisited, setTasksVisited] = useState(false);
  useEffect(() => { if (view === "tasks") setTasksVisited(true); }, [view]);
  useEffect(() => {
    if (dock.open) (panel.current?.querySelector<HTMLElement>(`#assistant-${view}-view textarea:not(:disabled)`) ?? panel.current?.querySelector<HTMLElement>(`#assistant-${view}-view input:not(:disabled)`) ?? panel.current?.querySelector<HTMLElement>("button"))?.focus();
  }, [dock.open]);
  return <aside ref={panel} id="global-assistant-panel" className={styles.panel} role="dialog" aria-modal="false" aria-labelledby="global-assistant-title"
    aria-describedby="global-assistant-description" hidden={!dock.open} inert={dock.open ? undefined : true}
    onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); dock.closePanel(); } }}>
    <header className={styles.panelHead}><div><h2 id="global-assistant-title">Помощник Smart Josparlau</h2>
      <p id="global-assistant-description">{view === "tasks" ? "Подготовка мероприятия и запросов по вашим правам" : "Ответы на вопросы о работе в системе"}</p></div>
      <button type="button" className={styles.close} aria-label="Закрыть ИИ-помощника" onClick={dock.closePanel}><X size={20} aria-hidden /></button>
    </header>
    {canUseTasks && <div className={styles.tabs} role="tablist" aria-label="Режим помощника">
      <button type="button" id="assistant-chat-tab" role="tab" aria-controls="assistant-chat-view" aria-selected={view === "chat"} onClick={() => dock.showView("chat")}>Помощь по системе</button>
      <button type="button" id="assistant-tasks-tab" role="tab" aria-controls="assistant-tasks-view" aria-selected={view === "tasks"} onClick={() => dock.showView("tasks")}>Подготовить ОМ</button>
    </div>}
    <div className={styles.body}>
      <div id="assistant-chat-view" className={styles.view} role={canUseTasks ? "tabpanel" : undefined} aria-labelledby={canUseTasks ? "assistant-chat-tab" : undefined} hidden={view !== "chat"} inert={view === "chat" ? undefined : true}>
        <RoleChat owner={dock.owner} submission={dock.submission ?? 0} question={dock.message} onQuestionSent={() => dock.setMessage("")}
          onPending={dock.setChatPending} onPrepareTask={canUseTasks && !dock.blocked ? dock.prepareTask : undefined} />
      </div>
      {canUseTasks && (tasksVisited || view === "tasks") && <div id="assistant-tasks-view" className={styles.view} role="tabpanel" aria-labelledby="assistant-tasks-tab" hidden={view !== "tasks"} inert={view === "tasks" ? undefined : true}>
        <AssistantAuthorizedWorkspace key={dock.taskGeneration ?? 0} embedded initialEventId={dock.eventId} selectedTaskId={dock.taskId} onSelectTask={dock.selectTask} selectedPage={dock.page ?? 1} onSelectPage={dock.selectPage}
        draftMessage={dock.taskMessage ?? ""} onDraftMessageChange={dock.setTaskMessage} onWriteBlockedChange={dock.setBlocked} />
      </div>}
    </div>
  </aside>;
}
