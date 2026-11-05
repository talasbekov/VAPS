'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { COMBAT_PATH, type CombatCandidate, type CombatChoices, type CombatFormData, type CombatShift } from '@/entities/combat-duty';
import { useCombatRead, useCombatRefresh } from '@/hooks/use-combat-duty';
import { opsApiClient } from '@/lib/ops-api';
import { CombatLocationFields } from './CombatLocationFields';
import { CombatFirstSetup } from './CombatFirstSetup';

const field = 'min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
export function CombatGroupForm({ date, divisionId, choices, existing, onClose, onConfigure, createdSelection, onCatalogCreated }: { date: string; divisionId: string; choices: CombatChoices; existing?: CombatShift; onClose: () => void; onConfigure?: () => void; createdSelection?: { groupId?: string; dutyTypeId?: string }; onCatalogCreated?: (key: 'groupId' | 'dutyTypeId', id: string) => void }) {
  const [draft, setDraft] = useState<CombatFormData>(() => ({ businessDate: date, groupId: existing?.groupId ?? createdSelection?.groupId ?? '', dutyTypeId: existing?.dutyTypeId ?? createdSelection?.dutyTypeId ?? '', members: existing?.members ?? [], location: existing?.location ?? { kind: 'OBJECT' }, eventId: existing?.event?.id ?? null, callsign: existing?.callsign ?? '', equipment: existing?.equipment ?? [], isReserve: existing?.isReserve ?? false, amendmentReason: '' }));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const refresh = useCombatRefresh();
  const groups = choices.groups.filter(g => g.divisionId === divisionId);
  const group = groups.find(g => g.id === draft.groupId);
  const types = choices.types.filter(t => t.divisionId === divisionId);
  const missingCatalog = !groups.length ? 'groups' : !types.length ? 'types' : null;
  const awaitingCreated = missingCatalog && Boolean(createdSelection?.[missingCatalog === 'groups' ? 'groupId' : 'dutyTypeId']);
  const groupReady = Boolean(group && types.some(t => t.id === draft.dutyTypeId));
  const query = new URLSearchParams({ date, division_id: divisionId, ...(existing ? { shift_id: existing.id } : {}) });
  const candidates = useCombatRead<{ results: CombatCandidate[] }>('/api/ops/combat-roster-candidates/?' + query);
  const set = <K extends keyof CombatFormData>(key: K, value: CombatFormData[K]) => setDraft(d => ({ ...d, [key]: value }));
  const membersReady = groupReady && Boolean(candidates.data) && draft.members.length > 0 && draft.members.length <= (group?.maxMembers ?? 0)
    && draft.members.filter(m => m.isLeader && !m.isReserve).length === 1;
  const place = draft.location;
  const locationReady = draft.isReserve || (place.kind === 'POINT'
    ? typeof place.latitude === 'number' && Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90 && typeof place.longitude === 'number' && Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180
    : place.kind === 'ROUTE' ? Boolean(place.routeIds?.length && place.routeIds.every(id => choices.routes.some(r => r.id === id && r.divisionId === divisionId)))
    : (place.kind === 'OBJECT' || place.kind === 'POST') && choices.places.some(p => p.divisionId === divisionId && p.objectId === place.objectId && (place.kind !== 'POST' || p.posts?.some(post => post.id === place.postId))));
  function next(event?: React.MouseEvent<HTMLButtonElement>) {
    // React can replace this control with the final submit during the click.
    // Cancel the click's native default before advancing the step.
    event?.preventDefault();
    if (step === 0 ? groupReady : membersReady) { setStep(step + 1); setError(''); }
  }
  function toggle(person: CombatCandidate) {
    if (draft.members.some(m => m.employeeId === person.employeeId)) set('members', draft.members.filter(m => m.employeeId !== person.employeeId));
    else if (person.inService && draft.members.length < (group?.maxMembers ?? 0)) set('members', [...draft.members, { employeeId: person.employeeId, employeeName: person.employeeName, isLeader: draft.members.length === 0, isDriver: false, isReserve: false }]);
  }
  function role(id: string, key: 'isLeader' | 'isDriver' | 'isReserve', value: boolean) {
    set('members', draft.members.map(m => ({ ...m, [key]: m.employeeId === id ? value : key === 'isReserve' ? m[key] : false, ...(m.employeeId === id && key === 'isReserve' && value ? { isLeader: false, isDriver: false } : {}) })));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (step < 2) { next(); return; }
    if (!membersReady || !locationReady) return;
    setError(''); setBusy(true);
    try {
      const body = { ...draft, members: draft.members.map(({ employeeId, isLeader, isDriver, isReserve }) => ({ employeeId, isLeader, isDriver, isReserve })) };
      await opsApiClient.post(existing ? `${COMBAT_PATH}${existing.id}/resubmit/` : COMBAT_PATH, body);
      await refresh(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сформировать группу.'); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-4xl" aria-describedby="combat-form-description"><DialogHeader><DialogTitle>{existing ? 'Исправить состав' : 'Назначить людей на дежурство'}</DialogTitle></DialogHeader>
    <p id="combat-form-description" className="text-sm text-muted-foreground">{date.split('-').reverse().join('.')} · {group?.name ?? 'Новая группа'}{draft.members.length > 0 ? ` · ${draft.members.length} чел.` : ''}</p>
    <ol aria-label="Шаги назначения" className="grid grid-cols-3 gap-2 border-b pb-3">{['Группа', 'Люди', 'Место'].map((title, i) => <li key={title} aria-current={step === i ? 'step' : undefined} className={`rounded-md px-3 py-2 text-sm ${step === i ? 'bg-primary text-primary-foreground font-semibold' : 'bg-muted text-muted-foreground'}`}>{i + 1}. {title}</li>)}</ol>
    <form onSubmit={submit} onInvalidCapture={event => { (event.target as HTMLInputElement).closest('details')?.setAttribute('open', ''); }} className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Формирование боевой группы"><div className="min-h-0 flex-1 overflow-y-auto p-1"><fieldset disabled={busy} className="min-w-0 space-y-4">
      {step === 0 && <>
      {missingCatalog && (awaitingCreated ? <div className="space-y-2 rounded-lg border p-4"><p role="status">Запись сохранена, но пока недоступна в списке.</p><Button type="button" variant="outline" onClick={() => void refresh()}>Обновить список</Button>{onConfigure && <Button type="button" variant="ghost" onClick={onConfigure}>Открыть справочники</Button>}</div> : onConfigure ? <CombatFirstSetup key={missingCatalog} kind={missingCatalog} divisionId={divisionId} onConfigure={onConfigure} onCreated={row => { const key = missingCatalog === 'groups' ? 'groupId' : 'dutyTypeId'; set(key, row.id); onCatalogCreated?.(key, row.id); }} /> : <div className="space-y-2 rounded-lg border p-4"><p>{missingCatalog === 'groups' ? 'В подразделении ещё нет групп.' : 'В подразделении нет видов дежурства.'}</p><p className="text-sm text-muted-foreground">Обратитесь к ответственному за справочники подразделения.</p></div>)}
      {!missingCatalog && <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1 text-sm">Группа<select aria-label="Группа" required disabled={Boolean(existing)} className={field} value={draft.groupId} onChange={e => set('groupId', e.target.value)}><option value="">Выберите группу</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name} · до {g.maxMembers} чел.</option>)}</select></label>
      <label className="space-y-1 text-sm">Вид дежурства<select aria-label="Вид дежурства" required className={field} value={draft.dutyTypeId} onChange={e => setDraft(d => ({ ...d, dutyTypeId: e.target.value, location: d.location.kind === 'ROUTE' && !types.find(t => t.id === e.target.value)?.supportsMultipleRoutes ? { ...d.location, routeIds: d.location.routeIds?.slice(0, 1) } : d.location }))}><option value="">Выберите вид</option>{types.map(t => <option key={t.id} value={t.id}>{t.name}{t.restDayAfter ? ' · отдых на следующий день' : ''}</option>)}</select></label></div>}
      </>}
      {step === 1 && <fieldset className="space-y-3 rounded-lg border p-4"><legend className="px-1 font-semibold">Выбрано {draft.members.length} из {group?.maxMembers ?? '—'}</legend><p className="text-sm text-muted-foreground">В группе должен быть один старший</p>
        {draft.members.length > (group?.maxMembers ?? 0) && <p role="alert" className="text-sm text-destructive">Уберите лишних участников: группа вмещает {group?.maxMembers} чел.</p>}
        {draft.members.length > 0 && !draft.members.some(m => m.isLeader) && <p role="alert" className="text-sm text-destructive">Выберите старшего группы.</p>}
        {draft.members.map(m => <div key={m.employeeId} className="flex flex-wrap items-center gap-3 rounded-md bg-muted/40 p-2 text-sm"><span className="min-w-40 flex-1 font-medium">{m.employeeName}</span><label className="flex items-center gap-1"><input type="radio" name="combat-leader" aria-label={`Старший: ${m.employeeName}`} checked={m.isLeader} disabled={m.isReserve} onChange={() => role(m.employeeId, 'isLeader', true)} />Старший</label><label className="flex items-center gap-1"><input type="checkbox" aria-label={`Водитель: ${m.employeeName}`} checked={m.isDriver} disabled={m.isReserve} onChange={e => role(m.employeeId, 'isDriver', e.target.checked)} />Водитель</label><label className="flex items-center gap-1"><input type="checkbox" aria-label={`Резерв: ${m.employeeName}`} checked={m.isReserve} onChange={e => role(m.employeeId, 'isReserve', e.target.checked)} />Резерв</label><Button type="button" size="sm" variant="ghost" onClick={() => set('members', draft.members.filter(p => p.employeeId !== m.employeeId))}>Убрать</Button></div>)}
        <Input aria-label="Поиск сотрудника для группы" placeholder="Найти сотрудника" value={search} onChange={e => setSearch(e.target.value)} />
        {candidates.isPending && <p role="status">Загружаем состав подразделения…</p>}
        {draft.members.length >= (group?.maxMembers ?? 0) && <p role="status" className="text-sm text-muted-foreground">Группа заполнена. Для замены уберите участника.</p>}
        <div className="max-h-56 overflow-y-auto divide-y rounded-md border">{candidates.data?.results.filter(p => `${p.employeeName} ${p.unitName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(p => { const checked = draft.members.some(m => m.employeeId === p.employeeId); return <label key={p.employeeId} className={`flex min-h-12 items-start gap-3 p-3 text-sm ${checked ? 'bg-primary/5' : !p.inService ? 'text-muted-foreground' : ''}`}><input className="mt-1" type="checkbox" aria-label={`Добавить: ${p.employeeName}`} checked={checked} disabled={!checked && (!p.inService || draft.members.length >= (group?.maxMembers ?? 0))} onChange={() => toggle(p)} /><span>{p.employeeName}<span className="block text-xs text-muted-foreground">{p.unitName}{p.blockReason ? ` · ${p.blockReason}` : p.eventWarning ? ' · Уже задействован в ОМ: проверьте совместимость' : ' · В строю'}</span></span></label>; })}</div>
      </fieldset>}
      {step === 2 && <>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isReserve} onChange={e => set('isReserve', e.target.checked)} />Вся группа в резерве</label>
      {!draft.isReserve && <CombatLocationFields value={draft.location} onChange={v => set('location', v)} choices={choices} divisionId={divisionId} multiple={choices.types.find(t => t.id === draft.dutyTypeId)?.supportsMultipleRoutes ?? false} />}
      <label className="block space-y-1 text-sm">Охранное мероприятие · необязательно<select aria-label="Охранное мероприятие группы" className={field} value={draft.eventId ?? ''} onChange={e => set('eventId', e.target.value || null)}><option value="">Без привязки к ОМ</option>{choices.events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
      <details className="rounded-lg border p-3" open={draft.equipment.length > 0 || undefined}><summary className="cursor-pointer font-medium">Позывной и техника</summary><div className="mt-3 space-y-3"><label className="block text-sm">Позывной<Input aria-label="Позывной группы" maxLength={64} value={draft.callsign} onChange={e => set('callsign', e.target.value)} /></label>
      <fieldset className="space-y-2 rounded-lg border p-4"><legend className="px-1 font-semibold">Транспорт и техника</legend>{draft.equipment.map((item, i) => <div className="grid grid-cols-[1fr_1fr_5rem_auto] gap-2" key={i}><Input aria-label={`Наименование техники ${i + 1}`} required placeholder="Наименование" maxLength={200} value={item.label} onChange={e => set('equipment', draft.equipment.map((v, n) => n === i ? { ...v, label: e.target.value } : v))} /><select aria-label={`Категория техники ${i + 1}`} className={field} value={item.category} onChange={e => set('equipment', draft.equipment.map((v, n) => n === i ? { ...v, category: e.target.value as typeof item.category } : v))}><option value="PASSENGER">Автомобиль</option><option value="ARMORED">Бронетехника</option><option value="OTHER">Другое</option></select><Input aria-label={`Количество техники ${i + 1}`} type="number" min={1} max={500} required value={item.quantity} onChange={e => set('equipment', draft.equipment.map((v, n) => n === i ? { ...v, quantity: Number(e.target.value) } : v))} /><Button type="button" variant="ghost" aria-label={`Удалить технику ${i + 1}`} onClick={() => set('equipment', draft.equipment.filter((_, n) => n !== i))}>×</Button></div>)}<Button type="button" variant="outline" onClick={() => set('equipment', [...draft.equipment, { category: 'PASSENGER', label: '', quantity: 1 }])}>Добавить технику</Button></fieldset>
      </div></details>
      <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">Поправка сданного дня</summary><label className="mt-3 block text-sm">Причина поправки расхода<Input maxLength={255} value={draft.amendmentReason} onChange={e => set('amendmentReason', e.target.value)} /></label></details>
      </>}
    </fieldset></div>
      <div className="mt-4 shrink-0 space-y-3 border-t bg-background pt-4">
        {candidates.isError && <p role="alert" className="text-sm text-destructive">Не удалось проверить сотрудников. <button type="button" className="underline" disabled={busy} onClick={() => void candidates.refetch()}>Повторить</button></p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {step === 2 && <p className="text-xs text-muted-foreground">После отправки состав учитывается в расходе. Возврат или отмена снимает назначение.</p>}
        <div className="flex justify-between gap-3"><Button type="button" variant="outline" disabled={busy} onClick={() => step > 0 ? setStep(step - 1) : onClose()}>{step > 0 ? 'Назад' : 'Отмена'}</Button>{step === 0 && missingCatalog ? null : step < 2 ? <Button type="button" disabled={busy || !(step === 0 ? groupReady : membersReady)} onClick={next}>{step === 0 ? 'Далее: люди' : 'Далее: место'}</Button> : <Button type="submit" disabled={busy || !membersReady || !locationReady}>{busy ? 'Отправляем…' : 'Отправить состав'}</Button>}</div>
      </div>
    </form>
  </DialogContent></Dialog>;
}
