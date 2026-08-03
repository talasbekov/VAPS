"use client";

import { useAuth, ROLES } from "@/lib/auth";
import { motion } from "framer-motion";
import {
  Building2,
  Users,
  Shield,
  FileText,
  Settings,
  BarChart3,
  MessageSquarePlus,
  // Иконки раздела «Охранные мероприятия» (Smart Josparlau, Этап M4) — только
  // добавка, существующая навигация не изменялась.
  CalendarDays,
  ClipboardList,
  Landmark,
  LineChart,
  ScrollText,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import "./sidebar.css";

export function Sidebar() {
  const { user, hasPermission } = useAuth();
  const userRole = user ? ROLES[user.role] : null;

  const navigation = [
    {
      name: "Обзор",
      href: "/dashboard",
      icon: BarChart3,
      resource: "organization",
      action: "read",
    },
    {
      name: "Структура организации",
      href: "/organization",
      icon: Building2,
      resource: "organization",
      action: "read",
    },
    {
      name: "Управление персоналом",
      href: "/employees",
      icon: Users,
      resource: "employees",
      action: "read",
    },
    {
      name: "Статусы сотрудников",
      href: "/statuses",
      icon: Shield,
      resource: "statuses",
      action: "read",
    },
    {
      name: "Отчеты",
      href: "/reports",
      icon: FileText,
      resource: "reports",
      action: "read",
    },
    {
      name: "Настройки",
      href: "/settings",
      icon: Settings,
      resource: "settings",
      action: "read",
    },
  ];

  // FIX: на /ops и /security-ops пользователь может быть не залогинен в хост
  // (middleware эти пути не закрывает) — фильтр по правам оставлял верх
  // сайдбара пустым, и старые модули «исчезали». Без host-логина показываем
  // базовую навигацию целиком (страницы защищают себя сами); для
  // залогиненных фильтр по ролям работает как раньше.
  const filteredNavigation =
    user === null
      ? navigation
      : navigation.filter((item) => hasPermission(item.resource, item.action));

  // Раздел «Охранные мероприятия» (Smart Josparlau, Этап M4) — ДОБАВКА:
  // ссылки ведут в перенесённый SPA на /ops/*, права внутри проверяет он сам
  // (demo-persona). Донорские дубли (персонал, расход, отчёты) не дублируются —
  // их живые версии выше, в основной навигации.
  const opsNavigation = [
    { name: "Командный центр", href: "/ops/command-center", icon: LineChart },
    { name: "Реестр ОМ", href: "/ops/security-events", icon: ClipboardList },
    { name: "Объекты и паспорта", href: "/ops/objects", icon: Landmark },
    { name: "План дежурств", href: "/ops/duties", icon: CalendarDays },
    { name: "Календарь смен", href: "/ops/calendar", icon: CalendarDays },
    { name: "Аналитика службы", href: "/ops/analytics", icon: BarChart3 },
    { name: "Аналитика мероприятий", href: "/ops/analytics/operations", icon: BarChart3 },
    { name: "Оценивание участников", href: "/ops/ratings/workspace", icon: Star },
    { name: "Итоговые оценки", href: "/ops/ratings/evaluations", icon: Star },
    { name: "Оперативный рейтинг", href: "/ops/ratings", icon: Star },
    { name: "Журнал оценивания", href: "/ops/ratings/audit", icon: ScrollText },
    { name: "Выгрузка рейтинга", href: "/ops/ratings/export", icon: FileText },
    { name: "Аналитика рейтинга", href: "/ops/ratings/analytics", icon: BarChart3 },
    { name: "Отчёты службы", href: "/ops/service-reports", icon: FileText },
    { name: "Аудит", href: "/ops/audit", icon: ScrollText },
    { name: "Справочники", href: "/ops/dictionaries", icon: ClipboardList },
    { name: "Настройки ОМ", href: "/ops/settings", icon: Settings },
  ];

  // Раздел «Охранные мероприятия (натив)» — ДОБАВКА нативного порта Smart
  // Josparlau: страницы в стеке хоста (app/security-ops/*), в отличие от
  // /ops/* (смонтированная SPA). Права проверяют сами страницы
  // (hooks/use-ops-permissions), фильтрации здесь нет — как у opsNavigation.
  const nativeOpsNavigation = [
    { name: "Командный центр", href: "/security-ops/command-center", icon: LineChart },
    { name: "Реестр ОМ", href: "/security-ops/events", icon: ClipboardList },
    { name: "Объекты и паспорта", href: "/security-ops/objects", icon: Landmark },
    { name: "План дежурств", href: "/security-ops/duties", icon: CalendarDays },
    { name: "Календарь смен", href: "/security-ops/calendar", icon: CalendarDays },
  ];

  return (
    <aside className="h-screen w-full bg-sidebar border-r border-sidebar-border shadow-lg flex flex-col">
      {/* Логотип */}
      <div className="sidebar-header flex items-center justify-center h-16 px-4 bg-primary flex-shrink-0">
        <div className="flex items-center">
          <motion.div
            whileHover={{ rotate: 15, scale: 1.1 }}
            transition={{ type: "spring" as const, stiffness: 400 }}
          >
            <Building2 className="h-8 w-8 text-primary-foreground mr-3" />
          </motion.div>
          <span className="text-primary-foreground font-bold text-lg whitespace-nowrap">
            Проект Расход
          </span>
        </div>
      </div>

      {/* Навигация */}
      <nav className="mt-6 px-4 flex-1 overflow-y-auto">
        <ul className="space-y-1">
          {filteredNavigation.map((item, index) => (
            <li
              key={item.name}
              className="sidebar-nav-item"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <motion.a
                href={item.href}
                className="flex items-center px-6 py-4 text-base font-semibold rounded-xl transition-colors text-sidebar-foreground hover:bg-sidebar-accent"
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
                transition={{
                  type: "spring" as const,
                  stiffness: 400,
                  damping: 25,
                }}
              >
                <motion.div
                  whileHover={{ scale: 1.15, rotate: 8 }}
                  transition={{ type: "spring" as const, stiffness: 400 }}
                  className="mr-4"
                >
                  <item.icon className="h-6 w-6" />
                </motion.div>
                <span>{item.name}</span>
              </motion.a>
            </li>
          ))}
        </ul>

        {/* Охранные мероприятия (натив) — добавка нативного порта. */}
        <div className="mt-6">
          <div className="px-6 pb-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">
            Охранные мероприятия (натив)
          </div>
          <ul className="space-y-1">
            {nativeOpsNavigation.map((item) => (
              <li key={item.href} className="sidebar-nav-item">
                <motion.a
                  href={item.href}
                  className="flex items-center px-6 py-3 text-sm font-semibold rounded-xl transition-colors text-sidebar-foreground hover:bg-sidebar-accent"
                  whileHover={{ x: 4 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{
                    type: "spring" as const,
                    stiffness: 400,
                    damping: 25,
                  }}
                >
                  <item.icon className="mr-4 h-5 w-5" />
                  <span>{item.name}</span>
                </motion.a>
              </li>
            ))}
          </ul>
        </div>

        {/* Охранные мероприятия (Smart Josparlau, Этап M4) — добавка. */}
        <div className="mt-6">
          <div className="px-6 pb-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">
            Охранные мероприятия
          </div>
          <ul className="space-y-1">
            {opsNavigation.map((item) => (
              <li key={item.href} className="sidebar-nav-item">
                <motion.a
                  href={item.href}
                  className="flex items-center px-6 py-3 text-sm font-semibold rounded-xl transition-colors text-sidebar-foreground hover:bg-sidebar-accent"
                  whileHover={{ x: 4 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{
                    type: "spring" as const,
                    stiffness: 400,
                    damping: 25,
                  }}
                >
                  <item.icon className="mr-4 h-5 w-5" />
                  <span>{item.name}</span>
                </motion.a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      {/* Обратная связь */}
      <div className="px-4 pb-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <motion.a
                href="/feedback"
                className="sidebar-feedback w-full flex items-center px-6 py-4 text-base font-semibold rounded-xl transition-colors text-sidebar-foreground hover:bg-sidebar-accent"
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
                transition={{
                  type: "spring" as const,
                  stiffness: 400,
                  damping: 25,
                }}
              >
                <motion.div
                  whileHover={{ scale: 1.15, rotate: 8 }}
                  transition={{ type: "spring" as const, stiffness: 400 }}
                  className="mr-4"
                >
                  <MessageSquarePlus className="h-6 w-6" />
                </motion.div>
                <span>Обратная связь</span>
              </motion.a>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Чат обратной связи</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Информация о роли */}
      {userRole && (
        <div className="px-4 pb-6 flex-shrink-0 sidebar-role-card">
          <motion.div
            className="bg-sidebar-accent rounded-xl p-4 shadow-md border border-sidebar-border"
            whileHover={{ scale: 1.02 }}
            transition={{ type: "spring" as const, stiffness: 400 }}
          >
            <p className="text-sm font-semibold text-sidebar-foreground mb-2">
              Текущая роль
            </p>
            <Badge className={`text-sm px-2 py-1 ${userRole.color}`}>
              {userRole.name}
            </Badge>
            <p className="text-sm text-sidebar-foreground/80 mt-2">
              {userRole.description}
            </p>
            <div className="mt-3 text-sm text-sidebar-foreground/70 font-medium">
              Отдел: {user?.department}
            </div>
          </motion.div>
        </div>
      )}
    </aside>
  );
}
