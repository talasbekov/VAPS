"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GeoPoint, ObjectSector } from "@/entities/security-object";
import { buildPostMapMarkers, isGeoPoint, isWithinMapCoverage } from "../model/location";
import { useObjectMapAsset } from "../model/use-object-map-asset";
import { LocalObjectMap } from "./LocalObjectMap";
import { PostLocationSummary } from "./PostLocationSummary";

/** Read-only and independent of catalog mutation hooks, including in history. */
export function ObjectLocationMap({ location, sectors = [], label = "Объект", title = "Местоположение объекта", emptyMessage = "Координаты объекта не указаны." }: {
  location: GeoPoint | null;
  sectors?: ObjectSector[];
  label?: string;
  title?: string;
  emptyMessage?: string;
}) {
  const asset = useObjectMapAsset();
  const point = isGeoPoint(location) ? location : null;
  const covered = point !== null && isWithinMapCoverage(point, asset.bounds);
  const posts = buildPostMapMarkers(sectors, asset.bounds);
  const focusPoint = useMemo(() => posts.length === 0 && covered && point ? { key: 0, location: point } : null,
    [posts.length, covered, point?.latitude, point?.longitude]);
  return <Card className="mb-4 min-w-0" aria-label={title}>
    <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {point ? <p className="text-sm tabular-nums" aria-label="Сохранённые координаты объекта">Широта: {point.latitude.toFixed(6)} · Долгота: {point.longitude.toFixed(6)}</p>
        : <p className="text-sm text-muted-foreground">{emptyMessage}</p>}
      {point && asset.bounds && !covered && <p role="status" className="text-sm text-muted-foreground">Точка находится вне покрытия локальной карты Астаны. Сохранённые координаты показаны выше.</p>}
      {(point || sectors.some(sector => sector.posts.length > 0)) && <LocalObjectMap asset={asset} markers={[...(covered && point ? [{ id: "snapshot", kind: "object" as const, label, location: point }] : []), ...posts]}
        onSelect={() => {}} onPoint={() => {}} locating={false} focusPoint={focusPoint} />}
      <PostLocationSummary sectors={sectors} bounds={asset.bounds} />
    </CardContent>
  </Card>;
}
