interface ApprovalStep {
  name: string;
  username?: string | null;
  status: string;
}

/** Explain the same identity and ordering restrictions enforced by the API. */
export function approvalDecisionReason({
  route, index, username, loading, canApprove, canBypassIdentity,
}: {
  route: readonly ApprovalStep[];
  index: number;
  username: string | null;
  loading: boolean;
  canApprove: boolean;
  canBypassIdentity: boolean;
}): string | null {
  if (loading) return "Проверяем доступ к согласованию…";
  if (!canApprove) return "Решение принимает согласующий с правом подписи";
  if (!username) return "Войдите в учётную запись согласующего";
  const step = route[index];
  if (!step || step.status !== "PENDING") return "Эта строка сейчас не ожидает решения";
  if (step.username && step.username !== username && !canBypassIdentity) {
    return `Эту строку подписывает учётка «${step.username}»`;
  }
  const waiting = route.slice(0, index).find((row) => row.status !== "APPROVED");
  if (waiting) return `Сначала ожидается решение: ${waiting.name}`;
  return null;
}
