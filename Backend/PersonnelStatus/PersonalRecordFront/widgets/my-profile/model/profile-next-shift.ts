import type { MyAssignmentRow } from "@/hooks/use-my-assignments";

/** Self-only projection. Dates are inclusive; timestamp intervals are [start, end). */
export interface PersonalDutyRow {
  id: string;
  source: "STATUS" | "DISPATCH" | "LOG" | "PLAN";
  source_id: number | string;
  source_state: string;
  business_date: string;
  date_start?: string | null;
  date_end?: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  acknowledged_at: string | null;
  canAcknowledge: boolean;
  acknowledgementToken: string | null;
  object_label: string;
  post_label: string;
  senior: string | null;
  instruction: string | null;
  readOnly: true;
}

export interface PersonalDutyResponse {
  employeeId: string | null;
  unlinkedReason: string | null;
  time_zone: string;
  generated_at: string;
  results: PersonalDutyRow[];
}

export interface ProfileNextShift {
  key: string;
  source: PersonalDutyRow["source"] | "OM";
  sourceState: string;
  title: string;
  dateStart: string;
  dateEnd: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  acknowledgedAt: string | null;
  canAcknowledge: boolean;
  acknowledgementToken: string | null;
  execution: "ASSIGNED" | "ACKNOWLEDGED" | "STARTED" | "DECLINED" | "PREPARING";
  declineReason: string | null;
  objectLabel: string | null;
  postLabel: string | null;
  senior: string | null;
  instruction: string | null;
  eventId: string | null;
}

const text = (value: string | null | undefined) => value?.trim() || null;
const isDate = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const exactTime = (value: string | null | undefined): string | null =>
  value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value)) ? value : null;

/** Advance a received server instant with monotonic elapsed time, never the workstation clock. */
export function profileServerNow(generatedAt: string | null | undefined, receivedMonotonicMs: number | undefined, monotonicNowMs: number): Date | null {
  const at = exactTime(generatedAt);
  if (at === null || receivedMonotonicMs === undefined || !Number.isFinite(receivedMonotonicMs) ||
    !Number.isFinite(monotonicNowMs) || monotonicNowMs < receivedMonotonicMs) return null;
  return new Date(Date.parse(at) + monotonicNowMs - receivedMonotonicMs);
}

/** No timestamp is derived from a calendar date or a source's default duration. */
export function selectNextProfileShift(
  duties: readonly PersonalDutyRow[],
  assignments: readonly MyAssignmentRow[],
  now = new Date(),
  timeZone = "Asia/Almaty",
): ProfileNextShift | null {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone }).format(now);
  const candidates: ProfileNextShift[] = [];
  const acceptedAcknowledgement = (stamp: string | null) => {
    const exact = exactTime(stamp);
    return exact !== null && Date.parse(exact) <= now.getTime() ? exact : null;
  };
  for (const row of duties) {
    if (["CANCELLED", "COMPLETED"].includes(row.source_state) || row.actual_end) continue;
    const actualStart = exactTime(row.actual_start);
    const plannedStart = exactTime(row.planned_start);
    const plannedEnd = exactTime(row.planned_end);
    const dateStart = isDate(row.date_start) ? row.date_start : row.business_date;
    const dateEnd = isDate(row.date_end) && row.date_end >= dateStart ? row.date_end : dateStart;
    const started = row.source_state === "ACTIVE" && actualStart !== null && Date.parse(actualStart) <= now.getTime();
    const acknowledgedAt = acceptedAcknowledgement(row.acknowledged_at);
    const token = typeof row.acknowledgementToken === "string" && /^[a-f0-9]{64}$/.test(row.acknowledgementToken) ? row.acknowledgementToken : null;
    if (!started && (plannedEnd !== null ? Date.parse(plannedEnd) <= now.getTime() : !isDate(dateEnd) || dateEnd < today)) continue;
    candidates.push({
      key: row.id, source: row.source, sourceState: row.source_state, title: "Дежурство",
      dateStart, dateEnd, plannedStart, plannedEnd, actualStart, actualEnd: null,
      acknowledgedAt, acknowledgementToken: token,
      canAcknowledge: row.canAcknowledge === true && token !== null && acknowledgedAt === null && !started,
      execution: started ? "STARTED" : acknowledgedAt !== null ? "ACKNOWLEDGED" : "ASSIGNED",
      declineReason: null, objectLabel: text(row.object_label), postLabel: text(row.post_label),
      senior: text(row.senior), instruction: text(row.instruction), eventId: null,
    });
  }
  for (const row of assignments) {
    if (row.eventStage === "CLOSED" || !isDate(row.businessDate)) continue;
    const dateEnd = isDate(row.businessDateEnd) && row.businessDateEnd >= row.businessDate ? row.businessDateEnd : row.businessDate;
    if (dateEnd < today) continue;
    const acknowledgedAt = acceptedAcknowledgement(row.acknowledgedAt);
    candidates.push({
      key: `OM:${row.assignmentId}`, source: "OM", sourceState: row.eventStage,
      title: [row.eventCode, row.eventTitle].filter(Boolean).join(" · "),
      dateStart: row.businessDate, dateEnd, plannedStart: null, plannedEnd: null,
      actualStart: null, actualEnd: null, acknowledgedAt, canAcknowledge: false, acknowledgementToken: null,
      execution: row.declinedAt ? "DECLINED" : acknowledgedAt !== null ? "ACKNOWLEDGED" :
        ["ACKNOWLEDGEMENT", "CONDUCT"].includes(row.eventStage) ? "ASSIGNED" : "PREPARING",
      declineReason: text(row.declineReason), objectLabel: text(row.visitObjectName) ?? text(row.objectName),
      postLabel: row.postFound ? text([row.sector, row.post].filter(Boolean).join(" · ")) : null,
      senior: null, instruction: row.postFound ? text(row.task) : null, eventId: row.eventId,
    });
  }
  candidates.sort((a, b) => {
    const active = Number(b.execution === "STARTED") - Number(a.execution === "STARTED");
    if (active !== 0) return active;
    const dayOf = (item: ProfileNextShift) => {
      const exact = item.execution === "STARTED" ? item.actualStart : item.plannedStart;
      const date = exact ? new Intl.DateTimeFormat("sv-SE", { timeZone }).format(new Date(exact)) : item.dateStart;
      return date < today ? today : date;
    };
    const day = dayOf(a).localeCompare(dayOf(b));
    if (day !== 0) return day;
    const aTime = Date.parse(a.execution === "STARTED" ? a.actualStart! : a.plannedStart ?? "");
    const bTime = Date.parse(b.execution === "STARTED" ? b.actualStart! : b.plannedStart ?? "");
    const time = (Number.isFinite(aTime) ? aTime : Infinity) - (Number.isFinite(bTime) ? bTime : Infinity);
    return (Number.isFinite(time) || time === Infinity || time === -Infinity ? time : 0) || a.key.localeCompare(b.key);
  });
  return candidates[0] ?? null;
}
