/** Open an event or a particular visit while retaining the registry selection. */
export function eventWorkspaceHref(
  eventId: string,
  options: { visitId?: string; backQuery?: string } = {},
): string {
  const query = new URLSearchParams();
  if (options.backQuery) query.set('back', options.backQuery);
  if (options.visitId) query.set('visit', options.visitId);
  const suffix = query.toString();
  return `/security-ops/events/${encodeURIComponent(eventId)}${suffix ? `?${suffix}` : ''}`;
}

/** Read a document from the closed case without losing its selected object. */
export function eventArchiveDocumentHref(
  eventId: string,
  currentQuery: URLSearchParams,
  document: "recon" | "bulletin",
): string {
  const query = new URLSearchParams(currentQuery);
  query.delete("stage");
  query.set("step", "1");
  query.set("document", document);
  return `/security-ops/events/${encodeURIComponent(eventId)}/?${query.toString()}`;
}
