export interface ChatReply {
  answer: string; mode: "llm" | "documentation" | "data"; notice: string | null;
  conversationToken?: string; conversationReset?: boolean; needsClarification?: boolean;
  readOnly?: { operation: string; asOf: string; count: number; page: number; pageSize: number; hasNext: boolean;
    rows: Record<string, string | number | boolean | null>[]; href?: string | null; date?: string };
  roleContext: { roles: string[]; scopes: string[] };
  sources: { id: string; title: string; document: string; section: string; href: string | null }[];
}
export interface ChatTurn { question: string; reply?: ChatReply; error?: string }
interface ChatState { turns: ChatTurn[]; pending: boolean; error: string | null }
interface AnswerBody { mode: "answer"; message: string; conversationToken: string | null }
const safeHref = (href: unknown) => typeof href === "string" && /^\/(?![\\/])[^\\\u0000-\u0020]*$/.test(href);
function validRead(value: NonNullable<ChatReply['readOnly']>): boolean {
  return !!value && typeof value.operation === "string" && typeof value.asOf === "string" &&
    Number.isInteger(value.count) && value.count >= 0 && Number.isInteger(value.page) && value.page >= 1 && value.page <= 1000 &&
    Number.isInteger(value.pageSize) && value.pageSize >= 1 && value.pageSize <= 100 && typeof value.hasNext === "boolean" &&
    (value.href === undefined || value.href === null || safeHref(value.href)) && Array.isArray(value.rows) && value.rows.length <= 100 &&
    value.rows.every(row => !!row && typeof row === "object" && !Array.isArray(row) &&
      Object.values(row).every(item => item === null || typeof item === "number" || typeof item === "boolean" || (typeof item === "string" && item.length <= 2000)) &&
      (row.href === undefined || safeHref(row.href)));
}
function validReply(value: ChatReply): boolean {
  return !!value && typeof value.answer === "string" && value.answer.length <= 8000 &&
    ["llm", "documentation", "data"].includes(value.mode) && (value.notice === null || typeof value.notice === "string") &&
    !!value.roleContext && [value.roleContext.roles, value.roleContext.scopes].every(list => Array.isArray(list) && list.every(item => typeof item === "string")) &&
    (value.conversationToken === undefined || (typeof value.conversationToken === "string" && value.conversationToken.length <= 65536)) &&
    (value.conversationReset === undefined || typeof value.conversationReset === "boolean") &&
    (value.needsClarification === undefined || typeof value.needsClarification === "boolean") &&
    (value.readOnly === undefined || validRead(value.readOnly)) &&
    Array.isArray(value.sources) && value.sources.length <= 6 && value.sources.every(row => !!row &&
      [row.id, row.title, row.document, row.section].every(text => typeof text === "string") &&
      (row.href === null || safeHref(row.href)));
}
export function createRoleChat(options: {
  getOwner: () => string; onChange: () => void;
  send: (body: AnswerBody, authorize: () => void) => Promise<ChatReply>;
}) {
  let owner = options.getOwner(), generation = 0, disposed = false;
  let conversationToken: string | null = null;
  let state: ChatState = { turns: [], pending: false, error: null };
  let attempt: { owner: string; generation: number; body: AnswerBody; index: number } | null = null;
  const reset = () => { generation++; attempt = null; conversationToken = null; state = { turns: [], pending: false, error: null }; };
  const sync = () => { const current = disposed ? "" : options.getOwner(); if (owner !== current) { owner = current; reset(); } };
  const notify = () => options.onChange();
  async function execute(current: NonNullable<typeof attempt>) {
    const valid = () => !disposed && current.owner === options.getOwner() && current.generation === generation;
    const authorize = () => { if (!valid()) throw Error("Assistant authority changed"); };
    state = { ...state, pending: true, error: null }; notify();
    try {
      authorize(); const reply = await options.send(structuredClone(current.body), authorize); authorize();
      if (!validReply(reply)) throw Error("Invalid assistant response");
      conversationToken = reply.conversationToken ?? null;
      state = { turns: reply.conversationReset
        ? [{ question: current.body.message, reply }]
        : state.turns.map((turn, index) => index === current.index ? { question: turn.question, reply } : turn), pending: false, error: null };
      attempt = null; notify();
    } catch (caught) {
      if (!valid()) { sync(); return; }
      const status = caught && typeof caught === "object" && "status" in caught ? caught.status : undefined;
      const error = status === 403 ? "Недостаточно прав для чтения этих данных. Область доступа не расширена."
        : status === 404 ? "Запись не найдена или недоступна в вашей области."
        : status === 400 ? "Уточните вопрос и фильтры: дату, номер записи или страницу."
        : status === 409 ? "Права или область доступа изменились. Начните новый диалог."
        : "Не удалось получить ответ. Проверьте соединение и повторите вопрос.";
      state = { turns: state.turns.map((turn, index) => index === current.index ? { ...turn, error } : turn), pending: false, error }; notify();
    }
  }
  return {
    snapshot() { sync(); return state; },
    dispose() { disposed = true; owner = ""; reset(); },
    newConversation() { sync(); reset(); notify(); },
    async ask(message: string) {
      sync(); const text = message.trim();
      if (!owner || disposed || state.pending || !text || message.length > 4000) return;
      const index = state.turns.length;
      state = { turns: [...state.turns, { question: text }], pending: false, error: null };
      const current = { owner, generation, body: { mode: "answer" as const, message: text, conversationToken }, index }; attempt = current;
      await execute(current);
    },
    async retry() { sync(); if (attempt && !state.pending) await execute(attempt); },
  };
}
