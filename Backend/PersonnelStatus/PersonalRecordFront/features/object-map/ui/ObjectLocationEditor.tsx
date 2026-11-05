"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateObjectLocation } from "@/hooks/use-security-objects";
import type { GeoPoint, ObjectSector } from "@/entities/security-object";
import type { MapMarker } from "@/features/offline-map/model/geometry";
import { buildPostMapMarkers, isGeoPoint, isWithinMapCoverage, parseLocationInputs } from "../model/location";
import { useObjectMapAsset } from "../model/use-object-map-asset";
import { LocalObjectMap } from "./LocalObjectMap";
import { PostLocationSummary } from "./PostLocationSummary";

export function ObjectLocationEditor({ objectId, label, location, sectors = [], canEdit, isActive = true, isCurrentResult }: {
  objectId: string;
  label: string;
  location: GeoPoint | null;
  sectors?: ObjectSector[];
  canEdit: boolean;
  isActive?: boolean;
  isCurrentResult?: () => boolean;
}) {
  const asset = useObjectMapAsset();
  const point = isGeoPoint(location) ? location : null;
  const [editing, setEditing] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [cleared, setCleared] = useState(false);
  const [base, setBase] = useState("null");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(false);
  const context = useMemo(() => ({}), [objectId, canEdit, isActive]);
  const current = useRef(context);
  const mounted = useRef(false);
  current.current = context;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isCurrent = () => mounted.current && current.current === context && canEdit && isActive && isCurrentResult?.() !== false;
  const mutation = useUpdateObjectLocation(objectId, () => { setEditing(false); setSaved(true); setNotice(""); }, isCurrent);
  const draft = cleared ? null : parseLocationInputs(latitude, longitude);
  const draftValid = cleared || draft !== null;
  const dirty = draftValid && JSON.stringify(draft) !== base;
  const disabled = !canEdit || !isActive || mutation.isPending;
  const covered = point !== null && isWithinMapCoverage(point, asset.bounds);
  const draftCovered = editing && draft !== null && isWithinMapCoverage(draft, asset.bounds);
  const displayed = editing ? draft : point;
  const outside = displayed !== null && asset.bounds !== null && !isWithinMapCoverage(displayed, asset.bounds);
  const markers: MapMarker[] = editing
    ? draftCovered && draft ? [{ id: objectId, kind: "draft", label: "Несохранённая точка объекта", location: draft }] : []
    : covered && point ? [{ id: objectId, kind: "object", label, location: point }] : [];
  const posts = buildPostMapMarkers(sectors, asset.bounds);
  markers.push(...posts);
  const hasCoordinates = point !== null || sectors.some(sector => sector.posts.some(post => isGeoPoint(post.location)));
  const showMap = editing || markers.length > 0 || (hasCoordinates && !asset.bounds);
  // Refetches may update the saved point, but never replace a user's fields.
  const focusPoint = useMemo(() => !editing && posts.length === 0 && covered && point ? { key: 0, location: point } : null,
    [editing, posts.length, covered, point?.latitude, point?.longitude]);

  function start() {
    if (disabled || !isCurrent()) return;
    setLatitude(point ? String(point.latitude) : "");
    setLongitude(point ? String(point.longitude) : "");
    setCleared(false); setBase(JSON.stringify(point)); setNotice(""); setSaved(false); mutation.reset(); setEditing(true);
  }
  function choose(next: GeoPoint) {
    if (!editing || disabled || !isCurrent()) return;
    if (!isWithinMapCoverage(next, asset.bounds)) {
      setNotice("Выбранная точка вне покрытия локальной карты. Выберите точку внутри карты или введите координаты вручную.");
      return;
    }
    setLatitude(next.latitude.toFixed(6)); setLongitude(next.longitude.toFixed(6)); setCleared(false); setNotice("");
  }
  function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || disabled || !isCurrent() || !draftValid || !dirty) return;
    mutation.mutate({ location: draft });
  }

  return <Card className="mb-4 min-w-0" aria-label="Местоположение объекта">
    <CardHeader><CardTitle>Местоположение объекта</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {point ? <p className="text-sm tabular-nums" aria-label="Сохранённые координаты объекта">Широта: {point.latitude.toFixed(6)} · Долгота: {point.longitude.toFixed(6)}</p>
        : <p className="text-sm text-muted-foreground">Координаты объекта не указаны.</p>}
      {showMap && <LocalObjectMap asset={asset} markers={markers} onSelect={() => {}} onPoint={choose}
        locating={editing && !disabled} focusPoint={focusPoint} />}
      <PostLocationSummary sectors={sectors} bounds={asset.bounds} />
      {outside && <p role="status" className="text-sm text-muted-foreground">Точка находится вне покрытия локальной карты Астаны. Корректные координаты можно сохранить вручную; метка на этой карте не отображается.</p>}
      {!editing && canEdit && <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={start}>
        {point ? "Изменить местоположение" : "Указать местоположение"}
      </Button>}
      {editing && <form onSubmit={save} className="space-y-3" aria-label="Редактирование местоположения объекта">
        <p className="text-xs text-muted-foreground">Нажмите на карту или введите широту от −90 до 90 и долготу от −180 до 180. Изменения сохраняются только кнопкой «Сохранить точку».</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium">Широта<Input aria-label="Широта объекта" type="number" inputMode="decimal" step="any" min="-90" max="90" value={latitude} disabled={disabled}
            onChange={event => { if (!disabled) { setLatitude(event.target.value); setCleared(false); setNotice(""); } }} /></label>
          <label className="text-xs font-medium">Долгота<Input aria-label="Долгота объекта" type="number" inputMode="decimal" step="any" min="-180" max="180" value={longitude} disabled={disabled}
            onChange={event => { if (!disabled) { setLongitude(event.target.value); setCleared(false); setNotice(""); } }} /></label>
        </div>
        {!draftValid && (latitude !== "" || longitude !== "") && <p className="text-sm text-destructive">Введите обе координаты в допустимом диапазоне.</p>}
        {cleared && <p role="status" className="text-sm text-muted-foreground">Точка будет удалена после сохранения.</p>}
        {JSON.stringify(point) !== base && <p role="status" className="text-sm text-muted-foreground">Сохранённая точка обновилась на сервере. Ваш ввод сохранён; проверьте координаты перед сохранением.</p>}
        {notice && <p role="alert" className="text-sm text-destructive">{notice}</p>}
        {mutation.error && <p role="alert" className="text-sm text-destructive">Не удалось сохранить точку. Введённые координаты сохранены; проверьте доступ к объекту и повторите.</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={disabled || !draftValid || !dirty}>{mutation.isPending ? "Сохраняем точку…" : "Сохранить точку"}</Button>
          <Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={() => { if (!mutation.isPending) { setEditing(false); setNotice(""); mutation.reset(); } }}>Отмена</Button>
          <Button type="button" size="sm" variant="ghost" disabled={disabled || (point === null && latitude === "" && longitude === "")} onClick={() => {
            if (!disabled && isCurrent()) { setLatitude(""); setLongitude(""); setCleared(true); setNotice(""); }
          }}>Очистить точку</Button>
        </div>
      </form>}
      {saved && !editing && <p role="status" className="text-sm text-muted-foreground">Местоположение сохранено.</p>}
    </CardContent>
  </Card>;
}
