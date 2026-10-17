import type { Division, StaffUnit, StaffUnitStatistics } from '@/lib/api';

export interface SceneUnit {
  id: number;
  name: string;
  kind: 'service' | 'department' | 'directorate' | 'division' | 'other';
  ancestors: string[];
  parentId: number | null;
  employees: number | null;
  vacancies: number | null;
  staffCount: number | null;
  source: 'statistics' | 'staff' | 'hierarchy';
  position: [number, number, number];
}

/** Identity comes from IDs; links require an unambiguous full ancestor path.
 * Missing/hidden parents stay roots. Never infer a parent from a repeated name. */
export function buildSceneLayout(stats: StaffUnitStatistics, staffUnits: StaffUnit[], divisionTree?: Division | null) {
  const byId = new Map<number, SceneUnit>();
  const add = (id: number, name: string, kind: SceneUnit['kind'], ancestors: string[],
    counts: { employees_count: number; vacancies_count: number; staff_units_count: number }) => {
    byId.set(id, { id, name, kind, ancestors, parentId: null,
      employees: counts.employees_count, vacancies: counts.vacancies_count,
      staffCount: counts.staff_units_count, source: 'statistics', position: [0, 0, 0] });
  };
  for (const row of stats.departments) add(row.department_id, row.department_name, 'department', row.ancestors, row);
  for (const row of stats.directorates) add(row.directorate_id, row.directorate_name, 'directorate', row.ancestors, row);
  for (const row of stats.divisions) add(row.division_id, row.division_name, 'division', row.ancestors, row);
  // Imported staffing can refer to a unit absent from the hierarchy response.
  // Preserve that unit; a partial roster is not an authoritative aggregate.
  for (const unit of staffUnits) {
    if (!unit.division) continue;
    if (!byId.has(unit.division.id)) byId.set(unit.division.id, {
      id: unit.division.id, name: unit.division.name, kind: 'other', ancestors: [],
      parentId: null, employees: null, vacancies: null, staffCount: null,
      source: 'staff', position: [0, 0, 0],
    });
  }
  if (stats.scope_division && stats.scope_division.id > 0 && byId.get(stats.scope_division.id)?.source !== 'statistics') {
    const scope = stats.scope_division;
    add(scope.id, scope.name, ['service', 'organization'].includes(scope.division_type) ? 'service' : 'other', [], stats.summary);
  }
  // A staff-only identity may complete an explicit ancestor path, but only
  // when that name has one real ID and one full path in the supplied scope.
  const identities = new Map<string, Set<number>>();
  for (const node of byId.values()) identities.set(node.name, new Set([...(identities.get(node.name) ?? []), node.id]));
  for (const node of byId.values()) {
    if (node.source !== 'staff' && node.id !== stats.scope_division?.id) continue;
    const prefixes = new Map<string, string[]>();
    for (const child of byId.values()) child.ancestors.forEach((name, index) => {
      if (name === node.name) {
        const prefix = child.ancestors.slice(0, index);
        prefixes.set(JSON.stringify(prefix), prefix);
      }
    });
    if (identities.get(node.name)?.size === 1 && prefixes.size === 1) {
      node.ancestors = [...prefixes.values()][0];
      if (node.ancestors.length === 0) node.kind = 'service';
    }
  }
  const seedNodes = [...byId.values()].sort((a, b) => a.id - b.id);
  const paths = new Map<string, SceneUnit[]>();
  for (const node of seedNodes) {
    const key = JSON.stringify([...node.ancestors, node.name]);
    paths.set(key, [...(paths.get(key) ?? []), node]);
  }
  for (const node of seedNodes) {
    const parents = paths.get(JSON.stringify(node.ancestors)) ?? [];
    if (parents.length === 1 && parents[0].id !== node.id) node.parentId = parents[0].id;
  }
  // Statistics omits organization ancestors. Complete only the explicit ID
  // paths of scoped statistics/staff nodes from the independently authorized
  // tree. Unrelated branches and the virtual forest wrapper (id 0) stay out.
  const canonical = new Map<number, Division>();
  const indexTree = (division: Division) => {
    if (canonical.has(division.id)) return;
    if (division.id > 0) canonical.set(division.id, division);
    for (const child of division.children ?? []) indexTree(child);
  };
  if (divisionTree) indexTree(divisionTree);
  const kindOf = (type: string): SceneUnit['kind'] => {
    if (type === 'organization' || type === 'service') return 'service';
    if (type === 'department' || type === 'directorate' || type === 'division') return type;
    return 'other';
  };
  for (const seed of seedNodes) {
    const seen = new Set<number>([seed.id]);
    let parentId = canonical.get(seed.id)?.parent ?? null;
    while (parentId !== null && parentId > 0 && !seen.has(parentId)) {
      const parent = canonical.get(parentId);
      if (!parent) break;
      seen.add(parentId);
      if (!byId.has(parentId)) byId.set(parentId, {
        id: parentId, name: parent.name, kind: kindOf(parent.division_type), ancestors: [],
        parentId: null, employees: null, vacancies: null, staffCount: null,
        source: 'hierarchy', position: [0, 0, 0],
      });
      parentId = parent.parent;
    }
  }
  const nodes = [...byId.values()].sort((a, b) => a.id - b.id);
  for (const node of nodes) {
    const division = canonical.get(node.id);
    if (!division) continue;
    node.parentId = division.parent !== null && byId.has(division.parent) && division.parent !== node.id ? division.parent : null;
    node.kind = kindOf(division.division_type);
  }
  for (const node of nodes) {
    const seen = new Set<number>([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      if (seen.has(parentId)) { node.parentId = null; break; }
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }
  // Search and the selected card must show the same visible ID chain as the
  // graph, including hospital/military organization names. A scoped root with
  // a hidden parent must not retain a stale full-scope name path.
  for (const node of nodes) {
    if (!canonical.has(node.id)) continue;
    const ancestors: string[] = [];
    let parentId = node.parentId;
    while (parentId !== null) {
      const parent = byId.get(parentId)!;
      ancestors.unshift(parent.name);
      parentId = parent.parentId;
    }
    node.ancestors = ancestors;
  }
  const positioned = selectSceneTree(nodes, nodes.map(node => node.id));
  return { nodes: positioned.nodes, radius: positioned.radius, edges: positioned.edges,
    unassignedStaffCount: staffUnits.filter(unit => !unit.division).length };
}

/** One row per generation. Each visible subtree owns a disjoint horizontal
 * interval; expanding a branch reserves space beside it, never below siblings. */
export function selectSceneTree(allNodes: SceneUnit[], expandedIds?: number[], revealId?: number | null) {
  const byId = new Map(allNodes.map(node => [node.id, node]));
  const children = new Map<number, SceneUnit[]>();
  for (const node of allNodes) if (node.parentId !== null) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const roots = allNodes.filter(node => node.parentId === null);
  const expanded = new Set(expandedIds ?? roots.filter(node => node.kind === 'service').map(node => node.id));
  const breadcrumbs: SceneUnit[] = [];
  let ancestor = revealId == null ? undefined : byId.get(revealId);
  const visited = new Set<number>();
  while (ancestor && !visited.has(ancestor.id)) {
    visited.add(ancestor.id);
    breadcrumbs.unshift(ancestor);
    if (ancestor.id !== revealId) expanded.add(ancestor.id);
    ancestor = ancestor.parentId === null ? undefined : byId.get(ancestor.parentId);
  }
  const visibleChildren = (node: SceneUnit) => expanded.has(node.id) ? children.get(node.id) ?? [] : [];
  const nodes: SceneUnit[] = [];
  const widths = new Map<number, number>();
  const measure = (node: SceneUnit): number => {
    const width = Math.max(18, visibleChildren(node).reduce((sum, child) => sum + measure(child), 0));
    widths.set(node.id, width);
    return width;
  };
  const totalWidth = roots.reduce((sum, root) => sum + measure(root), 0);
  const place = (node: SceneUnit, left: number, depth: number): number => {
    const placed: SceneUnit = { ...node, position: [left + widths.get(node.id)! / 2, 10 - depth * 15, 0] };
    nodes.push(placed);
    let cursor = left;
    const childCenters = visibleChildren(node).map(child => {
      const x = place(child, cursor, depth + 1);
      cursor += widths.get(child.id)!;
      return x;
    });
    if (childCenters.length) placed.position[0] = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    return placed.position[0];
  };
  let cursor = -totalWidth / 2;
  for (const root of roots) {
    place(root, cursor, 0);
    cursor += widths.get(root.id)!;
  }
  const visibleIds = new Set(nodes.map(node => node.id));
  const edges = nodes.filter(node => node.parentId !== null && visibleIds.has(node.parentId))
    .map(node => ({ from: node.parentId as number, to: node.id }));
  const radius = Math.max(8, ...nodes.map(node => Math.hypot(...node.position) + 6));
  return { nodes, edges, radius, breadcrumbs, expandedIds: [...expanded], rootCount: roots.length,
    childCounts: new Map(allNodes.map(node => [node.id, children.get(node.id)?.length ?? 0])) };
}
