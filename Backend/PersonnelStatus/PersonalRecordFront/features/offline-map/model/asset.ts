import type { GeoPoint, MapGeometry } from './geometry';

type Manifest = { center: GeoPoint; bounds: { west: number; south: number; east: number; north: number }; sourceDate: string | null; attribution: string };
export type AstanaMapAsset = { geometry: MapGeometry; manifest: Manifest };

// One public city asset per browser document. Placement coordinates and markers
// belong to their existing queries and never enter this cache.
let asset: AstanaMapAsset | null = null;
let pending: Promise<AstanaMapAsset> | null = null;

export function peekAstanaMapAsset() { return asset; }

export function loadAstanaMapAsset(): Promise<AstanaMapAsset> {
  if (asset) return Promise.resolve(asset);
  if (pending) return pending;
  pending = Promise.all(['/maps/astana/manifest.json', '/maps/astana/geometry.json'].map(async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error('Map unavailable');
    return response.json();
  })).then(([manifest, geometry]) => {
    if (!manifest?.bounds || !Number.isFinite(manifest.center?.latitude) || !Number.isFinite(manifest.center?.longitude) ||
      !Array.isArray(geometry?.coordinates) || !Array.isArray(geometry?.features) || !Array.isArray(geometry?.labels)) {
      throw new Error('Invalid map asset');
    }
    asset = { manifest, geometry };
    pending = null;
    return asset;
  }).catch(error => {
    pending = null;
    throw error;
  });
  return pending;
}
