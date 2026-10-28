const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const data = {
  checked_at: '2026-10-27T08:00:00Z', time_zone: 'Asia/Qyzylorda',
  database: { state: 'available', last_recorded_migration: null, migration_recorded_at: null },
  ai: { state: 'configured', provider: 'openai', model: 'current-model', updated_at: '2026-10-27T07:00:00Z',
    connectivity: 'not_checked', last_check: null },
  ai_queue: { scope: 'visible_tasks', observed_at: '2026-10-27T08:00:00Z', worker_connection: 'not_checked',
    counts: { queued: 2, running: 1, failed: 3 }, lease_seconds: 180, latest_task_update_at: null,
    pending: { inspected: 3, total: 3, limit: 1000, truncated: false, stale_queued: 1, stale_running: 0,
      invalid_timestamps: 0, future_timestamps: 0, oldest_queued_at: '2026-10-27T07:55:00Z', oldest_started_at: '2026-10-27T07:59:50Z' } },
  digital_twin: { state: 'unknown', last_success_at: null, last_export_at: null, acknowledgement: 'not_recorded',
    catalog_import: { state: 'not_recorded', recorded_at: null, export_id: null, bundle_sha256: null } },
  release: { state: 'unknown', revision: null, installation_verified: false },
};

function render(query = {}, permission = {}) {
  let read;
  const exports = {};
  const overrides = {
    '@tanstack/react-query': { useQuery: () => query },
    '@/hooks/use-ops-permissions': { useOpsPermissions: () => ({ isLoading: false, error: null,
      hasGlobalPermission: () => true, ...permission }) },
    '@/hooks/use-ops-protected-read': {
      useOpsReadAccess: () => ({ allowed: true, actor: 'admin-7', scope: 'authority-7' }),
      useOpsProtectedRead: (prefix, parts, access, callback, options) => {
        read = { prefix, parts, access, options };
        return query;
      },
    },
    '@/lib/ops-api': { opsApiClient: {} },
    '@/components/ui/button': { Button: ({ children, asChild, size, variant, ...props }) => React.createElement('button', props, children) },
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/shared/lib/date': { formatIsoDateTime: value => value },
  };
  const source = fs.readFileSync(path.join(__dirname, '../../features/system-diagnostics/SystemDiagnostics.tsx'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: false } }).outputText;
  vm.runInNewContext(output, { exports, require: name => overrides[name] ?? require(name) });
  return { html: renderToStaticMarkup(React.createElement(exports.SystemDiagnostics)), read };
}

test('diagnostics separates scoped queue evidence from a worker availability claim', () => {
  const { html, read } = render({ data, isFetching: false });
  assert.match(html, /В очереди: 2/);
  assert.match(html, /Обрабатываются: 1/);
  assert.match(html, /С ошибкой: 3/);
  assert.match(html, /Доступные вам поручения/);
  assert.match(html, /180 секунд/);
  assert.match(html, /доступность фонового обработчика не проверяется/i);
  assert.equal(read.access.actor, 'admin-7');
  assert.equal(read.access.scope, 'authority-7');
});

for (const state of ['draft', 'previous', 'current']) {
  test(`connection evidence labels a ${state} configuration check accurately`, () => {
    const checked = { ...data, ai: { ...data.ai, last_check: { checked_at: '2026-10-27T07:30:00Z',
      succeeded: true, provider: 'openai', model: 'checked-model', configuration_match: state } } };
    const { html } = render({ data: checked, isFetching: false });
    assert.match(html, /checked-model/);
    assert.match(html, /2026-10-27T07:30:00Z/);
    assert.match(html, state === 'draft' ? /Проверен черновик/ : state === 'previous' ? /Проверены прежние настройки/ : /Проверены текущие сохранённые настройки/);
    assert.match(html, /не подтверждает доступность сейчас/);
  });
}

test('failed probe and incomplete timestamp sample remain visible as limitations', () => {
  const incomplete = { ...data,
    ai: { ...data.ai, last_check: { checked_at: '2026-10-27T07:30:00Z', succeeded: false,
      provider: 'openai', model: 'checked-model', configuration_match: 'current' } },
    ai_queue: { ...data.ai_queue, pending: { ...data.ai_queue.pending, inspected: 1, truncated: true,
      invalid_timestamps: 1, future_timestamps: 1 } },
  };
  const { html } = render({ data: incomplete, isFetching: false });
  assert.match(html, /Проверка завершилась ошибкой/);
  assert.match(html, /Проверено отметок времени: 1/);
  assert.match(html, /При подсчёте ожидали или обрабатывались: 3/);
  assert.match(html, /нижняя граница/);
  assert.match(html, /Некорректное или отсутствующее время: 1/);
  assert.match(html, /Время в будущем: 1/);
});

test('catalog receipt is shown as an import with no claim of current Digital Twin data', () => {
  const imported = { ...data, digital_twin: { ...data.digital_twin, catalog_import: {
    state: 'recorded', recorded_at: '2026-10-25T11:00:00Z', export_id: 'a5625535-8ba8-4ec9-8445-0efde0d04320', bundle_sha256: 'a'.repeat(64),
  } } };
  const { html } = render({ data: imported, isFetching: false });
  assert.match(html, /Импорт каталога в Smart/);
  assert.match(html, /a5625535-8ba8-4ec9-8445-0efde0d04320/);
  assert.match(html, /не подтверждает получение данных двойником/);
});

test('cached diagnostics disappear on a refresh error', () => {
  const { html } = render({ data, isError: true, isFetching: false });
  assert.match(html, /Не удалось получить состояние системы/);
  assert.doesNotMatch(html, /current-model|В очереди: 2/);
});

test('fresh pending work does not advertise a retry that the task workflow forbids', () => {
  const fresh = { ...data, ai_queue: { ...data.ai_queue, counts: { queued: 2, running: 1, failed: 0 },
    pending: { ...data.ai_queue.pending, stale_queued: 0, stale_running: 0 } } };
  assert.doesNotMatch(render({ data: fresh }).html, /Автор может/);
});

test('cached diagnostics stay hidden while a fresh request is running', () => {
  const { html } = render({ data, isFetching: true });
  assert.match(html, /Получаем сведения/);
  assert.doesNotMatch(html, /current-model|В очереди: 2/);
});

test('a queue changed between reads is described without a fabricated denominator', () => {
  const changed = { ...data, ai_queue: { ...data.ai_queue, counts: { queued: 1, running: 0, failed: 0 },
    pending: { ...data.ai_queue.pending, total: 1, inspected: 2, stale_queued: 0, stale_running: 0 } } };
  const { html } = render({ data: changed });
  assert.match(html, /Проверено отметок времени: 2/);
  assert.match(html, /При подсчёте ожидали или обрабатывались: 1/);
  assert.match(html, /читаются последовательно/);
  assert.doesNotMatch(html, /2 из 1/);
});

for (const permission of [{ hasGlobalPermission: () => false }, { isLoading: true }, { error: Error('permission refresh') }]) {
  test(`diagnostics is hidden without current global authority ${Object.keys(permission)[0]}`, () => {
    assert.equal(render({ data }, permission).html, '');
  });
}
