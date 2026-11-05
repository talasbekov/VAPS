'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CombatCatalogRow } from '@/entities/combat-duty';
import { useCombatRefresh } from '@/hooks/use-combat-duty';
import { opsApiClient } from '@/lib/ops-api';

const kinds = { DAY: 'Дневное', NIGHT: 'Ночное', DAILY: 'Суточное' };

// Mounted only for a missing catalogue and an authorized catalogue manager.
// Creation and refreshing are separate: a failed refresh must not create twice.
export function CombatFirstSetup({ divisionId, kind, onCreated, onConfigure }: {
  divisionId: string; kind: 'groups' | 'types';
  onCreated: (row: CombatCatalogRow) => void; onConfigure: () => void;
}) {
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState(4);
  const [shiftKind, setShiftKind] = useState<keyof typeof kinds>('DAY');
  const [rest, setRest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCombatRefresh();
  const valid = kind === 'types' || (name.trim().length > 0 && Number.isInteger(capacity) && capacity >= 1 && capacity <= 200);

  async function save() {
    if (busy || !valid) return;
    setBusy(true); setError('');
    try {
      if (!created) {
        const row = await opsApiClient.post<CombatCatalogRow>('/api/ops/combat-catalogs/', kind === 'groups'
          ? { kind, divisionId, name: name.trim(), maxMembers: capacity }
          : { kind, divisionId, name: kinds[shiftKind], code: shiftKind, shiftKind, restDayAfter: rest });
        setCreated(true);
        onCreated(row);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить. Повторите попытку.');
    } finally { setBusy(false); }
  }

  return <fieldset disabled={busy} className="space-y-3 rounded-lg border p-4">
    <legend className="px-1 font-medium">{kind === 'groups' ? 'Создать первую группу' : 'Добавить вид дежурства'}</legend>
    {!created && (kind === 'groups' ? <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
      <label className="text-sm">Название группы<Input aria-label="Название первой группы" maxLength={64} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="text-sm">Не более человек<Input aria-label="Предельная численность первой группы" type="number" min={1} max={200} value={capacity} onChange={e => setCapacity(Number(e.target.value))} /></label>
    </div> : <div className="space-y-3">
      <label className="block text-sm">Вид дежурства<select aria-label="Первый вид дежурства" className="mt-1 min-h-10 w-full rounded-md border bg-background px-3" value={shiftKind} onChange={e => { setShiftKind(e.target.value as keyof typeof kinds); setRest(false); }}>
        {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {shiftKind === 'DAILY' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rest} onChange={e => setRest(e.target.checked)} />Отдых на следующий день</label>}
    </div>)}
    {created && <p className="text-sm" role="status">Сохранено. Обновляем список…</p>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={busy || !valid} onClick={() => void save()}>{busy ? 'Сохраняем…' : created ? 'Обновить список' : kind === 'groups' ? 'Создать группу' : 'Добавить вид'}</Button>
      {error && <Button type="button" variant="outline" onClick={onConfigure}>Открыть справочники</Button>}
    </div>
  </fieldset>;
}
