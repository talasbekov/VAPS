"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu, Settings, LogOut, User } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { NotificationsDropdown } from "@/features/notifications/ui/NotificationsDropdown";
import { EditProfileDialog } from "@/features/edit-profile";
import { useAccountProfile } from "@/features/edit-profile/model/use-account-profile";
import Link from "next/link";
import { TopNavigation } from "@/components/navigation/section-navigation";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";
import { AssistantLauncher } from "@/features/assistant-dock/assistant-dock";

interface HeaderProps {
  onMenuClick: () => void;
  onDesktopMenuClick?: () => void;
  desktopSidebarOpen?: boolean;
}

export function Header({
  onMenuClick,
  onDesktopMenuClick,
  desktopSidebarOpen = true,
}: HeaderProps) {
  const { user, logout } = useAuth();
  // 🔴 КАДРОВОГО БЕЙДЖА БОЛЬШЕ НЕТ (Plane №352, Ш-4). Их было два: кадровая
  // роль («Роль-4») и роль раздела. Кадровой не существует — её каталог снят,
  // — и второе имя рядом с настоящим только сбивало: у ролевых учёток там
  // всегда стояло «Роль-1: Просмотр организации», то есть не та роль, под
  // которой человек работает.
  const { roles: sectionRoles, hasPermission } = useOpsPermissions();
  const accountProfile = useAccountProfile();
  const sectionRole = sectionRoles.length > 0 ? sectionRoles[0] : null;
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // Wrapped tabs change the sticky header's height at narrow widths and zoom.
  // Map controls and anchor offsets must follow the actual header, not a guess.
  useEffect(() => {
    const header = headerRef.current;
    const shell = header?.closest<HTMLElement>(".sj-shell");
    if (!header || !shell) return;
    const measure = () => shell.style.setProperty("--sj-header-height", `${header.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => { observer.disconnect(); shell.style.removeProperty("--sj-header-height"); };
  }, []);

  return (
    // Закрепляется весь navbar: sticky на внутренней строке ограничивался
    // высотой header и уезжал вместе с ним. Отступ задаёт общий shell CSS.
    <header ref={headerRef} className="sj-header border-b border-border">
      <div className="flex min-h-16 items-center justify-between gap-2 bg-card px-4 py-2 sm:px-6">
        <div className="sj-header-context flex min-w-0 items-center gap-2">
          <Link href="/workspace" className="sj-header-brand" aria-label="Smart Josparlau — Моя работа">
            <span className="sj-brand-mark" aria-hidden="true">SJ</span>
            <span>Smart Josparlau</span>
          </Link>
          {/* Бургер — единственный вход в навигацию на мобильном, и до этой
              правки у него не было имени вовсе: скринридер читал «кнопка». */}
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden min-h-11 min-w-11"
            onClick={onMenuClick}
            aria-label="Открыть меню"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
          {onDesktopMenuClick && (
            <Button
              variant="ghost"
              size="sm"
              className="hidden lg:flex"
              onClick={onDesktopMenuClick}
              aria-label={
                desktopSidebarOpen ? "Скрыть боковое меню" : "Показать боковое меню"
              }
              aria-expanded={desktopSidebarOpen}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </Button>
          )}
        </div>

        <TopNavigation />
        <div className="sj-header-tools flex shrink-0 items-center gap-2 ml-auto sm:gap-3">
          {/* Назначенные роли и подразделение уже показаны под фотографией.
              Здесь остаётся только предупреждение об отсутствии ролей. */}
          {sectionRole === null && (
            <span className="text-muted-foreground hidden items-center rounded-lg border border-dashed px-3 py-1.5 text-xs lg:inline-flex">
              Роль не назначена
            </span>
          )}
          <AssistantLauncher />
          <NotificationsDropdown />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="relative h-9 w-9 rounded-full"
                aria-label="Меню пользователя"
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage
                    src="/placeholder.svg?height=36&width=36"
                    alt="Пользователь"
                  />
                  <AvatarFallback className="text-base font-bold">
                    {user?.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("") || "U"}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-2">
                  <p className="text-base font-semibold leading-none">
                    {user?.name}
                  </p>
                  <p className="text-sm leading-none text-muted-foreground">
                    {accountProfile.data?.email ?? user?.email}
                  </p>
                  {/* СОСТАВ РОЛЕЙ ЦЕЛИКОМ (Plane №353). Ролей у человека
                      может быть несколько — это прямое требование заказчика,
                      — а карточка печатала одну первую. Полный список жил
                      только в атрибуте `title` подписи в шапке: он не
                      открывается ни с клавиатуры, ни касанием, то есть для
                      половины входов состава ролей не существовало вовсе.
                      Список остаётся здесь и под фотографией в боковой панели.
                      Область печатается у каждой
                      строки: «Начальник управления» без указания, какого
                      именно, отвечает на вопрос наполовину. */}
                  {sectionRoles.length === 0 ? (
                    <Badge variant="outline" className="mt-2 w-fit text-sm">
                      Роль не назначена
                    </Badge>
                  ) : (
                    <ul
                      aria-label="Роли раздела"
                      className="mt-2 flex flex-col items-start gap-1"
                    >
                      {sectionRoles.map((role) => (
                        <li key={`${role.code}:${role.scope_division_id ?? "all"}`}>
                          <Badge variant="default" className="w-fit text-sm">
                            {role.scope_division_name
                              ? `${role.name} · ${role.scope_division_name}`
                              : role.name}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setIsProfileDialogOpen(true)}
                className="text-base py-2"
              >
                <User className="mr-3 h-4 w-4" />
                <span>Редактировать профиль</span>
              </DropdownMenuItem>
              {hasPermission("settings.view") && (
                <DropdownMenuItem asChild className="text-base py-2">
                  <Link href="/settings">
                  <Settings className="mr-3 h-4 w-4" />
                  <span>Настройки</span>
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => logout()}
                className="text-base py-2"
              >
                <LogOut className="mr-3 h-4 w-4" />
                <span>Выйти</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Диалог редактирования профиля */}
      <EditProfileDialog
        open={isProfileDialogOpen}
        onOpenChange={setIsProfileDialogOpen}
      />

      {/* 🔴 ЖЁЛТАЯ ПЛАШКА «ваша роль имеет ограниченные права» СНЯТА
          (Plane №352, Ш-4). Она говорила о КАДРОВОЙ роли, которой больше нет,
          и висела бы теперь у всех подряд. Правду о правах говорят два места:
          подпись роли раздела в шапке (или «Роль не назначена») и отказ
          конкретного экрана, который называет НУЖНОЕ право. Предупреждение
          «некоторые функции могут быть недоступны» не называет ни одной и
          учит не верить предупреждениям вообще. */}
    </header>
  );
}
