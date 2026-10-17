import { dutyDateTime, type DutyRegisterSnapshot } from '@/entities/duty-register';
import { dutyAppliedFilterValues } from './applied-filters';

function cell(value: unknown) {
  const text = value == null ? '' : String(value);
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}
function hours(minutes: number | null | undefined) {
  return minutes == null || !Number.isFinite(minutes) ? 'Неизвестно' : (minutes / 60).toFixed(2).replace('.', ',');
}
function count(value: number | undefined) { return value == null ? 'Неизвестно' : value; }

export function dutySummaryCsv(data: DutyRegisterSnapshot, view: 'kinds' | 'employees', params: URLSearchParams): { content: string; filename: string } {
  const employees = view === 'employees';
  const rule = employees ? 'Пересечения одного сотрудника исключены.' : 'Сумма часов отдельных записей; пересечения могут увеличивать сумму.';
  const filters = dutyAppliedFilterValues(params, data).map(([label, value]) => `${label}: ${value}`).join(' · ') || 'Все доступные записи за выбранный период.';
  const context = [data.period.from, data.period.to, data.time_zone, dutyDateTime(data.generated_at, data.time_zone), filters, rule];
  const headers = employees
    ? ['Ключ строки', 'ID сотрудника', 'Сотрудник', 'Записей', 'Требуют внимания', 'Плановые часы', 'Фактические часы без пересечений']
    : ['Код вида', 'Вид дежурства', 'Записей', 'Сотрудников', 'Требуют внимания', 'Плановые часы', 'Фактические часы отдельных записей'];
  headers.push('Записей без планового времени', 'Завершённых записей с неполным фактом', 'Завершённых записей с подтверждённым фактом',
    'С даты', 'По дату включительно', 'Часовой пояс', 'Сформировано', 'Применённый отбор', 'Как учитываются часы');
  const rows: unknown[][] = employees ? data.by_employee.map(row => [row.subject_key, row.employee_id, row.employee_name,
    row.record_count, row.attention_count, hours(row.planned_minutes), hours(row.actual_minutes),
    count(row.unknown_planned_count), count(row.unknown_actual_count), count(row.confirmed_actual_count), ...context])
    : data.by_kind.map(row => [row.service_duty_code, row.service_duty_label, row.record_count, row.employee_count,
      row.attention_count, hours(row.planned_minutes), hours(row.actual_record_minutes),
      count(row.unknown_planned_count), count(row.unknown_actual_count), count(row.confirmed_actual_count), ...context]);
  const content = '\uFEFF' + [headers, ...rows].map(row => row.map(cell).join(';')).join('\r\n') + '\r\n';
  return { content, filename: `Сводка по ${employees ? 'сотрудникам' : 'видам'} ${data.period.from} — ${data.period.to}.csv` };
}
