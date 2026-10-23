import type { DutyRecord, DutyRecordState } from '@/entities/duty-register';

type Facts = Pick<DutyRecord, 'state' | 'created_at' | 'acknowledged_at' | 'actual_start' | 'actual_end'>;
export type DutyExecutionState = DutyRecordState | 'INCOMPLETE';

function instant(value: string | null | undefined): number {
  return value && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

function recorded(value: string | null | undefined, now: string): boolean {
  const at = instant(value), current = instant(now);
  return Number.isFinite(at) && Number.isFinite(current) && at <= current;
}

/** A date, an acknowledgement or a state code cannot substitute for attendance. */
export function executionState(row: Facts, now: string): DutyExecutionState {
  if (row.state === 'CANCELLED') return 'CANCELLED';
  if (row.actual_end) return recorded(row.actual_start, now) && recorded(row.actual_end, now)
    && instant(row.actual_end) >= instant(row.actual_start) ? 'COMPLETED' : 'INCOMPLETE';
  if (row.actual_start) return recorded(row.actual_start, now) ? 'ACTIVE' : 'INCOMPLETE';
  if (row.state === 'ACTIVE' || row.state === 'COMPLETED') return 'INCOMPLETE';
  if (row.acknowledged_at) return recorded(row.acknowledged_at, now) ? 'ACKNOWLEDGED' : 'INCOMPLETE';
  return 'PLANNED';
}

/** Preserve each explicit fact independently, including a gap in old records. */
export function executionSteps(row: Facts, now: string) {
  return [
    { code: 'assigned', label: 'Назначен', at: row.created_at, recorded: true },
    { code: 'acknowledged', label: 'Ознакомлен', at: row.acknowledged_at, recorded: recorded(row.acknowledged_at, now) },
    { code: 'started', label: 'Заступил', at: row.actual_start, recorded: recorded(row.actual_start, now) },
  ];
}
