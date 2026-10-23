import { test, expect } from '@playwright/test';
import type { ReconSectorPost } from '@/entities/security-event';
import { reconcileReconRows, rowsForReconSave } from '../features/security-event-stages/model/recon-draft';

const post = (id: string, visitObjectId = 'A', patch: Partial<ReconSectorPost> = {}): ReconSectorPost => ({
  id, visitObjectId, sector: 'Общий', post: id, task: 'saved', need: 1, requirements: '', result: null,
  comment: '', sourceSectorId: null, sourcePostId: null, minRating: null, parentPostId: '', ...patch,
});

test('import merges server additions with edited saved fields, deletion tombstones and local additions', () => {
  const base = [post('a'), post('deleted'), post('b', 'B')];
  const local = [post('a', 'A', { need: 99, task: 'draft' }), post('b', 'B', { task: 'draft B' }), post('recon-local-new')];
  const fresh = [post('a', 'A', { comment: 'server note' }), post('deleted'), post('b', 'B'), post('imported')];
  const result = reconcileReconRows({ base, rows: local }, fresh);
  expect(result.rows.map(row => row.id)).toEqual(['a', 'b', 'recon-local-new', 'imported']);
  expect(result.rows[0]).toMatchObject({ need: 99, task: 'draft', comment: 'server note' });
  expect(result.rows[1].task).toBe('draft B');
  // A repeated import must not resurrect the same locally deleted saved row.
  expect(reconcileReconRows(result, fresh).rows.map(row => row.id)).toEqual(['a', 'b', 'recon-local-new', 'imported']);
});

test('save response reconciles against sent version and preserves subsequent edits on both visits', () => {
  const base = [post('a'), post('deleted'), post('b', 'B')];
  const sent = [post('a', 'A', { task: 'sent' }), post('deleted'), post('b', 'B')];
  const current = [post('a', 'A', { task: 'later', need: 4 }), post('b', 'B', { task: 'draft B' }), post('recon-local-later')];
  const fresh = [post('a', 'A', { task: 'sent', comment: 'normalized' }), post('deleted'), post('b', 'B')];
  const result = reconcileReconRows({ base, rows: current }, fresh, sent);
  expect(result.rows.map(row => row.id)).toEqual(['a', 'b', 'recon-local-later']);
  expect(result.rows[0]).toMatchObject({ task: 'later', need: 4, comment: 'normalized' });
  expect(result.rows[1].task).toBe('draft B');
  expect(result.base).toEqual(fresh);
});

test('server IDs replace sent local IDs while later edits, deletions and child links survive', () => {
  const sent = [post('recon-local-parent'), post('recon-local-child', 'A', { parentPostId: 'recon-local-parent' }), post('recon-local-delete')];
  const current = [post('recon-local-parent', 'A', { task: 'later' }), sent[1],
    post('recon-local-next-child', 'A', { parentPostId: 'recon-local-parent' })];
  const fresh = [post('server-parent'), post('server-child', 'A', { parentPostId: 'server-parent' }), post('server-delete')];
  const result = reconcileReconRows({ base: [], rows: current }, fresh, sent);
  expect(result.rows.map(row => row.id)).toEqual(['server-parent', 'server-child', 'recon-local-next-child']);
  expect(result.rows[0].task).toBe('later');
  expect(result.rows.slice(1).map(row => row.parentPostId)).toEqual(['server-parent', 'server-parent']);
});

test('save A sends only its edits and claims, leaving hidden saved B and unassigned rows unchanged', () => {
  const base = [post('a'), post('delete-a'), post('b', 'B'), post('unassigned', undefined, { visitObjectId: null })];
  const rows = [post('a', 'A', { task: 'edit A' }), post('b', 'B', { task: 'edit B' }), post('recon-local-b', 'B')];
  const payload = rowsForReconSave({ base, rows }, 'A', false);
  expect(payload.map(row => row.id)).toEqual(['a', 'b', 'unassigned']);
  expect(payload.map(row => row.task)).toEqual(['edit A', 'saved', 'saved']);
  const claimed = rowsForReconSave({ base, rows: [...rows, post('unassigned', 'A', { task: 'claimed' })] }, 'A', false);
  expect(claimed.filter(row => row.id === 'unassigned')).toEqual([post('unassigned', 'A', { task: 'claimed' })]);
});

test('single-object legacy rows remain editable and keep their imported identifiers', () => {
  const base = [post('legacy', undefined, { visitObjectId: null })];
  const rows = [post('legacy', undefined, { visitObjectId: null, need: 7 })];
  expect(rowsForReconSave({ base, rows }, 'A', true)).toEqual(rows);
});

test('saving an inserted post preserves selected order so a confirmed draft becomes clean', () => {
  const base = [post('first'), post('last'), post('b', 'B')];
  const rows = [post('first'), post('recon-local-inserted'), post('last'), post('b', 'B')];
  const sent = rowsForReconSave({ base, rows }, 'A', false);
  expect(sent.map(row => row.id)).toEqual(['first', 'recon-local-inserted', 'last', 'b']);
  const fresh = [post('first'), post('server-inserted'), post('last'), post('b', 'B')];
  const result = reconcileReconRows({ base, rows }, fresh, sent);
  expect(result.rows).toEqual(fresh);
});
