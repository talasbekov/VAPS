const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(deps) {
 const source = fs.readFileSync(path.join(__dirname, '../../features/notifications/model/report-download.ts'), 'utf8');
 const exports = {};
 vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, require: id => deps[id], URL, window: { location: { origin: 'https://portal.test' } } });
 return exports;
}
for (const link of ['/api/reports/42/download/', '/api/reports/reports/42/download/']) test('normalizes authenticated report notification ' + link, async () => {
 const calls = [];
 const { reportDownloadEndpoint, fetchNotificationReport } = load({ '@/lib/ops-api': { opsApiClient: {
  get: async endpoint => { calls.push(endpoint); return { download_url: '/api/reports/reports/42/content/' }; },
  download: async endpoint => { calls.push(endpoint); return { blob: 'fixture', filename: 'report.xlsx' }; },
 } } });
 const endpoint = reportDownloadEndpoint(link);
 assert.equal(endpoint, '/api/reports/reports/42/download/');
 assert.equal((await fetchNotificationReport(endpoint)).filename, 'report.xlsx');
 assert.deepEqual(calls, ['/api/reports/reports/42/download/', '/api/reports/reports/42/content/']);
});
test('does not treat arbitrary or external links as authorized report endpoints', () => {
 const { reportDownloadEndpoint } = load({});
 for (const link of ['/reports', '/api/reports/0/download/', '//outside.test/api/reports/42/download/', 'https://outside.test/api/reports/42/download/', '/api/reports/42/download/?next=/admin', '/api/reports/42/download/extra']) assert.equal(reportDownloadEndpoint(link), null);
});
for (const link of ['https://outside.test/api/reports/reports/42/content/', '/media/reports/file.xlsx', '/api/reports/reports/43/content/', '/api/reports/reports/42/content/?secret=1']) test('refuses unexpected content URL ' + link, async () => {
 let downloads = 0;
 const { fetchNotificationReport } = load({ '@/lib/ops-api': { opsApiClient: { get: async () => ({ download_url: link }), download: async () => downloads++ } } });
 await assert.rejects(fetchNotificationReport('/api/reports/reports/42/download/'));
 assert.equal(downloads, 0);
});

function dropdown({ fail = false, link = '/api/reports/42/download/' } = {}) {
 const calls = []; const notices = []; let failDownload = fail;
 const file = 'features/notifications/ui/NotificationsDropdown.tsx';
 const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
 const exports = {};
 const notification = { id: 7, source: 'legacy', notification_type: 'report_ready', link, title: 'Report', message: 'Ready',
  is_read: false, created_at: '2026-10-21T08:00:00Z' };
 const deps = {
  react: { ...require('react'), useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }) },
  'next/navigation': { useRouter: () => ({ push: url => calls.push(['navigate', url]) }) },
  '@tanstack/react-query': { useQuery: () => ({ data: { items: [notification], failed: [] } }), useQueryClient: () => ({}), useMutation: () => ({ mutate: row => calls.push(['read', row.id]) }) },
  'framer-motion': { motion: new Proxy({}, { get: (_, key) => key }), AnimatePresence: 'AnimatePresence' },
  '../api/notifications-api': { notificationKey: n => `${n.source}:${n.id}` },
  '../model/report-download': { reportDownloadEndpoint: link => /^\/api\/reports\/(?:reports\/)?42\/download\/$/.test(link) ? '/api/reports/reports/42/download/' : null, fetchNotificationReport: async endpoint => { calls.push(['download', endpoint]); if (failDownload) throw Error('fixture'); return { blob: 'blob', filename: 'report.xlsx' }; } },
  '@/shared/hooks/use-toast': { toast: notice => notices.push(notice) },
  '@/hooks/use-ops-ratings': { useRatingNotifications: () => ({ data: { results: [], unavailableViews: [] },
    error: null, authorityError: null, readAccessBlocked: false, isPending: false, isLoading: false, isFetching: false }) },
 };
 vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: id => deps[id] ?? (id.startsWith('@/') ? new Proxy({}, { get: (_, key) => key }) : require(id)), window: { URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} } }, document: { body: { appendChild() {} }, createElement: () => ({ click: () => calls.push(['save']), remove() {} }) } });
 const nodes = [];
 function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; nodes.push(node); walk(node.props?.children); }
 walk(exports.NotificationsDropdown());
 const textOf = node => Array.isArray(node) ? node.map(textOf).join('') : node == null || typeof node === 'boolean'
  ? '' : typeof node === 'object' ? textOf(node.props?.children) : String(node);
 const select = () => nodes.find(node => node.type === 'DropdownMenuItem' && textOf(node).startsWith('Report'))
  .props.onSelect({ preventDefault() {} });
 return { calls, notices, select, recover: () => { failDownload = false; } };
}
test('report notification downloads before marking read and never navigates to API', async () => {
 const subject = dropdown(); subject.select(); await new Promise(setImmediate);
 assert.deepEqual(subject.calls.map(call => call[0]), ['download', 'save', 'read']);
});
test('failed report remains unread and can retry the same notification', async () => {
 const subject = dropdown({ fail: true }); subject.select(); await new Promise(setImmediate);
 assert.deepEqual(subject.calls.map(call => call[0]), ['download']);
 assert.equal(subject.notices[0].variant, 'destructive');
 subject.recover(); subject.select(); await new Promise(setImmediate);
 assert.deepEqual(subject.calls.map(call => call[0]), ['download', 'download', 'save', 'read']);
});
test('ordinary notifications preserve their route and read action', async () => {
 const subject = dropdown({ link: '/statuses?division=3' }); subject.select(); await new Promise(setImmediate);
 assert.deepEqual(subject.calls, [['read', 7], ['navigate', '/statuses?division=3']]);
});
