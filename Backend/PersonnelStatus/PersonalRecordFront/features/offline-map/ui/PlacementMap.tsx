"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { opsApiClient } from '@/lib/ops-api';
import { useOpsMutation } from '@/hooks/use-ops-mutation';
import type { SecurityEvent } from '@/entities/security-event';
import type { GeoPoint, MapLocations, MapMarker } from '../model/geometry';
import { UNASSIGNED_VISIT } from '@/features/security-event-stages/ui/useVisitObjectScope';

const MapCanvas = dynamic(() => import('./OfflineAstanaMap'), { ssr: false, loading: () => <div role="status" className="flex h-[440px] items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground">Открываем офлайн-карту…</div> });
const empty: MapLocations = { objects: {}, posts: {} };
type Target = { value: string; id: string; kind: 'object' | 'post'; label: string };

export function PlacementMap({ event, visitId, selectedPostId, canEdit, selectionPending = false, mode = 'placement', blockedReason = null, onOpenPost }: { event: SecurityEvent; visitId: string | null; selectedPostId: string | null; canEdit: boolean; selectionPending?: boolean; mode?: 'placement' | 'recon'; blockedReason?: string | null; onOpenPost?: (postId: string) => void }) {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const recon = mode === 'recon';
  const requestedPostId = selectedPostId ?? (recon ? params.get('post') : null);
  const writeBlocked = blockedReason !== null;
  const opened = params.get('map') === '1';
  const [isNavigating, startNavigation] = useTransition();
  const navigating = isNavigating || selectionPending;
  const queryClient = useQueryClient();
  const key = ['ops-placement-map', event.id];
  const endpoint = `/api/ops/security-events/${encodeURIComponent(event.id)}/placement/map/`;
  const positions = useQuery<MapLocations>({ queryKey: key, queryFn: () => opsApiClient.get<MapLocations>(endpoint), enabled: opened, retry: false });
  const [editing, setEditing] = useState(false);
  const [targetValue, setTargetValue] = useState('');
  const [latitude, setLatitude] = useState(''), [longitude, setLongitude] = useState('');
  const [saved, setSaved] = useState('');
  const [switchValue, setSwitchValue] = useState<string | null>(null);
  const [targetSearch, setTargetSearch] = useState('');
  const [focusPoint, setFocusPoint] = useState<{ key: number; location: GeoPoint } | null>(null);
  const focusSequence = useRef(0);
  const workspace = useRef<HTMLDivElement>(null);
  const pointForm = useRef<HTMLFormElement>(null);
  const scrolledToMap = useRef(false);
  const targetSelect = useRef<HTMLSelectElement>(null);
  const originalCoordinates = useRef({ latitude: '', longitude: '', label: '' });
  const draftVersion = useRef(0);
  const draftScope = useRef(JSON.stringify([event.id, visitId]));
  const data = positions.isError ? empty : positions.data || empty;
  const targets = useMemo<Target[]>(() => [
    ...event.visitObjects.filter(visit => visit.id === visitId).map(visit => ({ value: `object:${visit.id}`, id: visit.id, kind: 'object' as const, label: `Объект: ${visit.objectName}` })),
    ...event.reconSectorPosts.filter(post => (post.visitObjectId ?? null) === visitId || (event.visitObjects.length === 1 && !post.visitObjectId)).map(post => ({ value: `post:${post.id}`, id: post.id, kind: 'post' as const, label: `Наружный пост: ${post.sector} · ${post.post}` })),
  ], [event.reconSectorPosts, event.visitObjects, visitId]);
  const activePostId = recon ? targets.find(item => item.kind === 'post' && item.id === requestedPostId)?.id ?? null : selectedPostId;
  const target = targets.find(item => item.value === targetValue) || null;
  const switchTarget = targets.find(item => item.value === switchValue) || null;
  const currentTarget = (params.get('mapTarget') === 'object' ? targets.find(item => item.kind === 'object') : null)
    || targets.find(item => item.kind === 'post' && item.id === activePostId) || targets[0] || null;
  function pointOf(item: Target | null) {
    return item?.kind === 'object' ? data.objects[item.id] : item ? data.posts[item.id]?.location : null;
  }
  const currentPoint = pointOf(currentTarget);
  const term = targetSearch.trim().toLocaleLowerCase('ru');
  const shownTargets = targets.filter(item => item.label.toLocaleLowerCase('ru').includes(term));
  const counts = new Map<string, number>();
  for (const assignment of event.placementAssignments) counts.set(assignment.postId, (counts.get(assignment.postId) || 0) + 1);
  const posts = new Map(event.reconSectorPosts.map(post => [post.id, post]));
  const shortages = targets.filter(item => item.kind === 'post' && (counts.get(item.id) || 0) < (posts.get(item.id)?.need || 0));
  const changedCoordinates = latitude !== originalCoordinates.current.latitude || longitude !== originalCoordinates.current.longitude;
  const validNumbers = latitude.trim() !== '' && longitude.trim() !== '' && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Math.abs(Number(latitude)) <= 90 && Math.abs(Number(longitude)) <= 180;
  const draft: GeoPoint | null = editing && validNumbers ? { latitude: Number(latitude), longitude: Number(longitude) } : null;
  const mutation = useOpsMutation<MapLocations, { targetType: 'object' | 'post'; targetId: string; location: GeoPoint | null; outdoor?: boolean; draftVersion: number }>({
    mutationFn: ({ draftVersion: _draftVersion, ...body }) => opsApiClient.patch<MapLocations>(endpoint, body),
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['ops-security-events', 'detail', event.id] });
      if (variables.draftVersion !== draftVersion.current) { void queryClient.invalidateQueries({ queryKey: key }); return; }
      // A read started before this PATCH must not replace its confirmed result.
      void queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, result); setEditing(false); setSaved('Координаты сохранены.');
    },
  });
  useEffect(() => {
    const nextScope = JSON.stringify([event.id, visitId]);
    if (draftScope.current === nextScope) return;
    draftScope.current = nextScope;
    draftVersion.current++; setEditing(false); setSwitchValue(null); setSaved(''); setTargetValue(''); setLatitude(''); setLongitude(''); setTargetSearch(''); mutation.reset();
  }, [event.id, visitId]); // Only an actual scope change discards an unsaved point.
  useEffect(() => {
    if (!opened || !canEdit || !editing || !switchTarget || positions.isError) setSwitchValue(null);
  }, [opened, canEdit, editing, switchTarget, positions.isError]);
  useEffect(() => {
    if (!opened) { scrolledToMap.current = false; return; }
    if (positions.isPending || scrolledToMap.current) return;
    // Recon's viewport-sized map reveals itself once its dynamic canvas mounts.
    if (recon && !positions.isError) return;
    const frame = requestAnimationFrame(() => {
      workspace.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
      scrolledToMap.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [opened, positions.isPending, positions.isError, recon]);
  function url(update: (next: URLSearchParams) => void) { const next = new URLSearchParams(params); update(next); startNavigation(() => router.replace(`${pathname}?${next}`, { scroll: false })); }
  function start(value?: string) {
    if (!canEdit || writeBlocked || mutation.isPending) return;
    const chosen = targets.find(item => item.value === value) || currentTarget || targets[0];
    if (!chosen) return;
    draftVersion.current++;
    const point = chosen.kind === 'object' ? data.objects[chosen.id] : data.posts[chosen.id]?.location;
    originalCoordinates.current = { latitude: point ? String(point.latitude) : '', longitude: point ? String(point.longitude) : '', label: chosen.label };
    setSwitchValue(null); setTargetValue(chosen.value); setLatitude(originalCoordinates.current.latitude); setLongitude(originalCoordinates.current.longitude); setSaved(''); mutation.reset(); setEditing(true);
    if (point) setFocusPoint({ key: ++focusSequence.current, location: point });
  }
  function changeTarget(value: string) {
    if (value === targetValue || !canEdit || writeBlocked || !editing || mutation.isPending || !targets.some(item => item.value === value)) return;
    if (changedCoordinates) setSwitchValue(value);
    else start(value);
  }
  function choose(marker: Pick<MapMarker, 'kind' | 'id'>) {
    // A later marker click replaces all selection fields and must win even
    // while an earlier marker navigation is still rendering.
    if (marker.kind === 'draft' || editing || writeBlocked) return;
    const point = marker.kind === 'object' ? data.objects[marker.id] : data.posts[marker.id]?.location;
    if (point) setFocusPoint({ key: ++focusSequence.current, location: point });
    url(next => {
      if (marker.kind === 'object') { next.set('visit', marker.id); next.set('mapTarget', 'object'); next.delete('post'); }
      else {
        const post = event.reconSectorPosts.find(item => item.id === marker.id);
        const owner = post?.visitObjectId || (event.visitObjects.length === 1 ? event.visitObjects[0].id : UNASSIGNED_VISIT);
        next.set('visit', owner); next.set('post', marker.id); next.delete('mapTarget');
      }
    });
  }
  const markers: MapMarker[] = [
    ...event.visitObjects.flatMap(visit => data.objects[visit.id] ? [{ id: visit.id, kind: 'object' as const, label: `Объект: ${visit.objectName}`, location: data.objects[visit.id], selected: visitId === visit.id }] : []),
    ...event.reconSectorPosts.flatMap(post => data.posts[post.id]?.outdoor && data.posts[post.id]?.location ? [{ id: post.id, kind: 'post' as const, label: `Наружный пост: ${post.post}`, location: data.posts[post.id].location!, selected: activePostId === post.id }] : []),
    ...(draft ? [{ id: 'draft', kind: 'draft' as const, label: 'Несохранённая точка', location: draft }] : []),
  ];
  const objectCount = event.visitObjects.filter(visit => data.objects[visit.id]).length;
  const selectedPost = event.reconSectorPosts.find(post => post.id === activePostId);
  const selectedCardId = recon && selectedPost ? `recon-post-${selectedPost.id}` : 'placement-selected-post';
  const outside = markers.some(marker => marker.location.longitude < 71.15 || marker.location.longitude > 71.7 || marker.location.latitude < 50.98 || marker.location.latitude > 51.35);
  function optionLabel(item: Target) {
    if (item.kind === 'object') return item.label;
    const post = posts.get(item.id);
    return `${post?.sector} · ${post?.post}${recon ? '' : ` · ${counts.get(item.id) || 0}/${post?.need || 0}`}${pointOf(item) ? '' : ' · без точки'}`;
  }
  return <div ref={workspace} id={`event-map-${event.id}`} className={`min-w-0 space-y-3 scroll-mt-4${recon && opened ? ' sj-recon-map-viewport' : ''}`}>
    <div role="group" aria-label={recon ? 'Представление карты рекогносцировки' : 'Представление расстановки'} aria-busy={navigating} className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={opened ? 'outline' : 'default'} aria-pressed={!opened} disabled={navigating} onClick={() => url(next => next.delete('map'))}>Список постов</Button>
      <Button size="sm" variant={opened ? 'default' : 'outline'} aria-pressed={opened} disabled={navigating} onClick={() => url(next => next.set('map', '1'))}>{recon ? 'Карта' : 'Карта Астаны'}</Button>
    </div>
    {blockedReason && <p role="status" className="text-sm text-muted-foreground">{blockedReason}</p>}
    {!opened && editing && canEdit && <p role={mutation.error ? 'alert' : 'status'} className={`text-xs ${mutation.error ? 'text-destructive' : 'text-muted-foreground'}`}>
      {mutation.isPending ? 'Сохраняем координаты точки…' : mutation.error
        ? 'Не удалось сохранить точку. Введённые координаты сохранены в форме. Вернитесь к карте, чтобы повторить.'
        : 'На карте есть несохранённая точка. Вернитесь к карте, чтобы продолжить или отменить.'}
    </p>}
    {!opened && saved && <p role="status" className="text-xs text-emerald-700">{saved}</p>}
    {opened && <div className="space-y-3">
      {positions.isPending ? <p role="status" className="text-sm text-muted-foreground">Загружаем координаты объектов…</p> : positions.isError ? <div role="alert" className="rounded border border-destructive/40 p-3 text-sm"><p>Не удалось загрузить координаты. Сохранённые точки могут быть недоступны.</p><Button className="mt-2" size="sm" variant="outline" onClick={() => { void positions.refetch(); }}>Повторить загрузку координат</Button></div> : <>
        <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">{recon ? 'На карте — сохранённые посты выбранного объекта. Сохраните расчёт, чтобы добавить новые посты на карту, затем укажите их точки.' : 'Выберите объект или пост, укажите точку и назначьте сотрудников в карточке поста.'}</p>
          {targets.length > 0 ? <>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="min-w-0 text-xs font-medium">Объект или пост на карте
                {targets.length > 6 && <Input type="search" aria-label="Найти пост на карте" placeholder="Поиск по посту или сектору" className="mt-1 h-8" value={targetSearch} disabled={editing} onChange={event => setTargetSearch(event.target.value)} />}
                <select aria-label="Объект или пост на карте" value={currentTarget?.value || ''} disabled={editing || navigating || writeBlocked} className="mt-1 h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
                  onChange={event => { const item = targets.find(item => item.value === event.target.value); if (item) choose(item); }}>
                  {currentTarget && !shownTargets.includes(currentTarget) && <option value={currentTarget.value}>{optionLabel(currentTarget)}</option>}
                  {shownTargets.map(item => <option key={item.value} value={item.value}>{optionLabel(item)}</option>)}
                </select>
                {term && <span role="status" className="mt-1 block text-xs text-muted-foreground">{shownTargets.length ? `Найдено: ${shownTargets.length}` : 'Посты не найдены. Измените или очистите поиск.'}</span>}
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <Button size="sm" variant="outline" disabled={!currentPoint} onClick={() => { if (currentPoint) setFocusPoint({ key: ++focusSequence.current, location: currentPoint }); }}>К выбранной точке</Button>
                {canEdit && !editing && <Button size="sm" disabled={navigating || writeBlocked} onClick={() => start()}>Указать точку на карте</Button>}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p role="status" className="text-muted-foreground">{currentPoint ? 'Точка указана. Выбор поста приближает карту к нему.' : currentTarget?.kind === 'post' ? 'У выбранного поста ещё нет точки на карте.' : 'У выбранного объекта ещё нет точки на карте.'}</p>
              {!recon && targets.some(item => item.kind === 'post') && <Button size="sm" variant="outline" disabled={editing || navigating || shortages.length === 0} onClick={() => {
                const index = shortages.findIndex(item => item.value === currentTarget?.value);
                const next = shortages[(index + 1) % shortages.length];
                if (next) choose(next);
              }}>Следующий пост с недобором{shortages.length > 0 ? ` (${shortages.length})` : ''}</Button>}
            </div>
          </> : <p className="text-sm text-muted-foreground">У этого объекта пока нет постов. Добавьте расчёт на этапе рекогносцировки.</p>}
        </div>
        {outside && <p role="status" className="text-xs text-amber-700">Часть точек находится за границами подложки Астаны. Их координаты сохранены и доступны при выборе в списке.</p>}
        <MapCanvas fitViewport={recon} markers={markers} focusPoint={focusPoint} onSelect={choose} locating={editing && canEdit && !mutation.isPending && !writeBlocked} onPoint={point => {
          if (mutation.isPending || !editing || !canEdit || writeBlocked) return;
          setLatitude(point.latitude.toFixed(6)); setLongitude(point.longitude.toFixed(6));
          pointForm.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        }} />
        {selectedPost && <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs">
          <p aria-live="polite"><span className="text-muted-foreground">Выбран пост: </span><strong>{selectedPost.post}</strong> · {selectedPost.sector}{!recon && <> · {event.placementAssignments.filter(assignment => assignment.postId === selectedPost.id).length} из {selectedPost.need}</>}</p>
          <Button size="sm" variant="outline" aria-controls={selectedCardId} disabled={recon && (writeBlocked || navigating)} onClick={() => {
            if (recon && onOpenPost) { onOpenPost(selectedPost.id); return; }
            const card = document.getElementById(selectedCardId);
            card?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
            const focus = recon ? card?.querySelector<HTMLElement>('input') : card;
            focus?.focus({ preventScroll: true });
          }}>{recon ? 'Открыть строку поста' : 'Открыть карточку поста'}</Button>
        </div>}
        {editing && canEdit && <form ref={pointForm} className="space-y-3 rounded-lg border bg-muted/20 p-3" onSubmit={event => { event.preventDefault(); if (target && draft && !switchTarget && !mutation.isPending && !writeBlocked) mutation.mutate({ targetType: target.kind, targetId: target.id, location: draft, draftVersion: draftVersion.current, ...(target.kind === 'post' ? { outdoor: true } : {}) }); }}>
          <label className="block text-xs font-medium">Точка для<select ref={targetSelect} aria-label="Точка для" value={targetValue} onChange={event => changeTarget(event.target.value)} disabled={mutation.isPending || writeBlocked} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm">{!target && targetValue && <option value={targetValue} disabled>Недоступная цель: {originalCoordinates.current.label}</option>}{targets.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          {!target && <p role="alert" className="text-sm text-muted-foreground">Эта цель больше недоступна. Черновик сохранён. Выберите другую цель или отмените ввод.</p>}
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">Широта<Input aria-label="Широта точки" inputMode="decimal" type="number" step="any" min="-90" max="90" required value={latitude} onChange={event => setLatitude(event.target.value)} disabled={mutation.isPending || writeBlocked} /></label><label className="text-xs font-medium">Долгота<Input aria-label="Долгота точки" inputMode="decimal" type="number" step="any" min="-180" max="180" required value={longitude} onChange={event => setLongitude(event.target.value)} disabled={mutation.isPending || writeBlocked} /></label></div>
          {target?.kind === 'post' && <p className="text-xs text-muted-foreground">После сохранения этот пост будет отмечен как наружный. Состав и потребность поста сохраняются.</p>}
          {mutation.error && <p role="alert" className="text-sm text-destructive">Не удалось сохранить точку. Проверьте права и этап объекта, затем повторите. Введённые координаты сохранены в форме.</p>}
          <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={!draft || !target || mutation.isPending || writeBlocked}>{mutation.isPending ? 'Сохраняем…' : 'Сохранить точку'}</Button><Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={() => { setEditing(false); mutation.reset(); }}>Отмена</Button>
            {target && (target.kind === 'object' ? data.objects[target.id] : data.posts[target.id]) && <Button type="button" size="sm" variant="ghost" disabled={mutation.isPending || writeBlocked} onClick={() => { if (!writeBlocked) mutation.mutate({ targetType: target.kind, targetId: target.id, location: null, draftVersion: draftVersion.current, ...(target.kind === 'post' ? { outdoor: false } : {}) }); }}>Убрать точку</Button>}
          </div>
        </form>}
        {saved && <p role="status" className="text-xs text-emerald-700">{saved}</p>}
        <p className="text-xs text-muted-foreground">На карте объектов: {objectCount} из {event.visitObjects.length} · наружных постов: {markers.filter(marker => marker.kind === 'post').length}. Колесо мыши приближает место под курсором, перетаскивание перемещает карту.</p>
        {!canEdit && <p className="text-xs text-muted-foreground">{recon ? 'Карта доступна для просмотра. Координаты на рекогносцировке меняет уполномоченный старший выбранного объекта.' : 'Карта доступна для просмотра. Координаты меняет ответственный за расстановку на открытом этапе объекта.'}</p>}
      </>}
    </div>}
    <Dialog open={opened && canEdit && editing && !!switchTarget && !positions.isError} onOpenChange={open => { if (!open) setSwitchValue(null); }}>
      <DialogContent onCloseAutoFocus={event => {
        event.preventDefault();
        if (targetSelect.current?.isConnected && !targetSelect.current.disabled) targetSelect.current.focus({ preventScroll: true });
      }}>
        <DialogHeader>
          <DialogTitle>Сменить точку?</DialogTitle>
          <DialogDescription>Координаты для «{target?.label ?? originalCoordinates.current.label}» не сохранены. При переходе к «{switchTarget?.label}» введённые координаты будут сброшены.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setSwitchValue(null)}>Продолжить ввод</Button>
          <Button type="button" disabled={mutation.isPending} onClick={() => { if (switchTarget && canEdit && !mutation.isPending) start(switchTarget.value); }}>Перейти и сбросить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
