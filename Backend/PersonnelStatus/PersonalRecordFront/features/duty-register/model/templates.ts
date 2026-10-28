export interface DutyTemplateDraft {
  service_duty_code: string; planned_start: string; planned_end: string;
  location_label: string; document_basis: string; note: string;
}
export interface DutyTemplate {
  id: string; name: string; kind: string; start_time: string; duration_minutes: number;
  location_label: string; document_basis: string; note: string;
}

export interface ServerDutyTemplate extends DutyTemplate {
  owner_division_id: number | null; owner_division_name: string; revision: number;
  can_manage: boolean; time_zone: string;
}
export interface DutyTemplateList {
  results: ServerDutyTemplate[]; owner_choices: { id: number; name: string }[];
  can_create: boolean; time_zone: string;
}

/** Local rows are imported only through an explicit click; operational fields never travel. */
export function serverTemplatePayload(row: DutyTemplate, owner: string | number | null, revision = 0) {
  const ownerId = owner === null ? null : Number(owner);
  if (!isTemplate(row) || (ownerId !== null && (!Number.isSafeInteger(ownerId) || ownerId <= 0)) || !Number.isInteger(revision) || revision < 0) return fail('Некорректные параметры шаблона.');
  return { id: row.id, expected_revision: revision, owner_division_id: ownerId,
    name: row.name, kind: row.kind, start_time: row.start_time, duration_minutes: row.duration_minutes,
    location_label: row.location_label, document_basis: row.document_basis, note: row.note };
}
type TemplateStorage = Pick<Storage, 'getItem' | 'setItem'>;
const MAX_TEMPLATES = 50;
const MAX_MINUTES = 366 * 24 * 60;
export class DutyTemplateError extends Error {}
const fail = (message: string): never => { throw new DutyTemplateError(message); };
const nameKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');

function localMinute(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return fail('Укажите корректные дату и время смены.');
  // UTC is only a calendar arithmetic carrier. These are local wall-clock
  // inputs, not instants to convert through the browser's own time zone.
  const stamp = Date.parse(value + ':00Z');
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 16) !== value) return fail('Укажите корректные дату и время смены.');
  return stamp;
}
function isTemplate(value: unknown): value is DutyTemplate {
  if (!value || typeof value !== 'object') return false;
  const row = value as DutyTemplate;
  return typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 100 &&
    typeof row.name === 'string' && Boolean(row.name.trim()) && row.name.length <= 120 &&
    typeof row.kind === 'string' && Boolean(row.kind.trim()) && row.kind.length <= 100 &&
    typeof row.start_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(row.start_time) &&
    Number.isInteger(row.duration_minutes) && row.duration_minutes > 0 && row.duration_minutes <= MAX_MINUTES &&
    typeof row.location_label === 'string' && row.location_label.length <= 500 &&
    typeof row.document_basis === 'string' && row.document_basis.length <= 500 &&
    typeof row.note === 'string' && row.note.length <= 10000;
}
export function templateFromDraft(id: string, name: string, draft: DutyTemplateDraft): DutyTemplate {
  const duration = (localMinute(draft.planned_end) - localMinute(draft.planned_start)) / 60000;
  if (duration <= 0 || duration > MAX_MINUTES) return fail('Завершение должно быть позже начала; интервал шаблона — не более 366 дней.');
  const row = { id, name: name.trim(), kind: draft.service_duty_code, start_time: draft.planned_start.slice(11), duration_minutes: duration,
    location_label: draft.location_label.trim(), document_basis: draft.document_basis.trim(), note: draft.note.trim() };
  if (!isTemplate(row)) return fail('Укажите название, действующий вид и корректные параметры шаблона.');
  return row;
}
export function projectDutyTemplate(template: DutyTemplate, date: string): DutyTemplateDraft {
  if (!isTemplate(template) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Выберите корректную дату смены.');
  const start = date + 'T' + template.start_time;
  const end = new Date(localMinute(start) + template.duration_minutes * 60000).toISOString().slice(0, 16);
  localMinute(end);
  return { service_duty_code: template.kind, planned_start: start, planned_end: end,
    location_label: template.location_label, document_basis: template.document_basis, note: template.note };
}
export function dutyTemplateStorageKey(actor: string, scope: string, zone: string) {
  if (!actor || !scope || !zone) return fail('Не удалось проверить учётную запись и область шаблонов.');
  return 'smart-josparlau:duty-templates:v1:' + encodeURIComponent(JSON.stringify([actor, scope, zone]));
}
export function readDutyTemplates(storage: TemplateStorage, actor: string, scope: string, zone: string): DutyTemplate[] {
  const raw = storage.getItem(dutyTemplateStorageKey(actor, scope, zone));
  if (raw === null) return [];
  let value: { version?: number; templates?: unknown };
  try { if (raw.length > 650000) return fail('Сохранённые шаблоны повреждены.'); value = JSON.parse(raw); }
  catch { return fail('Не удалось прочитать сохранённые шаблоны. Они не были изменены.'); }
  if (value?.version !== 1 || !Array.isArray(value.templates) || value.templates.length > MAX_TEMPLATES || !value.templates.every(isTemplate)) return fail('Сохранённые шаблоны повреждены. Они не были изменены.');
  const rows: DutyTemplate[] = value.templates;
  if (new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => nameKey(row.name))).size !== rows.length) return fail('Сохранённые шаблоны содержат повторения. Они не были изменены.');
  // Project an allowlist: browser storage must not introduce employee IDs,
  // execution facts or other fields into a newly created duty record.
  return rows.map(row => ({ id: row.id, name: row.name, kind: row.kind, start_time: row.start_time, duration_minutes: row.duration_minutes,
    location_label: row.location_label, document_basis: row.document_basis, note: row.note }));
}
export function saveDutyTemplate(storage: TemplateStorage, actor: string, scope: string, zone: string, template: DutyTemplate) {
  if (!isTemplate(template)) return fail('Параметры шаблона некорректны.');
  const rows = readDutyTemplates(storage, actor, scope, zone);
  if (rows.length >= MAX_TEMPLATES) return fail('Сохранено 50 шаблонов. Удалите ненужный перед добавлением нового.');
  if (rows.some(row => row.id === template.id || nameKey(row.name) === nameKey(template.name))) return fail('Шаблон с таким названием уже есть. Укажите другое название.');
  const next = [...rows, template];
  storage.setItem(dutyTemplateStorageKey(actor, scope, zone), JSON.stringify({ version: 1, templates: next }));
  return next;
}
export function removeDutyTemplate(storage: TemplateStorage, actor: string, scope: string, zone: string, id: string) {
  const rows = readDutyTemplates(storage, actor, scope, zone);
  if (!rows.some(row => row.id === id)) return fail('Шаблон уже удалён. Обновите список.');
  const next = rows.filter(row => row.id !== id);
  storage.setItem(dutyTemplateStorageKey(actor, scope, zone), JSON.stringify({ version: 1, templates: next }));
  return next;
}
