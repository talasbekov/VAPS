"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildMapSearchIndex, searchMapPlaces, project, unproject, type GeoPoint, type MapMarker, type MapFeature, type MapSearchPlace } from '../model/geometry';
import { loadAstanaMapAsset, peekAstanaMapAsset, type AstanaMapAsset } from '../model/asset';
import { zoomMapAt } from '../model/viewport';

type Feature = MapFeature;
const roadWidths: Record<string, number> = { trunk: 4, primary: 3.5, secondary: 2.6, road: 1.6, path: 0.7, rail: 1, river: 2 };
const fills: Record<string, string> = { green: '#dceacb', water: '#aad4ec', building: '#d8d4cd' };
const order = ['green', 'water', 'building', 'rail', 'path', 'road', 'secondary', 'primary', 'trunk', 'river'];

export default function OfflineAstanaMap({ markers, onSelect, onPoint, locating, focusPoint, fitViewport = false }: { markers: MapMarker[]; onSelect: (marker: MapMarker) => void; onPoint: (point: GeoPoint) => void; locating: boolean; focusPoint?: { key: number; location: GeoPoint } | null; fitViewport?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; center: [number, number]; moved: boolean } | null>(null);
  const wheelTime = useRef(0);
  const [size, setSize] = useState({ width: 0, height: 440 });
  const [asset, setAsset] = useState<AstanaMapAsset | null>(peekAstanaMapAsset);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [center, setCenter] = useState<[number, number]>(project({ latitude: 51.1282804, longitude: 71.4304708 }));
  const [zoom, setZoom] = useState(13);
  const [search, setSearch] = useState('');
  const [shownPlace, setShownPlace] = useState<MapSearchPlace | null>(null);
  const searchIndex = useMemo(() => asset ? buildMapSearchIndex(asset.geometry) : [], [asset]);
  const searchResults = useMemo(() => searchMapPlaces(searchIndex, search), [searchIndex, search]);
  const scale = 2 ** (zoom - 16);
  const metersPerPixel = 2 * Math.PI * 6378137 * Math.cos(unproject(center[0], center[1]).latitude * Math.PI / 180) / (256 * 2 ** zoom);
  const scaleMeters = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5].find(distance => distance <= metersPerPixel * 100) || 5;
  const scaleLabel = scaleMeters >= 1000 ? `${scaleMeters / 1000} км` : `${scaleMeters} м`;
  const groups = useMemo(() => {
    const result = new Map<string, Feature[]>();
    for (const feature of asset?.geometry.features || []) {
      const group = result.get(feature.kind) || [];
      group.push(feature); result.set(feature.kind, group);
    }
    return result;
  }, [asset]);
  const placedMarkers = useMemo(() => {
    const placed: { marker: MapMarker; actualX: number; actualY: number; x: number; y: number }[] = [];
    for (const marker of markers) {
      const p = project(marker.location), actualX = (p[0] - center[0]) * scale + size.width / 2, actualY = (p[1] - center[1]) * scale + size.height / 2;
      if (actualX < 0 || actualY < 0 || actualX > size.width || actualY > size.height) continue;
      let x = actualX, y = actualY;
      for (let attempt = 0; attempt < 48; attempt++) {
        if (!placed.some(item => Math.abs(item.x - x) < 40 && Math.abs(item.y - y) < 40)) break;
        const angle = (attempt % 8) * Math.PI / 4, radius = 44 * (Math.floor(attempt / 8) + 1);
        x = Math.max(20, Math.min(size.width - 20, actualX + Math.cos(angle) * radius));
        y = Math.max(20, Math.min(size.height - 20, actualY + Math.sin(angle) * radius));
      }
      placed.push({ marker, actualX, actualY, x, y });
    }
    return placed;
  }, [center, markers, scale, size]);
  useEffect(() => {
    let active = true;
    setError(false);
    loadAstanaMapAsset().then(next => { if (active) setAsset(next); })
      .catch(() => { if (active) setError(true); });
    // Closing one map must not cancel the shared public load for its next mount.
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    const target = box.current;
    if (!target) return;
    const observer = new ResizeObserver(entries => setSize({ width: Math.round(entries[0].contentRect.width), height: Math.round(entries[0].contentRect.height) }));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!fitViewport) return;
    const surface = box.current?.closest<HTMLElement>('[data-slot="offline-map-surface"]');
    if (!surface) return;
    const reveal = () => surface.scrollIntoView({ block: 'start', behavior: 'instant' });
    let frame = requestAnimationFrame(reveal);
    const resized = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement;
        const tools = surface.parentElement;
        const pointForm = tools?.querySelector<HTMLFormElement>(':scope > form');
        const formBounds = pointForm?.getBoundingClientRect();
        if ((focused && tools?.contains(focused) && !surface.contains(focused)) ||
            (formBounds && formBounds.top < innerHeight - 48 && formBounds.bottom > 0)) return;
        const bounds = surface.getBoundingClientRect();
        // Keep an already-visible map aligned, without pulling focus away from
        // tools or the coordinate form when the user has scrolled to them.
        if (bounds.top < innerHeight * .65 && bounds.bottom > innerHeight * .35) reveal();
      });
    };
    window.addEventListener('resize', resized);
    window.visualViewport?.addEventListener('resize', resized);
    // Dynamic viewport units may settle after the window resize event.
    // Observe the surface too so the final layout remains aligned.
    let initialSize = true;
    const observer = new ResizeObserver(() => {
      if (initialSize) { initialSize = false; return; }
      resized();
    });
    observer.observe(surface);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resized);
      window.visualViewport?.removeEventListener('resize', resized);
    };
  }, [fitViewport]);
  useEffect(() => {
    if (!focusPoint) return;
    setCenter(project(focusPoint.location));
    setZoom(current => Math.max(15, current));
  }, [focusPoint]);
  useEffect(() => {
    const target = box.current;
    if (!target || !asset) return;
    function wheel(event: WheelEvent) {
      if (!event.deltaY || drag.current) return;
      event.preventDefault();
      const now = performance.now();
      if (now - wheelTime.current < 120) return;
      wheelTime.current = now;
      const rect = target!.getBoundingClientRect();
      const next = zoomMapAt({ center, zoom }, event.deltaY < 0 ? 1 : -1,
        [event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2]);
      move(next.center); setZoom(next.zoom);
    }
    target.addEventListener('wheel', wheel, { passive: false });
    return () => target.removeEventListener('wheel', wheel);
  }, [asset, center, zoom]);
  useEffect(() => {
    if (!asset || !canvas.current || !size.width) return;
    const frame = requestAnimationFrame(() => {
      const element = canvas.current;
      if (!element) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(size.width * dpr), height = Math.round(size.height * dpr);
      // Assigning an unchanged dimension still resets the canvas context.
      if (element.width !== width) element.width = width;
      if (element.height !== height) element.height = height;
      // Prefer a software backing for the many vector paths: Chrome's GPU
      // cache retained hundreds of MB after closing this map in our control.
      const ctx = element.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.fillStyle = '#f5f2ea'; ctx.fillRect(0, 0, size.width, size.height);
      const left = center[0] - size.width / 2 / scale, top = center[1] - size.height / 2 / scale;
      const right = left + size.width / scale, bottom = top + size.height / scale;
      const visible = new Map<string, Feature[]>();
      for (const [kind, features] of groups) {
        if ((zoom < 14 && ['building', 'path'].includes(kind)) || (zoom <= 12 && ['road', 'rail'].includes(kind))) continue;
        const group: Feature[] = [];
        for (const feature of features) {
          const b = feature.bounds;
          if (b[2] < left || b[0] > right || b[3] < top || b[1] > bottom) continue;
          if (fills[kind] && (b[2] - b[0]) * (b[3] - b[1]) * scale * scale < (zoom <= 12 ? 12 : 2)) continue;
          group.push(feature);
        }
        visible.set(kind, group);
      }
      const coords = asset.geometry.coordinates;
      for (const kind of order) {
        const group = visible.get(kind) || [];
        if (!group.length) continue;
        const polygon = Boolean(fills[kind]);
        ctx.lineWidth = (roadWidths[kind] || 1) * Math.max(0.65, 2 ** ((zoom - 14) / 3));
        ctx.strokeStyle = kind === 'river' ? '#aad4ec' : kind === 'rail' ? '#b7aaa4' : kind === 'path' ? '#ded5c5' : '#ffffff';
        ctx.fillStyle = fills[kind] || '#ffffff'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        for (const feature of group) {
          ctx.beginPath();
          feature.nodes.forEach((node, index) => {
            const x = (coords[node * 2] - left) * scale, y = (coords[node * 2 + 1] - top) * scale;
            if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          if (polygon) { ctx.closePath(); ctx.fill(); } else ctx.stroke();
        }
      }
      const occupied = new Set<string>();
      const namedRoads = new Set<string>();
      ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = (x: number, y: number, text: string, strong = false) => {
        if (x < 60 || x > size.width - 60 || y < 35 || y > size.height - 35) return false;
        const key = `${Math.floor(x / 150)}:${Math.floor(y / 45)}`;
        if (occupied.has(key)) return false;
        occupied.add(key); ctx.font = `${strong ? '600 13' : '11'}px system-ui`; ctx.lineWidth = 3;
        ctx.strokeStyle = '#f5f2ea'; ctx.strokeText(text, x, y); ctx.fillStyle = strong ? '#576253' : '#64717b'; ctx.fillText(text, x, y);
        return true;
      };
      for (const place of asset.geometry.labels) label((place.x - left) * scale, (place.y - top) * scale, place.name, true);
      for (const kind of ['primary', 'secondary', ...(zoom >= 15 ? ['road'] : [])]) for (const feature of visible.get(kind) || []) {
        if (!feature.name || feature.nodes.length < 2 || namedRoads.has(feature.name)) continue;
        const node = feature.nodes[Math.floor(feature.nodes.length / 2)];
        if (label((coords[node * 2] - left) * scale, (coords[node * 2 + 1] - top) * scale, feature.name)) namedRoads.add(feature.name);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [asset, groups, center, scale, size, zoom]);
  const changeZoom = (delta: number) => setZoom(value => Math.max(11, Math.min(18, value + delta)));
  function move(next: [number, number]) {
    const bounds = asset?.manifest.bounds;
    if (!bounds) return;
    const nw = project({ latitude: bounds.north, longitude: bounds.west });
    const se = project({ latitude: bounds.south, longitude: bounds.east });
    setCenter([Math.max(nw[0], Math.min(se[0], next[0])), Math.max(nw[1], Math.min(se[1], next[1]))]);
  }
  function fit() {
    const points = markers.filter(m => m.kind !== 'draft').map(m => project(m.location));
    if (!points.length) { setCenter(project(asset?.manifest.center || { latitude: 51.1282804, longitude: 71.4304708 })); setZoom(13); return; }
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
    move([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]);
    setZoom(Math.max(11, Math.min(16, Math.floor(16 + Math.log2(Math.min(Math.max(100, size.width - 100) / Math.max(width, 1), Math.max(100, size.height - 100) / Math.max(height, 1)))))));
  }
  function showPlace(place: MapSearchPlace) {
    move(project(place.location));
    setZoom(15);
    setShownPlace(place);
    setSearch(place.name);
    searchInput.current?.focus({ preventScroll: true });
  }
  return <section aria-label="Офлайн-карта Астаны" data-slot="offline-map-surface" className={`min-w-0 overflow-hidden rounded-lg border bg-background${fitViewport ? ' sj-offline-map-fit' : ''}`}>
    <div data-slot="offline-map-controls" className={fitViewport ? 'sj-map-fit-controls' : 'contents'} role={fitViewport ? 'group' : undefined} aria-label={fitViewport ? 'Инструменты карты' : undefined} tabIndex={fitViewport ? 0 : undefined}>
    <div data-slot="offline-map-toolbar" className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
      <div><h3 className="text-sm font-semibold">Астана · офлайн</h3><p className="text-xs text-muted-foreground">Синий — объект, зелёный — наружный пост. Перетаскивайте карту для перемещения.</p></div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" aria-label="Отдалить карту" onClick={() => changeZoom(-1)} disabled={zoom === 11}>−</Button>
        <Button size="sm" variant="outline" aria-label="Приблизить карту" onClick={() => changeZoom(1)} disabled={zoom === 18}>+</Button>
        <Button size="sm" variant="outline" onClick={fit}>Показать точки</Button>
      </div>
    </div>
    <form role="search" aria-label="Поиск по карте" className="border-b p-3" onSubmit={event => { event.preventDefault(); if (searchResults[0]) showPlace(searchResults[0]); }}>
      <div className="flex items-center gap-2">
        <Input ref={searchInput} type="search" aria-label="Поиск улицы или района" placeholder="Улица или район Астаны" value={search} disabled={!asset}
          onChange={event => { setSearch(event.target.value); setShownPlace(null); }} className="min-w-0" />
        {search && <Button type="button" variant="outline" size="sm" aria-label="Очистить поиск на карте" onClick={() => { setSearch(''); setShownPlace(null); }}>Очистить</Button>}
      </div>
      {shownPlace ? <p role="status" className="mt-2 break-words text-xs text-muted-foreground">Найдено: {shownPlace.name}</p>
        : search.trim().length >= 2 && asset ? searchResults.length ? <ul aria-label="Найденные улицы и районы" className="mt-2 space-y-1">
          {searchResults.map(place => <li key={place.key}><button type="button" aria-label={`Показать на карте: ${place.name}`}
            className="flex w-full items-start justify-between gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
            onClick={() => showPlace(place)}><span className="min-w-0 break-words">{place.name}</span><span className="shrink-0 text-xs text-muted-foreground">{place.kind === 'street' ? 'Улица' : 'Место'}</span></button></li>)}
        </ul> : <p role="status" className="mt-2 text-xs text-muted-foreground">Улицы и районы не найдены.</p>
        : <p className="mt-2 text-xs text-muted-foreground">Поиск по названиям из офлайн-карты. Введите хотя бы две буквы.</p>}
    </form>
    </div>
    <div ref={box} data-slot="offline-map-canvas" className="relative h-[clamp(320px,55dvh,560px)] min-w-0 w-full bg-[#f5f2ea]" style={{ cursor: locating ? 'crosshair' : 'grab' }}>
      <canvas ref={canvas} tabIndex={0} aria-label={locating ? 'Выберите точку на карте' : 'Карта Астаны. Стрелки перемещают карту, плюс и минус меняют масштаб.'}
        className="h-full w-full touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
        onKeyDown={event => {
          const offset: Record<string, [number, number]> = { ArrowLeft: [-70, 0], ArrowRight: [70, 0], ArrowUp: [0, -70], ArrowDown: [0, 70] };
          if (offset[event.key]) { event.preventDefault(); const delta = offset[event.key]; move([center[0] + delta[0] / scale, center[1] + delta[1] / scale]); }
          if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(1); }
          if (event.key === '-') { event.preventDefault(); changeZoom(-1); }
        }}
        onDoubleClick={event => {
          if (locating || !asset) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const next = zoomMapAt({ center, zoom }, 1, [event.clientX - rect.left - size.width / 2, event.clientY - rect.top - size.height / 2]);
          move(next.center); setZoom(next.zoom);
        }}
        onPointerDown={event => { if (event.button !== 0 || !asset) return; event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, center, moved: false }; }}
        onPointerMove={event => { const start = drag.current; if (!start) return; const dx = event.clientX - start.x, dy = event.clientY - start.y; if (Math.abs(dx) + Math.abs(dy) > 5) start.moved = true; if (start.moved) move([start.center[0] - dx / scale, start.center[1] - dy / scale]); }}
        onPointerCancel={() => { drag.current = null; }}
        onPointerUp={event => { const start = drag.current; drag.current = null; if (!start || start.moved || !locating) return; const rect = event.currentTarget.getBoundingClientRect(); onPoint(unproject(center[0] + (event.clientX - rect.left - size.width / 2) / scale, center[1] + (event.clientY - rect.top - size.height / 2) / scale)); }} />
      {asset && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full">
        {placedMarkers.filter(item => item.actualX !== item.x || item.actualY !== item.y).map(({ marker, actualX, actualY, x, y }) => <g key={`${marker.kind}:${marker.id}`}><line x1={actualX} y1={actualY} x2={x} y2={y} stroke="#64748b" strokeWidth="1.5" /><circle cx={actualX} cy={actualY} r="3" fill="#64748b" stroke="white" strokeWidth="1" /></g>)}
      </svg>}
      {asset && placedMarkers.map(({ marker, x, y }) => {
        return <button key={`${marker.kind}:${marker.id}`} type="button" aria-label={marker.label} title={marker.label} onClick={() => onSelect(marker)}
          className={`absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-md focus-visible:outline focus-visible:outline-4 focus-visible:outline-blue-600 ${marker.kind === 'draft' ? 'bg-amber-600' : marker.kind === 'object' ? 'bg-blue-700' : 'bg-emerald-700'} ${marker.selected ? 'ring-4 ring-blue-300' : ''}`}
          style={{ left: x, top: y }}>{marker.kind === 'object' ? 'О' : marker.kind === 'post' ? 'П' : '+'}</button>;
      })}
      {!asset && <div className="absolute inset-0 flex items-center justify-center bg-background/90 p-6 text-center text-sm" role={error ? 'alert' : 'status'}>
        {error ? <div><p>Не удалось загрузить офлайн-карту.</p><Button className="mt-3" variant="outline" onClick={() => setAttempt(value => value + 1)}>Повторить загрузку карты</Button></div> : 'Загружаем карту Астаны с локального сервера…'}
      </div>}
      {locating && asset && <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded bg-background/95 p-2 text-center text-xs shadow">Нажмите на карту или введите координаты ниже. Точка сохранится после нажатия «Сохранить точку».</div>}
      {asset && <div className={`pointer-events-none absolute left-3 rounded bg-white/95 px-2 py-1 text-center text-[11px] text-slate-700 shadow-sm ${locating ? 'bottom-16' : 'bottom-3'}`}>
        <div style={{ width: scaleMeters / metersPerPixel }} className="h-1.5 border-x border-b border-slate-600" />
        <output aria-label="Масштаб карты">{scaleLabel}</output>
      </div>}
    </div>
    <div className="flex flex-wrap justify-between gap-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
      <span>Данные: {asset?.manifest.sourceDate?.slice(0, 10) || 'дата не указана'} · ODbL 1.0. Близкие метки соединены с точкой линией.</span>
    </div>
  </section>;
}
