"use client";

import { LoadFailure } from "@/components/load-failure";

export function isRatingScopeUnavailable(error: unknown): boolean {
  return error !== null && typeof error === "object" && "errorCode" in error &&
    error.errorCode === "ANALYTICS_SCOPE_UNAVAILABLE";
}

export function RatingReadFailure({ error, what, onRetry, isRetrying }: {
  error: unknown;
  what: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  if (isRatingScopeUnavailable(error)) return (
    <section role="status" className="rounded-xl border bg-card p-4 text-sm">
      <h2 className="mb-1 font-semibold">Рейтинг в вашей области доступа пока недоступен</h2>
      <p className="text-muted-foreground">
        Сводка и история рейтинга по отдельному подразделению пока не поддерживаются.
      </p>
    </section>
  );
  return <LoadFailure what={what} onRetry={onRetry} isRetrying={isRetrying} />;
}
