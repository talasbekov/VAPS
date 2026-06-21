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

  const filteredNavigation = navigation.filter((item) =>
    hasPermission(item.resource, item.action)
  );

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
