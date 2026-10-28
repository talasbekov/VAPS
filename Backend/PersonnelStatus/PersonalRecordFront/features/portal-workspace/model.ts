import { defaultPortalRoute, moduleOpenFor } from '@/entities/portal-access';

export const PORTAL_HOME_PATH = '/workspace';
export interface PortalTask {
  id: string;
  title: string;
  description: string;
  href: string;
  accessHref: string;
}
interface TaskAccess {
  permissions: ReadonlySet<string> | undefined;
  roles: readonly { code: string }[];
  hasPermission(code: string): boolean;
  hasGlobalPermission(code: string): boolean;
  isLoading: boolean;
  error: unknown;
}
const task = (id: string, title: string, description: string, href: string): PortalTask => ({
  id, title, description, href, accessHref: href.split('?')[0],
});
const personal = task('personal', 'Мои задания и дежурства', 'Посмотреть свои назначения и сведения о себе.', '/security-ops/profile');

/** Presentation only: every destination still enforces its existing page/API gates. */
export function portalWorkspace(access: TaskAccess): { primary: PortalTask[]; more: PortalTask[] } {
  if (access.isLoading || access.error || access.permissions === undefined) return { primary: [], more: [] };
  const can = access.hasPermission;
  const hasRole = (code: string) => access.roles.some(role => role.code === code);
  const preferred = defaultPortalRoute(can, hasRole, access.permissions);
  if (preferred === personal.accessHref && !access.hasGlobalPermission('admin.roles')) return { primary: [personal], more: [] };
  const tasks: PortalTask[] = [];
  const add = (entry: PortalTask) => { if (moduleOpenFor(entry.accessHref, can, hasRole)) tasks.push(entry); };
  const administrator = access.hasGlobalPermission('admin.roles');
  if (administrator) {
    add(task('users', 'Пользователи', 'Создать учётку, связать сотрудника и назначить доступ.', '/settings/users'));
    add(task('roles', 'Роли и права', 'Проверить, что разрешено каждой рабочей роли.', '/settings/roles'));
    add(task('settings', 'Настройки системы', 'Изменить общие параметры приложения.', '/security-ops/settings'));
    add(task('audit', 'Журнал действий', 'Проверить сохранённые изменения и действия пользователей.', '/security-ops/audit'));
  }
  if (can('forces.command')) add(task('headquarters', 'Распределения Штаба', 'Подготовить сбор, проверить ответы и передать людей на расстановку.', '/employees?view=forces&tab=collections'));
  if (can('forces.allocate')) add(task('department-forces', 'Ответить на запрос людей', 'Открыть входящие запросы и подготовить ответ своего подразделения.', '/employees?view=forces&tab=requests'));
  add(task('statuses', can('status.manage') ? 'Отметить статусы сотрудников' : 'Посмотреть личный состав', 'Проверить присутствие и доступность людей своего подразделения.', '/statuses'));
  add(task('daily', 'Ежедневный расход', 'Проверить состав, сдачу подразделений и доступные действия со сводом.', '/daily-expense'));
  add(task('assistant', 'Подготовить наряд', 'Описать поручение или продолжить уже сохранённое.', '/security-ops/assistant'));
  add(task('events', 'Продолжить работу по ОМ', 'Открыть мероприятие и выполнить свой текущий этап.', '/security-ops/events'));
  add(task('summary', 'Проверить свод по Службе', 'Увидеть состояние подразделений на выбранную дату.', '/security-ops/service-summary'));
  if (['duty.view', 'duty.manage', 'status.manage', 'duty.dispatch'].some(can)) add(task('duties', 'Посмотреть дежурства', 'Открыть график и журнал дежурств.', '/security-ops/duty-register'));
  add(task('objects', 'Объекты и паспорта', 'Найти объект и проверить его паспорт.', '/security-ops/objects'));
  add(task('overview', 'Обзор подразделения', 'Посмотреть структуру и состояние личного состава.', '/dashboard'));
  const reportHref = moduleOpenFor('/reports', can) ? '/reports' : '/security-ops/service-reports';
  add(task('reports', 'Подготовить отчёт', 'Выбрать нужный отчёт и сформировать документ.', reportHref));
  add(task('service-analytics', 'Аналитика службы', 'Проверить показатели личного состава и подразделений.', '/security-ops/analytics'));
  add(task('om-analytics', 'Аналитика мероприятий', 'Проверить подготовку и результаты охранных мероприятий.', '/security-ops/analytics/operations'));
  if (!administrator) tasks.sort((a, b) => Number(b.accessHref === preferred) - Number(a.accessHref === preferred));
  tasks.push(personal);
  return { primary: tasks.slice(0, 3), more: tasks.slice(3) };
}

/** Change a work mode without carrying a target from the previous mode. */
export function portalTaskHref(entry: PortalTask, current: URLSearchParams): string {
  if (entry.accessHref !== '/employees' && entry.accessHref !== '/daily-expense') return entry.href;
  const query = new URLSearchParams(current);
  for (const key of ['employee', 'request', 'collection', 'campaign', 'tab', 'view']) query.delete(key);
  for (const [key, value] of new URLSearchParams(entry.href.split('?')[1])) query.set(key, value);
  return `${entry.accessHref}${query.size ? `?${query}` : ''}`;
}

export function activePortalTask(tasks: readonly PortalTask[], path: string, query: URLSearchParams): string | undefined {
  const pathname = path.replace(/\/$/, '') || '/';
  if (['/reports', '/security-ops/service-reports'].some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))) {
    return tasks.find(entry => entry.id === 'reports')?.id;
  }
  const matches = tasks.filter(entry => pathname === entry.accessHref || pathname.startsWith(entry.accessHref + '/'));
  if (pathname === '/employees') {
    if (query.get('collection') || query.get('campaign') || query.get('tab') === 'collections') return matches.find(entry => entry.id === 'headquarters')?.id;
    if (query.get('view') === 'daily' || query.get('view') === 'department-summary') return matches.find(entry => entry.id === 'daily')?.id;
    return matches.find(entry => entry.id === 'department-forces')?.id ?? matches.find(entry => entry.id === 'headquarters')?.id;
  }
  return matches.sort((a, b) => b.accessHref.length - a.accessHref.length)[0]?.id;
}
