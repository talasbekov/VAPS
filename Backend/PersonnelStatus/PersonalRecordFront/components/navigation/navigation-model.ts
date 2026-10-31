import { BarChart3, Building2, Car, ClipboardCheck, ClipboardList, FileText, House, KeyRound, Landmark, LineChart, MessageSquarePlus, Scale, ScrollText, Settings, Shield, ShieldCheck, Sparkles, UserRound, Users, type LucideIcon } from 'lucide-react';
import { moduleOpenFor } from '@/entities/portal-access';
import { portalTaskHref } from '@/features/portal-workspace/model';

export type NavigationSectionId = 'daily' | 'duty' | 'events' | 'personal';
export type NavigationItem = { name: string; href: string; icon: LucideIcon; match?: string[]; counter?: 'events'; alternatives?: string[] };
export type NavigationSection = { id: NavigationSectionId; title: string; items: NavigationItem[] };
type Access = {
  permissions: ReadonlySet<string> | undefined; isLoading: boolean; error: unknown;
  roles: readonly { code: string }[];
  serviceEmployeesAccess?: boolean;
  hasPermission(code: string): boolean;
  hasGlobalPermission(code: string): boolean;
};
const reports: NavigationItem = { name: 'Дежурства и документы ОМ', href: '/security-ops/service-reports', icon: FileText };

// Presentation only. Every destination retains its existing page/API guards.
export const NAVIGATION_SECTIONS: NavigationSection[] = [
  { id: 'daily', title: 'Ежедневный расход', items: [
    { name: 'Обзор', href: '/dashboard', icon: BarChart3 },
    { name: 'Структура организации', href: '/organization', icon: Building2 },
    { name: 'Статусы сотрудников', href: '/statuses', icon: Shield },
    { name: 'Ежедневный расход организации', href: '/employees?view=daily', icon: ClipboardCheck },
    { name: 'Свод по Службе', href: '/security-ops/service-summary', icon: ClipboardCheck },
    { name: 'Аналитика службы', href: '/security-ops/analytics', icon: LineChart },
    { name: 'Расход и кадровые отчёты', href: '/reports', icon: FileText },
  ] },
  { id: 'duty', title: 'Боевое дежурство', items: [
    { name: 'Журнал дежурств', href: '/security-ops/duty-register', match: ['/security-ops/combat-duty', '/security-ops/duty-dispatch'], icon: ClipboardList },
    { name: 'Объекты и паспорта', href: '/security-ops/objects', icon: Landmark },
    reports,
  ] },
  { id: 'events', title: 'Охранное мероприятие', items: [
    { name: 'Реестр ОМ', href: '/security-ops/events', match: ['/security-ops/visits'], icon: ClipboardList, counter: 'events' },
    { name: 'Помощник по ОМ', href: '/security-ops/assistant', icon: Sparkles },
    { name: 'Оперативный контроль', href: '/security-ops/command-center', icon: LineChart },
    { name: 'Сбор сил на ОМ', href: '/employees?view=forces', icon: Users },
    { name: 'Охраняемые лица', href: '/security-ops/persons', icon: UserRound },
    { name: 'Законы об ОМ', href: '/security-ops/laws', icon: Scale },
    { name: 'Транспорт ГОН', href: '/security-ops/vehicles', icon: Car },
    { name: 'Аналитика ОМ', href: '/security-ops/analytics/operations', icon: LineChart },
    { name: 'Оперативный рейтинг', href: '/security-ops/ratings', icon: BarChart3,
      match: ['/security-ops/ratings'], alternatives: ['/security-ops/ratings/workspace', '/security-ops/ratings/evaluations', '/security-ops/ratings/export', '/security-ops/ratings/audit', '/security-ops/ratings/analytics'] },
    reports,
  ] },
  { id: 'personal', title: 'Мой профиль', items: [
    { name: 'Мой профиль', href: '/security-ops/profile', icon: UserRound },
  ] },
];
export const COMMON_ITEMS: NavigationItem[] = [
  { name: 'Моя работа', href: '/workspace', icon: House },
  { name: 'Сотрудники подразделения', href: '/service-employees', icon: Users },
  { name: 'Обратная связь', href: '/feedback', match: ['/security-ops/feedback'], icon: MessageSquarePlus },
];
export const SYSTEM_ITEMS: NavigationItem[] = [
  { name: 'Справочники', href: '/security-ops/dictionaries', icon: ClipboardList },
  { name: 'Администрирование', href: '/security-ops/settings', icon: Settings },
  { name: 'Пользователи', href: '/settings/users', icon: Users },
  { name: 'Роли', href: '/settings/roles', icon: ShieldCheck },
  { name: 'Права', href: '/settings/permissions', icon: KeyRound },
  { name: 'Аудит', href: '/security-ops/audit', icon: ScrollText },
  { name: 'Журнал изменений', href: '/security-ops/changelog', icon: ClipboardList },
];

export function navigationFor(access: Access) {
  if (access.isLoading || access.error || access.permissions === undefined) return { sections: [] as NavigationSection[], common: [] as NavigationItem[], system: [] as NavigationItem[] };
  const can = (code: string) => code === 'admin.roles' ? access.hasGlobalPermission(code) : access.hasPermission(code);
  const open = (href: string) => moduleOpenFor(href.split('?')[0], can, code => access.roles.some(role => role.code === code));
  const filter = (items: NavigationItem[]) => items.flatMap(item => {
    if (item.href === '/service-employees' && !(access.serviceEmployeesAccess ?? can('personnel.view'))) return [];
    const href = [item.href, ...(item.alternatives ?? [])].find(open);
    if (!href) return [];
    if (href === '/employees?view=daily' && !can('status.view')) return [];
    if (href === '/employees?view=forces') return [{ ...item, href: href + (can('forces.command') ? '&tab=collections' : can('forces.allocate') ? '&tab=requests' : '') }];
    return [{ ...item, href }];
  });
  return { sections: NAVIGATION_SECTIONS.map(section => ({ ...section, items: filter(section.items) })).filter(section => section.items.length > 0), common: filter(COMMON_ITEMS), system: filter(SYSTEM_ITEMS) };
}
const normalize = (path: string) => path.replace(/\/$/, '') || '/';
function employeeMode(query: URLSearchParams, defaultMode: 'daily' | 'forces') {
  if (['request', 'collection', 'campaign'].some(key => query.get(key))) return 'forces';
  return query.get('view') === 'forces' ? 'forces' : ['daily', 'department-summary'].includes(query.get('view') ?? '') ? 'daily' : defaultMode;
}
export function activeNavigationItem(items: NavigationItem[], path: string, query: URLSearchParams, defaultMode: 'daily' | 'forces' = 'daily'): NavigationItem | undefined {
  const pathname = normalize(path);
  return items.map(item => {
    if (pathname === '/employees' && item.href.startsWith('/employees?')) return { item, score: new URLSearchParams(item.href.split('?')[1]).get('view') === employeeMode(query, defaultMode) ? 1000 : 0 };
    const directory = pathname.startsWith('/security-ops/profile/') && query.get('directory') === '1';
    if (directory && item.href === '/service-employees') return { item, score: 1000 };
    if (directory && item.href === '/security-ops/profile') return { item, score: 0 };
    const score = [item.href.split('?')[0], ...(item.match ?? [])].filter(prefix => pathname === prefix || pathname.startsWith(prefix + '/')).reduce((best, prefix) => Math.max(best, prefix.length), 0);
    return { item, score };
  }).filter(match => match.score > 0).sort((a, b) => b.score - a.score)[0]?.item;
}
export function sectionForLocation(path: string, query: URLSearchParams, sections: NavigationSection[], preferred?: NavigationSectionId, defaultMode: 'daily' | 'forces' = 'daily'): NavigationSectionId | undefined {
  const best = activeNavigationItem(sections.flatMap(section => section.items), path, query, defaultMode);
  const candidates = best ? sections.filter(section => activeNavigationItem(section.items, path, query, defaultMode)?.href === best.href) : [];
  return candidates.find(section => section.id === preferred)?.id ?? candidates[0]?.id ?? sections.find(section => section.id === preferred)?.id ?? sections[0]?.id;
}
export function navigationHref(item: NavigationItem, path: string, query: URLSearchParams): string {
  return portalTaskHref({ id: item.href, title: item.name, description: '', href: item.href, accessHref: item.href.split('?')[0] }, normalize(path) === '/employees' ? query : new URLSearchParams());
}
