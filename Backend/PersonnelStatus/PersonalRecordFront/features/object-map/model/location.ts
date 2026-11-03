import type { GeoPoint, ObjectSector, SecurityObject } from "@/entities/security-object";
import type { MapMarker } from "@/features/offline-map/model/geometry";

export type MapBounds = { west: number; south: number; east: number; north: number };

export function isGeoPoint(value: unknown): value is GeoPoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return Object.keys(point).length === 2 &&
    typeof point.latitude === "number" && Number.isFinite(point.latitude) &&
    typeof point.longitude === "number" && Number.isFinite(point.longitude) &&
    point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180;
}

export function parseLocationInputs(latitude: string, longitude: string): GeoPoint | null {
  if (!latitude.trim() || !longitude.trim()) return null;
  const point = { latitude: Number(latitude), longitude: Number(longitude) };
  return isGeoPoint(point) ? point : null;
}

export function readMapBounds(value: unknown): MapBounds | null {
  if (!value || typeof value !== "object") return null;
  const bounds = value as MapBounds;
  if (![bounds.west, bounds.south, bounds.east, bounds.north].every(item => typeof item === "number" && Number.isFinite(item)) ||
      bounds.west < -180 || bounds.east > 180 || bounds.south < -90 || bounds.north > 90 ||
      bounds.west >= bounds.east || bounds.south >= bounds.north) return null;
  return { west: bounds.west, south: bounds.south, east: bounds.east, north: bounds.north };
}

export function isWithinMapCoverage(point: GeoPoint, bounds: MapBounds | null): boolean {
  return bounds !== null && isGeoPoint(point) && point.longitude >= bounds.west && point.longitude <= bounds.east &&
    point.latitude >= bounds.south && point.latitude <= bounds.north;
}

export function buildObjectMapMarkers(objects: readonly SecurityObject[], bounds: MapBounds | null) {
  const markers: MapMarker[] = [];
  let missingCount = 0, outsideCount = 0;
  for (const object of objects) {
    if (!isGeoPoint(object.location)) { missingCount++; continue; }
    if (!isWithinMapCoverage(object.location, bounds)) { outsideCount++; continue; }
    markers.push({ id: object.id, kind: "object", label: object.name, location: object.location });
  }
  return { markers, missingCount, outsideCount };
}

export function buildPostMapMarkers(sectors: readonly ObjectSector[], bounds: MapBounds | null): MapMarker[] {
  return sectors.flatMap(sector => sector.posts.flatMap(post => isGeoPoint(post.location) && isWithinMapCoverage(post.location, bounds)
    ? [{ id: post.id, kind: "post" as const, label: `${sector.name} · ${post.name}`, location: post.location }] : []));
}
