import type { ReconSectorPost } from '@/entities/security-event';

export interface ReconRowDraft {
  base: ReconSectorPost[];
  rows: ReconSectorPost[];
}

/** Three-way reconciliation: unchanged fields accept the server value; local
 * changes and missing rows (deletions) survive. A save acknowledges its sent
 * snapshot, whereas an import acknowledges no local changes. */
export function reconcileReconRows(state: ReconRowDraft, fresh: ReconSectorPost[], sent?: ReconSectorPost[]): ReconRowDraft {
  const remap = new Map<string, string>();
  if (sent !== undefined) {
    const known = new Set(state.base.map(row => row.id));
    // update_recon preserves submitted order and returns one row per submitted
    // row, replacing only new IDs and their parentPostId references.
    sent.forEach((row, index) => {
      const saved = fresh[index];
      if (!known.has(row.id) && saved !== undefined && saved.id !== row.id &&
          (saved.visitObjectId ?? null) === (row.visitObjectId ?? null)) {
        remap.set(row.id, saved.id);
      }
    });
  }
  const withServerId = (row: ReconSectorPost): ReconSectorPost => ({ ...row,
    id: remap.get(row.id) ?? row.id,
    parentPostId: remap.get(row.parentPostId ?? '') ?? row.parentPostId,
  });
  const before = new Map((sent ?? state.base).map(row => {
    const normalized = withServerId(row);
    return [normalized.id, normalized];
  }));
  const incoming = new Map(fresh.map(row => [row.id, row]));
  const rows: ReconSectorPost[] = [];
  const retained = new Set<string>();
  for (const original of state.rows) {
    const local = withServerId(original);
    const baseline = before.get(local.id);
    const server = incoming.get(local.id);
    if (server === undefined) {
      // A clean row removed by the server disappears; an edited/new local row
      // remains available to save. No failed request ever changes this base.
      if (baseline === undefined || JSON.stringify(local) !== JSON.stringify(baseline)) rows.push(local);
    } else if (baseline === undefined) {
      rows.push(local);
    } else {
      const merged = { ...server };
      for (const key of Object.keys(local) as (keyof ReconSectorPost)[]) {
        if (!Object.is(local[key], baseline[key])) Object.assign(merged, { [key]: local[key] });
      }
      rows.push(merged);
    }
    retained.add(local.id);
  }
  for (const server of fresh) {
    // A row in the baseline but absent locally is a deletion, not a server
    // addition. Retain that tombstone across repeated imports.
    if (!retained.has(server.id) && !before.has(server.id)) rows.push(server);
  }
  return { base: fresh, rows };
}

/** The wire API expects the full event list. Hidden objects therefore use
 * confirmed rows, never their unsaved drafts. Legacy unassigned rows may be
 * claimed by the addressed visit, without duplicating their existing IDs. */
export function rowsForReconSave(state: ReconRowDraft, visitId: string | null, single: boolean): ReconSectorPost[] {
  if (single) return state.rows;
  const savedById = new Map(state.base.map(row => [row.id, row]));
  const selected = state.rows.filter(row => {
    if ((row.visitObjectId ?? null) !== visitId) return false;
    const owner = savedById.get(row.id)?.visitObjectId ?? null;
    return owner === null || owner === visitId;
  });
  const selectedIds = new Set(selected.map(row => row.id));
  const rows: ReconSectorPost[] = [];
  let inserted = false;
  for (const saved of state.base) {
    if ((saved.visitObjectId ?? null) === visitId || ((saved.visitObjectId ?? null) === null && selectedIds.has(saved.id))) {
      if (!inserted) {
        rows.push(...selected);
        inserted = true;
      }
    } else rows.push(saved);
  }
  if (!inserted) rows.push(...selected);
  return rows;
}
