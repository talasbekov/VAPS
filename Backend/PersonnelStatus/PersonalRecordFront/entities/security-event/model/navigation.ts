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
