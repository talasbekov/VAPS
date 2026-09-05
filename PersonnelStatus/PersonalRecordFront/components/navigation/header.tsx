"use client";

import { useState } from "react";
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
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { useOpsPermissions } from "@/hooks/use-ops-permissions";

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
  const sectionRole = sectionRoles.length > 0 ? sectionRoles[0] : null;
  const [isProfileDialogOpen, setIsProfileDialogOpen] = useState(false);

  return (
    // Прилипает только сама шапка. Раньше `sticky` висел на всём <header>, и
    // вместе с ним к верху экрана прилипала трёхстрочная плашка о правах —
    // она отъедала треть экрана телефона на каждой странице у всех ролей,
    // кроме role-2/4/6.
    <header className="border-b border-border">
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 bg-card px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
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
          <Breadcrumbs />
        </div>

        <div className="flex shrink-0 items-center gap-2 ml-auto sm:gap-3">
          {/* Роль в шапке ОДНА — та, что выдана в разделе. Пустое место
              вместо неё молчало бы о причине отказов, поэтому у учётки без
              ролей раздела стоит подпись «Роль не назначена»: человек видит,
              почему экраны закрыты, и знает, что просить. */}
          {sectionRole === null && (
            <span className="text-muted-foreground hidden items-center rounded-lg border border-dashed px-3 py-1.5 text-xs lg:inline-flex">
              Роль не назначена
            </span>
          )}
          {sectionRole && (
            /* Подпись «Раздел ОМ» нужна: два имени подряд без неё читаются
               как одна роль с длинным названием. Область печатается там же —
               «Ответственный за расход департамента» без указания, какого
               именно, отвечает на вопрос наполовину. Если ролей несколько,
               показывается первая: шапка не место для списка, а полный
               состав виден в разделе доступа. */
            <span
              className="text-muted-foreground hidden items-center gap-1 rounded-lg border px-3 py-1.5 text-xs lg:inline-flex"
              title={
                sectionRoles.length > 1
                  ? `Ролей раздела ${sectionRoles.length}: ${sectionRoles
                      .map((role) => role.name)
                      .join(", ")}`
                  : undefined
              }
            >
              <span className="font-semibold">Раздел ОМ:</span>
              <span>{sectionRole.name}</span>
              {sectionRole.scope_division_name ? (
                <span>· {sectionRole.scope_division_name}</span>
              ) : null}
              {sectionRoles.length > 1 ? (
                <span>· ещё {sectionRoles.length - 1}</span>
              ) : null}
            </span>
          )}
          <ThemeToggle />
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
                    {user?.email}
                  </p>
                  {/* СОСТАВ РОЛЕЙ ЦЕЛИКОМ (Plane №353). Ролей у человека
                      может быть несколько — это прямое требование заказчика,
                      — а карточка печатала одну первую. Полный список жил
                      только в атрибуте `title` подписи в шапке: он не
                      открывается ни с клавиатуры, ни касанием, то есть для
                      половины входов состава ролей не существовало вовсе.
                      Шапка остаётся короткой («· ещё N»), а список —
                      здесь, где место есть. Область печатается у каждой
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
              {/* «Система» открыта правом раздела `admin.roles` — тем же,
                  которым открыты сами экраны настроек (см.
                  `entities/portal-access`). Раньше пункт спрашивал ресурс
                  зашитой портальной роли и расходился с ними. */}
              {hasPermission("admin.roles") && (
                <DropdownMenuItem className="text-base py-2">
                  <Settings className="mr-3 h-4 w-4" />
                  <span>Настройки</span>
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
