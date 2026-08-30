"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Bell,
  Menu,
  Settings,
  LogOut,
  AlertTriangle,
  User,
} from "lucide-react";
import { useAuth, ROLES, ResourceGate } from "@/lib/auth";
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
  const { user, logout, hasPermission } = useAuth();
  const userRole = user ? ROLES[user.role] : null;
  // Роль РАЗДЕЛА — рядом с кадровой (Plane №325). У ролевых учёток раздела
  // кадровая роль ROLE_1 «Просмотр организации», и шапка печатала именно её:
  // человек видел не ту роль, под которой работает. Кадровую не убираем —
  // она настоящая и ею открыт кадровый контур; просто перестаём молчать о
  // второй.
  const { roles: sectionRoles } = useOpsPermissions();
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
          {/* Роль из прототипа. В эталоне это СЕЛЕКТ — там демонстрационный
              стенд, где ролью переключают показ. Здесь роль назначает сервер,
              и выпадающий список, который ничего не меняет, был бы мёртвым
              контролом: показываем ту роль, что действительно выдана. */}
          {userRole && (
            <span className="text-foreground hidden items-center rounded-lg border px-3 py-1.5 text-xs font-semibold lg:inline-flex">
              {/* Слова «Роль:» здесь нет намеренно: имена ролей в системе уже
                  начинаются с «Роль-N», и префикс давал «Роль: Роль-4». */}
              {userRole.name}
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
                  {userRole && (
                    <Badge className={`mt-2 text-sm ${userRole.color} w-fit`}>
                      {userRole.name}
                    </Badge>
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
              <ResourceGate resource="settings">
                <DropdownMenuItem className="text-base py-2">
                  <Settings className="mr-3 h-4 w-4" />
                  <span>Настройки</span>
                </DropdownMenuItem>
              </ResourceGate>
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

      {/* Alert встроен в header.
          РОЛЬ РАЗДЕЛА СНИМАЕТ ЭТУ ПЛАШКУ (Plane №325). Плашка говорит о
          КАДРОВОЙ роли, и у ролевой учётки раздела она всегда ROLE_1
          «Просмотр организации» — то есть плашка висела бы у всех 28 таких
          учёток постоянно и утверждала бы неправду: права у них есть, просто
          в другом каталоге. Плашка о «ограниченных правах» рядом с рабочим
          экраном учит не верить предупреждениям вообще. */}
      {user &&
        sectionRole === null &&
        user.role !== "role-2" &&
        user.role !== "role-4" &&
        user.role !== "role-6" && (
          <Alert className="border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 rounded-none">
            <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            <AlertDescription className="text-yellow-800 dark:text-yellow-200">
              Ваша роль "{userRole?.name}" имеет ограниченные права доступа.
              Некоторые функции могут быть недоступны.
            </AlertDescription>
          </Alert>
        )}
    </header>
  );
}
