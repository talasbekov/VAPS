import type { Query, QueryClient } from "@tanstack/react-query";
import { isReadAccessBlocked } from "@/lib/query-read-access";

/** Only mounted, enabled sources belong to the screen's refresh promise. */
export function isServiceAnalyticsSource(query: Query): boolean {
  const [group, kind] = query.queryKey;
  return query.isActive() && (
    group === "ops-analytics" || group === "strength-report" || group === "traffic-light" ||
    (group === "ops-notifications" && kind === "feed") ||
    (group === "ops-daily" && kind === "divisions")
  );
}

export function refreshServiceAnalyticsSources(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ predicate: isServiceAnalyticsSource, refetchType: "active" });
}

export function serviceAnalyticsSourceState(client: QueryClient) {
  const queries = client.getQueryCache().findAll({ predicate: isServiceAnalyticsSource });
  return {
    failed: queries.some(query => query.state.status === "error" || isReadAccessBlocked(client, query.queryKey)),
    pending: queries.some(query => query.state.status === "pending" || query.state.data === undefined),
    // One fresh response cannot make an older source appear fresh.
    updatedAt: queries.length === 0 ? 0 : Math.min(...queries.map(query => query.state.dataUpdatedAt)),
  };
}
