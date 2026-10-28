export const PASSPORT_TABS = [
  { code: 'general', label: 'Общие данные' },
  { code: 'posts', label: 'Посты и секторы' },
  { code: 'check', label: 'Обследования' },
  { code: 'history', label: 'История' },
] as const;
export type PassportTab = typeof PASSPORT_TABS[number]['code'];
export function passportTab(value: string | null): PassportTab {
  return PASSPORT_TABS.find(tab => tab.code === value)?.code ?? 'general';
}
export interface InspectionUser { id: string; username: string; name: string }
export interface InspectionItemDraft {
  id: string; question: string; answer: '' | 'yes' | 'no' | 'na';
  finding: string; responsibleUsername: string; dueOn: string | null;
}
export interface InspectionItem extends InspectionItemDraft {
  responsible: InspectionUser | null; resolution: string;
  resolvedAt: string | null; resolvedBy: InspectionUser | null;
}
export interface ObjectInspection {
  id: string; objectId: string; inspectedOn: string; reviewer: InspectionUser;
  items: InspectionItem[]; revision: number; state: 'draft' | 'completed';
  completedAt: string | null; updatedAt: string; openFindings: number; overdueFindings: number;
}
export interface InspectionDraft { inspectedOn: string; items: InspectionItemDraft[] }
export interface InspectionList {
  results: ObjectInspection[]; count: number; page: number; hasNext: boolean;
  today: string; currentUser: InspectionUser; canManage: boolean;
}
export function inspectionDraft(row: Pick<ObjectInspection, 'inspectedOn' | 'items'>): InspectionDraft {
  return { inspectedOn: row.inspectedOn, items: row.items.map(({id, question, answer, finding, responsibleUsername, dueOn}) =>
    ({id, question, answer, finding, responsibleUsername, dueOn})) };
}
export function inspectionCompletionIssue(draft: Pick<InspectionDraft, 'items'>): string | null {
  if (!draft.items.length) return 'Добавьте хотя бы один вопрос.';
  if (draft.items.some(item => !item.question.trim() || !item.answer)) return 'Ответьте на каждый вопрос.';
  if (draft.items.some(item => item.answer === 'no' && (!item.finding.trim() || !item.responsibleUsername.trim() || !item.dueOn)))
    return 'Для каждого замечания укажите ответственного и срок устранения.';
  return null;
}

