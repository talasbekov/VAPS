'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadFailure } from '@/components/load-failure';
import { DUTY_SOURCE_LABELS, dutyDateTime, dutyHours, dutyRecordPath, type DutyRecord, type DutyRecordAction } from '@/entities/duty-register';
import { useDutyKinds, useDutyRecord, useInvalidateDutyRegister } from '@/hooks/use-duty-register';
import { opsApiClient } from '@/lib/ops-api';
import { friendlyOpsErrorMessage } from '@/lib/ops-errors';
import { dutyInput } from './DutyRegisterFilters';
import { DutyExecutionBadge, DutyExecutionTimeline } from './DutyExecutionTimeline';

const actionLabels: Record<DutyRecordAction, string> = { acknowledge: 'Подтвердить', start: 'Отметить начало', complete: 'Отметить завершение', cancel: 'Отменить запись', classify: 'Уточнить вид', edit: 'Исправить план' };
export function DutyRecordDialog({ id, scope, allowed, onClose, onEdit, onCopy, onSaved }: {
  id: string; scope: string; allowed: boolean; onClose(): void; onEdit(row: DutyRecord): void; onCopy?(row: DutyRecord): void; onSaved(): void;
}) {
  const query = useDutyRecord(id, allowed, scope);
  const row = query.visibleData;
  const [operation, setOperation] = useState<DutyRecordAction | null>(null);
  const [timeMode, setTimeMode] = useState('NOW');
  const [at, setAt] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const kinds = useDutyKinds(allowed && operation === 'classify', scope);
  const invalidate = useInvalidateDutyRegister();
  const writable = allowed && Boolean(row) && !query.isError && !query.isFetching;
  const serverTime = row?.execution_mode === 'SERVER_TIME';
  const isTimed = operation === 'acknowledge' || operation === 'start' || operation === 'complete';
  const needsReason = operation === 'cancel' || operation === 'classify';
  const ready = writable && operation && row?.actions.includes(operation) && (!needsReason || reason.trim())
    && (!isTimed || serverTime || timeMode === 'NOW' || at)
    && (operation !== 'classify' || (!kinds.isError && !kinds.isFetching && kinds.visibleData?.results.some(value => value.code === kind && value.is_active)));
  function choose(action: DutyRecordAction) {
    if (!row || !writable || lock.current) return;
    if (action === 'edit') { onEdit(row); return; }
    setOperation(action); setReason(''); setKind(row.service_duty_code ?? ''); setAt(''); setTimeMode('NOW'); setError(''); setNotice('');
  }
  async function save() {
    if (!ready || !operation || lock.current) return;
    lock.current = true; setPending(true); setError('');
    try {
      await opsApiClient.post<DutyRecord>(dutyRecordPath(id) + operation + '/', {
        ...(needsReason ? { reason: reason.trim() } : {}), ...(operation === 'classify' ? { service_duty_code: kind } : {}),
        ...(isTimed && !serverTime && timeMode === 'RECORDED' ? { at } : {}),
      });
      if (active.current) { setOperation(null); setNotice('Изменение сохранено.'); }
      await invalidate();
      if (active.current) onSaved();
    } catch (failure) { if (active.current) setError(friendlyOpsErrorMessage(failure, 'Право изменения этой записи недоступно.')); }
    finally { lock.current = false; if (active.current) setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl" showCloseButton={!pending} onEscapeKeyDown={event => { if (lock.current) event.preventDefault(); }} onPointerDownOutside={event => { if (lock.current) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Запись дежурства</DialogTitle><DialogDescription>{row ? `${row.employee_name} · ${row.service_duty_label}` : 'Сведения и история отметок исполнения'}</DialogDescription></DialogHeader>
      {(query.isLoading || !allowed) && <p role="status">Загрузка записи…</p>}
      {query.isError && <LoadFailure what="запись дежурства" onRetry={() => void query.refetch()} isRetrying={query.isFetching} />}
      {query.isError && row && <p className="text-sm text-muted-foreground">Показана ранее загруженная запись. Изменения доступны после успешного обновления.</p>}
      {row && <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="break-words text-sm">{row.division_name || 'Подразделение неизвестно'} · {DUTY_SOURCE_LABELS[row.source]}</p><DutyExecutionBadge row={row} now={row.generated_at ?? ''} /></div>
        <DutyExecutionTimeline row={row} now={row.generated_at ?? ''} zone={row.time_zone ?? 'Asia/Almaty'} />
        <p className="text-xs text-muted-foreground">Ознакомление подтверждает получение назначения. Фактическое заступление отмечается отдельно.</p>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2"><section className="rounded-lg border p-3"><h3 className="mb-2 font-semibold">План</h3><dl className="space-y-2 text-sm"><div><dt className="text-muted-foreground">Начало</dt><dd className="break-words">{row.planned_start ? dutyDateTime(row.planned_start, row.time_zone) : `Дата ${row.business_date}, время не указано`}</dd></div><div><dt className="text-muted-foreground">Завершение</dt><dd className="break-words">{row.planned_end ? dutyDateTime(row.planned_end, row.time_zone) : 'Время не указано'}</dd></div><div><dt className="text-muted-foreground">Часы всей записи</dt><dd>{dutyHours(row.planned_minutes)}</dd></div></dl></section><section className="rounded-lg border p-3"><h3 className="mb-2 font-semibold">Факт</h3><dl className="space-y-2 text-sm"><div><dt className="text-muted-foreground">Подтверждение</dt><dd className="break-words">{dutyDateTime(row.acknowledged_at, row.time_zone)}</dd></div><div><dt className="text-muted-foreground">Начало</dt><dd className="break-words">{dutyDateTime(row.actual_start, row.time_zone)}</dd></div><div><dt className="text-muted-foreground">Завершение</dt><dd className="break-words">{dutyDateTime(row.actual_end, row.time_zone)}</dd></div><div><dt className="text-muted-foreground">Часы всей записи</dt><dd>{dutyHours(row.actual_minutes)}</dd></div></dl></section></div>
        <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Место</dt><dd className="break-words">{row.location_label || 'Не указано'}</dd></div><div><dt className="text-muted-foreground">Основание</dt><dd className="break-words">{row.document_basis || 'Не указано'}</dd></div><div className="sm:col-span-2"><dt className="text-muted-foreground">Примечание</dt><dd className="whitespace-pre-wrap break-words">{row.note || 'Не указано'}</dd></div></dl>
        {row.state === 'CANCELLED' && <p className="rounded-lg bg-muted p-3 text-sm">Отменено: {dutyDateTime(row.cancelled_at, row.time_zone)}{row.cancelled_reason ? ` · ${row.cancelled_reason}` : ''}</p>}
        {row.planning_locked && <p className="rounded-lg bg-muted p-3 text-sm">План месяца утверждён. Для отмены смены сначала нужна новая редакция исходного плана.</p>}
        {row.state === 'COMPLETED' && row.actual_minutes == null && <p role="status" className="rounded-lg border border-amber-300 p-3 text-sm">Фактические часы неизвестны: проверьте наличие, порядок и даты обеих отметок в исходной записи.</p>}
        {!operation && <div className="flex flex-wrap gap-2">{row.actions.map(action => <Button key={action} variant={action === 'start' || action === 'complete' ? 'default' : 'outline'} disabled={!writable || pending} onClick={() => choose(action)}>{actionLabels[action]}</Button>)}{onCopy && <Button type="button" variant="outline" disabled={!writable || pending} onClick={() => { if (writable && !lock.current) onCopy(row); }}>Создать похожую</Button>}</div>}
        {operation && <form className="space-y-3 rounded-lg border p-4" aria-busy={pending} onSubmit={event => { event.preventDefault(); void save(); }}>
          <h3 className="font-semibold">{actionLabels[operation]}</h3>
          <fieldset disabled={pending} className="min-w-0 space-y-3">
            {isTimed && (serverTime ? <p className="text-sm">Отметка будет сохранена текущим временем сервера в исходном плане.</p> : <><label className="grid gap-1 text-sm">Время отметки<select className={dutyInput} value={timeMode} onChange={event => setTimeMode(event.target.value)}><option value="NOW">Сейчас — время сервера</option><option value="RECORDED">Указать фактическое время</option></select></label>{timeMode === 'RECORDED' && <label className="grid min-w-0 gap-1 text-sm">Фактическое время<input type="datetime-local" required className={dutyInput} value={at} onChange={event => setAt(event.target.value)} /></label>}</>)}
            {operation === 'classify' && <><label className="grid gap-1 text-sm">Новый вид дежурства<select required className={dutyInput} value={kind} disabled={kinds.isError || kinds.isFetching} onChange={event => setKind(event.target.value)}><option value="">Выберите вид</option>{kinds.visibleData?.results.filter(value => value.is_active).map(value => <option key={value.code} value={value.code}>{value.label}</option>)}</select></label>{kinds.isError && <LoadFailure what="виды дежурств" onRetry={() => void kinds.refetch()} isRetrying={kinds.isFetching} />}</>}
            {needsReason && <label className="grid gap-1 text-sm">Причина<textarea required rows={2} maxLength={2000} className={dutyInput} value={reason} onChange={event => setReason(event.target.value)} /></label>}
            {isTimed && <p className="text-xs text-muted-foreground">Местное время: {row.time_zone}. Отмечайте фактическое исполнение.</p>}
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={() => { setOperation(null); setError(''); }}>Назад</Button><Button type="submit" disabled={!ready || pending}>{pending ? 'Сохранение…' : operation === 'cancel' ? 'Подтвердить отмену' : 'Сохранить отметку'}</Button></div>
        </form>}
        {notice && <p role="status" className="text-sm text-emerald-700 ">{notice}</p>}
        <section className="rounded-lg border p-3"><h3 className="font-semibold">История</h3>{!row.history?.length ? <p className="mt-2 text-sm text-muted-foreground">Отдельных отметок истории пока нет.</p> : <ol className="mt-3 space-y-3">{row.history.map((item, index) => <li key={`${item.at}-${index}`} className="min-w-0 text-sm"><p className="font-medium">{item.label}</p><p className="break-words text-xs text-muted-foreground">{dutyDateTime(item.at, row.time_zone)} · {item.actor || 'Автор не указан'}</p>{item.reason && <p className="mt-1 whitespace-pre-wrap break-words">{item.reason}</p>}</li>)}</ol>}</section>
      </div>}
    </DialogContent>
  </Dialog>;
}
