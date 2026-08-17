"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  ChevronDown,
  // Иконки раздела «Охранные мероприятия» (Smart Josparlau, Этап M4) — только
  // добавка, существующая навигация не изменялась.
  CalendarDays,
  ClipboardList,
  Landmark,
  LineChart,
  ScrollText,
  Scale,
  Star,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import "./sidebar.css";

/** Активность пункта: `trailingSlash: true` в конфиге, хвостовой слэш есть. */
function normalizePath(path: string): string {
  return path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
}

// Общий вид пункта: единственное место, где живёт разметка ссылки меню.
const ITEM_CLASS =
  "flex items-center rounded-xl px-4 py-3 text-[15px] font-semibold transition-colors";

function NavLink({
  href,
  name,
  icon: Icon,
  active,
}: {
  href: string;
  name: string;
  icon: typeof Building2;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      // aria-current="page" — единственный признак «вы здесь», который читает
      // скринридер; цветом он же дублируется для глаза.
      aria-current={active ? "page" : undefined}
      className={`${ITEM_CLASS} ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent"
      }`}
    >
      <Icon className="mr-3 h-5 w-5 shrink-0" aria-hidden="true" />
      <span>{name}</span>
    </Link>
  );
}

export function Sidebar() {
  const { user, hasPermission } = useAuth();
  const userRole = user ? ROLES[user.role] : null;
  const pathname = normalizePath(usePathname() ?? "");

  /** Пункт активен и на самом адресе, и на его вложенных страницах. */
  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // Явно открытые/закрытые группы. Пока человек не трогал группу, её состояние
  // выводится из адреса — открыта та, где он сейчас.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

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

  // Группа /ops/* (встроенная SPA Smart Josparlau) удалена: она дублировала
  // переписанные нативные страницы /security-ops/*; старые адреса /ops/*
  // редиректят на них (app/ops/[[...slug]]/page.tsx).

  // Раздел «Охранные мероприятия» — нативный порт Smart Josparlau: страницы
  // в стеке хоста (app/security-ops/*). Права проверяют сами страницы
  // (hooks/use-ops-permissions), фильтрации здесь нет.
  // «Мой профиль» стоит отдельно и выше групп: это единственная страница
  // раздела, которая открывается любому вошедшему без прав — она про него
  // самого, и искать её внутри группы неправильно.
  const opsProfile = {
    name: "Мой профиль",
    href: "/security-ops/profile",
    icon: UserRound,
  };

  // Раздел был плоским списком из 18 пунктов (плюс 6 портальных сверху) —
  // втрое выше порога перегруза, и целиком уезжал в overflow-y-auto. Группы
  // режут его по роду работы; открыта по умолчанию только та, в которой человек
  // сейчас находится.
  const opsGroups = [
    {
      title: "Оперативная работа",
      items: [
        { name: "Командный центр", href: "/security-ops/command-center", icon: LineChart },
        { name: "Реестр ОМ", href: "/security-ops/events", icon: ClipboardList },
        // Реестр ГВО идёт сразу за реестром ОМ: его записи — проекция тех же
        // мероприятий, и появляются они вместе с бюллетенем.
        { name: "Реестр ГВО", href: "/security-ops/gvo", icon: Users },
        { name: "Охраняемые лица", href: "/security-ops/persons", icon: UserRound },
        { name: "Объекты и паспорта", href: "/security-ops/objects", icon: Landmark },
        { name: "Законы об ОМ", href: "/security-ops/laws", icon: Scale },
      ],
    },
    {
      title: "Дежурства и расход",
      items: [
        // «План дежурств» (/security-ops/duties) удалён 13.08.2026 вместе со
        // страницей и адресом. «Боевые группы» (/security-ops/duties/combat) —
        // отдельный раздел на том же префиксе, он сохранён.
        { name: "Календарь смен", href: "/security-ops/calendar", icon: CalendarDays },
        { name: "Боевые группы", href: "/security-ops/duties/combat", icon: Shield },
        { name: "Расход дня (ОМ)", href: "/security-ops/daily-expense", icon: CalendarDays },
      ],
    },
    {
      title: "Оценка и отчётность",
      items: [
        { name: "Оперативный рейтинг", href: "/security-ops/ratings", icon: Star },
        { name: "Аналитика службы", href: "/security-ops/analytics", icon: LineChart },
        { name: "Отчёты службы", href: "/security-ops/service-reports", icon: ScrollText },
      ],
    },
    {
      title: "Администрирование",
      items: [
        { name: "Справочники", href: "/security-ops/dictionaries", icon: ClipboardList },
        { name: "Настройки ОМ", href: "/security-ops/settings", icon: Settings },
        { name: "Обратная связь ОМ", href: "/security-ops/feedback", icon: ClipboardList },
        { name: "Аудит", href: "/security-ops/audit", icon: ScrollText },
        { name: "Журнал изменений", href: "/security-ops/changelog", icon: ClipboardList },
      ],
    },
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

      {/* Навигация. Ссылки — next/link: раньше это были сырые <a>, и каждый
          клик по меню перезагружал документ (сброс кэша запросов, повторный
          бутстрап раздела, потеря позиции прокрутки). */}
      <nav className="mt-6 px-4 flex-1 overflow-y-auto" aria-label="Основная навигация">
        <ul className="space-y-1">
          {filteredNavigation.map((item, index) => (
            <li
              key={item.name}
              className="sidebar-nav-item"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <NavLink
                href={item.href}
                name={item.name}
                icon={item.icon}
                active={isActive(item.href)}
              />
            </li>
          ))}
        </ul>

        {/* Охранные мероприятия — нативный порт Smart Josparlau. */}
        <div className="mt-6">
          <div className="px-4 pb-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">
            Охранные мероприятия
          </div>
          <ul className="space-y-1">
            <li className="sidebar-nav-item">
              <NavLink
                href={opsProfile.href}
                name={opsProfile.name}
                icon={opsProfile.icon}
                active={isActive(opsProfile.href)}
              />
            </li>
          </ul>

          <div className="mt-2 space-y-1">
            {opsGroups.map((group) => {
              const hasActive = group.items.some((item) => isActive(item.href));
              const open = openGroups[group.title] ?? hasActive;
              const listId = `sidebar-group-${group.items[0].href.replace(/\W+/g, "-")}`;
              return (
                <div key={group.title} className="sidebar-nav-item">
                  <button
                    type="button"
                    // Раскрытие — обычная кнопка с aria-expanded: состояние
                    // группы должно быть слышно, а не только видно по стрелке.
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() =>
                      setOpenGroups((current) => ({
                        ...current,
                        [group.title]: !open,
                      }))
                    }
                    className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-[15px] font-semibold transition-colors hover:bg-sidebar-accent ${
                      hasActive
                        ? "text-sidebar-accent-foreground"
                        : "text-sidebar-foreground"
                    }`}
                  >
                    <span>{group.title}</span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 transition-transform ${
                        open ? "rotate-180" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                  {open && (
                    <ul id={listId} className="mt-1 space-y-1 pl-3">
                      {group.items.map((item) => (
                        <li key={item.href}>
                          <NavLink
                            href={item.href}
                            name={item.name}
                            icon={item.icon}
                            active={isActive(item.href)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </nav>

      {/* Обратная связь */}
      <div className="px-4 pb-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/feedback"
                aria-current={isActive("/feedback") ? "page" : undefined}
                className={`sidebar-feedback w-full ${ITEM_CLASS} ${
                  isActive("/feedback")
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <MessageSquarePlus
                  className="mr-3 h-5 w-5 shrink-0"
                  aria-hidden="true"
                />
                <span>Обратная связь</span>
              </Link>
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
