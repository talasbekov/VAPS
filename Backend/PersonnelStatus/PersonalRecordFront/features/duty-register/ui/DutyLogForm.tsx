'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadFailure } from '@/components/load-failure';
import { DUTY_REGISTER_PATH, dutyRecordPath, dutyLocalInput, type DutyEmployeeChoice, type DutyRecord } from '@/entities/duty-register';
import { useDutyEmployeeChoices, useDutyKinds, useDutyRecord, useInvalidateDutyRegister } from '@/hooks/use-duty-register';
import { opsApiClient } from '@/lib/ops-api';
import { browserUuid } from '@/lib/browser-uuid';
import { friendlyOpsErrorMessage, OpsApiError, OpsConflictError } from '@/lib/ops-errors';
import { dutyInput } from './DutyRegisterFilters';
import { readPendingCreation, rememberPendingCreation, forgetPendingCreation, type PendingDutyCreation } from '../model/pending-creation';
import { DutyTemplates } from './DutyTemplates';
import type { DutyTemplateDraft } from '../model/templates';

type CreationResult = { saved: boolean; closed: boolean; record: DutyRecord | null };

export function DutyLogForm({ actor, scope, allowed, zone, defaultDate, initialDraft, record, onClose, onSaved, onSavedUnavailable }: {
  actor: string; scope: string; allowed: boolean; zone: string; defaultDate: string; initialDraft?: DutyTemplateDraft; record?: DutyRecord; onClose(): void; onSaved(row: DutyRecord): void; onSavedUnavailable(): void;
}) {
  const [initial] = useState(() => {
    try { return { attempt: record ? null : readPendingCreation(actor), error: '' }; }
    catch { return { attempt: null, error: 'Не удалось прочитать незавершённое сохранение в этом браузере. Восстановите доступ к хранилищу и откройте форму повторно.' }; }
  });
  const restored = initial.attempt?.scope === scope && initial.attempt.zone === zone ? initial.attempt : null;
  const [attempt, setAttempt] = useState<PendingDutyCreation | null>(initial.attempt);
  const [requestId, setRequestId] = useState<string | null>(() => { try { return browserUuid(); } catch { return null; } });
  const [search, setSearch] = useState('');
  const [needle, setNeedle] = useState('');
  const [page, setPage] = useState(1);
  const [person, setPerson] = useState<DutyEmployeeChoice | null>(restored?.person ?? null);
  const [kind, setKind] = useState(record?.service_duty_code ?? restored?.body.service_duty_code ?? initialDraft?.service_duty_code ?? '');
  const [start, setStart] = useState(record ? dutyLocalInput(record.planned_start, zone) : restored?.body.planned_start ?? initialDraft?.planned_start ?? '');
  const [end, setEnd] = useState(record ? dutyLocalInput(record.planned_end, zone) : restored?.body.planned_end ?? initialDraft?.planned_end ?? '');
  const [timeBase, setTimeBase] = useState({ start: record?.planned_start ?? '', end: record?.planned_end ?? '' });
  const [location, setLocation] = useState(record?.location_label ?? restored?.body.location_label ?? initialDraft?.location_label ?? '');
  const [basis, setBasis] = useState(record?.document_basis ?? restored?.body.document_basis ?? initialDraft?.document_basis ?? '');
  const [note, setNote] = useState(record?.note ?? restored?.body.note ?? initialDraft?.note ?? '');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<DutyRecord | null>(null);
  const [revision, setRevision] = useState(record?.revision ?? null);
  const [conflicted, setConflicted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [closedNotice, setClosedNotice] = useState(false);
  const lock = useRef(false);
  const active = useRef(true);
  const context = useRef({ actor, scope, zone, allowed });
  context.current = { actor, scope, zone, allowed };
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const refresh = useInvalidateDutyRegister();
  const kinds = useDutyKinds(allowed && !record, scope);
  const people = useDutyEmployeeChoices(needle, page, allowed && !record, scope);
  const current = useDutyRecord(record?.id ?? '', allowed && Boolean(record), scope);
  const latest = current.visibleData;
  useEffect(() => { const timer = setTimeout(() => { setNeedle(search); setPage(1); }, 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (people.blocked) setPerson(null); }, [people.blocked]);
  const activeKinds = kinds.visibleData?.results.filter(row => row.is_active) ?? [];
  const kindValid = Boolean(record || activeKinds.some(row => row.code === kind));
  const preserveStart = Boolean(record && start === dutyLocalInput(timeBase.start, zone));
  const preserveEnd = Boolean(record && end === dutyLocalInput(timeBase.end, zone));
  const plannedStart = preserveStart ? timeBase.start : start;
  const plannedEnd = preserveEnd ? timeBase.end : end;
  const localStart = preserveStart ? dutyLocalInput(plannedStart, zone, true) : start + ':00.000000';
  const localEnd = preserveEnd ? dutyLocalInput(plannedEnd, zone, true) : end + ':00.000000';
  const intervalValid = localEnd > localStart || (preserveStart && preserveEnd && Date.parse(plannedEnd) > Date.parse(plannedStart));
  const valid = Boolean((record || person) && kindValid && start && end && intervalValid && (!record || reason.trim()));
  const canEdit = Boolean(latest?.actions.includes('edit') && !current.isError && !current.isFetching);
  const writable = allowed && !conflicted && !initial.error && !attempt && (record ? canEdit : Boolean(requestId) && !people.isError && !kinds.isError && !people.blocked && !kinds.blocked);
  const sameAttemptContext = !attempt || (attempt.scope === scope && attempt.zone === zone);
  const isCurrentContext = () => active.current && context.current.actor === actor && context.current.scope === scope && context.current.zone === zone;
  async function finishCreation(row: DutyRecord | null, nonce: string) {
    // A late callback must not erase a newer pending draft from the same account.
    try { forgetPendingCreation(actor, nonce); } catch { /* A subsequent check can still confirm this same nonce. */ }
    if (isCurrentContext()) { setAttempt(null); setConfirmed(true); if (row) setSaved(row); }
    await refresh();
    if (isCurrentContext()) row ? onSaved(row) : onSavedUnavailable();
  }
  async function finishClosure(nonce: string) {
    // Only a durable server receipt allows another UUID, even after a lost reply.
    forgetPendingCreation(actor, nonce);
    if (!isCurrentContext()) return;
    if (!sameAttemptContext) { onClose(); return; }
    setAttempt(null); setClosedNotice(true); setError('');
    try { setRequestId(browserUuid()); } catch { setRequestId(null); }
    await refresh();
  }
  async function closeCreation() {
    if (lock.current || !attempt || !allowed || confirmed || !isCurrentContext()) return;
    lock.current = true; setPending(true); setError('');
    try {
      const nonce = attempt.body.client_request_id;
      const result = await opsApiClient.post<CreationResult>(DUTY_REGISTER_PATH + 'requests/' + nonce + '/close/', {});
      if (result.saved) await finishCreation(result.record, nonce);
      else if (result.closed) await finishClosure(nonce);
      else if (isCurrentContext()) setError('Сервер пока не подтвердил закрытие попытки. Проверьте сохранение.');
    } catch (failure) {
      if (isCurrentContext()) setError(friendlyOpsErrorMessage(failure, 'Право проверки журнала больше недоступно.'));
    } finally { lock.current = false; if (isCurrentContext()) setPending(false); }
  }
  async function recoverCreation() {
    if (lock.current || !attempt || !allowed || confirmed) return;
    lock.current = true; setPending(true); setError('');
    try {
      const result = await opsApiClient.get<CreationResult>(DUTY_REGISTER_PATH + 'requests/' + attempt.body.client_request_id + '/');
      if (result.saved) { await finishCreation(result.record, attempt.body.client_request_id); return; }
      if (result.closed) { await finishClosure(attempt.body.client_request_id); return; }
      const currentContext = context.current;
      if (!active.current || !currentContext.allowed || currentContext.actor !== actor || currentContext.scope !== scope || currentContext.zone !== zone) return;
      if (!sameAttemptContext) {
        if (active.current) setError('Исходное сохранение пока не найдено. Для повторной отправки нужен доступ к первоначальной области и её времени.');
        return;
      }
      const row = await opsApiClient.post<DutyRecord>(DUTY_REGISTER_PATH, attempt.body);
      await finishCreation(row, attempt.body.client_request_id);
    } catch (failure) {
      if (active.current) setError(friendlyOpsErrorMessage(failure, 'Право проверки или ведения журнала больше недоступно.'));
    } finally { lock.current = false; if (active.current) setPending(false); }
  }
  function acceptRevision(loadLatest: boolean) {
    if (!latest || !canEdit || lock.current) return;
    if (loadLatest) {
      setStart(dutyLocalInput(latest.planned_start, zone)); setEnd(dutyLocalInput(latest.planned_end, zone));
      setTimeBase({ start: latest.planned_start ?? '', end: latest.planned_end ?? '' });
      setLocation(latest.location_label); setBasis(latest.document_basis); setNote(latest.note);
    }
    setRevision(latest.revision); setConflicted(false); setError('');
  }
  async function save() {
    if (lock.current || !writable || !valid || saved || confirmed) return;
    lock.current = true; setPending(true); setError(''); setClosedNotice(false);
    let sent = false;
    try {
      // The minute inputs are a view of exact source timestamps. Keep untouched
      // seconds/fractions, including the original draft after a revision conflict.
      const fields = {
        planned_start: plannedStart,
        planned_end: plannedEnd,
        location_label: location.trim(), document_basis: basis.trim(), note: note.trim(),
      };
      if (!record) {
        if (!requestId) return;
        const first: PendingDutyCreation = { version: 1, scope, zone, person: person!, kindLabel: activeKinds.find(row => row.code === kind)!.label,
          body: { ...fields, employee_id: person!.employee_id, service_duty_code: kind, client_request_id: requestId } };
        try { rememberPendingCreation(actor, first); }
        catch { setError('Не удалось сохранить исходную попытку в браузере. Данные ещё не отправлены; проверьте доступ к хранилищу.'); return; }
        setAttempt(first); sent = true;
        const row = await opsApiClient.post<DutyRecord>(DUTY_REGISTER_PATH, first.body);
        await finishCreation(row, requestId); return;
      }
      const row = await opsApiClient.patch<DutyRecord>(dutyRecordPath(record.id), { ...fields, expected_revision: revision, reason: reason.trim() });
      // A successful write must not become a second POST if refreshing fails.
      if (active.current) setSaved(row);
      await refresh(); if (active.current) onSaved(row);
    } catch (failure) {
      if (active.current) setError(friendlyOpsErrorMessage(failure, 'Право ведения журнала больше недоступно.'));
      if (!record && sent && !confirmed && failure instanceof OpsApiError && [400, 401, 403, 404, 422].includes(failure.status)) {
        try { if (requestId) forgetPendingCreation(actor, requestId); } catch { /* Keep the nonce available for a later confirmation. */ }
        if (active.current) setAttempt(null);
      }
      if (record && failure instanceof OpsConflictError && failure.errorCode === 'DUTY_REGISTER_CONFLICT') {
        if (active.current) setConflicted(true);
        await current.refetch();
      }
    }
    finally { lock.current = false; if (active.current) setPending(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!pending} onEscapeKeyDown={event => { if (lock.current) event.preventDefault(); }} onPointerDownOutside={event => { if (lock.current) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>{record ? 'Исправить плановую запись' : 'Новая запись дежурства'}</DialogTitle><DialogDescription>{record ? latest ? `${latest.employee_name}. Изменения сохраняются с причиной в истории.` : 'Проверяем доступ к плановой записи.' : 'Сотрудник, вид и время для административного учёта смены.'}</DialogDescription></DialogHeader>
      {record && current.isError && <LoadFailure what="актуальную запись" onRetry={() => void current.refetch()} isRetrying={current.isFetching} />}
      {initial.error && <p role="alert" className="text-sm text-destructive">{initial.error}</p>}
      {!record && !requestId && <p role="alert" className="text-sm text-destructive">Этот браузер не может безопасно создать идентификатор записи. Откройте журнал в современном браузере.</p>}
      {attempt && <section className="space-y-2 rounded-lg border border-amber-300 p-3 text-sm" aria-label="Незавершённое сохранение">
        <p className="font-semibold">Результат сохранения не подтверждён</p>
        <p>Сначала проверим первую попытку. Если запись ещё не создана, повторим исходные данные с тем же идентификатором.</p>
        <p className="text-muted-foreground">Попытка сохранена для этой учётной записи в текущей вкладке и восстановится после обновления страницы.</p>
        {!sameAttemptContext && <p>Область доступа или часовой пояс изменились. Исходные поля скрыты; результат можно проверить.</p>}
        <p>Если исходные данные больше не подходят, закройте попытку. Сервер сначала проверит результат; созданная запись сохранится.</p>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={pending || !allowed || confirmed} onClick={() => void recoverCreation()}>{pending ? 'Проверка…' : 'Проверить сохранение'}</Button><Button type="button" variant="outline" disabled={pending || !allowed || confirmed} onClick={() => void closeCreation()}>Закрыть эту попытку</Button></div>
      </section>}
      {closedNotice && <p role="status" className="text-sm">Предыдущая попытка закрыта. Проверьте черновик и сохраните новую запись.</p>}
      {initialDraft && !record && !attempt && <p role="status" className="rounded-lg bg-muted p-3 text-sm">Плановые параметры скопированы. Выберите сотрудника и проверьте дату и время новой смены.</p>}
      {record && latest && !latest.actions.includes('edit') && <p role="alert" className="text-sm">Плановая запись больше не доступна для исправления: проверьте её состояние и права.</p>}
      {conflicted && latest && <section className="min-w-0 space-y-3 rounded-lg border border-amber-300 p-3 text-sm" aria-label="Актуальная редакция">
        <h3 className="font-semibold">Запись изменилась в другом окне</h3>
        <p>Ваш черновик сохранён. Сверьте актуальные данные перед продолжением.</p>
        <dl className="space-y-2"><div><dt className="text-muted-foreground">Актуальный план</dt><dd className="break-words">{dutyLocalInput(latest.planned_start, zone).replace('T', ' ')} — {dutyLocalInput(latest.planned_end, zone).replace('T', ' ')}</dd></div><div><dt className="text-muted-foreground">Место и основание</dt><dd className="break-words">{[latest.location_label, latest.document_basis].filter(Boolean).join(' · ') || 'Не указаны'}</dd></div><div><dt className="text-muted-foreground">Примечание актуальной записи</dt><dd className="whitespace-pre-wrap break-words">{latest.note || 'Не указано'}</dd></div></dl>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={pending || !canEdit} onClick={() => acceptRevision(true)}>Загрузить актуальную редакцию</Button><Button type="button" variant="outline" disabled={pending || !canEdit} onClick={() => acceptRevision(false)}>Продолжить с моим черновиком</Button></div>
      </section>}
      {(!record || latest) && sameAttemptContext && <>
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }} aria-busy={pending}>
        <fieldset disabled={pending || Boolean(saved) || Boolean(attempt) || confirmed} className="min-w-0 space-y-4">
          {!record && <>
            <DutyTemplates actor={actor} scope={scope} zone={zone} defaultDate={defaultDate} enabled={writable && !pending && !saved && !confirmed} kinds={activeKinds}
              draft={{ service_duty_code: kind, planned_start: start, planned_end: end, location_label: location, document_basis: basis, note }}
              onApply={value => { if (!writable || lock.current || saved || confirmed) return; setKind(value.service_duty_code); setStart(value.planned_start); setEnd(value.planned_end); setLocation(value.location_label); setBasis(value.document_basis); setNote(value.note); setError(''); }} />
            <label className="grid gap-1 text-sm">Поиск сотрудника<input type="search" maxLength={200} className={dutyInput} value={search} onChange={event => setSearch(event.target.value)} placeholder="ФИО или табельный номер" /></label>
            {people.isLoading && <p role="status" className="text-sm">Загрузка сотрудников…</p>}
            {people.isError && <LoadFailure what="варианты сотрудников" onRetry={() => void people.refetch()} isRetrying={people.isFetching} />}
            {people.visibleData && <div className="max-h-48 overflow-y-auto rounded-lg border" aria-label="Выберите сотрудника">{people.visibleData.results.map(row => <button type="button" key={row.employee_id} disabled={pending || !writable} onClick={() => setPerson(row)} aria-pressed={person?.employee_id === row.employee_id} className={`block w-full px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${person?.employee_id === row.employee_id ? 'bg-accent' : ''}`}><span className="block break-words font-medium">{row.employee_name}</span><span className="block break-words text-xs text-muted-foreground">{[row.division_name, row.position_name].filter(Boolean).join(' · ')}</span></button>)}{people.visibleData.results.length === 0 && <p className="p-3 text-sm">Действующих сотрудников по этому поиску нет.</p>}</div>}
            {people.visibleData && people.visibleData.count > 25 && <div className="flex items-center justify-between gap-2 text-sm"><Button type="button" variant="outline" size="sm" disabled={page === 1 || people.isFetching} onClick={() => setPage(value => value - 1)}>Назад</Button><span>{page} / {Math.ceil(people.visibleData.count / 25)}</span><Button type="button" variant="outline" size="sm" disabled={page * 25 >= people.visibleData.count || people.isFetching} onClick={() => setPage(value => value + 1)}>Далее</Button></div>}
            {person && !people.blocked && <p className="break-words rounded-lg bg-accent p-3 text-sm" role="status">Выбран: {person.employee_name} · {person.division_name}</p>}
            <label className="grid gap-1 text-sm">Вид дежурства<select required className={dutyInput} value={kind} disabled={!kinds.visibleData || kinds.isError} onChange={event => setKind(event.target.value)}><option value="">Выберите вид</option>{activeKinds.map(row => <option key={row.code} value={row.code}>{row.label}</option>)}</select></label>
            {attempt && <p className="text-sm">Исходный вид: {attempt.kindLabel}</p>}
            {kinds.isError && <LoadFailure what="виды дежурств" onRetry={() => void kinds.refetch()} isRetrying={kinds.isFetching} />}
            {kind && kinds.visibleData && !kindValid && <p role="alert" className="text-sm text-amber-700">Скопированный вид недоступен для новых записей. Выберите действующий вид.</p>}
          </>}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="grid min-w-0 gap-1 text-sm">Плановое начало<input type="datetime-local" required className={dutyInput} value={start} onChange={event => setStart(event.target.value)} /></label><label className="grid min-w-0 gap-1 text-sm">Плановое завершение<input type="datetime-local" required className={dutyInput} value={end} onChange={event => setEnd(event.target.value)} /></label></div>
          <p className="text-xs text-muted-foreground">Местное время: {zone}. Для ночной смены укажите следующую дату завершения.</p>
          {start && end && !intervalValid && <p role="alert" className="text-sm text-destructive">Завершение должно быть позже начала.</p>}
          <label className="grid gap-1 text-sm">Место<input maxLength={500} className={dutyInput} value={location} onChange={event => setLocation(event.target.value)} placeholder="Необязательно" /></label>
          <label className="grid gap-1 text-sm">Основание<input maxLength={500} className={dutyInput} value={basis} onChange={event => setBasis(event.target.value)} placeholder="Документ, номер или пояснение" /></label>
          <label className="grid gap-1 text-sm">Примечание<textarea maxLength={10000} rows={3} className={dutyInput} value={note} onChange={event => setNote(event.target.value)} /></label>
          {record && <label className="grid gap-1 text-sm">Причина исправления<textarea required maxLength={2000} rows={2} className={dutyInput} value={reason} onChange={event => setReason(event.target.value)} /></label>}
        </fieldset>
        {!allowed && <p role="alert" className="text-sm">Данные обновляются или право записи недоступно. Черновик сохранён в форме.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {saved && <p role="status" className="text-sm">Запись сохранена.</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Закрыть</Button>{!attempt && <Button type="submit" disabled={pending || !writable || !valid || Boolean(saved) || confirmed}>{pending ? 'Сохранение…' : record ? 'Сохранить исправление' : 'Сохранить запись'}</Button>}</div>
      </form>
      </>}
      {!sameAttemptContext && <><Button variant="outline" disabled={pending} onClick={onClose}>Закрыть</Button>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}</>}
    </DialogContent>
  </Dialog>;
}
