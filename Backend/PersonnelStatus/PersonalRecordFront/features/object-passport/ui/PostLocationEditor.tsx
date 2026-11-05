"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { GeoPoint, SecurityPost } from "@/entities/security-object";
import { isGeoPoint, parseLocationInputs } from "@/features/object-map/model/location";

/** A local editor only: the owning passport is the sole persistence boundary. */
export function PostLocationEditor({ post, canEdit, isActive = true, isCurrentResult, onApply }: {
  post: SecurityPost;
  canEdit: boolean;
  isActive?: boolean;
  isCurrentResult?: () => boolean;
  onApply: (location: GeoPoint | null) => void;
  onCancel: () => void;
}) {
  const point = isGeoPoint(post.location) ? post.location : null;
  const [latitude, setLatitude] = useState(point ? String(point.latitude) : "");
  const [longitude, setLongitude] = useState(point ? String(point.longitude) : "");
  const [cleared, setCleared] = useState(false);
  const context = useMemo(() => ({}), [post.id, canEdit, isActive]);
  const current = useRef({ context, isCurrentResult });
  const mounted = useRef(false);
  current.current = { context, isCurrentResult };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const allowed = () => mounted.current && current.current.context === context && canEdit && isActive && current.current.isCurrentResult?.() !== false;
  const disabled = !canEdit || !isActive || isCurrentResult?.() === false;
  const draft = cleared ? null : parseLocationInputs(latitude, longitude);

  return <details aria-label="Координаты поста вручную" className="space-y-3">
    <summary className="cursor-pointer text-sm">Координаты вручную</summary>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Широта<Input aria-label="Широта поста" type="number" inputMode="decimal" step="any" min={-90} max={90} disabled={disabled} value={latitude}
        onChange={event => { if (allowed()) { setLatitude(event.target.value); setCleared(false); } }} /></label>
      <label className="text-sm">Долгота<Input aria-label="Долгота поста" type="number" inputMode="decimal" step="any" min={-180} max={180} disabled={disabled} value={longitude}
        onChange={event => { if (allowed()) { setLongitude(event.target.value); setCleared(false); } }} /></label>
    </div>
    {!cleared && !draft && <p className="text-sm text-muted-foreground">Укажите обе координаты: широта от −90 до 90, долгота от −180 до 180.</p>}
    {cleared && <p role="status" className="text-sm text-muted-foreground">Точка будет очищена в черновике после применения.</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={disabled || (!cleared && !draft)} onClick={() => { if (allowed() && (cleared || draft)) onApply(draft); }}>Применить к черновику</Button>
      <Button type="button" variant="ghost" disabled={disabled} onClick={() => { if (allowed()) { setLatitude(""); setLongitude(""); setCleared(true); } }}>Очистить точку поста</Button>
    </div>
  </details>;
}
