'use client';

import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DutyAssignmentFields, EMPTY_DUTY_DRAFT, type DutyDraft } from '@/features/employee-status-update/ui/DutyAssignmentFields';
import { opsApiClient } from '@/lib/ops-api';
import { friendlyOpsErrorMessage } from '@/lib/ops-errors';
import { formatIsoDate } from '@/shared/lib/date';
import type { DispatchAssignment, DutyPerson } from '../model/types';
import { useDutyKinds, useDutyRegisterAccess } from '@/hooks/use-duty-register';
import { LoadFailure } from '@/components/load-failure';

export function AssignDutyDialog({ person, date, allowed, checking, onClose, onSaved, onRefresh }: {
  person: DutyPerson; date: string; allowed: boolean; checking: boolean;
  onClose(): void; onSaved(): Promise<void>; onRefresh(): Promise<void>;
}) {
  const [draft, setDraft] = useState<DutyDraft>({ ...EMPTY_DUTY_DRAFT });
  const [ready, setReady] = useState(false);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('20:00');
  const [kind, setKind] = useState('');
  const kindAccess = useDutyRegisterAccess();
  const kinds = useDutyKinds(kindAccess.allowed && allowed, kindAccess.scope);
  const activeKinds = kinds.visibleData?.results.filter(row => row.is_active) ?? [];
  const kindReady = !kind || (!kinds.isError && !kinds.isFetching && activeKinds.some(row => row.code === kind));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function save() {
    if (lock.current || !allowed || !ready || !start || !end || !kindReady) return;
    lock.current = true; setPending(true); setError('');
    try {
      await opsApiClient.post<DispatchAssignment>('/api/ops/duty-dispatch/', {
        employee_id: person.employee_id, status_id: person.status_id, business_date: date,
        start_time: start, end_time: end,
        ...(kind ? { service_duty_code: kind } : {}),
        placement: { kind: draft.dutyKind, object_id: draft.objectId,
          ...(draft.dutyKind === 'POST' ? { post_id: draft.postId } : { group_id: draft.groupId }) },
      });
      await onSaved();
      onClose();
    } catch (failure) {
      setError(friendlyOpsErrorMessage(failure, 'Право расстановки больше недоступно.'));
      await onRefresh();
    } finally { lock.current = false; setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose(); }}>
    <DialogContent className="sm:max-w-2xl" showCloseButton={!pending} onEscapeKeyDown={event => { if (lock.current) event.preventDefault(); }} onPointerDownOutside={event => { if (lock.current) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Назначить дежурство</DialogTitle><DialogDescription>{person.full_name} · {formatIsoDate(date)}</DialogDescription></DialogHeader>
      <p className="text-sm text-muted-foreground">{person.status_label} · {person.department_name} · {person.directorate_name}</p>
      <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4" aria-busy={pending}>
        <fieldset disabled={pending} className="space-y-4">
          <label className="grid min-w-0 gap-1 text-sm">Вид по справочнику<select className="w-full min-w-0 rounded-md border bg-background p-2" value={kind} disabled={kinds.isLoading || kinds.isError} onChange={event => setKind(event.target.value)}><option value="">Вид не указан</option>{activeKinds.map(row => <option key={row.code} value={row.code}>{row.label}</option>)}</select></label>
          {kinds.isError && <LoadFailure what="виды дежурств" onRetry={() => void kinds.refetch()} isRetrying={kinds.isFetching} />}
          <DutyAssignmentFields value={draft} onChange={value => { if (!lock.current) setDraft(value); }} onReadyChange={setReady} />
          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-1 text-sm">Начало смены<input type="time" required className="rounded-md border bg-background p-2" value={start} onChange={event => setStart(event.target.value)} /></label>
            <label className="grid gap-1 text-sm">Конец смены<input type="time" required className="rounded-md border bg-background p-2" value={end} onChange={event => setEnd(event.target.value)} /></label>
          </div>
          <p className="text-sm text-muted-foreground">Время местное. {end && start && end <= start ? 'Окончание — на следующий день.' : 'Начало и окончание — в выбранный день.'}</p>
        </fieldset>
        {!allowed && !checking && <p role="alert">Состав или права изменились. Назначение сейчас недоступно.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Отмена</Button><Button type="submit" disabled={pending || !allowed || !ready || !start || !end || !kindReady}>{pending ? 'Сохранение…' : 'Сохранить назначение'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

export function CancelDutyDialog({ assignment, allowed, checking, onClose, onSaved, onRefresh }: {
  assignment: DispatchAssignment; allowed: boolean; checking: boolean; onClose(): void;
  onSaved(): Promise<void>; onRefresh(): Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function save() {
    if (lock.current || !allowed || !reason.trim()) return;
    lock.current = true; setPending(true); setError('');
    try {
      await opsApiClient.post(`/api/ops/duty-dispatch/${assignment.id}/cancel/`, { reason: reason.trim() });
      await onSaved(); onClose();
    } catch (failure) { setError(friendlyOpsErrorMessage(failure, 'Право снятия назначения больше недоступно.')); await onRefresh(); }
    finally { lock.current = false; setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose(); }}>
    <DialogContent showCloseButton={!pending} onEscapeKeyDown={event => { if (lock.current) event.preventDefault(); }} onPointerDownOutside={event => { if (lock.current) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Снять назначение</DialogTitle><DialogDescription>{assignment.full_name}. Запись останется в истории; кадровый статус не изменится.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }} aria-busy={pending}>
        <label className="grid gap-1 text-sm">Причина<textarea required maxLength={1000} className="rounded-md border bg-background p-2" disabled={pending} value={reason} onChange={event => setReason(event.target.value)} /></label>
        {!allowed && !checking && <p role="alert">{assignment.execution_state === 'ACTIVE' || assignment.execution_state === 'COMPLETED' ? 'Смена уже начата или завершена. Фактические отметки доступны в журнале.' : assignment.cancelled_at ? 'Назначение уже снято.' : 'Право снятия назначения сейчас недоступно.'}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Назад</Button><Button type="submit" disabled={pending || !allowed || !reason.trim()}>{pending ? 'Сохранение…' : 'Подтвердить снятие'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
