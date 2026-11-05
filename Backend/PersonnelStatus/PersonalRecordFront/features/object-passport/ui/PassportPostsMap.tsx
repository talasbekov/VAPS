"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GeoPoint, ObjectSector } from "@/entities/security-object";
import { buildPostMapMarkers, isGeoPoint, isWithinMapCoverage } from "@/features/object-map/model/location";
import { useObjectMapAsset } from "@/features/object-map/model/use-object-map-asset";
import { LocalObjectMap } from "@/features/object-map/ui/LocalObjectMap";

export function PassportPostsMap({ location, sectors, canEdit, onAddPost, onSelectPost }: {
  location: GeoPoint | null;
  sectors: ObjectSector[];
  canEdit: boolean;
  onAddPost: (sectorId: string | null, point: GeoPoint) => void;
  onSelectPost: (sectorId: string, postId: string) => void;
}) {
  const asset = useObjectMapAsset();
  const [chosenSector, setChosenSector] = useState("");
  const sectorId = sectors.length === 1 ? sectors[0].id : sectors.find(s => s.id === chosenSector)?.id ?? null;
  const locating = canEdit && (sectors.length === 0 || sectorId !== null);
  const posts = buildPostMapMarkers(sectors, asset.bounds);
  return <Card className="mb-4 min-w-0" aria-label="Карта постов паспорта">
    <CardHeader><CardTitle>Карта постов паспорта</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {sectors.length > 1 && <label className="flex items-center gap-3 text-sm">Сектор
        <select aria-label="Сектор для нового поста" className="min-w-0 flex-1 rounded-md border bg-background p-2"
          value={sectorId ?? ""} disabled={!canEdit} onChange={e => setChosenSector(e.target.value)}>
          <option value="">Выберите сектор</option>
          {sectors.map((sector, index) => <option key={sector.id} value={sector.id}>{sector.name || `Сектор ${index + 1}`}</option>)}
        </select>
      </label>}
      <LocalObjectMap asset={asset} markers={[
        ...(isGeoPoint(location) && isWithinMapCoverage(location, asset.bounds) ? [{ id: "object", kind: "object" as const, label: "Объект", location }] : []), ...posts,
      ]} locating={locating} fitOnce
        pointHint="Нажмите на карту, чтобы добавить пост. Метка открывает его поля."
        onPoint={point => { if (locating && isWithinMapCoverage(point, asset.bounds)) onAddPost(sectorId, point); }}
        onSelect={marker => {
          if (!canEdit || marker.kind !== "post") return;
          const sector = sectors.find(s => s.posts.some(p => p.id === marker.id));
          if (sector) onSelectPost(sector.id, marker.id);
        }} />
    </CardContent>
  </Card>;
}
