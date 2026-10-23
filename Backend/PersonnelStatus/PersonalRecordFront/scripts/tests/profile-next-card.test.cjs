const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const exported = {};
const file = path.join(__dirname, '../../widgets/my-profile/ui/NextShiftCard.tsx');
if (fs.existsSync(file)) vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: exported, require, Date, Intl });
const shift = changes => ({
  key: 'STATUS:17:exit-1', source: 'STATUS', sourceState: 'PLANNED', title: 'Дежурство',
  dateStart: '2026-10-20', dateEnd: '2026-10-21', plannedStart: '2026-10-20T18:00:00Z', plannedEnd: '2026-10-21T02:00:00Z',
  actualStart: null, actualEnd: null, acknowledgedAt: null, execution: 'ASSIGNED', declineReason: null,
  objectLabel: 'Дворец', postLabel: 'Вход 2', senior: null, instruction: null, eventId: null, ...changes,
});
function subject(props) {
  assert.equal(typeof exported.NextShiftCard, 'function', 'next shift card must be implemented');
  return exported.NextShiftCard(props);
}
const html = props => renderToStaticMarkup(subject(props));

test('compact next card displays exact overnight start and end in Astana time with place and post', () => {
  const result = html({ shift: shift() });
  assert.match(result, /Моя ближайшая смена/);
  assert.match(result, /Дворец/);
  assert.match(result, /Вход 2/);
  assert.match(result, /20\.10\.2026.*23:00/);
  assert.match(result, /21\.10\.2026.*07:00/);
  assert.match(result, /Астан/);
});

test('date-only card exposes unknown hours, senior and instruction without inventing midnight or names', () => {
  const result = html({ shift: shift({ plannedStart: null, plannedEnd: null, dateEnd: '2026-10-20' }) });
  assert.match(result, /20\.10\.2026/);
  assert.match(result, /Начало[\s\S]*Не указано/);
  assert.match(result, /Окончание[\s\S]*Не указано/);
  assert.match(result, /Старший[\s\S]*Не указан/);
  assert.match(result, /Инструкция[\s\S]*Не передана/);
  assert.doesNotMatch(result, /00:00/);
});

test('acknowledged assignment keeps assignment, acknowledgement and physical start as separate facts', () => {
  const result = html({ shift: shift({ execution: 'ACKNOWLEDGED', acknowledgedAt: '2026-10-20T05:00:00Z' }) });
  assert.match(result, /Назначен/);
  assert.match(result, /Ознакомление[\s\S]*Подтверждено/);
  assert.match(result, /Заступление[\s\S]*Не отмечено/);
  assert.doesNotMatch(result, /Сейчас на смене/);
});

test('actual-start card shows the recorded start independently of unknown acknowledgement', () => {
  const result = html({ shift: shift({ execution: 'STARTED', actualStart: '2026-10-20T04:05:00Z' }) });
  assert.match(result, /Сейчас на смене/);
  assert.match(result, /Заступление[\s\S]*Отмечено[\s\S]*09:05/);
  assert.match(result, /Ознакомление[\s\S]*Не подтверждено/);
});

test('available source instruction and senior are shown, with only the access-checked link supplied by the caller', () => {
  const result = html({ shift: shift({ senior: 'Старший источника', instruction: 'Проверить вход' }),
    instructionLink: React.createElement('a', { href: '/security-ops/events/88' }, 'Инструкция в ОМ') });
  assert.match(result, /Старший источника/);
  assert.match(result, /Проверить вход/);
  assert.match(result, /href="\/security-ops\/events\/88"/);
  assert.doesNotMatch(html({ shift: shift({ eventId: '88', source: 'OM' }) }), /<a\b/);
});

test('an incomplete empty source is not presented as the fact that no shift exists', () => {
  const result = html({ shift: null, incomplete: true, notes: ['Смены временно недоступны.'] });
  assert.match(result, /определить не удалось/);
  assert.match(result, /Смены временно недоступны/);
  assert.doesNotMatch(result, /Ближайших назначений нет/);
});

test('the card retry uses the supplied recovery action and is disabled while it runs', () => {
  let retries = 0;
  const tree = subject({ shift: null, incomplete: true, onRetry: () => retries++, retrying: true });
  const nodes = [];
  const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return;
    nodes.push(node); visit(node.props?.children); };
  visit(tree);
  const button = nodes.find(node => node.type === 'button');
  assert.equal(button.props.disabled, true);
  button.props.onClick();
  assert.equal(retries, 1);
});

test('an explicitly permitted own acknowledgement button reports pending separately from attendance', () => {
  const acknowledgement = { canSubmit: true, busy: false, pending: false, succeeded: false, errorMessage: null, onSubmit() {} };
  const eligible = shift({ canAcknowledge: true, acknowledgementToken: 'a'.repeat(64) });
  assert.match(html({ shift: eligible, acknowledgement }), /Ознакомлен, заступлю/);
  acknowledgement.busy = true; acknowledgement.pending = true; acknowledgement.canSubmit = false;
  const result = html({ shift: eligible, acknowledgement });
  assert.match(result, /disabled=""[^>]*>Подтверждаем ознакомление/);
  assert.match(result, /Заступление[\s\S]*Не отмечено/);
  assert.doesNotMatch(result, /Сейчас на смене/);
});

test('the new personal acknowledgement action is absent for OM and unpermitted rows', () => {
  const acknowledgement = { canSubmit: true, busy: false, pending: false, succeeded: false, errorMessage: null, onSubmit() {} };
  for (const selected of [shift({ canAcknowledge: false }), shift({ source: 'OM', canAcknowledge: true })]) {
    assert.doesNotMatch(html({ shift: selected, acknowledgement }), /Ознакомлен, заступлю/);
  }
});

test('acknowledgement failure asks for refresh while facts remain unconfirmed', () => {
  const result = html({ shift: shift({ canAcknowledge: true }), acknowledgement: {
    canSubmit: false, busy: false, pending: false, succeeded: false,
    errorMessage: 'Назначение изменилось. Обновите ближайшую смену.', onSubmit() {},
  } });
  assert.match(result, /role="alert"/);
  assert.match(result, /Обновите ближайшую смену/);
  assert.match(result, /Ознакомление[\s\S]*Не подтверждено/);
  assert.match(result, /Заступление[\s\S]*Не отмечено/);
});
