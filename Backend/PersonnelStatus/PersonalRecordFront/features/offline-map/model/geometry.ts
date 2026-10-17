export type GeoPoint = { latitude: number; longitude: number };
export type MapLocations = { objects: Record<string, GeoPoint>; posts: Record<string, { location: GeoPoint | null; outdoor: boolean }> };
export const WORLD = 256 * 2 ** 16;
export function project(point: GeoPoint): [number, number] {
  const latitude = Math.max(-85.051128, Math.min(85.051128, point.latitude));
  return [(point.longitude + 180) / 360 * WORLD, (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * WORLD];
}
export function unproject(x: number, y: number): GeoPoint {
  return { longitude: x / WORLD * 360 - 180, latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / WORLD))) * 180 / Math.PI };
}
export type MapMarker = { id: string; kind: 'object' | 'post' | 'draft'; label: string; location: GeoPoint; selected?: boolean };
export type MapFeature = { kind: string; name?: string; nodes: number[]; bounds: number[] };
export type MapGeometry = { coordinates: number[]; features: MapFeature[]; labels: { x: number; y: number; name: string; kind: string }[] };
export type MapSearchPlace = { key: string; name: string; kind: 'street' | 'place'; location: GeoPoint; searchName: string };

function normalizedName(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

export function buildMapSearchIndex(geometry: MapGeometry): MapSearchPlace[] {
  const streets = new Map<string, { name: string; features: MapFeature[] }>();
  for (const feature of geometry.features) {
    if (!['trunk', 'primary', 'secondary', 'road'].includes(feature.kind) || !feature.name?.trim() || feature.nodes.length < 2) continue;
    const key = normalizedName(feature.name);
    const street = streets.get(key) || { name: feature.name.trim(), features: [] };
    street.features.push(feature);
    streets.set(key, street);
  }
  const index: MapSearchPlace[] = [];
  const coords = geometry.coordinates;
  for (const [key, street] of streets) {
    let west = Infinity, north = Infinity, east = -Infinity, south = -Infinity;
    for (const feature of street.features) for (const node of feature.nodes) {
      west = Math.min(west, coords[node * 2]); east = Math.max(east, coords[node * 2]);
      north = Math.min(north, coords[node * 2 + 1]); south = Math.max(south, coords[node * 2 + 1]);
    }
    const cx = (west + east) / 2, cy = (north + south) / 2;
    let nearest: [number, number] = [west, north], distance = Infinity;
    // Center on a recorded road segment, including streets split into separate ways.
    for (const feature of street.features) for (let i = 1; i < feature.nodes.length; i++) {
      const a = feature.nodes[i - 1] * 2, b = feature.nodes[i] * 2;
      const ax = coords[a], ay = coords[a + 1], dx = coords[b] - ax, dy = coords[b + 1] - ay;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / length)) : 0;
      const x = ax + t * dx, y = ay + t * dy, candidate = (cx - x) ** 2 + (cy - y) ** 2;
      if (candidate < distance) { nearest = [x, y]; distance = candidate; }
    }
    index.push({ key: `street:${key}`, name: street.name, kind: 'street', searchName: key, location: unproject(...nearest) });
  }
  const places = new Set<string>();
  for (const label of geometry.labels) {
    if (!label.name.trim()) continue;
    const key = normalizedName(label.name);
    if (places.has(key)) continue;
    places.add(key);
    index.push({ key: `place:${key}`, name: label.name.trim(), kind: 'place', searchName: key, location: unproject(label.x, label.y) });
  }
  return index.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function searchMapPlaces(index: MapSearchPlace[], query: string): MapSearchPlace[] {
  const name = normalizedName(query);
  if (name.length < 2) return [];
  const words = name.split(' ');
  return index.filter(place => words.every(word => place.searchName.includes(word)))
    .sort((a, b) => Number(b.searchName.startsWith(name)) - Number(a.searchName.startsWith(name)))
    .slice(0, 8);
}
