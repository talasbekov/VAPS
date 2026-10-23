'use client';

import { Button } from '@/components/ui/button';
import { DUTY_ATTENTION_LABELS, DUTY_SOURCE_LABELS, dutyDateTime, dutyHours, type DutyRecord, type DutyRegisterSnapshot } from '@/entities/duty-register';
import { DutyExecutionBadge, DutyExecutionTimeline } from './DutyExecutionTimeline';

export function DutyRegisterSummary({ data, busy, onFilter }: { data: DutyRegisterSnapshot; busy: boolean; onFilter(values: Record<string, string>): void }) {
  const sum = data.summary;
  const cards = [
    { label: 'Всего записей', value: sum.record_count, caption: `Сотрудников: ${sum.employee_count}`, values: { state: '', attention: '' } },
    { label: 'Требуют внимания', value: sum.attention_count, caption: 'Незакрытые и спорные отметки', values: { attention: 'ANY', state: '' } },
    { label: 'Завершено', value: sum.completed_count, caption: 'Проверяйте полноту факта', values: { state: 'COMPLETED', attention: '' } },
    { label: 'Выполняются', value: sum.active_count, caption: 'Начало отмечено', values: { state: 'ACTIVE', attention: '' } },
  ];
  return <section aria-label="Показатели выбранного периода" className="space-y-3">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{cards.map(card => <button key={card.label} type="button" disabled={busy} onClick={() => onFilter(card.values)} className="min-w-0 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:p-4"><span className="block text-sm font-medium">{card.label}</span><strong className="my-1 block text-2xl tabular-nums">{card.value}</strong><span className="block text-xs text-muted-foreground">{card.caption}</span></button>)}</div>
    <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Плановые часы в периоде</p><p className="mt-1 text-xl font-semibold tabular-nums">{dutyHours(sum.planned_minutes)}</p>{sum.unknown_planned_count > 0 && <p className="mt-1 text-sm text-muted-foreground">Записей с неизвестным плановым временем: {sum.unknown_planned_count}.</p>}</div><div className="rounded-xl border p-4"><p className="text-sm text-muted-foreground">Подтверждённые фактические часы</p><p className="mt-1 text-xl font-semibold tabular-nums">{dutyHours(sum.actual_minutes)}</p><p className="mt-1 text-sm text-muted-foreground">По отметкам начала и завершения, включая историю изменённых назначений. Пересечения одного сотрудника считаются один раз.</p>{sum.unknown_actual_count > 0 && <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">Завершённых записей с неполным фактом: {sum.unknown_actual_count}.</p>}</div></div>
    <div className="flex flex-wrap gap-2 print:hidden">{sum.missing_kind_count > 0 && <Button variant="outline" size="sm" disabled={busy} onClick={() => onFilter({ kind: '__missing__' })}>Вид не указан · {sum.missing_kind_count}</Button>}{sum.unconfirmed_count > 0 && <Button variant="outline" size="sm" disabled={busy} onClick={() => onFilter({ attention: 'MISSING_ACKNOWLEDGEMENT' })}>Без подтверждения · {sum.unconfirmed_count}</Button>}{sum.overlap_count > 0 && <Button variant="outline" size="sm" disabled={busy} onClick={() => onFilter({ attention: 'OVERLAP' })}>Пересечения · {sum.overlap_count}</Button>}</div>
  </section>;
}

export function DutyRegisterRows({ rows, zone, generatedAt = '', busy, emptyAction = null, onOpen }: { rows: DutyRecord[]; zone: string; generatedAt?: string; busy: boolean; emptyAction?: 'create' | 'recover' | null; onOpen(row: DutyRecord): void }) {
  if (!rows.length) return <div className="rounded-xl border p-6"><h2 className="font-semibold">В выбранном периоде и отборе нет записей</h2><p className="mt-1 text-sm text-muted-foreground">Измените период или сбросьте отбор.{emptyAction === 'create' ? ' Новую смену можно внести кнопкой «Добавить запись».' : emptyAction === 'recover' ? ' Чтобы уточнить результат предыдущей попытки, нажмите «Проверить предыдущее сохранение».' : ''}</p></div>;
  return <div className="space-y-3" aria-label="Записи журнала">{rows.map(row => <article key={row.id} className="rounded-xl border bg-card p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1 break-words"><h3 className="font-semibold">{row.employee_name || 'Имя не указано'}</h3><p className="mt-1 text-sm text-muted-foreground">{row.division_name || 'Подразделение неизвестно'} · {DUTY_SOURCE_LABELS[row.source]}</p><p className="mt-2 text-sm font-medium">{row.service_duty_label || 'Вид не указан'}</p></div><DutyExecutionBadge row={row} now={generatedAt} /></div>
    <div className="mt-3"><DutyExecutionTimeline row={row} now={generatedAt} zone={zone} /></div>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <div className="min-w-0"><dt className="text-muted-foreground">План</dt><dd className="mt-1 break-words">{row.planned_start ? <>{dutyDateTime(row.planned_start, zone)}<br />{dutyDateTime(row.planned_end, zone)}</> : <>Дата: {row.business_date}<br />Время не указано</>}</dd></div>
      <div className="min-w-0"><dt className="text-muted-foreground">Факт</dt><dd className="mt-1 break-words">{row.actual_start ? <>{dutyDateTime(row.actual_start, zone)}<br />{row.actual_end ? dutyDateTime(row.actual_end, zone) : 'Завершение не отмечено'}</> : 'Начало не отмечено'}</dd></div>
      <div><dt className="text-muted-foreground">Часы в периоде</dt><dd className="mt-1">План: {dutyHours(row.period_planned_minutes)}<br />Факт записи: {dutyHours(row.period_actual_minutes)}</dd></div>
      <div className="min-w-0"><dt className="text-muted-foreground">Место</dt><dd className="mt-1 break-words">{row.location_label || 'Не указано'}</dd></div>
    </dl>
    {(row.attention_codes?.length ?? 0) > 0 && <ul className="mt-3 flex flex-wrap gap-2" aria-label="Контроль записи">{row.attention_codes?.map(code => <li key={code} className="max-w-full rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">{DUTY_ATTENTION_LABELS[code] ?? code}</li>)}</ul>}
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="min-w-0 break-words text-xs text-muted-foreground">{row.document_basis || row.note || 'Основание и примечание не указаны'}</p><Button variant="outline" size="sm" className="shrink-0 print:hidden" disabled={busy} onClick={() => onOpen(row)} aria-label={`Открыть запись: ${row.employee_name}`}>Открыть запись</Button></div>
  </article>)}</div>;
}
