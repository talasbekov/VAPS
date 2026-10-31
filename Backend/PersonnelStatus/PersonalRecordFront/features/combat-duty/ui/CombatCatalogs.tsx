'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CombatCatalogRow, CombatChoices } from '@/entities/combat-duty';
import { useCombatRead, useCombatRefresh } from '@/hooks/use-combat-duty';
import { opsApiClient } from '@/lib/ops-api';
const kinds = { groups: 'Группы', types: 'Виды дежурства', routes: 'Трассы', places: 'Объекты и посты' };
const field = 'min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm';
export function CombatCatalogs({ choices, divisionId }: { choices: CombatChoices; divisionId: string }) {
  const [kind, setKind] = useState<keyof typeof kinds>('groups');
  const [editing, setEditing] = useState<CombatCatalogRow | null>(null);
  const [name, setName] = useState(''); const [code, setCode] = useState(''); const [capacity, setCapacity] = useState(4);
  const [shiftKind, setShiftKind] = useState('DAY'); const [rest, setRest] = useState(false); const [multiple, setMultiple] = useState(false); const [objectId, setObjectId] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const refresh = useCombatRefresh();
  const query = useCombatRead<{ results: CombatCatalogRow[] }>('/api/ops/combat-catalogs/?' + new URLSearchParams({ kind, division_id: divisionId }));
  function ownerName(id: string) {
    const divisions = new Map(choices.divisions.map(division => [division.id, division]));
    const names: string[] = [], visited = new Set<string>();
    let division = divisions.get(id);
    while (division && !visited.has(division.id)) {
      names.unshift(division.name);
      visited.add(division.id);
      division = division.parentId ? divisions.get(division.parentId) : undefined;
    }
    return names.join(' / ') || `Подразделение №${id}`;
  }
  function reset() { setEditing(null); setName(''); setCode(''); setCapacity(4); setRest(false); setMultiple(false); setShiftKind('DAY'); setObjectId(''); setError(''); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const body = { kind, divisionId: editing?.divisionId ?? divisionId, name, code, maxMembers: capacity, shiftKind, restDayAfter: rest, supportsMultipleRoutes: multiple, objectId };
    try { if (editing) await opsApiClient.patch(`/api/ops/combat-catalogs/${editing.id}/?kind=${kind}`, body); else await opsApiClient.post('/api/ops/combat-catalogs/', body); reset(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить справочник.'); } finally { setBusy(false); }
  }
  async function active(row: CombatCatalogRow) {
    setBusy(true); setError('');
    try { await opsApiClient.patch(`/api/ops/combat-catalogs/${row.id}/?kind=${kind}`, { isActive: !row.isActive }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось изменить запись.'); } finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-lg border bg-card p-4" aria-label="Справочники боевого дежурства"><h2 className="text-lg font-semibold">Справочники подразделения</h2><p className="text-sm text-muted-foreground">Записи выбранного подразделения и подчинённых узлов. У каждой записи указан владелец. Отключение записи сохраняет историю дежурств.</p>
    <div className="flex flex-wrap gap-2">{Object.entries(kinds).map(([key, label]) => <Button type="button" key={key} variant={kind === key ? 'default' : 'outline'} onClick={() => { setKind(key as keyof typeof kinds); reset(); }}>{label}</Button>)}</div>
    {query.isError ? <p role="alert">Не удалось прочитать справочник. <button className="underline" onClick={() => void query.refetch()}>Повторить</button></p> : <ul className="divide-y">{query.data?.results.map(row => <li key={row.id} className="flex flex-wrap items-center gap-2 py-2 text-sm"><span className="min-w-0 flex-1 break-words">{row.name}{row.maxMembers ? ` · до ${row.maxMembers} чел.` : ''}{!row.isActive ? ' · отключена' : ''}<span className="block text-xs text-muted-foreground">Подразделение: {ownerName(row.divisionId)}</span></span><Button size="sm" variant="outline" disabled={busy} onClick={() => { setEditing(row); setName(row.name); setCode(row.code ?? ''); setCapacity(row.maxMembers ?? 4); setShiftKind(row.shiftKind ?? 'DAY'); setRest(row.restDayAfter ?? false); setMultiple(row.supportsMultipleRoutes ?? false); setObjectId(row.objectId ?? ''); }}>Изменить</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void active(row)}>{row.isActive ? 'Отключить' : 'Включить'}</Button></li>)}</ul>}
    <form onSubmit={save} className="space-y-3 border-t pt-4" aria-label={`Редактирование справочника: ${kinds[kind]}`}><fieldset disabled={busy || !divisionId} className="space-y-3"><h3 className="font-medium">{editing ? 'Изменить запись' : 'Новая запись'}</h3>
      <p className="text-sm text-muted-foreground">Подразделение: {ownerName(editing?.divisionId ?? divisionId)}</p>
      {kind !== 'places' ? <label className="block text-sm">Наименование<Input aria-label="Наименование записи справочника" required maxLength={kind === 'groups' ? 64 : 255} value={name} onChange={e => setName(e.target.value)} /></label> : <label className="block text-sm">Объект из действующего реестра<select className={`${field} w-full`} aria-label="Объект для справочника подразделения" required value={objectId} onChange={e => setObjectId(e.target.value)}><option value="">Выберите объект</option>{choices.objectChoices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
      {kind === 'groups' && <label className="block text-sm">Предельная численность<Input aria-label="Предельная численность группы" type="number" min={1} max={200} required value={capacity} onChange={e => setCapacity(Number(e.target.value))} /></label>}
      {(kind === 'types' || kind === 'routes') && <label className="block text-sm">Код<Input aria-label="Код записи справочника" required maxLength={50} value={code} onChange={e => setCode(e.target.value)} /></label>}
      {kind === 'types' && <><label className="block text-sm">Вид<select aria-label="Режим дежурства" className={`${field} w-full`} value={shiftKind} onChange={e => { setShiftKind(e.target.value); setRest(false); }}><option value="DAY">Дневное</option><option value="NIGHT">Ночное</option><option value="DAILY">Суточное</option></select></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={rest} disabled={shiftKind !== 'DAILY'} onChange={e => setRest(e.target.checked)} />Отдых на следующий день</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={multiple} onChange={e => setMultiple(e.target.checked)} />Несколько трасс для группы</label></>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<div className="flex gap-2"><Button type="submit">{busy ? 'Сохраняем…' : editing ? 'Сохранить изменения' : 'Добавить запись'}</Button>{editing && <Button type="button" variant="outline" onClick={reset}>Отмена изменения</Button>}</div>
    </fieldset></form>
  </section>;
}
