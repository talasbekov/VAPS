import type { AssistantTask } from './model';

export function progressPresentation(task: AssistantTask) {
  const progress = task.event?.progress;
  if (!progress || task.status === 'event_unavailable') return null;
  const closed = progress.collectionClosed === true || ['APPROVAL', 'ACKNOWLEDGEMENT', 'CONDUCT', 'CLOSED'].includes(task.event!.stage);
  return { ...progress, closed, departments: progress.departments.map(row => ({ ...row,
    overdue: !closed && row.overdue,
    label: row.status === 'ACCEPTED' ? 'Состав принят' : row.status === 'SUBMITTED' ? 'Список передан в Штаб'
      : row.status === 'RETURNED' ? 'Исправляют ответ' : row.responded === 0 ? 'Выделить людей не могут'
      : row.responded === null ? 'Нет ответа' : 'Подбирают людей',
  })) };
}
