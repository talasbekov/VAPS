"use client";

import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import type { GeoPoint } from "@/entities/security-object";
import type { MapMarker } from "@/features/offline-map/model/geometry";
import type { useObjectMapAsset } from "../model/use-object-map-asset";

const OfflineAstanaMap = dynamic(() => import("@/features/offline-map/ui/OfflineAstanaMap"), {
  ssr: false, loading: () => <p role="status" className="p-4 text-sm text-muted-foreground">Загружаем карту…</p>,
});

export function LocalObjectMap({ asset, markers, onSelect, onPoint, locating = false, focusPoint, pointHint, fitOnce }: {
  asset: ReturnType<typeof useObjectMapAsset>;
  markers: MapMarker[];
  onSelect: (marker: MapMarker) => void;
  onPoint: (point: GeoPoint) => void;
  locating?: boolean;
  pointHint?: string;
  fitOnce?: boolean;
  focusPoint?: { key: number; location: GeoPoint } | null;
}) {
  if (asset.error) return <div role="alert" className="space-y-2 rounded-lg border p-4 text-sm">
    <p>Не удалось загрузить локальную карту. Координаты доступны ниже.</p>
    <Button type="button" size="sm" variant="outline" onClick={asset.retry}>Повторить загрузку карты</Button>
  </div>;
  if (asset.isLoading || !asset.bounds) return <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">Загружаем карту Астаны с локального сервера…</p>;
  return <OfflineAstanaMap markers={markers} onSelect={onSelect} onPoint={onPoint} locating={locating} focusPoint={focusPoint} pointHint={pointHint} fitOnce={fitOnce} />;
}
