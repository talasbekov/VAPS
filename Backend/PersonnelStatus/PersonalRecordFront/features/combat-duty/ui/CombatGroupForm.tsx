'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { COMBAT_PATH, type CombatCandidate, type CombatChoices, type CombatFormData, type CombatShift } from '@/entities/combat-duty';
import { useCombatRead, useCombatRefresh } from '@/hooks/use-combat-duty';
import { opsApiClient } from '@/lib/ops-api';
import { CombatLocationFields } from './CombatLocationFields';

const field = 'min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
export function CombatGroupForm({ date, divisionId, choices, existing, onClose }: { date: string; divisionId: string; choices: CombatChoices; existing?: CombatShift; onClose: () => void }) {
  const [draft, setDraft] = useState<CombatFormData>(() => ({ businessDate: date, groupId: existing?.groupId ?? '', dutyTypeId: existing?.dutyTypeId ?? '', members: existing?.members ?? [], location: existing?.location ?? { kind: 'OBJECT' }, eventId: existing?.event?.id ?? null, callsign: existing?.callsign ?? '', equipment: existing?.equipment ?? [], isReserve: existing?.isReserve ?? false, amendmentReason: '' }));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCombatRefresh();
  const groups = choices.groups.filter(g => g.divisionId === divisionId);
  const group = groups.find(g => g.id === draft.groupId);
  const query = new URLSearchParams({ date, division_id: divisionId, ...(existing ? { shift_id: existing.id } : {}) });
  const candidates = useCombatRead<{ results: CombatCandidate[] }>('/api/ops/combat-roster-candidates/?' + query);
  const set = <K extends keyof CombatFormData>(key: K, value: CombatFormData[K]) => setDraft(d => ({ ...d, [key]: value }));
  function toggle(person: CombatCandidate) {
    if (draft.members.some(m => m.employeeId === person.employeeId)) set('members', draft.members.filter(m => m.employeeId !== person.employeeId));
    else set('members', [...draft.members, { employeeId: person.employeeId, employeeName: person.employeeName, isLeader: draft.members.length === 0, isDriver: false, isReserve: false }]);
  }
  function role(id: string, key: 'isLeader' | 'isDriver' | 'isReserve', value: boolean) {
    set('members', draft.members.map(m => ({ ...m, [key]: m.employeeId === id ? value : key === 'isReserve' ? m[key] : false, ...(m.employeeId === id && key === 'isReserve' && value ? { isLeader: false, isDriver: false } : {}) })));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const body = { ...draft, members: draft.members.map(({ employeeId, isLeader, isDriver, isReserve }) => ({ employeeId, isLeader, isDriver, isReserve })) };
      await opsApiClient.post(existing ? `${COMBAT_PATH}${existing.id}/resubmit/` : COMBAT_PATH, body);
      await refresh(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сформировать группу.'); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="max-h-[92dvh] sm:max-w-4xl overflow-y-auto" aria-describedby="combat-form-description"><DialogHeader><DialogTitle>{existing ? 'Повторная подача группы' : 'Формирование боевой группы'}</DialogTitle></DialogHeader>
    <p id="combat-form-description" className="text-sm text-muted-foreground">На {date}. После подачи состав учитывается в расходе на эту дату. Отметка об ОМ необязательна.</p>
    <form onSubmit={submit} className="space-y-5" aria-label="Формирование боевой группы"><fieldset disabled={busy} className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">Группа<select aria-label="Группа" required disabled={Boolean(existing)} className={field} value={draft.groupId} onChange={e => set('groupId', e.target.value)}><option value="">Выберите группу</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name} · до {g.maxMembers} чел.</option>)}</select></label>
      <label className="space-y-1 text-sm">Вид дежурства<select aria-label="Вид дежурства" required className={field} value={draft.dutyTypeId} onChange={e => setDraft(d => ({ ...d, dutyTypeId: e.target.value, location: { kind: 'OBJECT' } }))}><option value="">Выберите вид</option>{choices.types.filter(t => t.divisionId === divisionId).map(t => <option key={t.id} value={t.id}>{t.name}{t.restDayAfter ? ' · отдых на следующий день' : ''}</option>)}</select></label></div>
      <fieldset className="space-y-3 rounded-lg border p-4"><legend className="px-1 font-semibold">Состав · {draft.members.length} / {group?.maxMembers ?? '—'}</legend><p className="text-sm text-muted-foreground">Назначьте одного старшего. Водитель входит в основной состав; резерв выделяется отдельно.</p>
        {draft.members.map(m => <div key={m.employeeId} className="flex flex-wrap items-center gap-3 rounded-md bg-muted/40 p-2 text-sm"><span className="min-w-40 flex-1 font-medium">{m.employeeName}</span><label className="flex items-center gap-1"><input type="radio" name="combat-leader" aria-label={`Старший: ${m.employeeName}`} checked={m.isLeader} disabled={m.isReserve} onChange={() => role(m.employeeId, 'isLeader', true)} />Старший</label><label className="flex items-center gap-1"><input type="checkbox" aria-label={`Водитель: ${m.employeeName}`} checked={m.isDriver} disabled={m.isReserve} onChange={e => role(m.employeeId, 'isDriver', e.target.checked)} />Водитель</label><label className="flex items-center gap-1"><input type="checkbox" aria-label={`Резерв: ${m.employeeName}`} checked={m.isReserve} onChange={e => role(m.employeeId, 'isReserve', e.target.checked)} />Резерв</label><Button type="button" size="sm" variant="ghost" onClick={() => set('members', draft.members.filter(p => p.employeeId !== m.employeeId))}>Убрать</Button></div>)}
        <Input aria-label="Поиск сотрудника для группы" placeholder="Найти сотрудника" value={search} onChange={e => setSearch(e.target.value)} />
        {candidates.isPending && <p role="status">Загружаем состав подразделения…</p>}{candidates.isError && <p role="alert">Не удалось проверить доступность сотрудников. <button type="button" className="underline" onClick={() => void candidates.refetch()}>Повторить</button></p>}
        <div className="max-h-56 overflow-y-auto divide-y rounded-md border">{candidates.data?.results.filter(p => !draft.members.some(m => m.employeeId === p.employeeId) && `${p.employeeName} ${p.unitName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(p => <label key={p.employeeId} className={`flex min-h-12 items-start gap-3 p-2 text-sm ${!p.inService ? 'text-muted-foreground' : ''}`}><input className="mt-1" type="checkbox" aria-label={`Добавить: ${p.employeeName}`} checked={false} disabled={!p.inService || draft.members.length >= (group?.maxMembers ?? 0)} onChange={() => toggle(p)} /><span>{p.employeeName}<span className="block text-xs text-muted-foreground">{p.unitName}{p.blockReason ? ` · ${p.blockReason}` : p.eventWarning ? ' · Уже задействован в ОМ: проверьте совместимость' : ' · В строю'}</span></span></label>)}</div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isReserve} onChange={e => set('isReserve', e.target.checked)} />Вся группа в резерве</label>
      {!draft.isReserve && <CombatLocationFields value={draft.location} onChange={v => set('location', v)} choices={choices} divisionId={divisionId} multiple={choices.types.find(t => t.id === draft.dutyTypeId)?.supportsMultipleRoutes ?? false} />}
      <label className="block space-y-1 text-sm">Охранное мероприятие · необязательно<select aria-label="Охранное мероприятие группы" className={field} value={draft.eventId ?? ''} onChange={e => set('eventId', e.target.value || null)}><option value="">Без привязки к ОМ</option>{choices.events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
      <label className="block text-sm">Позывной<Input aria-label="Позывной группы" maxLength={64} value={draft.callsign} onChange={e => set('callsign', e.target.value)} /></label>
      <fieldset className="space-y-2 rounded-lg border p-4"><legend className="px-1 font-semibold">Транспорт и техника</legend>{draft.equipment.map((item, i) => <div className="grid grid-cols-[1fr_1fr_5rem_auto] gap-2" key={i}><Input aria-label={`Наименование техники ${i + 1}`} required placeholder="Наименование" maxLength={200} value={item.label} onChange={e => set('equipment', draft.equipment.map((v, n) => n === i ? { ...v, label: e.target.value } : v))} /><select aria-label={`Категория техники ${i + 1}`} className={field} value={item.category} onChange={e => set('equipment', draft.equipment.map((v, n) => n === i ? { ...v, category: e.target.value as typeof item.category } : v))}><option value="PASSENGER">Автомобиль</option><option value="ARMORED">Бронетехника</option><option value="OTHER">Другое</option></select><Input aria-label={`Количество техники ${i + 1}`} type="number" min={1} max={500} required value={item.quantity} onChange={e => set('equipment', draft.equipment.map((v, n) => n === i ? { ...v, quantity: Number(e.target.value) } : v))} /><Button type="button" variant="ghost" aria-label={`Удалить технику ${i + 1}`} onClick={() => set('equipment', draft.equipment.filter((_, n) => n !== i))}>×</Button></div>)}<Button type="button" variant="outline" onClick={() => set('equipment', [...draft.equipment, { category: 'PASSENGER', label: '', quantity: 1 }])}>Добавить технику</Button></fieldset>
      <label className="block text-sm">Причина поправки расхода (для уже сданного дня)<Input maxLength={255} value={draft.amendmentReason} onChange={e => set('amendmentReason', e.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Закрыть</Button><Button type="submit" disabled={!candidates.data || draft.members.filter(m => m.isLeader).length !== 1 || !draft.groupId || !draft.dutyTypeId}>{busy ? 'Формируем…' : 'Подать состав и обновить расход'}</Button></div>
    </fieldset></form>
  </DialogContent></Dialog>;
}
