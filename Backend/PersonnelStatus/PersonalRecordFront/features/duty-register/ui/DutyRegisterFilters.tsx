'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DUTY_ATTENTION_LABELS, DUTY_SOURCE_LABELS, DUTY_STATE_LABELS, dutyLocalInput, type DutyKind, type DutyRegisterSnapshot } from '@/entities/duty-register';

export const dutyInput = 'w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm';
const filterFields = ['from', 'to', 'kind', 'state', 'source', 'attention', 'division_id', 'employee_id', 'search'] as const;
export function DutyRegisterFilters({ params, data, kinds, busy, onApply }: {
  params: URLSearchParams; data: DutyRegisterSnapshot; kinds: DutyKind[]; busy: boolean;
  onApply(values: Record<string, string>): void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(filterFields.map(field => [field, params.get(field) ?? (field === 'from' || field === 'to' ? data.period[field] : '')])));
  const selectedIdentifier = (value: string) => /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= BigInt('9223372036854775807');
  const additionalCount = [Boolean(draft.kind.trim()) && draft.kind.length <= 100,
    Object.hasOwn(DUTY_STATE_LABELS, draft.state), Object.hasOwn(DUTY_SOURCE_LABELS, draft.source),
    selectedIdentifier(draft.division_id), selectedIdentifier(draft.employee_id)].filter(Boolean).length;
  const [additionalOpen, setAdditionalOpen] = useState(() => additionalCount > 0);
  const set = (field: string, value: string) => setDraft(previous => ({ ...previous, [field]: value }));
  const from = draft.from ?? '';
  const to = draft.to ?? '';
  const today = dutyLocalInput(data.generated_at, data.time_zone).slice(0, 10);
  const interval = (new Date(to + 'T00:00:00Z').getTime() - new Date(from + 'T00:00:00Z').getTime()) / 86400000;
  const periodError = from && to ? interval < 0 ? 'Конечная дата должна быть не раньше начальной.'
    : interval > 365 ? 'Выберите период не длиннее 366 дней.' : !Number.isFinite(interval) ? 'Укажите корректные даты периода.' : '' : '';
  const periodValid = Boolean(from && to && !periodError);
  function preset(days: number) {
    if (!today || busy) return;
    const date = new Date(today + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() - days + 1);
    const next = { ...draft, from: date.toISOString().slice(0, 10), to: today };
    setDraft(next); onApply(next);
  }
  const selectedKind = draft.kind && draft.kind !== '__missing__' && !kinds.some(kind => kind.code === draft.kind);
  return <form className="space-y-3 rounded-xl border bg-card p-4 print:hidden" onSubmit={event => { event.preventDefault(); if (periodValid && !busy) onApply(draft); }} aria-label="Фильтры журнала">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Период и отбор</h2><div className="flex flex-wrap gap-1">
      <Button type="button" size="sm" variant="ghost" disabled={busy || !today} onClick={() => preset(1)}>Сегодня</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy || !today} onClick={() => preset(7)}>7 дней</Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy || !today} onClick={() => preset(30)}>30 дней</Button>
    </div></div>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <label className="grid min-w-0 gap-1 text-sm">С даты<input type="date" required min="0001-01-01" max="9999-12-31" aria-describedby={periodError ? 'duty-period-error' : undefined} className={dutyInput} value={from} onChange={event => set('from', event.target.value)} /></label>
      <label className="grid min-w-0 gap-1 text-sm">По дату включительно<input type="date" required min="0001-01-01" max="9999-12-31" aria-describedby={periodError ? 'duty-period-error' : undefined} className={dutyInput} value={to} onChange={event => set('to', event.target.value)} /></label>
      <label className="grid min-w-0 gap-1 text-sm">Отметки контроля<select className={dutyInput} value={draft.attention} onChange={event => set('attention', event.target.value)}><option value="">Все записи</option><option value="ANY">Требуют внимания</option>{Object.entries(DUTY_ATTENTION_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
    </div>
    {periodError && <p id="duty-period-error" role="alert" className="text-sm text-destructive">{periodError}</p>}
    <div className="flex flex-wrap items-end gap-3"><label className="grid min-w-0 flex-1 basis-64 gap-1 text-sm">Поиск по записям<input type="search" maxLength={200} className={dutyInput} placeholder="Сотрудник, вид, место, основание или примечание" value={draft.search} onChange={event => set('search', event.target.value)} /></label><Button type="submit" disabled={busy || !periodValid}>Применить фильтры</Button><Button type="button" variant="ghost" disabled={busy || !periodValid} onClick={() => { const next = Object.fromEntries(filterFields.map(field => [field, field === 'from' ? from : field === 'to' ? to : ''])); setDraft(next); onApply(next); }}>Сбросить отбор</Button></div>
    <details open={additionalOpen} onToggle={event => setAdditionalOpen(event.currentTarget.open)} className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Дополнительные фильтры · {additionalCount}</summary>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <label className="grid min-w-0 gap-1 text-sm">Вид дежурства<select className={dutyInput} value={draft.kind} onChange={event => set('kind', event.target.value)}><option value="">Все виды</option><option value="__missing__">Вид не указан</option>{selectedKind && <option value={draft.kind}>Выбранный код: {draft.kind}</option>}{kinds.map(kind => <option key={kind.code} value={kind.code}>{kind.label}{!kind.is_active ? ' · неактивен' : ''}</option>)}</select></label>
      <label className="grid min-w-0 gap-1 text-sm">Состояние<select className={dutyInput} value={draft.state} onChange={event => set('state', event.target.value)}><option value="">Все состояния</option>{Object.entries(DUTY_STATE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <label className="grid min-w-0 gap-1 text-sm">Подразделение<select className={dutyInput} value={draft.division_id} onChange={event => set('division_id', event.target.value)}><option value="">Все доступные</option>{draft.division_id && !data.filters.divisions.some(row => String(row.id) === draft.division_id) && <option value={draft.division_id}>Выбранное подразделение · нет записей в периоде</option>}{data.filters.divisions.map(row => <option key={row.id} value={row.id}>{row.name || 'Без названия'}</option>)}</select></label>
      <label className="grid min-w-0 gap-1 text-sm">Сотрудник<select className={dutyInput} value={draft.employee_id} onChange={event => set('employee_id', event.target.value)}><option value="">Все сотрудники</option>{draft.employee_id && !data.filters.employees.some(row => String(row.employee_id) === draft.employee_id) && <option value={draft.employee_id}>Выбранный сотрудник · нет записей в периоде</option>}{data.filters.employees.map(row => <option key={row.employee_id} value={row.employee_id}>{row.employee_name}</option>)}</select></label>
      <label className="grid min-w-0 gap-1 text-sm">Источник<select className={dutyInput} value={draft.source} onChange={event => set('source', event.target.value)}><option value="">Все источники</option>{Object.entries(DUTY_SOURCE_LABELS).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      </div>
    </details>
  </form>;
}
