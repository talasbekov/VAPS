import type { DutyInterval } from '@/entities/duty-assignment';

export interface RosterPlacement {
  source: 'STATUS' | 'DISPATCH'; source_id: number | string; label: string;
  start_at: string | null; end_at: string | null; record_id: string | null;
  intervals?: DutyInterval[]; time_zone?: string;
}
export interface RosterPerson {
  employee_id: number | string; full_name: string; position_name: string; status_label: string;
  date_start: string; date_end: string | null; destination: string; placements: RosterPlacement[];
}
export interface CombatRosterGroup {
  shift_id: number | string; group_name: string; route_label: string; division_name: string;
  department_id: number | string | null; department_name: string;
  leader_name: string; member_names: string[]; reserve_names: string[]; stage_label: string;
  actual_member_names: string[] | null; actual_start: string | null; actual_end: string | null;
}
export interface DutyRosterSnapshot {
  business_date: string; generated_at: string; time_zone: string;
  departments: { id: number | string; name: string; employees: RosterPerson[] }[];
  combat_groups: CombatRosterGroup[];
}
