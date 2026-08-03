// Каркас портала (прототип «Дашборд расхода персонала», бриф 1 L44-46):
// сайдбар на --sidebar-токенах донора (Sidebar-компоненты в ДС нет — лейаут
// руками) + шапка + <Outlet/>. Разделы — NAV_SECTIONS, отфильтрованные по
// правам (UX L52, роль-фильтрованный сайдбар); права — ТОЛЬКО usePermissions
// из useQuery(['me']) (ARCH-FE-010, копий в state нет). «Выйти» зовёт
// logout() — навигацию на /login делает RequireAuth реактивно (Д7-8.6,
// window.location запрещён). h-screen, не h-dvh (dvh — FF101+, Ловушка 4).
import { getFrontendEnv } from '../config/env'
import { LogOut } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { usePermissions } from '../auth/usePermissions'
import { cn } from '../lib/cn'
import { NAV_SECTIONS, ROUTES } from '../routes'
import { APP_VERSION, BUILD_SHA, buildLabel, versionLabel } from '../version'
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
import { NotificationBell } from './NotificationBell'

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

  // Host-встраивание (Этап M4): вокруг уже живут сайдбар и шапка
  // host-приложения — свой chrome здесь был бы вторым каркасом в каркасе.
  // Рендерится только контент; skip-link не нужен (пунктов навигации своих нет).
  if (getFrontendEnv().embeddedChrome) {
    return (
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-6 focus:outline-none">
        <Outlet />
      </main>
    )
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* WCAG 2.4.1 Bypass Blocks: сайдбар — ~13 пунктов навигации, без этой
          ссылки клавиатурный пользователь проходит их все на КАЖДОЙ странице
          прежде чем добраться до контента. sr-only до фокуса, видима при Tab
          (первый элемент в DOM-порядке). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Перейти к содержимому
      </a>
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
          {/* центр уведомлений (11.4): счётчик непрочитанных + панель; данные
              живут в его собственном useQuery, WS обновляет их через
              setQueryData. Пермишен-гарды НЕТ: /api/notifications/ гейтится
              только аутентификацией, аудитория — «любой авторизованный» */}
          <NotificationBell />
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
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-6 focus:outline-none">
          <Outlet />
        </main>
        <AppFooter />
      </div>
    </div>
  )
}

/**
 * Футер каркаса (10.9): версия приложения на КАЖДОМ экране портала + вход в
 * журнал «сообщено → исправлено». Живёт инлайном в AppLayout, а не в
 * `features/changelog/`, и это по построению: `shared → features` запрещено
 * (ARCH-FE-013) — импорт был бы недостижим. Тот же довод, что у 11.4 AC-10.
 *
 * 🔴 НИ ОДНОГО ЗАПРОСА. В этом весь смысл AC для NFR-8: версию читают ровно
 * тогда, когда что-то сломалось, — при 500 на my-permissions сайдбар пуст и
 * разделы недоступны, а версия обязана остаться видимой.
 *
 * 🔴 РАЗМЕТКА БЕЗ <ul>/<ol>/<li>. Естественная разметка «Версия X · сборка Y» —
 * это список, и она МОЛЧА сломала бы четыре чужих e2e-ассерта: харнес
 * e2e-harness/notifications.tsx монтирует настоящий AppLayout, а спеки считают
 * `listitem` ПО ВСЕЙ СТРАНИЦЕ, без скоупа (notifications.spec.ts:313,322-323,374
 * и e2e-live/notifications-live.spec.ts:195-196). Последний живёт в e2e-live/,
 * который отдельным конфигом и в прогоне этой стори не участвует вовсе —
 * значит запрет обязан держаться по построению. Раскладка — <span>-ами.
 *
 * 🔴 НИКАКИХ role="status"/role="alert". Их в DOM уже четыре источника
 * (toast.tsx:54, ConnectionIndicator.tsx:46, guards.tsx:48,
 * NotificationBell.tsx:191) — пятый сделал бы чужие app-тесты неоднозначными.
 * `role="contentinfo"` от <footer>, наоборот, новый и уникальный: это и есть
 * надёжная ручка для ассертов.
 */
function AppFooter() {
  const build = buildLabel(BUILD_SHA)

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t px-6 py-3 text-xs text-muted-foreground">
      {/* <Link>, а не голый <a href>: literal-пути вне routes.ts — eslint error
          (ARCH-FE-012). Подпись версии — она же доступное имя ссылки. */}
      <Link
        to={ROUTES.changelog}
        className="underline-offset-4 hover:text-foreground hover:underline"
      >
        {versionLabel(APP_VERSION)}
      </Link>
      {/* метка сборки только при непустом sha: пустой = сборка вне git,
          «неизвестно» пользователю не рендерим (см. buildLabel) */}
      {build === '' ? null : (
        <>
          <span aria-hidden="true">·</span>
          <span>{build}</span>
        </>
      )}
    </footer>
  )
}
