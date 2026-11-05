"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GeoPoint, ObjectSector } from "@/entities/security-object";
import { buildPostMapMarkers, isGeoPoint, isWithinMapCoverage } from "@/features/object-map/model/location";
import { useObjectMapAsset } from "@/features/object-map/model/use-object-map-asset";
import { LocalObjectMap } from "@/features/object-map/ui/LocalObjectMap";

export function PassportPostsMap({ location, sectors, canEdit, onAddPost, onSelectPost, selectedPost = null, onPlacePost, onCancelPlacement, children }: {
  location: GeoPoint | null;
  sectors: ObjectSector[];
  canEdit: boolean;
  onAddPost: (sectorId: string | null, point: GeoPoint) => void;
  onSelectPost: (sectorId: string, postId: string) => void;
  selectedPost?: { sectorId: string; postId: string; name: string; location?: GeoPoint | null } | null;
  onPlacePost?: (point: GeoPoint) => void;
  onCancelPlacement?: () => void;
  children?: ReactNode;
}) {
  const asset = useObjectMapAsset();
  const [chosenSector, setChosenSector] = useState("");
  const sectorId = sectors.length === 1 ? sectors[0].id : sectors.find(s => s.id === chosenSector)?.id ?? null;
  const locating = canEdit && (selectedPost !== null || sectors.length === 0 || sectorId !== null);
  const focusPoint = useMemo(() => selectedPost && isGeoPoint(selectedPost.location) && isWithinMapCoverage(selectedPost.location, asset.bounds)
    ? { key: 0, location: selectedPost.location } : null,
    [selectedPost?.sectorId, selectedPost?.postId, selectedPost?.location?.latitude, selectedPost?.location?.longitude, asset.bounds]);
  const posts = buildPostMapMarkers(sectors, asset.bounds);
  return <Card className="mb-4 min-w-0" aria-label="Карта постов паспорта">
    <CardHeader><CardTitle>Карта постов паспорта</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {selectedPost ? <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-sm">Укажите место: <strong>{selectedPost.name || "Пост без названия"}</strong></p>
        <Button type="button" variant="outline" size="sm" onClick={onCancelPlacement}>Отмена</Button>
      </div> : sectors.length > 1 && <label className="flex items-center gap-3 text-sm">Сектор
        <select aria-label="Сектор для нового поста" className="min-w-0 flex-1 rounded-md border bg-background p-2"
          value={sectorId ?? ""} disabled={!canEdit} onChange={e => setChosenSector(e.target.value)}>
          <option value="">Выберите сектор</option>
          {sectors.map((sector, index) => <option key={sector.id} value={sector.id}>{sector.name || `Сектор ${index + 1}`}</option>)}
        </select>
      </label>}
      <LocalObjectMap asset={asset} markers={[
        ...(isGeoPoint(location) && isWithinMapCoverage(location, asset.bounds) ? [{ id: "object", kind: "object" as const, label: "Объект", location }] : []),
        ...posts.map(post => ({ ...post, selected: post.id === selectedPost?.postId })),
      ]} locating={locating} fitOnce focusPoint={focusPoint}
        pointHint={selectedPost ? "Нажмите новое место для выбранного поста." : "Нажмите на карту, чтобы добавить пост. Выберите метку, чтобы переставить пост."}
        onPoint={point => {
          if (!locating || !isWithinMapCoverage(point, asset.bounds)) return;
          if (selectedPost) onPlacePost?.(point);
          else onAddPost(sectorId, point);
        }}
        onSelect={marker => {
          if (!canEdit || marker.kind !== "post") return;
          const sector = sectors.find(s => s.posts.some(p => p.id === marker.id));
          if (sector) onSelectPost(sector.id, marker.id);
        }} />
      {children}
    </CardContent>
  </Card>;
}
