"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { GeoPoint, SecurityObject } from "@/entities/security-object";
import { buildObjectMapMarkers } from "../model/location";
import { useObjectMapAsset } from "../model/use-object-map-asset";
import { LocalObjectMap } from "./LocalObjectMap";

/** The caller supplies exactly its current registry selection. */
export function ObjectsMap({ objects, backSuffix }: { objects: SecurityObject[]; backSuffix: string }) {
  const router = useRouter();
  const asset = useObjectMapAsset();
  const { markers, missingCount, outsideCount } = useMemo(() => buildObjectMapMarkers(objects, asset.bounds), [objects, asset.bounds]);
  const [focusPoint, setFocusPoint] = useState<{ key: number; location: GeoPoint } | null>(null);
  const href = (id: string) => `/security-ops/objects/${encodeURIComponent(id)}${backSuffix}`;
  return <Card className="min-w-0">
    <CardContent className="space-y-3 p-3 sm:p-4">
      <LocalObjectMap asset={asset} markers={markers} locating={false} focusPoint={focusPoint} onPoint={() => {}}
        onSelect={marker => { if (markers.some(item => item.id === marker.id)) router.push(href(marker.id)); }} />
      {asset.bounds && <p role="status" className="text-sm text-muted-foreground">На карте: {markers.length} · Без координат: {missingCount} · Вне покрытия: {outsideCount}</p>}
      <p className="text-xs text-muted-foreground">Показаны сохранённые точки объектов текущего отбора. Нажмите метку, чтобы открыть паспорт. Объекты без точки и вне покрытия доступны в карточках и таблице.</p>
      {asset.bounds && markers.length === 0 && <p className="text-sm text-muted-foreground">В этом отборе нет точек в пределах локальной карты Астаны.</p>}
      {markers.length > 0 && <ul className="divide-y" aria-label="Объекты с точками на карте">
        {markers.map(marker => <li key={marker.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <Link href={href(marker.id)} className="min-w-0 break-words text-sm font-medium text-primary-ink hover:underline">{marker.label}</Link>
          <Button type="button" size="sm" variant="outline" aria-label={`Показать на карте: ${marker.label}`}
            onClick={() => setFocusPoint(previous => ({ key: (previous?.key ?? 0) + 1, location: marker.location }))}>Показать точку</Button>
        </li>)}
      </ul>}
    </CardContent>
  </Card>;
}
