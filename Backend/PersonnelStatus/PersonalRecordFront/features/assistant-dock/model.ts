export interface DockState {
  owner: string; open: boolean; visited: boolean; message: string; taskId: string | null; blocked?: boolean; page?: number; submission?: number;
  chatPending?: boolean; view?: "chat" | "tasks"; taskGeneration?: number; taskMessage?: string;
}
export function visibleDock(state: DockState | null, owner: string): DockState {
  return state?.owner === owner ? state : { owner, open: false, visited: false, message: "", taskId: null, blocked: false };
}
export function submitDock(state: DockState, owner: string, message: string): DockState | null {
  const text = message.trim();
  if (!owner || !text || message.length > 4000 || visibleDock(state, owner).chatPending) return null;
  const current = visibleDock(state, owner);
  return { ...current, open: true, visited: true, message: text, view: "chat", submission: (current.submission ?? 0) + 1 };
}
interface GuideEntry { title: string; description: string; href: string }
export function guideLinks<T extends GuideEntry>(message: string, entries: readonly T[]): T[] {
  const words = (message.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => word.length > 3).map(word => word.slice(0, 5));
  const available = entries.filter((entry, index) => entry.href.startsWith("/") && !entry.href.startsWith("//") && entries.findIndex(row => row.href === entry.href) === index);
  const matched = available.filter(entry => words.some(word => `${entry.title} ${entry.description}`.toLocaleLowerCase("ru").includes(word)));
  return (matched.length ? matched : available).slice(0, 6);
}
