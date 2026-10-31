'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { COMBAT_PATH, type CombatCandidate, type CombatShift } from '@/entities/combat-duty';
import { opsApiClient } from '@/lib/ops-api';
import { useCombatRead, useCombatRefresh } from '@/hooks/use-combat-duty';

export function CombatShiftActions({ shift, canRoster = false, canReview = false, personalId, onResubmit }: { shift: CombatShift; canRoster?: boolean; canReview?: boolean; personalId?: string; onResubmit?: () => void }) {
  const [action, setAction] = useState(''); const [reason, setReason] = useState(''); const [outgoing, setOutgoing] = useState(''); const [incoming, setIncoming] = useState(''); const [remarks, setRemarks] = useState(''); const [incidents, setIncidents] = useState('');
  const [actual, setActual] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const refresh = useCombatRefresh();
  const candidateParams = new URLSearchParams({ date: shift.businessDate, division_id: shift.divisionId, shift_id: shift.id });
  const candidates = useCombatRead<{ results: CombatCandidate[] }>('/api/ops/combat-roster-candidates/?' + candidateParams, action === 'replace');
  const me = shift.members.find(m => m.employeeId === personalId && !m.isReserve);
  const executor = canReview || me?.isLeader;
  const accepted = shift.stateCode === 'ACCEPTED'; const before = accepted && ['PENDING_ACKNOWLEDGEMENT', 'READY'].includes(shift.executionState ?? '');
  const labels: Record<string, string> = { accept: 'Принять состав', return: 'Вернуть на доработку', cancel: 'Отменить группу', replace: 'Заменить участника', acknowledge: 'Ознакомлен, заступлю', 'check-in': 'Отметить заступление', handover: 'Сдать смену', complete: 'Завершить дежурство' };
  function open(name: string) { setAction(name); setError(''); setReason(''); setOutgoing(''); setIncoming(''); setRemarks(''); setIncidents(''); setActual(shift.members.filter(m => !m.isReserve).map(m => m.employeeId)); }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const endpoint = action === 'accept' || action === 'return' ? 'review' : action;
      await opsApiClient.post(`${COMBAT_PATH}${shift.id}/${endpoint}/`, { ...(action === 'accept' || action === 'return' ? { decision: action === 'accept' ? 'ACCEPT' : 'RETURN' } : {}), reason, amendmentReason: reason, outgoingEmployeeId: outgoing, incomingEmployeeId: incoming, remarks, unresolvedIncidents: incidents, actualMemberIds: actual });
      await refresh(); setAction('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие.'); } finally { setBusy(false); }
  }
  const reasonRequired = ['return', 'cancel', 'replace'].includes(action);
  return <div className="flex flex-wrap gap-2 pt-3">
    {canReview && shift.stateCode === 'SUBMITTED' && <><Button size="sm" onClick={() => open('accept')}>Принять состав</Button><Button size="sm" variant="outline" onClick={() => open('return')}>Вернуть</Button></>}
    {canRoster && shift.stateCode === 'RETURNED' && onResubmit && <Button size="sm" onClick={onResubmit}>Исправить и подать повторно</Button>}
    {canRoster && before && <Button size="sm" variant="outline" onClick={() => open('replace')}>Заменить участника</Button>}
    {accepted && shift.executionState === 'PENDING_ACKNOWLEDGEMENT' && me && !me.acknowledged && <Button size="sm" onClick={() => open('acknowledge')}>Ознакомлен, заступлю</Button>}
    {executor && shift.executionState === 'READY' && <Button size="sm" onClick={() => open('check-in')}>Отметить заступление</Button>}
    {executor && shift.executionState === 'ACTIVE' && <><Button size="sm" variant="outline" onClick={() => open('handover')}>Сдать смену</Button>{Boolean(shift.execution?.handover) && <Button size="sm" onClick={() => open('complete')}>Завершить дежурство</Button>}</>}
    {canRoster && shift.stateCode !== 'CANCELLED' && !['ACTIVE', 'COMPLETED'].includes(shift.executionState ?? '') && <Button size="sm" variant="ghost" onClick={() => open('cancel')}>Отменить группу</Button>}
    <Dialog open={Boolean(action)} onOpenChange={open => { if (!open && !busy) setAction(''); }}><DialogContent aria-describedby="combat-action-description"><DialogHeader><DialogTitle>{labels[action]} · {shift.groupName}</DialogTitle></DialogHeader><p id="combat-action-description" className="text-sm text-muted-foreground">{shift.businessDate} · {shift.location.label}</p><form onSubmit={submit}><fieldset disabled={busy} className="space-y-4">
      {reasonRequired && <label className="block text-sm">Причина<Input aria-label="Причина действия с группой" required maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label>}
      {action === 'replace' && <><label className="block text-sm">Кого заменить<select aria-label="Заменяемый участник" className="min-h-10 w-full rounded-md border p-2" required value={outgoing} onChange={e => setOutgoing(e.target.value)}><option value="">Выберите участника</option>{shift.members.map(m => <option key={m.employeeId} value={m.employeeId}>{m.employeeName}</option>)}</select></label><label className="block text-sm">Кем заменить<select aria-label="Новый участник" className="min-h-10 w-full rounded-md border p-2" required value={incoming} onChange={e => setIncoming(e.target.value)}><option value="">Выберите доступного сотрудника</option>{candidates.data?.results.filter(p => p.inService && !shift.members.some(m => m.employeeId === p.employeeId)).map(p => <option key={p.employeeId} value={p.employeeId}>{p.employeeName}</option>)}</select></label>{candidates.isError && <p role="alert">Не удалось проверить сотрудников.</p>}</>}
      {action === 'handover' && <><label className="block text-sm">Нерешённые происшествия<Input aria-label="Нерешённые происшествия" maxLength={4000} value={incidents} onChange={e => setIncidents(e.target.value)} /></label><label className="block text-sm">Замечания по сдаче<Input aria-label="Замечания по сдаче" maxLength={4000} value={remarks} onChange={e => setRemarks(e.target.value)} /></label></>}
      {action === 'complete' && <fieldset className="space-y-2"><legend className="font-medium">Фактически несли службу</legend>{shift.members.map(m => <label key={m.employeeId} className="flex gap-2 text-sm"><input type="checkbox" checked={actual.includes(m.employeeId)} onChange={e => setActual(e.target.checked ? [...actual, m.employeeId] : actual.filter(id => id !== m.employeeId))} />{m.employeeName}</label>)}</fieldset>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setAction('')}>Закрыть</Button><Button type="submit">{busy ? 'Сохраняем…' : 'Подтвердить'}</Button></div>
    </fieldset></form></DialogContent></Dialog>
  </div>;
}
