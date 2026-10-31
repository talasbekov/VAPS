'use client';
import dynamic from 'next/dynamic';
import { Input } from '@/components/ui/input';
import type { CombatChoices, CombatLocation } from '@/entities/combat-duty';

const Map = dynamic(() => import('@/features/offline-map/ui/OfflineAstanaMap'), { ssr: false });
const selectClass = 'min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
export function CombatLocationFields({ value, onChange, choices, divisionId, multiple }: { value: CombatLocation; onChange: (v: CombatLocation) => void; choices: CombatChoices; divisionId: string; multiple: boolean }) {
  const places = choices.places.filter(p => p.divisionId === divisionId);
  const routes = choices.routes.filter(r => r.divisionId === divisionId);
  const point = value.latitude !== undefined && value.longitude !== undefined ? { latitude: value.latitude, longitude: value.longitude } : null;
  return <fieldset className="space-y-3 rounded-lg border p-4"><legend className="px-1 font-semibold">Общее место службы группы</legend>
    <label className="block space-y-1 text-sm">Тип места<select aria-label="Тип места службы" className={selectClass} value={value.kind} onChange={e => onChange({ kind: e.target.value as CombatLocation['kind'] })}>
      <option value="OBJECT">Объект</option><option value="ROUTE">Трасса</option><option value="POST">Пост</option><option value="POINT">Точка на карте</option>
    </select></label>
    {(value.kind === 'OBJECT' || value.kind === 'POST') && <label className="block space-y-1 text-sm">Объект<select aria-label="Объект места службы" required className={selectClass} value={value.objectId ?? ''} onChange={e => onChange({ kind: value.kind, objectId: e.target.value })}><option value="">Выберите объект подразделения</option>{places.map(p => <option key={p.id} value={p.objectId}>{p.name}</option>)}</select></label>}
    {value.kind === 'POST' && <label className="block space-y-1 text-sm">Пост<select aria-label="Пост места службы" required className={selectClass} value={value.postId ?? ''} onChange={e => onChange({ ...value, postId: e.target.value })}><option value="">Выберите пост объекта</option>{places.find(p => p.objectId === value.objectId)?.posts?.map(p => <option key={p.id} value={p.id}>{p.sectorName} · {p.name}</option>)}</select></label>}
    {value.kind === 'ROUTE' && <label className="block space-y-1 text-sm">Трасса{multiple && ' (можно несколько)'}<select aria-label="Трасса места службы" required multiple={multiple} className={selectClass} value={multiple ? value.routeIds ?? [] : value.routeIds?.[0] ?? ''} onChange={e => onChange({ kind: 'ROUTE', routeIds: Array.from(e.target.selectedOptions, o => o.value).filter(Boolean) })}>{!multiple && <option value="">Выберите трассу подразделения</option>}{routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
    {value.kind === 'POINT' && <><p className="text-sm text-muted-foreground">Нажмите на карту или введите координаты. Точка будет общей для всех участников.</p>
      <Map markers={point ? [{ id: 'group-point', kind: 'draft', label: 'Вся группа', location: point, selected: true }] : []} onSelect={() => {}} onPoint={p => onChange({ kind: 'POINT', ...p })} locating pointHint="Нажмите на карту или введите координаты ниже. Общая точка сохранится при подаче состава группы." />
      <div className="grid grid-cols-2 gap-3"><label className="text-sm">Широта<Input aria-label="Широта общей точки" type="number" step="any" min={-90} max={90} required value={value.latitude ?? ''} onChange={e => onChange({ ...value, latitude: e.target.value === '' ? undefined : Number(e.target.value) })} /></label><label className="text-sm">Долгота<Input aria-label="Долгота общей точки" type="number" step="any" min={-180} max={180} required value={value.longitude ?? ''} onChange={e => onChange({ ...value, longitude: e.target.value === '' ? undefined : Number(e.target.value) })} /></label></div>
    </>}
  </fieldset>;
}
