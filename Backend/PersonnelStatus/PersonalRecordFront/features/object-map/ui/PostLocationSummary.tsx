import type { ObjectSector } from "@/entities/security-object";
import { isGeoPoint, isWithinMapCoverage, type MapBounds } from "../model/location";

export function PostLocationSummary({ sectors, bounds }: { sectors: ObjectSector[]; bounds: MapBounds | null }) {
  return <ul aria-label="Координаты постоянных постов" className="space-y-1 text-xs text-muted-foreground">
    {sectors.flatMap(sector => sector.posts.map(post => <li key={`${sector.id}:${post.id}`}>
      {sector.name} · {post.name}: {isGeoPoint(post.location)
        ? <>{post.location.latitude.toFixed(6)}, {post.location.longitude.toFixed(6)}{bounds && !isWithinMapCoverage(post.location, bounds) ? " · вне покрытия локальной карты" : ""}</>
        : "координаты не указаны"}
    </li>))}
  </ul>;
}
