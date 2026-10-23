import type { DepartmentRequestRow } from '@/entities/security-event';

export type WorkdeskKind = 'admin' | 'department' | 'commander' | 'status' | 'personal';
/** Presentation from already-authorized destinations, never an authorization rule. */
export function workdeskKind(tasks: readonly { id: string }[], administrator: boolean): WorkdeskKind {
  if (administrator) return 'admin';
  if (tasks.some(task => task.id === 'department-forces')) return 'department';
  if (tasks.some(task => task.id === 'assistant')) return 'commander';
  if (tasks.some(task => task.id === 'statuses')) return 'status';
  return 'personal';
}

export const WORKDESK_COPY: Record<WorkdeskKind, { title: string; description: string }> = {
  admin: { title: 'Доступ и пользователи', description: 'Учётные записи, рабочие роли и доступ к подразделениям.' },
  department: { title: 'Работа департамента', description: 'Запросы на людей и ежедневная работа вашего подразделения.' },
  commander: { title: 'Поручения и подготовка наряда', description: 'Поставьте задачу и следите за её выполнением здесь.' },
  status: { title: 'Люди и ежедневная работа', description: 'Отметьте изменения по сотрудникам и проверьте дежурства.' },
  personal: { title: 'Мои задания и дежурства', description: 'Ближайшее назначение и всё необходимое для вашей работы.' },
};

export function departmentWorkRow(row: DepartmentRequestRow) {
  const closed = ['APPROVAL', 'ACKNOWLEDGEMENT', 'CONDUCT', 'CLOSED'].includes(row.stage);
  const answered = ['SUBMITTED', 'ACCEPTED', 'DECLINED'].includes(row.status);
  const action = closed ? 'Посмотреть запрос' : row.status === 'RETURNED' ? 'Исправить ответ'
    : answered ? 'Посмотреть ответ' : row.allocating === null ? 'Подготовить ответ' : 'Продолжить подбор';
  const tone: 'quiet' | 'attention' | 'active' = closed || answered ? 'quiet' : row.overdue || row.status === 'RETURNED' ? 'attention' : 'active';
  const params = new URLSearchParams({ view: 'forces', tab: 'requests', request: row.allocationId, businessDate: row.businessDate });
  return { href: `/employees?${params}`, action, tone,
    detail: `Запрошено ${row.need} чел.${row.allocating === null ? '' : ` · Ответ: ${row.allocating} чел.`}`,
    status: closed ? 'Сбор завершён' : row.status === 'RETURNED' ? 'Возвращён на исправление'
      : answered ? 'Ответ передан' : row.overdue ? 'Срок ответа прошёл' : row.allocating !== null ? 'Идёт подбор' : 'Ожидает ответа' };
}
