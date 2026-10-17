import type { DutyEmployeeChoice, DutyIdentifier } from '@/entities/duty-register';

export interface DutyCreationBody {
  employee_id: DutyIdentifier; service_duty_code: string; client_request_id: string;
  planned_start: string; planned_end: string; location_label: string; document_basis: string; note: string;
}
export interface PendingDutyCreation {
  version: 1; scope: string; zone: string; body: DutyCreationBody; person: DutyEmployeeChoice; kindLabel: string;
}
const storageKey = (actor: string) => 'smart-josparlau:duty-create:' + encodeURIComponent(actor);
const noncePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PENDING_DUTY_CREATION_EVENT = 'smart-josparlau:duty-create-changed';

export function readPendingCreation(actor: string): PendingDutyCreation | null {
  if (!actor) return null;
  const raw = sessionStorage.getItem(storageKey(actor));
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingDutyCreation;
  const body = value?.body;
  if (raw.length > 60000 || value?.version !== 1 || typeof value.scope !== 'string' || typeof value.zone !== 'string' || !body ||
      !noncePattern.test(body.client_request_id) || !['planned_start', 'planned_end', 'service_duty_code', 'location_label', 'document_basis', 'note'].every(field => typeof body[field as keyof DutyCreationBody] === 'string') ||
      !value.person || String(value.person.employee_id) !== String(body.employee_id) || typeof value.person.employee_name !== 'string' || typeof value.kindLabel !== 'string') {
    throw new Error('Не удалось восстановить исходную попытку сохранения. Данные браузера повреждены.');
  }
  return value;
}
export function rememberPendingCreation(actor: string, value: PendingDutyCreation) {
  if (!actor) throw new Error('Не удалось проверить учётную запись.');
  const previous = readPendingCreation(actor);
  if (previous && previous.body.client_request_id !== value.body.client_request_id) throw new Error('Есть другая незавершённая попытка. Откройте форму заново, чтобы проверить её.');
  sessionStorage.setItem(storageKey(actor), JSON.stringify(value));
  window.dispatchEvent(new Event(PENDING_DUTY_CREATION_EVENT));
}
export function forgetPendingCreation(actor: string, nonce: string) {
  if (readPendingCreation(actor)?.body.client_request_id === nonce) {
    sessionStorage.removeItem(storageKey(actor));
    window.dispatchEvent(new Event(PENDING_DUTY_CREATION_EVENT));
  }
}
