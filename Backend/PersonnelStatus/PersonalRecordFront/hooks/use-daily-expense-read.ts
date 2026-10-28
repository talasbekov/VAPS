"use client";

import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { OpsApiError, type OpsApiFailure } from "@/lib/ops-errors";
import { hasCurrentOpsReadAuthority, useOpsProtectedRead, useOpsReadAccess } from "@/hooks/use-ops-protected-read";

type DailyRead<T> = UseQueryResult<T, OpsApiFailure> &
  Pick<ReturnType<typeof useOpsProtectedRead<T>>, "readAccessBlocked" | "readKey" | "canAct">;

/** Every daily source belongs to the current actor and live permission scope.
 * A denied source clears its daily siblings; a successful retry restores only
 * the source actually reread. Existing daily mutations invalidate this prefix.
 */
export function useDailyExpenseRead<T>(kind: string, parts: readonly unknown[],
  read: (signal: AbortSignal, authorize: () => void) => Promise<T>,
  options: { enabled?: boolean; staleTime?: number; refetchOnWindowFocus?: boolean } = {},
): DailyRead<T> {
  const access = useOpsReadAccess("status.view");
  const client = useQueryClient();
  const result = useOpsProtectedRead(["daily-expense-board", kind], parts, access, async signal => {
    // A retained callback must also match the provider's live session before
    // AuthProvider's account-change cleanup effect has had time to run.
    const authorize = () => {
      signal.throwIfAborted();
      if (!hasCurrentOpsReadAuthority(client, access)) throw new OpsApiError({ status: 403,
        errorCode: "PERMISSION_AUTHORITY_UNAVAILABLE", message: "Дождитесь успешной проверки прав доступа.",
        details: {}, requestId: null });
    };
    authorize();
    const data = await read(signal, authorize);
    authorize();
    return data;
  }, options);
  const refetch: typeof result.refetch = async (...args) => {
    if (!result.readAccessBlocked) return result.refetch(...args);
    const own = client.getQueryCache().find({ queryKey: result.readKey, exact: true });
    const [refreshed] = await Promise.all([result.refetch(...args), client.refetchQueries({ type: "active",
      predicate: query => query !== own && query.queryKey[0] === "daily-expense-board" && query.queryKey[2] === access.scope })]);
    return refreshed;
  };
  // A sibling denial clears data without changing the cached Query's status.
  // Readers must see a retryable error, never success-without-data or a spinner.
  if (result.readAccessBlocked) {
    return { ...result, refetch, status: "error", isSuccess: false, isPending: false,
      isLoading: false, isInitialLoading: false, isError: true, isLoadingError: true,
      isRefetchError: false, error: result.error ?? new OpsApiError({ status: 403,
        errorCode: "DAILY_READ_REVALIDATION_REQUIRED", message: "Доступ к расходу нужно проверить повторной загрузкой.",
        details: {}, requestId: null }) } as DailyRead<T>;
  }
  if (result.isSuccess && result.data === undefined) {
    return { ...result, refetch, status: "pending", isSuccess: false, isPending: true,
      isLoading: result.isFetching, isInitialLoading: result.isFetching } as DailyRead<T>;
  }
  return { ...result, refetch } as DailyRead<T>;
}
