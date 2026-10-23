'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { dutyHours, type DutyRegisterSnapshot } from '@/entities/duty-register';

interface SummaryGroup {
  key: string; label: string; records: number; planned: number | null; actual: number | null;
  attention: number; unknownPlan: number; unknownActual: number; values: Record<string, string> | null;
}
const pageSize = 40;

function HoursComparison({ row, maximum }: { row: SummaryGroup; maximum: number }) {
  return <div className="space-y-2" aria-label="Сравнение часов">
    {[{ label: 'План', minutes: row.planned, color: 'bg-slate-400' },
      { label: 'Подтверждённый факт', minutes: row.actual, color: 'bg-blue-600' }].map(value => <div key={value.label}>
      <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-sm"><span>{value.label}</span><span className="font-medium tabular-nums">{dutyHours(value.minutes)}</span></div>
      {value.minutes != null && <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className={`h-full rounded-full ${value.color}`} style={{ width: maximum ? `${100 * value.minutes / maximum}%` : '0%' }} /></div>}
    </div>)}
    {row.unknownPlan > 0 && <p className="text-xs text-muted-foreground">Записей без планового времени: {row.unknownPlan}.</p>}
    {row.unknownActual > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Завершённых записей с неполным фактом: {row.unknownActual}.</p>}
  </div>;
}

export function DutyRegisterGroups({ data, view, onFilter, busy, requestedPage, onPage }: {
  data: DutyRegisterSnapshot; view: string; busy: boolean; requestedPage: number;
  onFilter(values: Record<string, string>): void; onPage(value: number): void;
}) {
  const rows = useMemo<SummaryGroup[]>(() => view === 'kinds'
    ? data.by_kind.map(row => ({ key: row.service_duty_code ?? '__missing__', label: row.service_duty_label, records: row.record_count,
      planned: row.planned_minutes, actual: row.actual_record_minutes, attention: row.attention_count,
      unknownPlan: row.unknown_planned_count, unknownActual: row.unknown_actual_count, values: { kind: row.service_duty_code ?? '__missing__' } }))
    : data.by_employee.map(row => ({ key: row.subject_key, label: row.employee_name, records: row.record_count,
      planned: row.planned_minutes, actual: row.actual_minutes, attention: row.attention_count,
      unknownPlan: row.unknown_planned_count, unknownActual: row.unknown_actual_count,
      values: row.employee_id == null ? null : { employee_id: String(row.employee_id) } })), [data.by_kind, data.by_employee, view]);
  const maximum = useMemo(() => rows.reduce((value, row) => Math.max(value, row.planned ?? 0, row.actual ?? 0), 0), [rows]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.max(1, Math.min(pages, requestedPage));
  const first = (page - 1) * pageSize;
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{view === 'kinds'
      ? 'Часы по видам — сумма часов отдельных записей. При пересечениях она может превышать фактически прошедшее время.'
      : 'Часы по сотрудникам исключают повторное время пересечений. Имя без кадрового ID показано отдельной строкой.'}</p>
    {rows.length > 0 && <p className="text-xs text-muted-foreground">Полосы часов используют одну шкалу для всего отбора. Неизвестное время обозначено отдельно.</p>}
    {!rows.length && <p className="rounded-xl border p-5 text-sm">Нет данных в выбранном отборе.</p>}
    <div className="grid gap-3 lg:grid-cols-2">{rows.slice(first, first + pageSize).map(row => <article key={row.key} className="min-w-0 space-y-3 rounded-xl border p-4 print:break-inside-avoid">
      <h3 className="break-words font-semibold">{row.label || 'Имя не указано'}</h3>
      <dl className="grid grid-cols-2 gap-2 text-sm"><div><dt className="text-muted-foreground">Записей</dt><dd className="font-medium tabular-nums">{row.records}</dd></div><div><dt className="text-muted-foreground">Требуют внимания</dt><dd className="font-medium tabular-nums">{row.attention}</dd></div></dl>
      <HoursComparison row={row} maximum={maximum} />
      {row.values && <Button variant="outline" size="sm" className="print:hidden" disabled={busy} onClick={() => onFilter(row.values!)}>Показать записи</Button>}
    </article>)}</div>
    {rows.length > 0 && <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Страницы сводки">
      <p className="text-sm text-muted-foreground">Показано {first + 1}–{Math.min(first + pageSize, rows.length)} из {rows.length}</p>
      {pages > 1 && <div className="flex items-center gap-2 print:hidden"><Button size="sm" variant="outline" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>Назад</Button><span className="text-sm">{page} / {pages}</span><Button size="sm" variant="outline" disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>Далее</Button></div>}
    </nav>}
  </div>;
}
