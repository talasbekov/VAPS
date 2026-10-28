import type { SkillKey } from './service-profile';

export interface QualificationAssessment {
  id: string; skill: SkillKey; score: number; assessed_on: string;
  valid_until: string | null; basis: string; recorded_by: string;
  recorded_by_name: string; created_at: string;
}
export type QualificationState = 'valid' | 'expired' | 'unknown';
export interface QualificationsResponse {
  revision: number; can_edit: boolean; today: string;
  current: Record<SkillKey, { state: QualificationState; assessment: QualificationAssessment | null }>;
  history: { results: QualificationAssessment[]; count: number; page: number; page_size: number };
}
export interface AssessmentDraft { skill: SkillKey; score: string; assessed_on: string; valid_until: string; basis: string }
export interface AssessmentInput { skill: SkillKey; score: number; assessed_on: string; valid_until: string | null; basis: string }
const skills = ['shooting', 'hand_to_hand', 'physical_fitness'];
function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}
export function assessmentFromDraft(draft: AssessmentDraft, today: string): AssessmentInput {
  if (!skills.includes(draft.skill)) throw new Error('Выберите навык.');
  if (!/^[1-5]$/.test(draft.score)) throw new Error('Укажите оценку от 1 до 5.');
  if (!isDate(today) || !isDate(draft.assessed_on) || draft.assessed_on > today) throw new Error('Укажите дату проверки не позднее сегодняшнего дня.');
  if (draft.valid_until && (!isDate(draft.valid_until) || draft.valid_until < draft.assessed_on)) throw new Error('Срок действия не может закончиться раньше проверки.');
  const basis = draft.basis.trim();
  if (!basis || basis.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(basis)) throw new Error('Укажите основание проверки до 1000 символов.');
  return {skill: draft.skill, score: Number(draft.score), assessed_on: draft.assessed_on, valid_until: draft.valid_until || null, basis};
}
export function qualificationStateLabel(state: QualificationState) {
  return state === 'valid' ? 'Срок не истёк' : state === 'expired' ? 'Истёк срок действия' : 'Не подтверждена актуальность';
}

