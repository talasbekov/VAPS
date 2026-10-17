import { DUTY_ATTENTION_LABELS, DUTY_SOURCE_LABELS, DUTY_STATE_LABELS, type DutyKind, type DutyRegisterSnapshot, type DutyRecordSource, type DutyRecordState } from '@/entities/duty-register';

export function dutyAppliedFilterValues(params: URLSearchParams, data: DutyRegisterSnapshot, kinds: DutyKind[] = []): [string, string][] {
  const kind = params.get('kind'), division = params.get('division_id'), person = params.get('employee_id');
  const source = params.get('source'), state = params.get('state'), attention = params.get('attention');
  const values: [string, string][] = [];
  if (kind) values.push(['Вид дежурства', kind === '__missing__' ? 'Вид не указан' : kinds.find(row => row.code === kind)?.label ?? data.by_kind.find(row => row.service_duty_code === kind)?.service_duty_label ?? kind]);
  if (state) values.push(['Состояние', DUTY_STATE_LABELS[state as DutyRecordState] ?? state]);
  if (division) values.push(['Подразделение', data.filters.divisions.find(row => String(row.id) === division)?.name || `ID ${division}`]);
  if (person) values.push(['Сотрудник', data.filters.employees.find(row => String(row.employee_id) === person)?.employee_name || `ID ${person}`]);
  if (source) values.push(['Источник', DUTY_SOURCE_LABELS[source as DutyRecordSource] ?? source]);
  if (attention) values.push(['Отметки контроля', attention === 'ANY' ? 'Требуют внимания' : DUTY_ATTENTION_LABELS[attention] ?? attention]);
  if (params.get('search')) values.push(['Поиск', params.get('search')!]);
  return values;
}
