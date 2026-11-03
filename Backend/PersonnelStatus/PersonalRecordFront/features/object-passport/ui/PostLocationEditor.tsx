"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GeoPoint, SecurityPost } from "@/entities/security-object";
import { isGeoPoint, isWithinMapCoverage, parseLocationInputs } from "@/features/object-map/model/location";
import { useObjectMapAsset } from "@/features/object-map/model/use-object-map-asset";
import { LocalObjectMap } from "@/features/object-map/ui/LocalObjectMap";

/** A local editor only: the owning passport is the sole persistence boundary. */
export function PostLocationEditor({ post, canEdit, isActive = true, isCurrentResult, onApply, onCancel }: {
  post: SecurityPost;
  canEdit: boolean;
  isActive?: boolean;
  isCurrentResult?: () => boolean;
  onApply: (location: GeoPoint | null) => void;
  onCancel: () => void;
}) {
  const asset = useObjectMapAsset();
  const point = isGeoPoint(post.location) ? post.location : null;
  const [latitude, setLatitude] = useState(point ? String(point.latitude) : "");
  const [longitude, setLongitude] = useState(point ? String(point.longitude) : "");
  const [cleared, setCleared] = useState(false);
  const [notice, setNotice] = useState("");
  const context = useMemo(() => ({}), [post.id, canEdit, isActive]);
  const current = useRef({ context, isCurrentResult });
  const mounted = useRef(false);
  current.current = { context, isCurrentResult };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const allowed = () => mounted.current && current.current.context === context && canEdit && isActive && current.current.isCurrentResult?.() !== false;
  const disabled = !canEdit || !isActive || isCurrentResult?.() === false;
  const draft = cleared ? null : parseLocationInputs(latitude, longitude);
  const covered = draft !== null && isWithinMapCoverage(draft, asset.bounds);
  const focusPoint = useMemo(() => point && isWithinMapCoverage(point, asset.bounds) ? { key: 0, location: point } : null,
    [post.id, asset.bounds]);

  return <section aria-label="Местоположение поста" className="mb-4 space-y-3 rounded-lg border p-4">
    <h3 className="font-semibold">Местоположение поста · {post.name || "Без названия"}</h3>
    <p className="text-xs text-muted-foreground">Нажмите на карту или введите координаты. Примените точку к черновику, затем нажмите «Сохранить паспорт».</p>
    <LocalObjectMap asset={asset} markers={covered && draft ? [{ id: post.id, kind: "draft", label: post.name || "Пост", location: draft }] : []}
      locating={!disabled} focusPoint={focusPoint} onSelect={() => {}} onPoint={next => {
        if (!allowed()) return;
        if (!isWithinMapCoverage(next, asset.bounds)) { setNotice("Точка вне покрытия локальной карты. Введите координаты вручную."); return; }
        setLatitude(next.latitude.toFixed(6)); setLongitude(next.longitude.toFixed(6)); setCleared(false); setNotice("");
      }} />
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Широта<Input aria-label="Широта поста" type="number" inputMode="decimal" step="any" min={-90} max={90} disabled={disabled} value={latitude}
        onChange={event => { if (allowed()) { setLatitude(event.target.value); setCleared(false); setNotice(""); } }} /></label>
      <label className="text-sm">Долгота<Input aria-label="Долгота поста" type="number" inputMode="decimal" step="any" min={-180} max={180} disabled={disabled} value={longitude}
        onChange={event => { if (allowed()) { setLongitude(event.target.value); setCleared(false); setNotice(""); } }} /></label>
    </div>
    {!cleared && !draft && <p className="text-sm text-muted-foreground">Укажите обе координаты: широта от −90 до 90, долгота от −180 до 180.</p>}
    {draft && asset.bounds && !covered && <p role="status" className="text-sm text-muted-foreground">Точка вне покрытия локальной карты Астаны. Координаты можно сохранить вручную.</p>}
    {cleared && <p role="status" className="text-sm text-muted-foreground">Точка будет очищена в черновике после применения.</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={disabled || (!cleared && !draft)} onClick={() => { if (allowed() && (cleared || draft)) onApply(draft); }}>Применить к черновику</Button>
      <Button type="button" variant="outline" onClick={onCancel}>Отмена</Button>
      <Button type="button" variant="ghost" disabled={disabled} onClick={() => { if (allowed()) { setLatitude(""); setLongitude(""); setCleared(true); setNotice(""); } }}>Очистить точку поста</Button>
    </div>
  </section>;
}
