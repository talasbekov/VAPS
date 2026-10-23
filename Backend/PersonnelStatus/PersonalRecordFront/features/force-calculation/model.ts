export type VehicleType = 'PASSENGER' | 'ARMORED' | 'OTHER';
export type Position = 'RIGHT' | 'LEFT' | 'FRONT' | 'OBJECT';
export type Group = { id: string; organization: string; callsign: string; vehicle: string; vehicleType: VehicleType };
export type Segment = { id: string; name: string; type: string; tags: string; pointA: string; pointB: string };
export type RouteRow = { id: string; segmentId: string; reversed: boolean; position: Position; note: string };
export type Route = { id: string; name: string; start: string; end: string; date: string; time: string; rows: RouteRow[] };
export type CalculationDocument = { schemaVersion: 1; groups: Group[]; segments: Segment[]; routes: Route[]; assignments: Record<string, string> };
export type Issue = { path: string; message: string };
export type CalculationResponse = {
  event: { id: string; title: string; dateFrom: string; dateTo: string | null; stage: string };
  exists: boolean; version: number; ownerDivisionId: number | null;
  ownerDivisionName: string; ownerChoices: { id: number; name: string }[]; canManage: boolean;
  snapshot: { title: string; dateFrom: string; dateTo: string | null } | null;
  document: CalculationDocument; issues: Issue[]; updatedAt: string | null;
};
export const VEHICLE_LABELS: Record<VehicleType, string> = { PASSENGER: 'Легковая', ARMORED: 'Бронетехника', OTHER: 'Другая' };
export const POSITION_LABELS: Record<Position, string> = { RIGHT: 'Справа', LEFT: 'Слева', FRONT: 'Спереди', OBJECT: 'На объекте' };
export function emptyDocument(): CalculationDocument {
  return { schemaVersion: 1, groups: [], segments: [], routes: [], assignments: {} };
}
export function cloneDocument(document: CalculationDocument): CalculationDocument {
  return JSON.parse(JSON.stringify(document)) as CalculationDocument;
}
export function segmentRouteCount(document: CalculationDocument, segmentId: string): number {
  return document.routes.filter(route => route.rows.some(row => row.segmentId === segmentId)).length;
}
function releaseUnused(document: CalculationDocument): CalculationDocument {
  const used = new Set(document.routes.flatMap(route => route.rows.map(row => row.segmentId)));
  document.assignments = Object.fromEntries(Object.entries(document.assignments).filter(([id]) => used.has(id)));
  return document;
}
export function removeRow(document: CalculationDocument, routeId: string, rowId: string): CalculationDocument {
  const next = cloneDocument(document);
  const route = next.routes.find(route => route.id === routeId);
  if (route) route.rows = route.rows.filter(row => row.id !== rowId);
  return releaseUnused(next);
}
export function removeRoute(document: CalculationDocument, routeId: string): CalculationDocument {
  const next = cloneDocument(document);
  next.routes = next.routes.filter(route => route.id !== routeId);
  return releaseUnused(next);
}
export function availableGroups(document: CalculationDocument, segmentId: string): Group[] {
  const occupied = new Set(Object.entries(document.assignments).filter(([id]) => id !== segmentId).map(([, groupId]) => groupId));
  return document.groups.filter(group => !occupied.has(group.id));
}
export function selectedRouteId(document: Pick<CalculationDocument, 'routes'>, selected: string): string {
  return document.routes.find(route => route.id === selected)?.id ?? document.routes[0]?.id ?? '';
}
export function summarize(document: CalculationDocument, routeId?: string) {
  const routes = routeId ? document.routes.filter(route => route.id === routeId) : document.routes;
  const rows = routes.flatMap(route => route.rows);
  const usedSegments = new Set(rows.map(row => row.segmentId));
  const ids = new Set(Object.entries(document.assignments).filter(([segmentId]) => usedSegments.has(segmentId)).map(([, id]) => id));
  const groups = document.groups.filter(group => ids.has(group.id));
  const categories: Record<VehicleType, number> = { PASSENGER: 0, ARMORED: 0, OTHER: 0 };
  const organizations = new Map<string, number>();
  const organizationVehicles = new Map<string, { organization: string; vehicle: string; vehicleType: VehicleType; count: number }>();
  for (const group of groups) {
    categories[group.vehicleType] += 1;
    organizations.set(group.organization, (organizations.get(group.organization) ?? 0) + 1);
    const key = JSON.stringify([group.organization, group.vehicle, group.vehicleType]);
    const item = organizationVehicles.get(key) ?? { organization: group.organization, vehicle: group.vehicle, vehicleType: group.vehicleType, count: 0 };
    item.count += 1; organizationVehicles.set(key, item);
  }
  const globalIds = new Set(Object.values(document.assignments));
  const assignedSegments = [...usedSegments].filter(id => !!document.assignments[id]).length;
  return { groups: groups.length, vehicles: groups.length, categories,
    catalogGroups: document.groups.length, reserveGroups: document.groups.filter(group => !globalIds.has(group.id)).length,
    rows: rows.length, segments: usedSegments.size, assignedSegments, unassignedSegments: usedSegments.size - assignedSegments,
    sharedSegments: [...usedSegments].filter(id => segmentRouteCount(document, id) > 1).length,
    organizations: [...organizations].map(([name, count]) => ({ name, count })), organizationVehicles: [...organizationVehicles.values()] };
}
/** Only export completeness. Structural validation remains authoritative on the server. */
export function completionIssues(document: CalculationDocument): Issue[] {
  const issues: Issue[] = [];
  if (!document.routes.length) issues.push({ path: 'routes', message: 'Добавьте хотя бы один маршрут.' });
  document.routes.forEach((route, index) => {
    const name = route.name || `Маршрут ${index + 1}`;
    if ([route.name, route.start, route.end, route.date, route.time].some(value => !value?.trim())) {
      issues.push({ path: `routes.${index}`, message: `${name}: заполните название, начало, конец, дату и время.` });
    }
    if (!route.rows.length) issues.push({ path: `routes.${index}.rows`, message: `${name}: добавьте участки.` });
    route.rows.forEach(row => {
      if (!document.assignments[row.segmentId]) issues.push({ path: `assignments.${row.segmentId}`, message: `${name}: назначьте группу на каждый участок.` });
    });
  });
  const used = new Set(document.routes.flatMap(route => route.rows.map(row => row.segmentId)));
  document.segments.forEach((segment, index) => {
    if (used.has(segment.id) && [segment.name, segment.type, segment.pointA, segment.pointB].some(value => !value?.trim())) {
      issues.push({ path: `segments.${index}`, message: `${segment.name || `Участок ${index + 1}`}: заполните название, тип и обе точки.` });
    }
  });
  const assigned = new Set([...used].map(id => document.assignments[id]));
  document.groups.forEach((group, index) => {
    if (assigned.has(group.id) && [group.organization, group.callsign, group.vehicle].some(value => !value?.trim())) {
      issues.push({ path: `groups.${index}`, message: `${group.callsign || `Группа ${index + 1}`}: заполните организацию, позывной и технику.` });
    }
  });
  return issues;
}
