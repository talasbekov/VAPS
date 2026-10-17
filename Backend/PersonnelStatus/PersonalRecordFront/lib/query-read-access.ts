import type { QueryClient, QueryKey } from "@tanstack/react-query";

// A denied cached read stays hidden until this Query completes an authorised read.
// Query identity avoids carrying the marker across cache removal or account cleanup.
const deniedReads = new WeakSet<object>();

export function blockReadAccess(client: QueryClient, key: QueryKey, clearData = false): void {
  const query = client.getQueryCache().find({ queryKey: key, exact: true });
  if (!query) return;
  deniedReads.add(query);
  if (clearData) query.setState({ data: undefined });
}

export function isReadAccessBlocked(client: QueryClient, key: QueryKey): boolean {
  const query = client.getQueryCache().find({ queryKey: key, exact: true });
  return query !== undefined && deniedReads.has(query);
}

export async function readWithAccessCheck<T>(
  client: QueryClient,
  key: QueryKey,
  signal: AbortSignal,
  read: () => Promise<T>,
): Promise<T> {
  const query = client.getQueryCache().find({ queryKey: key, exact: true });
  try {
    const data = await read();
    // An ignored late result of a cancelled request cannot change a newer denial.
    if (query && !signal.aborted) deniedReads.delete(query);
    return data;
  } catch (error) {
    const status = error !== null && typeof error === "object" && "status" in error ? error.status : undefined;
    if (query && !signal.aborted && (status === 401 || status === 403 || status === 404)) deniedReads.add(query);
    throw error;
  }
}
