export const DUTY_REGISTER_PATH = '/api/ops/duty-register/';
export const DUTY_REGISTER_HREF = '/security-ops/duty-register/';
export const DUTY_REGISTER_FILTERS = ['from', 'to', 'kind', 'state', 'source', 'attention', 'division_id', 'employee_id', 'search', 'page', 'page_size'] as const;
export type DutyIdentifier = number | string;
export type DutyRecordSource = 'LOG' | 'PLAN' | 'DISPATCH';
export type DutyRecordState = 'PLANNED' | 'ACKNOWLEDGED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type DutyRecordAction = 'acknowledge' | 'start' | 'complete' | 'cancel' | 'classify' | 'edit';
export const DUTY_SOURCE_LABELS: Record<DutyRecordSource, string> = { LOG: 'Журнал', PLAN: 'План дежурств', DISPATCH: 'Расстановка' };
export const DUTY_STATE_LABELS: Record<DutyRecordState, string> = { PLANNED: 'Запланировано', ACKNOWLEDGED: 'Подтверждено', ACTIVE: 'Начато', COMPLETED: 'Завершено', CANCELLED: 'Отменено' };
export const DUTY_ATTENTION_LABELS: Record<string, string> = {
  MISSING_KIND: 'Вид не указан', MISSING_ACKNOWLEDGEMENT: 'Подтверждение не отмечено', MISSING_START: 'Начало не отмечено',
  MISSING_END: 'Завершение не отмечено', INVALID_ACTUAL_FACTS: 'Неполные фактические отметки', SOURCE_CHANGED: 'Исходная запись изменилась',
  OVERLAP: 'Пересечение записей', EMPLOYEE_UNKNOWN: 'Сотрудник не найден в кадровом учёте',
};
export interface DutyKind { code: string; label: string; label_kk: string; description: string; is_active: boolean }
export interface DutyEmployeeChoice { employee_id: DutyIdentifier; employee_name: string; division_id: DutyIdentifier | null; division_name: string; position_name: string }
export interface DutyRecord {
  id: string; source: DutyRecordSource; source_id: DutyIdentifier; employee_id: DutyIdentifier | null; employee_name: string;
  division_id: DutyIdentifier | null; division_name: string; service_duty_code: string | null; service_duty_label: string;
  business_date: string; state: DutyRecordState; planned_start: string | null; planned_end: string | null;
  planned_minutes: number | null; period_planned_minutes?: number | null; acknowledged_at: string | null;
  actual_start: string | null; actual_end: string | null; actual_minutes: number | null; period_actual_minutes?: number | null;
  location_label: string; document_basis: string; note: string; created_at: string; updated_at: string | null;
  revision: number | null; attention_codes?: string[]; needs_attention?: boolean; actions: DutyRecordAction[];
  acknowledged_by?: string | null; started_by?: string | null; completed_by?: string | null; created_by?: string | null;
  cancelled_at?: string | null; cancelled_reason?: string; execution_mode?: 'SERVER_TIME' | 'RECORDED_TIME'; time_zone?: string;
  planning_locked?: boolean;
  history?: { at: string; action: string; label: string; actor: string; reason: string }[];
}
export interface DutyRegisterSnapshot {
  rows: DutyRecord[]; period: { from: string; to: string }; generated_at: string; time_zone: string;
  summary: { record_count: number; employee_count: number; completed_count: number; active_count: number; cancelled_count: number;
    unconfirmed_count: number; attention_count: number; overlap_count: number; missing_kind_count: number;
    unknown_planned_count: number; unknown_actual_count: number; confirmed_actual_count: number;
    planned_minutes: number | null; actual_record_minutes: number; actual_minutes: number };
  by_kind: { service_duty_code: string | null; service_duty_label: string; record_count: number; employee_count: number;
    planned_minutes: number | null; actual_record_minutes: number | null; attention_count: number;
    unknown_planned_count: number; unknown_actual_count: number; confirmed_actual_count: number }[];
  by_employee: { subject_key: string; employee_id: DutyIdentifier | null; employee_name: string; record_count: number;
    planned_minutes: number | null; actual_record_minutes: number | null; actual_minutes: number | null; attention_count: number;
    unknown_planned_count: number; unknown_actual_count: number; confirmed_actual_count: number }[];
  filters: { divisions: { id: DutyIdentifier; name: string }[]; employees: { employee_id: DutyIdentifier; employee_name: string }[] };
  pagination: { count: number; page: number; pages: number; page_size: number };
}
export function dutyRegisterQuery(params: URLSearchParams, exportAll = false) {
  const result = new URLSearchParams();
  for (const field of DUTY_REGISTER_FILTERS) {
    const value = params.get(field);
    if (value && !(exportAll && (field === 'page' || field === 'page_size'))) result.set(field, value);
  }
  return result.toString();
}
export function dutyRecordPath(id: string) {
  if (!/^(LOG|PLAN|DISPATCH):[1-9]\d{0,18}$/.test(id)) throw new Error('Неверный адрес записи');
  return DUTY_REGISTER_PATH + id + '/';
}
export function dutyHours(minutes: number | null | undefined) {
  return minutes == null ? 'Неизвестно' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(minutes / 60)} ч`;
}
export function dutyDateTime(stamp: string | null | undefined, zone = 'Asia/Qyzylorda') {
  if (!stamp) return 'Не отмечено';
  const value = new Date(stamp);
  return Number.isNaN(value.getTime()) ? 'Некорректная отметка' : new Intl.DateTimeFormat('ru-RU', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value);
}
export function dutyLocalInput(stamp: string | null | undefined, zone = 'Asia/Qyzylorda', exact = false) {
  if (!stamp) return '';
  const value = new Date(stamp);
  if (Number.isNaN(value.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(exact ? { second: '2-digit' as const } : {}), hourCycle: 'h23' }).formatToParts(value);
  const part = (name: string) => parts.find(row => row.type === name)?.value ?? '';
  const minute = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
  // PostgreSQL timestamps retain microseconds beyond JavaScript's millisecond Date.
  const fraction = (stamp.match(/T\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(0, 6);
  return exact ? `${minute}:${part('second')}.${fraction}` : minute;
}
