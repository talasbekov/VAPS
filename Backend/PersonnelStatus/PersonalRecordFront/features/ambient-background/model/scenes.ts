import { STAGE_ORDER } from '@/entities/security-event/model/stage-meta';
import type { GeoPoint } from '@/features/offline-map/model/geometry';

export type BackgroundScene = { key: string; kind: 'object' | 'astana'; label: string; center: GeoPoint };
type Bounds = { west: number; east: number; south: number; north: number };
type Visit = { id: string; objectId: string | null; objectName: string; stage: string };
type Event = { id: string; code: string; stage: string; businessDate: string; businessDateEnd: string | null; visitObjects: Visit[] };
type Read = (path: string) => Promise<unknown>;
const openStages: readonly string[] = STAGE_ORDER.filter(stage => stage !== 'CLOSED');
export const MAP_DWELL_MS = 120_000;
export const MAP_FADE_MS = 8_000;

export function backgroundDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qyzylorda', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function validDay(day: unknown): day is string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}
export function eventIsCurrent(event: Pick<Event, 'stage' | 'businessDate' | 'businessDateEnd'>, day: string): boolean {
  const end = event.businessDateEnd ?? event.businessDate;
  return openStages.includes(event.stage) && validDay(day) && validDay(event.businessDate) && validDay(end)
    && event.businessDate <= day && day <= end;
}
function geoPoint(point: unknown): point is GeoPoint {
  if (!point || typeof point !== 'object') return false;
  const p = point as GeoPoint;
  return typeof p.latitude === 'number' && typeof p.longitude === 'number' && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
    && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
}
export function pointInBounds(point: unknown, bounds: Bounds): point is GeoPoint {
  return geoPoint(point) && point.latitude >= bounds.south && point.latitude <= bounds.north && point.longitude >= bounds.west && point.longitude <= bounds.east;
}
function assertReading(signal: AbortSignal) {
  if (signal.aborted) { const error = new Error('Background read aborted'); error.name = 'AbortError'; throw error; }
}

/** Read existing endpoints only. No partial result survives a failed source. */
export async function readBackgroundScenes(read: Read, day: string, signal: AbortSignal): Promise<BackgroundScene[]> {
  if (!validDay(day)) throw new Error('Invalid background day');
  const events = new Map<string, Event>();
  let page = 1;
  for (;;) {
    assertReading(signal);
    // Server to= bounds the start date; overlap with the end date is checked below.
    const response = await read(`/api/ops/security-events/?stage=${openStages.join(',')}&to=${day}&page_size=100&page=${page}`) as { results?: Event[]; next?: unknown };
    assertReading(signal);
    if (!response || !Array.isArray(response.results)) throw new Error('Invalid background registry response');
    for (const row of response.results) if (row && typeof row.id === 'string' && row.id && eventIsCurrent(row, day)) events.set(row.id, row);
    if (response.next == null) break;
    const next = Number(response.next);
    if (!Number.isSafeInteger(next) || next !== page + 1) throw new Error('Invalid background registry pagination');
    page = next;
  }
  const candidates = [...events.values()].filter(event => Array.isArray(event.visitObjects) && event.visitObjects.some(visit => visit.objectId && openStages.includes(visit.stage)));
  const scenes: BackgroundScene[] = [];
  for (let start = 0; start < candidates.length; start += 4) {
    const chunk = await Promise.allSettled(candidates.slice(start, start + 4).map(async event => {
      assertReading(signal);
      const result = await read(`/api/ops/security-events/${encodeURIComponent(event.id)}/placement/map/`) as { objects?: Record<string, unknown> };
      assertReading(signal);
      if (!result?.objects || typeof result.objects !== 'object' || Array.isArray(result.objects)) throw new Error('Invalid background map response');
      const seen = new Set<string>();
      return event.visitObjects.flatMap(visit => {
        if (!visit.objectId || !openStages.includes(visit.stage) || typeof visit.id !== 'string' || !visit.id || seen.has(visit.id)) return [];
        seen.add(visit.id);
        const center = result.objects![visit.id];
        return geoPoint(center) ? [{ key: `${event.id}:${visit.id}`, kind: 'object' as const, label: `${event.code || 'ОМ'} · ${visit.objectName || 'Объект'}`, center }] : [];
      });
    }));
    for (const result of chunk) { if (result.status === 'rejected') throw result.reason; scenes.push(...result.value); }
  }
  assertReading(signal);
  return scenes;
}
