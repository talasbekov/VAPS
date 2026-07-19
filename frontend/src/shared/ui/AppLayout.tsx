// Каркас портала (прототип «Дашборд расхода персонала», бриф 1 L44-46):
// сайдбар на --sidebar-токенах донора (Sidebar-компоненты в ДС нет — лейаут
// руками) + шапка + <Outlet/>. Разделы — NAV_SECTIONS, отфильтрованные по
// правам (UX L52, роль-фильтрованный сайдбар); права — ТОЛЬКО usePermissions
// из useQuery(['me']) (ARCH-FE-010, копий в state нет). «Выйти» зовёт
// logout() — навигацию на /login делает RequireAuth реактивно (Д7-8.6,
// window.location запрещён). h-screen, не h-dvh (dvh — FF101+, Ловушка 4).
import { Bell, LogOut } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { usePermissions } from '../auth/usePermissions'
import { cn } from '../lib/cn'
import { NAV_SECTIONS } from '../routes'
import { Avatar, AvatarFallback } from './Avatar'
import { Button } from './Button'
import { ConnectionIndicator } from './ConnectionIndicator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu'

export function AppLayout() {
  const { userId, logout } = useAuth()
  // пока ['me'] грузится, permissions undefined → hasPermission всё режет →
  // сайдбар пуст (индикация ТОЛЬКО состоянием Query — свои isLoading-флаги
  // запрещены, L472); при ошибке загрузки прав сайдбар тоже пуст, но шапка
  // НЕ прячется — «Выйти» должен оставаться доступным
  const { hasPermission } = usePermissions()
  const sections = NAV_SECTIONS.filter((s) => hasPermission(s.permission))
  // JWT-вход: userId = null (SPA токен не разбирает, ARCH-SEC-030) → «??»
  const initials = userId === null ? '??' : userId.slice(0, 2).toUpperCase()

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          {/* лого-заглушка «PS» (бриф 1) */}
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
            PS
          </span>
          <span className="truncate text-sm font-semibold">
            PersonnelStatus
          </span>
        </div>
        <nav aria-label="Разделы" className="flex-1 space-y-1 p-2">
          {sections.map((section) => (
            <NavLink
              key={section.route}
              to={section.route}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                )
              }
            >
              <section.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{section.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end gap-1 border-b px-4">
          {/* «нет связи» — рендерится только при reconnecting (11.3); он же
              владеет жизненным циклом WS-клиента */}
          <ConnectionIndicator />
          {/* колокольчик — disabled-заглушка БЕЗ фейкового счётчика; центр
              уведомлений — E11 */}
          <Button
            variant="ghost"
            size="icon"
            disabled
            aria-label="Уведомления (появятся в E11)"
          >
            <Bell />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label="Меню пользователя"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate">
                {userId ?? 'Вход по JWT'}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={logout}>
                <LogOut /> Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        {/* нейтральный контейнер: умеренный padding, плотность рабочих
            таблиц E9/E10 не съедается каркасом */}
        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
