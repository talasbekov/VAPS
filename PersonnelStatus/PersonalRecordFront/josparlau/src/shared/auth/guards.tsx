// Route guards (UX L202-203) — UX-слой: скрыть недоступное. НЕ замена серверной
// проверки (ARCH-SEC-031: права на КАЖДЫЙ запрос, обход UI упрётся в 403).
// Headless без стилей (Tailwind/shadcn — 8.7). Импорт react-router легален
// в shared: это пакет, не слой (ARCH-FE-013).
import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { ApiError } from '../api/errors'
import { ROUTES } from '../routes'
import { getSnapshot, subscribe } from './credential'
import { usePermissions } from './usePermissions'

/** Копирайт заглушки отказа (UX L203). */
export const ACCESS_DENIED_TEXT = 'Доступ запрещён'

/** Сбой загрузки ['me'] (сеть/5xx) — НЕ отказ: deny ≠ fail. */
export const PERMISSIONS_ERROR_TEXT = 'Не удалось проверить права'

/**
 * Нет credential → <Navigate> на /login ДО любых запросов (Ловушка 1:
 * «не залогинен» ловится по credential-state, не по 401); исходный маршрут —
 * в state.from для возврата после входа. Реактивен: 401-очистка credential
 * (providers) уводит на вход без window.location (Д7).
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const credential = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const location = useLocation()
  if (credential === null) {
    return <Navigate to={ROUTES.login} state={{ from: location }} replace />
  }
  return <>{children}</>
}

/**
 * Гейт по праву на данных ['me']: загрузка → заглушка ТОЛЬКО от состояния
 * Query (свои isLoading-флаги запрещены, L472/L487); нет права (и нет `*`) →
 * headless «Доступ запрещён»; есть — children.
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string
  children: ReactNode
}) {
  const { hasPermission, isLoading, error } = usePermissions()
  if (isLoading) {
    return <p role="status">Загрузка…</p>
  }
  // сбой транспорта/5xx — не «Доступ запрещён»; 403 с провода остаётся отказом
  // (defence-in-depth, семантика UX L203), 401 глобально чистит credential →
  // RequireAuth уже уводит на вход
  if (error !== null && !(error instanceof ApiError && error.status === 403)) {
    return <p role="alert">{PERMISSIONS_ERROR_TEXT}</p>
  }
  if (!hasPermission(permission)) {
    return <p>{ACCESS_DENIED_TEXT}</p>
  }
  return <>{children}</>
}
