import type { DutyPlacement } from '@/entities/duty-assignment';
import type { DutyRecordState } from '@/entities/duty-register';

export interface DutyPerson {
  employee_id: number;
  full_name: string;
  position_name: string;
  department_name: string;
  directorate_name: string;
  status_id: number;
  status_label: string;
  date_start: string;
  date_end: string | null;
  unavailable_reason?: string | null;
  legacy_assignment?: DutyPlacement | null;
}
export interface DispatchAssignment {
  id: number;
  employee_id: number;
  full_name: string;
  department_name?: string;
  directorate_name?: string;
  position_name?: string;
  source_status_id: number;
  placement: DutyPlacement;
  start_at: string;
  end_at: string;
  created_at: string;
  created_by: string;
  cancelled_at: string | null;
  cancelled_reason?: string;
  valid: boolean;
  invalid_reason: string | null;
  service_duty_code?: string | null;
  service_duty_label?: string;
  duty_record_id?: string;
  execution_state?: DutyRecordState;
  can_cancel?: boolean;
}
export interface DispatchQueue {
  business_date: string;
  time_zone?: string;
  receiver: { id: number; name: string } | null;
  receiver_options?: { id: number; name: string }[];
  can_configure: boolean;
  can_assign: boolean;
  can_cancel: boolean;
  access_reason: string | null;
  people: DutyPerson[];
  assignments: DispatchAssignment[];
}
