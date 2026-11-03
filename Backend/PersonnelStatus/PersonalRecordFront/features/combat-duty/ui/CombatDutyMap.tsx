'use client';
import type { CombatShift } from '@/entities/combat-duty';
import type { MapMarker } from '@/features/offline-map/model/geometry';
import { isGeoPoint, isWithinMapCoverage } from '@/features/object-map/model/location';
import { useObjectMapAsset } from '@/features/object-map/model/use-object-map-asset';
import { LocalObjectMap } from '@/features/object-map/ui/LocalObjectMap';

export function CombatDutyMap({ shifts, onSelect }: { shifts: CombatShift[]; onSelect: (id: string) => void }) {
  const asset = useObjectMapAsset();
  const markers: MapMarker[] = [];
  const unlocated: { shift: CombatShift; reason: string }[] = [];
  for (const shift of shifts) {
    if (shift.stateCode === 'CANCELLED') continue;
    const { kind, latitude, longitude } = shift.location;
    const point = { latitude, longitude };
    if (!['OBJECT', 'POST', 'POINT'].includes(kind) || !isGeoPoint(point)) {
      unlocated.push({ shift, reason: kind === 'RESERVE' ? 'резерв, без точки' : kind === 'ROUTE' ? 'трасса, точка не задана' : 'координаты в назначении не сохранены' });
    } else if (asset.bounds && !isWithinMapCoverage(point, asset.bounds)) {
      unlocated.push({ shift, reason: `вне покрытия локальной карты · ${latitude}, ${longitude}` });
    } else if (asset.bounds) {
      markers.push({ id: shift.id, kind: 'post', label: `${shift.groupName} · ${shift.location.label || 'Место службы'}`, location: point });
    } else {
      unlocated.push({ shift, reason: `координаты: ${latitude}, ${longitude} · ${asset.error ? 'карта недоступна' : 'карта загружается'}` });
    }
  }
  return <section aria-label="Карта боевого дежурства" className="space-y-3 rounded-lg border bg-card p-4">
    <h2 className="font-semibold">Карта боевого дежурства</h2>
    <p className="text-xs text-muted-foreground">Места службы на момент назначения. Нажмите метку, чтобы перейти к группе. Отменённые назначения не показаны.</p>
    <LocalObjectMap asset={asset} markers={markers} onSelect={marker => { if (markers.some(item => item.id === marker.id)) onSelect(marker.id); }} onPoint={() => {}} locating={false} />
    {unlocated.length > 0 && <div className="space-y-1 text-xs text-muted-foreground"><p>Без метки на карте:</p>
      <ul>{unlocated.map(({ shift, reason }) => <li key={shift.id}><button type="button" className="underline underline-offset-2" onClick={() => onSelect(shift.id)}>{shift.groupName}</button> · {reason}</li>)}</ul>
    </div>}
    {shifts.every(shift => shift.stateCode === 'CANCELLED') && <p className="text-sm text-muted-foreground">Нет назначений для отображения.</p>}
  </section>;
}
