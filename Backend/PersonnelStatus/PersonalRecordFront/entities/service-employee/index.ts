export const SERVICE_EMPLOYEES_PATH = '/api/core/service-employees/';

export function missingRatingLabel(state: string): string {
  if (state === 'FEATURE_DISABLED') return 'Рейтинг отключён';
  if (state === 'POLICY_UNDEFINED') return 'Методика не настроена';
  if (state === 'UNAVAILABLE') return 'Рейтинг недоступен';
  return 'Недостаточно оценок';
}

export interface ServiceAssignment {
  id: string;
  event_id: number;
  event_code: string;
  event_title: string;
  object_name: string;
  post: string;
  sector: string;
  date_start: string;
  date_end: string;
  closed: boolean;
  active: boolean;
  stage: string;
  acknowledged_at: string | null;
  declined_at: string | null;
  address: string;
  event_time: string | null;
  task: string;
  requirements: string;
  uniform: string;
  weapon: string;
  chief_name: string;
  chief_callsign: string | null;
  chief_work_phone: string | null;
}

export interface ServiceEmployee {
  id: number;
  full_name: string;
  personnel_number: string;
  callsign: string;
  rank: string | null;
  position: string | null;
  division: { id: number; name: string } | null;
  current_status: { code: string; name: string; date_end: string | null };
  rating: number | null;
  evaluations_count: number;
  rated_events_count: number;
  rating_state: string;
  active_assignments_count: number;
  next_assignment: ServiceAssignment | null;
}

export interface ServiceEmployeePage {
  count: number;
  next: string | null;
  previous: string | null;
  results: ServiceEmployee[];
}

export interface ServiceEmployeeDetail extends ServiceEmployee {
  hire_date: string;
  work_phone: string | null;
  work_email: string | null;
  assignments: ServiceAssignment[];
  history: ServiceAssignment[];
  evaluations: {
    event_id: number | null;
    event_code: string;
    score: number;
    comment: string | null;
    author: string;
    date: string;
    assignment_id: string | null;
    post: string | null;
  }[];
}

export interface ServiceEmployeeOptions {
  divisions: { id: number; name: string; parent_id: number | null; level: number }[];
  statuses: { code: string; name: string }[];
}

export function serviceEmployeeHref(id: number, filters = ''): string {
  const query = new URLSearchParams({ directory: '1' });
  if (filters) query.set('filters', filters);
  return `/security-ops/profile/${id}?${query}`;
}
