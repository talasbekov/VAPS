import type { SecurityEvent } from "@/entities/security-event";
import type { GvoSummaryRow } from "@/entities/gvo-summary";
import { matchesProtectedPerson, type ProtectedPerson } from "./types";

type PersonIdentity = Pick<ProtectedPerson, "id" | "name">;

/** Stable links are authoritative; old summaries without IDs retain name matching. */
export function eventsForProtectedPerson(
  person: PersonIdentity,
  events: SecurityEvent[],
  summaries: Record<string, GvoSummaryRow>,
): SecurityEvent[] {
  return events.filter((event) =>
    event.protectedPersonId === person.id ||
    (event.protectedPersons ?? []).some((entry) => entry.id === person.id) ||
    (event.visitObjects ?? []).some((visit) => visit.protectedPersonId === person.id) ||
    (summaries[event.code]?.summary.persons ?? []).some((entry) => matchesProtectedPerson(person, entry))
  );
}

export interface PersonObjectLink { id: string | null; name: string }

/** An event-level person link does not imply attendance at every visit. */
export function objectsForProtectedPerson(
  person: PersonIdentity,
  linkedEvents: SecurityEvent[],
): PersonObjectLink[] {
  const objects = new Map<string, PersonObjectLink>();
  const add = (id: string | null, name: string) => {
    if (name.trim() === "") return;
    objects.set(id === null ? `name:${name}` : `id:${id}`, { id, name });
  };
  for (const event of linkedEvents) {
    const visits = event.visitObjects ?? [];
    if (visits.length === 0) {
      // Before visit objects existed, a matched event had only this one object.
      add(event.objectId, event.objectName);
      continue;
    }
    for (const visit of visits) {
      if (visit.protectedPersonId === person.id) add(visit.objectId, visit.objectName);
    }
  }
  return [...objects.values()];
}
